import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer, request as httpRequest } from "node:http";
import { rm } from "node:fs/promises";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { createApiServer, startApiServer } from "../dist/server/index.js";
import { mcpOperationStatePath } from "../dist/runtime/operator/mcp-operations.js";
import { writePrivateJson } from "../dist/runtime/security/private-json.js";
import { makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";

const issuer = "https://durable-lifecycle-issuer.example";
const resource = "https://durable-lifecycle.example/api/mcp";
const audience = "durable-lifecycle-http";
const keyId = "durable-lifecycle-http-key";

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
    if (readback.body.operation.outcome !== null) return;
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
  } finally {
    await apiServer?.stop().catch(() => undefined);
    await jwks.stop();
    await new Promise((resolve) => setTimeout(resolve, 3_000));
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
