import type { ServiceManifest } from "../../contracts/service.js";
import type { ProviderExecutionPlan } from "./types.js";

export function createNodeExecutionPlan(
  serviceManifest: ServiceManifest,
  providerManifest: ServiceManifest,
): ProviderExecutionPlan {
  const executable = providerManifest.executable ?? "node";
  const args = serviceManifest.args ?? [];

  return {
    provider: "node",
    providerServiceId: "@node",
    executable,
    args,
    commandPreview: [executable, ...args].join(" ").trim(),
    providerEnv: providerManifest.env ?? {},
  };
}
