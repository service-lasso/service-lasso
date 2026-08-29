import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { createHash } from "node:crypto";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import AdmZip from "adm-zip";
import { readAuditEvents } from "../dist/runtime/audit/store.js";
import { getLifecycleState, resetLifecycleState, setLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { getServiceStatePaths } from "../dist/runtime/state/paths.js";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { buildServiceExecutableMutationBinding } from "../dist/runtime/setup/definition-revision.js";
import { readPrivateJson } from "../dist/runtime/security/private-json.js";
import {
  guardedActionIdempotencyPath,
  guardedActionPolicy,
  guardedActionStatePath,
  invokeMcpGuardedAction,
} from "../dist/runtime/operator/mcp-guarded-actions.js";
import { createServiceLassoMcpServer, getServiceLassoMcpCapabilities } from "../dist/runtime/operator/mcp.js";
import { startApiServer } from "../dist/server/index.js";
import { makeTempServicesRoot, writeExecutableFixtureService, writeManifest } from "./test-helpers.js";

const scopesByProfile = {
  observer: ["service-lasso:read"],
  operator: ["service-lasso:read", "service-lasso:lifecycle:write"],
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
  const actorId = overrides.actorId ?? "mcp-action-actor";
  const clientId = overrides.clientId ?? "mcp-action-client";
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

test("#862 executable evidence uses the supervisor commandline root and binds basename file arguments", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-mcp-launch-binding-");
  try {
    const serviceRoot = path.join(servicesRoot, "launch-binding-service");
    const artifactRoot = path.join(serviceRoot, ".state", "extracted", "current");
    await mkdir(artifactRoot, { recursive: true });
    await writeFile(path.join(serviceRoot, "server.mjs"), "setInterval(() => {}, 1000);\n", "utf8");
    await writeFile(path.join(serviceRoot, "config.yml"), "source: service-root\n", "utf8");
    await writeFile(path.join(artifactRoot, "server.mjs"), "throw new Error('artifact decoy');\n", "utf8");
    await writeFile(path.join(artifactRoot, "config.yml"), "source: artifact-decoy\n", "utf8");
    await writeManifest(servicesRoot, "launch-binding-service", {
      id: "launch-binding-service",
      name: "Launch binding fixture",
      description: "Proves exact commandline path binding.",
      executable: process.execPath,
      commandline: { default: "server.mjs --config=config.yml" },
    });
    const [service] = await discoverServices(servicesRoot);
    const state = getLifecycleState(service.manifest.id);
    setLifecycleState(service.manifest.id, {
      ...state,
      installed: true,
      installArtifacts: {
        ...state.installArtifacts,
        artifact: {
          sourceType: "github-release",
          repo: "service-lasso/launch-binding-service",
          channel: null,
          tag: "fixture",
          assetName: "fixture.zip",
          assetUrl: null,
          archiveType: "zip",
          archivePath: null,
          extractedPath: artifactRoot,
          command: process.execPath,
          args: ["artifact-fallback.mjs"],
          checksum: null,
        },
      },
    });

    const binding = await buildServiceExecutableMutationBinding(service);
    const files = new Set(binding.files.map((entry) => path.normalize(entry.file)));
    assert.equal(files.has(path.normalize(path.join(serviceRoot, "server.mjs"))), true);
    assert.equal(files.has(path.normalize(path.join(serviceRoot, "config.yml"))), true);
    assert.equal(files.has(path.normalize(path.join(artifactRoot, "server.mjs"))), false);
    assert.equal(files.has(path.normalize(path.join(artifactRoot, "config.yml"))), false);
  } finally {
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

function fixtureFacade(options = {}) {
  const state = {
    target: options.target ?? "fixture-service",
    effect: options.effect ?? "apply manifest-owned lifecycle action",
    extraEffects: options.extraEffects ?? [],
    executable: options.executable ?? true,
    executeCount: 0,
  };
  const facade = {
    async preflight(action) {
      return {
        action,
        targets: state.executable ? [state.target] : [],
        effects: state.executable ? [state.effect, ...state.extraEffects] : [],
        executable: state.executable,
        skippedReason: state.executable ? null : "already_in_requested_state",
      };
    },
    async execute(_action, parameters) {
      state.executeCount += 1;
      await options.beforeComplete?.();
      if (options.throwOnExecute) throw new Error("sensitive execution detail");
      return {
        ok: true,
        status: "succeeded",
        targets: [state.target],
        effects: [state.effect, ...state.extraEffects],
        summary: options.summary ?? `Guarded action completed for ${parameters.serviceId ?? "runtime"}.`,
        resultingState: [{
          serviceId: state.target,
          installed: true,
          configured: true,
          running: true,
        }],
      };
    },
    async snapshot(targets) {
      return targets.map((serviceId) => ({
        serviceId,
        installed: true,
        configured: true,
        running: options.snapshotRunning ?? false,
      }));
    },
  };
  return { facade, state };
}

async function preflight(workspaceRoot, facade, action = "service_start", parameters = {}, options = {}) {
  return await invokeMcpGuardedAction({
    workspaceRoot,
    operatingMode: options.operatingMode ?? "guarded",
    authorization: options.authorization ?? authorization("administrator"),
    facade,
    action,
    parameters: {
      ...(action.startsWith("runtime_") ? {} : { serviceId: "fixture-service" }),
      ...parameters,
    },
    now: options.now,
  });
}

function executionParameters(plan, idempotencyKey, overrides = {}) {
  return {
    serviceId: "fixture-service",
    execute: true,
    idempotencyKey,
    confirmationId: plan.confirmation.id,
    confirmationPhrase: plan.confirmation.confirmationPhrase,
    ...overrides,
  };
}

async function rpc(apiServer, request) {
  const response = await fetch(`${apiServer.url}/api/mcp`, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify(request),
  });
  const text = await response.text();
  const body = (response.headers.get("content-type") ?? "").includes("text/event-stream")
    ? JSON.parse(text.split(/\r?\n/u).find((line) => line.startsWith("data:"))?.slice(5).trim() ?? "null")
    : JSON.parse(text);
  return { status: response.status, body };
}

async function assertDurableRpcOutcome(apiServer, rpcResult, expectedStatus) {
  const initial = rpcResult.body.result;
  if (initial?.isError === true) {
    assert.equal(expectedStatus, "failed");
    return { status: "failed", outcome: "failed" };
  }
  const payload = initial?.structuredContent;
  if (payload?.contractVersion !== "service-lasso-mcp-operation-accepted.v1") {
    assert.equal(payload?.status, expectedStatus, JSON.stringify(payload));
    return payload;
  }
  const operationId = payload.operation.operationId;
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const status = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: `operation-${attempt}`,
      method: "tools/call",
      params: { name: "service_lasso_operation_status", arguments: { operationId } },
    });
    assert.equal(status.status, 200, JSON.stringify(status.body));
    assert.ok(status.body.result, JSON.stringify(status.body));
    assert.equal(status.body.result?.isError, undefined, JSON.stringify(status.body.result));
    const operation = status.body.result.structuredContent.operation;
    if (["succeeded", "failed", "cancelled", "skipped"].includes(operation.status)) {
      assert.equal(operation.status, expectedStatus, JSON.stringify(operation));
      return operation;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.fail(`Durable operation ${operationId} did not reach ${expectedStatus}.`);
}

async function runRaceChild(input) {
  const child = spawn(process.execPath, ["tests/fixtures/mcp-guarded-action-race.mjs"], {
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

async function startMutableUpdateReleaseServer() {
  let tag = "2026.8.29-a";
  let content = "guarded update download fixture";
  let assetUpdatedAt = "2026-08-29T00:00:00Z";
  let includeDigest = true;
  let replacementDownloadContent = null;
  let downloads = 0;
  const assetName = "update-service.zip";
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    if (url.pathname === "/repos/service-lasso/update-service/releases/latest") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        tag_name: tag,
        name: tag,
        html_url: `${baseUrl}/releases/${tag}`,
        published_at: "2026-08-29T00:00:00Z",
        assets: [{
          id: 862,
          node_id: "RA_guarded_update_fixture",
          name: assetName,
          browser_download_url: `${baseUrl}/downloads/${tag}/${assetName}`,
          size: Buffer.byteLength(content),
          updated_at: assetUpdatedAt,
          digest: includeDigest ? `sha256:${createHash("sha256").update(content).digest("hex")}` : null,
        }],
      }));
      return;
    }
    if (url.pathname.startsWith("/downloads/")) {
      downloads += 1;
      const bytes = replacementDownloadContent ?? content;
      replacementDownloadContent = null;
      response.end(bytes);
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    setTag: (nextTag) => { tag = nextTag; },
    setContent: (nextContent) => {
      content = nextContent;
      assetUpdatedAt = "2026-08-29T00:01:00Z";
    },
    setIncludeDigest: (value) => { includeDigest = value; },
    replaceNextDownloadContent: (value) => { replacementDownloadContent = value; },
    getDownloads: () => downloads,
    close: async () => {
      const closed = once(server, "close");
      server.close();
      server.closeAllConnections?.();
      await closed;
    },
  };
}

test("#862 publishes the explicit guarded-action permission and confirmation matrix", () => {
  const expected = {
    service_start: ["operator", "service-lasso:lifecycle:write", true],
    service_stop: ["operator", "service-lasso:lifecycle:write", true],
    service_restart: ["operator", "service-lasso:lifecycle:write", true],
    service_install: ["maintainer", "service-lasso:config:write", true],
    service_configure: ["maintainer", "service-lasso:config:write", true],
    setup_step_run: ["maintainer", "service-lasso:config:write", true],
    update_check: ["maintainer", "service-lasso:update:write", false],
    update_download: ["maintainer", "service-lasso:update:write", true],
    update_install: ["maintainer", "service-lasso:update:write", true],
    runtime_start_all: ["administrator", "service-lasso:runtime:admin", true],
    runtime_stop_all: ["administrator", "service-lasso:runtime:admin", true],
  };
  for (const [action, tuple] of Object.entries(expected)) {
    const policy = guardedActionPolicy(action);
    assert.deepEqual([policy.requiredProfile, policy.requiredScope, policy.confirmationRequired], tuple);
  }
});

test("#862 binds server confirmations to actor, client, action, targets, parameters, plan, phrase, and expiry", async () => {
  const { tempRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-mcp-confirmation-");
  const { facade, state } = fixtureFacade();
  const admin = authorization("administrator");
  const expectCode = async (promise, code) => {
    await assert.rejects(promise, (error) => error?.code === code);
  };

  try {
    const actorPlan = await preflight(workspaceRoot, facade);
    await expectCode(preflight(workspaceRoot, facade, "service_start", executionParameters(actorPlan, "actor-key-0001"), {
      authorization: authorization("administrator", { actorId: "different-actor" }),
    }), "confirmation_actor_mismatch");

    const clientPlan = await preflight(workspaceRoot, facade);
    await expectCode(preflight(workspaceRoot, facade, "service_start", executionParameters(clientPlan, "client-key-001"), {
      authorization: authorization("administrator", { clientId: "different-client" }),
    }), "confirmation_actor_mismatch");

    const actionPlan = await preflight(workspaceRoot, facade);
    await expectCode(preflight(workspaceRoot, facade, "service_stop", executionParameters(actionPlan, "action-key-001")), "confirmation_action_mismatch");

    const parameterPlan = await preflight(workspaceRoot, facade);
    await expectCode(preflight(workspaceRoot, facade, "service_start", executionParameters(parameterPlan, "params-key-001", {
      serviceId: "other-service",
    })), "confirmation_parameter_mismatch");

    const targetPlan = await preflight(workspaceRoot, facade);
    state.target = "changed-service";
    await expectCode(preflight(workspaceRoot, facade, "service_start", executionParameters(targetPlan, "target-key-001")), "confirmation_target_mismatch");
    state.target = "fixture-service";

    const planPlan = await preflight(workspaceRoot, facade);
    state.effect = "changed authoritative effect";
    await expectCode(preflight(workspaceRoot, facade, "service_start", executionParameters(planPlan, "plan-key-0001")), "confirmation_plan_mismatch");
    state.effect = "apply manifest-owned lifecycle action";

    const phrasePlan = await preflight(workspaceRoot, facade);
    await expectCode(preflight(workspaceRoot, facade, "service_start", executionParameters(phrasePlan, "phrase-key-001", {
      confirmationPhrase: "confirm service-start incorrect",
    })), "confirmation_phrase_mismatch");

    const issuedAt = new Date("2026-08-29T00:00:00.000Z");
    const expiredPlan = await preflight(workspaceRoot, facade, "service_start", { confirmationTtlSeconds: 1 }, {
      now: () => issuedAt,
    });
    await expectCode(preflight(workspaceRoot, facade, "service_start", executionParameters(expiredPlan, "expiry-key-001"), {
      now: () => new Date(issuedAt.getTime() + 1_001),
    }), "confirmation_expired");

    const successPlan = await preflight(workspaceRoot, facade);
    const success = await preflight(workspaceRoot, facade, "service_start", executionParameters(successPlan, "success-key-001"), { authorization: admin });
    assert.equal(success.status, "succeeded");
    assert.equal(success.confirmation.status, "consumed");
    await expectCode(preflight(workspaceRoot, facade, "service_start", executionParameters(successPlan, "reuse-key-0001"), { authorization: admin }), "confirmation_already_used");
    assert.equal(state.executeCount, 1);

    const audit = await readAuditEvents({ workspaceRoot });
    const deniedReasons = new Set(audit.events.filter((event) => event.action === "mcp.action.denied").map((event) => event.reason));
    for (const reason of [
      "confirmation_actor_mismatch",
      "confirmation_action_mismatch",
      "confirmation_parameter_mismatch",
      "confirmation_target_mismatch",
      "confirmation_plan_mismatch",
      "confirmation_phrase_mismatch",
      "confirmation_expired",
      "confirmation_already_used",
    ]) assert.equal(deniedReasons.has(reason), true, `missing denied Audit reason ${reason}`);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("#862 makes idempotency durable, exact, conflict-safe, and single-execution under concurrency", async () => {
  const { tempRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-mcp-idempotency-");
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { facade, state } = fixtureFacade({ beforeComplete: () => gate });
  const admin = authorization("administrator");

  try {
    const plan = await preflight(workspaceRoot, facade);
    const parameters = executionParameters(plan, "concurrent-key-01");
    const first = preflight(workspaceRoot, facade, "service_start", parameters, { authorization: admin });
    const second = preflight(workspaceRoot, facade, "service_start", parameters, { authorization: admin });
    const settledPromise = Promise.allSettled([first, second]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();
    const settled = await settledPromise;
    assert.equal(settled.filter((entry) => entry.status === "fulfilled").length, 1);
    assert.equal(settled.filter((entry) => entry.status === "rejected" && entry.reason?.code === "idempotency_in_progress").length, 1);
    assert.equal(state.executeCount, 1);

    const committed = settled.find((entry) => entry.status === "fulfilled").value;
    state.target = "different-live-target";
    state.effect = "different live effect";
    const replay = await preflight(workspaceRoot, facade, "service_start", parameters, { authorization: admin });
    assert.equal(replay.status, "replayed");
    assert.equal(replay.idempotency.replayed, true);
    assert.equal(replay.correlationId, committed.correlationId);
    assert.deepEqual(replay.result, committed.result);
    assert.equal(state.executeCount, 1);

    await assert.rejects(
      preflight(workspaceRoot, facade, "service_start", { ...parameters, serviceId: "other-service" }, { authorization: admin }),
      (error) => error?.code === "idempotency_conflict",
    );

    const record = await readPrivateJson(
      workspaceRoot,
      guardedActionIdempotencyPath(workspaceRoot, admin.actor.actorId, admin.actor.clientId, parameters.idempotencyKey),
    );
    assert.equal(record.status, "succeeded");
    assert.deepEqual(record.response, committed);
    assert.equal(record.key, undefined);
    assert.match(record.keyId, /^mcp-idempotency-[0-9a-f]{32}$/u);
    assert.equal(JSON.stringify(record).includes(parameters.idempotencyKey), false);
    assert.equal(JSON.stringify(record).includes(parameters.confirmationPhrase), false);

    const audit = await readAuditEvents({ workspaceRoot });
    assert.equal(audit.events.some((event) =>
      event.action === "mcp.action.started" &&
      event.actor === admin.actor.actorId &&
      event.metadata?.clientId === admin.actor.clientId
    ), true);
    assert.equal(audit.events.some((event) =>
      event.action === "mcp.action.succeeded" &&
      event.correlationId === committed.correlationId
    ), true);
    assert.equal(audit.events.some((event) => event.action === "mcp.action.replayed"), true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("#862 claims one durable execution across independent runtime processes", async () => {
  const { tempRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-mcp-process-race-");
  const { facade } = fixtureFacade();
  const markerPath = path.join(tempRoot, "mutation-marker.txt");
  try {
    const plan = await preflight(workspaceRoot, facade);
    const parameters = executionParameters(plan, "process-race-key-01");
    const settled = await Promise.all([
      runRaceChild({ workspaceRoot, markerPath, parameters }),
      runRaceChild({ workspaceRoot, markerPath, parameters }),
    ]);
    assert.equal(settled.filter((entry) => entry.status === "fulfilled").length, 1);
    assert.equal(settled.filter((entry) => entry.status === "rejected" && entry.code === "idempotency_in_progress").length, 1);
    const markers = (await readFile(markerPath, "utf8")).trim().split(/\r?\n/u);
    assert.equal(markers.length, 1);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("#862 atomically recovers orphaned primary and recovery locks across two independent waiters", async () => {
  const { tempRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-mcp-orphan-race-");
  const { facade } = fixtureFacade();
  const markerPath = path.join(tempRoot, "mutation-marker.txt");
  try {
    const plan = await preflight(workspaceRoot, facade);
    const parameters = executionParameters(plan, "orphan-race-key-01");
    const lockPath = `${guardedActionStatePath(workspaceRoot)}.lock`;
    await writeFile(lockPath, JSON.stringify({
      pid: 2_147_483_647,
      nonce: "orphaned-lock-nonce",
      createdAt: "2000-01-01T00:00:00.000Z",
    }), { mode: 0o600 });
    await writeFile(`${lockPath}.recovery`, JSON.stringify({
      pid: 2_147_483_647,
      nonce: "orphaned-recovery-nonce",
      createdAt: "2000-01-01T00:00:00.000Z",
    }), { mode: 0o600 });
    const stale = new Date(Date.now() - 120_000);
    await utimes(lockPath, stale, stale);
    await utimes(`${lockPath}.recovery`, stale, stale);

    const settled = await Promise.all([
      runRaceChild({ workspaceRoot, markerPath, parameters }),
      runRaceChild({ workspaceRoot, markerPath, parameters }),
    ]);
    assert.equal(settled.filter((entry) => entry.status === "fulfilled").length, 1);
    assert.equal(settled.filter((entry) => entry.status === "rejected" && entry.code === "idempotency_in_progress").length, 1);
    const markers = (await readFile(markerPath, "utf8")).trim().split(/\r?\n/u);
    assert.equal(markers.length, 1);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("#862 records safe terminal failures and preflight skips without repeating mutation", async () => {
  const { tempRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-mcp-terminal-");
  const failing = fixtureFacade({ throwOnExecute: true });
  const skipped = fixtureFacade({ executable: false });

  try {
    const plan = await preflight(workspaceRoot, failing.facade);
    const parameters = executionParameters(plan, "failure-key-0001");
    const failed = await preflight(workspaceRoot, failing.facade, "service_start", parameters);
    assert.equal(failed.status, "failed");
    assert.equal(failed.ok, false);
    assert.equal(failed.summary, "The guarded action failed safely.");
    assert.deepEqual(failed.result.resultingState, [{
      serviceId: "fixture-service",
      installed: true,
      configured: true,
      running: false,
    }]);
    const replay = await preflight(workspaceRoot, failing.facade, "service_start", parameters);
    assert.equal(replay.status, "replayed");
    assert.equal(replay.idempotency.replayed, true);
    assert.equal(replay.correlationId, failed.correlationId);
    assert.equal(failing.state.executeCount, 1);

    const skippedResult = await preflight(workspaceRoot, skipped.facade, "service_start", {
      execute: true,
      idempotencyKey: "skipped-key-0001",
    });
    assert.equal(skippedResult.status, "skipped");
    assert.equal(skippedResult.confirmation.status, "not_required");
    assert.equal(skipped.state.executeCount, 0);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("#862 durably reconciles a terminal Audit outage without repeating mutation", async () => {
  const { tempRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-mcp-audit-reconcile-");
  const auditFile = path.join(workspaceRoot, ".service-lasso", "audit", "runtime", `${new Date().toISOString().slice(0, 10)}.jsonl`);
  const auditBackup = `${auditFile}.fixture-backup`;
  const guarded = fixtureFacade({
    beforeComplete: async () => {
      await rename(auditFile, auditBackup);
      await mkdir(auditFile);
    },
  });
  try {
    const plan = await preflight(workspaceRoot, guarded.facade);
    const parameters = executionParameters(plan, "audit-reconcile-key-01");
    await assert.rejects(
      preflight(workspaceRoot, guarded.facade, "service_start", parameters),
      (error) => error?.code === "mcp_audit_unavailable",
    );
    assert.equal(guarded.state.executeCount, 1);
    const pending = await readPrivateJson(
      workspaceRoot,
      guardedActionIdempotencyPath(workspaceRoot, "mcp-action-actor", "mcp-action-client", parameters.idempotencyKey),
    );
    assert.equal(pending.status, "in_progress");
    assert.equal(pending.response, null);
    assert.equal(pending.pendingResponse.status, "succeeded");

    await rm(auditFile, { recursive: true, force: true });
    await rename(auditBackup, auditFile);
    const replay = await preflight(workspaceRoot, guarded.facade, "service_start", parameters);
    assert.equal(replay.status, "replayed");
    assert.equal(replay.idempotency.replayed, true);
    assert.equal(guarded.state.executeCount, 1);
    const audit = await readAuditEvents({ workspaceRoot });
    assert.equal(audit.events.filter((event) =>
      event.action === "mcp.action.succeeded" && event.correlationId === replay.correlationId
    ).length, 1);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("#862 denies wrong modes, profiles, and scopes before mutation with stable Audit outcomes", async () => {
  const { tempRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-mcp-denials-");
  const { facade, state } = fixtureFacade();
  try {
    await assert.rejects(
      preflight(workspaceRoot, facade, "service_start", {}, { operatingMode: "read-only" }),
      (error) => error?.code === "mcp_read_only_mode",
    );
    await assert.rejects(
      preflight(workspaceRoot, facade, "service_start", {}, {
        authorization: authorization("observer", { scopes: ["service-lasso:read", "service-lasso:lifecycle:write"] }),
      }),
      (error) => error?.code === "insufficient_profile",
    );
    await assert.rejects(
      preflight(workspaceRoot, facade, "service_start", {}, {
        authorization: authorization("operator", { scopes: ["service-lasso:read"] }),
      }),
      (error) => error?.code === "insufficient_scope",
    );
    const plan = await preflight(workspaceRoot, facade);
    await assert.rejects(
      preflight(workspaceRoot, facade, "service_start", executionParameters(plan, "ghp_secretlookingkey")),
      (error) => error?.code === "invalid_idempotency_key",
    );
    await assert.rejects(
      preflight(workspaceRoot, facade, "service_start", executionParameters(plan, "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJvcGVyYXRvciJ9.signaturevalue")),
      (error) => error?.code === "invalid_idempotency_key",
    );
    await assert.rejects(
      preflight(workspaceRoot, facade, "service_start", executionParameters(plan, "AKIAIOSFODNN7EXAMPLE")),
      (error) => error?.code === "invalid_idempotency_key",
    );
    assert.equal(state.executeCount, 0);
    const audit = await readAuditEvents({ workspaceRoot });
    assert.deepEqual(
      new Set(audit.events.filter((event) => event.action === "mcp.action.denied").map((event) => event.reason)),
      new Set(["mcp_read_only_mode", "insufficient_profile", "insufficient_scope", "invalid_idempotency_key"]),
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("#862 redacts secrets and paths from plans, results, durable state, and Audit", async () => {
  const { tempRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-mcp-redaction-action-");
  const secret = "token=mcp-action-sensitive-marker";
  const windowsPath = "C:\\private\\service-lasso\\config.json";
  const posixPath = "/opt/service-lasso/private/config.json";
  const { facade } = fixtureFacade({
    effect: `read ${windowsPath}`,
    extraEffects: [`read ${posixPath}`, `use ${secret}`],
    summary: `completed at ${tempRoot}`,
  });
  const admin = authorization("administrator");
  try {
    const plan = await preflight(workspaceRoot, facade);
    const serializedPlan = JSON.stringify(plan);
    assert.equal(serializedPlan.includes(secret), false);
    assert.equal(serializedPlan.includes(windowsPath), false);
    assert.equal(serializedPlan.includes(posixPath), false);
    assert.equal(serializedPlan.includes(tempRoot), false);

    const parameters = executionParameters(plan, "redaction-key-01");
    const result = await preflight(workspaceRoot, facade, "service_start", parameters);
    const persistedConfirmation = await readPrivateJson(workspaceRoot, guardedActionStatePath(workspaceRoot));
    const persistedResult = await readPrivateJson(
      workspaceRoot,
      guardedActionIdempotencyPath(workspaceRoot, admin.actor.actorId, admin.actor.clientId, parameters.idempotencyKey),
    );
    const audit = await readAuditEvents({ workspaceRoot });
    const serialized = JSON.stringify({ result, persistedConfirmation, persistedResult, audit });
    assert.equal(serialized.includes(secret), false);
    assert.equal(serialized.includes(windowsPath), false);
    assert.equal(serialized.includes(posixPath), false);
    assert.equal(serialized.includes(tempRoot), false);
    assert.equal(serialized.includes(parameters.confirmationPhrase), false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("#862 advertises only explicit strict guarded tools and executes them through the injected facade", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-mcp-tool-contract-");
  const guarded = fixtureFacade();
  const context = {
    version: "mcp-guarded-test",
    servicesRoot,
    workspaceRoot,
    discovered: [],
    registry: { list: () => [], getById: () => undefined },
    graph: { getDependencies: () => [], getDependents: () => [], topologicalSort: () => [] },
    sharedGlobalEnv: {},
    guardedActionFacade: guarded.facade,
    mcpOperatingMode: "guarded",
  };
  const admin = authorization("administrator");
  const capabilities = getServiceLassoMcpCapabilities(context, { operatingMode: "guarded" });
  const guardedDefinitions = capabilities.tools.filter((tool) => tool.annotations.readOnlyHint === false);
  assert.equal(guardedDefinitions.length, 12);
  assert.equal(guardedDefinitions.every((tool) => tool.inputSchema.additionalProperties === false), true);
  assert.equal(guardedDefinitions.every((tool) => tool.outputSchema.additionalProperties === false), true);
  assert.equal(guardedDefinitions.find((tool) => tool.name === "service_lasso_run_setup_step").inputSchema.required.includes("stepId"), true);
  assert.equal(guardedDefinitions.some((tool) => /shell|command|environment|raw/i.test(Object.keys(tool.inputSchema.properties).join(" "))), false);
  assert.equal(getServiceLassoMcpCapabilities(context, { operatingMode: "read-only" }).tools.length, 15);
  const unavailable = getServiceLassoMcpCapabilities({ ...context, guardedActionFacade: undefined }, { operatingMode: "guarded" });
  assert.equal(unavailable.policy.guardedToolsAvailable, false);
  assert.equal(unavailable.tools.length, 15);

  const server = createServiceLassoMcpServer(context, { authorization: admin, operatingMode: "guarded" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "mcp-guarded-contract-test", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const advertised = await client.listTools();
    assert.equal(advertised.tools.length, 27);
    assert.equal(advertised.tools.filter((tool) => tool.annotations?.readOnlyHint === false).length, 12);
    const planResult = await client.callTool({
      name: "service_lasso_start_service",
      arguments: { serviceId: "fixture-service" },
    });
    assert.equal(planResult.isError, undefined);
    const plan = planResult.structuredContent;
    assert.equal(plan.status, "preflight");

    const invalid = await client.callTool({
      name: "service_lasso_start_service",
      arguments: { serviceId: "fixture-service", command: "whoami" },
    });
    assert.equal(invalid.isError, true);
    const deniedAudit = await readAuditEvents({ workspaceRoot });
    assert.equal(deniedAudit.events.some((event) =>
      event.action === "mcp.action.denied" &&
      event.subject === "service_start" &&
      event.reason === "invalid_request"
    ), true);
    assert.equal(JSON.stringify(deniedAudit).includes("whoami"), false);

    const completed = await client.callTool({
      name: "service_lasso_start_service",
      arguments: executionParameters(plan, "tool-call-key-01"),
    });
    assert.equal(completed.isError, undefined);
    assert.equal(completed.structuredContent.status, "succeeded");
    assert.equal(completed.structuredContent.result.resultingState[0].running, true);
    assert.equal(guarded.state.executeCount, 1);
  } finally {
    await client.close();
    await server.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("#862 HTTP guarded lifecycle actions use the active runtime dependency and orchestration facade", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-mcp-live-action-");
  let apiServer;
  let releaseServer;
  try {
    const { serviceRoot: alphaRoot, scriptPath: alphaScriptPath } = await writeExecutableFixtureService(servicesRoot, "alpha-service", {
      config: { templates: [{ source: "templates/config.txt", target: "runtime/generated-config.txt" }] },
      setup: {
        steps: {
          "guarded-step": {
            executable: "node",
            args: ["runtime/setup-guard.mjs", "runtime/setup-guard.marker"],
            rerun: "manual",
            timeoutSeconds: 10,
          },
        },
      },
      actions: {
        stop: {
          commandline: { default: "node runtime/stop-guard.mjs" },
          timeoutSeconds: 1,
        },
      },
      doctor: {
        enabled: true,
        steps: [{
          name: "guarded-doctor",
          command: "node",
          args: ["runtime/doctor-guard.mjs"],
          timeoutSeconds: 10,
        }],
      },
    });
    await mkdir(path.join(alphaRoot, "templates"), { recursive: true });
    await writeFile(path.join(alphaRoot, "templates", "config.txt"), "confirmed config template\n", "utf8");
    const setupScriptPath = path.join(alphaRoot, "runtime", "setup-guard.mjs");
    const setupMarkerPath = path.join(alphaRoot, "runtime", "setup-guard.marker");
    const confirmedSetupScript = [
      'import { writeFile } from "node:fs/promises";',
      'await writeFile(process.argv[2], "guarded setup completed\\n", "utf8");',
    ].join("\n");
    await writeFile(setupScriptPath, confirmedSetupScript, "utf8");
    const stopScriptPath = path.join(alphaRoot, "runtime", "stop-guard.mjs");
    const confirmedStopScript = 'process.stdout.write("guarded stop override\\n");\n';
    await writeFile(stopScriptPath, confirmedStopScript, "utf8");
    const doctorScriptPath = path.join(alphaRoot, "runtime", "doctor-guard.mjs");
    const confirmedDoctorScript = 'process.stdout.write("guarded doctor ok\\n");\n';
    await writeFile(doctorScriptPath, confirmedDoctorScript, "utf8");
    await writeExecutableFixtureService(servicesRoot, "bravo-service", { depend_on: ["alpha-service"] });
    releaseServer = await startMutableUpdateReleaseServer();
    await writeManifest(servicesRoot, "update-service", {
      id: "update-service",
      name: "Guarded update fixture",
      description: "Release-backed guarded update fixture.",
      version: "2026.8.01-old",
      artifact: {
        kind: "archive",
        source: {
          type: "github-release",
          repo: "service-lasso/update-service",
          tag: "2026.8.01-old",
          api_base_url: releaseServer.baseUrl,
        },
        platforms: {
          default: {
            assetName: "update-service.zip",
            archiveType: "zip",
            command: "node",
            args: ["runtime/update-service.mjs"],
          },
        },
      },
      updates: {
        mode: "install",
        track: "latest",
        installWindow: { start: "00:00", end: "00:00", timezone: "UTC" },
        runningService: "stop-start",
      },
      actions: {
        stop: {
          commandline: { default: "node runtime/update-stop.mjs" },
          timeoutSeconds: 5,
        },
      },
      hooks: {
        preUpgrade: [{ name: "guarded-pre-upgrade", command: "node", args: ["runtime/update-hook.mjs", "pre"] }],
        postUpgrade: [{ name: "guarded-post-upgrade", command: "node", args: ["runtime/update-hook.mjs", "post"] }],
        rollback: [{ name: "guarded-rollback", command: "node", args: ["runtime/update-hook.mjs", "rollback"] }],
        onFailure: [{ name: "guarded-failure", command: "node", args: ["runtime/update-hook.mjs", "failure"] }],
      },
    });
    const updateHookPath = path.join(servicesRoot, "update-service", "runtime", "update-hook.mjs");
    const confirmedUpdateHook = 'process.stdout.write(`update hook ${process.argv[2]}\\n`);\n';
    await mkdir(path.dirname(updateHookPath), { recursive: true });
    await writeFile(updateHookPath, confirmedUpdateHook, "utf8");
    await writeFile(
      path.join(servicesRoot, "update-service", "runtime", "update-stop.mjs"),
      'process.stdout.write("guarded update stop override\\n");\n',
      "utf8",
    );
    apiServer = await startApiServer({
      port: 0,
      servicesRoot,
      workspaceRoot,
      mcpHttpIdentity: { env: { SERVICE_LASSO_MCP_MODE: "guarded" } },
    });

    const startPlanRpc = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: "start-plan",
      method: "tools/call",
      params: { name: "service_lasso_start_service", arguments: { serviceId: "bravo-service" } },
    });
    assert.equal(startPlanRpc.status, 200);
    const changedExecutablePlan = startPlanRpc.body.result.structuredContent;
    const confirmedAlphaScript = await readFile(alphaScriptPath, "utf8");
    await writeFile(alphaScriptPath, `${confirmedAlphaScript}\n// changed after guarded preflight\n`, "utf8");
    const changedExecutable = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: "start-changed-executable",
      method: "tools/call",
      params: {
        name: "service_lasso_start_service",
        arguments: executionParameters(changedExecutablePlan, "live-start-changed-key-01", { serviceId: "bravo-service" }),
      },
    });
    assert.equal(changedExecutable.body.result.isError, true);
    assert.equal(getLifecycleState("alpha-service").running, false);
    assert.equal(getLifecycleState("bravo-service").running, false);
    await writeFile(alphaScriptPath, confirmedAlphaScript, "utf8");

    const currentStartPlanRpc = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: "start-plan-current",
      method: "tools/call",
      params: { name: "service_lasso_start_service", arguments: { serviceId: "bravo-service" } },
    });
    const startPlan = currentStartPlanRpc.body.result.structuredContent;
    assert.deepEqual(startPlan.preflight.targets, ["alpha-service", "bravo-service"]);

    const startRpc = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: "start-execute",
      method: "tools/call",
      params: {
        name: "service_lasso_start_service",
        arguments: executionParameters(startPlan, "live-start-key-01", { serviceId: "bravo-service" }),
      },
    });
    assert.equal(startRpc.status, 200);
    assert.equal(startRpc.body.result.structuredContent.status, "succeeded");
    assert.deepEqual(
      startRpc.body.result.structuredContent.result.resultingState.map((entry) => [entry.serviceId, entry.running]),
      [["alpha-service", true], ["bravo-service", true]],
    );
    assert.equal(getLifecycleState("alpha-service").running, true);
    assert.equal(getLifecycleState("bravo-service").running, true);

    const configPlanRpc = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: "config-plan",
      method: "tools/call",
      params: { name: "service_lasso_configure_service", arguments: { serviceId: "alpha-service" } },
    });
    const configPlan = configPlanRpc.body.result.structuredContent;
    assert.equal(configPlan.preflight.executable, true);
    await writeFile(path.join(alphaRoot, "templates", "config.txt"), "changed after confirmation\n", "utf8");
    const changedDefinition = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: "config-changed",
      method: "tools/call",
      params: {
        name: "service_lasso_configure_service",
        arguments: executionParameters(configPlan, "config-changed-key-01", { serviceId: "alpha-service" }),
      },
    });
    await assertDurableRpcOutcome(apiServer, changedDefinition, "failed");
    assert.equal(await readFile(path.join(alphaRoot, "runtime", "generated-config.txt"), "utf8"), "confirmed config template\n");

    const setupPlanRpc = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: "setup-plan",
      method: "tools/call",
      params: {
        name: "service_lasso_run_setup_step",
        arguments: { serviceId: "alpha-service", stepId: "guarded-step" },
      },
    });
    const changedSetupPlan = setupPlanRpc.body.result.structuredContent;
    assert.equal(changedSetupPlan.preflight.executable, true);
    await writeFile(setupScriptPath, `${confirmedSetupScript}\n// changed after guarded preflight\n`, "utf8");
    const changedSetup = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: "setup-changed",
      method: "tools/call",
      params: {
        name: "service_lasso_run_setup_step",
        arguments: executionParameters(changedSetupPlan, "setup-changed-key-01", {
          serviceId: "alpha-service",
          stepId: "guarded-step",
        }),
      },
    });
    await assertDurableRpcOutcome(apiServer, changedSetup, "failed");
    await assert.rejects(stat(setupMarkerPath), (error) => error?.code === "ENOENT");
    await writeFile(setupScriptPath, confirmedSetupScript, "utf8");

    const currentSetupPlanRpc = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: "setup-plan-current",
      method: "tools/call",
      params: {
        name: "service_lasso_run_setup_step",
        arguments: { serviceId: "alpha-service", stepId: "guarded-step" },
      },
    });
    const currentSetupPlan = currentSetupPlanRpc.body.result.structuredContent;
    const setupCompleted = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: "setup-execute",
      method: "tools/call",
      params: {
        name: "service_lasso_run_setup_step",
        arguments: executionParameters(currentSetupPlan, "setup-current-key-01", {
          serviceId: "alpha-service",
          stepId: "guarded-step",
        }),
      },
    });
    await assertDurableRpcOutcome(apiServer, setupCompleted, "succeeded");
    assert.equal(await readFile(setupMarkerPath, "utf8"), "guarded setup completed\n");

    const restartPlanRpc = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: "restart-plan",
      method: "tools/call",
      params: { name: "service_lasso_restart_service", arguments: { serviceId: "alpha-service" } },
    });
    const changedDoctorPlan = restartPlanRpc.body.result.structuredContent;
    await writeFile(doctorScriptPath, `${confirmedDoctorScript}// changed after guarded preflight\n`, "utf8");
    const changedDoctor = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: "restart-changed-doctor",
      method: "tools/call",
      params: {
        name: "service_lasso_restart_service",
        arguments: executionParameters(changedDoctorPlan, "restart-doctor-key-01", { serviceId: "alpha-service" }),
      },
    });
    assert.equal(changedDoctor.body.result.isError, true);
    assert.equal(getLifecycleState("alpha-service").running, true);
    await writeFile(doctorScriptPath, confirmedDoctorScript, "utf8");

    const stopPlanRpc = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: "stop-plan",
      method: "tools/call",
      params: { name: "service_lasso_stop_all", arguments: {} },
    });
    const changedStopPlan = stopPlanRpc.body.result.structuredContent;
    assert.deepEqual(changedStopPlan.preflight.targets, ["bravo-service", "alpha-service"]);
    assert.equal(changedStopPlan.preflight.effects.some((effect) => effect.includes("stop override")), true);
    await writeFile(stopScriptPath, `${confirmedStopScript}// changed after guarded preflight\n`, "utf8");
    const changedStop = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: "stop-changed-override",
      method: "tools/call",
      params: {
        name: "service_lasso_stop_all",
        arguments: executionParameters(changedStopPlan, "stop-changed-key-01"),
      },
    });
    await assertDurableRpcOutcome(apiServer, changedStop, "failed");
    assert.equal(getLifecycleState("alpha-service").running, true);
    assert.equal(getLifecycleState("bravo-service").running, true);
    await writeFile(stopScriptPath, confirmedStopScript, "utf8");
    const currentStopPlanRpc = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: "stop-plan-current",
      method: "tools/call",
      params: { name: "service_lasso_stop_all", arguments: {} },
    });
    const stopPlan = currentStopPlanRpc.body.result.structuredContent;
    const stopRpc = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: "stop-execute",
      method: "tools/call",
      params: {
        name: "service_lasso_stop_all",
        arguments: {
          execute: true,
          idempotencyKey: "live-stop-key-001",
          confirmationId: stopPlan.confirmation.id,
          confirmationPhrase: stopPlan.confirmation.confirmationPhrase,
        },
      },
    });
    assert.equal(stopRpc.status, 200);
    await assertDurableRpcOutcome(apiServer, stopRpc, "succeeded");
    assert.equal(getLifecycleState("alpha-service").running, false);
    assert.equal(getLifecycleState("bravo-service").running, false);

    const updatePlanRpc = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: "update-plan-a",
      method: "tools/call",
      params: { name: "service_lasso_download_update", arguments: { serviceId: "update-service" } },
    });
    const updatePlan = updatePlanRpc.body.result.structuredContent;
    assert.equal(updatePlan.preflight.executable, true);
    releaseServer.setTag("2026.8.29-b");
    const changedCandidate = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: "update-changed",
      method: "tools/call",
      params: {
        name: "service_lasso_download_update",
        arguments: executionParameters(updatePlan, "update-changed-key-01", { serviceId: "update-service" }),
      },
    });
    await assertDurableRpcOutcome(apiServer, changedCandidate, "failed");
    assert.equal(releaseServer.getDownloads(), 0);

    const updatePlanBRpc = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: "update-plan-b",
      method: "tools/call",
      params: { name: "service_lasso_download_update", arguments: { serviceId: "update-service" } },
    });
    const updatePlanB = updatePlanBRpc.body.result.structuredContent;
    const confirmedDownloadContent = "guarded update download fixture changed under the same tag";
    releaseServer.setContent(confirmedDownloadContent);
    const changedAsset = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: "update-asset-changed",
      method: "tools/call",
      params: {
        name: "service_lasso_download_update",
        arguments: executionParameters(updatePlanB, "update-asset-changed-key-01", { serviceId: "update-service" }),
      },
    });
    await assertDurableRpcOutcome(apiServer, changedAsset, "failed");
    assert.equal(releaseServer.getDownloads(), 0);

    releaseServer.setIncludeDigest(false);
    const digestlessPlanRpc = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: "update-plan-digestless",
      method: "tools/call",
      params: { name: "service_lasso_download_update", arguments: { serviceId: "update-service" } },
    });
    assert.equal(digestlessPlanRpc.body.result.structuredContent.preflight.executable, false);
    assert.equal(digestlessPlanRpc.body.result.structuredContent.preflight.skippedReason, "update_candidate_exact_digest_unavailable");
    releaseServer.setIncludeDigest(true);

    const updatePlanCRpc = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: "update-plan-c",
      method: "tools/call",
      params: { name: "service_lasso_download_update", arguments: { serviceId: "update-service" } },
    });
    const updatePlanC = updatePlanCRpc.body.result.structuredContent;
    const updatePaths = getServiceStatePaths(path.join(servicesRoot, "update-service"));
    const candidatePath = path.join(updatePaths.updateCandidates, "2026.8.29-b", "update-service.zip");
    releaseServer.replaceNextDownloadContent("x".repeat(Buffer.byteLength(confirmedDownloadContent)));
    const replacedDuringDownload = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: "update-download-replaced",
      method: "tools/call",
      params: {
        name: "service_lasso_download_update",
        arguments: executionParameters(updatePlanC, "update-download-replaced-key-01", { serviceId: "update-service" }),
      },
    });
    await assertDurableRpcOutcome(apiServer, replacedDuringDownload, "failed");
    assert.equal(releaseServer.getDownloads(), 1);
    await assert.rejects(stat(candidatePath), (error) => error?.code === "ENOENT");

    const updatePlanDRpc = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: "update-plan-d",
      method: "tools/call",
      params: { name: "service_lasso_download_update", arguments: { serviceId: "update-service" } },
    });
    const updatePlanD = updatePlanDRpc.body.result.structuredContent;
    const downloaded = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: "update-download",
      method: "tools/call",
      params: {
        name: "service_lasso_download_update",
        arguments: executionParameters(updatePlanD, "update-download-key-01", { serviceId: "update-service" }),
      },
    });
    await assertDurableRpcOutcome(apiServer, downloaded, "succeeded");
    assert.equal(releaseServer.getDownloads(), 2);

    const updateServiceState = getLifecycleState("update-service");
    const previousExtractedPath = path.join(updatePaths.extracted, "previous");
    await mkdir(path.join(previousExtractedPath, "runtime"), { recursive: true });
    await writeFile(
      path.join(previousExtractedPath, "runtime", "update-service.mjs"),
      'process.stdout.write("previous guarded update started\\n"); setInterval(() => {}, 1000);\n',
      "utf8",
    );
    setLifecycleState("update-service", {
      ...updateServiceState,
      installed: true,
      configured: true,
      running: true,
      installArtifacts: {
        ...updateServiceState.installArtifacts,
        artifact: {
          sourceType: "github-release",
          repo: "service-lasso/update-service",
          channel: null,
          tag: "2026.8.01-old",
          assetName: "update-service.zip",
          assetUrl: null,
          archiveType: "zip",
          archivePath: null,
          extractedPath: previousExtractedPath,
          command: "node",
          args: ["runtime/update-service.mjs"],
          checksum: null,
        },
      },
    });
    const installPlanRpc = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: "install-plan",
      method: "tools/call",
      params: { name: "service_lasso_install_update", arguments: { serviceId: "update-service" } },
    });
    const changedHookPlan = installPlanRpc.body.result.structuredContent;
    assert.equal(changedHookPlan.preflight.executable, true);
    assert.equal(changedHookPlan.preflight.effects.some((effect) => effect.startsWith("verify downloaded artifact sha256 ")), true);
    assert.equal(changedHookPlan.preflight.effects.includes("run manifest-owned stop override for update-service"), true);
    assert.equal(changedHookPlan.preflight.effects.includes("run 1 manifest-owned preUpgrade hook step for update-service"), true);
    assert.equal(changedHookPlan.preflight.effects.includes("run 1 manifest-owned postUpgrade hook step for update-service"), true);
    assert.equal(changedHookPlan.preflight.effects.includes("may run 1 manifest-owned rollback hook step for update-service after an install failure"), true);
    assert.equal(changedHookPlan.preflight.effects.includes("may run 1 manifest-owned onFailure hook step for update-service after an install failure"), true);
    const forcedInstallPlanRpc = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: "forced-install-plan",
      method: "tools/call",
      params: { name: "service_lasso_install_update", arguments: { serviceId: "update-service", force: true } },
    });
    assert.equal(
      forcedInstallPlanRpc.body.result.structuredContent.preflight.effects.includes("run manifest-owned stop override for update-service"),
      false,
    );
    await writeFile(updateHookPath, `${confirmedUpdateHook}// changed after guarded preflight\n`, "utf8");
    const changedHookInstall = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: "install-changed-hook",
      method: "tools/call",
      params: {
        name: "service_lasso_install_update",
        arguments: executionParameters(changedHookPlan, "install-hook-changed-key-01", { serviceId: "update-service" }),
      },
    });
    await assertDurableRpcOutcome(apiServer, changedHookInstall, "failed");
    assert.equal(getLifecycleState("update-service").running, true);
    await writeFile(updateHookPath, confirmedUpdateHook, "utf8");

    const currentInstallPlanRpc = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: "install-plan-current",
      method: "tools/call",
      params: { name: "service_lasso_install_update", arguments: { serviceId: "update-service" } },
    });
    const installPlan = currentInstallPlanRpc.body.result.structuredContent;

    await writeFile(candidatePath, "candidate altered after guarded confirmation", "utf8");
    const changedInstall = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: "install-changed",
      method: "tools/call",
      params: {
        name: "service_lasso_install_update",
        arguments: executionParameters(installPlan, "install-changed-key-01", { serviceId: "update-service" }),
      },
    });
    await assertDurableRpcOutcome(apiServer, changedInstall, "failed");
    assert.equal(getLifecycleState("update-service").running, true);
    await assert.rejects(stat(path.join(updatePaths.extracted, "current")), (error) => error?.code === "ENOENT");

    const verifiedUpdateZip = new AdmZip();
    verifiedUpdateZip.addFile(
      "runtime/update-service.mjs",
      Buffer.from('process.stdout.write("guarded update started\\n"); setInterval(() => {}, 1000);\n', "utf8"),
    );
    releaseServer.setContent(verifiedUpdateZip.toBuffer());
    const verifiedDownloadPlanRpc = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: "verified-update-download-plan",
      method: "tools/call",
      params: { name: "service_lasso_download_update", arguments: { serviceId: "update-service" } },
    });
    const verifiedDownloadPlan = verifiedDownloadPlanRpc.body.result.structuredContent;
    const verifiedDownload = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: "verified-update-download",
      method: "tools/call",
      params: {
        name: "service_lasso_download_update",
        arguments: executionParameters(verifiedDownloadPlan, "verified-download-key-01", { serviceId: "update-service" }),
      },
    });
    await assertDurableRpcOutcome(apiServer, verifiedDownload, "succeeded");
    const archiveMutationHook = [
      'import { readdir, writeFile } from "node:fs/promises";',
      'const directory = new URL("../.state/update-candidates/.verified/", import.meta.url);',
      'for (const entry of await readdir(directory)) await writeFile(new URL(entry, directory), "altered after pre-upgrade hook");',
    ].join("\n");
    await writeFile(updateHookPath, archiveMutationHook, "utf8");
    const immutableInstallPlanRpc = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: "immutable-update-install-plan",
      method: "tools/call",
      params: { name: "service_lasso_install_update", arguments: { serviceId: "update-service" } },
    });
    const immutableInstallPlan = immutableInstallPlanRpc.body.result.structuredContent;
    const immutableInstall = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: "immutable-update-install",
      method: "tools/call",
      params: {
        name: "service_lasso_install_update",
        arguments: executionParameters(immutableInstallPlan, "immutable-install-key-01", { serviceId: "update-service" }),
      },
    });
    await assertDurableRpcOutcome(apiServer, immutableInstall, "failed");
    await assert.rejects(stat(path.join(updatePaths.extracted, "current")), (error) => error?.code === "ENOENT");
    await writeFile(updateHookPath, confirmedUpdateHook, "utf8");
    setLifecycleState("update-service", {
      ...getLifecycleState("update-service"),
      running: true,
    });
    const verifiedInstallPlanRpc = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: "verified-update-install-plan",
      method: "tools/call",
      params: { name: "service_lasso_install_update", arguments: { serviceId: "update-service" } },
    });
    const verifiedInstallPlan = verifiedInstallPlanRpc.body.result.structuredContent;
    const verifiedInstall = await rpc(apiServer, {
      jsonrpc: "2.0",
      id: "verified-update-install",
      method: "tools/call",
      params: {
        name: "service_lasso_install_update",
        arguments: executionParameters(verifiedInstallPlan, "verified-install-key-01", { serviceId: "update-service" }),
      },
    });
    await assertDurableRpcOutcome(apiServer, verifiedInstall, "succeeded");
    assert.equal(getLifecycleState("update-service").running, true);
  } finally {
    if (apiServer) {
      await fetch(`${apiServer.url}/api/runtime/actions/stopAll`, { method: "POST" }).catch(() => undefined);
    }
    await apiServer?.stop();
    await releaseServer?.close();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
