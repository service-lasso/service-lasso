import type { DiscoveredService } from "../../contracts/service.js";
import { resolveServiceVariable } from "../operator/variables.js";
import type { ServiceHealthResult, VariableHealthcheck } from "./types.js";

export async function checkVariableHealth(
  healthcheck: VariableHealthcheck,
  service?: DiscoveredService,
  sharedGlobalEnv: Record<string, string> = {},
  resolvedPorts: Record<string, number> = service?.manifest.ports ?? {},
): Promise<ServiceHealthResult> {
  if (!service) {
    return {
      type: "variable",
      healthy: false,
      detail: "Variable healthcheck requires service context.",
    };
  }

  const entry = resolveServiceVariable(service, healthcheck.variable, sharedGlobalEnv, resolvedPorts);
  if (!entry || entry.value.trim().length === 0) {
    return {
      type: "variable",
      healthy: false,
      detail: `Variable healthcheck did not resolve expected variable: ${healthcheck.variable}`,
    };
  }

  return {
    type: "variable",
    healthy: true,
    detail: `Variable healthcheck resolved ${entry.key} from ${entry.scope} scope.`,
  };
}
