import type { ServiceManifest } from "../../contracts/service.js";
import type { ProviderExecutionPlan } from "./types.js";

export function createDirectExecutionPlan(manifest: ServiceManifest): ProviderExecutionPlan {
  const executable = manifest.executable ?? manifest.id;
  const args = manifest.args ?? [];

  return {
    provider: "direct",
    providerServiceId: null,
    executable,
    args,
    commandPreview: [executable, ...args].join(" ").trim(),
  };
}
