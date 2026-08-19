import type { DiscoveredService } from "../../contracts/service.js";
import type { ServiceStdinCapabilityResponse } from "../../contracts/api.js";
import { inspectManagedStdin } from "../execution/supervisor.js";

export const MAX_STDIN_INPUT_LENGTH = 2_048;

const UNAVAILABLE_REASON = "The runtime has not advertised a safe stdin channel for this service.";
const NO_PIPE_REASON = "No live stdin pipe is attached to this service.";

/**
 * Build the fail-closed stdin advertisement for log-info and Terminal consumers.
 *
 * A channel is available only when the manifest opts in and the live managed
 * process still has a writable stdin pipe. Adopted processes and ignored stdio
 * stay unavailable.
 */
export function buildServiceStdinCapability(service: DiscoveredService): ServiceStdinCapabilityResponse {
  const declaration = service.manifest.stdin;
  if (declaration?.enabled !== true) {
    return {
      available: false,
      reason: UNAVAILABLE_REASON,
      policy: "unavailable",
    };
  }

  const provider = declaration.provider ?? "direct";
  const pipe = inspectManagedStdin(service.manifest.id);
  if (!pipe.writable) {
    return {
      available: false,
      reason: NO_PIPE_REASON,
      policy: "denied",
      provider,
    };
  }

  return {
    available: true,
    policy: "allowed",
    provider,
  };
}

/**
 * True when the service manifest opts into a direct managed stdin pipe.
 */
export function serviceEnablesStdin(service: DiscoveredService): boolean {
  return service.manifest.stdin?.enabled === true;
}
