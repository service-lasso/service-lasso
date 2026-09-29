const stages = new Set([
  "consumer_setup", "package_staging", "dependency_acquisition", "installed_package_binding",
  "consumer_runner", "consumer_result", "evidence_validation", "evidence_write",
]);

// The outer verifier's current phase is the only input. Never inspect a caught error.
function safeExternalDiagnostic(value) {
  if (!value || typeof value !== "object" || value.boundary !== "github_release_metadata" || !Number.isInteger(value.httpStatus) || value.httpStatus < 400 || value.httpStatus > 599) return undefined;
  return { boundary: "github_release_metadata", httpStatus: value.httpStatus };
}

export function packagedVerificationDiagnostic(stage, external) {
  const upstream = safeExternalDiagnostic(external);
  return {
    stage: stages.has(stage) ? stage : "packaged_verification",
    errorCode: "verification_failed",
    ...(upstream ? { external: upstream } : {}),
  };
}
