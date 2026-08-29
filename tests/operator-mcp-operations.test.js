import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { readAuditEvents } from "../dist/runtime/audit/store.js";
import { readPrivateJson } from "../dist/runtime/security/private-json.js";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import {
  checkServiceUpdatesForCli,
  downloadServiceUpdateCandidate,
} from "../dist/runtime/updates/actions.js";
import { readServiceUpdateState } from "../dist/runtime/updates/state.js";
import {
  McpOperationService,
  mcpOperationStatePath,
} from "../dist/runtime/operator/mcp-operations.js";
import { createServiceLassoMcpServer } from "../dist/runtime/operator/mcp.js";
import { makeTempServicesRoot, writeManifest } from "./test-helpers.js";

const scopesByProfile = {
  observer: ["service-lasso:read"],
  maintainer: [
    "service-lasso:read",
    "service-lasso:lifecycle:write",
    "service-lasso:config:write",
    "service-lasso:update:write",
  ],
  administrator: [
    "service-lasso:read",
    "service-lasso:lifecycle:write",
    "service-lasso:config:write",
    "service-lasso:update:write",
    "service-lasso:runtime:admin",
  ],
};

function authorization(profile = "administrator", overrides = {}) {
  const actorId = overrides.actorId ?? "operation-actor";
  const clientId = overrides.clientId ?? "operation-client";
  const scopes = overrides.scopes ?? scopesByProfile[profile];
  return {
    actor: { kind: "local-token", actorId, clientId, scopes, permissionProfile: profile },
    oauth: {
      enabled: false,
      issuer: null,
      jwksUri: null,
      resource: null,
      audience: null,
      allowedOrigins: [],
    },
    authInfo: {
      token: "",
      clientId,
      scopes,
      extra: { actor: { kind: "local-token", actorId, clientId, permissionProfile: profile } },
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function fixtureFacade(options = {}) {
  const state = { executeCount: 0, snapshotCount: 0 };
  return {
    state,
    facade: {
      async preflight(action, parameters) {
        return {
          action,
          targets: [parameters.serviceId ?? "fixture-service"],
          effects: ["apply manifest-owned fixture action"],
          executable: true,
          skippedReason: null,
        };
      },
      async execute(action, parameters, _plan, executionOptions = {}) {
        state.executeCount += 1;
        await executionOptions.reportProgress?.({ phase: "fixture_running", progress: 55, summary: "Fixture operation is running." });
        if (options.waitForAbort) {
          await new Promise((resolve, reject) => {
            const abort = () => reject(new Error("fixture aborted"));
            executionOptions.signal?.addEventListener("abort", abort, { once: true });
            if (executionOptions.signal?.aborted) abort();
          });
        } else {
          await options.gate?.promise;
        }
        return {
          ok: true,
          status: "succeeded",
          targets: [parameters.serviceId ?? "fixture-service"],
          effects: ["apply manifest-owned fixture action"],
          summary: options.summary ?? `${action} completed safely.`,
          resultingState: [{
            serviceId: parameters.serviceId ?? "fixture-service",
            installed: true,
            configured: true,
            running: false,
          }],
        };
      },
      async snapshot(targets) {
        state.snapshotCount += 1;
        return targets.map((serviceId) => ({
          serviceId,
          installed: options.snapshotInstalled ?? false,
          configured: options.snapshotConfigured ?? false,
          running: options.snapshotRunning ?? false,
        }));
      },
    },
  };
}

function context(servicesRoot, workspaceRoot, facade) {
  return {
    version: "mcp-operations-test",
    servicesRoot,
    workspaceRoot,
    discovered: [],
    registry: { list: () => [], getById: () => undefined },
    graph: { getDependencies: () => [], getDependents: () => [], topologicalSort: () => [] },
    sharedGlobalEnv: {},
    guardedActionFacade: facade,
    mcpOperatingMode: "guarded",
  };
}

async function connectServer(runtimeContext, auth, options = {}) {
  const server = createServiceLassoMcpServer(runtimeContext, {
    authorization: auth,
    operatingMode: "guarded",
    operationRequestBudgetMs: options.operationRequestBudgetMs ?? 25,
    operationRetentionMs: options.operationRetentionMs,
    operationNow: options.operationNow,
    operationRecoverDetached: options.operationRecoverDetached,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "mcp-operation-test", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { server, client };
}

async function prepareExecution(client, toolName, idempotencyKey) {
  const planResult = await client.callTool({
    name: toolName,
    arguments: { serviceId: "fixture-service" },
  });
  assert.equal(planResult.isError, undefined, JSON.stringify(planResult));
  const plan = planResult.structuredContent;
  return {
    serviceId: "fixture-service",
    execute: true,
    idempotencyKey,
    ...(plan.confirmation.required ? {
      confirmationId: plan.confirmation.id,
      confirmationPhrase: plan.confirmation.confirmationPhrase,
    } : {}),
  };
}

async function pollOperation(client, operationId, expected, attempts = 1_000) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await client.callTool({
      name: "service_lasso_operation_status",
      arguments: { operationId },
    });
    assert.equal(result.isError, undefined);
    if (result.structuredContent.operation.status === expected) return result.structuredContent.operation;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`Operation ${operationId} did not reach ${expected}.`);
}

async function pollServiceOperation(service, operationId, authorization, expected, attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await service.get(operationId, authorization);
    if (result.operation.status === expected) return result.operation;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.fail(`Operation ${operationId} did not reach ${expected}.`);
}

async function waitFor(predicate, message, attempts = 500) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(message);
}

async function runDetachedChild(input) {
  const child = spawn(process.execPath, ["tests/fixtures/mcp-operation-detached.mjs"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdin.end(JSON.stringify(input));
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  assert.equal(exitCode, 0, stderr);
  return JSON.parse(stdout.trim());
}

async function startOperationRunner(input) {
  const child = spawn(process.execPath, ["tests/fixtures/mcp-operation-runner.mjs"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdin.end(JSON.stringify(input));
  const operationId = await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error(`Runner did not publish an operation id: ${stderr}`)), 30_000);
    child.once("error", reject);
    child.stdout.on("data", () => {
      const line = stdout.split(/\r?\n/u).find(Boolean);
      if (!line) return;
      clearTimeout(deadline);
      resolve(JSON.parse(line).operationId);
    });
  });
  let expectedTermination = false;
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 || expectedTermination || signal
      ? resolve()
      : reject(new Error(stderr)));
  });
  return {
    child,
    operationId,
    exited,
    stop() {
      expectedTermination = true;
      if (child.exitCode === null) child.kill();
    },
  };
}

async function startCancellableUpdateServer() {
  const archive = Buffer.from("durable update cancellation fixture", "utf8");
  const digest = `sha256:${createHash("sha256").update(archive).digest("hex")}`;
  let releaseRequests = 0;
  let downloadRequests = 0;
  let holdRelease = false;
  const server = createServer((request, response) => {
    if (!request.url) return response.end();
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/repos/service-lasso/update-fixture/releases/latest") {
      releaseRequests += 1;
      if (holdRelease) return;
      const baseUrl = `http://127.0.0.1:${server.address().port}`;
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify({
        tag_name: "2026.8.30-new",
        name: "2026.8.30-new",
        html_url: `${baseUrl}/releases/2026.8.30-new`,
        published_at: "2026-08-30T00:00:00Z",
        assets: [{
          id: 863,
          node_id: "MCP_OPERATION_863",
          name: "update-fixture.zip",
          size: archive.length,
          digest,
          updated_at: "2026-08-30T00:00:00Z",
          browser_download_url: `${baseUrl}/downloads/update-fixture.zip`,
        }],
      }));
      return;
    }
    if (url.pathname === "/downloads/update-fixture.zip") {
      downloadRequests += 1;
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    getReleaseRequests: () => releaseRequests,
    getDownloadRequests: () => downloadRequests,
    holdRelease: () => { holdRelease = true; },
    stop: async () => {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

test("#863 long-running install survives MCP disconnect, polls to completion, and does not duplicate mutation", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-mcp-operation-install-");
  const gate = deferred();
  const fixture = fixtureFacade({ gate });
  const admin = authorization("administrator");
  let first;
  try {
    first = await connectServer(context(servicesRoot, workspaceRoot, fixture.facade), admin);
    const parameters = await prepareExecution(first.client, "service_lasso_install_service", "operation-install-key-01");
    const accepted = await first.client.callTool({ name: "service_lasso_install_service", arguments: parameters });
    assert.equal(accepted.isError, undefined);
    assert.equal(accepted.structuredContent.contractVersion, "service-lasso-mcp-operation-accepted.v1");
    assert.equal(accepted.structuredContent.accepted, true);
    assert.equal(accepted.structuredContent.operation.action, "service_install");
    assert.equal(accepted.structuredContent.operation.cancellationSupported, false);
    assert.equal(accepted.structuredContent.safety.mutating, true);
    const operationId = accepted.structuredContent.operation.operationId;

    const unsupported = await first.client.callTool({
      name: "service_lasso_cancel_operation",
      arguments: { operationId },
    });
    assert.equal(unsupported.isError, undefined);
    assert.equal(unsupported.structuredContent.cancellation.result, "unsupported");
    assert.equal(unsupported.structuredContent.cancellation.terminal, false);

    await first.client.close();
    await first.server.close();
    first = undefined;
    gate.resolve();

    const second = await connectServer(context(servicesRoot, workspaceRoot, fixture.facade), admin);
    try {
      const completed = await pollOperation(second.client, operationId, "succeeded");
      assert.equal(completed.outcome, "succeeded");
      assert.deepEqual(completed.targetIds, ["fixture-service"]);
      assert.equal(fixture.state.executeCount, 1);

      const replay = await second.client.callTool({ name: "service_lasso_install_service", arguments: parameters });
      assert.equal(replay.isError, undefined);
      if (replay.structuredContent.contractVersion === "service-lasso-mcp-operation-accepted.v1") {
        const replayed = await pollOperation(second.client, replay.structuredContent.operation.operationId, "skipped");
        assert.equal(replayed.phase, "replayed");
        assert.equal(replayed.outcome, "skipped");
      } else {
        assert.equal(replay.structuredContent.status, "replayed");
      }
      assert.equal(fixture.state.executeCount, 1);

      const tooLate = await second.client.callTool({
        name: "service_lasso_cancel_operation",
        arguments: { operationId },
      });
      assert.equal(tooLate.isError, undefined);
      assert.equal(tooLate.structuredContent.cancellation.result, "too_late");
    } finally {
      await second.client.close();
      await second.server.close();
    }
  } finally {
    await first?.client.close().catch(() => undefined);
    await first?.server.close().catch(() => undefined);
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("#863 supported cancellation reaches a deterministic terminal state and records Audit", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-mcp-operation-cancel-");
  const fixture = fixtureFacade({ waitForAbort: true });
  const maintainer = authorization("maintainer");
  const connected = await connectServer(context(servicesRoot, workspaceRoot, fixture.facade), maintainer);
  try {
    const parameters = await prepareExecution(connected.client, "service_lasso_check_updates", "operation-cancel-key-01");
    const accepted = await connected.client.callTool({ name: "service_lasso_check_updates", arguments: parameters });
    assert.equal(accepted.isError, undefined);
    const operationId = accepted.structuredContent.operation.operationId;
    assert.equal(accepted.structuredContent.operation.cancellationSupported, true);

    await waitFor(
      () => fixture.state.executeCount === 1,
      "The cancellable fixture did not start exactly once.",
    );

    const cancelled = await connected.client.callTool({
      name: "service_lasso_cancel_operation",
      arguments: { operationId },
    });
    assert.equal(cancelled.isError, undefined);
    assert.equal(cancelled.structuredContent.cancellation.result, "requested");
    const terminal = await pollOperation(connected.client, operationId, "cancelled");
    assert.equal(terminal.outcome, "cancelled");
    assert.equal(fixture.state.executeCount, 1);

    const audit = await readAuditEvents({ workspaceRoot });
    const operationAudit = audit.events.filter((event) => event.subject === operationId);
    assert.equal(operationAudit.some((event) => event.action === "mcp.operation.started"), true);
    assert.equal(operationAudit.some((event) => event.action === "mcp.operation.cancellation"), true);
    assert.equal(operationAudit.some((event) => event.action === "mcp.operation.cancelled"), true);
    assert.equal(operationAudit.every((event) => event.correlationId === terminal.correlationId), true);
    assert.equal(audit.events.some((event) =>
      event.correlationId === terminal.correlationId && event.action === "mcp.action.started"
    ), true);
  } finally {
    await connected.client.close();
    await connected.server.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("#863 concurrent terminal reconciliation publishes exactly one operation outcome Audit event", async () => {
  const { tempRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-mcp-operation-terminal-race-");
  const gate = deferred();
  const auth = authorization("maintainer");
  try {
    const service = new McpOperationService({ workspaceRoot, requestBudgetMs: 25 });
    const submission = await service.submit({
      authorization: auth,
      action: "update_check",
      targetIds: ["fixture-service"],
      cancellationSupported: true,
      execute: async () => {
        await gate.promise;
        return {
          contractVersion: "service-lasso-mcp-guarded-action.v1",
          generatedAt: new Date().toISOString(),
          action: "update_check",
          status: "succeeded",
          ok: true,
          correlationId: "mcp-action-terminal-race",
          preflight: {
            planId: "mcp-plan-terminal-race",
            targets: ["fixture-service"],
            effects: ["check fixture update"],
            executable: true,
            skippedReason: null,
            requiredProfile: "maintainer",
          },
          confirmation: { required: false, id: null, status: "not_required", expiresAt: null },
          idempotency: { keyId: "mcp-idempotency-terminal-race", replayed: false },
          summary: "Fixture terminal race completed.",
          result: { targets: ["fixture-service"], effects: ["check fixture update"], resultingState: [] },
          safety: { mutating: true, redacted: true, omittedSensitiveFields: [] },
        };
      },
    });
    assert.equal(submission.kind, "accepted");
    const operationId = submission.payload.operation.operationId;
    gate.resolve();
    await Promise.all(Array.from({ length: 12 }, async () => await service.get(operationId, auth)));
    const terminal = await service.get(operationId, auth);
    assert.equal(terminal.operation.status, "succeeded");
    const audit = await readAuditEvents({ workspaceRoot });
    assert.equal(audit.events.filter((event) =>
      event.subject === operationId && event.action === "mcp.operation.succeeded"
    ).length, 1);
  } finally {
    gate.resolve();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("#863 detached cancellation denial never strands or overwrites the operation state", async () => {
  const { tempRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-mcp-operation-detached-cancel-");
  try {
    const child = spawn(process.execPath, ["tests/fixtures/mcp-operation-detached.mjs"], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdin.end(JSON.stringify({ workspaceRoot, action: "update_download", cancellationSupported: true }));
    const exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    assert.equal(exitCode, 0, stderr);
    const { operationId } = JSON.parse(stdout.trim());
    const auth = authorization("maintainer", { actorId: "detached-actor", clientId: "new-client" });

    const unsupportedService = new McpOperationService({
      workspaceRoot,
      cancelDetached: async () => "unsupported",
    });
    const unsupported = await unsupportedService.cancel(operationId, auth);
    assert.equal(unsupported.cancellation.result, "unsupported");
    assert.equal(unsupported.operation.status, "running");
    assert.equal(unsupported.operation.phase, "detached");

    const tooLateService = new McpOperationService({
      workspaceRoot,
      cancelDetached: async () => "too_late",
    });
    const tooLate = await tooLateService.cancel(operationId, auth);
    assert.equal(tooLate.cancellation.result, "too_late");
    assert.equal(tooLate.operation.status, "running");
    assert.equal(tooLate.operation.phase, "detached");

    const unavailableService = new McpOperationService({
      workspaceRoot,
      cancelDetached: async () => { throw new Error("unsafe adapter detail"); },
    });
    await assert.rejects(
      unavailableService.cancel(operationId, auth),
      (error) => error?.code === "invalid_request" && !error.message.includes("unsafe adapter detail"),
    );
    const preserved = await unavailableService.get(operationId, auth);
    assert.equal(preserved.operation.status, "running");
    assert.equal(preserved.operation.phase, "detached");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("#863 atomically recovers stale operation locks across independent processes", async () => {
  const { tempRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-mcp-operation-lock-race-");
  try {
    const lockPath = `${mcpOperationStatePath(workspaceRoot)}.lock`;
    await mkdir(path.dirname(lockPath), { recursive: true });
    await writeFile(lockPath, JSON.stringify({
      pid: 2_147_483_647,
      nonce: "orphaned-operation-lock",
      createdAt: "2000-01-01T00:00:00.000Z",
    }), { mode: 0o600 });
    await writeFile(`${lockPath}.recovery`, JSON.stringify({
      pid: 2_147_483_647,
      nonce: "orphaned-operation-recovery",
      createdAt: "2000-01-01T00:00:00.000Z",
    }), { mode: 0o600 });
    const stale = new Date(Date.now() - 120_000);
    await utimes(lockPath, stale, stale);
    await utimes(`${lockPath}.recovery`, stale, stale);

    const created = await Promise.all([
      runDetachedChild({ workspaceRoot, action: "update_check", cancellationSupported: true }),
      runDetachedChild({ workspaceRoot, action: "update_check", cancellationSupported: true }),
    ]);
    assert.equal(new Set(created.map((entry) => entry.operationId)).size, 2);
    const service = new McpOperationService({ workspaceRoot });
    const listed = await service.list({ authorization: authorization("maintainer", { actorId: "detached-actor" }) });
    assert.equal(listed.operations.length, 2);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("#863 MCP request cancellation cancels a supported in-flight operation", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-mcp-operation-request-cancel-");
  const fixture = fixtureFacade({ waitForAbort: true });
  const maintainer = authorization("maintainer");
  const connected = await connectServer(context(servicesRoot, workspaceRoot, fixture.facade), maintainer, {
    operationRequestBudgetMs: 30_000,
  });
  try {
    const parameters = await prepareExecution(connected.client, "service_lasso_check_updates", "operation-request-cancel-key-01");
    const controller = new AbortController();
    const request = connected.client.callTool(
      { name: "service_lasso_check_updates", arguments: parameters },
      undefined,
      { signal: controller.signal, timeout: 60_000 },
    );
    await waitFor(
      () => fixture.state.executeCount === 1,
      "The request-cancellation fixture did not start exactly once.",
      1_500,
    );
    controller.abort();
    await assert.rejects(request, (error) => /aborted/iu.test(error?.message ?? ""));

    let operationId;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const listed = await connected.client.callTool({ name: "service_lasso_list_operations", arguments: {} });
      operationId = listed.structuredContent.operations[0]?.operationId;
      if (operationId) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.match(operationId, /^mcp-operation-/u);
    const terminal = await pollOperation(connected.client, operationId, "cancelled");
    assert.equal(terminal.outcome, "cancelled");
    assert.equal(fixture.state.executeCount, 1);
  } finally {
    await connected.client.close().catch(() => undefined);
    await connected.server.close().catch(() => undefined);
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("#863 cross-process cancellation is runner-owned and terminal completion wins a late race", async () => {
  const { tempRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-mcp-operation-cross-process-cancel-");
  const auth = authorization("maintainer", { actorId: "cross-process-actor", clientId: "cross-process-canceller" });
  const runners = [];
  try {
    const cancelledRunner = await startOperationRunner({ workspaceRoot, completeOnCancel: false });
    runners.push(cancelledRunner);
    const service = new McpOperationService({ workspaceRoot });
    const cancelled = await service.cancel(cancelledRunner.operationId, auth);
    assert.equal(cancelled.cancellation.result, "requested");
    const cancelledTerminal = await pollServiceOperation(service, cancelledRunner.operationId, auth, "cancelled");
    assert.equal(cancelledTerminal.outcome, "cancelled");
    cancelledRunner.stop();
    await cancelledRunner.exited;

    const winningRunner = await startOperationRunner({ workspaceRoot, completeOnCancel: true });
    runners.push(winningRunner);
    const racingCancellation = await service.cancel(winningRunner.operationId, auth);
    assert.equal(["requested", "too_late"].includes(racingCancellation.cancellation.result), true);
    const winningTerminal = await pollServiceOperation(service, winningRunner.operationId, auth, "succeeded");
    assert.equal(winningTerminal.outcome, "succeeded");
    const tooLate = await service.cancel(winningRunner.operationId, auth);
    assert.equal(tooLate.cancellation.result, "too_late");
    assert.equal(tooLate.operation.status, "succeeded");
    winningRunner.stop();
    await winningRunner.exited;
  } finally {
    for (const runner of runners) {
      runner.stop();
      await runner.exited.catch(() => undefined);
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("#863 one coalesced workspace heartbeat keeps concurrent operation runners live", async () => {
  const { tempRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-mcp-operation-heartbeat-");
  const auth = authorization("maintainer");
  const gate = deferred();
  const operationIds = [];
  try {
    const service = new McpOperationService({ workspaceRoot, requestBudgetMs: 25 });
    for (let index = 0; index < 8; index += 1) {
      const submission = await service.submit({
        authorization: auth,
        action: "update_check",
        targetIds: [`fixture-service-${index}`],
        cancellationSupported: true,
        guardedExecutionId: createHash("sha256").update(`heartbeat-${index}`).digest("hex"),
        execute: async () => {
          await gate.promise;
          return {
            contractVersion: "service-lasso-mcp-guarded-action.v1",
            generatedAt: new Date().toISOString(),
            action: "update_check",
            status: "succeeded",
            ok: true,
            correlationId: `mcp-action-heartbeat-${index}`,
            preflight: {
              planId: `mcp-plan-heartbeat-${index}`,
              targets: [`fixture-service-${index}`],
              effects: ["check fixture update"],
              executable: true,
              skippedReason: null,
              requiredProfile: "maintainer",
            },
            confirmation: { required: false, id: null, status: "not_required", expiresAt: null },
            idempotency: { keyId: `mcp-idempotency-heartbeat-${index}`, replayed: false },
            summary: "Concurrent heartbeat fixture completed.",
            result: { targets: [`fixture-service-${index}`], effects: ["check fixture update"], resultingState: [] },
            safety: { mutating: true, redacted: true, omittedSensitiveFields: [] },
          };
        },
      });
      assert.equal(submission.kind, "accepted");
      operationIds.push(submission.payload.operation.operationId);
    }

    let stored;
    for (let attempt = 0; attempt < 45; attempt += 1) {
      stored = await readPrivateJson(workspaceRoot, mcpOperationStatePath(workspaceRoot));
      if (
        stored.operations.length === operationIds.length &&
        stored.operations.every((operation) => Date.parse(operation.heartbeatAt) > Date.parse(operation.startedAt))
      ) break;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    assert.equal(stored.operations.length, operationIds.length);
    assert.equal(stored.operations.every((operation) => Date.parse(operation.heartbeatAt) > Date.parse(operation.startedAt)), true);

    gate.resolve();
    for (const operationId of operationIds) {
      const terminal = await pollServiceOperation(service, operationId, auth, "succeeded");
      assert.equal(terminal.outcome, "succeeded");
    }
  } finally {
    gate.resolve();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("#863 production provider and download aborts cancel durably without false failure or candidate state", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-mcp-operation-update-cancel-");
  const releaseServer = await startCancellableUpdateServer();
  const auth = authorization("maintainer");
  try {
    await writeManifest(servicesRoot, "update-fixture", {
      id: "update-fixture",
      name: "Update Fixture",
      description: "Durable operation cancellation fixture.",
      version: "2026.8.29-old",
      artifact: {
        kind: "archive",
        source: {
          type: "github-release",
          repo: "service-lasso/update-fixture",
          tag: "2026.8.29-old",
          api_base_url: releaseServer.baseUrl,
        },
        platforms: {
          default: {
            assetName: "update-fixture.zip",
            archiveType: "zip",
            command: "node",
            args: ["runtime/update-fixture.mjs"],
          },
        },
      },
      updates: { mode: "notify", track: "latest" },
    });
    const [updateService] = await discoverServices(servicesRoot);
    const operations = new McpOperationService({ workspaceRoot, requestBudgetMs: 25 });

    const download = await operations.submit({
      authorization: auth,
      action: "update_download",
      targetIds: [updateService.manifest.id],
      cancellationSupported: true,
      execute: async (signal) => {
        await downloadServiceUpdateCandidate(updateService, { signal });
        assert.fail("The held production download unexpectedly completed.");
      },
    });
    assert.equal(download.kind, "accepted");
    await waitFor(() => releaseServer.getDownloadRequests() === 1, "The production download did not reach the provider.");
    const cancelledDownload = await operations.cancel(download.payload.operation.operationId, auth);
    assert.equal(cancelledDownload.cancellation.result, "requested");
    assert.equal(cancelledDownload.operation.status, "cancelled");
    const afterDownload = await readServiceUpdateState(updateService);
    assert.equal(afterDownload.failed, null);
    assert.equal(afterDownload.downloadedCandidate, null);
    const archivePath = path.join(updateService.serviceRoot, ".state", "update-candidates", "2026.8.30-new", "update-fixture.zip");
    await assert.rejects(readFile(archivePath), (error) => error?.code === "ENOENT");

    const beforeProviderAbort = JSON.stringify(afterDownload);
    releaseServer.holdRelease();
    const priorReleaseRequests = releaseServer.getReleaseRequests();
    const check = await operations.submit({
      authorization: auth,
      action: "update_check",
      targetIds: [updateService.manifest.id],
      cancellationSupported: true,
      execute: async (signal) => {
        await checkServiceUpdatesForCli([updateService], updateService.manifest.id, { signal });
        assert.fail("The held production provider check unexpectedly completed.");
      },
    });
    assert.equal(check.kind, "accepted");
    await waitFor(
      () => releaseServer.getReleaseRequests() > priorReleaseRequests,
      "The production update check did not reach the provider.",
    );
    const cancelledCheck = await operations.cancel(check.payload.operation.operationId, auth);
    assert.equal(cancelledCheck.cancellation.result, "requested");
    assert.equal(cancelledCheck.operation.status, "cancelled");
    assert.equal(JSON.stringify(await readServiceUpdateState(updateService)), beforeProviderAbort);
  } finally {
    await releaseServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("#863 actor/workspace isolation fails closed while Administrator inspection is explicit", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-mcp-operation-scope-");
  const gate = deferred();
  const fixture = fixtureFacade({ gate });
  const owner = authorization("maintainer", { actorId: "owner-actor", clientId: "owner-client" });
  const stranger = authorization("maintainer", { actorId: "stranger-actor", clientId: "stranger-client" });
  const admin = authorization("administrator", { actorId: "admin-actor", clientId: "admin-client" });
  const ownerConnection = await connectServer(context(servicesRoot, workspaceRoot, fixture.facade), owner);
  let operationId;
  try {
    const parameters = await prepareExecution(ownerConnection.client, "service_lasso_install_service", "operation-scope-key-01");
    const accepted = await ownerConnection.client.callTool({ name: "service_lasso_install_service", arguments: parameters });
    operationId = accepted.structuredContent.operation.operationId;

    const strangerConnection = await connectServer(context(servicesRoot, workspaceRoot, fixture.facade), stranger);
    try {
      const hidden = await strangerConnection.client.callTool({
        name: "service_lasso_operation_status",
        arguments: { operationId },
      });
      assert.equal(hidden.isError, true);
      assert.equal(JSON.parse(hidden.content[0].text).error.code, "operation_not_found");
      const ownList = await strangerConnection.client.callTool({ name: "service_lasso_list_operations", arguments: {} });
      assert.equal(ownList.structuredContent.operations.length, 0);
      const hiddenCancellation = await strangerConnection.client.callTool({
        name: "service_lasso_cancel_operation",
        arguments: { operationId },
      });
      assert.equal(hiddenCancellation.isError, true);
      assert.equal(JSON.parse(hiddenCancellation.content[0].text).error.code, "operation_not_found");
      const deniedAll = await strangerConnection.client.callTool({
        name: "service_lasso_list_operations",
        arguments: { includeAllActors: true },
      });
      assert.equal(deniedAll.isError, true);
      assert.equal(JSON.parse(deniedAll.content[0].text).error.code, "forbidden");
    } finally {
      await strangerConnection.client.close();
      await strangerConnection.server.close();
    }

    const adminConnection = await connectServer(context(servicesRoot, workspaceRoot, fixture.facade), admin);
    try {
      const inspected = await adminConnection.client.callTool({
        name: "service_lasso_operation_status",
        arguments: { operationId },
      });
      assert.equal(inspected.isError, undefined);
      assert.equal(inspected.structuredContent.operation.ownership, "other");
      const all = await adminConnection.client.callTool({
        name: "service_lasso_list_operations",
        arguments: { includeAllActors: true },
      });
      assert.equal(all.structuredContent.operations.some((operation) => operation.operationId === operationId), true);
      const overriddenCancellation = await adminConnection.client.callTool({
        name: "service_lasso_cancel_operation",
        arguments: { operationId },
      });
      assert.equal(overriddenCancellation.isError, undefined);
      assert.equal(overriddenCancellation.structuredContent.cancellation.result, "unsupported");
    } finally {
      await adminConnection.client.close();
      await adminConnection.server.close();
    }

    const isolated = await makeTempServicesRoot("service-lasso-mcp-operation-other-workspace-");
    try {
      const otherWorkspace = await connectServer(
        context(isolated.servicesRoot, isolated.workspaceRoot, fixture.facade),
        admin,
      );
      try {
        const hidden = await otherWorkspace.client.callTool({
          name: "service_lasso_operation_status",
          arguments: { operationId },
        });
        assert.equal(hidden.isError, true);
        assert.equal(JSON.parse(hidden.content[0].text).error.code, "operation_not_found");
      } finally {
        await otherWorkspace.client.close();
        await otherWorkspace.server.close();
      }
    } finally {
      await rm(isolated.tempRoot, { recursive: true, force: true });
    }
    const audit = await readAuditEvents({ workspaceRoot });
    assert.equal(audit.events.some((event) =>
      event.action === "mcp.operation.cancellation" &&
      event.subject === operationId &&
      event.actor === "stranger-actor" &&
      event.outcome === "failure" &&
      event.reason === "operation_not_found"
    ), true);
  } finally {
    gate.resolve();
    if (operationId) {
      const terminal = await pollOperation(ownerConnection.client, operationId, "succeeded");
      assert.equal(terminal.outcome, "succeeded");
    }
    await ownerConnection.client.close();
    await ownerConnection.server.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("#863 guarded authorization is decided before any durable operation is created", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-mcp-operation-preauth-");
  const fixture = fixtureFacade();
  const observer = authorization("observer");
  const connected = await connectServer(context(servicesRoot, workspaceRoot, fixture.facade), observer);
  try {
    const denied = await connected.client.callTool({
      name: "service_lasso_check_updates",
      arguments: {
        serviceId: "fixture-service",
        execute: true,
        idempotencyKey: "operation-denied-key-01",
      },
    });
    assert.equal(denied.isError, true);
    assert.equal(JSON.parse(denied.content[0].text).error.code, "insufficient_profile");
    const listed = await connected.client.callTool({ name: "service_lasso_list_operations", arguments: {} });
    assert.equal(listed.isError, undefined);
    assert.equal(listed.structuredContent.operations.length, 0);
    const audit = await readAuditEvents({ workspaceRoot });
    assert.equal(audit.events.some((event) => event.action === "mcp.action.denied" && event.reason === "insufficient_profile"), true);
    assert.equal(audit.events.some((event) => event.action === "mcp.operation.started"), false);
  } finally {
    await connected.client.close();
    await connected.server.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("#863 missing durable idempotency is denied and audited before operation creation", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-mcp-operation-idempotency-preflight-");
  const fixture = fixtureFacade();
  const connected = await connectServer(context(servicesRoot, workspaceRoot, fixture.facade), authorization("maintainer"));
  try {
    const denied = await connected.client.callTool({
      name: "service_lasso_check_updates",
      arguments: { serviceId: "fixture-service", execute: true },
    });
    assert.equal(denied.isError, true);
    assert.equal(JSON.parse(denied.content[0].text).error.code, "invalid_idempotency_key");
    const listed = await connected.client.callTool({ name: "service_lasso_list_operations", arguments: {} });
    assert.equal(listed.isError, undefined);
    assert.equal(listed.structuredContent.operations.length, 0);
    const audit = await readAuditEvents({ workspaceRoot });
    assert.equal(audit.events.some((event) =>
      event.action === "mcp.action.denied" &&
      event.subject === "update_check" &&
      event.reason === "invalid_idempotency_key"
    ), true);
    assert.equal(audit.events.some((event) => event.action === "mcp.operation.started"), false);
  } finally {
    await connected.client.close();
    await connected.server.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("#863 detached operation rehydrates only from its authoritative guarded result without ambient-state inference", async () => {
  const { tempRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-mcp-operation-recovery-");
  try {
    const child = spawn(process.execPath, ["tests/fixtures/mcp-operation-detached.mjs"], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdin.end(JSON.stringify({
      workspaceRoot,
      action: "update_check",
      cancellationSupported: false,
      authoritativeGuardedResult: true,
    }));
    const exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    assert.equal(exitCode, 0, stderr);
    const { operationId } = JSON.parse(stdout.trim());
    const fixture = fixtureFacade({ snapshotInstalled: true });
    const runtimeContext = context(path.join(tempRoot, "services"), workspaceRoot, fixture.facade);
    const connected = await connectServer(runtimeContext, authorization("maintainer", {
      actorId: "detached-actor",
      clientId: "new-client",
    }));
    try {
      const recovered = await connected.client.callTool({
        name: "service_lasso_operation_status",
        arguments: { operationId },
      });
      assert.equal(recovered.isError, undefined);
      assert.equal(recovered.structuredContent.operation.status, "succeeded");
      assert.equal(recovered.structuredContent.operation.outcome, "succeeded");
      const reread = await connected.client.callTool({
        name: "service_lasso_operation_status",
        arguments: { operationId },
      });
      assert.equal(reread.structuredContent.operation.status, "succeeded");
      assert.equal(fixture.state.snapshotCount, 0);
    } finally {
      await connected.client.close();
      await connected.server.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("#863 an orphaned nonterminal operation expires as interrupted instead of consuming capacity forever", async () => {
  const { tempRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-mcp-operation-interrupted-");
  try {
    const { operationId, expiresAt } = await runDetachedChild({
      workspaceRoot,
      action: "update_check",
      cancellationSupported: true,
      retentionMs: 10_000,
    });
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, Date.parse(expiresAt) - Date.now()) + 100));
    const auth = authorization("maintainer", { actorId: "detached-actor", clientId: "new-client" });
    const service = new McpOperationService({ workspaceRoot, retentionMs: 10_000 });
    const interrupted = await service.get(operationId, auth);
    assert.equal(interrupted.operation.status, "failed");
    assert.equal(interrupted.operation.phase, "interrupted");
    assert.equal(interrupted.operation.outcome, "failed");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("#863 completed retention cleans up deterministically and operation state omits sensitive material", async () => {
  const { tempRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-mcp-operation-retention-");
  let now = new Date("2026-08-29T00:00:00.000Z");
  const auth = authorization("maintainer", {
    actorId: "C:\\private\\operation-actor",
    clientId: "token=forbidden-client-marker",
  });
  try {
    const service = new McpOperationService({
      workspaceRoot,
      requestBudgetMs: 100,
      retentionMs: 1_000,
      now: () => now,
    });
    const submission = await service.submit({
      authorization: auth,
      action: "update_check",
      targetIds: ["fixture-service"],
      cancellationSupported: true,
      execute: async () => ({
        contractVersion: "service-lasso-mcp-guarded-action.v1",
        generatedAt: now.toISOString(),
        action: "update_check",
        status: "succeeded",
        ok: true,
        correlationId: "mcp-action-fixture",
        preflight: {
          planId: "mcp-plan-fixture",
          targets: ["fixture-service"],
          effects: ["safe fixture effect"],
          executable: true,
          skippedReason: null,
          requiredProfile: "maintainer",
        },
        confirmation: { required: false, id: null, status: "not_required", expiresAt: null },
        idempotency: { keyId: "mcp-idempotency-fixture", replayed: false },
        summary: "token=forbidden-sensitive-marker at C:\\private\\config.json",
        result: { targets: ["fixture-service"], effects: ["safe fixture effect"], resultingState: [] },
        safety: { mutating: true, redacted: true, omittedSensitiveFields: [] },
      }),
    });
    const operationId = submission.kind === "accepted"
      ? submission.payload.operation.operationId
      : null;
    if (operationId) {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const current = await service.get(operationId, auth);
        if (current.operation.status === "succeeded") break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const completed = await service.get(operationId, auth);
      assert.equal(completed.operation.status, "succeeded");
    } else {
      assert.equal(submission.kind, "completed");
    }
    const stored = await readPrivateJson(workspaceRoot, mcpOperationStatePath(workspaceRoot));
    const serialized = JSON.stringify(stored);
    assert.equal(serialized.includes("forbidden-sensitive-marker"), false);
    assert.equal(serialized.includes("C:\\private"), false);
    assert.equal(serialized.includes("forbidden-client-marker"), false);
    assert.equal(serialized.includes("idempotency-fixture"), false);

    now = new Date(now.getTime() + 1_001);
    const listed = await service.list({ authorization: auth });
    assert.equal(listed.operations.length, 0);
    assert.equal(listed.pagination.total, 0);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
