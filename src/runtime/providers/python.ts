import type { ServiceManifest } from "../../contracts/service.js";
import type { ProviderExecutionPlan } from "./types.js";

export function createPythonExecutionPlan(
  serviceManifest: ServiceManifest,
  providerManifest: ServiceManifest,
  installedArtifact?: {
    command: string | null;
    extractedPath: string | null;
  },
): ProviderExecutionPlan {
  const executable = installedArtifact?.command ?? providerManifest.executable ?? "python";
  const args = serviceManifest.args ?? [];

  return {
    provider: "python",
    providerServiceId: "@python",
    executable,
    args,
    commandPreview: [executable, ...args].join(" ").trim(),
    providerEnv: providerManifest.env ?? {},
    commandRoot: installedArtifact?.command ? installedArtifact.extractedPath : null,
  };
}
