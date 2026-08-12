import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import {
  classifyProcessIdentity,
  hashProcessCommandLine,
  inspectProcess,
} from "../dist/runtime/process/identity.js";
import {
  findProcessOwnership,
  getProcessRegistryPath,
  getWorkspaceLifecycleLockPath,
  migrateLegacyProcessOwnership,
  readProcessOwnershipRegistry,
  recordProcessOwnership,
  transitionProcessOwnership,
} from "../dist/runtime/process/registry.js";
import { startApiServer } from "../dist/server/index.js";
import {
  adoptManagedProcess,
  hasManagedProcess,
  startManagedProcess,
  stopAllManagedProcesses,
  stopManagedProcess,
  waitForManagedProcessFinalization,
} from "../dist/runtime/execution/supervisor.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { createDirectExecutionPlan } from "../dist/runtime/providers/direct.js";
import { rehydrateDiscoveredServices, rehydrateLifecycleState } from "../dist/runtime/state/rehydrate.js";
import { readStoredState } from "../dist/runtime/state/readState.js";
import { makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function waitFor(check, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

async function postJson(url) {
  const response = await fetch(url, { method: "POST" });
  return { response, body: await response.json() };
}

function windowsInspector(identity) {
  return {
    platform: "win32",
    runCommand: async () => ({ stdout: JSON.stringify(identity) }),
  };
}

async function writeStubbornProcessTreeFixture(serviceRoot, scriptPath, options = {}) {
  const { rootAutoExitMs = null } = options;
  const childScriptPath = path.join(serviceRoot, "runtime", "fixture-child.mjs");
  const grandchildScriptPath = path.join(serviceRoot, "runtime", "fixture-grandchild.mjs");
  const pidFilePath = path.join(serviceRoot, "runtime", "process-tree.json");

  await writeFile(
    grandchildScriptPath,
    `
const heartbeat = setInterval(() => {}, 1000);
process.on("SIGTERM", () => {});
process.on("SIGINT", () => {});
void heartbeat;
`.trim(),
    "utf8",
  );
  await writeFile(
    childScriptPath,
    `
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";

const grandchild = spawn(process.execPath, [${JSON.stringify(grandchildScriptPath)}], {
  stdio: "ignore",
  windowsHide: true,
});
await new Promise((resolve, reject) => {
  grandchild.once("spawn", resolve);
  grandchild.once("error", reject);
});
await writeFile(${JSON.stringify(pidFilePath)}, JSON.stringify({
  childPid: process.pid,
  grandchildPid: grandchild.pid,
}));
const heartbeat = setInterval(() => {}, 1000);
process.on("SIGTERM", () => {});
process.on("SIGINT", () => {});
void heartbeat;
`.trim(),
    "utf8",
  );
  await writeFile(
    scriptPath,
    `
import { spawn } from "node:child_process";

const child = spawn(process.execPath, [${JSON.stringify(childScriptPath)}], {
  stdio: "ignore",
  windowsHide: true,
});
await new Promise((resolve, reject) => {
  child.once("spawn", resolve);
  child.once("error", reject);
});
const heartbeat = setInterval(() => {}, 1000);
process.on("SIGTERM", () => {});
process.on("SIGINT", () => {});
${rootAutoExitMs === null ? "" : `setTimeout(() => process.exit(0), ${rootAutoExitMs});`}
void heartbeat;
`.trim(),
    "utf8",
  );

  return pidFilePath;
}

async function readProcessTreePids(pidFilePath) {
  return await waitFor(async () => {
    try {
      return JSON.parse(await readFile(pidFilePath, "utf8"));
    } catch {
      return null;
    }
  });
}

async function waitForProcessesStopped(pids, timeoutMs = 3_000) {
  await waitFor(async () => {
    const inspections = await Promise.all(pids.map((pid) => inspectProcess(pid)));
    return inspections.every((inspection) => inspection.status === "not_running");
  }, timeoutMs);
}

function forceCleanupProcesses(pids) {
  for (const pid of pids) {
    if (Number.isInteger(pid) && pid > 0) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // The process may already be gone.
      }
    }
  }
}

test("process identity classifies the active host process without PID-only trust", async () => {
  const inspection = await inspectProcess(process.pid);
  assert.equal(inspection.status, "running");
  assert.equal(inspection.identity.pid, process.pid);
  assert.equal(Number.isFinite(Date.parse(inspection.identity.createdAt)), true);
  assert.equal(inspection.identity.executablePath.length > 0, true);
  assert.match(inspection.identity.commandHash, /^[a-f0-9]{64}$/);
  assert.equal(classifyProcessIdentity(inspection.identity, inspection), "owned");
  assert.equal(
    classifyProcessIdentity(inspection.identity, { status: "not_running", reason: "fixture" }),
    "not_running",
  );
  assert.equal(
    classifyProcessIdentity(inspection.identity, { status: "unknown", reason: "fixture" }),
    "unknown_owner",
  );
  assert.equal(
    classifyProcessIdentity(
      inspection.identity,
      { status: "running", identity: { ...inspection.identity, createdAt: "2026-01-01T00:00:00.000Z" } },
    ),
    "identity_mismatch",
  );

  const exited = spawn(process.execPath, ["-e", "process.exit(0)"]);
  const exitedPid = exited.pid;
  await new Promise((resolve, reject) => {
    exited.once("close", resolve);
    exited.once("error", reject);
  });
  assert.deepEqual(await inspectProcess(exitedPid), {
    status: "not_running",
    reason: "process_not_running",
  });
});

test("Windows inspection adapter captures creation, executable, and hashed command evidence", async () => {
  const commandLine = '"C:\\Program Files\\nodejs\\node.exe" C:\\apps\\service.mjs --port 18080';
  let inspectedCommand = "";
  const inspection = await inspectProcess(
    4242,
    {
      platform: "win32",
      runCommand: async (_command, args) => {
        inspectedCommand = args.at(-1) ?? "";
        return {
          stdout: JSON.stringify({
            ProcessId: 4242,
            CreationDate: "2026-07-18T01:02:03.456Z",
            ExecutablePath: "C:\\Program Files\\nodejs\\node.exe",
            CommandLine: commandLine,
          }),
        };
      },
    },
  );

  assert.equal(inspectedCommand.includes("@{;"), false);
  assert.deepEqual(inspection, {
    status: "running",
    identity: {
      pid: 4242,
      createdAt: "2026-07-18T01:02:03.456Z",
      executablePath: "C:\\Program Files\\nodejs\\node.exe",
      commandHash: hashProcessCommandLine(commandLine),
    },
  });

  const unverified = await inspectProcess(
    4242,
    windowsInspector({ ProcessId: 4242, CreationDate: null, ExecutablePath: null, CommandLine: null }),
  );
  assert.deepEqual(unverified, { status: "unknown", reason: "windows_process_evidence_incomplete" });
});

test("workspace process registry writes atomically, recovers from residue, and clears stopped PIDs", async () => {
  const { tempRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-process-registry-");
  const secretSentinel = "PROCESS_REGISTRY_MUST_NOT_STORE_THIS_SECRET";

  try {
    const recorded = await recordProcessOwnership(workspaceRoot, {
      ownerType: "runtime",
      ownerId: "runtime-test",
      generationId: "generation-test",
      runtimeInstanceId: "runtime-test",
      pid: process.pid,
      ownerRoot: tempRoot,
      allocationRevision: "revision-1",
      ports: { api: 18080 },
      endpoints: [{ name: "api", url: `http://user:${secretSentinel}@127.0.0.1:18080/?token=${secretSentinel}` }],
      lifecycleState: "running",
      source: "runtime",
    });

    assert.equal(recorded.pid, process.pid);
    assert.equal(recorded.generationId, "generation-test");
    assert.equal(recorded.identityStatus, "owned");
    assert.equal(recorded.allocation.ports.api, 18080);
    assert.equal(recorded.allocation.endpoints[0].url, "http://127.0.0.1:18080/");

    const registryPath = getProcessRegistryPath(workspaceRoot);
    await writeFile(`${registryPath}.interrupted.tmp`, "{partial", "utf8");
    const afterResidue = await readProcessOwnershipRegistry(workspaceRoot);
    assert.equal(afterResidue.entries.length, 1);

    await transitionProcessOwnership(workspaceRoot, "runtime", "runtime-test", "stopped", "not_running");
    const stopped = await findProcessOwnership(workspaceRoot, "runtime", "runtime-test");
    assert.equal(stopped.lifecycleState, "stopped");
    assert.equal(stopped.pid, null);
    assert.equal(stopped.identity, null);

    const serialized = await readFile(registryPath, "utf8");
    assert.equal(serialized.includes(secretSentinel), false);
    assert.equal(serialized.includes("CommandLine"), false);
    assert.equal(serialized.includes("environment"), false);

    await writeFile(registryPath, "{corrupt", "utf8");
    const recovered = await readProcessOwnershipRegistry(workspaceRoot);
    assert.equal(recovered.entries.length, 1);
    assert.equal(recovered.entries[0].identityStatus, "owned");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("workspace lifecycle lock immediately recovers a verifiably exited owner", async () => {
  const { tempRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-process-lock-");
  const formerOwner = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);

  try {
    await new Promise((resolve, reject) => {
      formerOwner.once("spawn", resolve);
      formerOwner.once("error", reject);
    });
    const inspection = await inspectProcess(formerOwner.pid);
    assert.equal(inspection.status, "running");
    formerOwner.kill("SIGKILL");
    await new Promise((resolve) => formerOwner.once("close", resolve));

    const lockPath = getWorkspaceLifecycleLockPath(workspaceRoot);
    await mkdir(path.dirname(lockPath), { recursive: true });
    await writeFile(lockPath, JSON.stringify({
      version: 1,
      token: "abandoned-lock",
      pid: formerOwner.pid,
      identity: inspection.identity,
      acquiredAt: new Date().toISOString(),
    }), "utf8");

    await recordProcessOwnership(workspaceRoot, {
      ownerType: "runtime",
      ownerId: "lock-recovery-runtime",
      pid: process.pid,
      ownerRoot: tempRoot,
      lifecycleState: "running",
      source: "runtime",
    });

    const recovered = await findProcessOwnership(workspaceRoot, "runtime", "lock-recovery-runtime");
    assert.equal(recovered?.identityStatus, "owned");
    await assert.rejects(readFile(lockPath, "utf8"), { code: "ENOENT" });
  } finally {
    formerOwner.kill("SIGKILL");
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("legacy PID migration requires creation time, executable, and command agreement", async () => {
  const { tempRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-legacy-process-");
  const command = '"C:\\Program Files\\nodejs\\node.exe" C:\\apps\\service.mjs';
  const identity = {
    ProcessId: 8123,
    CreationDate: "2026-07-18T02:03:04.000Z",
    ExecutablePath: "C:\\Program Files\\nodejs\\node.exe",
    CommandLine: command,
  };

  try {
    const migrated = await migrateLegacyProcessOwnership(workspaceRoot, {
      ownerId: "legacy-service",
      serviceId: "legacy-service",
      pid: 8123,
      startedAt: "2026-07-18T02:03:04.900Z",
      command,
      expectedExecutablePath: "C:\\Program Files\\nodejs\\node.exe",
      ownerRoot: path.join(tempRoot, "services", "legacy-service"),
      inspectorDependencies: windowsInspector(identity),
    });
    assert.deepEqual(migrated, { status: "owned", migrated: true, reason: "legacy_identity_verified" });
    assert.equal((await findProcessOwnership(workspaceRoot, "service", "legacy-service")).pid, 8123);

    const mismatch = await migrateLegacyProcessOwnership(workspaceRoot, {
      ownerId: "legacy-service",
      serviceId: "legacy-service",
      pid: 8123,
      startedAt: "2026-07-18T02:03:04.900Z",
      command: command + " --different",
      expectedExecutablePath: "C:\\Program Files\\nodejs\\node.exe",
      ownerRoot: path.join(tempRoot, "services", "legacy-service"),
      inspectorDependencies: windowsInspector(identity),
    });
    assert.equal(mismatch.status, "identity_mismatch");
    assert.equal(mismatch.migrated, false);
    const cleared = await findProcessOwnership(workspaceRoot, "service", "legacy-service");
    assert.equal(cleared.pid, null);
    assert.equal(cleared.identityStatus, "identity_mismatch");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("rehydration clears a reused PID without terminating the unrelated live process", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-reused-pid-");
  const { serviceRoot } = await writeExecutableFixtureService(servicesRoot, "reused-pid-service");
  const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);

  try {
    await new Promise((resolve, reject) => {
      unrelated.once("spawn", resolve);
      unrelated.once("error", reject);
    });
    const inspection = await inspectProcess(unrelated.pid);
    assert.equal(inspection.status, "running");

    const stateRoot = path.join(serviceRoot, ".state");
    await mkdir(stateRoot, { recursive: true });
    await writeFile(path.join(stateRoot, "install.json"), JSON.stringify({ installed: true }), "utf8");
    await writeFile(path.join(stateRoot, "config.json"), JSON.stringify({ configured: true }), "utf8");
    await writeFile(
      path.join(stateRoot, "runtime.json"),
      JSON.stringify({
        running: true,
        pid: unrelated.pid,
        startedAt: inspection.identity.createdAt,
        command: `${process.execPath} definitely-not-the-live-command.mjs`,
        ports: { service: 18091 },
        lastAction: "start",
        actionHistory: ["install", "config", "start"],
      }),
      "utf8",
    );

    const discovered = await discoverServices(servicesRoot);
    await rehydrateDiscoveredServices(discovered, { workspaceRoot });

    assert.equal(unrelated.exitCode, null);
    assert.equal(unrelated.signalCode, null);
    const stored = await readStoredState(serviceRoot);
    assert.equal(stored.runtime.running, false);
    assert.equal(stored.runtime.pid, null);
    const ownership = await findProcessOwnership(workspaceRoot, "service", "reused-pid-service");
    assert.equal(ownership, null);
  } finally {
    unrelated.kill("SIGKILL");
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("API startup clears a reused PID and starts a replacement without touching the unrelated process", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-api-reused-pid-");
  const { serviceRoot } = await writeExecutableFixtureService(servicesRoot, "api-reused-pid-service", {
    ports: { service: 18095 },
  });
  const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
  let apiServer;

  try {
    await new Promise((resolve, reject) => {
      unrelated.once("spawn", resolve);
      unrelated.once("error", reject);
    });
    const inspection = await inspectProcess(unrelated.pid);
    assert.equal(inspection.status, "running");

    const stateRoot = path.join(serviceRoot, ".state");
    await mkdir(stateRoot, { recursive: true });
    await writeFile(path.join(stateRoot, "install.json"), JSON.stringify({ installed: true }), "utf8");
    await writeFile(path.join(stateRoot, "config.json"), JSON.stringify({ configured: true }), "utf8");
    await writeFile(
      path.join(stateRoot, "runtime.json"),
      JSON.stringify({
        running: true,
        pid: unrelated.pid,
        startedAt: inspection.identity.createdAt,
        command: `${process.execPath} stale-service-command.mjs`,
        ports: { service: 18095 },
        lastAction: "start",
        actionHistory: ["install", "config", "start"],
      }),
      "utf8",
    );

    apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot });
    const storedAfterBoot = await readStoredState(serviceRoot);
    assert.equal(storedAfterBoot.runtime.running, false);
    assert.equal(storedAfterBoot.runtime.pid, null);
    assert.equal(unrelated.exitCode, null);
    assert.equal(unrelated.signalCode, null);

    const start = await postJson(`${apiServer.url}/api/services/api-reused-pid-service/start`);

    assert.equal(start.response.status, 200);
    assert.equal(start.body.action, "start");
    assert.equal(start.body.state.running, true);
    assert.equal(start.body.state.runtime.pid > 0, true);
    assert.notEqual(start.body.state.runtime.pid, unrelated.pid);
    assert.deepEqual(start.body.state.runtime.ports, { service: 18095 });
    assert.equal(unrelated.exitCode, null);
    assert.equal(unrelated.signalCode, null);

    const stored = await readStoredState(serviceRoot);
    assert.equal(stored.runtime.running, true);
    assert.equal(stored.runtime.pid, start.body.state.runtime.pid);
    const ownership = await findProcessOwnership(workspaceRoot, "service", "api-reused-pid-service");
    assert.equal(ownership.lifecycleState, "running");
    assert.equal(ownership.pid, start.body.state.runtime.pid);
  } finally {
    await apiServer?.stop();
    unrelated.kill("SIGKILL");
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("rehydration returns adopted running state with retained ports", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-rehydrate-adopted-state-");
  const { serviceRoot, scriptPath } = await writeExecutableFixtureService(servicesRoot, "rehydrate-adopted-service", {
    ports: { service: 18092 },
  });
  const relativeScriptPath = path.relative(serviceRoot, scriptPath);
  const child = spawn(process.execPath, [relativeScriptPath], {
    cwd: serviceRoot,
    stdio: "ignore",
    windowsHide: true,
  });

  try {
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    const inspection = await inspectProcess(child.pid);
    assert.equal(inspection.status, "running");

    const stateRoot = path.join(serviceRoot, ".state");
    await mkdir(stateRoot, { recursive: true });
    await writeFile(path.join(stateRoot, "install.json"), JSON.stringify({ installed: true }), "utf8");
    await writeFile(path.join(stateRoot, "config.json"), JSON.stringify({ configured: true }), "utf8");
    await writeFile(
      path.join(stateRoot, "runtime.json"),
      JSON.stringify({
        running: true,
        pid: child.pid,
        startedAt: inspection.identity.createdAt,
        command: `${process.execPath} ${relativeScriptPath}`,
        ports: { service: 18092 },
        lastAction: "start",
        actionHistory: ["install", "config", "start"],
      }),
      "utf8",
    );

    const [service] = await discoverServices(servicesRoot);
    const rehydrated = await rehydrateLifecycleState(service, { workspaceRoot });

    assert.equal(rehydrated.running, true);
    assert.equal(rehydrated.runtime.pid, child.pid);
    assert.deepEqual(rehydrated.runtime.ports, { service: 18092 });
    assert.equal(rehydrated.runtime.endpoints.some((endpoint) => endpoint.port === 18092), true);
    assert.equal(hasManagedProcess("rehydrate-adopted-service"), true);

    const stored = await readStoredState(serviceRoot);
    assert.equal(stored.runtime.running, true);
    assert.equal(stored.runtime.pid, child.pid);
    assert.deepEqual(stored.runtime.ports, { service: 18092 });

    const ownership = await findProcessOwnership(workspaceRoot, "service", "rehydrate-adopted-service");
    assert.equal(ownership.lifecycleState, "running");
    assert.equal(ownership.pid, child.pid);
    assert.deepEqual(ownership.allocation.ports, { service: 18092 });
  } finally {
    await stopManagedProcess("rehydrate-adopted-service", 500).catch(() => null);
    child.kill("SIGKILL");
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("rehydration records a safe blocker for unverifiable persisted process owners", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-unknown-owner-");
  const { serviceRoot, scriptPath } = await writeExecutableFixtureService(servicesRoot, "unknown-owner-service");
  const relativeScriptPath = path.relative(serviceRoot, scriptPath);

  try {
    const stateRoot = path.join(serviceRoot, ".state");
    await mkdir(stateRoot, { recursive: true });
    await writeFile(path.join(stateRoot, "install.json"), JSON.stringify({ installed: true }), "utf8");
    await writeFile(path.join(stateRoot, "config.json"), JSON.stringify({ configured: true }), "utf8");
    await writeFile(
      path.join(stateRoot, "runtime.json"),
      JSON.stringify({
        running: true,
        pid: 4242,
        startedAt: "2026-07-18T02:03:04.000Z",
        command: `${process.execPath} ${relativeScriptPath}`,
        ports: { service: 18094 },
        lastAction: "start",
        actionHistory: ["install", "config", "start"],
      }),
      "utf8",
    );

    const [service] = await discoverServices(servicesRoot);
    const rehydrated = await rehydrateLifecycleState(service, {
      workspaceRoot,
      processInspectorDependencies: windowsInspector({
        ProcessId: 4242,
        CreationDate: null,
        ExecutablePath: null,
        CommandLine: null,
      }),
    });

    assert.equal(rehydrated.running, false);
    assert.equal(rehydrated.runtime.pid, null);
    assert.equal(hasManagedProcess("unknown-owner-service"), false);
    assert.equal(rehydrated.runtime.startTrace.current.status, "blocked");
    assert.equal(rehydrated.runtime.startTrace.current.events[0].metadata.processOwnerStatus, "unknown_owner");
    assert.equal(rehydrated.runtime.startTrace.current.events[0].metadata.previousPid, 4242);
    assert.match(
      rehydrated.runtime.startTrace.current.events[0].metadata.nextSafeAction,
      /Inspect the persisted PID owner/,
    );

    const stored = await readStoredState(serviceRoot);
    assert.equal(stored.runtime.running, false);
    assert.equal(stored.runtime.pid, null);
    assert.equal(stored.runtime.startTrace.current.status, "blocked");
  } finally {
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("API restart replaces an adopted persisted process and keeps retained ports", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-adopted-restart-");
  const { serviceRoot, scriptPath } = await writeExecutableFixtureService(servicesRoot, "adopted-restart-service", {
    ports: { service: 18093 },
  });
  const relativeScriptPath = path.relative(serviceRoot, scriptPath);
  const child = spawn(process.execPath, [relativeScriptPath], {
    cwd: serviceRoot,
    stdio: "ignore",
    windowsHide: true,
  });
  let apiServer;

  try {
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    const inspection = await inspectProcess(child.pid);
    assert.equal(inspection.status, "running");

    const stateRoot = path.join(serviceRoot, ".state");
    await mkdir(stateRoot, { recursive: true });
    await writeFile(path.join(stateRoot, "install.json"), JSON.stringify({ installed: true }), "utf8");
    await writeFile(path.join(stateRoot, "config.json"), JSON.stringify({ configured: true }), "utf8");
    await writeFile(
      path.join(stateRoot, "runtime.json"),
      JSON.stringify({
        running: true,
        pid: child.pid,
        startedAt: inspection.identity.createdAt,
        command: `${process.execPath} ${relativeScriptPath}`,
        ports: { service: 18093 },
        lastAction: "start",
        actionHistory: ["install", "config", "start"],
      }),
      "utf8",
    );

    apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot });
    assert.equal(hasManagedProcess("adopted-restart-service"), true);

    const restart = await postJson(`${apiServer.url}/api/services/adopted-restart-service/restart`);

    assert.equal(restart.response.status, 200);
    assert.equal(restart.body.action, "restart");
    assert.equal(restart.body.state.running, true);
    assert.equal(restart.body.state.runtime.pid > 0, true);
    assert.notEqual(restart.body.state.runtime.pid, child.pid);
    assert.deepEqual(restart.body.state.runtime.ports, { service: 18093 });
    assert.equal(restart.body.state.runtime.endpoints.some((endpoint) => endpoint.port === 18093), true);

    await waitFor(() => child.exitCode !== null || child.signalCode !== null);
    const stored = await readStoredState(serviceRoot);
    assert.equal(stored.runtime.running, true);
    assert.equal(stored.runtime.pid, restart.body.state.runtime.pid);
    assert.deepEqual(stored.runtime.ports, { service: 18093 });

    const ownership = await findProcessOwnership(workspaceRoot, "service", "adopted-restart-service");
    assert.equal(ownership.lifecycleState, "running");
    assert.equal(ownership.pid, restart.body.state.runtime.pid);
    assert.deepEqual(ownership.allocation.ports, { service: 18093 });
  } finally {
    await apiServer?.stop();
    await stopManagedProcess("adopted-restart-service", 500).catch(() => null);
    child.kill("SIGKILL");
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("legacy adopted ownership verifies and stops descendants without a persisted process group", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-adopted-process-stop-");
  const { serviceRoot, scriptPath } = await writeExecutableFixtureService(servicesRoot, "adopted-stop-service");
  const pidFilePath = await writeStubbornProcessTreeFixture(serviceRoot, scriptPath);
  const root = spawn(process.execPath, [path.relative(serviceRoot, scriptPath)], {
    cwd: serviceRoot,
    stdio: "ignore",
    windowsHide: true,
  });
  let childPid = null;
  let grandchildPid = null;

  try {
    await new Promise((resolve, reject) => {
      root.once("spawn", resolve);
      root.once("error", reject);
    });
    const inspection = await inspectProcess(root.pid);
    assert.equal(inspection.status, "running");
    const pids = await readProcessTreePids(pidFilePath);
    childPid = pids.childPid;
    grandchildPid = pids.grandchildPid;
    const [service] = await discoverServices(servicesRoot);
    await recordProcessOwnership(workspaceRoot, {
      ownerType: "service",
      ownerId: "adopted-stop-service",
      serviceId: "adopted-stop-service",
      pid: root.pid,
      ownerRoot: serviceRoot,
      lifecycleState: "running",
      source: "legacy-verified",
    });

    const handle = await adoptManagedProcess({
      service,
      pid: root.pid,
      startedAt: inspection.identity.createdAt,
      command: `${process.execPath} ${path.relative(serviceRoot, scriptPath)}`,
      workspaceRoot,
    });

    assert.equal(handle.pid, root.pid);
    assert.equal(hasManagedProcess("adopted-stop-service"), true);
    const runningOwnership = await findProcessOwnership(workspaceRoot, "service", "adopted-stop-service");
    assert.deepEqual(runningOwnership.processGroup, { kind: "none", id: null });

    const stopped = await stopManagedProcess("adopted-stop-service", 100);
    assert.ok(stopped);
    await waitForProcessesStopped([root.pid, childPid, grandchildPid]);
    assert.equal(hasManagedProcess("adopted-stop-service"), false);
    const ownership = await findProcessOwnership(workspaceRoot, "service", "adopted-stop-service");
    assert.equal(ownership.lifecycleState, "stopped");
    assert.equal(ownership.pid, null);
  } finally {
    await stopManagedProcess("adopted-stop-service", 100).catch(() => null);
    forceCleanupProcesses([root.pid, childPid, grandchildPid]);
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("managed stop owns and terminates the complete child and grandchild process tree", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-process-tree-stop-");
  const { serviceRoot, scriptPath } = await writeExecutableFixtureService(servicesRoot, "process-tree-service");
  const pidFilePath = await writeStubbornProcessTreeFixture(serviceRoot, scriptPath);
  let handle;
  let childPid = null;
  let grandchildPid = null;

  try {
    const [service] = await discoverServices(servicesRoot);
    handle = await startManagedProcess({
      service,
      executionPlan: createDirectExecutionPlan(service.manifest),
      workspaceRoot,
    });

    const pids = await readProcessTreePids(pidFilePath);
    childPid = pids.childPid;
    grandchildPid = pids.grandchildPid;

    const runningOwnership = await findProcessOwnership(workspaceRoot, "service", "process-tree-service");
    if (process.platform === "win32") {
      assert.equal(runningOwnership.processGroup.kind === "windows-job" || runningOwnership.processGroup.kind === "none", true);
    } else {
      assert.deepEqual(runningOwnership.processGroup, { kind: "posix", id: String(handle.pid) });
    }

    const stopped = await stopManagedProcess("process-tree-service", 100);

    assert.ok(stopped);
    await waitForProcessesStopped([handle.pid, childPid, grandchildPid]);
    const stoppedOwnership = await findProcessOwnership(workspaceRoot, "service", "process-tree-service");
    assert.equal(stoppedOwnership.lifecycleState, "stopped");
    assert.equal(stoppedOwnership.pid, null);
  } finally {
    await stopManagedProcess("process-tree-service", 100).catch(() => null);
    forceCleanupProcesses([handle?.pid, childPid, grandchildPid]);
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("managed unexpected root exit terminates the remaining verified process tree", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-managed-root-exit-");
  const { serviceRoot, scriptPath } = await writeExecutableFixtureService(servicesRoot, "managed-root-exit-service");
  const pidFilePath = await writeStubbornProcessTreeFixture(serviceRoot, scriptPath, { rootAutoExitMs: 750 });
  let handle;
  let childPid = null;
  let grandchildPid = null;

  try {
    const [service] = await discoverServices(servicesRoot);
    handle = await startManagedProcess({
      service,
      executionPlan: createDirectExecutionPlan(service.manifest),
      workspaceRoot,
    });
    const pids = await readProcessTreePids(pidFilePath);
    childPid = pids.childPid;
    grandchildPid = pids.grandchildPid;

    await waitForProcessesStopped([handle.pid, childPid, grandchildPid], 12_000);
    await waitFor(() => !hasManagedProcess("managed-root-exit-service"), 12_000);
    const stoppedOwnership = await findProcessOwnership(workspaceRoot, "service", "managed-root-exit-service");
    assert.equal(stoppedOwnership.lifecycleState, "stopped");
    assert.equal(stoppedOwnership.pid, null);
  } finally {
    await stopManagedProcess("managed-root-exit-service", 100).catch(() => null);
    forceCleanupProcesses([handle?.pid, childPid, grandchildPid]);
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("whole-runtime shutdown waits for a pending managed finalizer before cleanup", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-finalizer-boundary-");
  const { serviceRoot } = await writeExecutableFixtureService(servicesRoot, "finalizer-boundary-service");
  let releaseFinalizer;
  const finalizerGate = new Promise((resolve) => {
    releaseFinalizer = resolve;
  });
  let reportFinalizerStarted;
  const finalizerStarted = new Promise((resolve) => {
    reportFinalizerStarted = resolve;
  });
  let handle;

  try {
    const [service] = await discoverServices(servicesRoot);
    handle = await startManagedProcess({
      service,
      executionPlan: createDirectExecutionPlan(service.manifest),
      workspaceRoot,
      onExit: async () => {
        reportFinalizerStarted();
        await finalizerGate;
      },
    });

    assert.equal(process.kill(handle.pid, "SIGKILL"), true);
    await finalizerStarted;
    assert.equal(hasManagedProcess("finalizer-boundary-service"), false);

    const shutdown = stopAllManagedProcesses();
    const immediateOutcome = await Promise.race([
      shutdown.then(() => "settled", () => "rejected"),
      new Promise((resolve) => setImmediate(() => resolve("pending"))),
    ]);
    assert.equal(immediateOutcome, "pending");

    releaseFinalizer();
    await shutdown;
    await rm(serviceRoot, { recursive: true, force: true });
  } finally {
    releaseFinalizer?.();
    await stopAllManagedProcesses().catch(() => null);
    forceCleanupProcesses([handle?.pid]);
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("whole-runtime shutdown reports safe service, pid, and finalization phase on failure", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-finalizer-diagnostic-");
  await writeExecutableFixtureService(servicesRoot, "finalizer-diagnostic-service");
  let releaseFinalizer;
  const finalizerGate = new Promise((resolve) => {
    releaseFinalizer = resolve;
  });
  let reportFinalizerStarted;
  const finalizerStarted = new Promise((resolve) => {
    reportFinalizerStarted = resolve;
  });
  let handle;

  try {
    const [service] = await discoverServices(servicesRoot);
    handle = await startManagedProcess({
      service,
      executionPlan: createDirectExecutionPlan(service.manifest),
      workspaceRoot,
      onExit: async () => {
        reportFinalizerStarted();
        await finalizerGate;
        const error = new Error("sensitive command material must not escape");
        error.code = "EFINALIZE_TEST";
        throw error;
      },
    });

    assert.equal(process.kill(handle.pid, "SIGKILL"), true);
    await finalizerStarted;
    releaseFinalizer();
    // Let the finalizer reject before shutdown begins. The failure must remain
    // observable at the cleanup boundary rather than being silently discarded.
    await new Promise((resolve) => setImmediate(resolve));
    const shutdown = stopAllManagedProcesses();

    await assert.rejects(shutdown, (error) => {
      assert.equal(error.name, "ManagedProcessFinalizationError");
      assert.equal(error.failures.length, 1);
      assert.deepEqual(error.failures[0], {
        serviceId: "finalizer-diagnostic-service",
        pid: handle.pid,
        phase: "finalize",
        code: "EFINALIZE_TEST",
      });
      assert.match(error.message, /finalizer-diagnostic-service/);
      assert.match(error.message, new RegExp(`pid ${handle.pid}`));
      assert.match(error.message, /phase finalize/);
      assert.equal(error.message.includes("sensitive command material"), false);
      return true;
    });
  } finally {
    releaseFinalizer?.();
    await stopAllManagedProcesses().catch(() => null);
    forceCleanupProcesses([handle?.pid]);
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("rehydrated adopted ownership retains and stops the complete persisted process tree", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-adopted-process-tree-");
  const { serviceRoot, scriptPath } = await writeExecutableFixtureService(servicesRoot, "adopted-process-tree-service");
  const pidFilePath = await writeStubbornProcessTreeFixture(serviceRoot, scriptPath);
  const relativeScriptPath = path.relative(serviceRoot, scriptPath);
  const root = spawn(process.execPath, [relativeScriptPath], {
    cwd: serviceRoot,
    stdio: "ignore",
    detached: process.platform !== "win32",
    windowsHide: true,
  });
  let childPid = null;
  let grandchildPid = null;

  try {
    await new Promise((resolve, reject) => {
      root.once("spawn", resolve);
      root.once("error", reject);
    });
    const rootInspection = await inspectProcess(root.pid);
    assert.equal(rootInspection.status, "running");
    const pids = await readProcessTreePids(pidFilePath);
    childPid = pids.childPid;
    grandchildPid = pids.grandchildPid;
    const processGroup = process.platform === "win32"
      ? { kind: "none", id: null }
      : { kind: "posix", id: String(root.pid) };

    await recordProcessOwnership(workspaceRoot, {
      ownerType: "service",
      ownerId: "adopted-process-tree-service",
      serviceId: "adopted-process-tree-service",
      pid: root.pid,
      ownerRoot: serviceRoot,
      lifecycleState: "running",
      source: "spawn",
      processGroup,
    });
    const stateRoot = path.join(serviceRoot, ".state");
    await mkdir(stateRoot, { recursive: true });
    await writeFile(path.join(stateRoot, "install.json"), JSON.stringify({ installed: true }), "utf8");
    await writeFile(path.join(stateRoot, "config.json"), JSON.stringify({ configured: true }), "utf8");
    await writeFile(
      path.join(stateRoot, "runtime.json"),
      JSON.stringify({
        running: true,
        pid: root.pid,
        startedAt: rootInspection.identity.createdAt,
        command: `${process.execPath} ${relativeScriptPath}`,
        ports: { service: 18102 },
        lastAction: "start",
        actionHistory: ["install", "config", "start"],
      }),
      "utf8",
    );

    const [service] = await discoverServices(servicesRoot);
    const rehydrated = await rehydrateLifecycleState(service, { workspaceRoot });
    assert.equal(rehydrated.running, true);
    assert.equal(rehydrated.runtime.pid, root.pid);
    const adoptedOwnership = await findProcessOwnership(workspaceRoot, "service", "adopted-process-tree-service");
    assert.deepEqual(adoptedOwnership.processGroup, processGroup);

    const stopped = await stopManagedProcess("adopted-process-tree-service", 100);

    assert.ok(stopped);
    await waitForProcessesStopped([root.pid, childPid, grandchildPid]);
    const stoppedOwnership = await findProcessOwnership(workspaceRoot, "service", "adopted-process-tree-service");
    assert.equal(stoppedOwnership.lifecycleState, "stopped");
    assert.equal(stoppedOwnership.pid, null);
  } finally {
    await stopManagedProcess("adopted-process-tree-service", 100).catch(() => null);
    forceCleanupProcesses([root.pid, childPid, grandchildPid]);
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("adopted process monitoring clears durable running state after the root exits", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-adopted-monitor-");
  const { serviceRoot, scriptPath } = await writeExecutableFixtureService(servicesRoot, "adopted-monitor-service");
  const pidFilePath = await writeStubbornProcessTreeFixture(serviceRoot, scriptPath);
  const relativeScriptPath = path.relative(serviceRoot, scriptPath);
  const root = spawn(process.execPath, [relativeScriptPath], {
    cwd: serviceRoot,
    stdio: "ignore",
    detached: process.platform !== "win32",
    windowsHide: true,
  });
  let childPid = null;
  let grandchildPid = null;

  try {
    await new Promise((resolve, reject) => {
      root.once("spawn", resolve);
      root.once("error", reject);
    });
    const rootInspection = await inspectProcess(root.pid);
    assert.equal(rootInspection.status, "running");
    const pids = await readProcessTreePids(pidFilePath);
    childPid = pids.childPid;
    grandchildPid = pids.grandchildPid;
    const processGroup = process.platform === "win32"
      ? { kind: "none", id: null }
      : { kind: "posix", id: String(root.pid) };

    await recordProcessOwnership(workspaceRoot, {
      ownerType: "service",
      ownerId: "adopted-monitor-service",
      serviceId: "adopted-monitor-service",
      pid: root.pid,
      ownerRoot: serviceRoot,
      lifecycleState: "running",
      source: "spawn",
      processGroup,
    });
    const stateRoot = path.join(serviceRoot, ".state");
    await mkdir(stateRoot, { recursive: true });
    await writeFile(path.join(stateRoot, "install.json"), JSON.stringify({ installed: true }), "utf8");
    await writeFile(path.join(stateRoot, "config.json"), JSON.stringify({ configured: true }), "utf8");
    await writeFile(
      path.join(stateRoot, "runtime.json"),
      JSON.stringify({
        running: true,
        pid: root.pid,
        startedAt: rootInspection.identity.createdAt,
        command: `${process.execPath} ${relativeScriptPath}`,
        ports: { service: 18103 },
        lastAction: "start",
        actionHistory: ["install", "config", "start"],
      }),
      "utf8",
    );

    const [service] = await discoverServices(servicesRoot);
    const rehydrated = await rehydrateLifecycleState(service, { workspaceRoot });
    assert.equal(rehydrated.running, true);
    assert.equal(hasManagedProcess("adopted-monitor-service"), true);

    const rootExit = new Promise((resolve) => root.once("close", resolve));
    assert.equal(root.kill("SIGKILL"), true);
    await rootExit;
    await waitForManagedProcessFinalization("adopted-monitor-service");
    await waitForProcessesStopped([root.pid, childPid, grandchildPid]);

    assert.equal(hasManagedProcess("adopted-monitor-service"), false);
    const stored = await readStoredState(serviceRoot);
    assert.equal(stored.runtime.running, false);
    assert.equal(stored.runtime.pid, null);
    assert.equal(stored.runtime.lastTermination, "exited");
    assert.equal(stored.runtime.metrics.exitCount, 1);
    const ownership = await findProcessOwnership(workspaceRoot, "service", "adopted-monitor-service");
    assert.equal(ownership.lifecycleState, "stopped");
    assert.equal(ownership.pid, null);
  } finally {
    await stopManagedProcess("adopted-monitor-service", 100).catch(() => null);
    forceCleanupProcesses([root.pid, childPid, grandchildPid]);
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runtime and service ownership are durable before readiness and clear after confirmed stop", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-owned-start-");
  const instanceRegistryPath = path.join(tempRoot, "host", "instances.json");
  const previousInstanceRegistryPath = process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH;
  process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH = instanceRegistryPath;
  let apiServer;

  try {
    await mkdir(path.dirname(instanceRegistryPath), { recursive: true });
    await writeExecutableFixtureService(servicesRoot, "owned-service", {
      readyFileAfterMs: 3_000,
      readyFileRelativePath: "./runtime/ready.txt",
      env: { OWNERSHIP_SECRET_SENTINEL: "never-persist-this-value" },
      healthcheck: {
        type: "file",
        file: "./runtime/ready.txt",
        retries: 100,
        interval: 50,
        start_period: 0,
      },
    });
    apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot });

    const runtimeEntry = (await readProcessOwnershipRegistry(workspaceRoot)).entries.find(
      (entry) => entry.ownerType === "runtime",
    );
    assert.equal(runtimeEntry.lifecycleState, "running");
    assert.equal(runtimeEntry.pid, process.pid);
    assert.match(runtimeEntry.generationId, UUID_PATTERN);

    assert.equal((await postJson(`${apiServer.url}/api/services/owned-service/install`)).response.status, 200);
    assert.equal((await postJson(`${apiServer.url}/api/services/owned-service/config`)).response.status, 200);

    const startPromise = postJson(`${apiServer.url}/api/services/owned-service/start`);
    const launching = await waitFor(async () => {
      const entry = await findProcessOwnership(workspaceRoot, "service", "owned-service");
      return entry?.lifecycleState === "launching" ? entry : null;
    }, 8_000);
    assert.equal(launching.identityStatus, "owned");
    assert.equal(launching.pid > 0, true);

    const started = await startPromise;
    assert.equal(started.response.status, 200);
    assert.equal(started.body.state.running, true);
    const running = await findProcessOwnership(workspaceRoot, "service", "owned-service");
    assert.equal(running.lifecycleState, "running");
    assert.equal(running.generationId, runtimeEntry.generationId);
    assert.equal(running.pid, started.body.state.runtime.pid);
    assert.equal(started.body.state.runtime.generationId, runtimeEntry.generationId);

    const registryText = await readFile(getProcessRegistryPath(workspaceRoot), "utf8");
    assert.equal(registryText.includes("never-persist-this-value"), false);
    assert.equal(registryText.includes("OWNERSHIP_SECRET_SENTINEL"), false);

    const stoppedResponse = await postJson(`${apiServer.url}/api/services/owned-service/stop`);
    assert.equal(stoppedResponse.response.status, 200);
    const stopped = await findProcessOwnership(workspaceRoot, "service", "owned-service");
    assert.equal(stopped.lifecycleState, "stopped");
    assert.equal(stopped.pid, null);
    assert.equal(stopped.identity, null);
  } finally {
    await apiServer?.stop();
    if (previousInstanceRegistryPath === undefined) {
      delete process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH;
    } else {
      process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH = previousInstanceRegistryPath;
    }
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
