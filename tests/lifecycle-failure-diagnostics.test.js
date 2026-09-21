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
  assert.equal(result.failurePhases.length, 4);
});

test("diagnostic errors cannot replace the original failure or expose thrown content", () => {
  const state = { get runtime() { throw new Error("private diagnostic failure"); } };
  assert.deepEqual(JSON.parse(lifecycleFailureDiagnostic({ state })), {
    kind: "lifecycle-failure", diagnostic: "metadata_unavailable",
  });
});
