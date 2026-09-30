import test from "node:test";
import assert from "node:assert/strict";
import { lifecycleFailureDiagnostic } from "./lifecycle-failure-diagnostics.js";

test("lifecycle failure diagnostic retains only closed startup and deadline metadata", () => {
  const result = JSON.parse(lifecycleFailureDiagnostic({
    httpStatus: 409,
    state: { runtime: { startTrace: { current: { status: "failed", events: [
      { phase: "process_spawn", status: "failed", metadata: { processStartFailurePhase: "target_acknowledgement" } },
    ] } } } },
    error: { failurePhase: "initial_tree_inspection", cause: { code: "PROCESS_CONTROL_DEADLINE_EXCEEDED" } },
  }));
  assert.deepEqual(result, {
    kind: "lifecycle-failure", httpStatus: 409, attemptStatus: "failed",
    events: [{ phase: "process_spawn", status: "failed", failurePhase: "target_acknowledgement" }],
    failurePhases: ["initial_tree_inspection"], deadlineExceeded: true,
  });
});

test("lifecycle diagnostics exclude unknown strings and sensitive payload fields", () => {
  const sensitive = "secret-token-and-private-path";
  const result = lifecycleFailureDiagnostic({
    httpStatus: sensitive,
    state: { message: sensitive, runtime: { command: sensitive, startTrace: { current: {
      status: sensitive, attemptId: sensitive, events: [{
        phase: sensitive, status: sensitive, serviceId: sensitive, message: sensitive,
        metadata: { processStartFailurePhase: sensitive, password: sensitive },
      }],
    } } } },
    error: { name: sensitive, message: sensitive, stack: sensitive, failurePhase: sensitive, handle: sensitive },
  });
  assert.equal(result.includes(sensitive), false);
  assert.deepEqual(JSON.parse(result).events, [{ phase: null, status: null, failurePhase: null }]);
});

test("lifecycle diagnostics project only allowlisted API conflict classifications", () => {
  const allowedResult = JSON.parse(lifecycleFailureDiagnostic({
    httpStatus: 409,
    apiErrorCode: "invalid_lifecycle_state",
  }));
  assert.equal(allowedResult.apiErrorCode, "invalid_lifecycle_state");

  const sensitive = "private-path-or-token";
  const rejected = lifecycleFailureDiagnostic({
    httpStatus: 409,
    apiErrorCode: sensitive,
  });
  assert.equal(rejected.includes(sensitive), false);
  assert.equal(JSON.parse(rejected).apiErrorCode, undefined);
});

test("lifecycle diagnostics bound event and cause counts and tolerate missing or malformed state", () => {
  for (const input of [undefined, null, "invalid", 42]) {
    assert.deepEqual(JSON.parse(lifecycleFailureDiagnostic(input)).events, []);
  }
  for (const state of [undefined, null, {}, { runtime: { startTrace: { current: { events: "invalid" } } } }]) {
    assert.deepEqual(JSON.parse(lifecycleFailureDiagnostic({ state })).events, []);
  }
  const error = { failurePhase: "wrapper_spawn" };
  error.cause = error;
  const result = JSON.parse(lifecycleFailureDiagnostic({ error,
    state: { runtime: { startTrace: { current: { events: Array(100).fill(null) } } } },
  }));
  assert.equal(result.events.length, 16);
  assert.equal(result.failurePhases.length, 1);
});

test("aggregate containment failures retain nested deadlines without disclosing errors", () => {
  const sensitive = "private-path-command-token";
  const failure = new AggregateError([
    { failurePhase: "launch_state_cleanup", message: sensitive },
    new AggregateError([{ code: "PROCESS_CONTROL_DEADLINE_EXCEEDED", stack: sensitive }], sensitive),
    { failurePhase: sensitive, handle: sensitive },
  ], sensitive);
  failure.errors.push(failure);
  const serialized = lifecycleFailureDiagnostic({ error: failure });
  const result = JSON.parse(serialized);
  assert.deepEqual(result.failurePhases, ["launch_state_cleanup"]);
  assert.equal(result.deadlineExceeded, true);
  assert.equal(serialized.includes(sensitive), false);
});

test("deadline receipts retain a closed Windows ancestry projection through mixed failures", () => {
  const sensitive = "private-pid-command-timestamp";
  const malformed = {};
  Object.defineProperty(malformed, "windowsTreeInspection", {
    get() { throw new Error(sensitive); },
  });
  const deadline = {
    code: "PROCESS_CONTROL_DEADLINE_EXCEEDED",
    windowsTreeInspection: {
      windowsTreeInspectionPhase: "retry_delay",
      windowsTreeInspectionAttempts: 2,
      windowsTreeInspectionRetries: 1,
      windowsTreeInspectionQueueMs: 7,
      windowsTreeInspectionNativeMs: 83,
      windowsTreeInspectionLastRetry: "ancestry_predates_parent_before_root",
      windowsTreeInspectionAncestryCategory: "child_before_parent_parent_before_root",
      windowsTreeInspectionRootFingerprintMatch: true,
      windowsTreeInspectionAncestryDepthBucket: "two_to_four",
      command: sensitive,
    },
  };
  malformed.cause = deadline;

  const serialized = lifecycleFailureDiagnostic({ error: malformed });
  const result = JSON.parse(serialized);
  assert.equal(result.deadlineExceeded, true);
  assert.deepEqual(result.windowsTreeInspections, [{
    windowsTreeInspectionPhase: "retry_delay",
    windowsTreeInspectionAttempts: 2,
    windowsTreeInspectionRetries: 1,
    windowsTreeInspectionQueueMs: 7,
    windowsTreeInspectionNativeMs: 83,
    windowsTreeInspectionLastRetry: "ancestry_predates_parent_before_root",
    windowsTreeInspectionAncestryCategory: "child_before_parent_parent_before_root",
    windowsTreeInspectionRootFingerprintMatch: true,
    windowsTreeInspectionAncestryDepthBucket: "two_to_four",
  }]);
  assert.equal(serialized.includes(sensitive), false);
});

test("malformed mixed error properties cannot replace an otherwise valid deadline receipt", () => {
  const sensitive = "private-error-property";
  const deadline = {
    code: "PROCESS_CONTROL_DEADLINE_EXCEEDED",
    windowsTreeInspection: {
      windowsTreeInspectionPhase: "queue_wait",
      windowsTreeInspectionAttempts: 0,
      windowsTreeInspectionRetries: 0,
      windowsTreeInspectionQueueMs: 41,
      windowsTreeInspectionNativeMs: 0,
      windowsTreeInspectionLastRetry: null,
      detail: sensitive,
    },
  };
  const error = {};
  Object.defineProperty(error, "failurePhase", { get() { throw new Error(sensitive); } });
  Object.defineProperty(error, "code", { get() { throw new Error(sensitive); } });
  error.cause = deadline;

  const serialized = lifecycleFailureDiagnostic({ error });
  const result = JSON.parse(serialized);
  assert.equal(result.deadlineExceeded, true);
  assert.deepEqual(result.windowsTreeInspections, [{
    windowsTreeInspectionPhase: "queue_wait",
    windowsTreeInspectionAttempts: 0,
    windowsTreeInspectionRetries: 0,
    windowsTreeInspectionQueueMs: 41,
    windowsTreeInspectionNativeMs: 0,
    windowsTreeInspectionLastRetry: null,
    windowsTreeInspectionAncestryCategory: null,
    windowsTreeInspectionRootFingerprintMatch: null,
    windowsTreeInspectionAncestryDepthBucket: null,
  }]);
  assert.equal(serialized.includes(sensitive), false);
});

test("lifecycle diagnostics do not invoke error accessors and retain nested own-data receipts", () => {
  let accessorReads = 0;
  const hostile = {};
  for (const property of ["failurePhase", "code", "windowsTreeInspection", "cause", "errors"]) {
    Object.defineProperty(hostile, property, {
      get() {
        accessorReads += 1;
        return "private-accessor-value";
      },
    });
  }
  const deadline = {
    failurePhase: "target_acknowledgement",
    code: "PROCESS_CONTROL_DEADLINE_EXCEEDED",
    windowsTreeInspection: {
      windowsTreeInspectionPhase: "native_snapshot",
      windowsTreeInspectionAttempts: 1,
      windowsTreeInspectionRetries: 0,
      windowsTreeInspectionQueueMs: 0,
      windowsTreeInspectionNativeMs: 9,
      windowsTreeInspectionLastRetry: null,
    },
  };
  const result = JSON.parse(lifecycleFailureDiagnostic({ error: { cause: deadline, errors: [hostile] } }));

  assert.equal(accessorReads, 0);
  assert.deepEqual(result.failurePhases, ["target_acknowledgement"]);
  assert.equal(result.deadlineExceeded, true);
  assert.deepEqual(result.windowsTreeInspections, [{
    windowsTreeInspectionPhase: "native_snapshot",
    windowsTreeInspectionAttempts: 1,
    windowsTreeInspectionRetries: 0,
    windowsTreeInspectionQueueMs: 0,
    windowsTreeInspectionNativeMs: 9,
    windowsTreeInspectionLastRetry: null,
    windowsTreeInspectionAncestryCategory: null,
    windowsTreeInspectionRootFingerprintMatch: null,
    windowsTreeInspectionAncestryDepthBucket: null,
  }]);
});

test("aggregate diagnostic traversal remains bounded across wide and deep error graphs", () => {
  const deadline = { code: "PROCESS_CONTROL_DEADLINE_EXCEEDED" };
  const wide = new AggregateError([...Array.from({ length: 32 }, () => ({ failurePhase: "wrapper_spawn" })), deadline]);
  const result = JSON.parse(lifecycleFailureDiagnostic({ error: wide }));
  assert.equal(result.failurePhases.length, 15);
  assert.equal(result.deadlineExceeded, false);
  const deep = { cause: { cause: { cause: { cause: deadline } } } };
  assert.equal(JSON.parse(lifecycleFailureDiagnostic({ error: deep })).deadlineExceeded, false);
});

test("diagnostic errors cannot replace the original failure or expose thrown content", () => {
  const state = { get runtime() { throw new Error("private diagnostic failure"); } };
  assert.deepEqual(JSON.parse(lifecycleFailureDiagnostic({ state })), {
    kind: "lifecycle-failure", diagnostic: "metadata_unavailable",
  });
});
