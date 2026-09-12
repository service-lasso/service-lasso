import type {
  ServiceIsolationDegradeReason,
  ServiceIsolationLimits,
  ServiceIsolationMode,
  ServiceIsolationPolicy,
  ServiceIsolationRequire,
  ServiceIsolationStatus,
} from "../../contracts/service.js";

export const SERVICE_ISOLATION_MODES = new Set<ServiceIsolationMode>(["direct", "compose-scripts"]);
export const SERVICE_ISOLATION_REQUIRES = new Set<ServiceIsolationRequire>([
  "none",
  "limits",
  "dedicated-user",
  "hardened",
]);

/**
 * Builds the operator-visible isolation status for one service.
 * L2–L4 enforcement is not shipped yet; `require` other than `none` fails closed.
 *
 * @param declaration Parsed `isolation` object, or omitted for default direct mode.
 * @returns Secret-free status suitable for API/dashboard payloads.
 */
export function evaluateServiceIsolation(declaration: ServiceIsolationPolicy | undefined): ServiceIsolationStatus {
  const declaredMode: ServiceIsolationMode = declaration?.mode ?? "direct";
  const require: ServiceIsolationRequire = declaration?.require ?? "none";
  const workspace = declaration?.workspace ?? [];
  const limits = declaration?.limits;
  const degradeReasons: ServiceIsolationDegradeReason[] = [];

  if (hasDeclaredLimits(limits)) {
    degradeReasons.push("limits_not_applied");
  }
  if (require === "dedicated-user") {
    degradeReasons.push("dedicated_user_unavailable");
  }
  if (require === "hardened") {
    degradeReasons.push("hardening_unavailable");
  }

  const startBlockedReason = startBlockReason(require, hasDeclaredLimits(limits));
  return {
    declaredMode,
    effectiveMode: declaredMode,
    require,
    workspace,
    limits,
    limitsEnforced: false,
    degradeReasons,
    startBlocked: startBlockedReason !== undefined,
    startBlockedReason,
  };
}

/**
 * Fails closed before process spawn when `isolation.require` cannot be satisfied.
 *
 * @param status Result of {@link evaluateServiceIsolation}.
 * @param serviceId Service id for the error message.
 */
export function assertIsolationStartAllowed(status: ServiceIsolationStatus, serviceId: string): void {
  if (!status.startBlocked) {
    return;
  }
  throw new Error(
    `Cannot start service "${serviceId}" because isolation.require="${status.require}" is not satisfied: ${status.startBlockedReason ?? "unsupported isolation rung"}.`,
  );
}

function hasDeclaredLimits(limits: ServiceIsolationLimits | undefined): boolean {
  if (!limits) {
    return false;
  }
  return limits.cpuPercent !== undefined || limits.memoryMb !== undefined || limits.pids !== undefined;
}

function startBlockReason(require: ServiceIsolationRequire, limitsDeclared: boolean): string | undefined {
  if (require === "none") {
    return undefined;
  }
  if (require === "limits") {
    return limitsDeclared
      ? "CPU/memory/pid limits are declared but Core does not apply cgroup or Job caps yet"
      : "isolation.require is limits but isolation.limits is empty";
  }
  if (require === "dedicated-user") {
    return "dedicated service-user launch is not implemented";
  }
  return "namespace/Landlock/capability hardening is not implemented";
}
