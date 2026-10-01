import assert from "node:assert/strict";
import test from "node:test";
import { closedFinalizationTelemetry } from "../dist/runtime/execution/finalization-telemetry.js";

test("AC-4BH.3 accepts only complete bounded closed finalization telemetry", () => {
  const telemetry = closedFinalizationTelemetry([
    { phase: "root_handle_exit", status: "complete", reason: "observed" },
    { phase: "snapshot", status: "complete", reason: "observed" },
    { phase: "member_count", status: "complete", reason: "observed", count: 3 },
    { phase: "termination", status: "failed", reason: "deadline_exceeded" },
    { phase: "registry_reconcile", status: "not_applicable", reason: "not_required" },
  ]);
  assert.deepEqual(telemetry, [
    { phase: "root_handle_exit", status: "complete", reason: "observed" },
    { phase: "snapshot", status: "complete", reason: "observed" },
    { phase: "member_count", status: "complete", reason: "observed", count: 3 },
    { phase: "termination", status: "failed", reason: "deadline_exceeded" },
    { phase: "registry_reconcile", status: "not_applicable", reason: "not_required" },
  ]);
});

test("AC-4BH.3 rejects duplicate, malformed, extra, and private telemetry fields", () => {
  const invalid = [
    [
      { phase: "snapshot", status: "complete", reason: "observed" },
      { phase: "snapshot", status: "failed", reason: "failed" },
    ],
    [{ phase: "snapshot", status: "private", reason: "observed" }],
    [{ phase: "member_count", status: "complete", reason: "observed", count: 1, pid: 123 }],
    [{ phase: "root_handle_exit", status: "complete", reason: "observed", path: "private" }],
    [{ phase: "member_count", status: "complete", reason: "observed", count: 1_001 }],
    [
      { phase: "root_handle_exit", status: "complete", reason: "observed" },
      { phase: "snapshot", status: "complete", reason: "observed" },
      { phase: "member_count", status: "complete", reason: "observed", count: 1 },
      { phase: "termination", status: "complete", reason: "observed" },
    ],
    [
      { phase: "snapshot", status: "complete", reason: "observed" },
      { phase: "root_handle_exit", status: "complete", reason: "observed" },
      { phase: "member_count", status: "complete", reason: "observed", count: 1 },
      { phase: "termination", status: "complete", reason: "observed" },
      { phase: "registry_reconcile", status: "complete", reason: "observed" },
    ],
  ];
  for (const entries of invalid) {
    assert.throws(() => closedFinalizationTelemetry(entries), /Invalid closed finalization telemetry/u);
  }
});
