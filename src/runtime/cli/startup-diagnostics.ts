import type { LifecycleAction, ServiceStartTraceAttempt, ServiceStartTracePhase } from "../lifecycle/types.js";
import { ReleaseAcquisitionError } from "../setup/acquire.js";
import { RuntimeEndpointAllocationError } from "../ports/allocation.js";

const phaseReasons: Partial<Record<ServiceStartTracePhase, string>> = {
  dependency_resolution: "dependency_not_ready",
  port_selection: "port_unavailable",
  artifact_acquisition: "artifact_not_ready",
  env_merge: "environment_not_ready",
  process_spawn: "process_launch_failed",
  health_check: "required_readiness_failed",
};

/** A closed terminal projection: never copy a child/exception message into it. */
export class BaselineStartupError extends Error {
  readonly code: string;
  readonly phase: string;
  readonly reason: string;

  constructor(
    readonly serviceId: string,
    readonly action: LifecycleAction,
    error: unknown,
    trace?: ServiceStartTraceAttempt | null,
  ) {
    const failed = [...(trace?.events ?? [])].reverse().find(event => event.phase !== "terminal_outcome"
      && (event.status === "blocked" || event.status === "failed"));
    const phase = failed?.phase ?? action;
    const reason = error instanceof ReleaseAcquisitionError
      ? error.code : (failed && phaseReasons[failed.phase]) ?? `${action}_failed`;
    super(`Baseline startup failed: service=${JSON.stringify(serviceId)} action=${action} phase=${phase} reason=${reason}.`, { cause: error });
    this.name = "BaselineStartupError";
    this.code = error instanceof ReleaseAcquisitionError ? error.code : "baseline_startup_failed";
    this.phase = phase;
    this.reason = reason;
  }
}

export function startupFailureMessage(error: unknown): string | null {
  if (error instanceof BaselineStartupError) return error.message;
  if (error instanceof RuntimeEndpointAllocationError && error.ownerId === "runtime-api") {
    return `Runtime startup failed: service=runtime-api phase=port_selection reason=${error.code}; API endpoint ${error.host}:${error.port ?? "unavailable"} is occupied or unavailable. No foreign listener was stopped or adopted. For source startup choose another fixed API port with SERVICE_LASSO_PORT or npm start -- --port <port>; use the same workspace for start/stop/restart/status and point clients at the reported URL.`;
  }
  if (error instanceof RuntimeEndpointAllocationError) {
    return `Runtime startup failed: service=${JSON.stringify(error.ownerId)} phase=port_selection reason=${error.code}; endpoint ${error.host}:${error.port ?? "unavailable"} is occupied or unavailable. No foreign listener was stopped or adopted. Inspect this service's endpoint configuration in the same workspace before retrying.`;
  }
  return null;
}
