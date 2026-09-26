import assert from "node:assert/strict";
import test from "node:test";
import { packagedVerificationDiagnostic } from "../scripts/packaged-verification-diagnostics.mjs";

test("packaged failure phases distinguish acquisition, binding, execution and evidence", () => {
  const phases = ["consumer_setup", "package_staging", "dependency_acquisition", "installed_package_binding",
    "consumer_runner", "consumer_result", "evidence_validation", "evidence_write"];
  for (const phase of phases) {
    assert.deepEqual(packagedVerificationDiagnostic(phase), { stage: phase, errorCode: "verification_failed" });
  }
});

test("unknown or hostile diagnostic inputs cannot disclose payloads or execute getters", () => {
  const hostile = new Proxy({}, { get() { throw new Error("private-token"); } });
  for (const value of [undefined, null, "private-token", "constructor", hostile, new Error("private-token")]) {
    const result = packagedVerificationDiagnostic(value);
    assert.deepEqual(result, { stage: "packaged_verification", errorCode: "verification_failed" });
    assert.equal(JSON.stringify(result).includes("private-token"), false);
  }
});
