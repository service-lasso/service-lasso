import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer, request as httpRequest } from "node:http";
import { rm } from "node:fs/promises";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { createApiServer, startApiServer, waitForApiServerInitialization } from "../dist/server/index.js";
import { mcpOperationStatePath } from "../dist/runtime/operator/mcp-operations.js";
import { readAuditEvents } from "../dist/runtime/audit/store.js";
import { writePrivateJson } from "../dist/runtime/security/private-json.js";
import { makeTempServicesRoot, writeExecutableFixtureService, writeManifest } from "./test-helpers.js";

const issuer = "https://durable-lifecycle-issuer.example";
const resource = "https://durable-lifecycle.example/api/mcp";
const audience = "durable-lifecycle-http";
const keyId = "durable-lifecycle-http-key";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function startJwksServer() {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  Object.assign(jwk, { kid: keyId, alg: "RS256", use: "sig" });
  const server = createServer((request, response) => {
    if (request.url !== "/jwks") {
      response.statusCode = 404;
      response.end();
      return;
    }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ keys: [jwk] }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    privateKey,
    jwksUri: `http://127.0.0.1:${address.port}/jwks`,
    async stop() {
      const closed = once(server, "close");
      server.close();
      server.closeAllConnections?.();
      await closed;
    },
  };
}

async function signAccessToken(privateKey, scope, identity = {}) {
  const now = Math.floor(Date.now() / 1_000);
  return await new SignJWT({ client_id: identity.clientId ?? "durable-lifecycle-client", scope })
    .setProtectedHeader({ alg: "RS256", kid: keyId })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(identity.actorId ?? "durable-lifecycle-actor")
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(privateKey);
}

async function abandonLifecycleRequest(apiServer, path, body, token) {
  const payload = JSON.stringify(body);
  const target = new URL(`${apiServer.url}${path}`);
  await new Promise((resolve, reject) => {
    const request = httpRequest({
      host: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
        authorization: `Bearer ${token}`,
      },
    });
    let abandoned = false;
    request.once("error", (error) => abandoned ? resolve() : reject(error));
    request.once("socket", () => {
      setTimeout(() => {
        abandoned = true;
        request.destroy();
        resolve();
      }, 150);
    });
    request.write(payload);
    request.end();
  });
}

async function startDirectApiServer(options) {
  const server = createApiServer(options);
  await waitForApiServerInitialization(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    url: `http://127.0.0.1:${address.port}`,
    async stop() {
      const closed = once(server, "close");
      server.close();
      server.closeAllConnections?.();
      await closed;
    },
  };
}

async function startCrossProcessLifecyclePeer(options) {
  const runner = new URL("./fixtures/durable-lifecycle-http-peer.mjs", import.meta.url);
  const child = spawn(process.execPath, [fileURLToPath(runner)], { stdio: ["pipe", "pipe", "pipe"] });
  const ready = new Promise((resolve, reject) => {
    let output = "";
    let errors = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { errors += chunk; });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const newline = output.indexOf("\n");
      if (newline < 0) return;
      try {
        resolve(JSON.parse(output.slice(0, newline)));
      } catch (error) {
        reject(error);
      }
    });
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`cross-process lifecycle peer exited before ready: ${code}; ${errors}`)));
  });
  child.stdin.end(JSON.stringify(options));
  const peer = await Promise.race([
    ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error("cross-process lifecycle peer did not become ready.")), 10_000)),
  ]);
  assert.equal(typeof peer.url, "string");
  return {
    url: peer.url,
    async stop() {
      if (child.exitCode !== null) return;
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
      child.stdout.destroy();
      child.stderr.destroy();
    },
  };
}

async function lifecycleRequest(apiServer, path, method = "GET", body, token) {
  const response = await fetch(`${apiServer.url}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function startHeldUpdateServer() {
  const archive = Buffer.from("durable HTTP update fixture", "utf8");
  const digest = `sha256:${createHash("sha256").update(archive).digest("hex")}`;
  let holdRelease = true;
  let releaseRequests = 0;
  let downloadRequests = 0;
  const releaseAborted = deferred();
  const releaseSocketClosed = deferred();
  const downloadAborted = deferred();
  const downloadSocketClosed = deferred();
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const observeInterruption = (aborted, socketClosed) => {
      request.once("aborted", () => aborted.resolve());
      request.socket.once("close", () => socketClosed.resolve());
    };
    if (url.pathname === "/repos/service-lasso/durable-http-update/releases/latest") {
      releaseRequests += 1;
      observeInterruption(releaseAborted, releaseSocketClosed);
      if (holdRelease) return;
      const baseUrl = `http://127.0.0.1:${server.address().port}`;
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify({
        tag_name: "2026.10.1-new",
        name: "2026.10.1-new",
        html_url: `${baseUrl}/releases/2026.10.1-new`,
        published_at: "2026-10-01T00:00:00Z",
        assets: [{
          id: 1538,
          node_id: "DURABLE_HTTP_1538",
          name: "durable-http-update.zip",
          size: archive.length,
          digest,
          updated_at: "2026-10-01T00:00:00Z",
          browser_download_url: `${baseUrl}/downloads/durable-http-update.zip`,
        }],
      }));
      return;
    }
    if (url.pathname === "/downloads/durable-http-update.zip") {
      downloadRequests += 1;
      observeInterruption(downloadAborted, downloadSocketClosed);
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    releaseRequests: () => releaseRequests,
    downloadRequests: () => downloadRequests,
    waitForAbort: async (kind) => {
      if (kind === "release") {
        await Promise.all([releaseAborted.promise, releaseSocketClosed.promise]);
        return;
      }
      await Promise.all([downloadAborted.promise, downloadSocketClosed.promise]);
    },
    release: () => { holdRelease = false; },
    async stop() {
      server.closeAllConnections?.();
      const closed = once(server, "close");
      server.close();
      await closed;
    },
  };
}

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(message);
}

async function waitForTerminalOperation(apiServer, operationId, token) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const readback = await lifecycleRequest(apiServer, `/api/operator/lifecycle/operations/${operationId}`, "GET", undefined, token);
    if (readback.body.operation?.status === "cancelled") return readback;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`Operation ${operationId} did not become cancelled.`);
}

async function waitForOperationOutcome(apiServer, operationId, token) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const readback = await lifecycleRequest(apiServer, `/api/operator/lifecycle/operations/${operationId}`, "GET", undefined, token);
    if (readback.body.operation?.outcome !== null) return readback;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`Operation ${operationId} did not reach a terminal outcome.`);
}

async function stopFixtureService(apiServer, serviceId, token) {
  const plan = await lifecycleRequest(apiServer, "/api/operator/lifecycle/operations", "POST", {
    action: "stop",
    serviceId,
  }, token);
  if (plan.status !== 200 || plan.body.confirmation?.status !== "pending") return;
  const accepted = await lifecycleRequest(apiServer, "/api/operator/lifecycle/operations", "POST", {
    action: "stop",
    serviceId,
    execute: true,
    idempotencyKey: `durable-fixture-stop-${serviceId}`,
    confirmationId: plan.body.confirmation.id,
    confirmationPhrase: plan.body.confirmation.confirmationPhrase,
  }, token);
  assert.equal(accepted.status, 202);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const readback = await lifecycleRequest(apiServer, `/api/operator/lifecycle/operations/${accepted.body.operation.operationId}`, "GET", undefined, token);
    if (readback.body.operation.outcome !== null) return readback;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail("Fixture stop operation did not reach a terminal state.");
}

test("#1465 durable lifecycle HTTP operations preserve confirmation, idempotency, readback, and safe cancellation", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-durable-lifecycle-http-");
  let apiServer;
  try {
    await writeExecutableFixtureService(servicesRoot, "durable-http-service", { autoExitMs: 500 });
    await writeExecutableFixtureService(servicesRoot, "durable-http-concurrent-service", { autoExitMs: 500 });
    apiServer = await startApiServer({
      port: 0,
      servicesRoot,
      workspaceRoot,
      mcpHttpIdentity: { env: { SERVICE_LASSO_MCP_MODE: "guarded" } },
    });

    const availability = await lifecycleRequest(
      apiServer,
      "/api/operator/lifecycle/services/durable-http-service/availability",
    );
    assert.equal(availability.status, 200);
    assert.equal(availability.body.contractVersion, "service-lasso-durable-lifecycle-operation.v1");
    assert.equal(availability.body.actions.find((entry) => entry.action === "start").available, true);
    assert.deepEqual(availability.body.actions.find((entry) => entry.action === "reload"), {
      action: "reload",
      available: false,
      reason: "durable_operation_unavailable",
      permission: "service-lasso:lifecycle:write",
      requiresConfirmation: true,
    });

    const denied = await lifecycleRequest(apiServer, "/api/operator/lifecycle/operations", "POST", {
      action: "start",
      serviceId: "durable-http-service",
      execute: true,
      idempotencyKey: "durable-http-key-0001",
    });
    assert.equal(denied.status, 409);
    assert.equal(denied.body.error, "confirmation_required");

    const plan = await lifecycleRequest(apiServer, "/api/operator/lifecycle/operations", "POST", {
      action: "start",
      serviceId: "durable-http-service",
    });
    assert.equal(plan.status, 200);
    assert.equal(plan.body.confirmation.status, "pending");

    const execute = {
      action: "start",
      serviceId: "durable-http-service",
      execute: true,
      idempotencyKey: "durable-http-key-0001",
      confirmationId: plan.body.confirmation.id,
      confirmationPhrase: plan.body.confirmation.confirmationPhrase,
    };
    assert.equal(typeof execute.confirmationId, "string");
    assert.equal(typeof execute.confirmationPhrase, "string");
    const accepted = await lifecycleRequest(apiServer, "/api/operator/lifecycle/operations", "POST", execute);
    assert.equal(accepted.status, 202);
    assert.equal(accepted.body.accepted, true);
    assert.match(accepted.body.operation.operationId, /^mcp-operation-/u);
    assert.equal(accepted.body.operation.cancellationSupported, false);

    const replay = await lifecycleRequest(apiServer, "/api/operator/lifecycle/operations", "POST", execute);
    assert.equal(replay.status, 202, JSON.stringify(replay.body));
    assert.equal(replay.body.operation.operationId, accepted.body.operation.operationId);

    const alteredConfirmation = await lifecycleRequest(apiServer, "/api/operator/lifecycle/operations", "POST", {
      ...execute,
      confirmationPhrase: `${execute.confirmationPhrase} altered`,
    });
    assert.equal(alteredConfirmation.status, 409);
    assert.notEqual(alteredConfirmation.body.error, undefined);
    assert.equal(JSON.stringify(alteredConfirmation.body).includes(execute.confirmationPhrase), false);

    const concurrentPlan = await lifecycleRequest(apiServer, "/api/operator/lifecycle/operations", "POST", {
      action: "start",
      serviceId: "durable-http-concurrent-service",
    });
    const concurrentExecute = {
      action: "start",
      serviceId: "durable-http-concurrent-service",
      execute: true,
      idempotencyKey: "durable-http-key-concurrent-0001",
      confirmationId: concurrentPlan.body.confirmation.id,
      confirmationPhrase: concurrentPlan.body.confirmation.confirmationPhrase,
    };
    const [concurrentLeft, concurrentRight] = await Promise.all([
      lifecycleRequest(apiServer, "/api/operator/lifecycle/operations", "POST", concurrentExecute),
      lifecycleRequest(apiServer, "/api/operator/lifecycle/operations", "POST", concurrentExecute),
    ]);
    assert.equal(concurrentLeft.status, 202);
    assert.equal(concurrentRight.status, 202);
    assert.equal(concurrentLeft.body.operation.operationId, concurrentRight.body.operation.operationId);

    let status;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      status = await lifecycleRequest(apiServer, `/api/operator/lifecycle/operations/${accepted.body.operation.operationId}`);
      if (status.body.operation.outcome !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(status.status, 200);
    assert.equal(status.body.operation.action, "service_start");
    assert.equal(status.body.operation.outcome, "succeeded");
    assert.equal(JSON.stringify(status.body).includes(tempRoot), false);

    const replayAfterCompletion = await lifecycleRequest(apiServer, "/api/operator/lifecycle/operations", "POST", execute);
    assert.equal(replayAfterCompletion.status, 202, JSON.stringify(replayAfterCompletion.body));
    assert.equal(replayAfterCompletion.body.operation.operationId, accepted.body.operation.operationId);

    const cancelled = await lifecycleRequest(apiServer, `/api/operator/lifecycle/operations/${accepted.body.operation.operationId}/cancel`, "POST", {});
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.cancellation.result, "too_late");

    const changedKey = await lifecycleRequest(apiServer, "/api/operator/lifecycle/operations", "POST", {
      ...execute,
      action: "stop",
    });
    assert.equal(changedKey.status, 409);
    assert.equal(changedKey.body.error, "idempotency_conflict");

    await apiServer.stop();
    apiServer = await startApiServer({
      port: 0,
      servicesRoot,
      workspaceRoot,
      mcpHttpIdentity: { env: { SERVICE_LASSO_MCP_MODE: "guarded" } },
    });
    const afterRestart = await lifecycleRequest(apiServer, `/api/operator/lifecycle/operations/${accepted.body.operation.operationId}`);
    assert.equal(afterRestart.status, 200);
    assert.equal(afterRestart.body.operation.operationId, accepted.body.operation.operationId);
    assert.equal(afterRestart.body.operation.outcome, "succeeded");
  } finally {
    await apiServer?.stop().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("#1538 HTTP update operations use one cross-process claim and persist actual cancellation with redacted readback", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-durable-http-updates-");
  const jwks = await startJwksServer();
  const updates = await startHeldUpdateServer();
  let apiServer;
  let peer;
  try {
    await writeManifest(servicesRoot, "durable-http-update", {
      id: "durable-http-update",
      name: "Durable HTTP Update",
      description: "Controlled durable HTTP update fixture.",
      version: "2026.10.1-old",
      artifact: {
        kind: "archive",
        source: { type: "github-release", repo: "service-lasso/durable-http-update", tag: "2026.10.1-old", api_base_url: updates.baseUrl },
        platforms: { default: { assetName: "durable-http-update.zip", archiveType: "zip", command: "node", args: ["runtime/update.mjs"] } },
      },
      updates: { mode: "notify", track: "latest" },
    });
    const env = {
      SERVICE_LASSO_MCP_MODE: "guarded",
      SERVICE_LASSO_MCP_OAUTH_ISSUER: issuer,
      SERVICE_LASSO_MCP_OAUTH_JWKS_URI: jwks.jwksUri,
      SERVICE_LASSO_MCP_RESOURCE_URI: resource,
      SERVICE_LASSO_MCP_OAUTH_AUDIENCE: audience,
    };
    const maintainerScopes = "service-lasso:read service-lasso:lifecycle:write service-lasso:config:write service-lasso:update:write";
    const ownerToken = await signAccessToken(jwks.privateKey, maintainerScopes, { actorId: "update-owner", clientId: "update-client" });
    const strangerToken = await signAccessToken(jwks.privateKey, maintainerScopes, { actorId: "update-stranger", clientId: "update-stranger-client" });
    apiServer = await startDirectApiServer({ servicesRoot, workspaceRoot, mcpHttpIdentity: { env } });
    peer = await startCrossProcessLifecyclePeer({ servicesRoot, workspaceRoot, env });

    const check = { action: "update_check", serviceId: "durable-http-update", execute: true, idempotencyKey: "durable-update-check-key-1538" };
    const [first, replay] = await Promise.all([
      lifecycleRequest(apiServer, "/api/operator/lifecycle/operations", "POST", check, ownerToken),
      lifecycleRequest(peer, "/api/operator/lifecycle/operations", "POST", check, ownerToken),
    ]);
    assert.equal(first.status, 202, JSON.stringify(first.body));
    assert.equal(replay.status, 202, JSON.stringify(replay.body));
    assert.equal(first.body.operation.operationId, replay.body.operation.operationId);
    assert.equal(first.body.operation.cancellationSupported, true);
    await waitFor(() => updates.releaseRequests() === 1, "update check was not dispatched exactly once");
    const checkCancelled = await lifecycleRequest(apiServer, `/api/operator/lifecycle/operations/${first.body.operation.operationId}/cancel`, "POST", {}, ownerToken);
    assert.equal(checkCancelled.status, 200);
    assert.equal(checkCancelled.body.cancellation.result, "requested");
    assert.equal(["cancelling", "cancelled"].includes(checkCancelled.body.operation.status), true);
    await updates.waitForAbort("release");
    const checkReadback = await waitForTerminalOperation(apiServer, first.body.operation.operationId, ownerToken);
    assert.equal(checkReadback.body.operation.status, "cancelled");

    updates.release();
    const downloadPlan = await lifecycleRequest(apiServer, "/api/operator/lifecycle/operations", "POST", { action: "update_download", serviceId: "durable-http-update" }, ownerToken);
    assert.equal(downloadPlan.status, 200);
    const download = {
      action: "update_download",
      serviceId: "durable-http-update",
      execute: true,
      idempotencyKey: "durable-update-download-key-1538",
      confirmationId: downloadPlan.body.confirmation.id,
      confirmationPhrase: downloadPlan.body.confirmation.confirmationPhrase,
    };
    const accepted = await lifecycleRequest(apiServer, "/api/operator/lifecycle/operations", "POST", download, ownerToken);
    assert.equal(accepted.status, 202, JSON.stringify(accepted.body));
    await waitFor(() => updates.downloadRequests() === 1, "update download did not reach the controlled provider");
    const deniedRead = await lifecycleRequest(apiServer, `/api/operator/lifecycle/operations/${accepted.body.operation.operationId}`, "GET", undefined, strangerToken);
    assert.equal(deniedRead.status, 404);
    const cancelled = await lifecycleRequest(peer, `/api/operator/lifecycle/operations/${accepted.body.operation.operationId}/cancel`, "POST", {}, ownerToken);
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.cancellation.result, "requested");
    await updates.waitForAbort("download");
    const readback = await waitForTerminalOperation(apiServer, accepted.body.operation.operationId, ownerToken);
    assert.equal(readback.body.operation.status, "cancelled");
    assert.equal(JSON.stringify(readback.body).includes(tempRoot), false);

    const duplicate = await fetch(`${apiServer.url}/api/operator/lifecycle/operations`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${ownerToken}` },
      body: '{"action":"update_check","action":"update_download","serviceId":"durable-http-update"}',
    });
    assert.equal(duplicate.status, 400);
    assert.equal((await duplicate.json()).error, "invalid_json");
    const audit = await readAuditEvents({ workspaceRoot });
    for (const operationId of [first.body.operation.operationId, accepted.body.operation.operationId]) {
      assert.equal(audit.events.some((event) => event.action === "mcp.operation.cancellation" && event.subject === operationId), true);
      assert.equal(audit.events.some((event) => event.action === "mcp.operation.cancelled" && event.subject === operationId), true);
    }
  } finally {
    await peer?.stop().catch(() => undefined);
    await apiServer?.stop().catch(() => undefined);
    await updates.stop().catch(() => undefined);
    await jwks.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("#1538 accepted HTTP cancellation preserves a concurrent successful guarded response before terminal staging", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-durable-http-cancellation-race-");
  const jwks = await startJwksServer();
  const updates = await startHeldUpdateServer();
  const terminalBoundary = deferred();
  const releaseTerminal = deferred();
  const cancellationAccepted = deferred();
  const originalHooks = process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
  let apiServer;
  try {
    process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = "1";
    updates.release();
    await writeManifest(servicesRoot, "durable-http-update", {
      id: "durable-http-update",
      name: "Durable HTTP Update",
      description: "Controlled durable HTTP update fixture.",
      version: "2026.10.1-old",
      artifact: {
        kind: "archive",
        source: { type: "github-release", repo: "service-lasso/durable-http-update", tag: "2026.10.1-old", api_base_url: updates.baseUrl },
        platforms: { default: { assetName: "durable-http-update.zip", archiveType: "zip", command: "node", args: ["runtime/update.mjs"] } },
      },
      updates: { mode: "notify", track: "latest" },
    });
    const env = {
      SERVICE_LASSO_MCP_MODE: "guarded",
      SERVICE_LASSO_MCP_OAUTH_ISSUER: issuer,
      SERVICE_LASSO_MCP_OAUTH_JWKS_URI: jwks.jwksUri,
      SERVICE_LASSO_MCP_RESOURCE_URI: resource,
      SERVICE_LASSO_MCP_OAUTH_AUDIENCE: audience,
    };
    const ownerToken = await signAccessToken(
      jwks.privateKey,
      "service-lasso:read service-lasso:lifecycle:write service-lasso:config:write service-lasso:update:write",
      { actorId: "race-owner", clientId: "race-client" },
    );
    apiServer = await startDirectApiServer({
      servicesRoot,
      workspaceRoot,
      mcpHttpIdentity: { env },
      mcpPolicyTestHooks: {
        beforeTerminalStage: async (_operation, outcome) => {
          if (outcome !== "succeeded") return;
          terminalBoundary.resolve();
          await releaseTerminal.promise;
        },
        afterCancellationAccepted: async () => { cancellationAccepted.resolve(); },
      },
    });
    const accepted = await lifecycleRequest(apiServer, "/api/operator/lifecycle/operations", "POST", {
      action: "update_check",
      serviceId: "durable-http-update",
      execute: true,
      idempotencyKey: "durable-update-success-race-key-1538",
    }, ownerToken);
    assert.equal(accepted.status, 202, JSON.stringify(accepted.body));
    await terminalBoundary.promise;

    const cancellation = lifecycleRequest(apiServer, `/api/operator/lifecycle/operations/${accepted.body.operation.operationId}/cancel`, "POST", {}, ownerToken);
    await cancellationAccepted.promise;
    const admitted = await lifecycleRequest(apiServer, `/api/operator/lifecycle/operations/${accepted.body.operation.operationId}`, "GET", undefined, ownerToken);
    assert.equal(admitted.status, 200);
    assert.equal(admitted.body.operation.status, "cancelling");
    assert.equal(admitted.body.operation.outcome, null);
    releaseTerminal.resolve();
    const cancelled = await cancellation;
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.cancellation.result, "too_late");
    assert.equal(cancelled.body.operation.status, "succeeded");

    const readback = await lifecycleRequest(apiServer, `/api/operator/lifecycle/operations/${accepted.body.operation.operationId}`, "GET", undefined, ownerToken);
    assert.equal(readback.status, 200);
    assert.equal(readback.body.operation.status, "succeeded");
    assert.equal(readback.body.operation.outcome, "succeeded");
    const audit = await readAuditEvents({ workspaceRoot });
    assert.equal(audit.events.some((event) =>
      event.subject === accepted.body.operation.operationId && event.action === "mcp.operation.cancellation"
    ), true);
    const terminalEvents = audit.events.filter((event) =>
      event.subject === accepted.body.operation.operationId && ["mcp.operation.succeeded", "mcp.operation.cancelled"].includes(event.action),
    );
    assert.deepEqual(terminalEvents.map((event) => event.action), ["mcp.operation.succeeded"]);
  } finally {
    if (originalHooks === undefined) delete process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
    else process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = originalHooks;
    await apiServer?.stop().catch(() => undefined);
    await updates.stop().catch(() => undefined);
    await jwks.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("#1465 cross-process HTTP claim window rejects altered valid requests before guarded journal dispatch", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-durable-lifecycle-claim-window-");
  const claimed = deferred();
  const releaseClaim = deferred();
  const originalHooks = process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
  let apiServer;
  let peer;
  let firstRequest;
  try {
    process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = "1";
    const fixtureOptions = { autoExitMs: 1_500 };
    await writeExecutableFixtureService(servicesRoot, "durable-window-service", fixtureOptions);
    await writeExecutableFixtureService(servicesRoot, "durable-window-other-service", fixtureOptions);
    apiServer = await startDirectApiServer({
      servicesRoot,
      workspaceRoot,
      mcpHttpIdentity: { env: { SERVICE_LASSO_MCP_MODE: "guarded" } },
      mcpPolicyTestHooks: {
        afterDurableClaim: async () => {
          claimed.resolve();
          await releaseClaim.promise;
        },
      },
    });
    peer = await startCrossProcessLifecyclePeer({
      servicesRoot,
      workspaceRoot,
      env: { SERVICE_LASSO_MCP_MODE: "guarded" },
    });
    const plan = await lifecycleRequest(apiServer, "/api/operator/lifecycle/operations", "POST", {
      action: "start",
      serviceId: "durable-window-service",
    });
    assert.equal(plan.status, 200);
    const execute = {
      action: "start",
      serviceId: "durable-window-service",
      execute: true,
      idempotencyKey: "durable-claim-window-key-0001",
      confirmationId: plan.body.confirmation.id,
      confirmationPhrase: plan.body.confirmation.confirmationPhrase,
    };
    firstRequest = lifecycleRequest(apiServer, "/api/operator/lifecycle/operations", "POST", execute);
    await claimed.promise;

    const exactReplay = await lifecycleRequest(peer, "/api/operator/lifecycle/operations", "POST", execute);
    assert.equal(exactReplay.status, 202, JSON.stringify(exactReplay.body));

    const missingConfirmation = { ...execute };
    delete missingConfirmation.confirmationPhrase;
    const missing = await lifecycleRequest(peer, "/api/operator/lifecycle/operations", "POST", missingConfirmation);
    assert.equal(missing.status, 409);
    assert.equal(missing.body.error, "confirmation_required");

    const unknown = await lifecycleRequest(peer, "/api/operator/lifecycle/operations", "POST", {
      ...execute,
      confirmationId: `mcp-confirmation-${randomUUID()}`,
    });
    assert.equal(unknown.status, 409);
    assert.equal(unknown.body.error, "confirmation_not_found");

    const expiringPlan = await lifecycleRequest(peer, "/api/operator/lifecycle/operations", "POST", {
      action: "start",
      serviceId: "durable-window-service",
      confirmationTtlSeconds: 1,
    });
    assert.equal(expiringPlan.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 1_050));
    const expired = await lifecycleRequest(peer, "/api/operator/lifecycle/operations", "POST", {
      ...execute,
      confirmationId: expiringPlan.body.confirmation.id,
      confirmationPhrase: expiringPlan.body.confirmation.confirmationPhrase,
    });
    assert.equal(expired.status, 409);
    assert.equal(expired.body.error, "confirmation_expired");

    const alteredPhrase = await lifecycleRequest(peer, "/api/operator/lifecycle/operations", "POST", {
      ...execute,
      confirmationPhrase: `${execute.confirmationPhrase} changed`,
    });
    assert.equal(alteredPhrase.status, 409);
    assert.equal(alteredPhrase.body.error, "idempotency_conflict");

    const alteredTarget = await lifecycleRequest(peer, "/api/operator/lifecycle/operations", "POST", {
      ...execute,
      serviceId: "durable-window-other-service",
    });
    assert.equal(alteredTarget.status, 409);
    assert.equal(alteredTarget.body.error, "idempotency_conflict");

    await writeExecutableFixtureService(servicesRoot, "durable-window-service", {
      ...fixtureOptions,
      env: { DURABLE_WINDOW_CONTEXT: "changed" },
    });
    const alteredContext = await lifecycleRequest(peer, "/api/operator/lifecycle/operations", "POST", execute);
    assert.equal(alteredContext.status, 409);
    assert.equal(alteredContext.body.error, "idempotency_conflict");
    await writeExecutableFixtureService(servicesRoot, "durable-window-service", fixtureOptions);

    releaseClaim.resolve();
    const accepted = await firstRequest;
    assert.equal(accepted.status, 202, JSON.stringify(accepted.body));
    assert.equal(accepted.body.operation.operationId, exactReplay.body.operation.operationId);

    let settled;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      settled = await lifecycleRequest(apiServer, `/api/operator/lifecycle/operations/${accepted.body.operation.operationId}`);
      if (settled.body.operation.outcome !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(settled.body.operation.outcome, "succeeded");

    const audit = await readAuditEvents({ workspaceRoot });
    assert.equal(audit.events.filter((event) => event.action === "mcp.operation.started").length, 1);
    assert.equal(audit.events.filter((event) => event.action === "mcp.action.started").length, 1);
    assert.equal(JSON.stringify(audit).includes(execute.confirmationPhrase), false);
  } finally {
    releaseClaim.resolve();
    await firstRequest?.catch(() => undefined);
    if (apiServer) await stopFixtureService(apiServer, "durable-window-service").catch(() => undefined);
    await peer?.stop().catch(() => undefined);
    await apiServer?.stop().catch(() => undefined);
    if (originalHooks === undefined) delete process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
    else process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = originalHooks;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("#1465 cross-process HTTP replay rejects a changed immutable manifest context before dispatch", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-durable-lifecycle-context-conflict-");
  let apiServer;
  let peer;
  try {
    await writeExecutableFixtureService(servicesRoot, "durable-context-service", { autoExitMs: 100 });
    apiServer = await startApiServer({
      port: 0,
      servicesRoot,
      workspaceRoot,
      mcpHttpIdentity: { env: { SERVICE_LASSO_MCP_MODE: "guarded" } },
    });
    const plan = await lifecycleRequest(apiServer, "/api/operator/lifecycle/operations", "POST", {
      action: "start",
      serviceId: "durable-context-service",
    });
    assert.equal(plan.status, 200);
    const execute = {
      action: "start",
      serviceId: "durable-context-service",
      execute: true,
      idempotencyKey: "durable-context-conflict-key-0001",
      confirmationId: plan.body.confirmation.id,
      confirmationPhrase: plan.body.confirmation.confirmationPhrase,
    };
    const accepted = await lifecycleRequest(apiServer, "/api/operator/lifecycle/operations", "POST", execute);
    assert.equal(accepted.status, 202);

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const readback = await lifecycleRequest(apiServer, `/api/operator/lifecycle/operations/${accepted.body.operation.operationId}`);
      if (readback.body.operation.outcome !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    await writeExecutableFixtureService(servicesRoot, "durable-context-service", {
      autoExitMs: 100,
      env: { DURABLE_CONTEXT_REVISION: "changed" },
    });
    peer = await startCrossProcessLifecyclePeer({
      servicesRoot,
      workspaceRoot,
      env: { SERVICE_LASSO_MCP_MODE: "guarded" },
    });
    const conflicted = await lifecycleRequest(peer, "/api/operator/lifecycle/operations", "POST", execute);
    assert.equal(conflicted.status, 409);
    assert.equal(conflicted.body.error, "idempotency_conflict");
    assert.equal(JSON.stringify(conflicted.body).includes(execute.confirmationPhrase), false);

    const operations = await lifecycleRequest(apiServer, "/api/operator/lifecycle/operations");
    assert.equal(operations.body.pagination.total, 1);
  } finally {
    await peer?.stop().catch(() => undefined);
    await apiServer?.stop().catch(() => undefined);
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("#1465 concurrent HTTP replay is actor-scoped and rejects changed same-key requests", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-durable-lifecycle-concurrent-replay-");
  const jwks = await startJwksServer();
  let apiServer;
  try {
    await writeExecutableFixtureService(servicesRoot, "durable-concurrent-replay-service", {
      autoExitMs: 1_000,
      readyFileAfterMs: 250,
      healthcheck: { type: "file", file: "./runtime/ready.txt", retries: 120, interval: 25 },
    });
    await writeExecutableFixtureService(servicesRoot, "durable-concurrent-other-service", {
      autoExitMs: 1_000,
      readyFileAfterMs: 250,
      healthcheck: { type: "file", file: "./runtime/ready.txt", retries: 120, interval: 25 },
    });
    const env = {
      SERVICE_LASSO_MCP_MODE: "guarded",
      SERVICE_LASSO_MCP_OAUTH_ISSUER: issuer,
      SERVICE_LASSO_MCP_OAUTH_JWKS_URI: jwks.jwksUri,
      SERVICE_LASSO_MCP_RESOURCE_URI: resource,
      SERVICE_LASSO_MCP_OAUTH_AUDIENCE: audience,
    };
    apiServer = await startDirectApiServer({ servicesRoot, workspaceRoot, mcpHttpIdentity: { env } });
    const operatorScope = "service-lasso:read service-lasso:lifecycle:write";
    const ownerToken = await signAccessToken(jwks.privateKey, operatorScope, {
      actorId: "durable-concurrent-owner",
      clientId: "durable-concurrent-owner-client",
    });
    const otherToken = await signAccessToken(jwks.privateKey, operatorScope, {
      actorId: "durable-concurrent-other",
      clientId: "durable-concurrent-other-client",
    });
    const plan = await lifecycleRequest(apiServer, "/api/operator/lifecycle/operations", "POST", {
      action: "start",
      serviceId: "durable-concurrent-replay-service",
    }, ownerToken);
    assert.equal(plan.status, 200);
    const execute = {
      action: "start",
      serviceId: "durable-concurrent-replay-service",
      execute: true,
      idempotencyKey: "durable-concurrent-http-key-0001",
      confirmationId: plan.body.confirmation.id,
      confirmationPhrase: plan.body.confirmation.confirmationPhrase,
    };
    const [left, right] = await Promise.all([
      lifecycleRequest(apiServer, "/api/operator/lifecycle/operations", "POST", execute, ownerToken),
      lifecycleRequest(apiServer, "/api/operator/lifecycle/operations", "POST", execute, ownerToken),
    ]);
    assert.equal(left.status, 202, JSON.stringify(left.body));
    assert.equal(right.status, 202, JSON.stringify(right.body));
    assert.equal(left.body.operation.operationId, right.body.operation.operationId);

    const altered = await lifecycleRequest(apiServer, "/api/operator/lifecycle/operations", "POST", {
      ...execute,
      action: "stop",
    }, ownerToken);
    assert.equal(altered.status, 409);
    assert.equal(altered.body.error, "idempotency_conflict");

    const otherPlan = await lifecycleRequest(apiServer, "/api/operator/lifecycle/operations", "POST", {
      action: "start",
      serviceId: "durable-concurrent-other-service",
    }, otherToken);
    assert.equal(otherPlan.status, 200);
    const other = await lifecycleRequest(apiServer, "/api/operator/lifecycle/operations", "POST", {
      ...execute,
      serviceId: "durable-concurrent-other-service",
      confirmationId: otherPlan.body.confirmation.id,
      confirmationPhrase: otherPlan.body.confirmation.confirmationPhrase,
    }, otherToken);
    assert.equal(other.status, 202);
    assert.notEqual(other.body.operation.operationId, left.body.operation.operationId);

    const [ownerTerminal, otherTerminal] = await Promise.all([
      waitForOperationOutcome(apiServer, left.body.operation.operationId, ownerToken),
      waitForOperationOutcome(apiServer, other.body.operation.operationId, otherToken),
    ]);
    assert.equal(ownerTerminal.body.operation.outcome, "succeeded");
    assert.equal(otherTerminal.body.operation.outcome, "succeeded");
    const [ownerStop, otherStop] = await Promise.all([
      stopFixtureService(apiServer, "durable-concurrent-replay-service", ownerToken),
      stopFixtureService(apiServer, "durable-concurrent-other-service", otherToken),
    ]);
    assert.equal(ownerStop.body.operation.outcome, "succeeded");
    assert.equal(otherStop.body.operation.outcome, "succeeded");
  } finally {
    await apiServer?.stop().catch(() => undefined);
    await jwks.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("#1465 real cross-process HTTP claim binds confirmation context before replay", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-durable-lifecycle-cross-process-http-");
  const jwks = await startJwksServer();
  let apiServer;
  let peer;
  let token;
  try {
    await writeExecutableFixtureService(servicesRoot, "durable-cross-process-service", {
      autoExitMs: 1_500,
      readyFileAfterMs: 200,
      healthcheck: { type: "file", file: "./runtime/ready.txt", retries: 120, interval: 25 },
    });
    const env = {
      SERVICE_LASSO_MCP_MODE: "guarded",
      SERVICE_LASSO_MCP_OAUTH_ISSUER: issuer,
      SERVICE_LASSO_MCP_OAUTH_JWKS_URI: jwks.jwksUri,
      SERVICE_LASSO_MCP_RESOURCE_URI: resource,
      SERVICE_LASSO_MCP_OAUTH_AUDIENCE: audience,
    };
    apiServer = await startDirectApiServer({ servicesRoot, workspaceRoot, mcpHttpIdentity: { env } });
    peer = await startCrossProcessLifecyclePeer({ servicesRoot, workspaceRoot, env });
    token = await signAccessToken(jwks.privateKey, "service-lasso:read service-lasso:lifecycle:write", {
      actorId: "durable-cross-process-actor",
      clientId: "durable-cross-process-client",
    });
    const plan = await lifecycleRequest(apiServer, "/api/operator/lifecycle/operations", "POST", {
      action: "start",
      serviceId: "durable-cross-process-service",
    }, token);
    assert.equal(plan.status, 200);
    const execute = {
      action: "start",
      serviceId: "durable-cross-process-service",
      execute: true,
      idempotencyKey: "durable-cross-process-http-key-0001",
      confirmationId: plan.body.confirmation.id,
      confirmationPhrase: plan.body.confirmation.confirmationPhrase,
    };
    const [left, right] = await Promise.all([
      lifecycleRequest(apiServer, "/api/operator/lifecycle/operations", "POST", execute, token),
      lifecycleRequest(peer, "/api/operator/lifecycle/operations", "POST", execute, token),
    ]);
    assert.equal(left.status, 202);
    assert.equal(right.status, 202);
    assert.equal(left.body.operation.operationId, right.body.operation.operationId);
    const altered = await lifecycleRequest(peer, "/api/operator/lifecycle/operations", "POST", {
      ...execute,
      confirmationPhrase: `${execute.confirmationPhrase} altered`,
    }, token);
    assert.equal(altered.status, 409);
    assert.equal(JSON.stringify(altered.body).includes(execute.confirmationPhrase), false);
    let settled;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      settled = await lifecycleRequest(apiServer, `/api/operator/lifecycle/operations/${left.body.operation.operationId}`, "GET", undefined, token);
      if (settled.body.operation.outcome !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.notEqual(settled.body.operation.outcome, null);
  } finally {
    if (peer && token) await stopFixtureService(peer, "durable-cross-process-service", token).catch(() => undefined);
    if (apiServer && token) await stopFixtureService(apiServer, "durable-cross-process-service", token).catch(() => undefined);
    await peer?.stop().catch(() => undefined);
    await apiServer?.stop().catch(() => undefined);
    await jwks.stop().catch(() => undefined);
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("#1465 availability applies the complete guarded permission profile and scope policy", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-durable-lifecycle-availability-");
  const jwks = await startJwksServer();
  let apiServer;
  try {
    await writeExecutableFixtureService(servicesRoot, "durable-availability-service");
    const env = {
      SERVICE_LASSO_MCP_MODE: "guarded",
      SERVICE_LASSO_MCP_OAUTH_ISSUER: issuer,
      SERVICE_LASSO_MCP_OAUTH_JWKS_URI: jwks.jwksUri,
      SERVICE_LASSO_MCP_RESOURCE_URI: resource,
      SERVICE_LASSO_MCP_OAUTH_AUDIENCE: audience,
    };
    apiServer = await startDirectApiServer({ servicesRoot, workspaceRoot, mcpHttpIdentity: { env } });
    const operatorToken = await signAccessToken(jwks.privateKey, "service-lasso:read service-lasso:lifecycle:write");
    const availability = await lifecycleRequest(
      apiServer,
      "/api/operator/lifecycle/services/durable-availability-service/availability",
      "GET",
      undefined,
      operatorToken,
    );
    assert.equal(availability.status, 200);
    assert.deepEqual(availability.body.actions.find((entry) => entry.action === "start"), {
      action: "start",
      available: true,
      reason: null,
      permission: "service-lasso:lifecycle:write",
      requiresConfirmation: true,
    });
    assert.deepEqual(availability.body.actions.find((entry) => entry.action === "install"), {
      action: "install",
      available: false,
      reason: "insufficient_profile",
      permission: "service-lasso:config:write",
      requiresConfirmation: true,
    });
  } finally {
    await apiServer?.stop().catch(() => undefined);
    await jwks.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("#1465 HTTP operation readback is actor-scoped and Administrator inspection is explicit", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-durable-lifecycle-actor-scope-");
  const jwks = await startJwksServer();
  let apiServer;
  try {
    const now = new Date().toISOString();
    const operationId = `mcp-operation-${randomUUID()}`;
    await writePrivateJson(workspaceRoot, mcpOperationStatePath(workspaceRoot), {
      version: 1,
      operations: [{
        operationId,
        actorId: "durable-owner",
        clientId: "durable-owner-client",
        action: "service_start",
        status: "succeeded",
        phase: "completed",
        progress: 100,
        summary: "Durable actor-scoped operation completed.",
        createdAt: now,
        startedAt: now,
        updatedAt: now,
        completedAt: now,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        targetIds: ["durable-actor-scope-service"],
        correlationId: `mcp-operation-correlation-${randomUUID()}`,
        cancellationSupported: false,
        outcome: "succeeded",
        runnerPid: process.pid,
        runnerInstanceId: randomUUID(),
        heartbeatAt: now,
        guardedExecutionId: null,
        pendingTerminal: null,
      }],
    });
    const env = {
      SERVICE_LASSO_MCP_MODE: "guarded",
      SERVICE_LASSO_MCP_OAUTH_ISSUER: issuer,
      SERVICE_LASSO_MCP_OAUTH_JWKS_URI: jwks.jwksUri,
      SERVICE_LASSO_MCP_RESOURCE_URI: resource,
      SERVICE_LASSO_MCP_OAUTH_AUDIENCE: audience,
    };
    apiServer = await startDirectApiServer({ servicesRoot, workspaceRoot, mcpHttpIdentity: { env } });
    const operatorScope = "service-lasso:read service-lasso:lifecycle:write";
    const ownerToken = await signAccessToken(jwks.privateKey, operatorScope, { actorId: "durable-owner", clientId: "durable-owner-client" });
    const strangerToken = await signAccessToken(jwks.privateKey, operatorScope, { actorId: "durable-stranger", clientId: "durable-stranger-client" });
    const adminToken = await signAccessToken(
      jwks.privateKey,
      "service-lasso:read service-lasso:lifecycle:write service-lasso:config:write service-lasso:update:write service-lasso:runtime:admin",
      { actorId: "durable-administrator", clientId: "durable-administrator-client" },
    );

    const operationPath = `/api/operator/lifecycle/operations/${operationId}`;

    const deniedReadback = await lifecycleRequest(apiServer, operationPath, "GET", undefined, strangerToken);
    assert.equal(deniedReadback.status, 404);
    assert.equal(deniedReadback.body.error, "operation_not_found");
    const deniedCancellation = await lifecycleRequest(apiServer, `${operationPath}/cancel`, "POST", {}, strangerToken);
    assert.equal(deniedCancellation.status, 404);
    const strangerList = await lifecycleRequest(apiServer, "/api/operator/lifecycle/operations", "GET", undefined, strangerToken);
    assert.equal(strangerList.status, 200);
    assert.equal(strangerList.body.pagination.total, 0);

    const administratorReadback = await lifecycleRequest(apiServer, operationPath, "GET", undefined, adminToken);
    assert.equal(administratorReadback.status, 200);
    assert.equal(administratorReadback.body.operation.operationId, operationId);
    assert.equal(administratorReadback.body.operation.ownership, "other");
  } finally {
    await apiServer?.stop().catch(() => undefined);
    await jwks.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("#1465 abandoned HTTP execution survives listener restart and same-key retry without duplication", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-durable-lifecycle-disconnect-");
  const jwks = await startJwksServer();
  let apiServer;
  try {
    await writeExecutableFixtureService(servicesRoot, "durable-disconnect-service", {
      readyFileAfterMs: 2_500,
      healthcheck: { type: "file", file: "./runtime/ready.txt", retries: 120, interval: 25 },
    });
    const env = {
      SERVICE_LASSO_MCP_MODE: "guarded",
      SERVICE_LASSO_MCP_OAUTH_ISSUER: issuer,
      SERVICE_LASSO_MCP_OAUTH_JWKS_URI: jwks.jwksUri,
      SERVICE_LASSO_MCP_RESOURCE_URI: resource,
      SERVICE_LASSO_MCP_OAUTH_AUDIENCE: audience,
    };
    const ownerToken = await signAccessToken(jwks.privateKey, "service-lasso:read service-lasso:lifecycle:write", {
      actorId: "durable-disconnect-owner",
      clientId: "durable-disconnect-client",
    });
    apiServer = await startDirectApiServer({ servicesRoot, workspaceRoot, mcpHttpIdentity: { env } });
    const plan = await lifecycleRequest(apiServer, "/api/operator/lifecycle/operations", "POST", {
      action: "start",
      serviceId: "durable-disconnect-service",
    }, ownerToken);
    const execute = {
      action: "start",
      serviceId: "durable-disconnect-service",
      execute: true,
      idempotencyKey: "durable-disconnect-key-0001",
      confirmationId: plan.body.confirmation.id,
      confirmationPhrase: plan.body.confirmation.confirmationPhrase,
    };
    await abandonLifecycleRequest(apiServer, "/api/operator/lifecycle/operations", execute, ownerToken);

    let active;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      active = await lifecycleRequest(apiServer, "/api/operator/lifecycle/operations", "GET", undefined, ownerToken);
      if (active.body.pagination.total === 1) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(active.status, 200);
    assert.equal(active.body.pagination.total, 1);
    const operationId = active.body.operations[0].operationId;

    await apiServer.stop();
    apiServer = await startDirectApiServer({ servicesRoot, workspaceRoot, mcpHttpIdentity: { env } });
    const replay = await lifecycleRequest(apiServer, "/api/operator/lifecycle/operations", "POST", execute, ownerToken);
    assert.equal(replay.status, 202);
    assert.equal(replay.body.operation.operationId, operationId);

    let settled;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      settled = await lifecycleRequest(apiServer, `/api/operator/lifecycle/operations/${operationId}`, "GET", undefined, ownerToken);
      if (settled.body.operation.outcome !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(settled.status, 200);
    assert.equal(settled.body.operation.outcome, "succeeded");
    const afterRestartList = await lifecycleRequest(apiServer, "/api/operator/lifecycle/operations", "GET", undefined, ownerToken);
    assert.equal(afterRestartList.body.pagination.total, 1);

    const stopPlan = await lifecycleRequest(apiServer, "/api/operator/lifecycle/operations", "POST", {
      action: "stop",
      serviceId: "durable-disconnect-service",
    }, ownerToken);
    const stopAccepted = await lifecycleRequest(apiServer, "/api/operator/lifecycle/operations", "POST", {
      action: "stop",
      serviceId: "durable-disconnect-service",
      execute: true,
      idempotencyKey: "durable-disconnect-stop-key-0001",
      confirmationId: stopPlan.body.confirmation.id,
      confirmationPhrase: stopPlan.body.confirmation.confirmationPhrase,
    }, ownerToken);
    assert.equal(stopAccepted.status, 202);
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const stopped = await lifecycleRequest(
        apiServer,
        `/api/operator/lifecycle/operations/${stopAccepted.body.operation.operationId}`,
        "GET",
        undefined,
        ownerToken,
      );
      if (stopped.body.operation.outcome !== null) {
        assert.equal(stopped.body.operation.outcome, "succeeded");
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } finally {
    await apiServer?.stop().catch(() => undefined);
    await jwks.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("#1465 HTTP readback redacts stored secret, credential, and absolute-path summaries", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-durable-lifecycle-redaction-");
  let apiServer;
  try {
    const now = new Date().toISOString();
    const operationId = `mcp-operation-${randomUUID()}`;
    await writePrivateJson(workspaceRoot, mcpOperationStatePath(workspaceRoot), {
      version: 1,
      operations: [{
        operationId,
        actorId: "local-root",
        clientId: "service-lasso-loopback",
        action: "service_start",
        status: "succeeded",
        phase: "completed",
        progress: 100,
        summary: "credential=durable-http-secret at C:\\private\\operator\\config.json",
        createdAt: now,
        startedAt: now,
        updatedAt: now,
        completedAt: now,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        targetIds: ["durable-redaction-service"],
        correlationId: `mcp-operation-correlation-${randomUUID()}`,
        cancellationSupported: false,
        outcome: "succeeded",
        runnerPid: process.pid,
        runnerInstanceId: randomUUID(),
        heartbeatAt: now,
        guardedExecutionId: null,
        pendingTerminal: null,
      }],
    });
    apiServer = await startApiServer({
      port: 0,
      servicesRoot,
      workspaceRoot,
      mcpHttpIdentity: { env: { SERVICE_LASSO_MCP_MODE: "guarded" } },
    });
    const readback = await lifecycleRequest(apiServer, `/api/operator/lifecycle/operations/${operationId}`);
    assert.equal(readback.status, 200);
    const serialized = JSON.stringify(readback.body);
    assert.equal(serialized.includes("durable-http-secret"), false);
    assert.equal(serialized.includes("C:\\private\\operator"), false);
    assert.equal(readback.body.operation.summary, "Durable MCP operation state is redacted.");
  } finally {
    await apiServer?.stop().catch(() => undefined);
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("#1465 HTTP readback marks an unreconciled active guarded operation unknown after restart", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-durable-lifecycle-recovery-");
  let apiServer;
  try {
    const now = new Date().toISOString();
    const operationId = `mcp-operation-${randomUUID()}`;
    await writePrivateJson(workspaceRoot, mcpOperationStatePath(workspaceRoot), {
      version: 1,
      operations: [{
        operationId,
        actorId: "local-root",
        clientId: "service-lasso-loopback",
        action: "service_start",
        status: "running",
        phase: "executing",
        progress: 50,
        summary: "Durable guarded operation was active before runtime restart.",
        createdAt: now,
        startedAt: now,
        updatedAt: now,
        completedAt: null,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        targetIds: ["durable-recovery-service"],
        correlationId: `mcp-operation-correlation-${randomUUID()}`,
        cancellationSupported: false,
        outcome: null,
        runnerPid: 2_147_483_647,
        runnerInstanceId: randomUUID(),
        heartbeatAt: now,
        guardedExecutionId: "a".repeat(64),
        pendingTerminal: null,
      }],
    });
    apiServer = await startApiServer({
      port: 0,
      servicesRoot,
      workspaceRoot,
      mcpHttpIdentity: { env: { SERVICE_LASSO_MCP_MODE: "guarded" } },
    });
    const readback = await lifecycleRequest(apiServer, `/api/operator/lifecycle/operations/${operationId}`);
    assert.equal(readback.status, 200);
    assert.equal(readback.body.operation.status, "unknown_after_crash");
    assert.equal(readback.body.operation.outcome, "unknown_after_crash");
    assert.equal(readback.body.operation.phase, "unknown_after_crash");
    assert.equal(readback.body.operation.summary.includes("authoritative guarded result"), true);
  } finally {
    await apiServer?.stop().catch(() => undefined);
    await rm(tempRoot, { recursive: true, force: true });
  }
});
