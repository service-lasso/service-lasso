const stages = new Set([
  "consumer_setup", "package_staging", "dependency_acquisition", "installed_package_binding",
  "consumer_runner", "consumer_result", "evidence_validation", "evidence_write",
]);

const npmSubcodes = new Map([
  ["EAI_AGAIN", "npm_network_eai_again"],
  ["ECONNREFUSED", "npm_network_econnrefused"],
  ["ECONNRESET", "npm_network_econnreset"],
  ["EHOSTUNREACH", "npm_network_ehostunreach"],
  ["ENETDOWN", "npm_network_enetdown"],
  ["ENETUNREACH", "npm_network_enetunreach"],
  ["ENOTFOUND", "npm_network_enotfound"],
  ["ERR_SOCKET_TIMEOUT", "npm_network_socket_timeout"],
  ["ETIMEDOUT", "npm_network_etimedout"],
  ["EINTEGRITY", "npm_checksum_mismatch"],
  ["E401", "npm_registry_identity_rejected"],
  ["E403", "npm_registry_identity_rejected"],
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

export function dependencyAcquisitionSubcode(error) {
  const code = ownData(error, "code");
  if (code === "ENOENT") return "subprocess_spawn_enoent";
  if (code === "EACCES") return "subprocess_spawn_eacces";
  if (code === "EPERM") return "subprocess_spawn_eperm";
  if (typeof code === "number") return "subprocess_exit_nonzero";

  const stderr = ownData(error, "stderr");
  if (typeof stderr !== "string") return undefined;
  const match = /(?:^|\r?\n)npm ERR! code (E(?:[A-Z0-9_]+))(?:\r?\n|$)/u.exec(stderr);
  return match ? npmSubcodes.get(match[1]) : undefined;
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
    ...(stage === "dependency_acquisition" && typeof subcode === "string" && [...npmSubcodes.values(), "subprocess_spawn_enoent", "subprocess_spawn_eacces", "subprocess_spawn_eperm", "subprocess_exit_nonzero"].includes(subcode) ? { subcode } : {}),
    ...(upstream ? { external: upstream } : {}),
  };
}
