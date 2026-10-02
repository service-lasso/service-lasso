import assert from "node:assert/strict";
import test from "node:test";
import { inspectWindowsProcessTree, hashProcessCommandLine } from "../dist/runtime/process/identity.js";
import { projectWindowsTreeInspectionMetadata, windowsTreeInspectionFailureMetadata, windowsNativeInspectionFailure } from "../dist/runtime/process/windows-tree-inspection-diagnostics.js";
import { lifecycleFailureDiagnostic } from "./lifecycle-failure-diagnostics.js";

const root = { pid: 4342, createdAt: "2026-07-18T01:02:03.456Z", executablePath: "C:\\private\\node.exe", commandHash: "private-command-hash" };

test("native failure codes distinguish root/descendant denial without forwarding unknown exit values", () => {
  assert.equal(windowsNativeInspectionFailure(31), "root_open_denied");
  assert.equal(windowsNativeInspectionFailure(131), "descendant_open_denied");
  for (const value of [null, 0, 1, 2, 999, NaN, Infinity, "private-secret", "toString"]) {
    assert.equal(windowsNativeInspectionFailure(value), null);
  }
  const evidence = projectWindowsTreeInspectionMetadata({ windowsTreeInspectionPhase: "native_snapshot",
    windowsTreeInspectionLastRetry: windowsNativeInspectionFailure(131), command: "private-secret" });
  assert.equal(evidence.windowsTreeInspectionLastRetry, "descendant_open_denied");
  assert.equal(JSON.stringify(evidence).includes("private-secret"), false);
});

test("queued deadline reports queue time and never starts the expired helper", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const first = inspectWindowsProcessTree(root, { runCommand: async () => {
    entered(); await gate;
    return { stdout: '{"Status":"tree","RootStatus":"not_running","Processes":[]}' };
  } });
  await started;
  let calls = 0;
  try {
    await assert.rejects(inspectWindowsProcessTree(root, {
      deadlineMs: Date.now() + 80,
      runCommand: async () => { calls += 1; return { stdout: "private-output" }; },
    }), error => {
      assert.equal(error.code, "PROCESS_CONTROL_DEADLINE_EXCEEDED");
      const evidence = windowsTreeInspectionFailureMetadata(error);
      assert.equal(evidence.windowsTreeInspectionPhase, "queue_wait");
      assert.equal(evidence.windowsTreeInspectionAttempts, 0);
      assert.equal(evidence.windowsTreeInspectionNativeMs, 0);
      assert.equal(evidence.windowsTreeInspectionNativeHelperSpawned, false);
      assert.equal(evidence.windowsTreeInspectionNativeHelperExited, false);
      assert.equal(evidence.windowsTreeInspectionNativeHelperStdioClosed, false);
      assert.equal(evidence.windowsTreeInspectionNativeResultCompleted, false);
      assert.equal(evidence.windowsTreeInspectionNativeSpawnWaitMs, null);
      assert.ok(evidence.windowsTreeInspectionQueueMs >= 40);
      assert.equal(JSON.stringify(error).includes("private"), false);
      return true;
    });
  } finally { release(); await first; }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 0);
});

test("stalled native snapshot reports active elapsed time without changing its deadline", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const startedAt = Date.now();
  try {
    await assert.rejects(inspectWindowsProcessTree(root, {
      deadlineMs: Date.now() + 100,
      runCommand: async () => { await gate; return { stdout: "private-output" }; },
    }), error => {
      assert.equal(error.code, "PROCESS_CONTROL_DEADLINE_EXCEEDED");
      const evidence = windowsTreeInspectionFailureMetadata(error);
      assert.equal(evidence.windowsTreeInspectionPhase, "native_snapshot");
      assert.equal(evidence.windowsTreeInspectionAttempts, 1);
      assert.ok(evidence.windowsTreeInspectionNativeMs >= 50);
      assert.ok(Date.now() - startedAt < 1500);
      return true;
    });
  } finally { release(); }
  await new Promise(resolve => setImmediate(resolve));
});

test("native snapshot deadline distinguishes observed helper settlement from result completion", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  try {
    await assert.rejects(inspectWindowsProcessTree(root, {
      deadlineMs: Date.now() + 140,
      runCommand: async (_command, _args, options) => {
        options.onPhase?.("spawned");
        await new Promise(resolve => setTimeout(resolve, 15));
        options.onPhase?.("exited");
        await new Promise(resolve => setTimeout(resolve, 15));
        options.onPhase?.("stdio_closed");
        await gate;
        return { stdout: "private-output" };
      },
    }), error => {
      assert.equal(error.code, "PROCESS_CONTROL_DEADLINE_EXCEEDED");
      const evidence = windowsTreeInspectionFailureMetadata(error);
      assert.equal(evidence.windowsTreeInspectionNativeHelperSpawned, true);
      assert.equal(evidence.windowsTreeInspectionNativeHelperExited, true);
      assert.equal(evidence.windowsTreeInspectionNativeHelperStdioClosed, true);
      assert.equal(evidence.windowsTreeInspectionNativeResultCompleted, false);
      assert.ok(evidence.windowsTreeInspectionNativeSpawnWaitMs <= 40);
      assert.ok(evidence.windowsTreeInspectionNativeWorkMs >= 10);
      assert.ok(evidence.windowsTreeInspectionNativeStdioCloseMs >= 10);
      assert.ok(evidence.windowsTreeInspectionNativeResultCompletionMs >= 40);
      assert.equal(JSON.stringify(evidence).includes("private"), false);
      return true;
    });
  } finally {
    release();
  }
  await new Promise(resolve => setImmediate(resolve));
});

test("repeated rejected snapshots retain closed retry evidence and hide raw output", async () => {
  await assert.rejects(inspectWindowsProcessTree(root, {
    deadlineMs: Date.now() + 180,
    runCommand: async () => ({ stdout: "private-output-secret-path" }),
  }), error => {
    assert.equal(error.message, "Native Windows process-tree evidence was malformed.");
    const evidence = windowsTreeInspectionFailureMetadata(error);
    assert.ok(evidence.windowsTreeInspectionAttempts >= 2);
    assert.ok(evidence.windowsTreeInspectionRetries >= 1);
    assert.equal(evidence.windowsTreeInspectionLastRetry, "malformed");
    assert.equal(lifecycleFailureDiagnostic({ error }).includes("private"), false);
    return true;
  });
  await assert.rejects(inspectWindowsProcessTree(root, {
    deadlineMs: Date.now() + 80,
    runCommand: async () => ({
      exitCode: 138,
      stdout: '{"CommandQueryHeldHandleState":"exit_query_failed","CommandQueryHeldHandleState":"still_active_or_259","CommandQueryArchitectureRelation":"same"}',
    }),
  }), error => {
    const evidence = windowsTreeInspectionFailureMetadata(error);
    assert.equal(evidence.windowsTreeInspectionLastRetry, "descendant_command_partial_copy");
    assert.equal(evidence.windowsTreeInspectionCommandQueryHeldHandleState, undefined);
    assert.equal(evidence.windowsTreeInspectionCommandQueryArchitectureRelation, undefined);
    return true;
  });
});

test("projection excludes arbitrary fields, invalid codes and unbounded numbers", () => {
  const evidence = projectWindowsTreeInspectionMetadata({
    windowsTreeInspectionPhase: "native_snapshot", windowsTreeInspectionAttempts: Infinity,
    windowsTreeInspectionRetries: 1001, windowsTreeInspectionQueueMs: -1,
    windowsTreeInspectionNativeMs: 600001, windowsTreeInspectionLastRetry: "private-secret",
    output: "private-secret", pid: root.pid, command: "private-secret",
  });
  assert.deepEqual(evidence, {
    windowsTreeInspectionPhase: "native_snapshot", windowsTreeInspectionAttempts: null,
    windowsTreeInspectionRetries: null, windowsTreeInspectionQueueMs: null,
    windowsTreeInspectionNativeMs: null, windowsTreeInspectionLastRetry: null,
    windowsTreeInspectionNativeHelperSpawned: false,
    windowsTreeInspectionNativeHelperExited: false,
    windowsTreeInspectionNativeHelperStdioClosed: false,
    windowsTreeInspectionNativeResultCompleted: false,
    windowsTreeInspectionNativeSpawnWaitMs: null,
    windowsTreeInspectionNativeWorkMs: null,
    windowsTreeInspectionNativeStdioCloseMs: null,
    windowsTreeInspectionNativeResultCompletionMs: null,
  });
  assert.deepEqual(projectWindowsTreeInspectionMetadata({ windowsTreeInspectionPhase: "private-secret" }), {});
  assert.deepEqual(windowsTreeInspectionFailureMetadata({ get windowsTreeInspection() { throw new Error("private-secret"); } }), {});
});

test("nested and API trace evidence use the same bounded projection", () => {
  const metadata = { windowsTreeInspectionPhase: "native_snapshot", windowsTreeInspectionAttempts: 3,
    windowsTreeInspectionRetries: 2, windowsTreeInspectionQueueMs: 8, windowsTreeInspectionNativeMs: 92,
    windowsTreeInspectionLastRetry: "incomplete", command: "private-secret" };
  const error = new AggregateError([{ cause: { windowsTreeInspection: metadata } }]);
  error.errors.push(error);
  assert.deepEqual(windowsTreeInspectionFailureMetadata(error), projectWindowsTreeInspectionMetadata(metadata));
  const trace = { runtime: { startTrace: { current: { events: [{ metadata }] } } } };
  const serialized = lifecycleFailureDiagnostic({ error, state: trace });
  assert.equal(serialized.includes("private-secret"), false);
  assert.equal(JSON.parse(serialized).windowsTreeInspections.length, 2);
  assert.equal(JSON.parse(lifecycleFailureDiagnostic({ state: { runtime: { startTrace: { current: {
    events: Array(40).fill({ metadata }),
  } } } } })).windowsTreeInspections.length, 16);
});

test("every ancestry rejection stays fail closed with a distinct bounded reason", async () => {
  const command = "private-command";
  const expected = { ...root, commandHash: hashProcessCommandLine(command) };
  const row = (pid, parent, date) => ({ Status: "running", ProcessId: pid,
    ParentProcessId: parent, CreationDate: date, ExecutablePath: root.executablePath, CommandLine: command });
  const rootRow = row(root.pid, 9000, root.createdAt);
  const newer = "2026-07-18T01:02:04.456Z";
  const newest = "2026-07-18T01:02:05.456Z";
  const cases = [
    ["ancestry_invalid_parent", [row(4343, 0, newer)]],
    ["ancestry_cycle", [row(4343, 4344, newer), row(4344, 4343, newer)]],
    ["ancestry_missing_parent", [row(4343, 9999, newer)]],
    ["ancestry_predates_parent_within_root", [row(4343, 4344, newer), row(4344, root.pid, newest)]],
    ["ancestry_predates_parent_within_root", [row(4343, 4344, root.createdAt), row(4344, root.pid, newer)]],
  ];
  for (const [reason, descendants] of cases) {
    await assert.rejects(inspectWindowsProcessTree(expected, {
      deadlineMs: Date.now() + 200,
      runCommand: async () => ({ stdout: JSON.stringify({ Status: "tree", RootStatus: "running",
        Processes: [rootRow, ...descendants] }) }),
    }), error => {
      const metadata = windowsTreeInspectionFailureMetadata(error);
      assert.equal(metadata.windowsTreeInspectionLastRetry, reason);
      assert.ok(metadata.windowsTreeInspectionRetries >= 1);
      assert.doesNotMatch(JSON.stringify(metadata), /private|4343|4344|9999|2026-07/);
      return true;
    });
  }
});
test("native command status categories remain closed through actual bounded inspection retries", async () => {
  for (const [code, reason] of [[132, "descendant_command_denied"], [133, "descendant_command_length_changed"],
    [134, "descendant_command_unsupported"], [135, "descendant_command_native_failure"], [136, "descendant_command_result_length"],
    [137, "descendant_command_buffer_small"], [138, "descendant_command_partial_copy"], [139, "descendant_command_terminating"],
    [140, "descendant_command_unsuccessful"], [141, "descendant_command_buffer_overflow"]]) {
    await assert.rejects(inspectWindowsProcessTree(root, {
      deadlineMs: Date.now() + 80,
      runCommand: async () => ({ exitCode: code, stdout: "private-native-output", stderr: "private-process-output" }),
    }), error => {
      const evidence = windowsTreeInspectionFailureMetadata(error);
      assert.equal(evidence.windowsTreeInspectionLastRetry, reason);
      assert.ok(evidence.windowsTreeInspectionAttempts >= 1);
      assert.equal(JSON.stringify(evidence).includes("private"), false);
      return true;
    });
  }
});

test("partial-copy receipt is closed, failure-specific, and omits raw native details", async () => {
  await assert.rejects(inspectWindowsProcessTree(root, {
    deadlineMs: Date.now() + 80,
    runCommand: async () => ({
      exitCode: 138,
      stdout: JSON.stringify({
        CommandQueryHeldHandleState: "exit_query_failed",
        CommandQueryArchitectureRelation: "cross",
      }),
    }),
  }), error => {
    const evidence = windowsTreeInspectionFailureMetadata(error);
    assert.equal(evidence.windowsTreeInspectionLastRetry, "descendant_command_partial_copy");
    assert.equal(evidence.windowsTreeInspectionCommandQueryHeldHandleState, "exit_query_failed");
    assert.equal(evidence.windowsTreeInspectionCommandQueryArchitectureRelation, "cross");
    assert.doesNotMatch(JSON.stringify(evidence), /138|partial-native|status|pid|path/i);
    return true;
  });
  assert.deepEqual(projectWindowsTreeInspectionMetadata({
    windowsTreeInspectionPhase: "native_snapshot",
    windowsTreeInspectionLastRetry: "descendant_command_partial_copy",
    windowsTreeInspectionCommandQueryHeldHandleState: "confirmed_exit",
    windowsTreeInspectionCommandQueryArchitectureRelation: "x64",
  }), {
    windowsTreeInspectionPhase: "native_snapshot",
    windowsTreeInspectionAttempts: null,
    windowsTreeInspectionRetries: null,
    windowsTreeInspectionQueueMs: null,
    windowsTreeInspectionNativeMs: null,
    windowsTreeInspectionNativeHelperSpawned: false,
    windowsTreeInspectionNativeHelperExited: false,
    // AC-4BH.3 common progress fields survive rejection of the special pair.
    windowsTreeInspectionNativeHelperStdioClosed: false,
    windowsTreeInspectionNativeResultCompleted: false,
    windowsTreeInspectionNativeSpawnWaitMs: null,
    windowsTreeInspectionNativeWorkMs: null,
    windowsTreeInspectionNativeStdioCloseMs: null,
    windowsTreeInspectionNativeResultCompletionMs: null,
    windowsTreeInspectionLastRetry: "descendant_command_partial_copy",
  });
  await assert.rejects(inspectWindowsProcessTree(root, {
    deadlineMs: Date.now() + 80,
    runCommand: async () => ({
      exitCode: 138,
      stdout: JSON.stringify({
        CommandQueryHeldHandleState: "still_active_or_259",
        CommandQueryArchitectureRelation: "same",
        ProcessId: 4342,
      }),
    }),
  }), error => {
    const evidence = windowsTreeInspectionFailureMetadata(error);
    assert.equal(evidence.windowsTreeInspectionLastRetry, "descendant_command_partial_copy");
    assert.equal(evidence.windowsTreeInspectionCommandQueryHeldHandleState, undefined);
    assert.equal(evidence.windowsTreeInspectionCommandQueryArchitectureRelation, undefined);
    return true;
  });
});

test("partial-copy receipt accepts exactly one native terminal newline through retry metadata", async () => {
  const canonicalReceipt = "{\"CommandQueryHeldHandleState\":\"still_active_or_259\",\"CommandQueryArchitectureRelation\":\"same\"}";
  for (const terminalNewline of ["\r\n", "\n"]) {
    let calls = 0;
    await assert.rejects(inspectWindowsProcessTree(root, {
      deadlineMs: Date.now() + 80,
      runCommand: async () => {
        calls += 1;
        return { exitCode: 138, stdout: canonicalReceipt + terminalNewline };
      },
    }), error => {
      const evidence = windowsTreeInspectionFailureMetadata(error);
      assert.equal(evidence.windowsTreeInspectionLastRetry, "descendant_command_partial_copy");
      assert.equal(evidence.windowsTreeInspectionCommandQueryHeldHandleState, "still_active_or_259");
      assert.equal(evidence.windowsTreeInspectionCommandQueryArchitectureRelation, "same");
      assert.doesNotMatch(JSON.stringify(evidence), /ProcessId|private|\\r|\\n/i);
      return true;
    });
    assert.ok(calls >= 1);
  }
});

test("partial-copy receipt rejects extra boundaries and non-canonical newline variants", async () => {
  const canonicalReceipt = "{\"CommandQueryHeldHandleState\":\"exit_query_failed\",\"CommandQueryArchitectureRelation\":\"cross\"}";
  for (const stdout of [
    canonicalReceipt + "\r",
    canonicalReceipt + "\r\n\r\n",
    canonicalReceipt + "\n\n",
    canonicalReceipt + "\r\n{\"CommandQueryHeldHandleState\":\"exit_query_failed\",\"CommandQueryArchitectureRelation\":\"cross\"}",
    " " + canonicalReceipt + "\r\n",
    canonicalReceipt + " \r\n",
  ]) {
    await assert.rejects(inspectWindowsProcessTree(root, {
      deadlineMs: Date.now() + 80,
      runCommand: async () => ({ exitCode: 138, stdout }),
    }), error => {
      const evidence = windowsTreeInspectionFailureMetadata(error);
      assert.equal(evidence.windowsTreeInspectionLastRetry, "descendant_command_partial_copy");
      assert.equal(evidence.windowsTreeInspectionCommandQueryHeldHandleState, undefined);
      assert.equal(evidence.windowsTreeInspectionCommandQueryArchitectureRelation, undefined);
      return true;
    });
  }
});

test("verified root lifetime excludes an older numeric-parent branch without discarding valid members", async () => {
  const command = "private-command";
  const expected = { ...root, commandHash: hashProcessCommandLine(command) };
  const row = (pid, parent, date) => ({ Status: "running", ProcessId: pid,
    ParentProcessId: parent, CreationDate: date, ExecutablePath: root.executablePath, CommandLine: command });
  const rootRow = row(root.pid, 9000, root.createdAt);
  const older = row(4343, root.pid, "2026-07-18T01:02:02.456Z");
  const unrelatedChild = row(4344, 4343, "2026-07-18T01:02:04.456Z");
  const ownedChild = row(4345, root.pid, "2026-07-18T01:02:05.456Z");
  const result = await inspectWindowsProcessTree(expected, {
    runCommand: async () => ({ stdout: JSON.stringify({ Status: "tree", RootStatus: "running",
      Processes: [rootRow, older, unrelatedChild, ownedChild] }) }),
  });
  assert.equal(result.rootStatus, "owned");
  assert.deepEqual(result.members.map(member => member.pid), [4345, root.pid]);
  assert.equal(result.verifiedMembersOnly, true);
  assert.deepEqual(result.excludedMemberPids, [4343, 4344]);
});

test("a verified direct pre-root child edge is excluded without disowning its current-root sibling", async () => {
  const command = "private-command";
  const expected = { ...root, commandHash: hashProcessCommandLine(command) };
  const row = (pid, parent, date) => ({ Status: "running", ProcessId: pid,
    ParentProcessId: parent, CreationDate: date, ExecutablePath: root.executablePath, CommandLine: command });
  const rootRow = row(root.pid, 9000, root.createdAt);
  const currentParent = row(4343, root.pid, "2026-07-18T01:02:04.456Z");
  const staleChild = row(4344, currentParent.ProcessId, "2026-07-18T01:02:02.456Z");
  const staleRelatedChild = row(4345, staleChild.ProcessId, "2026-07-18T01:02:03.456Z");
  const ownedChild = row(4346, root.pid, "2026-07-18T01:02:05.456Z");
  const result = await inspectWindowsProcessTree(expected, {
    runCommand: async () => ({ stdout: JSON.stringify({ Status: "tree", RootStatus: "running",
      Processes: [rootRow, currentParent, staleChild, staleRelatedChild, ownedChild] }) }),
  });
  assert.equal(result.rootStatus, "owned");
  assert.deepEqual(result.members.map(member => member.pid), [4346, 4343, root.pid]);
  assert.equal(result.verifiedMembersOnly, true);
  assert.deepEqual(result.excludedMemberPids, [4344, 4345]);
});

test("a verified stale numeric-parent edge is excluded beneath a current root branch", async () => {
  const command = "private-command";
  const expected = { ...root, commandHash: hashProcessCommandLine(command) };
  const row = (pid, parent, date) => ({ Status: "running", ProcessId: pid,
    ParentProcessId: parent, CreationDate: date, ExecutablePath: root.executablePath, CommandLine: command });
  const rootRow = row(root.pid, 9000, root.createdAt);
  const launcherChild = row(4343, root.pid, "2026-07-18T01:02:04.456Z");
  const currentParent = row(4344, launcherChild.ProcessId, "2026-07-18T01:02:05.456Z");
  const staleChild = row(4345, currentParent.ProcessId, "2026-07-18T01:02:02.456Z");
  const staleRelatedChild = row(4346, staleChild.ProcessId, "2026-07-18T01:02:03.456Z");
  const ownedChild = row(4347, root.pid, "2026-07-18T01:02:06.456Z");
  const ownedGrandchild = row(4348, currentParent.ProcessId, "2026-07-18T01:02:07.456Z");
  const result = await inspectWindowsProcessTree(expected, {
    runCommand: async () => ({ stdout: JSON.stringify({ Status: "tree", RootStatus: "running",
      Processes: [rootRow, launcherChild, currentParent, staleChild, staleRelatedChild, ownedChild, ownedGrandchild] }) }),
  });
  assert.equal(result.rootStatus, "owned");
  assert.deepEqual(result.members.map(member => member.pid), [4348, 4347, 4344, 4343, root.pid]);
  assert.equal(result.verifiedMembersOnly, true);
  assert.deepEqual(result.excludedMemberPids, [4345, 4346]);
});

test("a stale edge needs a current matching root; changed-root evidence remains rejected", async () => {
  const command = "private-command";
  const expected = { ...root, commandHash: hashProcessCommandLine(command) };
  const row = (pid, parent, date) => ({ Status: "running", ProcessId: pid,
    ParentProcessId: parent, CreationDate: date, ExecutablePath: root.executablePath, CommandLine: command });
  const rootRow = row(root.pid, 9000, root.createdAt);
  const first = row(4343, root.pid, "2026-07-18T01:02:04.456Z");
  const second = row(4344, first.ProcessId, "2026-07-18T01:02:05.456Z");
  const staleDeeper = row(4345, second.ProcessId, "2026-07-18T01:02:02.456Z");
  const filtered = await inspectWindowsProcessTree(expected, {
    deadlineMs: Date.now() + 150,
    runCommand: async () => ({ stdout: JSON.stringify({ Status: "tree", RootStatus: "running",
      Processes: [rootRow, first, second, staleDeeper] }) }),
  });
  assert.equal(filtered.verifiedMembersOnly, true);
  assert.deepEqual(filtered.excludedMemberPids, [4345]);
  await assert.rejects(inspectWindowsProcessTree(expected, {
    deadlineMs: Date.now() + 150,
    runCommand: async () => ({ stdout: JSON.stringify({ Status: "tree", RootStatus: "running",
      Processes: [{ ...rootRow, CreationDate: "2026-07-18T01:02:06.456Z" }, first] }) }),
  }));
});

test("older branches remain fail closed without a current matching root or complete structural evidence", async () => {
  const command = "private-command";
  const expected = { ...root, commandHash: hashProcessCommandLine(command) };
  const row = (pid, parent, date) => ({ Status: "running", ProcessId: pid,
    ParentProcessId: parent, CreationDate: date, ExecutablePath: root.executablePath, CommandLine: command });
  const rootRow = row(root.pid, 9000, root.createdAt);
  const older = row(4343, root.pid, "2026-07-18T01:02:02.456Z");
  const cases = [
    { RootStatus: "not_running", Processes: [older], reason: "ancestry_predates_root" },
    { RootStatus: "running", Processes: [{ ...rootRow, CreationDate: "2026-07-18T01:02:06.456Z" }, older] },
    { RootStatus: "running", Processes: [rootRow, { ...older, CommandLine: undefined }] },
    { RootStatus: "running", Processes: [rootRow, { ...older, ParentProcessId: 9999 }], reason: "ancestry_missing_parent" },
    { RootStatus: "running", Processes: [rootRow, { ...older, ParentProcessId: 4344 },
      row(4344, 4343, older.CreationDate)], reason: "ancestry_cycle" },
  ];
  for (const sample of cases) {
    await assert.rejects(inspectWindowsProcessTree(expected, {
      deadlineMs: Date.now() + 150,
      runCommand: async () => ({ stdout: JSON.stringify({ Status: "tree", RootStatus: sample.RootStatus,
        Processes: sample.Processes }) }),
    }), error => {
      if (sample.reason) assert.equal(windowsTreeInspectionFailureMetadata(error).windowsTreeInspectionLastRetry, sample.reason);
      return true;
    });
  }
});

// SPEC-002 AC-4BH.3: independent literal oracle, never derived from the projector.
const closedCommonProjection = {
  windowsTreeInspectionPhase: "native_snapshot",
  windowsTreeInspectionAttempts: null,
  windowsTreeInspectionRetries: null,
  windowsTreeInspectionQueueMs: null,
  windowsTreeInspectionNativeMs: null,
  windowsTreeInspectionLastRetry: null,
  windowsTreeInspectionNativeHelperSpawned: false,
  windowsTreeInspectionNativeHelperExited: false,
  windowsTreeInspectionNativeHelperStdioClosed: false,
  windowsTreeInspectionNativeResultCompleted: false,
  windowsTreeInspectionNativeSpawnWaitMs: null,
  windowsTreeInspectionNativeWorkMs: null,
  windowsTreeInspectionNativeStdioCloseMs: null,
  windowsTreeInspectionNativeResultCompletionMs: null,
};
const partialCopyPair = {
  windowsTreeInspectionCommandQueryHeldHandleState: "still_active_or_259",
  windowsTreeInspectionCommandQueryArchitectureRelation: "unknown",
};
const ancestryQuartet = {
  windowsTreeInspectionParentBirthRelation: "parent_before_root",
  windowsTreeInspectionChildBirthRelation: "child_before_root",
  windowsTreeInspectionRootFingerprintMatch: false,
  windowsTreeInspectionAncestryDepthBucket: "five_plus",
};

test("AC-4BH.3 pairs common fourteen keys with only complete reason-specific groups", () => {
  for (const phase of ["queue_wait", "native_snapshot", "retry_delay"]) {
    const common = { ...closedCommonProjection, windowsTreeInspectionPhase: phase };
    for (const reason of [null, "private-status", "helper_failed", "malformed"]) {
      const input = { ...common, windowsTreeInspectionLastRetry: reason, ...partialCopyPair, ...ancestryQuartet,
        ProcessId: root.pid, path: root.executablePath, command: "private-command", message: "private-message" };
      assert.deepEqual(projectWindowsTreeInspectionMetadata(input), {
        ...common, windowsTreeInspectionLastRetry: reason === "private-status" ? null : reason,
      });
    }
    for (const reason of ["root_command_partial_copy", "descendant_command_partial_copy"]) {
      const expected = { ...common, windowsTreeInspectionLastRetry: reason, ...partialCopyPair };
      assert.equal(Object.keys(expected).length, 16);
      const input = { ...expected, ...ancestryQuartet, nativeStatus: "private-status", pid: root.pid };
      assert.deepEqual(projectWindowsTreeInspectionMetadata(input), expected);
      for (const key of Object.keys(partialCopyPair)) {
        for (const invalid of [undefined, null, "private-message", 259, true]) {
          assert.deepEqual(projectWindowsTreeInspectionMetadata({ ...input, [key]: invalid }), {
            ...common, windowsTreeInspectionLastRetry: reason,
          });
        }
      }
      const diagnostic = JSON.parse(lifecycleFailureDiagnostic({ error: { windowsTreeInspection: input },
        state: { runtime: { startTrace: { current: { events: [{ metadata: input }] } } } } }));
      assert.deepEqual(diagnostic.windowsTreeInspections, [expected, expected]);
      assert.doesNotMatch(JSON.stringify(diagnostic), /private|4342|nativeStatus|ProcessId|"command"|"message"|"path"/);
    }
    for (const reason of ["ancestry_predates_parent_before_root", "ancestry_predates_parent_within_root"]) {
      const expected = { ...common, windowsTreeInspectionLastRetry: reason, ...ancestryQuartet };
      assert.equal(Object.keys(expected).length, 18);
      const input = { ...expected, ...partialCopyPair };
      assert.deepEqual(projectWindowsTreeInspectionMetadata(input), expected);
      for (const key of Object.keys(ancestryQuartet)) {
        assert.deepEqual(projectWindowsTreeInspectionMetadata({ ...input, [key]: undefined }), {
          ...common, windowsTreeInspectionLastRetry: reason,
        });
      }
    }
    assert.equal(Object.keys(common).length, 14);
  }
});

test("AC-4BH.3 progress bounds and literal booleans remain closed under expanded metadata", () => {
  const numericKeys = Object.keys(closedCommonProjection).filter(key => key.endsWith("Ms") ||
    key.endsWith("Attempts") || key.endsWith("Retries"));
  for (const key of numericKeys) {
    const maximum = key.endsWith("Ms") ? 600000 : 1000;
    for (const value of [0, maximum]) {
      assert.deepEqual(projectWindowsTreeInspectionMetadata({ ...closedCommonProjection, [key]: value }), {
        ...closedCommonProjection, [key]: value,
      });
    }
    for (const invalid of [-1, maximum + 1, 0.5, Infinity, NaN, "private-number", {}, null]) {
      assert.deepEqual(projectWindowsTreeInspectionMetadata({ ...closedCommonProjection, [key]: invalid }), closedCommonProjection);
    }
  }
  const booleans = Object.keys(closedCommonProjection).filter(key => typeof closedCommonProjection[key] === "boolean");
  for (const key of booleans) {
    assert.deepEqual(projectWindowsTreeInspectionMetadata({ ...closedCommonProjection, [key]: true }), {
      ...closedCommonProjection, [key]: true,
    });
    for (const invalid of [1, "true", "private-value", {}, null, undefined]) {
      assert.deepEqual(projectWindowsTreeInspectionMetadata({ ...closedCommonProjection, [key]: invalid }), closedCommonProjection);
    }
  }
  for (const input of [null, undefined, false, "private-message", {}, { windowsTreeInspectionPhase: "private-phase" }]) {
    assert.deepEqual(projectWindowsTreeInspectionMetadata(input), {});
  }
  assert.deepEqual(projectWindowsTreeInspectionMetadata({ windowsTreeInspectionPhase: "native_snapshot",
    get windowsTreeInspectionNativeWorkMs() { throw new Error("private-message"); } }), {});
});

test("AC-4BH.3 native partial-copy pairs cover both failure subjects without admitting expanded receipts", async () => {
  for (const [exitCode, reason] of [[38, "root_command_partial_copy"], [138, "descendant_command_partial_copy"]]) {
    for (const heldHandleState of ["still_active_or_259", "exit_query_failed"]) {
      for (const architectureRelation of ["same", "cross", "unknown"]) {
        await assert.rejects(inspectWindowsProcessTree(root, {
          deadlineMs: Date.now() + 80,
          runCommand: async () => ({ exitCode, stdout: JSON.stringify({
            CommandQueryHeldHandleState: heldHandleState, CommandQueryArchitectureRelation: architectureRelation,
          }), stderr: "private-native-message" }),
        }), error => {
          const evidence = windowsTreeInspectionFailureMetadata(error);
          assert.equal(evidence.windowsTreeInspectionLastRetry, reason);
          assert.equal(evidence.windowsTreeInspectionCommandQueryHeldHandleState, heldHandleState);
          assert.equal(evidence.windowsTreeInspectionCommandQueryArchitectureRelation, architectureRelation);
          assert.equal(Object.keys(evidence).length, 16);
          assert.doesNotMatch(JSON.stringify(evidence), /private|4342|ProcessId|ExecutablePath|CommandLine|nativeStatus/);
          return true;
        });
      }
    }
    const canonical = '{"CommandQueryHeldHandleState":"still_active_or_259","CommandQueryArchitectureRelation":"same"}';
    for (const stdout of ["private-native-message", "{}",
      '{"CommandQueryHeldHandleState":"still_active_or_259"}',
      canonical.replace('"CommandQueryHeldHandleState"', '"CommandQueryHeldHandle\\u0053tate"'),
      canonical.replace("}", ',"CommandQueryArchitectureRelation":"cross"}'),
      canonical.replace("}", ',"pid":4342,"path":"private-path","command":"private-command","status":"private-status","message":"private-message"}')]) {
      await assert.rejects(inspectWindowsProcessTree(root, {
        deadlineMs: Date.now() + 80, runCommand: async () => ({ exitCode, stdout }),
      }), error => {
        const evidence = windowsTreeInspectionFailureMetadata(error);
        assert.equal(evidence.windowsTreeInspectionLastRetry, reason);
        assert.equal(Object.keys(evidence).length, 14);
        assert.equal(evidence.windowsTreeInspectionCommandQueryHeldHandleState, undefined);
        assert.equal(evidence.windowsTreeInspectionCommandQueryArchitectureRelation, undefined);
        assert.doesNotMatch(JSON.stringify(evidence), /private|4342|ProcessId|ExecutablePath|CommandLine|nativeStatus/);
        return true;
      });
    }
  }
});

test("AC-4BH.3 successful inspection does not publish failure metadata or native receipt fields", async () => {
  const command = "private-command";
  const expectedRoot = { ...root, commandHash: hashProcessCommandLine(command) };
  const result = await inspectWindowsProcessTree(expectedRoot, {
    runCommand: async (_command, _args, options) => {
      for (const phase of ["spawned", "exited", "stdio_closed", "result_completed"]) options.onPhase?.(phase);
      return { stdout: JSON.stringify({ Status: "tree", RootStatus: "running", Processes: [{
        Status: "running", ProcessId: root.pid, ParentProcessId: 9000, CreationDate: root.createdAt,
        ExecutablePath: root.executablePath, CommandLine: command,
      }] }) };
    },
  });
  assert.equal(result.rootStatus, "owned");
  assert.equal(result.members.length, 1);
  assert.equal(result.windowsTreeInspection, undefined);
  assert.deepEqual(windowsTreeInspectionFailureMetadata(result), {});
  const diagnostic = lifecycleFailureDiagnostic({ error: result });
  assert.equal(JSON.parse(diagnostic).windowsTreeInspections, undefined);
  assert.doesNotMatch(diagnostic, /private|4342|9000|ProcessId|ExecutablePath|CommandLine/);
});