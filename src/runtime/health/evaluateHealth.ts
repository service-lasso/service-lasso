import type { ServiceManifest } from "../../contracts/service.js";
import type { ServiceLifecycleState } from "../lifecycle/types.js";
import { checkFileHealth } from "./checkFile.js";
import { checkHttpHealth } from "./checkHttp.js";
import { checkProcessHealth } from "./checkProcess.js";
import { checkTcpHealth } from "./checkTcp.js";
import type { ServiceHealthResult } from "./types.js";

export async function evaluateServiceHealth(
  manifest: ServiceManifest,
  lifecycle: ServiceLifecycleState,
  serviceRoot?: string,
): Promise<ServiceHealthResult> {
  const healthcheck = manifest.healthcheck;

  if (!healthcheck || healthcheck.type === "process") {
    return checkProcessHealth(lifecycle);
  }

  if (healthcheck.type === "http") {
    return checkHttpHealth(healthcheck);
  }

  if (healthcheck.type === "tcp") {
    return checkTcpHealth(healthcheck);
  }

  if (healthcheck.type === "file") {
    return checkFileHealth(healthcheck, serviceRoot);
  }

  return {
    type: "unknown",
    healthy: false,
    detail: "Unsupported healthcheck type.",
  };
}
