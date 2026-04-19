import type { ServiceHealthResult } from "./types.js";

export function checkProcessHealth(isRunning: boolean): ServiceHealthResult {
  return {
    type: "process",
    healthy: isRunning,
    detail: isRunning ? "Service is marked running." : "Service is not running.",
  };
}
