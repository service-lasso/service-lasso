import type { ServiceManifest } from "../../contracts/service.js";
import type { ProviderExecutionPlan } from "./types.js";

export function createPythonExecutionPlan(
  serviceManifest: ServiceManifest,
  providerManifest: ServiceManifest,
): ProviderExecutionPlan {
  const executable = providerManifest.executable ?? "python";
  const args = serviceManifest.args ?? [];

  return {
    provider: "python",
    providerServiceId: "@python",
    executable,
    args,
    commandPreview: [executable, ...args].join(" ").trim(),
    providerEnv: providerManifest.env ?? {},
    commandRoot: null,
  };
}
