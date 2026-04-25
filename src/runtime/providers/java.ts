import type { ServiceManifest } from "../../contracts/service.js";
import type { ProviderExecutionPlan } from "./types.js";

export function createJavaExecutionPlan(
  serviceManifest: ServiceManifest,
  providerManifest: ServiceManifest,
): ProviderExecutionPlan {
  const executable = providerManifest.executable ?? "java";
  const args = serviceManifest.args ?? [];

  return {
    provider: "java",
    providerServiceId: "@java",
    executable,
    args,
    commandPreview: [executable, ...args].join(" ").trim(),
    providerEnv: providerManifest.env ?? {},
    commandRoot: null,
  };
}
