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
  const executable = manifest.executable ?? installedArtifact?.command ?? manifest.id;
  const args = manifest.args ?? (manifest.executable ? [] : installedArtifact?.args ?? []);

  return {
    provider: "direct",
    providerServiceId: null,
    executable,
    args,
    commandPreview: [executable, ...args].join(" ").trim(),
    providerEnv: {},
    commandRoot: manifest.executable ? null : installedArtifact?.extractedPath ?? null,
  };
}
