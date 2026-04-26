import type { ServiceManifest } from "../../contracts/service.js";
import type { DiscoveredService } from "../../contracts/service.js";
import type { ServiceLifecycleState } from "../lifecycle/types.js";
import { checkFileHealth } from "./checkFile.js";
import { checkHttpHealth } from "./checkHttp.js";
import { checkProcessHealth } from "./checkProcess.js";
import { checkTcpHealth } from "./checkTcp.js";
import { checkVariableHealth } from "./checkVariable.js";
import type { ServiceHealthResult } from "./types.js";
import { isProviderRole } from "../roles.js";

export async function evaluateServiceHealth(
  manifest: ServiceManifest,
  lifecycle: ServiceLifecycleState,
  serviceRoot?: string,
  service?: DiscoveredService,
  sharedGlobalEnv: Record<string, string> = {},
): Promise<ServiceHealthResult> {
  const healthcheck = manifest.healthcheck;

  if (!healthcheck && isProviderRole(manifest)) {
    const ready = lifecycle.installed && lifecycle.configured;
    return {
      type: "provider",
      healthy: ready,
      detail: ready
        ? "Provider is installed/configured and does not require a managed daemon process."
        : "Provider is not installed/configured yet.",
    };
  }

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

  if (healthcheck.type === "variable") {
    return checkVariableHealth(
      healthcheck,
      service,
      sharedGlobalEnv,
      Object.keys(lifecycle.runtime.ports).length > 0 ? lifecycle.runtime.ports : manifest.ports ?? {},
    );
  }

  return {
    type: "unknown",
    healthy: false,
    detail: "Unsupported healthcheck type.",
  };
}
