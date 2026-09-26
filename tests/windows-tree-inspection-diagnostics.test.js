import assert from "node:assert/strict";
import test from "node:test";
import { inspectWindowsProcessTree } from "../dist/runtime/process/identity.js";
import { projectWindowsTreeInspectionMetadata, windowsTreeInspectionFailureMetadata } from "../dist/runtime/process/windows-tree-inspection-diagnostics.js";
import { lifecycleFailureDiagnostic } from "./lifecycle-failure-diagnostics.js";

const root = { pid: 4342, createdAt: "2026-07-18T01:02:03.456Z", executablePath: "C:\\private\\node.exe", commandHash: "private-command-hash" };

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
