import type { ServiceManifest } from "../../contracts/service.js";
import type { ProviderExecutionPlan } from "./types.js";

export function createPythonExecutionPlan(manifest: ServiceManifest): ProviderExecutionPlan {
  const executable = manifest.executable ?? "python";
  const args = manifest.args ?? [];

  return {
    provider: "python",
    providerServiceId: "@python",
    executable,
    args,
    commandPreview: [executable, ...args].join(" ").trim(),
  };
}
