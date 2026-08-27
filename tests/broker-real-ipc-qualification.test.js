import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import {
  listSecretsBrokerManagementRoutes,
  requestSecretsBrokerManagement,
} from "../dist/runtime/broker/client.js";
import { BROKER_IDENTITY_LEASE_ENV, issueScopedBrokerIdentity } from "../dist/runtime/broker/identity.js";
import {
  bootstrapSecretsBrokerVault,
  loadSecretsBrokerRuntimeContext,
  readSecretsBrokerRuntimeCredentials,
} from "../dist/runtime/broker/runtime.js";
import { getLifecycleState, resetLifecycleState, setLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { createServiceRegistry } from "../dist/runtime/manager/DependencyGraph.js";
import { writeManifest } from "./test-helpers.js";

const requireBrokerBinary = process.env.SERVICE_LASSO_REQUIRE_TEST_BROKER_BINARY === "1";
const brokerBinary = process.env.SERVICE_LASSO_TEST_BROKER_BINARY;
const brokerIpcEvidencePath = process.env.SERVICE_LASSO_BROKER_IPC_EVIDENCE_PATH;
const execFileAsync = promisify(execFile);

const expectedManagementResults = new Map([
  ["GET /v1/events", { statusCode: 200, outcome: "ready" }],
  ["GET /v1/management/lifecycle/backups", { statusCode: 200, outcome: "ready" }],
  ["GET /v1/management/lifecycle/status", { statusCode: 200, outcome: "ready" }],
  ["GET /v1/management/secrets", { statusCode: 200, outcome: "ready" }],
  ["GET /v1/management/secrets/value-search", { statusCode: 200, outcome: "ready" }],
  ["GET /v1/providers/capabilities", { statusCode: 200, outcome: "ready" }],
  ["GET /v1/providers/config/status", { statusCode: 200, outcome: "ready" }],
  ["GET /v1/telemetry", { statusCode: 200, outcome: "ready" }],
  ["POST /v1/management/lifecycle/backups", { statusCode: 400, outcome: "policy_denied" }],
  ["POST /v1/management/lifecycle/backups/verify", { statusCode: 400, outcome: "invalid_ref" }],
  ["POST /v1/management/lifecycle/key/rotate", { statusCode: 400, outcome: "policy_denied" }],
  ["POST /v1/management/lifecycle/restore/apply", { statusCode: 400, outcome: "conflict" }],
  ["POST /v1/management/lifecycle/restore/dry-run", { statusCode: 400, outcome: "invalid_ref" }],
  ["POST /v1/management/lockouts/clear", { statusCode: 200, outcome: "not_found" }],
  ["POST /v1/management/secrets/campaigns/apply", { statusCode: 403, outcome: "policy_denied" }],
  ["POST /v1/management/secrets/campaigns/create", { statusCode: 200, outcome: "dry_run_ready" }],
  ["POST /v1/management/secrets/campaigns/revalidate", { statusCode: 403, outcome: "stale_plan" }],
  ["POST /v1/management/secrets/campaigns/status", { statusCode: 503, outcome: "stale_plan" }],
  ["POST /v1/management/secrets/create/apply", { statusCode: 400, outcome: "policy_denied" }],
  ["POST /v1/management/secrets/create/dry-run", { statusCode: 409, outcome: "conflict" }],
  ["POST /v1/management/secrets/decommission/apply", { statusCode: 403, outcome: "policy_denied" }],
  ["POST /v1/management/secrets/decommission/dry-run", { statusCode: 409, outcome: "dependency_blocked" }],
  ["POST /v1/management/secrets/decommission/restore", { statusCode: 403, outcome: "policy_denied" }],
  ["POST /v1/management/secrets/edit/apply", { statusCode: 403, outcome: "policy_denied" }],
  ["POST /v1/management/secrets/edit/dry-run", { statusCode: 200, outcome: "dry_run_ready" }],
  ["POST /v1/management/secrets/policy/apply", { statusCode: 501, outcome: "unsupported" }],
  ["POST /v1/management/secrets/policy/preview", { statusCode: 200, outcome: "unsupported" }],
  ["POST /v1/management/secrets/reset/apply", { statusCode: 403, outcome: "policy_denied" }],
  ["POST /v1/management/secrets/reset/dry-run", { statusCode: 200, outcome: "dry_run_ready" }],
  ["POST /v1/management/secrets/reveal", { statusCode: 400, outcome: "invalid_ref" }],
  ["POST /v1/management/secrets/rotation/activate", { statusCode: 403, outcome: "policy_denied" }],
  ["POST /v1/management/secrets/rotation/dry-run", { statusCode: 200, outcome: "dry_run_ready" }],
  ["POST /v1/management/secrets/rotation/retire", { statusCode: 403, outcome: "policy_denied" }],
  ["POST /v1/management/secrets/rotation/rollback", { statusCode: 403, outcome: "policy_denied" }],
  ["POST /v1/management/secrets/rotation/stage", { statusCode: 403, outcome: "policy_denied" }],
  ["POST /v1/management/secrets/rotation/status", { statusCode: 200, outcome: "ready" }],
  ["POST /v1/management/secrets/sync/dry-run", { statusCode: 403, outcome: "policy_denied" }],
  ["POST /v1/providers/config/apply", { statusCode: 403, outcome: "policy_denied" }],
  ["POST /v1/providers/config/validate", { statusCode: 200, outcome: "ready" }],
  ["POST /v1/providers/migration/apply", { statusCode: 403, outcome: "policy_denied" }],
  ["POST /v1/providers/migration/dry-run", { statusCode: 200, outcome: "dry_run_ready" }],
]);

function routeKey(route) {
  return `${route.method} ${route.path}`;
}

function assertTypedManagementResponse(route, response, expected) {
  assert.ok(response.body && typeof response.body === "object" && !Array.isArray(response.body));
  assert.deepEqual(
    { statusCode: response.statusCode, outcome: response.body.outcome },
    expected,
    `${routeKey(route)} did not preserve its exact typed Broker contract.`,
  );
}

function assertNoBrokerPrivateMaterial(value, credentials, additionalSentinels = []) {
  const serialized = JSON.stringify(value);
  for (const [label, material] of [
    ["api token", credentials.apiToken],
    ["launch signing key", credentials.launchSigningKey],
    ["master key", credentials.masterKey],
    ["transport path", credentials.transport.socketPath],
    ["store path", credentials.storePath],
    ["audit path", credentials.auditPath],
    ["events path", credentials.eventsPath],
    ["wrapper path", credentials.wrapperPath],
    ...additionalSentinels.map((sentinel, index) => [`secret sentinel ${index + 1}`, sentinel]),
  ]) {
    if (typeof material !== "string" || material.length === 0) continue;
    const escapedMaterial = JSON.stringify(material).slice(1, -1);
    assert.equal(serialized.includes(escapedMaterial), false, `Public evidence contained Broker private material (${label}).`);
  }
}

const forbiddenSecretBearingFieldNames = new Set([
  "value",
  "rawvalue",
  "secret",
  "secretvalue",
  "rawsecret",
  "credential",
  "credentialvalue",
  "rawcredential",
  "payload",
  "rawpayload",
]);

function assertNoSecretBearingFields(value, fieldPath = "response") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecretBearingFields(entry, `${fieldPath}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/gu, "");
    assert.equal(
      forbiddenSecretBearingFieldNames.has(normalizedKey),
      false,
      `Non-reveal evidence contained forbidden field ${fieldPath}.${key}.`,
    );
    assertNoSecretBearingFields(entry, `${fieldPath}.${key}`);
  }
}

function assertSafeNonRevealResponse(value, credentials, additionalSentinels = []) {
  assertNoBrokerPrivateMaterial(value, credentials, additionalSentinels);
  assertNoSecretBearingFields(value);
}

function managementRouteProbeBody(route, index, ref) {
  const requestId = `real-ipc-route-${index}`;
  const serviceId = `@qualification-${index}`;
  const operationId = `real-ipc-route-${index}`;
  const reason = "real IPC allowlist qualification";
  if (route.path === "/v1/management/lifecycle/backups") {
    return { requestId, serviceId };
  }
  if (route.path.startsWith("/v1/management/lifecycle/")) {
    return { requestId, serviceId, operationId, reason, confirm: false };
  }
  if (route.path === "/v1/management/lockouts/clear") {
    return { requestId, serviceId, scope: `management:${operationId}`, reason };
  }
  if (route.path.startsWith("/v1/management/secrets/create/")) {
    return { requestId, serviceId, ref, operationId, generationMode: "broker_generated", reason, confirm: false };
  }
  if (route.path === "/v1/management/secrets/reveal") {
    return {
      requestId,
      serviceId,
      ref: "",
      reason,
      confirm: false,
    };
  }
  if (route.path.startsWith("/v1/management/secrets/decommission/")) {
    return { requestId, serviceId, ref, operationId, reason, confirm: false, dependencyStatus: "blocked" };
  }
  if (route.path === "/v1/management/secrets/rotation/dry-run") {
    return { requestId, serviceId, operationId, refs: [ref], reason };
  }
  if (route.path.startsWith("/v1/management/secrets/rotation/")) {
    return { requestId, serviceId, ref, operationId, reason, confirm: false };
  }
  if (route.path.startsWith("/v1/management/secrets/campaigns/")) {
    return {
      requestId,
      serviceId,
      campaignId: `campaign-${index}`,
      operationId,
      operation: "rotate",
      refs: [ref],
      reason,
      confirm: false,
    };
  }
  if (route.path === "/v1/management/secrets/sync/dry-run") {
    return { requestId, serviceId, operationId, refs: [ref], destinationId: "unconfigured", reason };
  }
  if (route.path.startsWith("/v1/providers/config/")) {
    return {
      requestId,
      serviceId,
      providerId: "local",
      providerKind: "local-encrypted-store",
      displayName: "Local encrypted store",
      operationId,
      reason,
      confirm: false,
      validationMode: "metadata-only",
      rollbackStrategy: "retain-current",
    };
  }
  if (route.path.startsWith("/v1/providers/migration/")) {
    return {
      requestId,
      serviceId,
      operationId,
      sourceProviderId: "local",
      targetProviderId: "local",
      refs: [ref],
      reason,
      confirm: false,
    };
  }
  return { requestId, serviceId, ref, reason, confirm: false };
}

function classifyBrokerCommandFailure(error) {
  const stderr = error && typeof error === "object" && "stderr" in error
    ? String(error.stderr)
    : "";
  if (stderr.includes("wrapper permissions are not private")) return "wrapper_access";
  if (stderr.includes("wrapper is unavailable for the current user")) return "wrapper_unavailable";
  if (stderr.includes("os wrapper provider is unsupported")) return "wrapper_unsupported";
  if (stderr.includes("invalid portable master key format")) return "invalid_master_key";
  return "unclassified";
}

function markPrepared(serviceId, binary) {
  const state = getLifecycleState(serviceId);
  setLifecycleState(serviceId, {
    ...state,
    installed: true,
    configured: true,
    installArtifacts: {
      ...state.installArtifacts,
      artifact: {
        sourceType: "release-qualification",
        repo: "service-lasso/lasso-secretsbroker",
        channel: null,
        tag: "2026.8.25-41f7206",
        assetName: path.basename(binary),
        assetUrl: null,
        archiveType: null,
        archivePath: null,
        extractedPath: path.dirname(binary),
        command: binary,
        args: ["serve"],
        checksum: null,
      },
    },
  });
}

async function waitForBrokerReady(context, child, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    assert.equal(child.exitCode, null, "Real Secrets Broker exited before IPC readiness.");
    if ((await context.probe()).ready) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Real Secrets Broker IPC did not become ready inside the qualification window.");
}

async function waitForBrokerManagementReady(context, child, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    assert.equal(child.exitCode, null, "Real Secrets Broker exited before management readiness.");
    try {
      const response = await context.management({ method: "GET", path: "/v1/management/lifecycle/status" });
      if (response.statusCode === 200 && response.body?.outcome === "ready") return response;
    } catch {
      // The native listener may be accepting readiness probes before the
      // authenticated management handler is ready. Retry inside this bound.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Real Secrets Broker management API did not become ready inside the qualification window.");
}

async function waitForBrokerAuditUnavailableState(context, child, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    assert.equal(child.exitCode, null, "Real Secrets Broker exited before audit-unavailable readiness.");
    try {
      const response = await context.management({ method: "GET", path: "/v1/management/lifecycle/status" });
      if (
        response.statusCode === 503 &&
        response.body?.outcome === "ready" &&
        response.body?.auditStatus === "audit_unavailable"
      ) {
        return response;
      }
    } catch {
      // Retry while the replaced audit path and native listener settle.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Real Secrets Broker did not expose the expected audit-unavailable state inside the qualification window.");
}

async function requestIdempotentManagementWithRetry(context, child, input, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    assert.equal(child.exitCode, null, "Real Secrets Broker exited during an idempotent management request.");
    try {
      return await context.management(input);
    } catch (error) {
      if (!error || typeof error !== "object" || error.code !== "broker_unavailable") throw error;
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Real Secrets Broker idempotent management request did not complete inside the retry window.", {
    cause: lastError,
  });
}

async function stopBroker(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill();
  const stopped = await Promise.race([
    exited.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 10_000)),
  ]);
  if (!stopped && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    const killed = await Promise.race([
      exited.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 5_000)),
    ]);
    if (!killed) {
      throw new Error("Owned real Secrets Broker did not exit after bounded forced termination.");
    }
  }
}

test("Windows management readiness reads do not reuse a named-pipe connection", {
  skip: process.platform !== "win32",
}, async () => {
  const socketPath = `\\\\.\\pipe\\service-lasso-broker-management-rebind-${process.pid}-${Date.now()}`;
  const requestsBySocket = new WeakMap();
  const routes = [];
  let acceptedConnections = 0;
  const server = createServer((request, response) => {
    routes.push(`${request.method} ${request.url}`);
    const priorRequests = requestsBySocket.get(request.socket) ?? 0;
    requestsBySocket.set(request.socket, priorRequests + 1);
    if (priorRequests > 0) {
      // Model a non-responsive pooled pipe session. A later readiness read
      // must use a fresh connection instead of waiting on this old session.
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      serviceId: "@secretsbroker",
      outcome: "ready",
      providers: [{ providerId: "vault-browser", outcome: "ready" }],
    }));
  });
  server.on("connection", () => {
    acceptedConnections += 1;
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  const options = {
    transport: { kind: "windows-named-pipe", socketPath },
    apiToken: "broker-test-token-with-at-least-32-bytes",
    workspaceId: "workspace-test",
    timeoutMs: 250,
  };
  try {
    const firstStatus = await requestSecretsBrokerManagement(options, {
      method: "GET",
      path: "/v1/providers/config/status",
    });
    const secondStatus = await requestSecretsBrokerManagement(options, {
      method: "GET",
      path: "/v1/providers/config/status",
    });

    assert.equal(firstStatus.statusCode, 200);
    assert.equal(secondStatus.statusCode, 200);
    assert.deepEqual(routes, [
      "GET /v1/providers/config/status",
      "GET /v1/providers/config/status",
    ]);
    assert.equal(acceptedConnections, 2, "each Windows management read must use a fresh pipe connection");
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test(
  "pinned real Broker serves management, KV, and resolve over authenticated OS IPC",
  { skip: !requireBrokerBinary },
  async () => {
    assert.ok(
      brokerBinary,
      "SERVICE_LASSO_TEST_BROKER_BINARY is required for the release-gated real Broker IPC qualification.",
    );
    const binary = path.resolve(brokerBinary);
    assert.equal((await lstat(binary)).isFile(), true);
    const tempRoot = await mkdtemp(path.join(process.cwd(), ".service-lasso-real-broker-ipc-"));
    const servicesRoot = path.join(tempRoot, "services");
    const workspaceRoot = path.join(tempRoot, "workspace");
    let brokerProcess;
    let runtimeCredentials = null;
    let qualificationPhase = "fixture setup";
    let brokerCommandFailure = "none";
    const managementRouteEvidence = [];

    const runBrokerCommand = async (command, cwd, args, environment) => {
      try {
        const { stdout } = await execFileAsync(command, args, {
          cwd,
          env: { ...process.env, ...environment },
          windowsHide: true,
          timeout: 30_000,
          maxBuffer: 1024 * 1024,
        });
        return stdout;
      } catch (error) {
        brokerCommandFailure = classifyBrokerCommandFailure(error);
        throw error;
      }
    };

    try {
      await mkdir(servicesRoot, { recursive: true });
      await mkdir(workspaceRoot, { recursive: true });
      await writeManifest(servicesRoot, "@secretsbroker", {
        id: "@secretsbroker",
        name: "Secrets Broker",
        description: "Real IPC release qualification fixture.",
        executable: binary,
        args: ["serve"],
        env: { SECRETSBROKER_MODE: "production", SECRETSBROKER_TRANSPORT: "auto" },
        healthcheck: { type: "process" },
      });
      await writeManifest(servicesRoot, "sample-service", {
        id: "sample-service",
        name: "Sample Service",
        description: "Real IPC resolve fixture.",
        executable: process.execPath,
        args: ["--version"],
        env: { SAMPLE_REQUIRED_TOKEN: "${sample.API_TOKEN}" },
        healthcheck: { type: "process" },
        broker: {
          imports: [{
            namespace: "services/sample-service",
            ref: "sample.API_TOKEN",
            as: "SAMPLE_REQUIRED_TOKEN",
            required: true,
          }],
          accessPolicy: {
            serviceId: "sample-service",
            workspace: "local",
            grants: [{
              namespace: "services/sample-service",
              scope: "service",
              refs: ["sample.API_TOKEN"],
              operations: ["resolve"],
              purpose: "real IPC qualification",
            }],
          },
        },
      });

      resetLifecycleState();
      const registry = createServiceRegistry(await discoverServices(servicesRoot));
      const broker = registry.getById("@secretsbroker");
      const sample = registry.getById("sample-service");
      assert.ok(broker && sample);
      markPrepared("@secretsbroker", binary);

      qualificationPhase = "vault bootstrap";
      const bootstrap = await bootstrapSecretsBrokerVault(workspaceRoot, registry, { runCommand: runBrokerCommand });
      assert.equal(
        bootstrap.transportKind,
        process.platform === "win32" ? "windows-named-pipe" : "unix-socket",
      );
      const context = await loadSecretsBrokerRuntimeContext(workspaceRoot, registry);
      assert.ok(context);
      runtimeCredentials = await readSecretsBrokerRuntimeCredentials(workspaceRoot);
      assert.ok(runtimeCredentials);

      qualificationPhase = "Broker subprocess start and readiness";
      brokerProcess = spawn(binary, ["serve"], {
        cwd: path.dirname(binary),
        env: { ...process.env, ...context.serverEnv },
        windowsHide: true,
        stdio: "ignore",
      });
      await waitForBrokerReady(context, brokerProcess);

      qualificationPhase = "management request";
      const management = await waitForBrokerManagementReady(context, brokerProcess);
      assert.equal(management.statusCode, 200);
      assert.equal(management.body.outcome, "ready");
      assertSafeNonRevealResponse(management.body, runtimeCredentials);

      const probeRef = "services/sample-service/runtime/IPC_PROBE";
      const editSecretSentinel = "qualification-edit-secret-sentinel";
      const resetSecretSentinel = "qualification-reset-secret-sentinel";
      const createPlan = await context.management({
        method: "POST",
        path: "/v1/management/secrets/create/dry-run",
        body: {
          requestId: "real-ipc-create-plan",
          serviceId: "@serviceadmin",
          ref: probeRef,
          operationId: "real-ipc-create",
          generationMode: "broker_generated",
          reason: "real IPC qualification",
        },
      });
      assert.equal(createPlan.statusCode, 200);
      assert.equal(createPlan.body.outcome, "dry_run_ready");
      assertSafeNonRevealResponse(createPlan.body, runtimeCredentials, [editSecretSentinel, resetSecretSentinel]);
      const staleCreate = await context.management({
        method: "POST",
        path: "/v1/management/secrets/create/apply",
        body: {
          requestId: "real-ipc-create-stale",
          serviceId: "@serviceadmin",
          ref: probeRef,
          operationId: "real-ipc-create-stale",
          generationMode: "broker_generated",
          reason: "real IPC stale-plan qualification",
          confirm: true,
          plan: createPlan.body.plan,
        },
      });
      assert.equal(staleCreate.statusCode, 409);
      assert.equal(staleCreate.body.outcome, "stale_plan");
      assert.equal(staleCreate.body.applied, false);
      assertSafeNonRevealResponse(staleCreate.body, runtimeCredentials, [editSecretSentinel, resetSecretSentinel]);
      const created = await context.management({
        method: "POST",
        path: "/v1/management/secrets/create/apply",
        body: {
          requestId: "real-ipc-create-apply",
          serviceId: "@serviceadmin",
          ref: probeRef,
          operationId: "real-ipc-create",
          generationMode: "broker_generated",
          reason: "real IPC qualification",
          confirm: true,
          plan: createPlan.body.plan,
        },
      });
      assert.equal(created.statusCode, 200);
      assert.equal(created.body.outcome, "applied");
      assertSafeNonRevealResponse(created.body, runtimeCredentials, [editSecretSentinel, resetSecretSentinel]);

      qualificationPhase = "real edit, reveal, reset, and no-leak boundaries";
      const editPlan = await context.management({
        method: "POST",
        path: "/v1/management/secrets/edit/dry-run",
        body: { requestId: "real-ipc-edit-plan", serviceId: "@serviceadmin", ref: probeRef },
      });
      assert.equal(editPlan.statusCode, 200);
      assert.equal(editPlan.body.outcome, "dry_run_ready");
      assertSafeNonRevealResponse(editPlan.body, runtimeCredentials, [editSecretSentinel, resetSecretSentinel]);
      const edited = await context.management({
        method: "POST",
        path: "/v1/management/secrets/edit/apply",
        body: {
          requestId: "real-ipc-edit-apply",
          serviceId: "@serviceadmin",
          ref: probeRef,
          reason: "real IPC edit qualification",
          value: editSecretSentinel,
          confirm: true,
        },
      });
      assert.equal(edited.statusCode, 200);
      assert.equal(edited.body.outcome, "applied");
      assertSafeNonRevealResponse(edited.body, runtimeCredentials, [editSecretSentinel, resetSecretSentinel]);
      const revealedEdit = await context.management({
        method: "POST",
        path: "/v1/management/secrets/reveal",
        body: {
          requestId: "real-ipc-reveal-edit",
          serviceId: "@serviceadmin",
          ref: probeRef,
          reason: "real IPC explicit reveal qualification",
          confirm: true,
        },
      });
      assert.equal(revealedEdit.statusCode, 200);
      assert.equal(revealedEdit.body.outcome, "ready");
      assert.equal(revealedEdit.body.value, editSecretSentinel);
      assert.equal(revealedEdit.body.ttlSeconds, 60);
      assertNoBrokerPrivateMaterial(revealedEdit.body, runtimeCredentials);
      qualificationPhase = "edit persistence after clean Broker restart";
      await stopBroker(brokerProcess);
      brokerProcess = spawn(binary, ["serve"], {
        cwd: path.dirname(binary),
        env: { ...process.env, ...context.serverEnv },
        windowsHide: true,
        stdio: "ignore",
      });
      await waitForBrokerReady(context, brokerProcess);
      await waitForBrokerManagementReady(context, brokerProcess);
      const revealedEditAfterRestart = await requestIdempotentManagementWithRetry(context, brokerProcess, {
        method: "POST",
        path: "/v1/management/secrets/reveal",
        body: {
          requestId: "real-ipc-reveal-edit-after-restart",
          serviceId: "@serviceadmin",
          ref: probeRef,
          reason: "real IPC edit persistence qualification",
          confirm: true,
        },
      });
      assert.equal(revealedEditAfterRestart.statusCode, 200);
      assert.equal(revealedEditAfterRestart.body.outcome, "ready");
      assert.equal(revealedEditAfterRestart.body.value, editSecretSentinel);
      assertNoBrokerPrivateMaterial(revealedEditAfterRestart.body, runtimeCredentials);
      const resetPlan = await context.management({
        method: "POST",
        path: "/v1/management/secrets/reset/dry-run",
        body: { requestId: "real-ipc-reset-plan", serviceId: "@serviceadmin", ref: probeRef },
      });
      assert.equal(resetPlan.statusCode, 200);
      assert.equal(resetPlan.body.outcome, "dry_run_ready");
      assertSafeNonRevealResponse(resetPlan.body, runtimeCredentials, [editSecretSentinel, resetSecretSentinel]);
      const reset = await context.management({
        method: "POST",
        path: "/v1/management/secrets/reset/apply",
        body: {
          requestId: "real-ipc-reset-apply",
          serviceId: "@serviceadmin",
          ref: probeRef,
          reason: "real IPC reset qualification",
          value: resetSecretSentinel,
          confirm: true,
        },
      });
      assert.equal(reset.statusCode, 200);
      assert.equal(reset.body.outcome, "applied");
      assertSafeNonRevealResponse(reset.body, runtimeCredentials, [editSecretSentinel, resetSecretSentinel]);
      const inventory = await context.management({ method: "GET", path: "/v1/management/secrets" });
      assert.equal(inventory.statusCode, 200);
      assert.equal(inventory.body.outcome, "ready");
      assertSafeNonRevealResponse(inventory.body, runtimeCredentials, [editSecretSentinel, resetSecretSentinel]);

      qualificationPhase = "canonical management route matrix";
      const actualManagementRoutes = listSecretsBrokerManagementRoutes();
      assert.deepEqual(actualManagementRoutes.map(routeKey), [...expectedManagementResults.keys()]);
      for (const [index, route] of actualManagementRoutes.entries()) {
        const expected = expectedManagementResults.get(routeKey(route));
        assert.ok(expected, `Missing expected contract for ${routeKey(route)}.`);
        const response = await requestIdempotentManagementWithRetry(context, brokerProcess, {
          method: route.method,
          path: route.path,
          ...(route.method === "POST"
            ? {
                body: managementRouteProbeBody(route, index, probeRef),
              }
            : {}),
        });
        assertTypedManagementResponse(route, response, expected);
        assertSafeNonRevealResponse(response.body, runtimeCredentials, [editSecretSentinel, resetSecretSentinel]);
        managementRouteEvidence.push({
          route: routeKey(route),
          statusCode: response.statusCode,
          outcome: response.body.outcome,
        });
      }

      qualificationPhase = "KV metadata request";
      const kv = await context.operatorRequest({
        method: "GET",
        pathWithQuery: "/v1/kv/metadata/?list=true",
        headers: {},
      });
      assert.equal(kv.status, 200);
      assert.equal(kv.headers["content-type"]?.includes("application/json"), true);
      const kvBody = JSON.parse(kv.body.toString("utf8"));
      assert.equal(typeof kvBody, "object");
      assertSafeNonRevealResponse(kvBody, runtimeCredentials, [editSecretSentinel, resetSecretSentinel]);

      qualificationPhase = "launch-lease issue";
      const identity = await issueScopedBrokerIdentity(sample, {
        launchLeaseIssuer: context.launchLeaseIssuer,
        transportBinding: context.transportBinding,
      });
      const identityLease = JSON.parse(identity.env[BROKER_IDENTITY_LEASE_ENV]);
      qualificationPhase = "launch resolve request";
      assert.deepEqual(
        await context.lookup({ service: sample, refs: ["sample.API_TOKEN"], identityLease }),
        [{ ref: "sample.API_TOKEN", status: "missing" }],
      );

      qualificationPhase = "reset persistence after clean Broker restart";
      await stopBroker(brokerProcess);
      brokerProcess = spawn(binary, ["serve"], {
        cwd: path.dirname(binary),
        env: { ...process.env, ...context.serverEnv },
        windowsHide: true,
        stdio: "ignore",
      });
      await waitForBrokerReady(context, brokerProcess);
      await waitForBrokerManagementReady(context, brokerProcess);
      const revealedResetAfterRestart = await requestIdempotentManagementWithRetry(context, brokerProcess, {
        method: "POST",
        path: "/v1/management/secrets/reveal",
        body: {
          requestId: "real-ipc-reveal-reset-after-restart",
          serviceId: "@serviceadmin",
          ref: probeRef,
          reason: "real IPC reset persistence qualification",
          confirm: true,
        },
      });
      assert.equal(revealedResetAfterRestart.statusCode, 200);
      assert.equal(revealedResetAfterRestart.body.outcome, "ready");
      assert.equal(revealedResetAfterRestart.body.value, resetSecretSentinel);
      assertNoBrokerPrivateMaterial(revealedResetAfterRestart.body, runtimeCredentials);

      qualificationPhase = "typed audit-unavailable fail-closed response";
      await stopBroker(brokerProcess);
      await rm(runtimeCredentials.auditPath, { force: true });
      await mkdir(runtimeCredentials.auditPath);
      brokerProcess = spawn(binary, ["serve"], {
        cwd: path.dirname(binary),
        env: { ...process.env, ...context.serverEnv },
        windowsHide: true,
        stdio: "ignore",
      });
      await waitForBrokerReady(context, brokerProcess);
      const auditUnavailableReadiness = await waitForBrokerAuditUnavailableState(context, brokerProcess);
      assertSafeNonRevealResponse(
        auditUnavailableReadiness.body,
        runtimeCredentials,
        [editSecretSentinel, resetSecretSentinel],
      );
      const auditUnavailable = await requestIdempotentManagementWithRetry(context, brokerProcess, {
        method: "POST",
        path: "/v1/management/secrets/create/dry-run",
        body: {
          requestId: "real-ipc-audit-unavailable",
          serviceId: "@serviceadmin",
          ref: "services/sample-service/runtime/AUDIT_UNAVAILABLE_PROBE",
          operationId: "real-ipc-audit-unavailable",
          generationMode: "broker_generated",
          reason: "real IPC audit-unavailable qualification",
        },
      });
      assert.equal(auditUnavailable.statusCode, 503);
      assert.equal(auditUnavailable.body.outcome, "audit_unavailable");
      assert.equal(auditUnavailable.body.applied, false);
      assert.equal(auditUnavailable.body.auditStatus, "audit_unavailable");
      assertSafeNonRevealResponse(auditUnavailable.body, runtimeCredentials, [editSecretSentinel, resetSecretSentinel]);

      const publicEvidence = {
        schemaVersion: 1,
        brokerRelease: "2026.8.25-41f7206",
        transportKind: bootstrap.transportKind,
        managementRoutes: managementRouteEvidence,
        boundaries: {
          stalePlan: { statusCode: staleCreate.statusCode, outcome: staleCreate.body.outcome, applied: staleCreate.body.applied },
          edit: { statusCode: edited.statusCode, outcome: edited.body.outcome, applied: edited.body.applied },
          editPersistence: {
            statusCode: revealedEditAfterRestart.statusCode,
            outcome: revealedEditAfterRestart.body.outcome,
            ttlSeconds: revealedEditAfterRestart.body.ttlSeconds,
          },
          reset: { statusCode: reset.statusCode, outcome: reset.body.outcome, applied: reset.body.applied },
          resetPersistence: {
            statusCode: revealedResetAfterRestart.statusCode,
            outcome: revealedResetAfterRestart.body.outcome,
            ttlSeconds: revealedResetAfterRestart.body.ttlSeconds,
          },
          auditUnavailable: {
            statusCode: auditUnavailable.statusCode,
            outcome: auditUnavailable.body.outcome,
            applied: auditUnavailable.body.applied,
            auditStatus: auditUnavailable.body.auditStatus,
          },
        },
        kv: { statusCode: kv.status, json: kv.headers["content-type"]?.includes("application/json") === true },
        resolve: { status: "missing" },
      };
      assertSafeNonRevealResponse(publicEvidence, runtimeCredentials, [editSecretSentinel, resetSecretSentinel]);
      if (brokerIpcEvidencePath) {
        const evidencePath = path.resolve(brokerIpcEvidencePath);
        await mkdir(path.dirname(evidencePath), { recursive: true });
        await writeFile(evidencePath, `${JSON.stringify(publicEvidence, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      }
    } catch (error) {
      const brokerExited = brokerProcess
        ? brokerProcess.exitCode !== null || brokerProcess.signalCode !== null
        : false;
      const causeName = error instanceof Error ? error.name : "unknown";
      const causeCode = error && typeof error === "object" && "code" in error &&
        typeof error.code === "string" && /^[a-z0-9_]+$/u.test(error.code)
        ? error.code
        : "none";
      throw new Error(
        `Real Broker IPC qualification failed during ${qualificationPhase}; brokerExited=${brokerExited}; cause=${causeName}/${causeCode}; brokerCommandFailure=${brokerCommandFailure}.`,
        { cause: error },
      );
    } finally {
      await stopBroker(brokerProcess);
      resetLifecycleState();
      if (runtimeCredentials?.transport.kind === "unix-socket") {
        await rm(runtimeCredentials.transport.socketPath, { force: true });
      }
      await rm(tempRoot, { recursive: true, force: true });
    }
  },
);
