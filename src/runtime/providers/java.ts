import path from "node:path";
import type { ServiceManifest } from "../../contracts/service.js";
import type { ProviderExecutionPlan } from "./types.js";

function normalizeProviderEnv(manifest: ServiceManifest): Record<string, string> {
  return Object.fromEntries(
    Object.entries(manifest.env ?? {}).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.join(path.delimiter) : value,
    ]),
  );
}

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
    providerEnv: normalizeProviderEnv(providerManifest),
    commandRoot: installedArtifact?.command ? installedArtifact.extractedPath : null,
  };
}
