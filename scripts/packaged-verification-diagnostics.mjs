const stages = new Set([
  "consumer_setup", "package_staging", "dependency_acquisition", "installed_package_binding",
  "consumer_runner", "consumer_result", "evidence_validation", "evidence_write",
]);

// The outer verifier's current phase is the only input. Never inspect a caught error.
export function packagedVerificationDiagnostic(stage) {
  return {
    stage: stages.has(stage) ? stage : "packaged_verification",
    errorCode: "verification_failed",
  };
}
