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
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { rehydrateDiscoveredServices } from "../dist/runtime/state/rehydrate.js";
import { readStoredState } from "../dist/runtime/state/readState.js";
import { makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";

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
  const inspection = await inspectProcess(
    4242,
    windowsInspector({
      ProcessId: 4242,
      CreationDate: "2026-07-18T01:02:03.456Z",
      ExecutablePath: "C:\\Program Files\\nodejs\\node.exe",
      CommandLine: commandLine,
    }),
  );

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

    const startedAt = Date.now();
    await recordProcessOwnership(workspaceRoot, {
      ownerType: "runtime",
      ownerId: "lock-recovery-runtime",
      pid: process.pid,
      ownerRoot: tempRoot,
      lifecycleState: "running",
      source: "runtime",
    });
    assert.equal(Date.now() - startedAt < 1_000, true);
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
      readyFileAfterMs: 800,
      readyFileRelativePath: "./runtime/ready.txt",
      env: { OWNERSHIP_SECRET_SENTINEL: "never-persist-this-value" },
      healthcheck: {
        type: "file",
        file: "./runtime/ready.txt",
        retries: 30,
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

    assert.equal((await postJson(`${apiServer.url}/api/services/owned-service/install`)).response.status, 200);
    assert.equal((await postJson(`${apiServer.url}/api/services/owned-service/config`)).response.status, 200);

    const startPromise = postJson(`${apiServer.url}/api/services/owned-service/start`);
    const launching = await waitFor(async () => {
      const entry = await findProcessOwnership(workspaceRoot, "service", "owned-service");
      return entry?.lifecycleState === "launching" ? entry : null;
    });
    assert.equal(launching.identityStatus, "owned");
    assert.equal(launching.pid > 0, true);

    const started = await startPromise;
    assert.equal(started.response.status, 200);
    assert.equal(started.body.state.running, true);
    const running = await findProcessOwnership(workspaceRoot, "service", "owned-service");
    assert.equal(running.lifecycleState, "running");
    assert.equal(running.pid, started.body.state.runtime.pid);

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
