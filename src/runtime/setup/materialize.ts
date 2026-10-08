import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { DiscoveredService, ServiceActionMaterialization } from "../../contracts/service.js";
import { resolveServiceText, type ServiceTextResolutionOptions, type ServiceSelectorDiagnostic } from "../operator/variables.js";
import { writeEphemeralSecretFile } from "../broker/secret-files.js";
import type { MaterializationWriteHooks } from "../startup/materialization.js";

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

async function readTemplateSource(
  serviceRoot: string,
  sourcePath: string,
  expectedTemplateDigests?: Readonly<Record<string, string>>,
): Promise<string> {
  const resolved = resolveTemplateSourcePath(serviceRoot, sourcePath);

  try {
    const content = await readFile(resolved.absolutePath, "utf8");
    const expected = expectedTemplateDigests?.[resolved.relativePath];
    if (expected) {
      const actual = createHash("sha256").update(content).digest("hex");
      if (actual !== expected) {
        throw new Error(`Materialized template source changed after guarded preflight: ${resolved.relativePath}`);
      }
    }
    return content;
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
  hooks?: MaterializationWriteHooks,
  expectedTemplateDigests?: Readonly<Record<string, string>>,
): Promise<MaterializedArtifactResult> {
  const files = definition?.files ?? [];
  const materializedPaths: string[] = [];

  for (const file of files.filter((entry) => !entry.ephemeral)) {
    const renderedRelativePath = resolveServiceText(file.path, service, sharedGlobalEnv, resolvedPorts, options);
    const renderedContent = resolveServiceText(file.content, service, sharedGlobalEnv, resolvedPorts, options);
    const { absolutePath, relativePath } = resolveArtifactPath(service.serviceRoot, renderedRelativePath);
    const actionId = await hooks?.beforeWrite({ absolutePath, relativePath });
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, renderedContent, "utf8");
    if (actionId) await hooks?.afterWrite(actionId);
    materializedPaths.push(relativePath);
  }

  for (const template of (definition?.templates ?? []).filter((entry) => !entry.ephemeral)) {
    const sourceContent = await readTemplateSource(service.serviceRoot, template.source, expectedTemplateDigests);
    const renderedRelativePath = resolveServiceText(template.target, service, sharedGlobalEnv, resolvedPorts, options);
    const renderedContent = resolveServiceText(sourceContent, service, sharedGlobalEnv, resolvedPorts, options);
    const { absolutePath, relativePath } = resolveArtifactPath(service.serviceRoot, renderedRelativePath);
    const actionId = await hooks?.beforeWrite({ absolutePath, relativePath });
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, renderedContent, "utf8");
    if (actionId) await hooks?.afterWrite(actionId);
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
  hooks?: MaterializationWriteHooks,
  expectedTemplateDigests?: Readonly<Record<string, string>>,
): Promise<MaterializedArtifactResult> {
  return materializeFiles(service, service.manifest.install, sharedGlobalEnv, resolvedPorts, options, hooks, expectedTemplateDigests);
}

export async function materializeConfigArtifacts(
  service: DiscoveredService,
  sharedGlobalEnv: Record<string, string> = {},
  resolvedPorts: Record<string, number> = {},
  options: ServiceTextResolutionOptions = {},
  hooks?: MaterializationWriteHooks,
  expectedTemplateDigests?: Readonly<Record<string, string>>,
): Promise<MaterializedArtifactResult> {
  return materializeFiles(service, service.manifest.config, sharedGlobalEnv, resolvedPorts, options, hooks, expectedTemplateDigests);
}

/** Disposable outputs use the fresh launch resolution, never durable preimages. */
export async function materializeEphemeralSecretFiles(
  service: DiscoveredService,
  sharedGlobalEnv: Record<string, string>,
  resolvedPorts: Record<string, number>,
  options: ServiceTextResolutionOptions = {},
  expectedTemplateDigests?: Readonly<Record<string, string>>,
  publish?: (outputs: Array<{ path: string; content: string }>) => Promise<string>,
): Promise<string | undefined> {
  const outputs: Array<{ path: string; content: string }> = [];
  try {
    const diagnostics: ServiceSelectorDiagnostic[] = [];
    const resolution = { ...options, diagnostics };
    for (const file of (service.manifest.config?.files ?? []).filter((entry) => entry.ephemeral)) {
      outputs.push({
        path: resolveServiceText(file.path, service, sharedGlobalEnv, resolvedPorts, resolution),
        content: resolveServiceText(file.content, service, sharedGlobalEnv, resolvedPorts, resolution),
      });
    }
    for (const template of (service.manifest.config?.templates ?? []).filter((entry) => entry.ephemeral)) {
      const source = await readTemplateSource(service.serviceRoot, template.source, expectedTemplateDigests);
      outputs.push({
        path: resolveServiceText(template.target, service, sharedGlobalEnv, resolvedPorts, resolution),
        content: resolveServiceText(source, service, sharedGlobalEnv, resolvedPorts, resolution),
      });
    }
    // Refuse every unresolved secret-file selector, including optional imports.
    if (diagnostics.length > 0) throw new Error("Unresolved ephemeral secret-file inputs.");
    if (outputs.some((output) => output.path.includes("[available-at-launch]") || output.content.includes("[available-at-launch]"))) {
      throw new Error("The launch-only secret directory belongs in the service environment.");
    }
    if (outputs.length === 0) return undefined;
    if (process.env.SERVICE_LASSO_SECRET_FILES_TRANSPORT === "tmpfs") {
      for (const output of outputs) await writeEphemeralSecretFile(service, output.path, output.content);
      return undefined;
    }
    if (process.env.SERVICE_LASSO_SECRET_FILES_TRANSPORT && process.env.SERVICE_LASSO_SECRET_FILES_TRANSPORT !== "webdav") {
      throw new Error("Unknown secret-file transport.");
    }
    if (!publish) throw new Error("Broker RAM provider unavailable.");
    return await publish(outputs);
  } catch {
    // Resolved paths, templates and filesystem errors can contain secret values.
    throw new Error("Ephemeral secret-file preparation failed; check Broker inputs and the selected secret-file provider.");
  }
}
