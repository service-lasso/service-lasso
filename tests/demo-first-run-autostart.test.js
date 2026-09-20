import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import {
  completeCanonicalDemoFirstRun,
  isLoopbackRuntimeUrl,
} from "../scripts/demo-first-run-autostart.mjs";
import { runCanonicalDemoRecycle } from "../scripts/demo-canonical-lifecycle.mjs";
import { getDemoLifecyclePaths, getCanonicalRuntimeLaneLockPath } from "../scripts/demo-instance-lib.mjs";

const passthroughLock = {
  async withCrossProcessFileLock(_lockPath, work) {
    return await work();
  },
};

/**
 * Builds a fetch seam from method+path handlers.
 *
 * @param {Record<string, { status: number, body: object } | (() => { status: number, body: object })>} handlers Route map.
 * @returns {(url: string, init?: RequestInit) => Promise<{ status: number, json: () => Promise<object> }>}
 */
function mockFetch(handlers) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url, "http://127.0.0.1");
    const key = `${String(init.method ?? "GET").toUpperCase()} ${parsed.pathname}`;
    calls.push({ key, body: typeof init.body === "string" ? init.body : "" });
    const handler = handlers[key];
    if (!handler) {
      throw new Error(`unexpected ${key}`);
    }
    const result = typeof handler === "function" ? handler() : handler;
    return {
      status: result.status,
      json: async () => result.body,
    };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

function fakeStatus(workspaceRoot, servicesRoot) {
  const paths = getDemoLifecyclePaths(workspaceRoot);
  return {
    ok: true,
    classification: "healthy",
    endpoints: {
      runtime: { url: "http://127.0.0.1:17883", healthUrl: "http://127.0.0.1:17883/api/health", ok: true, status: 200 },
      serviceAdmin: { url: "http://127.0.0.1:17700/", ok: true, status: 200 },
    },
    paths: {
      ...paths,
      servicesRoot,
      workspaceRoot,
      demoLogRoot: path.join(workspaceRoot, ".demo-logs"),
      canonicalLaneLockPath: getCanonicalRuntimeLaneLockPath(17883),
    },
    ownership: {
      classification: "owned",
      instanceId: "inst-1",
      generationId: "gen-1",
      ownerPid: 4242,
    },
    allocation: {
      apiPort: 17883,
      apiUrl: "http://127.0.0.1:17883",
      requestedPort: 17883,
    },
  };
}

function fakeLifecycle(action, outcome = action === "stop" ? "stopped" : "started") {
  return {
    ok: true,
    outcome,
    apiUrl: "http://127.0.0.1:17883",
    apiPort: 17883,
    blockers: [],
    logPaths: [],
    endpoints: [{ name: "api", url: "http://127.0.0.1:17883" }],
  };
}

test("isLoopbackRuntimeUrl accepts only loopback hosts", () => {
  assert.equal(isLoopbackRuntimeUrl("http://127.0.0.1:17883"), true);
  assert.equal(isLoopbackRuntimeUrl("http://localhost:17883/"), true);
  assert.equal(isLoopbackRuntimeUrl("http://[::1]:17883"), true);
  assert.equal(isLoopbackRuntimeUrl("http://192.168.1.10:17883"), false);
  assert.equal(isLoopbackRuntimeUrl("not a url"), false);
});

test("completeCanonicalDemoFirstRun starts canonical services on loopback when setup mode is already clear", async () => {
  const fetchImpl = mockFetch({
    "GET /api/setup/status": {
      status: 200,
      body: { setup: { state: "not_required", setupMode: false, vault: { ready: true, path: "C:\\\\secret-store.json" } } },
    },
    "POST /api/runtime/actions/startAll": {
      status: 200,
      body: { ok: true, action: "startAll", results: [] },
    },
  });
  const result = await completeCanonicalDemoFirstRun({
    runtimeUrl: "http://127.0.0.1:17883",
    timeoutMs: 1_000,
    pollIntervalMs: 10,
  }, { fetch: fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.outcome, "completed");
  assert.equal(result.classification, "canonical_services_started");
  assert.deepEqual(fetchImpl.calls.map((call) => call.key), ["GET /api/setup/status", "POST /api/runtime/actions/startAll"]);
  assert.equal(JSON.stringify(result).includes("secret-store"), false);
});

test("completeCanonicalDemoFirstRun bootstraps then startAlls on loopback setup mode", async () => {
  const fetchImpl = mockFetch({
    "GET /api/setup/status": {
      status: 200,
      body: { setup: { state: "setup_required", setupMode: true, vault: { ready: false } } },
    },
    "POST /api/setup/bootstrap": {
      status: 201,
      body: {
        bootstrap: { ok: true, state: "setup_complete", recoveryKey: "must-not-leak", vaultPath: "C:\\\\store.json" },
        setup: { state: "not_required", setupMode: false },
      },
    },
    "POST /api/runtime/actions/startAll": {
      status: 200,
      body: { ok: true, action: "startAll", results: [] },
    },
  });
  const result = await completeCanonicalDemoFirstRun({
    runtimeUrl: "http://127.0.0.1:17883",
    timeoutMs: 1_000,
    pollIntervalMs: 10,
  }, { fetch: fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.outcome, "completed");
  assert.equal(result.bootstrapStatus, 201);
  assert.equal(result.startAllStatus, 200);
  assert.equal(fetchImpl.calls.at(-1)?.body, JSON.stringify({ confirm: true }));
  assert.doesNotMatch(JSON.stringify(result), /must-not-leak|store\.json/i);
});

test("completeCanonicalDemoFirstRun retries Broker-not-prepared then completes", async () => {
  let bootstrapAttempts = 0;
  const fetchImpl = mockFetch({
    "GET /api/setup/status": {
      status: 200,
      body: { setup: { state: "setup_required", setupMode: true } },
    },
    "POST /api/setup/bootstrap": () => {
      bootstrapAttempts += 1;
      if (bootstrapAttempts === 1) {
        return { status: 409, body: { error: "secrets_broker_not_prepared" } };
      }
      return {
        status: 201,
        body: { bootstrap: { ok: true }, setup: { state: "not_required", setupMode: false } },
      };
    },
    "POST /api/runtime/actions/startAll": {
      status: 200,
      body: { ok: true, action: "startAll" },
    },
  });
  const result = await completeCanonicalDemoFirstRun({
    runtimeUrl: "http://127.0.0.1:17883",
    timeoutMs: 2_000,
    pollIntervalMs: 10,
  }, { fetch: fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(bootstrapAttempts, 2);
});

test("completeCanonicalDemoFirstRun fails closed for non-loopback setup mode", async () => {
  const fetchImpl = mockFetch({
    "GET /api/setup/status": {
      status: 200,
      body: { setup: { state: "setup_required", setupMode: true } },
    },
    "POST /api/setup/bootstrap": {
      status: 201,
      body: { bootstrap: { ok: true }, setup: { setupMode: false } },
    },
  });
  const result = await completeCanonicalDemoFirstRun({
    runtimeUrl: "http://192.168.1.10:17883",
    timeoutMs: 1_000,
    pollIntervalMs: 10,
  }, { fetch: fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.classification, "first_run_bootstrap_not_loopback");
  assert.deepEqual(fetchImpl.calls.map((call) => call.key), ["GET /api/setup/status"]);
});

test("completeCanonicalDemoFirstRun does not retry forbidden bootstrap", async () => {
  let bootstrapAttempts = 0;
  const fetchImpl = mockFetch({
    "GET /api/setup/status": {
      status: 200,
      body: { setup: { state: "setup_required", setupMode: true } },
    },
    "POST /api/setup/bootstrap": () => {
      bootstrapAttempts += 1;
      return { status: 403, body: { error: "setup_bootstrap_forbidden" } };
    },
  });
  const result = await completeCanonicalDemoFirstRun({
    runtimeUrl: "http://127.0.0.1:17883",
    timeoutMs: 1_000,
    pollIntervalMs: 10,
  }, { fetch: fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.classification, "setup_bootstrap_forbidden");
  assert.equal(bootstrapAttempts, 1);
});

test("recycle first-run failure stays blocked and does not run verify", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-1242-first-run-"));
  const workspaceRoot = path.join(tempDir, "workspace", "demo-instance");
  const servicesRoot = path.join(tempDir, "services");
  let verifyCalled = false;
  try {
    const result = await runCanonicalDemoRecycle({
      workspaceRoot,
      servicesRoot,
      port: 17883,
      keepAlive: false,
    }, {
      lockModule: passthroughLock,
      classifyOwnership: async () => ({ classification: "not_running", ok: true, instance: null, portFree: true }),
      runLifecycle: async (action) => fakeLifecycle(action),
      confirmStopped: async () => ({ ok: true, classification: "already_stopped" }),
      startDetached: async () => ({ logPath: "detached.log" }),
      completeFirstRun: async () => ({
        ok: false,
        outcome: "blocked",
        classification: "first_run_bootstrap_not_loopback",
        blockers: ["first_run_bootstrap_not_loopback"],
      }),
      waitForReady: async () => {
        verifyCalled = true;
        return {
          status: fakeStatus(workspaceRoot, servicesRoot),
          verification: { ok: true, failures: [] },
        };
      },
      getStatus: async () => fakeStatus(workspaceRoot, servicesRoot),
      writeLifecycleState: async (_status, updates) => ({ phase: updates.phase, classification: updates.classification }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.classification, "first_run_bootstrap_not_loopback");
    assert.deepEqual(result.steps, ["classify", "stop", "confirm", "start", "first_run"]);
    assert.equal(verifyCalled, false);
    assert.equal(result.verification, null);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
