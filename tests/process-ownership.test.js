import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import {
  classifyWindowsProcessIdentityFast,
  classifyProcessIdentity,
  hashProcessCommandLine,
  inspectProcess,
  inspectWindowsProcessTree,
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
import { MAX_LIFECYCLE_ARRAY_LENGTH } from "../dist/runtime/state/lifecycle-persistence.js";
import { startApiServer } from "../dist/server/index.js";
import {
  adoptManagedProcess,
  filterWindowsManagedLauncherProgressLineForTests,
  hasManagedProcess,
  managedProcessStartFailurePhase,
  setManagedProcessAfterReleaseHookForTests,
  setManagedProcessEnrollmentHookForTests,
  setManagedProcessFilesBoundHookForTests,
  setManagedProcessLaunchStateCreatedHookForTests,
  setManagedProcessLaunchStateRemoverForTests,
  setManagedProcessPostResumeDelayForTests,
  setManagedProcessSpawnerForTests,
  setManagedProcessTreeTerminatorForTests,
  setWindowsManagedLauncherPathForTests,
  startManagedProcess,
  stopAllManagedProcesses,
  stopManagedProcess,
  waitForManagedProcessFinalization,
  writeManagedProcessStdin,
} from "../dist/runtime/execution/supervisor.js";
import { getLifecycleState, resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { startService, stopService } from "../dist/runtime/lifecycle/actions.js";
import { createServiceRegistry } from "../dist/runtime/manager/DependencyGraph.js";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { createDirectExecutionPlan } from "../dist/runtime/providers/direct.js";
import { rehydrateDiscoveredServices, rehydrateLifecycleState } from "../dist/runtime/state/rehydrate.js";
import { readStoredState } from "../dist/runtime/state/readState.js";
import { makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WINDOWS_TEST_SYSTEM_ROOT = "C:\\Windows";
// These fixtures deliberately ignore SIGTERM and require forced tree cleanup,
// registry convergence, and finalization inside one caller-owned deadline.
// A real Windows stop includes one compiler-free native whole-tree inspection
// plus forced taskkill convergence. Preserve the explicit five-second injected
// deadline contract in managed-process-deadline.test.js, while allowing the
// production Windows default to absorb normal host startup contention.
const PROCESS_TREE_STOP_CONVERGENCE_TIMEOUT_MS = process.platform === "win32" ? 15_000 : 5_000;

async function waitFor(check, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  return { response, body: await response.json() };
}

function windowsInspector(identity) {
  return {
    platform: "win32",
    windowsSystemRoot: WINDOWS_TEST_SYSTEM_ROOT,
    runCommand: async () => ({ stdout: JSON.stringify({ Status: "running", ...identity }) }),
  };
}

async function writeStubbornProcessTreeFixture(serviceRoot, scriptPath, options = {}) {
  const {
    rootAutoExitMs = null,
    childTriggerFilePath = null,
    rootExitAfterChildMs = null,
  } = options;
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
  rootPid: process.ppid,
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
import { access } from "node:fs/promises";

${childTriggerFilePath === null ? "" : `while (true) {
  try {
    await access(${JSON.stringify(childTriggerFilePath)});
    break;
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}`}

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
${rootExitAfterChildMs === null ? "" : `setTimeout(() => process.exit(0), ${rootExitAfterChildMs});`}
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

async function removeTempRoot(tempRoot) {
  await rm(tempRoot, {
    recursive: true,
    force: true,
    maxRetries: process.platform === "win32" ? 10 : 0,
    retryDelay: 100,
  });
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
  const commandLine = '"C:\\Program Files\\nodejs\\node.exe" "C:\\apps\\service alpha.mjs" --label="quoted Ω" --payload=' + "x".repeat(2_048);
  let inspectedExecutable = "";
  let inspectorArguments = [];
  let defaultDeadlineMs = null;
  const defaultDeadlineStartedAt = Date.now();
  const inspection = await inspectProcess(
    4242,
    {
      platform: "win32",
      windowsSystemRoot: WINDOWS_TEST_SYSTEM_ROOT,
      runCommand: async (command, args, options) => {
        inspectedExecutable = command;
        inspectorArguments = args;
        defaultDeadlineMs = options?.deadlineMs ?? null;
        return {
          stdout: JSON.stringify({
            Status: "running",
            ProcessId: 4242,
            CreationDate: "2026-07-18T01:02:03.456Z",
            ExecutablePath: "C:\\Program Files\\nodejs\\node.exe",
            CommandLine: commandLine,
          }),
        };
      },
    },
  );

  const inspectedSource = await readFile(
    path.resolve("src", "runtime", "process", "windows-process-inspector.cs"),
    "utf8",
  );
  assert.match(inspectedExecutable, /windows-process-inspector\.exe$/u);
  assert.deepEqual(inspectorArguments, ["4242"]);
  assert.equal(inspectorArguments.at(-1), "4242");
  assert.equal(inspectedSource.includes("DllImport"), true);
  assert.equal(inspectedSource.includes("OpenProcess"), true);
  assert.equal(inspectedSource.includes("GetProcessTimes"), true);
  assert.equal(inspectedSource.includes("QueryFullProcessImageName"), true);
  assert.equal(inspectedSource.includes("NtQueryInformationProcess"), true);
  assert.equal(inspectedSource.includes("Reflection.Emit"), false);
  assert.equal(inspectedSource.includes("returnedLength < headerSize"), true);
  assert.equal(inspectedSource.includes("bufferEnd = bufferStart + returnedLength"), true);
  assert.equal(inspectedSource.includes("length % 2 != 0"), true);
  assert.equal(inspectedSource.includes("maximumLength > availableLength"), true);
  assert.equal(inspectedSource.includes("System.Management.ManagementObjectSearcher"), false);
  assert.equal(inspectedSource.includes("Get-CimInstance"), false);
  const defaultDeadlineDeltaMs = defaultDeadlineMs - defaultDeadlineStartedAt;
  assert.equal(defaultDeadlineDeltaMs >= 14_000, true);
  assert.equal(defaultDeadlineDeltaMs <= 16_000, true);
  assert.deepEqual(inspection, {
    status: "running",
    identity: {
      pid: 4242,
      createdAt: "2026-07-18T01:02:03.456Z",
      executablePath: "C:\\Program Files\\nodejs\\node.exe",
      commandHash: hashProcessCommandLine(commandLine),
    },
  });

  let unsafeLookupInvoked = false;
  const unsafeLookup = await inspectProcess(4242, {
    platform: "win32",
    windowsSystemRoot: ".\\Windows",
    runCommand: async () => {
      unsafeLookupInvoked = true;
      return { stdout: JSON.stringify({ Status: "not_running" }) };
    },
  });
  assert.equal(unsafeLookupInvoked, true);
  assert.deepEqual(unsafeLookup, {
    status: "not_running",
    reason: "process_not_running",
  });

  const unverified = await inspectProcess(
    4242,
    windowsInspector({ ProcessId: 4242, CreationDate: null, ExecutablePath: null, CommandLine: null }),
  );
  assert.deepEqual(unverified, { status: "unknown", reason: "windows_process_evidence_incomplete" });

  const explicitDeadlineMs = Date.now() + 30_000;
  let receivedExplicitDeadlineMs = null;
  await inspectProcess(4242, {
    ...windowsInspector({
      ProcessId: 4242,
      CreationDate: "2026-07-18T01:02:03.456Z",
      ExecutablePath: "C:\\Program Files\\nodejs\\node.exe",
      CommandLine: commandLine,
    }),
    deadlineMs: explicitDeadlineMs,
    runCommand: async (_command, _args, options) => {
      receivedExplicitDeadlineMs = options?.deadlineMs ?? null;
      return {
        stdout: JSON.stringify({
          Status: "running",
          ProcessId: 4242,
          CreationDate: "2026-07-18T01:02:03.456Z",
          ExecutablePath: "C:\\Program Files\\nodejs\\node.exe",
          CommandLine: commandLine,
        }),
      };
    },
  });
  assert.equal(receivedExplicitDeadlineMs, explicitDeadlineMs);
});

test("Windows inspection treats only an explicit absent-process result as not running", async () => {
  assert.deepEqual(
    await inspectProcess(4242, windowsInspector({ Status: "not_running" })),
    { status: "not_running", reason: "process_not_running" },
  );
  assert.deepEqual(
    await inspectProcess(4242, {
      platform: "win32",
      windowsSystemRoot: WINDOWS_TEST_SYSTEM_ROOT,
      runCommand: async () => ({ stdout: JSON.stringify({ Status: "not_running" }), exitCode: 1 }),
    }),
    { status: "unknown", reason: "windows_process_helper_failed" },
  );
  assert.deepEqual(
    await inspectProcess(4242, { platform: "win32", windowsSystemRoot: WINDOWS_TEST_SYSTEM_ROOT, runCommand: async () => ({ stdout: "" }) }),
    { status: "unknown", reason: "windows_process_output_missing" },
  );
  assert.deepEqual(
    await inspectProcess(4242, { platform: "win32", windowsSystemRoot: WINDOWS_TEST_SYSTEM_ROOT, runCommand: async () => ({ stdout: "not-json" }) }),
    { status: "unknown", reason: "windows_process_output_invalid" },
  );
  assert.deepEqual(
    await inspectProcess(4242, windowsInspector({ ProcessId: 4242 })),
    { status: "unknown", reason: "windows_process_evidence_incomplete" },
  );
});

test("Windows full identity inspection aborts and observes helper closure at its deadline", async () => {
  let helperAbortObserved = false;
  let helperCloseObserved = false;
  let helperPid = null;
  await assert.rejects(
    inspectProcess(4242, {
      platform: "win32",
      windowsSystemRoot: WINDOWS_TEST_SYSTEM_ROOT,
      deadlineMs: Date.now() + 150,
      runCommand: async (_command, _args, { signal }) => await new Promise((resolve, reject) => {
        const helper = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
          stdio: "ignore",
          windowsHide: true,
        });
        helperPid = helper.pid;
        signal?.addEventListener("abort", () => {
          helperAbortObserved = true;
          helper.kill("SIGKILL");
        }, { once: true });
        helper.once("close", () => {
          helperCloseObserved = true;
          resolve({ stdout: "" });
        });
        helper.once("error", reject);
      }),
    }),
    (error) => error?.code === "PROCESS_CONTROL_DEADLINE_EXCEEDED",
  );
  await waitFor(() => helperCloseObserved, 1_000);
  assert.equal(helperAbortObserved, true);
  assert.equal(helperCloseObserved, true);
  assert.equal(Number.isInteger(helperPid) && helperPid > 0 && helperPid !== 4242, true);
});

test("Windows full identity concurrently inspects self and child under the product default", {
  skip: process.platform !== "win32",
}, async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
  try {
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    const [selfInspection, childInspection] = await Promise.all([
      inspectProcess(process.pid),
      inspectProcess(child.pid),
    ]);
    assert.equal(selfInspection.status, "running");
    assert.equal(selfInspection.identity.pid, process.pid);
    assert.equal(childInspection.status, "running");
    assert.equal(childInspection.identity.pid, child.pid);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = new Promise((resolve) => child.once("close", resolve));
      child.kill("SIGKILL");
      await closed;
    }
  }
});

test("Windows native identity adapter matches immutable process incarnation fields without CIM", async () => {
  const commandLine = '"C:\\Program Files\\nodejs\\node.exe" service.mjs';
  const expected = {
    pid: 4242,
    createdAt: "2026-07-18T01:02:03.456Z",
    executablePath: "C:\\Program Files\\nodejs\\node.exe",
    commandHash: hashProcessCommandLine(commandLine),
  };
  let inspectorExecutable = "";
  let inspectorArguments = [];
  const runCommand = async (command, args) => {
    inspectorExecutable = command;
    inspectorArguments = args;
    return {
      stdout: JSON.stringify({
        Status: "running",
        ProcessId: expected.pid,
        CreationDate: "2026-07-18T01:02:03.4560000Z",
        ExecutablePath: "c:\\program files\\nodejs\\NODE.exe",
        CommandLine: commandLine,
      }),
    };
  };

  assert.equal(await classifyWindowsProcessIdentityFast(expected, { runCommand, windowsSystemRoot: WINDOWS_TEST_SYSTEM_ROOT }), "owned");
  assert.match(inspectorExecutable, /windows-process-inspector\.exe$/u);
  assert.equal(inspectorArguments.at(-1), "4242");
  assert.equal(
    await classifyWindowsProcessIdentityFast({
      ...expected,
      createdAt: "2026-07-18T01:02:04.456Z",
    }, { runCommand, windowsSystemRoot: WINDOWS_TEST_SYSTEM_ROOT }),
    "identity_mismatch",
  );
  assert.equal(
    await classifyWindowsProcessIdentityFast({
      ...expected,
      executablePath: "C:\\Program Files\\nodejs\\other.exe",
    }, { runCommand, windowsSystemRoot: WINDOWS_TEST_SYSTEM_ROOT }),
    "identity_mismatch",
  );
  assert.equal(
    await classifyWindowsProcessIdentityFast({ ...expected, commandHash: "a".repeat(64) }, { runCommand, windowsSystemRoot: WINDOWS_TEST_SYSTEM_ROOT }),
    "identity_mismatch",
  );
  assert.equal(
    await classifyWindowsProcessIdentityFast(expected, {
      windowsSystemRoot: WINDOWS_TEST_SYSTEM_ROOT,
      runCommand: async () => ({ stdout: JSON.stringify({ Status: "not_running" }) }),
    }),
    "not_running",
  );
});

test("Windows native tree adapter binds every member and fails closed on changed root evidence", async () => {
  const rootCommandLine = '"C:\\Program Files\\nodejs\\node.exe" root.mjs';
  const childCommandLine = '"C:\\Program Files\\nodejs\\node.exe" child.mjs';
  const root = {
    pid: 4242,
    createdAt: "2026-07-18T01:02:03.456Z",
    executablePath: "C:\\Program Files\\nodejs\\node.exe",
    commandHash: hashProcessCommandLine(rootCommandLine),
  };
  const childEvidence = {
    Status: "running",
    ProcessId: 4343,
    ParentProcessId: root.pid,
    CreationDate: "2026-07-18T01:02:04.456Z",
    ExecutablePath: "C:\\Program Files\\nodejs\\node.exe",
    CommandLine: childCommandLine,
  };
  let inspectorArguments = [];
  const runCommand = async (_command, args) => {
    inspectorArguments = args;
    return {
      stdout: JSON.stringify({
        Status: "tree",
        RootStatus: "running",
        Processes: [{
          Status: "running",
          ProcessId: root.pid,
          CreationDate: root.createdAt,
          ExecutablePath: root.executablePath,
          CommandLine: rootCommandLine,
        }, childEvidence],
      }),
    };
  };

  const inspected = await inspectWindowsProcessTree(root, {
    runCommand,
    windowsSystemRoot: WINDOWS_TEST_SYSTEM_ROOT,
  });
  assert.equal(inspected.rootStatus, "owned");
  assert.deepEqual(inspected.members.map((member) => member.pid), [4343, 4242]);
  assert.equal(inspected.members[0].commandHash, hashProcessCommandLine(childCommandLine));
  assert.equal(inspectorArguments.at(-1), "--include-descendants");

  let transientAttempts = 0;
  const retried = await inspectWindowsProcessTree(root, {
    windowsSystemRoot: WINDOWS_TEST_SYSTEM_ROOT,
    runCommand: async () => {
      transientAttempts += 1;
      return {
        stdout: JSON.stringify({
          Status: "tree",
          RootStatus: "running",
          Processes: [{
            Status: "running",
            ProcessId: root.pid,
            CreationDate: root.createdAt,
            ExecutablePath: root.executablePath,
            CommandLine: rootCommandLine,
          }, {
            ...childEvidence,
            ParentProcessId: transientAttempts === 1 ? childEvidence.ProcessId : root.pid,
          }],
        }),
      };
    },
  });
  assert.equal(transientAttempts, 2);
  assert.equal(retried.rootStatus, "owned");

  let sharedHostContentionAttempts = 0;
  const recoveredAfterSharedHostContention = await inspectWindowsProcessTree(root, {
    windowsSystemRoot: WINDOWS_TEST_SYSTEM_ROOT,
    runCommand: async () => {
      sharedHostContentionAttempts += 1;
      if (sharedHostContentionAttempts <= 3) {
        return { stdout: "", exitCode: 1 };
      }
      return {
        stdout: JSON.stringify({
          Status: "tree",
          RootStatus: "running",
          Processes: [{
            Status: "running",
            ProcessId: root.pid,
            CreationDate: root.createdAt,
            ExecutablePath: root.executablePath,
            CommandLine: rootCommandLine,
          }, childEvidence],
        }),
      };
    },
  });
  assert.equal(sharedHostContentionAttempts, 4);
  assert.equal(recoveredAfterSharedHostContention.rootStatus, "owned");
  assert.deepEqual(
    recoveredAfterSharedHostContention.members.map((member) => member.pid),
    [4343, 4242],
  );

  const exited = await inspectWindowsProcessTree(root, {
    windowsSystemRoot: WINDOWS_TEST_SYSTEM_ROOT,
    runCommand: async () => ({
      stdout: JSON.stringify({
        Status: "tree",
        RootStatus: "not_running",
        Processes: [childEvidence],
      }),
    }),
  });
  assert.equal(exited.rootStatus, "exited");
  assert.deepEqual(exited.members.map((member) => member.pid), [4343]);

  await assert.rejects(
    inspectWindowsProcessTree(root, {
      deadlineMs: Date.now() + 500,
      windowsSystemRoot: WINDOWS_TEST_SYSTEM_ROOT,
      runCommand: async () => ({
        stdout: JSON.stringify({
          Status: "tree",
          RootStatus: "not_running",
          Processes: [{
            ...childEvidence,
            ProcessId: 4141,
            CreationDate: "2026-07-18T01:02:02.456Z",
          }],
        }),
      }),
    }),
    /ancestry was invalid/u,
  );

  await assert.rejects(
    inspectWindowsProcessTree(root, {
      windowsSystemRoot: WINDOWS_TEST_SYSTEM_ROOT,
      runCommand: async () => ({
        stdout: JSON.stringify({
          Status: "tree",
          RootStatus: "running",
          Processes: [{
            Status: "running",
            ProcessId: root.pid,
            CreationDate: "2026-07-18T01:02:05.456Z",
            ExecutablePath: root.executablePath,
            CommandLine: rootCommandLine,
          }],
        }),
      }),
    }),
    /root identity changed/u,
  );
});

test("Windows native identity adapter aborts and closes a non-returning helper at its deadline", async () => {
  const expected = {
    pid: 4242,
    createdAt: "2026-07-18T01:02:03.456Z",
    executablePath: "C:\\Program Files\\nodejs\\node.exe",
    commandHash: "a".repeat(64),
  };
  let helperAbortObserved = false;
  let helperCloseObserved = false;
  let helperPid = null;
  const startedAt = Date.now();

  await assert.rejects(
    classifyWindowsProcessIdentityFast(expected, {
      deadlineMs: Date.now() + 150,
      windowsSystemRoot: WINDOWS_TEST_SYSTEM_ROOT,
      runCommand: async (_command, _args, { signal }) => await new Promise((resolve, reject) => {
        const helper = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
          stdio: "ignore",
          windowsHide: true,
        });
        helperPid = helper.pid;
        signal?.addEventListener("abort", () => {
          helperAbortObserved = true;
          helper.kill("SIGKILL");
        }, { once: true });
        helper.once("close", () => {
          helperCloseObserved = true;
          resolve({ stdout: "" });
        });
        helper.once("error", reject);
      }),
    }),
    (error) => error?.code === "PROCESS_CONTROL_DEADLINE_EXCEEDED",
  );

  await waitFor(() => helperCloseObserved, 1_000);
  assert.equal(helperAbortObserved, true);
  assert.equal(helperCloseObserved, true);
  assert.equal(Number.isInteger(helperPid) && helperPid > 0 && helperPid !== expected.pid, true);
  assert.equal(Date.now() - startedAt < 1_500, true);
});

test("Windows native identity probe matches the stored full fingerprint for the live process", {
  skip: process.platform !== "win32",
}, async () => {
  // This real-host smoke includes PowerShell cold start on shared Windows runners.
  // Product process-control deadlines are covered independently by injected tests above.
  const nativeIdentitySmokeDeadlineMs = 15_000;
  const inspection = await inspectProcess(process.pid);
  assert.equal(inspection.status, "running");
  assert.equal(
    await classifyWindowsProcessIdentityFast(inspection.identity, {
      deadlineMs: Date.now() + nativeIdentitySmokeDeadlineMs,
    }),
    "owned",
  );
  assert.equal(
    await classifyWindowsProcessIdentityFast({
      ...inspection.identity,
      createdAt: new Date(Date.parse(inspection.identity.createdAt) + 1_000).toISOString(),
    }, { deadlineMs: Date.now() + nativeIdentitySmokeDeadlineMs }),
    "identity_mismatch",
  );
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
    await removeTempRoot(tempRoot);
  }
});

test("workspace process registry evicts only the oldest conclusively stopped owner at capacity", async () => {
  const { tempRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-process-registry-retention-");

  try {
    await recordProcessOwnership(workspaceRoot, {
      ownerType: "runtime",
      ownerId: "retired-template",
      generationId: "retired-generation",
      runtimeInstanceId: "retired-template",
      pid: process.pid,
      ownerRoot: tempRoot,
      lifecycleState: "running",
      source: "runtime",
    });
    await transitionProcessOwnership(workspaceRoot, "runtime", "retired-template", "stopped", "not_running");

    const registryPath = getProcessRegistryPath(workspaceRoot);
    const saturated = JSON.parse(await readFile(registryPath, "utf8"));
    const template = saturated.entries[0];
    saturated.entries = Array.from({ length: MAX_LIFECYCLE_ARRAY_LENGTH }, (_, index) => ({
      ...template,
      ownerId: `retired-${String(index).padStart(3, "0")}`,
      runtimeInstanceId: `retired-${String(index).padStart(3, "0")}`,
      recordedAt: new Date(index * 1_000).toISOString(),
      updatedAt: new Date(index * 1_000).toISOString(),
    }));
    await writeFile(registryPath, `${JSON.stringify(saturated, null, 2)}\n`, "utf8");

    await recordProcessOwnership(workspaceRoot, {
      ownerType: "runtime",
      ownerId: "current-runtime",
      generationId: "current-generation",
      runtimeInstanceId: "current-runtime",
      pid: process.pid,
      ownerRoot: tempRoot,
      lifecycleState: "running",
      source: "runtime",
    });

    const registry = await readProcessOwnershipRegistry(workspaceRoot);
    assert.equal(registry.entries.length, MAX_LIFECYCLE_ARRAY_LENGTH);
    assert.equal(registry.entries.some((entry) => entry.ownerId === "retired-000"), false);
    assert.equal(registry.entries.some((entry) => entry.ownerId === "current-runtime" && entry.identityStatus === "owned"), true);

    const saturatedWithActiveOwners = JSON.parse(await readFile(registryPath, "utf8"));
    const activeTemplate = registry.entries.find((entry) => entry.ownerId === "current-runtime");
    saturatedWithActiveOwners.entries = Array.from({ length: MAX_LIFECYCLE_ARRAY_LENGTH }, (_, index) => ({
      ...activeTemplate,
      ownerId: `active-${String(index).padStart(3, "0")}`,
      runtimeInstanceId: `active-${String(index).padStart(3, "0")}`,
    }));
    await writeFile(registryPath, `${JSON.stringify(saturatedWithActiveOwners, null, 2)}\n`, "utf8");

    await assert.rejects(
      recordProcessOwnership(workspaceRoot, {
        ownerType: "runtime",
        ownerId: "blocked-runtime",
        generationId: "blocked-generation",
        runtimeInstanceId: "blocked-runtime",
        pid: process.pid,
        ownerRoot: tempRoot,
        lifecycleState: "running",
        source: "runtime",
      }),
      /bounded entry count/u,
    );
    const unchanged = await readProcessOwnershipRegistry(workspaceRoot);
    assert.equal(unchanged.entries.length, MAX_LIFECYCLE_ARRAY_LENGTH);
    assert.equal(unchanged.entries.some((entry) => entry.ownerId === "blocked-runtime"), false);
    assert.equal(unchanged.entries.every((entry) => entry.lifecycleState === "running"), true);
  } finally {
    await removeTempRoot(tempRoot);
  }
});

test("workspace process registry never exposes ownership after the retained process handle changes", async () => {
  const { tempRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-process-handle-change-");
  const commandLine = '"C:\\Program Files\\nodejs\\node.exe" service.mjs';
  const identity = {
    ProcessId: 4242,
    CreationDate: "2026-07-18T01:02:03.456Z",
    ExecutablePath: "C:\\Program Files\\nodejs\\node.exe",
    CommandLine: commandLine,
  };
  let verificationCount = 0;

  try {
    await assert.rejects(
      recordProcessOwnership(workspaceRoot, {
        ownerType: "service",
        ownerId: "changed-handle-service",
        serviceId: "changed-handle-service",
        pid: 4242,
        ownerRoot: tempRoot,
        lifecycleState: "launching",
        source: "spawn",
        verifyInspectedProcess: () => {
          verificationCount += 1;
          return verificationCount === 1;
        },
      }, windowsInspector(identity)),
      /retained process handle changed/u,
    );
    assert.equal(verificationCount, 2);
    assert.equal(await findProcessOwnership(workspaceRoot, "service", "changed-handle-service"), null);
    assert.deepEqual((await readProcessOwnershipRegistry(workspaceRoot)).entries, []);
  } finally {
    await removeTempRoot(tempRoot);
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
    await removeTempRoot(tempRoot);
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
    await removeTempRoot(tempRoot);
  }
});

test("legacy Windows PID migration accepts a launcher alias only when it resolves to the inspected executable", {
  skip: process.platform !== "win32",
}, async () => {
  const { tempRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-legacy-executable-alias-");
  const executableRoot = path.join(tempRoot, "canonical-runtime");
  const aliasRoot = path.join(tempRoot, "runtime-alias");
  const executablePath = path.join(executableRoot, "fixture-node.exe");
  const aliasPath = path.join(aliasRoot, "fixture-node.exe");
  const differentExecutablePath = path.join(executableRoot, "different-node.exe");
  const command = `${aliasPath} service.mjs`;

  try {
    await mkdir(executableRoot, { recursive: true });
    await writeFile(executablePath, "fixture executable identity\n", "utf8");
    await writeFile(differentExecutablePath, "different executable identity\n", "utf8");
    await symlink(executableRoot, aliasRoot, "junction");

    const migrated = await migrateLegacyProcessOwnership(workspaceRoot, {
      ownerId: "legacy-alias-service",
      serviceId: "legacy-alias-service",
      pid: 8124,
      startedAt: "2026-07-18T02:03:04.000Z",
      command,
      expectedExecutablePath: aliasPath,
      ownerRoot: tempRoot,
      inspectorDependencies: windowsInspector({
        ProcessId: 8124,
        CreationDate: "2026-07-18T02:03:04.000Z",
        ExecutablePath: executablePath,
        CommandLine: command,
      }),
    });

    assert.deepEqual(migrated, { status: "owned", migrated: true, reason: "legacy_identity_verified" });
    const ownership = await findProcessOwnership(workspaceRoot, "service", "legacy-alias-service");
    assert.equal(ownership.identity.executablePath, path.win32.normalize(executablePath));

    const mismatch = await migrateLegacyProcessOwnership(workspaceRoot, {
      ownerId: "legacy-alias-service",
      serviceId: "legacy-alias-service",
      pid: 8124,
      startedAt: "2026-07-18T02:03:04.000Z",
      command,
      expectedExecutablePath: differentExecutablePath,
      ownerRoot: tempRoot,
      inspectorDependencies: windowsInspector({
        ProcessId: 8124,
        CreationDate: "2026-07-18T02:03:04.000Z",
        ExecutablePath: executablePath,
        CommandLine: command,
      }),
    });
    assert.deepEqual(mismatch, {
      status: "identity_mismatch",
      migrated: false,
      reason: "executable_mismatch",
    });
  } finally {
    await removeTempRoot(tempRoot);
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
    await removeTempRoot(tempRoot);
  }
});

test("rehydration serializes legacy process ownership migration for one workspace", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-rehydrate-serial-");
  const first = await writeExecutableFixtureService(servicesRoot, "serial-rehydrate-one");
  const second = await writeExecutableFixtureService(servicesRoot, "serial-rehydrate-two");
  const startedAt = new Date().toISOString();
  let activeInspections = 0;
  let maxActiveInspections = 0;

  async function writeLegacyRuntime(serviceRoot, pid, port) {
    const stateRoot = path.join(serviceRoot, ".state");
    await mkdir(stateRoot, { recursive: true });
    await writeFile(path.join(stateRoot, "install.json"), JSON.stringify({ installed: true }), "utf8");
    await writeFile(path.join(stateRoot, "config.json"), JSON.stringify({ configured: true }), "utf8");
    await writeFile(
      path.join(stateRoot, "runtime.json"),
      JSON.stringify({
        running: true,
        pid,
        startedAt,
        command: `${process.execPath} serial-rehydrate-fixture.mjs`,
        ports: { service: port },
        lastAction: "start",
        actionHistory: ["install", "config", "start"],
      }),
      "utf8",
    );
  }

  const processInspectorDependencies = {
    platform: "win32",
    windowsSystemRoot: WINDOWS_TEST_SYSTEM_ROOT,
    runCommand: async () => {
      activeInspections += 1;
      maxActiveInspections = Math.max(maxActiveInspections, activeInspections);
      await new Promise((resolve) => setTimeout(resolve, 100));
      activeInspections -= 1;
      return { stdout: "" };
    },
  };

  try {
    await writeLegacyRuntime(first.serviceRoot, 41001, 18101);
    await writeLegacyRuntime(second.serviceRoot, 41002, 18102);

    const discovered = await discoverServices(servicesRoot);
    await rehydrateDiscoveredServices(discovered, { workspaceRoot, processInspectorDependencies });

    assert.equal(maxActiveInspections, 1);
    assert.equal(await findProcessOwnership(workspaceRoot, "service", "serial-rehydrate-one"), null);
    assert.equal(await findProcessOwnership(workspaceRoot, "service", "serial-rehydrate-two"), null);
  } finally {
    resetLifecycleState();
    await removeTempRoot(tempRoot);
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
    await removeTempRoot(tempRoot);
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
    await removeTempRoot(tempRoot);
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
    await removeTempRoot(tempRoot);
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

    const restart = await postJson(`${apiServer.url}/api/services/adopted-restart-service/restart`, { confirm: true });

    assert.equal(restart.response.status, 200, JSON.stringify(restart.body));
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
    await removeTempRoot(tempRoot);
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

    const stopStartedAt = Date.now();
    const stopped = await stopManagedProcess("adopted-stop-service", PROCESS_TREE_STOP_CONVERGENCE_TIMEOUT_MS);
    assert.ok(stopped);
    assert.equal(Date.now() - stopStartedAt < PROCESS_TREE_STOP_CONVERGENCE_TIMEOUT_MS + 1_000, true);
    await waitForProcessesStopped([root.pid, childPid, grandchildPid]);
    assert.equal(hasManagedProcess("adopted-stop-service"), false);
    const ownership = await findProcessOwnership(workspaceRoot, "service", "adopted-stop-service");
    assert.equal(ownership.lifecycleState, "stopped");
    assert.equal(ownership.pid, null);
  } finally {
    await stopManagedProcess("adopted-stop-service", PROCESS_TREE_STOP_CONVERGENCE_TIMEOUT_MS).catch(() => null);
    forceCleanupProcesses([root.pid, childPid, grandchildPid]);
    resetLifecycleState();
    await removeTempRoot(tempRoot);
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

    const stopped = await stopManagedProcess("process-tree-service", PROCESS_TREE_STOP_CONVERGENCE_TIMEOUT_MS);

    assert.ok(stopped);
    await waitForProcessesStopped([handle.pid, childPid, grandchildPid]);
    const stoppedOwnership = await findProcessOwnership(workspaceRoot, "service", "process-tree-service");
    assert.equal(stoppedOwnership.lifecycleState, "stopped");
    assert.equal(stoppedOwnership.pid, null);
  } finally {
    await stopManagedProcess("process-tree-service", PROCESS_TREE_STOP_CONVERGENCE_TIMEOUT_MS).catch(() => null);
    forceCleanupProcesses([handle?.pid, childPid, grandchildPid]);
    resetLifecycleState();
    await removeTempRoot(tempRoot);
  }
});

test("Windows enrollment gate prevents service descendants before the first ownership inspection", {
  skip: process.platform !== "win32",
}, async () => {
  resetLifecycleState();
  const priorTestHooks = process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
  process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = "1";
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-enrollment-gate-");
  const { serviceRoot, scriptPath } = await writeExecutableFixtureService(servicesRoot, "enrollment-gate-service");
  const pidFilePath = await writeStubbornProcessTreeFixture(serviceRoot, scriptPath);

  try {
    setManagedProcessEnrollmentHookForTests(async (child) => {
      const closed = new Promise((resolve) => child.once("close", resolve));
      assert.equal(child.kill("SIGKILL"), true);
      await closed;
    });
    const [service] = await discoverServices(servicesRoot);
    await assert.rejects(
      startManagedProcess({
        service,
        executionPlan: createDirectExecutionPlan(service.manifest),
        workspaceRoot,
      }),
      (error) => {
        assert.match(error.message, /process_not_running|process handle changed/u);
        assert.equal(managedProcessStartFailurePhase(error), "ownership_recording");
        return true;
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    await assert.rejects(readFile(pidFilePath, "utf8"), { code: "ENOENT" });
    assert.equal(await findProcessOwnership(workspaceRoot, "service", "enrollment-gate-service"), null);
  } finally {
    setManagedProcessEnrollmentHookForTests(null);
    if (priorTestHooks === undefined) delete process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
    else process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = priorTestHooks;
    resetLifecycleState();
    await removeTempRoot(tempRoot);
  }
});

test("Windows launcher progress authenticates split records and suppresses malformed or partial internals", () => {
  const priorTestHooks = process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
  process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = "1";
  const token = "ab".repeat(32);
  const phase = "launcher_file_hash";
  const digest = createHmac("sha256", token).update(phase, "utf8").digest("hex");
  const checkpoint = `__SERVICE_LASSO_LAUNCHER_PROGRESS__:${phase}:${digest}`;
  const sinks = { stderr: [], combined: [], variables: [] };
  let observedPhase = null;
  let buffer = "";
  const route = (line, flushRemainder = false) => {
    const result = filterWindowsManagedLauncherProgressLineForTests(token, line, flushRemainder);
    observedPhase = result.phase ?? observedPhase;
    if (!result.suppressed) {
      sinks.stderr.push(line);
      sinks.combined.push(line);
      sinks.variables.push(line);
    }
  };

  try {
    assert.doesNotMatch(checkpoint, new RegExp(token, "u"));
    for (const chunk of [checkpoint.slice(0, 11), checkpoint.slice(11, 47), `${checkpoint.slice(47)}\n`]) {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) route(line);
    }
    route("__SERVICE_LASSO_LAUNCHER_PROGRESS__:launcher_file_open:" + "0".repeat(64));
    route("__SERVICE_LASSO_LAUNCHER_PROG", true);
    assert.deepEqual(sinks, { stderr: [], combined: [], variables: [] });
    assert.equal(observedPhase, phase);
    assert.deepEqual(
      filterWindowsManagedLauncherProgressLineForTests(null, checkpoint),
      { suppressed: true, phase: null },
    );
  } finally {
    if (priorTestHooks === undefined) delete process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
    else process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = priorTestHooks;
  }
});

test("Windows managed launcher rejects missing, oversized, corrupt, and redirected native assets before spawn", {
  skip: process.platform !== "win32",
}, async () => {
  resetLifecycleState();
  const priorTestHooks = process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
  process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = "1";
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-launcher-integrity-");
  const nativeBytes = await readFile(path.resolve("dist/runtime/execution/windows-managed-launcher-native.exe"));
  const fixtureRoot = path.join(tempRoot, "launcher-assets");
  const missingPath = path.join(fixtureRoot, "missing", "launcher.exe");
  const oversizedPath = path.join(fixtureRoot, "oversized", "launcher.exe");
  const corruptPath = path.join(fixtureRoot, "corrupt", "launcher.exe");
  const trustedRoot = path.join(fixtureRoot, "trusted");
  const redirectedRoot = path.join(fixtureRoot, "redirected");
  const redirectedPath = path.join(redirectedRoot, "launcher.exe");

  try {
    await writeExecutableFixtureService(servicesRoot, "launcher-integrity-service");
    await Promise.all([
      mkdir(path.dirname(oversizedPath), { recursive: true }),
      mkdir(path.dirname(corruptPath), { recursive: true }),
      mkdir(trustedRoot, { recursive: true }),
    ]);
    await writeFile(oversizedPath, Buffer.concat([nativeBytes, Buffer.from([0])]));
    const corruptBytes = Buffer.from(nativeBytes);
    corruptBytes[corruptBytes.length - 1] ^= 0xff;
    await writeFile(corruptPath, corruptBytes);
    await writeFile(path.join(trustedRoot, "launcher.exe"), nativeBytes);
    await symlink(trustedRoot, redirectedRoot, "junction");
    const [service] = await discoverServices(servicesRoot);

    for (const launcherPath of [missingPath, oversizedPath, corruptPath, redirectedPath]) {
      setWindowsManagedLauncherPathForTests(launcherPath);
      await assert.rejects(
        startManagedProcess({
          service,
          executionPlan: createDirectExecutionPlan(service.manifest),
          workspaceRoot,
        }),
        (error) => {
          assert.equal(managedProcessStartFailurePhase(error), "launch_state_creation");
          return true;
        },
      );
      assert.equal(await findProcessOwnership(workspaceRoot, "service", service.manifest.id), null);
      assert.equal(hasManagedProcess(service.manifest.id), false);
    }
  } finally {
    setWindowsManagedLauncherPathForTests(null);
    if (priorTestHooks === undefined) delete process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
    else process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = priorTestHooks;
    resetLifecycleState();
    await removeTempRoot(tempRoot);
  }
});

test("Windows managed launcher revalidates its native asset after launch-state creation", {
  skip: process.platform !== "win32",
}, async () => {
  resetLifecycleState();
  const priorTestHooks = process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
  process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = "1";
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-launcher-revalidation-");
  const launcherPath = path.join(tempRoot, "launcher.exe");
  const nativeBytes = await readFile(path.resolve("dist/runtime/execution/windows-managed-launcher-native.exe"));
  const corruptBytes = Buffer.from(nativeBytes);
  corruptBytes[corruptBytes.length - 1] ^= 0xff;

  try {
    await writeExecutableFixtureService(servicesRoot, "launcher-revalidation-service");
    await writeFile(launcherPath, nativeBytes);
    setWindowsManagedLauncherPathForTests(await realpath(launcherPath));
    setManagedProcessLaunchStateCreatedHookForTests(async () => {
      await writeFile(launcherPath, corruptBytes);
    });
    const [service] = await discoverServices(servicesRoot);
    await assert.rejects(
      startManagedProcess({
        service,
        executionPlan: createDirectExecutionPlan(service.manifest),
        workspaceRoot,
      }),
      (error) => {
        assert.equal(managedProcessStartFailurePhase(error), "wrapper_spawn", error.message);
        assert.match(error.message, /integrity verification failed/u);
        return true;
      },
    );
    assert.equal(await findProcessOwnership(workspaceRoot, "service", service.manifest.id), null);
    assert.equal(hasManagedProcess(service.manifest.id), false);
  } finally {
    setManagedProcessLaunchStateCreatedHookForTests(null);
    setWindowsManagedLauncherPathForTests(null);
    if (priorTestHooks === undefined) delete process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
    else process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = priorTestHooks;
    resetLifecycleState();
    await removeTempRoot(tempRoot);
  }
});

test("Windows managed launcher rejects non-closed or mistyped payload envelopes", {
  skip: process.platform !== "win32",
}, async () => {
  const { tempRoot } = await makeTempServicesRoot("service-lasso-launcher-payload-");
  const launcherPath = path.resolve("dist/runtime/execution/windows-managed-launcher-native.exe");
  const gatePath = path.join(tempRoot, "release.gate");
  const basePayload = {
    executable: process.execPath,
    args: [],
    workingDirectory: tempRoot,
    ackPath: path.join(tempRoot, "launched.pid"),
    filesBoundPath: path.join(tempRoot, "files-bound.gate"),
    continuePath: path.join(tempRoot, "continue.gate"),
    releaseToken: "11".repeat(32),
    filesBoundToken: "22".repeat(32),
    continueToken: "33".repeat(32),
    ackToken: "44".repeat(32),
    approvedFiles: [],
    executableBindingIndex: -1,
    requireExecutableBinding: false,
    argumentBindings: [],
    targetEnvironmentOverrides: [],
    postResumeDelayMilliseconds: 0,
  };
  const canonicalPayload = JSON.stringify(basePayload);
  const duplicatePayload = canonicalPayload.replace(
    '{"executable":',
    `{"executable":${JSON.stringify(process.execPath)},"executable":`,
  );
  const invalidPayloads = [
    JSON.stringify({ ...basePayload, unexpected: true }),
    JSON.stringify({ ...basePayload, args: [null] }),
    JSON.stringify({ ...basePayload, args: ["before\u0000after"] }),
    JSON.stringify({ ...basePayload, ackPath: "\\rooted-but-not-qualified" }),
    JSON.stringify({ ...basePayload, executableBindingIndex: "-1" }),
    JSON.stringify({
      ...basePayload,
      approvedFiles: [{ file: process.execPath, sha256: "aa".repeat(32), size: 1, unexpected: true }],
    }),
    JSON.stringify({
      ...basePayload,
      args: ["value"],
      approvedFiles: [{ file: process.execPath, sha256: "aa".repeat(32), size: 1 }],
      argumentBindings: [{ index: 0, prefix: null, bindingIndex: 0 }],
    }),
    JSON.stringify({ ...basePayload, targetEnvironmentOverrides: [{ name: "COR_ENABLE_PROFILING", value: null }] }),
    duplicatePayload,
  ];
  const bootstrapEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !/^(?:COR_|CORECLR_|COMPLUS_|APPDOMAIN_MANAGER)/iu.test(name)),
  );

  try {
    for (const payloadJson of invalidPayloads) {
      const result = await new Promise((resolve, reject) => {
        const child = spawn(launcherPath, [], {
          cwd: tempRoot,
          env: {
            ...bootstrapEnvironment,
            SERVICE_LASSO_MANAGED_LAUNCH_PAYLOAD: Buffer.from(payloadJson, "utf8").toString("base64"),
            SERVICE_LASSO_MANAGED_LAUNCH_GATE: gatePath,
            SERVICE_LASSO_MANAGED_LAUNCH_PROGRESS_TOKEN: "55".repeat(32),
          },
          stdio: "ignore",
          windowsHide: true,
        });
        const timeout = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error("Invalid managed-launch payload was not rejected boundedly."));
        }, 5_000);
        child.once("error", reject);
        child.once("close", (exitCode, signal) => {
          clearTimeout(timeout);
          resolve({ exitCode, signal });
        });
      });
      assert.deepEqual(result, { exitCode: 1, signal: null });
      await assert.rejects(readFile(basePayload.filesBoundPath, "utf8"), { code: "ENOENT" });
    }
  } finally {
    await removeTempRoot(tempRoot);
  }
});

test("synchronous wrapper spawn failures retain their typed phase and clean pre-enrollment state", async () => {
  resetLifecycleState();
  const priorTestHooks = process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
  process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = "1";
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-sync-spawn-failure-");
  await writeExecutableFixtureService(servicesRoot, "sync-spawn-failure-service");

  try {
    setManagedProcessSpawnerForTests(() => {
      throw new Error("injected synchronous spawn failure");
    });
    const [service] = await discoverServices(servicesRoot);
    await assert.rejects(
      startManagedProcess({
        service,
        executionPlan: createDirectExecutionPlan(service.manifest),
        workspaceRoot,
      }),
      (error) => {
        assert.equal(managedProcessStartFailurePhase(error), "wrapper_spawn");
        assert.match(error.message, /injected synchronous spawn failure/u);
        return true;
      },
    );
    assert.equal(await findProcessOwnership(workspaceRoot, "service", "sync-spawn-failure-service"), null);
    assert.equal(hasManagedProcess("sync-spawn-failure-service"), false);
  } finally {
    setManagedProcessSpawnerForTests(null);
    if (priorTestHooks === undefined) delete process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
    else process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = priorTestHooks;
    resetLifecycleState();
    await removeTempRoot(tempRoot);
  }
});

test("Windows managed launcher preserves target stdin and separate stdout and stderr streams", {
  skip: process.platform !== "win32",
}, async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-launch-stdio-");
  const { serviceRoot, scriptPath } = await writeExecutableFixtureService(servicesRoot, "launch-stdio-service");
  let handle;

  try {
    await writeFile(scriptPath, `
process.stdin.setEncoding("utf8");
process.stdin.once("data", (input) => {
  const value = input.trim();
  process.stdout.write("launcher-stdout:" + value + "\\n");
  process.stderr.write("launcher-stderr:" + value + "\\n");
});
setInterval(() => {}, 1000);
`.trim(), "utf8");
    const manifestPath = path.join(serviceRoot, "service.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.stdin = { enabled: true, provider: "direct" };
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

    const [service] = await discoverServices(servicesRoot);
    handle = await startManagedProcess({
      service,
      executionPlan: createDirectExecutionPlan(service.manifest),
      workspaceRoot,
    });
    assert.deepEqual(await writeManagedProcessStdin("launch-stdio-service", "verified-stdio"), {
      ok: true,
      byteLength: Buffer.byteLength("verified-stdio\n"),
      newlineAppended: true,
    });
    await waitFor(async () => {
      const [stdout, stderr] = await Promise.all([
        readFile(handle.logs.stdoutPath, "utf8"),
        readFile(handle.logs.stderrPath, "utf8"),
      ]);
      return stdout.includes("launcher-stdout:verified-stdio") &&
        stderr.includes("launcher-stderr:verified-stdio");
    }, 5_000);
    const stdout = await readFile(handle.logs.stdoutPath, "utf8");
    const stderr = await readFile(handle.logs.stderrPath, "utf8");
    assert.match(stdout, /launcher-stdout:verified-stdio/u);
    assert.doesNotMatch(stdout, /launcher-stderr/u);
    assert.match(stderr, /launcher-stderr:verified-stdio/u);
    assert.doesNotMatch(stderr, /launcher-stdout/u);
    assert.doesNotMatch(stderr, /__SERVICE_LASSO_LAUNCHER_PROGRESS__/u);
  } finally {
    await stopManagedProcess("launch-stdio-service", 10_000).catch(() => null);
    forceCleanupProcesses([handle?.pid]);
    resetLifecycleState();
    await removeTempRoot(tempRoot);
  }
});

test("Windows managed launcher round-trips empty, quoted, spaced, trailing-slash, and Unicode arguments", {
  skip: process.platform !== "win32",
}, async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-launch-argv-");
  const { serviceRoot, scriptPath } = await writeExecutableFixtureService(servicesRoot, "launch-argv-service");
  const markerPath = path.join(serviceRoot, "runtime", "argv.json");
  const expectedArgs = [
    "",
    "two words",
    'quote"inside',
    "trailing\\",
    "space and trailing\\",
    "forward/",
    "Unicode-雪-🦝",
  ];
  let handle;

  try {
    await writeFile(scriptPath, `
import { writeFile } from "node:fs/promises";
await writeFile(${JSON.stringify(markerPath)}, JSON.stringify(process.argv.slice(2)), "utf8");
setInterval(() => {}, 1000);
`.trim(), "utf8");
    const manifestPath = path.join(serviceRoot, "service.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.args = [path.relative(serviceRoot, scriptPath), ...expectedArgs];
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    const [service] = await discoverServices(servicesRoot);
    handle = await startManagedProcess({
      service,
      executionPlan: createDirectExecutionPlan(service.manifest),
      workspaceRoot,
    });
    await waitFor(async () => {
      try {
        return JSON.parse(await readFile(markerPath, "utf8"));
      } catch (error) {
        if (error?.code === "ENOENT") return false;
        throw error;
      }
    }, 5_000);
    assert.deepEqual(JSON.parse(await readFile(markerPath, "utf8")), expectedArgs);
  } finally {
    await stopManagedProcess("launch-argv-service", 10_000).catch(() => null);
    forceCleanupProcesses([handle?.pid]);
    resetLifecycleState();
    await removeTempRoot(tempRoot);
  }
});

test("Windows managed launcher strips loader controls from bootstrap and restores them only for the target", {
  skip: process.platform !== "win32",
}, async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-launch-environment-");
  const loaderEnvironment = {
    cOr_EnAbLe_PrOfIlInG: "1",
    CoR_ProFiLeR: "{11111111-1111-1111-1111-111111111111}",
    CoreClr_Profiler_Path: "C:\\missing\\service-lasso-profiler.dll",
    comPlus_ServiceLassoProbe: "target-complus",
    AppDomain_Manager_Type: "TargetOnlyManager",
  };
  const { serviceRoot } = await writeExecutableFixtureService(servicesRoot, "launch-environment-service", {
    env: loaderEnvironment,
    captureEnvKeys: Object.keys(loaderEnvironment),
  });
  const snapshotPath = path.join(serviceRoot, "runtime", "env.json");
  let handle;

  try {
    const [service] = await discoverServices(servicesRoot);
    handle = await startManagedProcess({
      service,
      executionPlan: createDirectExecutionPlan(service.manifest),
      workspaceRoot,
    });
    await waitFor(async () => {
      try {
        return JSON.parse(await readFile(snapshotPath, "utf8"));
      } catch (error) {
        if (error?.code === "ENOENT") return false;
        throw error;
      }
    }, 5_000);
    assert.deepEqual(JSON.parse(await readFile(snapshotPath, "utf8")), loaderEnvironment);
  } finally {
    await stopManagedProcess("launch-environment-service", 10_000).catch(() => null);
    forceCleanupProcesses([handle?.pid]);
    resetLifecycleState();
    await removeTempRoot(tempRoot);
  }
});

test("Windows managed launcher rejects same-size approved script changes after guarded preflight", {
  skip: process.platform !== "win32",
}, async () => {
  resetLifecycleState();
  const priorTestHooks = process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
  process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = "1";
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-launch-byte-binding-");
  const { serviceRoot, scriptPath } = await writeExecutableFixtureService(servicesRoot, "launch-byte-binding-service");
  const markerPath = path.join(serviceRoot, "runtime", "service-executed.marker");
  const approvedScript = `
import { writeFile } from "node:fs/promises";
await writeFile(${JSON.stringify(markerPath)}, "executed\\n", "utf8");
setInterval(() => {}, 1000);
`.trim();
  const changedScript = approvedScript.replace('"executed\\n"', '"mutated!\\n"');
  const approvedBinding = {
    file: scriptPath,
    sha256: createHash("sha256").update(approvedScript).digest("hex"),
    size: Buffer.byteLength(approvedScript),
  };
  let verificationCount = 0;

  try {
    await writeFile(scriptPath, approvedScript, "utf8");
    assert.equal(Buffer.byteLength(changedScript), approvedBinding.size);
    const executableBytes = await readFile(process.execPath);
    const executableBinding = {
      file: process.execPath,
      sha256: createHash("sha256").update(executableBytes).digest("hex"),
      size: executableBytes.byteLength,
    };
    setManagedProcessEnrollmentHookForTests(async () => {
      await writeFile(scriptPath, changedScript, "utf8");
    });
    const [service] = await discoverServices(servicesRoot);
    await assert.rejects(
      startManagedProcess({
        service,
        executionPlan: createDirectExecutionPlan(service.manifest),
        workspaceRoot,
        verifyBeforeSpawn: async () => {
          verificationCount += 1;
          const current = await readFile(scriptPath);
          assert.equal(createHash("sha256").update(current).digest("hex"), approvedBinding.sha256);
          return [executableBinding, approvedBinding];
        },
      }),
      (error) => {
        assert.match(
          error.message,
          /Windows managed launcher exited before (?:executable files were bound|the service launch was acknowledged)/u,
        );
        assert.equal(managedProcessStartFailurePhase(error), "launcher_file_hash");
        return true;
      },
    );
    assert.equal(verificationCount, 1);
    await assert.rejects(readFile(markerPath, "utf8"), { code: "ENOENT" });
    const stopped = await findProcessOwnership(workspaceRoot, "service", "launch-byte-binding-service");
    assert.equal(stopped.lifecycleState, "stopped");
    assert.equal(stopped.pid, null);
  } finally {
    setManagedProcessEnrollmentHookForTests(null);
    await stopManagedProcess("launch-byte-binding-service", 5_000).catch(() => null);
    if (priorTestHooks === undefined) delete process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
    else process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = priorTestHooks;
    resetLifecycleState();
    await removeTempRoot(tempRoot);
  }
});

test("Windows managed launcher holds approved files through post-resume acknowledgment failure containment", {
  skip: process.platform !== "win32",
}, async () => {
  resetLifecycleState();
  const priorTestHooks = process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
  process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = "1";
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-launch-ack-containment-");
  const { serviceRoot, scriptPath } = await writeExecutableFixtureService(servicesRoot, "launch-ack-containment-service");
  const markerPath = path.join(serviceRoot, "runtime", "ack-containment.marker");
  const approvedScript = `
import { writeFile } from "node:fs/promises";
await writeFile(${JSON.stringify(markerPath)}, JSON.stringify({ pid: process.pid }), "utf8");
const launchState = "approved";
void launchState;
setInterval(() => {}, 1000);
`.trim();
  const changedScript = approvedScript.replace('"approved"', '"mutated!"');
  let mutationAttempts = 0;
  let mutationPromise = null;
  let stopMutation = false;

  try {
    assert.equal(Buffer.byteLength(changedScript), Buffer.byteLength(approvedScript));
    await writeFile(scriptPath, approvedScript, "utf8");
    const executableBytes = await readFile(process.execPath);
    const bindings = [
      {
        file: process.execPath,
        sha256: createHash("sha256").update(executableBytes).digest("hex"),
        size: executableBytes.byteLength,
      },
      {
        file: scriptPath,
        sha256: createHash("sha256").update(approvedScript).digest("hex"),
        size: Buffer.byteLength(approvedScript),
      },
    ];
    setManagedProcessFilesBoundHookForTests(async () => {
      const launchStateRoot = path.join(workspaceRoot, ".service-lasso", "runtime", "managed-launch");
      const stateDirectories = await readdir(launchStateRoot, { withFileTypes: true });
      const stateDirectory = stateDirectories.find((entry) => entry.isDirectory());
      assert.ok(stateDirectory);
      await mkdir(path.join(launchStateRoot, stateDirectory.name, "launched.pid"));
      mutationPromise = (async () => {
        while (!stopMutation) {
          mutationAttempts += 1;
          try {
            await writeFile(scriptPath, changedScript, "utf8");
            const targetEvidence = JSON.parse(await readFile(markerPath, "utf8"));
            let targetIsRunning = true;
            try {
              process.kill(targetEvidence.pid, 0);
            } catch (error) {
              if (error?.code !== "ESRCH") throw error;
              targetIsRunning = false;
            }
            return { targetEvidence, targetIsRunning };
          } catch (error) {
            if (!error || typeof error !== "object" || !["EACCES", "EBUSY", "EPERM"].includes(error.code)) {
              throw error;
            }
          }
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        throw new Error("Mutation retry stopped before the launch file was released.");
      })();
    });
    setManagedProcessPostResumeDelayForTests(1_000);
    const [service] = await discoverServices(servicesRoot);
    await assert.rejects(
      startManagedProcess({
        service,
        executionPlan: createDirectExecutionPlan(service.manifest),
        workspaceRoot,
        verifyBeforeSpawn: async () => bindings,
      }),
      (error) => {
        assert.equal(managedProcessStartFailurePhase(error), "target_acknowledgement");
        return true;
      },
    );
    assert.ok(mutationPromise);
    const mutationObservation = await mutationPromise;
    assert.equal(mutationAttempts > 1, true);
    assert.equal(await readFile(scriptPath, "utf8"), changedScript);
    assert.equal(Number.isInteger(mutationObservation.targetEvidence.pid) && mutationObservation.targetEvidence.pid > 0, true);
    assert.equal(mutationObservation.targetIsRunning, false);
    const stopped = await findProcessOwnership(workspaceRoot, "service", "launch-ack-containment-service");
    assert.equal(stopped.lifecycleState, "stopped");
    assert.equal(stopped.pid, null);
  } finally {
    stopMutation = true;
    await mutationPromise?.catch(() => undefined);
    setManagedProcessPostResumeDelayForTests(null);
    setManagedProcessFilesBoundHookForTests(null);
    await stopManagedProcess("launch-ack-containment-service", 5_000).catch(() => null);
    if (priorTestHooks === undefined) delete process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
    else process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = priorTestHooks;
    resetLifecycleState();
    await removeTempRoot(tempRoot);
  }
});

test("Windows managed launcher ignores pre-created workspace gate and acknowledgement files", {
  skip: process.platform !== "win32",
}, async () => {
  resetLifecycleState();
  const priorTestHooks = process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
  process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = "1";
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-launch-token-gates-");
  const { serviceRoot, scriptPath } = await writeExecutableFixtureService(servicesRoot, "launch-token-gates-service");
  const markerPath = path.join(serviceRoot, "runtime", "token-gates.marker");
  let verificationCount = 0;
  let handle;

  try {
    await writeFile(scriptPath, `
import { writeFile } from "node:fs/promises";
await writeFile(${JSON.stringify(markerPath)}, "executed", "utf8");
setInterval(() => {}, 1000);
`.trim(), "utf8");
    const executableBytes = await readFile(process.execPath);
    const scriptBytes = await readFile(scriptPath);
    const bindings = [
      {
        file: process.execPath,
        sha256: createHash("sha256").update(executableBytes).digest("hex"),
        size: executableBytes.byteLength,
      },
      {
        file: scriptPath,
        sha256: createHash("sha256").update(scriptBytes).digest("hex"),
        size: scriptBytes.byteLength,
      },
    ];
    setManagedProcessEnrollmentHookForTests(async () => {
      const launchStateRoot = path.join(workspaceRoot, ".service-lasso", "runtime", "managed-launch");
      const stateDirectories = await readdir(launchStateRoot, { withFileTypes: true });
      const stateDirectory = stateDirectories.find((entry) => entry.isDirectory());
      assert.ok(stateDirectory);
      const stateRoot = path.join(launchStateRoot, stateDirectory.name);
      await Promise.all([
        writeFile(path.join(stateRoot, "files-bound.gate"), "forged", "utf8"),
        writeFile(path.join(stateRoot, "continue.gate"), "forged", "utf8"),
        writeFile(path.join(stateRoot, "launched.pid"), JSON.stringify({ token: "forged", pid: process.pid }), "utf8"),
      ]);
    });
    const [service] = await discoverServices(servicesRoot);
    handle = await startManagedProcess({
      service,
      executionPlan: createDirectExecutionPlan(service.manifest),
      workspaceRoot,
      verifyBeforeSpawn: async () => {
        verificationCount += 1;
        if (verificationCount === 2) {
          await assert.rejects(readFile(markerPath, "utf8"), { code: "ENOENT" });
        }
        return bindings;
      },
    });
    assert.equal(verificationCount, 2);
    await waitFor(async () => {
      try {
        return (await readFile(markerPath, "utf8")) === "executed";
      } catch (error) {
        if (error?.code === "ENOENT") return false;
        throw error;
      }
    }, 5_000);
  } finally {
    setManagedProcessEnrollmentHookForTests(null);
    await stopManagedProcess("launch-token-gates-service", 10_000).catch(() => null);
    forceCleanupProcesses([handle?.pid]);
    if (priorTestHooks === undefined) delete process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
    else process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = priorTestHooks;
    resetLifecycleState();
    await removeTempRoot(tempRoot);
  }
});

test("Windows guarded launch refuses an executable that is not bound to approved bytes", {
  skip: process.platform !== "win32",
}, async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-launch-unbound-executable-");
  const { serviceRoot } = await writeExecutableFixtureService(servicesRoot, "launch-unbound-executable-service");

  try {
    const manifestPath = path.join(serviceRoot, "service.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.executable = "service-lasso-deliberately-unresolved-executable";
    manifest.args = [];
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    const [service] = await discoverServices(servicesRoot);
    await assert.rejects(
      startManagedProcess({
        service,
        executionPlan: createDirectExecutionPlan(service.manifest),
        workspaceRoot,
        guardedExecutableLaunch: true,
      }),
      /Windows managed launcher exited before executable files were bound/u,
    );
    const stopped = await findProcessOwnership(workspaceRoot, "service", "launch-unbound-executable-service");
    assert.equal(stopped.lifecycleState, "stopped");
    assert.equal(stopped.pid, null);
  } finally {
    await stopManagedProcess("launch-unbound-executable-service", 10_000).catch(() => null);
    resetLifecycleState();
    await removeTempRoot(tempRoot);
  }
});

test("Windows managed launcher executes canonical approved bytes after a junction is retargeted", {
  skip: process.platform !== "win32",
}, async () => {
  resetLifecycleState();
  const priorTestHooks = process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
  process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = "1";
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-launch-canonical-binding-");
  const { serviceRoot } = await writeExecutableFixtureService(servicesRoot, "launch-canonical-binding-service");
  const approvedRoot = path.join(serviceRoot, "runtime", "approved-target");
  const changedRoot = path.join(serviceRoot, "runtime", "changed-target");
  const aliasRoot = path.join(serviceRoot, "runtime", "launch-alias");
  const approvedScriptPath = path.join(approvedRoot, "entry.mjs");
  const changedScriptPath = path.join(changedRoot, "entry.mjs");
  const aliasScriptPath = path.join(aliasRoot, "entry.mjs");
  const markerPath = path.join(serviceRoot, "runtime", "canonical-binding.marker");
  const approvedScript = `
import { writeFile } from "node:fs/promises";
await writeFile(${JSON.stringify(markerPath)}, "approved", "utf8");
setInterval(() => {}, 1000);
`.trim();
  const changedScript = approvedScript.replace('"approved"', '"mutated!"');
  let handle;

  try {
    assert.equal(Buffer.byteLength(changedScript), Buffer.byteLength(approvedScript));
    await mkdir(approvedRoot, { recursive: true });
    await mkdir(changedRoot, { recursive: true });
    await writeFile(approvedScriptPath, approvedScript, "utf8");
    await writeFile(changedScriptPath, changedScript, "utf8");
    await symlink(approvedRoot, aliasRoot, "junction");
    const manifestPath = path.join(serviceRoot, "service.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.args = [path.relative(serviceRoot, aliasScriptPath)];
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

    const executableBytes = await readFile(process.execPath);
    const approvedBytes = await readFile(aliasScriptPath);
    const bindings = [
      {
        file: process.execPath,
        sha256: createHash("sha256").update(executableBytes).digest("hex"),
        size: executableBytes.byteLength,
      },
      {
        file: aliasScriptPath,
        sha256: createHash("sha256").update(approvedBytes).digest("hex"),
        size: approvedBytes.byteLength,
      },
    ];
    setManagedProcessFilesBoundHookForTests(async () => {
      await rm(aliasRoot, { recursive: true, force: true });
      await symlink(changedRoot, aliasRoot, "junction");
    });
    const [service] = await discoverServices(servicesRoot);
    handle = await startManagedProcess({
      service,
      executionPlan: createDirectExecutionPlan(service.manifest),
      workspaceRoot,
      verifyBeforeSpawn: async () => bindings,
    });
    await waitFor(async () => {
      try {
        return (await readFile(markerPath, "utf8")) === "approved";
      } catch (error) {
        if (error?.code === "ENOENT") return false;
        throw error;
      }
    }, 5_000);
    assert.equal(await readFile(markerPath, "utf8"), "approved");
  } finally {
    setManagedProcessFilesBoundHookForTests(null);
    await stopManagedProcess("launch-canonical-binding-service", 10_000).catch(() => null);
    forceCleanupProcesses([handle?.pid]);
    if (priorTestHooks === undefined) delete process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
    else process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = priorTestHooks;
    resetLifecycleState();
    await removeTempRoot(tempRoot);
  }
});

test("Windows enrollment containment failure returns boundedly and retains truthful live ownership", {
  skip: process.platform !== "win32",
}, async () => {
  resetLifecycleState();
  const priorTestHooks = process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
  process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = "1";
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-enrollment-containment-failure-");
  const { serviceRoot, scriptPath } = await writeExecutableFixtureService(servicesRoot, "enrollment-containment-failure-service");
  let verificationCount = 0;

  try {
    setManagedProcessTreeTerminatorForTests(async () => {
      throw new Error("injected containment failure");
    });
    const [service] = await discoverServices(servicesRoot);
    const executableBytes = await readFile(process.execPath);
    const scriptBytes = await readFile(scriptPath);
    const bindings = [
      {
        file: process.execPath,
        sha256: createHash("sha256").update(executableBytes).digest("hex"),
        size: executableBytes.byteLength,
      },
      {
        file: scriptPath,
        sha256: createHash("sha256").update(scriptBytes).digest("hex"),
        size: scriptBytes.byteLength,
      },
    ];
    const startedAt = Date.now();
    await assert.rejects(
      startManagedProcess({
        service,
        executionPlan: createDirectExecutionPlan(service.manifest),
        workspaceRoot,
        verifyBeforeSpawn: async () => {
          verificationCount += 1;
          if (verificationCount === 2) {
            throw new Error("injected final executable verification failure");
          }
          return bindings;
        },
      }),
      (error) => {
        assert.equal(error instanceof AggregateError, true);
        assert.match(error.message, /containment both failed/u);
        assert.equal(managedProcessStartFailurePhase(error), "binding_revalidation");
        return true;
      },
    );
    assert.equal(Date.now() - startedAt < 20_000, true);
    assert.equal(verificationCount, 2);
    assert.equal(hasManagedProcess("enrollment-containment-failure-service"), true);
    const retained = await findProcessOwnership(
      workspaceRoot,
      "service",
      "enrollment-containment-failure-service",
    );
    assert.equal(retained.lifecycleState, "launching");
    assert.equal(retained.identityStatus, "owned");

    setManagedProcessTreeTerminatorForTests(null);
    await stopManagedProcess("enrollment-containment-failure-service", 10_000);
    const stopped = await findProcessOwnership(
      workspaceRoot,
      "service",
      "enrollment-containment-failure-service",
    );
    assert.equal(stopped.lifecycleState, "stopped");
    assert.equal(stopped.pid, null);
  } finally {
    setManagedProcessTreeTerminatorForTests(null);
    await stopManagedProcess("enrollment-containment-failure-service", 10_000).catch(() => null);
    if (priorTestHooks === undefined) delete process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
    else process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = priorTestHooks;
    resetLifecycleState();
    await removeTempRoot(tempRoot);
  }
});

test("Windows launch-state cleanup failure preserves the owning start phase and stopped reconciliation", {
  skip: process.platform !== "win32",
}, async () => {
  resetLifecycleState();
  const priorTestHooks = process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
  process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = "1";
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-launch-cleanup-failure-");
  await writeExecutableFixtureService(servicesRoot, "launch-cleanup-failure-service");

  try {
    setManagedProcessAfterReleaseHookForTests(async () => {
      throw new Error("injected post-release failure");
    });
    setManagedProcessLaunchStateRemoverForTests(async () => {
      throw new Error("injected launch-state cleanup failure");
    });
    const [service] = await discoverServices(servicesRoot);
    await assert.rejects(
      startManagedProcess({
        service,
        executionPlan: createDirectExecutionPlan(service.manifest),
        workspaceRoot,
      }),
      (error) => {
        assert.equal(managedProcessStartFailurePhase(error), "post_release_hook");
        assert.match(error.message, /launch-state cleanup also failed/u);
        return true;
      },
    );
    const stopped = await findProcessOwnership(workspaceRoot, "service", "launch-cleanup-failure-service");
    assert.equal(stopped.lifecycleState, "stopped");
    assert.equal(stopped.pid, null);
    assert.equal(hasManagedProcess("launch-cleanup-failure-service"), false);
  } finally {
    setManagedProcessAfterReleaseHookForTests(null);
    setManagedProcessLaunchStateRemoverForTests(null);
    await stopManagedProcess("launch-cleanup-failure-service", 10_000).catch(() => null);
    if (priorTestHooks === undefined) delete process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
    else process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = priorTestHooks;
    resetLifecycleState();
    await removeTempRoot(tempRoot);
  }
});

test("Windows primary launch-state cleanup failure is typed and reconciles stopped ownership", {
  skip: process.platform !== "win32",
}, async () => {
  resetLifecycleState();
  const priorTestHooks = process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
  process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = "1";
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-primary-launch-cleanup-failure-");
  await writeExecutableFixtureService(servicesRoot, "primary-launch-cleanup-failure-service");

  try {
    setManagedProcessLaunchStateRemoverForTests(async () => {
      throw new Error("injected primary launch-state cleanup failure");
    });
    const [service] = await discoverServices(servicesRoot);
    await assert.rejects(
      startManagedProcess({
        service,
        executionPlan: createDirectExecutionPlan(service.manifest),
        workspaceRoot,
      }),
      (error) => {
        assert.equal(managedProcessStartFailurePhase(error), "launch_state_cleanup");
        assert.match(error.message, /launch-state cleanup also failed/u);
        return true;
      },
    );
    const stopped = await findProcessOwnership(
      workspaceRoot,
      "service",
      "primary-launch-cleanup-failure-service",
    );
    assert.equal(stopped.lifecycleState, "stopped");
    assert.equal(stopped.pid, null);
    assert.equal(hasManagedProcess("primary-launch-cleanup-failure-service"), false);
  } finally {
    setManagedProcessLaunchStateRemoverForTests(null);
    await stopManagedProcess("primary-launch-cleanup-failure-service", 10_000).catch(() => null);
    if (priorTestHooks === undefined) delete process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
    else process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = priorTestHooks;
    resetLifecycleState();
    await removeTempRoot(tempRoot);
  }
});

test("API preserves and can stop truthful running state after enrollment containment fails", {
  skip: process.platform !== "win32",
}, async () => {
  resetLifecycleState();
  const priorTestHooks = process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
  process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = "1";
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-api-containment-failure-");
  const { serviceRoot } = await writeExecutableFixtureService(servicesRoot, "api-containment-failure-service");
  let apiServer;

  try {
    const stateRoot = path.join(serviceRoot, ".state");
    await mkdir(stateRoot, { recursive: true });
    await writeFile(path.join(stateRoot, "install.json"), JSON.stringify({ installed: true }), "utf8");
    await writeFile(path.join(stateRoot, "config.json"), JSON.stringify({ configured: true }), "utf8");
    apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot });
    setManagedProcessAfterReleaseHookForTests(async () => {
      throw new Error("injected post-release enrollment failure");
    });
    setManagedProcessTreeTerminatorForTests(async () => {
      throw new Error("injected containment failure");
    });

    const start = await postJson(`${apiServer.url}/api/services/api-containment-failure-service/start`);
    assert.equal(start.response.status, 409);
    const retainedState = getLifecycleState("api-containment-failure-service");
    assert.equal(retainedState.running, true);
    assert.equal(
      retainedState.runtime.startTrace.current.events.find((event) =>
        event.phase === "process_spawn" && event.status === "failed"
      ).metadata.processStartFailurePhase,
      "post_release_hook",
    );
    assert.equal(retainedState.runtime.pid > 0, true);
    assert.equal(hasManagedProcess("api-containment-failure-service"), true);
    const persisted = await readStoredState(serviceRoot);
    assert.equal(persisted.runtime.running, true);
    assert.equal(persisted.runtime.pid, retainedState.runtime.pid);
    const retainedOwnership = await findProcessOwnership(
      workspaceRoot,
      "service",
      "api-containment-failure-service",
    );
    assert.equal(retainedOwnership.lifecycleState, "launching");
    assert.equal(retainedOwnership.identityStatus, "owned");

    setManagedProcessAfterReleaseHookForTests(null);
    setManagedProcessTreeTerminatorForTests(null);
    const stop = await postJson(`${apiServer.url}/api/services/api-containment-failure-service/stop`, { confirm: true });
    assert.equal(stop.response.status, 200);
    assert.equal(stop.body.state.running, false);
    assert.equal(hasManagedProcess("api-containment-failure-service"), false);
    const stopped = await findProcessOwnership(workspaceRoot, "service", "api-containment-failure-service");
    assert.equal(stopped.lifecycleState, "stopped");
    assert.equal(stopped.pid, null);
  } finally {
    setManagedProcessAfterReleaseHookForTests(null);
    setManagedProcessTreeTerminatorForTests(null);
    await apiServer?.stop();
    await stopManagedProcess("api-containment-failure-service", 10_000).catch(() => null);
    if (priorTestHooks === undefined) delete process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
    else process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = priorTestHooks;
    resetLifecycleState();
    await removeTempRoot(tempRoot);
  }
});

test("API restart preserves and can stop truthful replacement state after enrollment containment fails", {
  skip: process.platform !== "win32",
}, async () => {
  resetLifecycleState();
  const priorTestHooks = process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
  process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = "1";
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-api-restart-containment-failure-");
  const { serviceRoot } = await writeExecutableFixtureService(servicesRoot, "api-restart-containment-failure-service");
  let apiServer;

  try {
    const stateRoot = path.join(serviceRoot, ".state");
    await mkdir(stateRoot, { recursive: true });
    await writeFile(path.join(stateRoot, "install.json"), JSON.stringify({ installed: true }), "utf8");
    await writeFile(path.join(stateRoot, "config.json"), JSON.stringify({ configured: true }), "utf8");
    apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot });
    const start = await postJson(`${apiServer.url}/api/services/api-restart-containment-failure-service/start`);
    assert.equal(start.response.status, 200, JSON.stringify(start.body));
    const originalPid = start.body.state.runtime.pid;
    assert.equal(originalPid > 0, true);

    setManagedProcessAfterReleaseHookForTests(async () => {
      setManagedProcessTreeTerminatorForTests(async () => {
        throw new Error("injected restart containment failure");
      });
      throw new Error("injected restart post-release enrollment failure");
    });
    const restart = await postJson(
      `${apiServer.url}/api/services/api-restart-containment-failure-service/restart`,
      { confirm: true },
    );
    assert.equal(restart.response.status, 409, JSON.stringify(restart.body));
    const retainedState = getLifecycleState("api-restart-containment-failure-service");
    assert.equal(retainedState.running, true);
    assert.equal(retainedState.runtime.pid > 0, true);
    assert.notEqual(retainedState.runtime.pid, originalPid);
    assert.equal(hasManagedProcess("api-restart-containment-failure-service"), true);
    const persisted = await readStoredState(serviceRoot);
    assert.equal(persisted.runtime.running, true);
    assert.equal(persisted.runtime.pid, retainedState.runtime.pid);
    const retainedOwnership = await findProcessOwnership(
      workspaceRoot,
      "service",
      "api-restart-containment-failure-service",
    );
    assert.equal(retainedOwnership.lifecycleState, "launching");
    assert.equal(retainedOwnership.identityStatus, "owned");

    setManagedProcessAfterReleaseHookForTests(null);
    setManagedProcessTreeTerminatorForTests(null);
    const stop = await postJson(
      `${apiServer.url}/api/services/api-restart-containment-failure-service/stop`,
      { confirm: true },
    );
    assert.equal(stop.response.status, 200);
    assert.equal(stop.body.state.running, false);
    assert.equal(hasManagedProcess("api-restart-containment-failure-service"), false);
    const stopped = await findProcessOwnership(
      workspaceRoot,
      "service",
      "api-restart-containment-failure-service",
    );
    assert.equal(stopped.lifecycleState, "stopped");
    assert.equal(stopped.pid, null);
  } finally {
    setManagedProcessAfterReleaseHookForTests(null);
    setManagedProcessTreeTerminatorForTests(null);
    await apiServer?.stop();
    await stopManagedProcess("api-restart-containment-failure-service", 10_000).catch(() => null);
    if (priorTestHooks === undefined) delete process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
    else process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = priorTestHooks;
    resetLifecycleState();
    await removeTempRoot(tempRoot);
  }
});

test("API restart persists stopped state when ordinary replacement enrollment fails", {
  skip: process.platform !== "win32",
}, async () => {
  resetLifecycleState();
  const priorTestHooks = process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
  process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = "1";
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-api-restart-enrollment-failure-");
  const { serviceRoot } = await writeExecutableFixtureService(servicesRoot, "api-restart-enrollment-failure-service");
  let apiServer;

  try {
    const stateRoot = path.join(serviceRoot, ".state");
    await mkdir(stateRoot, { recursive: true });
    await writeFile(path.join(stateRoot, "install.json"), JSON.stringify({ installed: true }), "utf8");
    await writeFile(path.join(stateRoot, "config.json"), JSON.stringify({ configured: true }), "utf8");
    apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot });
    const start = await postJson(`${apiServer.url}/api/services/api-restart-enrollment-failure-service/start`);
    assert.equal(start.response.status, 200, JSON.stringify(start.body));
    const originalPid = start.body.state.runtime.pid;
    assert.equal(originalPid > 0, true);

    setManagedProcessEnrollmentHookForTests(async (child) => {
      const closed = new Promise((resolve) => child.once("close", resolve));
      assert.equal(child.kill("SIGKILL"), true);
      await closed;
    });
    const restart = await postJson(
      `${apiServer.url}/api/services/api-restart-enrollment-failure-service/restart`,
      { confirm: true },
    );
    assert.equal(restart.response.status, 409, JSON.stringify(restart.body));
    const stoppedState = getLifecycleState("api-restart-enrollment-failure-service");
    assert.equal(stoppedState.running, false);
    assert.equal(stoppedState.runtime.pid, null);
    assert.equal(hasManagedProcess("api-restart-enrollment-failure-service"), false);
    const persisted = await readStoredState(serviceRoot);
    assert.equal(persisted.runtime.running, false);
    assert.equal(persisted.runtime.pid, null);
    const ownership = await findProcessOwnership(
      workspaceRoot,
      "service",
      "api-restart-enrollment-failure-service",
    );
    assert.equal(ownership.lifecycleState, "stopped");
    assert.equal(ownership.pid, null);
  } finally {
    setManagedProcessEnrollmentHookForTests(null);
    await apiServer?.stop();
    await stopManagedProcess("api-restart-enrollment-failure-service", 10_000).catch(() => null);
    if (priorTestHooks === undefined) delete process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
    else process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = priorTestHooks;
    resetLifecycleState();
    await removeTempRoot(tempRoot);
  }
});

test("managed unexpected root exit terminates the remaining verified process tree", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-managed-root-exit-");
  const { serviceRoot, scriptPath } = await writeExecutableFixtureService(servicesRoot, "managed-root-exit-service");
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

    assert.equal(process.kill(handle.pid, "SIGKILL"), true);
    await waitForProcessesStopped([handle.pid, childPid, grandchildPid], 12_000);
    await waitForManagedProcessFinalization("managed-root-exit-service", Date.now() + 12_000);
    assert.equal(hasManagedProcess("managed-root-exit-service"), false);
    const stoppedOwnership = await findProcessOwnership(workspaceRoot, "service", "managed-root-exit-service");
    assert.equal(stoppedOwnership.lifecycleState, "stopped");
    assert.equal(stoppedOwnership.pid, null);
  } finally {
    await stopManagedProcess("managed-root-exit-service", 100).catch(() => null);
    forceCleanupProcesses([handle?.pid, childPid, grandchildPid]);
    resetLifecycleState();
    await removeTempRoot(tempRoot);
  }
});

test("managed Windows job contains a child spawned after enrollment when the service root exits before refresh", {
  skip: process.platform !== "win32",
}, async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-managed-late-child-");
  const { serviceRoot, scriptPath } = await writeExecutableFixtureService(servicesRoot, "managed-late-child-service");
  const triggerPath = path.join(serviceRoot, "runtime", "launch-child.trigger");
  const pidFilePath = await writeStubbornProcessTreeFixture(serviceRoot, scriptPath, {
    childTriggerFilePath: triggerPath,
    rootExitAfterChildMs: 750,
  });
  let handle;
  let rootPid = null;
  let childPid = null;
  let grandchildPid = null;

  try {
    const [service] = await discoverServices(servicesRoot);
    handle = await startManagedProcess({
      service,
      executionPlan: createDirectExecutionPlan(service.manifest),
      workspaceRoot,
    });
    await writeFile(triggerPath, "launch\n", "utf8");
    const pids = await readProcessTreePids(pidFilePath);
    rootPid = pids.rootPid;
    childPid = pids.childPid;
    grandchildPid = pids.grandchildPid;

    await waitForManagedProcessFinalization("managed-late-child-service", Date.now() + 15_000);
    await waitForProcessesStopped([handle.pid, rootPid, childPid, grandchildPid], 15_000);
    assert.equal(hasManagedProcess("managed-late-child-service"), false);
    const stopped = await findProcessOwnership(workspaceRoot, "service", "managed-late-child-service");
    assert.equal(stopped.lifecycleState, "stopped");
    assert.equal(stopped.pid, null);
  } finally {
    await stopManagedProcess("managed-late-child-service", 100).catch(() => null);
    forceCleanupProcesses([handle?.pid, rootPid, childPid, grandchildPid]);
    resetLifecycleState();
    await removeTempRoot(tempRoot);
  }
});

test("managed Windows root auto-exit contains its verified child and grandchild process tree", {
  skip: process.platform !== "win32",
}, async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-managed-root-auto-exit-");
  const { serviceRoot, scriptPath } = await writeExecutableFixtureService(servicesRoot, "managed-root-auto-exit-service");
  const pidFilePath = await writeStubbornProcessTreeFixture(serviceRoot, scriptPath, { rootAutoExitMs: 35_000 });
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

    await waitForManagedProcessFinalization("managed-root-auto-exit-service", Date.now() + 45_000);
    await waitForProcessesStopped([handle.pid, childPid, grandchildPid], 15_000);
    assert.equal(hasManagedProcess("managed-root-auto-exit-service"), false);
    const stoppedOwnership = await findProcessOwnership(workspaceRoot, "service", "managed-root-auto-exit-service");
    assert.equal(stoppedOwnership.lifecycleState, "stopped");
    assert.equal(stoppedOwnership.pid, null);
  } finally {
    await stopManagedProcess("managed-root-auto-exit-service", 100).catch(() => null);
    forceCleanupProcesses([handle?.pid, childPid, grandchildPid]);
    resetLifecycleState();
    await removeTempRoot(tempRoot);
  }
});

test("managed Windows enrollment rejects and contains a root that exits during initial tree capture", {
  skip: process.platform !== "win32",
}, async () => {
  resetLifecycleState();
  const priorTestHooks = process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
  process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = "1";
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-managed-enrollment-exit-");
  const { serviceRoot, scriptPath } = await writeExecutableFixtureService(servicesRoot, "managed-enrollment-exit-service");
  const pidFilePath = await writeStubbornProcessTreeFixture(serviceRoot, scriptPath);
  let rootPid = null;
  let childPid = null;
  let grandchildPid = null;

  try {
    setManagedProcessAfterReleaseHookForTests(async () => {
      const pids = await readProcessTreePids(pidFilePath);
      rootPid = pids.rootPid;
      childPid = pids.childPid;
      grandchildPid = pids.grandchildPid;
      assert.equal(process.kill(rootPid, "SIGKILL"), true);
    });
    const [service] = await discoverServices(servicesRoot);
    const startPromise = startManagedProcess({
      service,
      executionPlan: createDirectExecutionPlan(service.manifest),
      workspaceRoot,
    });
    const rejectedStart = assert.rejects(
      startPromise,
      /root exited during ownership enrollment/u,
    );
    await rejectedStart;

    await waitForProcessesStopped([rootPid, childPid, grandchildPid], 15_000);
    assert.equal(hasManagedProcess("managed-enrollment-exit-service"), false);
    const stoppedOwnership = await findProcessOwnership(workspaceRoot, "service", "managed-enrollment-exit-service");
    assert.equal(stoppedOwnership.lifecycleState, "stopped");
    assert.equal(stoppedOwnership.pid, null);
  } finally {
    setManagedProcessAfterReleaseHookForTests(null);
    await stopManagedProcess("managed-enrollment-exit-service", 100).catch(() => null);
    forceCleanupProcesses([rootPid, childPid, grandchildPid]);
    if (priorTestHooks === undefined) delete process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
    else process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = priorTestHooks;
    resetLifecycleState();
    await removeTempRoot(tempRoot);
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
    await removeTempRoot(tempRoot);
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
    await removeTempRoot(tempRoot);
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
  const rootClosed = new Promise((resolve) => root.once("close", resolve));
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

    const stopped = await stopManagedProcess("adopted-process-tree-service", PROCESS_TREE_STOP_CONVERGENCE_TIMEOUT_MS);

    assert.ok(stopped);
    await waitForProcessesStopped([root.pid, childPid, grandchildPid]);
    await rootClosed;
    const stoppedOwnership = await findProcessOwnership(workspaceRoot, "service", "adopted-process-tree-service");
    assert.equal(stoppedOwnership.lifecycleState, "stopped");
    assert.equal(stoppedOwnership.pid, null);
  } finally {
    await stopManagedProcess("adopted-process-tree-service", PROCESS_TREE_STOP_CONVERGENCE_TIMEOUT_MS).catch(() => null);
    forceCleanupProcesses([root.pid, childPid, grandchildPid]);
    resetLifecycleState();
    await removeTempRoot(tempRoot);
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
    await removeTempRoot(tempRoot);
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
    }, 20_000);
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

    const stoppedResponse = await postJson(`${apiServer.url}/api/services/owned-service/stop`, { confirm: true });
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
    await removeTempRoot(tempRoot);
  }
});

async function occupyLoopbackPort(port) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return server;
}

async function writeInstalledRuntimeState(serviceRoot, runtime) {
  const stateRoot = path.join(serviceRoot, ".state");
  await mkdir(stateRoot, { recursive: true });
  await writeFile(path.join(stateRoot, "install.json"), JSON.stringify({ installed: true }), "utf8");
  await writeFile(path.join(stateRoot, "config.json"), JSON.stringify({ configured: true }), "utf8");
  await writeFile(path.join(stateRoot, "runtime.json"), JSON.stringify(runtime), "utf8");
}

test("runtime restart adopts a registry owner even when runtime.json discarded running state", async () => {
  resetLifecycleState();
  const preferredPort = 18241;
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-registry-adopt-alive-");
  const { serviceRoot, scriptPath } = await writeExecutableFixtureService(servicesRoot, "registry-adopt-alive", {
    ports: { service: preferredPort },
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
    await recordProcessOwnership(workspaceRoot, {
      ownerType: "service",
      ownerId: "registry-adopt-alive",
      serviceId: "registry-adopt-alive",
      pid: child.pid,
      ownerRoot: serviceRoot,
      ports: { service: preferredPort },
      lifecycleState: "running",
      source: "spawn",
    });
    await writeInstalledRuntimeState(serviceRoot, {
      running: false,
      pid: child.pid,
      startedAt: inspection.identity.createdAt,
      command: `${process.execPath} ${relativeScriptPath}`,
      ports: { service: preferredPort },
      lastAction: "start",
      actionHistory: ["install", "config", "start"],
    });

    apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot });
    const detail = await fetch(`${apiServer.url}/api/services/registry-adopt-alive`);
    const detailBody = await detail.json();
    assert.equal(detail.status, 200);
    assert.equal(detailBody.service.lifecycle.running, true);
    assert.equal(detailBody.service.lifecycle.runtime.pid, child.pid);
    assert.deepEqual(detailBody.service.lifecycle.runtime.ports, { service: preferredPort });
    assert.equal(hasManagedProcess("registry-adopt-alive"), true);

    const health = await fetch(`${apiServer.url}/api/services/registry-adopt-alive/health`);
    const healthBody = await health.json();
    assert.equal(health.status, 200);
    assert.equal(healthBody.health.healthy, true);

    const doctor = await fetch(`${apiServer.url}/api/runtime/doctor`);
    const doctorBody = await doctor.json();
    const serviceOwner = doctorBody.doctor.ownership.services.find((entry) => entry.ownerId === "registry-adopt-alive");
    assert.equal(serviceOwner.identityStatus, "owned");
    assert.equal(serviceOwner.pid, child.pid);

    const start = await postJson(`${apiServer.url}/api/services/registry-adopt-alive/start`);
    assert.equal(start.response.status, 409);
    assert.equal(hasManagedProcess("registry-adopt-alive"), true);
    assert.equal(getLifecycleState("registry-adopt-alive").runtime.pid, child.pid);
    assert.equal(child.exitCode, null);

    const stopped = await postJson(`${apiServer.url}/api/runtime/actions/stopAll`, { confirm: true });
    assert.equal(stopped.response.status, 200);
    await waitFor(() => child.exitCode !== null || child.signalCode !== null);
    assert.equal(hasManagedProcess("registry-adopt-alive"), false);
    const ownership = await findProcessOwnership(workspaceRoot, "service", "registry-adopt-alive");
    assert.equal(ownership.lifecycleState, "stopped");
    assert.equal(ownership.pid, null);
  } finally {
    await apiServer?.stop();
    await stopAllManagedProcesses().catch(() => null);
    child.kill("SIGKILL");
    resetLifecycleState();
    await removeTempRoot(tempRoot);
  }
});

test("start renegotiates a retained port when the old process is gone and the preference is occupied", async () => {
  resetLifecycleState();
  const preferredPort = 18242;
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-registry-port-renegotiate-");
  const { serviceRoot, scriptPath } = await writeExecutableFixtureService(servicesRoot, "registry-port-renegotiate", {
    ports: { service: preferredPort },
  });
  const occupant = await occupyLoopbackPort(preferredPort);

  try {
    await writeInstalledRuntimeState(serviceRoot, {
      running: false,
      pid: 424242,
      startedAt: "2026-08-31T00:00:00.000Z",
      command: `${process.execPath} ${path.relative(serviceRoot, scriptPath)}`,
      ports: { service: preferredPort },
      lastAction: "start",
      actionHistory: ["install", "config", "start"],
    });
    const discovered = await discoverServices(servicesRoot);
    const rehydrated = await rehydrateLifecycleState(discovered[0], { workspaceRoot });
    assert.equal(rehydrated.running, false);
    assert.equal(rehydrated.runtime.pid, null);
    assert.deepEqual(rehydrated.runtime.ports, { service: preferredPort });

    const registry = createServiceRegistry(discovered);
    const started = await startService(discovered[0], registry, { workspaceRoot });
    assert.equal(started.ok, true);
    assert.equal(started.state.running, true);
    assert.notEqual(started.state.runtime.ports.service, preferredPort);
    assert.equal(occupant.listening, true);

    await stopService(discovered[0], { workspaceRoot });
  } finally {
    await new Promise((resolve) => occupant.close(resolve));
    await stopManagedProcess("registry-port-renegotiate", 500).catch(() => null);
    resetLifecycleState();
    await removeTempRoot(tempRoot);
  }
});

test("registry identity mismatch clears stale ownership without terminating the live process", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-registry-identity-mismatch-");
  const { serviceRoot, scriptPath } = await writeExecutableFixtureService(servicesRoot, "registry-identity-mismatch", {
    ports: { service: 18243 },
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
    await recordProcessOwnership(workspaceRoot, {
      ownerType: "service",
      ownerId: "registry-identity-mismatch",
      serviceId: "registry-identity-mismatch",
      pid: child.pid,
      ownerRoot: serviceRoot,
      ports: { service: 18243 },
      lifecycleState: "running",
      source: "spawn",
    });
    const registryPath = getProcessRegistryPath(workspaceRoot);
    const registry = JSON.parse(await readFile(registryPath, "utf8"));
    registry.entries[0].identity.commandHash = hashProcessCommandLine("unrelated-process-command");
    await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
    await writeInstalledRuntimeState(serviceRoot, {
      running: false,
      pid: child.pid,
      startedAt: inspection.identity.createdAt,
      command: `${process.execPath} ${relativeScriptPath}`,
      ports: { service: 18243 },
      lastAction: "start",
      actionHistory: ["install", "config", "start"],
    });

    const [service] = await discoverServices(servicesRoot);
    const rehydrated = await rehydrateLifecycleState(service, { workspaceRoot });
    assert.equal(rehydrated.running, false);
    assert.equal(rehydrated.runtime.pid, null);
    assert.equal(rehydrated.runtime.startTrace.current.events[0].metadata.processOwnerStatus, "identity_mismatch");
    assert.equal(child.exitCode, null);
    assert.equal(child.signalCode, null);
    assert.equal(hasManagedProcess("registry-identity-mismatch"), false);

    const ownership = await findProcessOwnership(workspaceRoot, "service", "registry-identity-mismatch");
    assert.equal(ownership.identityStatus, "identity_mismatch");
    assert.equal(ownership.pid, null);
  } finally {
    child.kill("SIGKILL");
    resetLifecycleState();
    await removeTempRoot(tempRoot);
  }
});
