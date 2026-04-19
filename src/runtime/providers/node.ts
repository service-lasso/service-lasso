import type { ServiceManifest } from "../../contracts/service.js";
import type { ProviderExecutionPlan } from "./types.js";

export function createNodeExecutionPlan(manifest: ServiceManifest): ProviderExecutionPlan {
  const executable = manifest.executable ?? "node";
  const args = manifest.args ?? [];

  return {
    provider: "node",
    providerServiceId: "@node",
    executable,
    args,
    commandPreview: [executable, ...args].join(" ").trim(),
  };
}
