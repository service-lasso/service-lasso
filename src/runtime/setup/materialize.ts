import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { DiscoveredService, ServiceActionMaterialization } from "../../contracts/service.js";
import { resolveServiceText, type ServiceTextResolutionOptions } from "../operator/variables.js";

export interface MaterializedArtifactResult {
  files: string[];
  updatedAt: string;
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

function resolveTemplateSourcePath(serviceRoot: string, relativePath: string): { absolutePath: string; relativePath: string } {
  if (relativePath.trim().length === 0) {
    throw new Error("Materialized template source must be a non-empty relative path.");
  }

  if (path.isAbsolute(relativePath)) {
    throw new Error(`Materialized template source must stay relative to the service root: ${relativePath}`);
  }

  const absolutePath = path.resolve(serviceRoot, relativePath);
  const normalizedRelative = path.relative(serviceRoot, absolutePath);
  if (
    normalizedRelative.length === 0 ||
    normalizedRelative === "." ||
    normalizedRelative.startsWith("..") ||
    path.isAbsolute(normalizedRelative)
  ) {
    throw new Error(`Materialized template source escapes the service root: ${relativePath}`);
  }

  return {
    absolutePath,
    relativePath: normalizedRelative.replaceAll("\\", "/"),
  };
}

async function readTemplateSource(serviceRoot: string, sourcePath: string): Promise<string> {
  const resolved = resolveTemplateSourcePath(serviceRoot, sourcePath);

  try {
    return await readFile(resolved.absolutePath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error(`Materialized template source does not exist: ${resolved.relativePath}`);
    }

    throw error;
  }
}

async function materializeFiles(
  service: DiscoveredService,
  definition: ServiceActionMaterialization | undefined,
  sharedGlobalEnv: Record<string, string>,
  resolvedPorts: Record<string, number>,
  options: ServiceTextResolutionOptions = {},
): Promise<MaterializedArtifactResult> {
  const files = definition?.files ?? [];
  const materializedPaths: string[] = [];

  for (const file of files) {
    const renderedRelativePath = resolveServiceText(file.path, service, sharedGlobalEnv, resolvedPorts, options);
    const renderedContent = resolveServiceText(file.content, service, sharedGlobalEnv, resolvedPorts, options);
    const { absolutePath, relativePath } = resolveArtifactPath(service.serviceRoot, renderedRelativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, renderedContent, "utf8");
    materializedPaths.push(relativePath);
  }

  for (const template of definition?.templates ?? []) {
    const sourceContent = await readTemplateSource(service.serviceRoot, template.source);
    const renderedRelativePath = resolveServiceText(template.target, service, sharedGlobalEnv, resolvedPorts, options);
    const renderedContent = resolveServiceText(sourceContent, service, sharedGlobalEnv, resolvedPorts, options);
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
  options: ServiceTextResolutionOptions = {},
): Promise<MaterializedArtifactResult> {
  return materializeFiles(service, service.manifest.install, sharedGlobalEnv, resolvedPorts, options);
}

export async function materializeConfigArtifacts(
  service: DiscoveredService,
  sharedGlobalEnv: Record<string, string> = {},
  resolvedPorts: Record<string, number> = {},
  options: ServiceTextResolutionOptions = {},
): Promise<MaterializedArtifactResult> {
  return materializeFiles(service, service.manifest.config, sharedGlobalEnv, resolvedPorts, options);
}
