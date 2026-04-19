import type { ServiceManifest } from "../../contracts/service.js";
import type { ServiceLifecycleState } from "../lifecycle/types.js";
import { checkHttpHealth } from "./checkHttp.js";
import { checkProcessHealth } from "./checkProcess.js";
import type { ServiceHealthResult } from "./types.js";

export async function evaluateServiceHealth(
  manifest: ServiceManifest,
  lifecycle: ServiceLifecycleState,
): Promise<ServiceHealthResult> {
  const healthcheck = manifest.healthcheck;

  if (!healthcheck || healthcheck.type === "process") {
    return checkProcessHealth(lifecycle.running);
  }

  if (healthcheck.type === "http") {
    return checkHttpHealth(healthcheck);
  }

  return {
    type: "unknown",
    healthy: false,
    detail: "Unsupported healthcheck type.",
  };
}
