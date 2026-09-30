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

test("restart failures select a bounded restart receipt without replacing a successful start receipt", () => {
  const sensitive = "private-pid-and-path";
  const result = JSON.parse(lifecycleFailureDiagnostic({
    action: "restart",
    httpStatus: 409,
    apiErrorCode: "invalid_lifecycle_state",
    state: { runtime: {
      startTrace: { current: { status: "succeeded", events: [{ phase: "process_spawn", status: "completed", metadata: {} }] } },
      restartTrace: { current: { status: "blocked", events: [
        { stage: "precheck", status: "completed", oldNewProcessRelation: "prior_generation_running", pid: sensitive },
        { stage: "stop_request", status: "completed", oldNewProcessRelation: "prior_generation_running" },
        { stage: "finalization_settled", status: "completed", oldNewProcessRelation: "prior_generation_running" },
        { stage: "replacement_spawn", status: "failed", oldNewProcessRelation: sensitive },
        { stage: "response", status: "blocked", oldNewProcessRelation: "unavailable" },
      ] } },
    } },
  }));
  assert.equal(result.attemptAction, "restart");
  assert.deepEqual(result.events.map((event) => event.stage), ["precheck", "stop_request", "finalization_settled", "replacement_spawn", "response"]);
  assert.equal(result.events[3].oldNewProcessRelation, "unavailable");
  assert.equal(JSON.stringify(result).includes(sensitive), false);
});

test("restart diagnostic access failures remain contained", () => {
  const state = { runtime: { get restartTrace() { throw new Error("private diagnostic sink failure"); } } };
  assert.deepEqual(JSON.parse(lifecycleFailureDiagnostic({ action: "restart", state })), {
    kind: "lifecycle-failure", diagnostic: "metadata_unavailable",
  });
});

test("lifecycle diagnostics retain only a complete closed parent-lifetime receipt", () => {
  const result = JSON.parse(lifecycleFailureDiagnostic({
    error: {
      windowsTreeInspection: {
        windowsTreeInspectionPhase: "native_snapshot",
        windowsTreeInspectionAttempts: 1,
        windowsTreeInspectionRetries: 0,
        windowsTreeInspectionQueueMs: 2,
        windowsTreeInspectionNativeMs: 3,
        windowsTreeInspectionLastRetry: "ancestry_predates_parent_before_root",
        windowsTreeInspectionParentBirthRelation: "parent_before_root",
        windowsTreeInspectionChildBirthRelation: "child_before_root",
        windowsTreeInspectionRootFingerprintMatch: false,
        windowsTreeInspectionAncestryDepthBucket: "one",
        pid: 4343,
        command: "private-command",
      },
    },
  }));
  assert.deepEqual(result.windowsTreeInspections, [{
    windowsTreeInspectionPhase: "native_snapshot",
    windowsTreeInspectionAttempts: 1,
    windowsTreeInspectionRetries: 0,
    windowsTreeInspectionQueueMs: 2,
    windowsTreeInspectionNativeMs: 3,
    windowsTreeInspectionLastRetry: "ancestry_predates_parent_before_root",
    windowsTreeInspectionParentBirthRelation: "parent_before_root",
    windowsTreeInspectionChildBirthRelation: "child_before_root",
    windowsTreeInspectionRootFingerprintMatch: false,
    windowsTreeInspectionAncestryDepthBucket: "one",
  }]);
  assert.equal(JSON.stringify(result).includes("private"), false);
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
