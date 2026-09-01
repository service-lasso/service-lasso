import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import {
  buildCanonicalDemoReport,
  classifyCanonicalDemoOwnership,
  confirmCanonicalDemoStopped,
  formatCanonicalDemoReport,
  getCanonicalRuntimeLaneLockPath,
  resolveCanonicalDemoLifecycleContext,
  runCanonicalDemoRecycle,
  runCanonicalDemoStart,
  runCanonicalDemoStop,
  withCanonicalDemoLifecycleLock,
} from "../scripts/demo-canonical-lifecycle.mjs";
import {
  getCanonicalRuntimeLaneLockPath as getLaneLockPathFromLib,
  getDemoLifecyclePaths,
} from "../scripts/demo-instance-lib.mjs";

const passthroughLock = {
  async withCrossProcessFileLock(_lockPath, work) {
    return await work();
  },
};

/**
 * Builds a minimal demo status object for injected coordinator tests.
 *
 * @param {string} workspaceRoot Isolated workspace.
 * @param {string} servicesRoot Isolated services root.
 * @returns {object}
 */
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
      canonicalLaneLockPath: getLaneLockPathFromLib(17883),
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
    logPaths: [path.join("logs", `${action}.log`)],
    endpoints: [{ name: "api", url: "http://127.0.0.1:17883" }],
  };
}

test("canonical demo report prints workspace, URLs, classification, and log paths", () => {
  const report = buildCanonicalDemoReport({
    command: "start",
    outcome: "already_running",
    ok: true,
    classification: "already_healthy",
    workspaceRoot: path.join("workspace", "demo-instance"),
    servicesRoot: "services",
    runtimeUrl: "http://127.0.0.1:17883",
    serviceAdminUrl: "http://127.0.0.1:17700/",
    lifecycleStatePath: path.join("workspace", "demo-instance", ".service-lasso", "demo-lifecycle.json"),
    demoLogRoot: ".demo-logs",
    commandLockPath: path.join("workspace", "demo-instance", ".service-lasso", "workspace-command.lock"),
    canonicalLaneLockPath: path.join(".service-lasso", "canonical-runtime-lane-17883.lock"),
    logPaths: [path.join(".demo-logs", "demo-runtime.log")],
    endpoints: [{ name: "api", url: "http://127.0.0.1:17883" }],
  });
  const output = formatCanonicalDemoReport(report);
  assert.match(output, /runtimeUrl: http:\/\/127\.0\.0\.1:17883/);
  assert.match(output, /serviceAdminUrl: http:\/\/127\.0\.0\.1:17700\//);
  assert.match(output, /workspaceRoot: .*demo-instance/);
  assert.match(output, /servicesRoot: services/);
  assert.match(output, /classification: already_healthy/);
  assert.match(output, /lifecycleState: .*demo-lifecycle\.json/);
  assert.match(output, /demoLogs: \.demo-logs/);
  assert.match(output, /demo-runtime\.log/);
});

test("canonical lane lock is keyed by port, not by git worktree", () => {
  const previous = process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH;
  const hostRoot = path.join(os.tmpdir(), "service-lasso-host-registry");
  process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH = path.join(hostRoot, "endpoint-allocations.json");
  try {
    const left = resolveCanonicalDemoLifecycleContext({
      workspaceRoot: path.join("D:", "worktrees", "a", "workspace", "demo-instance"),
      port: 17883,
    });
    const right = resolveCanonicalDemoLifecycleContext({
      workspaceRoot: path.join("D:", "worktrees", "b", "workspace", "demo-instance"),
      port: 17883,
    });
    assert.equal(left.canonicalLaneLockPath, right.canonicalLaneLockPath);
    assert.equal(left.canonicalLaneLockPath, getCanonicalRuntimeLaneLockPath(17883));
    assert.match(left.canonicalLaneLockPath, /canonical-runtime-lane-17883\.lock$/);
    assert.notEqual(left.workspaceRoot, right.workspaceRoot);
  } finally {
    if (previous === undefined) {
      delete process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH;
    } else {
      process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH = previous;
    }
  }
});

test("demo:start exits cleanly when the canonical demo is already healthy", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-764-already-"));
  const workspaceRoot = path.join(tempDir, "workspace", "demo-instance");
  const servicesRoot = path.join(tempDir, "services");
  const actions = [];
  try {
    const result = await runCanonicalDemoStart({
      workspaceRoot,
      servicesRoot,
      port: 17883,
      lockTimeoutMs: 5_000,
    }, {
      lockModule: passthroughLock,
      classifyOwnership: async () => ({ classification: "owned", ok: true, instance: {}, portFree: false }),
      runLifecycle: async (action) => {
        actions.push(action);
        return fakeLifecycle(action, "already_running");
      },
      getStatus: async () => fakeStatus(workspaceRoot, servicesRoot),
      writeLifecycleState: async (_status, updates) => ({ phase: updates.phase }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.outcome, "already_running");
    assert.equal(result.classification, "already_healthy");
    assert.equal(result.stayResident, false);
    assert.deepEqual(actions, ["start"]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("demo:start starts when no valid demo is running", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-764-start-"));
  const workspaceRoot = path.join(tempDir, "workspace", "demo-instance");
  const servicesRoot = path.join(tempDir, "services");
  try {
    const result = await runCanonicalDemoStart({
      workspaceRoot,
      servicesRoot,
      port: 17883,
    }, {
      lockModule: passthroughLock,
      classifyOwnership: async () => ({ classification: "not_running", ok: true, instance: null, portFree: true }),
      runLifecycle: async () => fakeLifecycle("start", "started"),
      getStatus: async () => fakeStatus(workspaceRoot, servicesRoot),
      writeLifecycleState: async (_status, updates) => ({ phase: updates.phase }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.outcome, "started");
    assert.equal(result.stayResident, true);
    assert.equal(result.runtimeUrl, "http://127.0.0.1:17883");
    assert.equal(result.serviceAdminUrl, "http://127.0.0.1:17700/");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("occupied wrong-workspace metadata fails once without starting", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-764-stale-"));
  const workspaceRoot = path.join(tempDir, "workspace", "demo-instance");
  const servicesRoot = path.join(tempDir, "services");
  let started = false;
  try {
    const result = await runCanonicalDemoStart({
      workspaceRoot,
      servicesRoot,
      port: 17883,
    }, {
      lockModule: passthroughLock,
      classifyOwnership: async () => ({
        classification: "wrong_workspace_owner",
        ok: false,
        instance: { workspaceRoot: path.join(tempDir, "other") },
        portFree: false,
      }),
      runLifecycle: async () => {
        started = true;
        return fakeLifecycle("start");
      },
      getStatus: async () => fakeStatus(workspaceRoot, servicesRoot),
      writeLifecycleState: async (_status, updates) => ({ phase: updates.phase }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.classification, "wrong_workspace_owner");
    assert.equal(started, false);
    assert.match(formatCanonicalDemoReport(result), /wrong_workspace_owner/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("stale workspace metadata is classified from persisted runtime-instance.json", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-764-meta-"));
  const workspaceRoot = path.join(tempDir, "workspace", "demo-instance");
  const servicesRoot = path.join(tempDir, "services");
  await mkdir(path.join(workspaceRoot, ".service-lasso"), { recursive: true });
  await writeFile(
    path.join(workspaceRoot, ".service-lasso", "runtime-instance.json"),
    `${JSON.stringify({
      workspaceRoot: path.join(tempDir, "other-workspace"),
      servicesRoot: path.join(tempDir, "other-services"),
      apiPort: 17883,
    }, null, 2)}\n`,
    "utf8",
  );
  try {
    const occupied = await classifyCanonicalDemoOwnership({
      workspaceRoot,
      servicesRoot,
      port: 17883,
    }, {
      canBindPort: async () => false,
    });
    assert.equal(occupied.classification, "wrong_workspace_owner");
    assert.equal(occupied.ok, false);

    const free = await classifyCanonicalDemoOwnership({
      workspaceRoot,
      servicesRoot,
      port: 17883,
    }, {
      canBindPort: async () => true,
    });
    assert.equal(free.classification, "stale_workspace_runtime_metadata");
    assert.equal(free.ok, true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("demo:recycle is exactly stop, confirm, start, then verify", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-764-recycle-"));
  const workspaceRoot = path.join(tempDir, "workspace", "demo-instance");
  const servicesRoot = path.join(tempDir, "services");
  const steps = [];
  try {
    const result = await runCanonicalDemoRecycle({
      workspaceRoot,
      servicesRoot,
      port: 17883,
      keepAlive: false,
    }, {
      lockModule: passthroughLock,
      classifyOwnership: async () => {
        steps.push("classify");
        return { classification: "owned", ok: true, instance: {}, portFree: false };
      },
      runLifecycle: async (action) => {
        steps.push(action);
        return fakeLifecycle(action);
      },
      confirmStopped: async () => {
        steps.push("confirm");
        return { ok: true, classification: "already_stopped", apiDown: true, portFree: true };
      },
      startDetached: async (startOptions) => {
        steps.push("start");
        assert.equal(startOptions.laneLockHeld, true);
        return { logPath: path.join(tempDir, "demo-runtime.log") };
      },
      waitForReady: async () => {
        steps.push("verify");
        return {
          status: fakeStatus(workspaceRoot, servicesRoot),
          verification: { ok: true, failures: [] },
        };
      },
      getStatus: async () => fakeStatus(workspaceRoot, servicesRoot),
      writeLifecycleState: async (_status, updates) => ({ phase: updates.phase }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.outcome, "recycled");
    assert.deepEqual(steps, ["classify", "stop", "confirm", "start", "verify"]);
    assert.deepEqual(result.steps, ["classify", "stop", "confirm", "start", "verify"]);
    assert.equal(result.stayResident, false);
    assert.match(formatCanonicalDemoReport(result), /verifyCanonical: passed/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("repeated recycle calls converge to the same stop-confirm-start-verify sequence", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-764-repeat-"));
  const workspaceRoot = path.join(tempDir, "workspace", "demo-instance");
  const servicesRoot = path.join(tempDir, "services");
  const sequences = [];
  const deps = {
    lockModule: passthroughLock,
    classifyOwnership: async () => ({ classification: "not_running", ok: true, instance: null, portFree: true }),
    runLifecycle: async (action) => {
      sequences.push(action);
      return fakeLifecycle(action);
    },
    confirmStopped: async () => {
      sequences.push("confirm");
      return { ok: true, classification: "already_stopped" };
    },
    startDetached: async () => {
      sequences.push("start");
      return { logPath: "detached.log" };
    },
    waitForReady: async () => {
      sequences.push("verify");
      return {
        status: fakeStatus(workspaceRoot, servicesRoot),
        verification: { ok: true, failures: [] },
      };
    },
    writeLifecycleState: async (_status, updates) => ({ phase: updates.phase }),
  };
  try {
    const first = await runCanonicalDemoRecycle({ workspaceRoot, servicesRoot, port: 17883 }, deps);
    const second = await runCanonicalDemoRecycle({ workspaceRoot, servicesRoot, port: 17883 }, deps);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.deepEqual(sequences, ["stop", "confirm", "start", "verify", "stop", "confirm", "start", "verify"]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("canonical verification failure is a single classified recycle blocker", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-764-verify-"));
  const workspaceRoot = path.join(tempDir, "workspace", "demo-instance");
  const servicesRoot = path.join(tempDir, "services");
  try {
    const result = await runCanonicalDemoRecycle({
      workspaceRoot,
      servicesRoot,
      port: 17883,
    }, {
      lockModule: passthroughLock,
      classifyOwnership: async () => ({ classification: "not_running", ok: true, instance: null, portFree: true }),
      runLifecycle: async (action) => fakeLifecycle(action),
      confirmStopped: async () => ({ ok: true, classification: "already_stopped" }),
      startDetached: async () => ({ logPath: "detached.log" }),
      waitForReady: async () => ({
        status: { ...fakeStatus(workspaceRoot, servicesRoot), ok: false, classification: "runtime_down" },
        verification: {
          ok: false,
          failures: [{ name: "echo-service advertised health", code: "unreachable_service_url" }],
        },
      }),
      writeLifecycleState: async (_status, updates) => ({ phase: updates.phase }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.classification, "canonical_verification_failed");
    assert.ok(result.blockers.includes("echo-service advertised health"));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("demo:stop confirms the runtime endpoint reservation is released", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-764-stop-"));
  const workspaceRoot = path.join(tempDir, "workspace", "demo-instance");
  const servicesRoot = path.join(tempDir, "services");
  try {
    const result = await runCanonicalDemoStop({
      workspaceRoot,
      servicesRoot,
      port: 17883,
    }, {
      lockModule: passthroughLock,
      runLifecycle: async () => fakeLifecycle("stop", "stopped"),
      confirmStopped: async () => ({ ok: true, classification: "already_stopped", apiDown: true, portFree: true }),
      getStatus: async () => ({ ...fakeStatus(workspaceRoot, servicesRoot), ok: false, classification: "runtime_down" }),
      writeLifecycleState: async (_status, updates) => ({ phase: updates.phase }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.outcome, "stopped");
    assert.deepEqual(result.steps, ["stop", "confirm"]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("confirmCanonicalDemoStopped fails closed while the runtime port is still held", async () => {
  const confirmation = await confirmCanonicalDemoStopped({
    port: 17883,
    runtimeUrl: "http://127.0.0.1:17883",
  }, {
    probeHttp: async () => ({ ok: false, status: null, error: "ECONNREFUSED" }),
    canBindPort: async () => false,
  });
  assert.equal(confirmation.ok, false);
  assert.equal(confirmation.classification, "endpoint_reservation_held");
});

test("README documents start, stop, recycle, verify, and the default workspace", async () => {
  const readme = await readFile(path.resolve("README.md"), "utf8");
  assert.match(readme, /npm run demo:start -- --port=17883/);
  assert.match(readme, /npm run demo:stop -- --port=17883/);
  assert.match(readme, /npm run demo:recycle -- --port=17883/);
  assert.match(readme, /npm run demo:verify-canonical/);
  assert.match(readme, /npm run demo:status -- --port=17883/);
  assert.match(readme, /workspace\/demo-instance/);
  assert.match(readme, /stop → confirm stopped → start from the current built checkout → verify/);
  assert.match(readme, /preferred port policy/);
  assert.doesNotMatch(readme, /bind it with a fixed port policy/);
});

test("child start skips the lane lock when the parent already holds it", async () => {
  let locked = false;
  const result = await withCanonicalDemoLifecycleLock(
    { port: 17883 },
    async () => "skipped",
    {
      env: { SERVICE_LASSO_CANONICAL_LANE_LOCK_HELD: "1" },
      lockModule: {
        withCrossProcessFileLock: async () => {
          locked = true;
          throw new Error("should not lock");
        },
      },
    },
  );
  assert.equal(result, "skipped");
  assert.equal(locked, false);
});

test("canonical lane lock serialises concurrent recycle and start callers", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-764-lock-"));
  const previous = process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH;
  process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH = path.join(tempDir, "endpoint-allocations.json");
  const order = [];
  try {
    const first = withCanonicalDemoLifecycleLock({ port: 19164, lockTimeoutMs: 5_000 }, async () => {
      order.push("first-enter");
      await new Promise((resolve) => setTimeout(resolve, 50));
      order.push("first-exit");
      return "first";
    });
    const second = withCanonicalDemoLifecycleLock({ port: 19164, lockTimeoutMs: 5_000 }, async () => {
      order.push("second-enter");
      order.push("second-exit");
      return "second";
    });
    const results = await Promise.all([first, second]);
    assert.deepEqual(results.sort(), ["first", "second"].sort());
    assert.deepEqual(order, ["first-enter", "first-exit", "second-enter", "second-exit"]);
  } finally {
    if (previous === undefined) {
      delete process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH;
    } else {
      process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH = previous;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});
