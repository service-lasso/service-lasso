import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import type { DiscoveredService, ServiceActionMaterialization } from "../../contracts/service.js";
import { buildServiceVariables } from "../operator/variables.js";

export interface MaterializedArtifactResult {
  files: string[];
  updatedAt: string;
}

function renderTemplate(source: string, variables: ReturnType<typeof buildServiceVariables>["variables"]): string {
  return source.replace(/\$\{([^}]+)\}/g, (match, selector) => {
    const key = selector.trim();
    const resolved = variables.find((entry) => entry.key === key);
    return resolved ? resolved.value : match;
  });
}

function resolveArtifactPath(serviceRoot: string, relativePath: string): { absolutePath: string; relativePath: string } {
  if (relativePath.trim().length === 0) {
    throw new Error("Materialized file path must be a non-empty relative path.");
  }

  if (path.isAbsolute(relativePath)) {
    throw new Error(`Materialized file path must stay relative to the service root: ${relativePath}`);
  }

  const absolutePath = path.resolve(serviceRoot, relativePath);
  const normalizedRelative = path.relative(serviceRoot, absolutePath);
  if (
    normalizedRelative.length === 0 ||
    normalizedRelative === "." ||
    normalizedRelative.startsWith("..") ||
    path.isAbsolute(normalizedRelative)
  ) {
    throw new Error(`Materialized file path escapes the service root: ${relativePath}`);
  }

  return {
    absolutePath,
    relativePath: normalizedRelative.replaceAll("\\", "/"),
  };
}

async function materializeFiles(
  service: DiscoveredService,
  definition: ServiceActionMaterialization | undefined,
  sharedGlobalEnv: Record<string, string>,
  resolvedPorts: Record<string, number>,
): Promise<MaterializedArtifactResult> {
  const files = definition?.files ?? [];
  const variables = buildServiceVariables(service, sharedGlobalEnv, resolvedPorts).variables;
  const materializedPaths: string[] = [];

  for (const file of files) {
    const renderedRelativePath = renderTemplate(file.path, variables);
    const renderedContent = renderTemplate(file.content, variables);
    const { absolutePath, relativePath } = resolveArtifactPath(service.serviceRoot, renderedRelativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, renderedContent, "utf8");
    materializedPaths.push(relativePath);
  }

  return {
    files: materializedPaths,
    updatedAt: new Date().toISOString(),
  };
}

export async function materializeInstallArtifacts(
  service: DiscoveredService,
  sharedGlobalEnv: Record<string, string> = {},
  resolvedPorts: Record<string, number> = {},
): Promise<MaterializedArtifactResult> {
  return materializeFiles(service, service.manifest.install, sharedGlobalEnv, resolvedPorts);
}

export async function materializeConfigArtifacts(
  service: DiscoveredService,
  sharedGlobalEnv: Record<string, string> = {},
  resolvedPorts: Record<string, number> = {},
): Promise<MaterializedArtifactResult> {
  return materializeFiles(service, service.manifest.config, sharedGlobalEnv, resolvedPorts);
}
