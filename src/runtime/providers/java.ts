import type { ServiceManifest } from "../../contracts/service.js";
import type { ProviderExecutionPlan } from "./types.js";

export function createJavaExecutionPlan(
  serviceManifest: ServiceManifest,
  providerManifest: ServiceManifest,
  installedArtifact?: {
    command: string | null;
    extractedPath: string | null;
  },
): ProviderExecutionPlan {
  const executable = installedArtifact?.command ?? providerManifest.executable ?? "java";
  const args = serviceManifest.args ?? [];

  return {
    provider: "java",
    providerServiceId: "@java",
    executable,
    args,
    commandPreview: [executable, ...args].join(" ").trim(),
    providerEnv: providerManifest.env ?? {},
    commandRoot: installedArtifact?.command ? installedArtifact.extractedPath : null,
  };
}
