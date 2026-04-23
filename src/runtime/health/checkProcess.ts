import type { ServiceLifecycleState } from "../lifecycle/types.js";
import type { ServiceHealthResult } from "./types.js";

export function checkProcessHealth(lifecycle: ServiceLifecycleState): ServiceHealthResult {
  const isRunning = lifecycle.running;
  return {
    type: "process",
    healthy: isRunning,
    detail: isRunning
      ? lifecycle.runtime.pid
        ? `Service is running with pid ${lifecycle.runtime.pid}.`
        : "Service is marked running."
      : lifecycle.runtime.exitCode !== null
        ? `Service is not running. Last exit code: ${lifecycle.runtime.exitCode}.`
        : "Service is not running.",
  };
}
