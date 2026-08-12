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

export function createNodeExecutionPlan(
  serviceManifest: ServiceManifest,
  providerManifest: ServiceManifest,
  installedArtifact?: {
    command: string | null;
    extractedPath: string | null;
  },
): ProviderExecutionPlan {
  const executable = installedArtifact?.command ?? providerManifest.executable ?? "node";
  const args = serviceManifest.args ?? [];

  return {
    provider: "node",
    providerServiceId: "@node",
    executable,
    args,
    commandPreview: [executable, ...args].join(" ").trim(),
    providerEnv: normalizeProviderEnv(providerManifest),
    commandRoot: installedArtifact?.command ? installedArtifact.extractedPath : null,
  };
}
