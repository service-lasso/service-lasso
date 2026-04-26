import type { ServiceManifest } from "../../contracts/service.js";
import type { ProviderExecutionPlan } from "./types.js";

export function createDirectExecutionPlan(
  manifest: ServiceManifest,
  installedArtifact?: {
    command: string | null;
    args: string[];
    extractedPath: string | null;
  },
): ProviderExecutionPlan {
  const executable = installedArtifact?.command ?? manifest.executable ?? manifest.id;
  const args = installedArtifact?.command ? installedArtifact.args : manifest.args ?? [];
  const commandRoot = installedArtifact?.command
    ? installedArtifact.extractedPath
    : null;

  return {
    provider: "direct",
    providerServiceId: null,
    executable,
    args,
    commandPreview: [executable, ...args].join(" ").trim(),
    providerEnv: {},
    commandRoot,
  };
}
