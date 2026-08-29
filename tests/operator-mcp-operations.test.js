import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { readAuditEvents } from "../dist/runtime/audit/store.js";
import { readPrivateJson } from "../dist/runtime/security/private-json.js";
import {
  McpOperationService,
  mcpOperationStatePath,
} from "../dist/runtime/operator/mcp-operations.js";
import { createServiceLassoMcpServer } from "../dist/runtime/operator/mcp.js";
import { makeTempServicesRoot } from "./test-helpers.js";

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

async function waitFor(predicate, message, attempts = 500) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(message);
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
    await ownerConnection.client.close();
    await ownerConnection.server.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("#863 detached operation rehydrates through the runtime recovery adapter without duplicate execution", async () => {
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
      action: "service_install",
      cancellationSupported: false,
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
      assert.equal(fixture.state.snapshotCount, 1);
    } finally {
      await connected.client.close();
      await connected.server.close();
    }
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
