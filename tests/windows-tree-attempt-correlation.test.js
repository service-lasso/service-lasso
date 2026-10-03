import assert from "node:assert/strict";
import test from "node:test";
import { inspectWindowsProcessTree } from "../dist/runtime/process/identity.js";
import { projectWindowsTreeInspectionMetadata, windowsTreeInspectionFailureMetadata } from "../dist/runtime/process/windows-tree-inspection-diagnostics.js";
import { lifecycleFailureDiagnostic } from "../scripts/lifecycle-failure-diagnostics.mjs";
import { projectPackagedWindowsTreeInspection } from "../scripts/mcp-product-acceptance-lib.mjs";

// AC-4BH.4: exercise the actual producing loop. Injected command phases are
// surrogate observations, never native process/exit or case66 acceptance.
const root = { pid: 4342, createdAt: "2026-07-18T01:02:03.456Z", executablePath: "C:\\private\\node.exe", commandHash: "private-command" };
const receipt = '{"CommandQueryHeldHandleState":"still_active_or_259","CommandQueryArchitectureRelation":"same"}';
const absentRoot = { stdout: '{"Status":"tree","RootStatus":"not_running","Processes":[]}' };
const baseKeys = [
  "windowsTreeInspectionPhase", "windowsTreeInspectionAttempts", "windowsTreeInspectionRetries",
  "windowsTreeInspectionQueueMs", "windowsTreeInspectionNativeMs", "windowsTreeInspectionLastRetry",
  "windowsTreeInspectionNativeHelperSpawned", "windowsTreeInspectionNativeHelperExited",
  "windowsTreeInspectionNativeHelperStdioClosed", "windowsTreeInspectionNativeResultCompleted",
  "windowsTreeInspectionNativeSpawnWaitMs", "windowsTreeInspectionNativeWorkMs",
  "windowsTreeInspectionNativeStdioCloseMs", "windowsTreeInspectionNativeResultCompletionMs",
].sort();
function closed(options) {
  options.onPhase?.("spawned");
  options.onPhase?.("exited");
  options.onPhase?.("stdio_closed");
}
function assertConsumersOmit(error, reason) {
  const metadata = windowsTreeInspectionFailureMetadata(error);
  assert.equal(metadata.windowsTreeInspectionLastRetry, reason);
  assert.deepEqual(Object.keys(metadata).sort(), baseKeys);
  assert.deepEqual(projectWindowsTreeInspectionMetadata(metadata), metadata);
  const state = { runtime: { startTrace: { current: { status: "failed", events: [{ metadata }] } } } };
  const diagnostic = JSON.parse(lifecycleFailureDiagnostic({ error: { cause: error }, state }));
  assert.equal(diagnostic.windowsTreeInspections.length, 2);
  for (const projected of diagnostic.windowsTreeInspections) assert.deepEqual(projected, metadata);
  const packaged = projectPackagedWindowsTreeInspection(metadata);
  assert.equal(Object.keys(packaged).length, 6);
  assert.equal(packaged.windowsTreeInspectionLastRetry, reason);
  assert.equal(packaged.windowsTreeInspectionCommandQueryHeldHandleState, undefined);
  assert.doesNotMatch(JSON.stringify({ metadata, diagnostic, packaged }), /private|4342|producingAttempt|lastRetryAttempt|same|still_active_or_259/);
  return metadata;
}

test("AC-4BH.4 earlier receipt cannot describe a later spawned helper deadline", async () => {
  let calls = 0;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  try {
    await assert.rejects(inspectWindowsProcessTree(root, {
      deadlineMs: Date.now() + 400,
      runCommand: async (_command, _args, options) => {
        calls += 1;
        if (calls === 1) { closed(options); return { exitCode: 138, stdout: receipt }; }
        options.onPhase?.("spawned");
        await pending;
        return absentRoot;
      },
    }), error => {
      assert.equal(error.code, "PROCESS_CONTROL_DEADLINE_EXCEEDED");
      const metadata = assertConsumersOmit(error, "descendant_command_partial_copy");
      assert.equal(metadata.windowsTreeInspectionAttempts, 2);
      assert.equal(metadata.windowsTreeInspectionNativeHelperSpawned, true);
      assert.equal(metadata.windowsTreeInspectionNativeHelperExited, false);
      assert.equal(metadata.windowsTreeInspectionNativeHelperStdioClosed, false);
      assert.equal(metadata.windowsTreeInspectionNativeResultCompleted, false);
      return true;
    });
  } finally { release(); }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2);
});

test("AC-4BH.4 terminal queue wait has no current receipt even if previous helper closed", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let blocker;
  let calls = 0;
  try {
    await assert.rejects(inspectWindowsProcessTree(root, {
      deadlineMs: Date.now() + 400,
      runCommand: async (_command, _args, options) => {
        calls += 1;
        closed(options);
        // Enqueued while this attempt owns the serialization turn. It holds
        // the next turn before this inspection's bounded retry re-enters.
        blocker = inspectWindowsProcessTree({ ...root, pid: 4343 }, {
          runCommand: async () => { await gate; return absentRoot; },
        });
        return { exitCode: 38, stdout: receipt };
      },
    }), error => {
      assert.equal(error.code, "PROCESS_CONTROL_DEADLINE_EXCEEDED");
      const metadata = assertConsumersOmit(error, "root_command_partial_copy");
      assert.equal(metadata.windowsTreeInspectionPhase, "queue_wait");
      assert.equal(metadata.windowsTreeInspectionAttempts, 1);
      // Progress remains the latest actually entered helper, independently of
      // the terminal queue wait. It cannot supply a current-attempt receipt.
      assert.equal(metadata.windowsTreeInspectionNativeResultCompleted, true);
      return true;
    });
  } finally { release(); if (blocker) await blocker; }
  assert.equal(calls, 1);
});

test("AC-4BH.4 current receipt retains only its own closure through all readers", async () => {
  let calls = 0;
  await assert.rejects(inspectWindowsProcessTree(root, {
    deadlineMs: Date.now() + 400,
    runCommand: async (_command, _args, options) => {
      calls += 1;
      closed(options);
      return calls === 1 ? { stdout: "private-malformed" } : { exitCode: 138, stdout: receipt };
    },
  }), error => {
    assert.equal(error.message, "Native Windows process-tree inspection failed.");
    const metadata = windowsTreeInspectionFailureMetadata(error);
    assert.ok(metadata.windowsTreeInspectionAttempts >= 2);
    assert.equal(metadata.windowsTreeInspectionLastRetry, "descendant_command_partial_copy");
    assert.equal(metadata.windowsTreeInspectionCommandQueryHeldHandleState, "still_active_or_259");
    assert.equal(metadata.windowsTreeInspectionCommandQueryArchitectureRelation, "same");
    for (const key of ["Spawned", "Exited", "StdioClosed"]) assert.equal(metadata[`windowsTreeInspectionNativeHelper${key}`], true);
    assert.equal(metadata.windowsTreeInspectionNativeResultCompleted, true);
    assert.equal(Object.keys(metadata).length, 16);
    assert.deepEqual(projectWindowsTreeInspectionMetadata(metadata), metadata);
    const nested = JSON.parse(lifecycleFailureDiagnostic({ error: new AggregateError([error]) }));
    assert.deepEqual(nested.windowsTreeInspections, [metadata]);
    assert.equal(Object.keys(projectPackagedWindowsTreeInspection(metadata)).length, 6);
    assert.doesNotMatch(JSON.stringify(nested), /private|4342|AttemptOrdinal/);
    return true;
  });
});

test("AC-4BH.4 malformed later receipt or later nonpartial reason cannot reuse earlier values", async () => {
  for (const [next, reason] of [
    [{ exitCode: 138, stdout: receipt + "\nprivate-extra" }, "descendant_command_partial_copy"],
    [{ exitCode: 132, stdout: receipt }, "descendant_command_denied"],
  ]) {
    let calls = 0;
    await assert.rejects(inspectWindowsProcessTree(root, {
      deadlineMs: Date.now() + 400,
      runCommand: async (_command, _args, options) => {
        calls += 1; closed(options);
        return calls === 1 ? { exitCode: 138, stdout: receipt } : next;
      },
    }), error => {
      assert.ok(calls >= 2);
      assertConsumersOmit(error, reason);
      return true;
    });
  }
});

test("AC-4BH.4 later original error survives diagnostic attachment and hostile getters", async () => {
  for (const hostile of [false, true]) {
    let calls = 0;
    const original = new Error("private-original-error");
    if (hostile) Object.defineProperty(original, "windowsTreeInspectionAncestry", {
      get() { throw new Error("private-observer-error"); },
    });
    await assert.rejects(inspectWindowsProcessTree(root, {
      deadlineMs: Date.now() + 1000,
      runCommand: async (_command, _args, options) => {
        calls += 1;
        if (calls === 1) { closed(options); return { exitCode: 138, stdout: receipt }; }
        throw original;
      },
    }), error => {
      assert.equal(error, original);
      assertConsumersOmit(error, "descendant_command_partial_copy");
      return true;
    });
    assert.equal(calls, 2);
  }
});

test("AC-4BH.4 projector never fills omitted receipt or exports private correlation tags", () => {
  const input = { windowsTreeInspectionPhase: "native_snapshot", windowsTreeInspectionLastRetry: "root_command_partial_copy",
    lastRetryAttempt: "private-tag", lastCommandPartialCopyAttempt: "private-tag", lastNativeProgressAttempt: "private-tag" };
  const projected = projectWindowsTreeInspectionMetadata(input);
  assert.deepEqual(Object.keys(projected).sort(), baseKeys);
  assert.equal(projected.windowsTreeInspectionLastRetry, "root_command_partial_copy");
  assert.doesNotMatch(JSON.stringify(projected), /private|lastRetryAttempt|lastCommandPartialCopyAttempt|lastNativeProgressAttempt/);
  assert.deepEqual(projectWindowsTreeInspectionMetadata({ ...input, get windowsTreeInspectionCommandQueryHeldHandleState() {
    throw new Error("private-getter");
  } }), {});
  for (const held of ["confirmed_exit", 259, "private-state"]) {
    const rejected = projectWindowsTreeInspectionMetadata({ ...input,
      windowsTreeInspectionCommandQueryHeldHandleState: held, windowsTreeInspectionCommandQueryArchitectureRelation: "same" });
    assert.deepEqual(Object.keys(rejected).sort(), baseKeys);
  }
});
