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
    ["ancestry_predates_parent_before_root", [row(4343, 4344, "2026-07-18T01:02:01.456Z"), row(4344, root.pid, "2026-07-18T01:02:02.456Z")]],
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

test("only direct pre-root branches are excluded; deeper and changed-root evidence remains rejected", async () => {
  const command = "private-command";
  const expected = { ...root, commandHash: hashProcessCommandLine(command) };
  const row = (pid, parent, date) => ({ Status: "running", ProcessId: pid,
    ParentProcessId: parent, CreationDate: date, ExecutablePath: root.executablePath, CommandLine: command });
  const rootRow = row(root.pid, 9000, root.createdAt);
  const first = row(4343, root.pid, "2026-07-18T01:02:04.456Z");
  const second = row(4344, first.ProcessId, "2026-07-18T01:02:05.456Z");
  const staleDeeper = row(4345, second.ProcessId, "2026-07-18T01:02:02.456Z");
  for (const sample of [
    { RootStatus: "running", Processes: [rootRow, first, second, staleDeeper] },
    { RootStatus: "running", Processes: [{ ...rootRow, CreationDate: "2026-07-18T01:02:06.456Z" }, first] },
  ]) {
    await assert.rejects(inspectWindowsProcessTree(expected, {
      deadlineMs: Date.now() + 150,
      runCommand: async () => ({ stdout: JSON.stringify({ Status: "tree", ...sample }) }),
    }));
  }
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
