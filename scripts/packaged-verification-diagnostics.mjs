const stages = new Set([
  "consumer_setup", "package_staging", "dependency_acquisition", "installed_package_binding",
  "consumer_runner", "consumer_result", "evidence_validation", "evidence_write",
]);

const npmSubcodes = new Map([
  ["EAI_AGAIN", "npm_reported_network_eai_again"],
  ["ECONNREFUSED", "npm_reported_network_econnrefused"],
  ["ECONNRESET", "npm_reported_network_econnreset"],
  ["EHOSTUNREACH", "npm_reported_network_ehostunreach"],
  ["ENETDOWN", "npm_reported_network_enetdown"],
  ["ENETUNREACH", "npm_reported_network_enetunreach"],
  ["ENOTFOUND", "npm_reported_network_enotfound"],
  ["ERR_SOCKET_TIMEOUT", "npm_reported_network_socket_timeout"],
  ["ETIMEDOUT", "npm_reported_network_etimedout"],
  ["EINTEGRITY", "npm_reported_checksum_mismatch"],
  ["E401", "npm_reported_registry_identity_rejected"],
  ["E403", "npm_reported_registry_identity_rejected"],
]);

const MAX_NPM_JSON_BYTES = 8 * 1024;
const acquisitionOutcomes = new Set([
  "deadline_exceeded",
  "output_capture_exceeded",
  "spawn_failed",
  "exit_nonzero",
  "close_unresolved",
  "unknown",
]);

const signalSubcodes = new Map([
  ["SIGTERM", "subprocess_observed_signal_sigterm"],
  ["SIGKILL", "subprocess_observed_signal_sigkill"],
]);

function ownData(value, key) {
  if (!value || typeof value !== "object") return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function npmReportedCode(error) {
  const stdout = ownData(error, "stdout");
  if (typeof stdout !== "string" || Buffer.byteLength(stdout, "utf8") > MAX_NPM_JSON_BYTES) return undefined;
  try {
    const report = JSON.parse(stdout);
    if (!report || typeof report !== "object" || Array.isArray(report)) return undefined;
    const npmError = ownData(report, "error");
    if (!npmError || typeof npmError !== "object" || Array.isArray(npmError)) return undefined;
    const code = ownData(npmError, "code");
    return typeof code === "string" && /^[A-Z0-9_]+$/u.test(code) ? code : undefined;
  } catch {
    return undefined;
  }
}

export function dependencyAcquisitionReceipt(error, observedOutcome = "unknown") {
  const outcome = acquisitionOutcomes.has(observedOutcome) ? observedOutcome : "unknown";
  const code = ownData(error, "code");
  const signalSubcode = signalSubcodes.get(ownData(error, "signal"));
  const spawnSubcode = code === "ENOENT" ? "subprocess_spawn_enoent"
    : code === "EACCES" ? "subprocess_spawn_eacces"
      : code === "EPERM" ? "subprocess_spawn_eperm"
        : undefined;
  if (outcome === "spawn_failed") return { outcome, ...(spawnSubcode ? { subcode: spawnSubcode } : {}) };
  // This is a host-observed child result only. It intentionally says nothing
  // about who sent a signal, whether it was authorised, or why it occurred.
  if (signalSubcode) return { outcome, subcode: signalSubcode };
  if (outcome !== "exit_nonzero") return { outcome };
  return { outcome, subcode: npmSubcodes.get(npmReportedCode(error)) ?? "subprocess_exit_nonzero" };
}

export function dependencyAcquisitionSubcode(error, observedOutcome = "unknown") {
  return dependencyAcquisitionReceipt(error, observedOutcome).subcode;
}

// The outer verifier's current phase is the only input. Never inspect a caught error.
function safeExternalDiagnostic(value) {
  if (!value || typeof value !== "object") return undefined;
  try {
    const boundary = ownData(value, "boundary");
    const httpStatus = ownData(value, "httpStatus");
    if (boundary !== "github_release_metadata" || !Number.isInteger(httpStatus) || httpStatus < 400 || httpStatus > 599) return undefined;
    return { boundary: "github_release_metadata", httpStatus };
  } catch {
    return undefined;
  }
}

export function packagedVerificationDiagnostic(stage, external, receipt) {
  const upstream = safeExternalDiagnostic(external);
  const acquisitionReceipt = receipt && typeof receipt === "object"
    && acquisitionOutcomes.has(ownData(receipt, "outcome"))
    ? receipt
    : undefined;
  return {
    stage: stages.has(stage) ? stage : "packaged_verification",
    errorCode: "verification_failed",
    ...(stage === "dependency_acquisition" && acquisitionReceipt
      ? {
          outcome: ownData(acquisitionReceipt, "outcome"),
          ...(typeof ownData(acquisitionReceipt, "subcode") === "string" && [...npmSubcodes.values(), "subprocess_spawn_enoent", "subprocess_spawn_eacces", "subprocess_spawn_eperm", "subprocess_exit_nonzero", ...signalSubcodes.values()].includes(ownData(acquisitionReceipt, "subcode")) ? { subcode: ownData(acquisitionReceipt, "subcode") } : {}),
        }
      : {}),
    ...(upstream ? { external: upstream } : {}),
  };
}
