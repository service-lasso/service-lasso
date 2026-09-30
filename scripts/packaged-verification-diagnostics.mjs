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
const childExecutionSubcodes = new Set([
  "subprocess_spawn_enoent",
  "subprocess_spawn_eacces",
  "subprocess_spawn_eperm",
  "subprocess_exit_nonzero",
  "subprocess_timeout",
  "subprocess_output_limit",
  "subprocess_observed_signal_sigterm",
  "subprocess_observed_signal_sigkill",
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

export function dependencyAcquisitionSubcode(error) {
  const code = ownData(error, "code");
  if (code === "ENOENT") return "subprocess_spawn_enoent";
  if (code === "EACCES") return "subprocess_spawn_eacces";
  if (code === "EPERM") return "subprocess_spawn_eperm";
  if (code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" || ownData(error, "maxOutputExceeded") === true) return "subprocess_output_limit";
  if (ownData(error, "timedOut") === true) return "subprocess_timeout";
  const signal = ownData(error, "signal");
  if (signal === "SIGTERM") return "subprocess_observed_signal_sigterm";
  if (signal === "SIGKILL") return "subprocess_observed_signal_sigkill";
  if (typeof code !== "number") return undefined;
  return npmSubcodes.get(npmReportedCode(error)) ?? "subprocess_exit_nonzero";
}

// The outer verifier's current phase is the only input. Never inspect a caught error.
function safeExternalDiagnostic(value) {
  if (!value || typeof value !== "object") return undefined;
  try {
    const { boundary, httpStatus } = value;
    if (boundary !== "github_release_metadata" || !Number.isInteger(httpStatus) || httpStatus < 400 || httpStatus > 599) return undefined;
    return { boundary: "github_release_metadata", httpStatus };
  } catch {
    return undefined;
  }
}

export function packagedVerificationDiagnostic(stage, external, subcode) {
  const upstream = safeExternalDiagnostic(external);
  return {
    stage: stages.has(stage) ? stage : "packaged_verification",
    errorCode: "verification_failed",
    ...(stage === "dependency_acquisition" && typeof subcode === "string" && [...npmSubcodes.values(), ...childExecutionSubcodes].includes(subcode) ? { subcode } : {}),
    ...(upstream ? { external: upstream } : {}),
  };
}
