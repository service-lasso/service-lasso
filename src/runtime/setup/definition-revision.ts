import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { DiscoveredService, ServiceActionMaterialization } from "../../contracts/service.js";
import { resolveManagedProcessLaunch } from "../execution/supervisor.js";
import { getLifecycleState } from "../lifecycle/store.js";
import type { ServiceRegistry } from "../manager/ServiceRegistry.js";
import type { ServiceVariableResolutionOptions } from "../operator/variables.js";
import { createDirectExecutionPlan } from "../providers/direct.js";
import { resolveProviderExecution } from "../providers/resolveProvider.js";
import type { ProviderExecutionPlan } from "../providers/types.js";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]),
  );
}

async function templateDigests(
  service: DiscoveredService,
  definitions: Array<ServiceActionMaterialization | undefined>,
): Promise<Array<{ source: string; sha256: string }>> {
  const sources = [...new Set(definitions.flatMap((definition) => definition?.templates?.map((entry) => entry.source) ?? []))].sort();
  return await Promise.all(sources.map(async (source) => {
    const absolutePath = path.resolve(service.serviceRoot, source);
    const relativePath = path.relative(service.serviceRoot, absolutePath);
    if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      throw new Error(`Service mutation template source escapes the service root: ${source}`);
    }
    return {
      source: relativePath.replaceAll("\\", "/"),
      sha256: createHash("sha256").update(await readFile(absolutePath)).digest("hex"),
    };
  }));
}

export interface ServiceMutationDefinitionBinding {
  revision: string;
  templateDigests: Record<string, string>;
}

export async function buildServiceMutationDefinitionBinding(service: DiscoveredService): Promise<ServiceMutationDefinitionBinding> {
  const templates = await templateDigests(service, [service.manifest.install, service.manifest.config]);
  const identity = {
    manifest: canonical(service.manifest),
    templateSources: templates,
  };
  return {
    revision: `service-definition-${createHash("sha256").update(JSON.stringify(identity)).digest("hex")}`,
    templateDigests: Object.fromEntries(templates.map((entry) => [entry.source, entry.sha256])),
  };
}

export async function buildServiceMutationDefinitionRevision(service: DiscoveredService): Promise<string> {
  return (await buildServiceMutationDefinitionBinding(service)).revision;
}

function isPathLike(candidate: string): boolean {
  return path.isAbsolute(candidate) || candidate.startsWith(".") || candidate.includes("/") || candidate.includes("\\");
}

function pathEnvironmentValue(env: NodeJS.ProcessEnv): string {
  const entry = Object.entries(env).find(([key]) => key.toLowerCase() === "path");
  return entry?.[1] ?? "";
}

async function resolveBareExecutableOnPath(
  executable: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  const extensions = process.platform === "win32" && !path.extname(executable)
    ? ["", ...(env.PATHEXT ?? process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)]
    : [""];
  const roots = [
    ...(process.platform === "win32" ? [cwd] : []),
    ...pathEnvironmentValue(env).split(path.delimiter).map((entry) => entry.replace(/^"|"$/g, "")).filter(Boolean),
  ];
  for (const root of roots) {
    for (const extension of extensions) {
      const candidate = path.resolve(root, `${executable}${extension}`);
      try {
        if ((await stat(candidate)).isFile()) return candidate;
      } catch (error) {
        if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
      }
    }
  }
  return null;
}

async function resolvePathLikeExecutable(
  executable: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  const basePath = path.isAbsolute(executable) ? path.normalize(executable) : path.resolve(cwd, executable);
  const extensions = process.platform === "win32" && !path.extname(basePath)
    ? ["", ...(env.PATHEXT ?? process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)]
    : [""];
  for (const extension of extensions) {
    const candidate = `${basePath}${extension}`;
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
    }
  }
  return null;
}

async function resolvedExecutionFileCandidates(
  service: DiscoveredService,
  executionPlan: ProviderExecutionPlan,
  resolvedPorts: Record<string, number>,
  sharedGlobalEnv: Record<string, string>,
  variableResolution: ServiceVariableResolutionOptions,
  secureEnv: Record<string, string>,
): Promise<string[]> {
  const launch = resolveManagedProcessLaunch(
    service,
    executionPlan,
    sharedGlobalEnv,
    resolvedPorts,
    secureEnv,
    variableResolution,
  );
  const candidates: string[] = [];
  if (isPathLike(launch.executable)) {
    const executablePath = await resolvePathLikeExecutable(
      launch.executable,
      launch.workingDirectory,
      launch.environment,
    );
    if (executablePath) candidates.push(executablePath);
  } else {
    const executablePath = await resolveBareExecutableOnPath(
      launch.executable,
      launch.workingDirectory,
      launch.environment,
    );
    if (executablePath) candidates.push(executablePath);
  }

  for (const arg of launch.args) {
    const equalsIndex = arg.indexOf("=");
    const candidate = equalsIndex > 0 ? arg.slice(equalsIndex + 1) : arg;
    if (!candidate || (equalsIndex < 0 && candidate.startsWith("-")) || /^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) continue;
    candidates.push(path.isAbsolute(candidate)
      ? path.normalize(candidate)
      : path.resolve(launch.workingDirectory, candidate));
  }
  return [...new Set(candidates)].sort();
}

export interface ExecutableInputFileDigest {
  file: string;
  sha256: string;
  size: number;
}

export interface ServiceExecutableMutationBinding {
  revision: string;
  files: ExecutableInputFileDigest[];
}

async function digestExecutableInputCandidates(candidates: readonly string[]): Promise<ExecutableInputFileDigest[]> {
  const files: ExecutableInputFileDigest[] = [];
  for (const absolutePath of [...new Set(candidates.map((candidate) => path.normalize(candidate)))].sort()) {
    try {
      const fileStat = await stat(absolutePath);
      if (!fileStat.isFile()) continue;
      files.push({
        file: absolutePath.replaceAll("\\", "/"),
        sha256: createHash("sha256").update(await readFile(absolutePath)).digest("hex"),
        size: fileStat.size,
      });
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
    }
  }
  return files;
}

export async function buildExecutableInputFiles(
  executable: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ExecutableInputFileDigest[]> {
  const candidates: string[] = [];
  if (isPathLike(executable)) {
    const executablePath = await resolvePathLikeExecutable(executable, cwd, env);
    if (executablePath) candidates.push(executablePath);
  }
  else {
    const executablePath = await resolveBareExecutableOnPath(executable, cwd, env);
    if (executablePath) candidates.push(executablePath);
  }
  for (const arg of args) {
    const equalsIndex = arg.indexOf("=");
    const candidate = equalsIndex > 0 ? arg.slice(equalsIndex + 1) : arg;
    if (!candidate || (equalsIndex < 0 && candidate.startsWith("-")) || /^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) continue;
    candidates.push(path.isAbsolute(candidate) ? path.normalize(candidate) : path.resolve(cwd, candidate));
  }
  return await digestExecutableInputCandidates(candidates);
}

export async function verifyExecutableInputFiles(expectedFiles: readonly ExecutableInputFileDigest[]): Promise<void> {
  for (const expected of expectedFiles) {
    const fileStat = await stat(expected.file);
    if (!fileStat.isFile() || fileStat.size !== expected.size) {
      throw new Error(`Resolved executable input changed after guarded preflight: ${expected.file}`);
    }
    const sha256 = createHash("sha256").update(await readFile(expected.file)).digest("hex");
    if (sha256 !== expected.sha256) {
      throw new Error(`Resolved executable input changed after guarded preflight: ${expected.file}`);
    }
  }
}

export async function buildServiceExecutableMutationBinding(
  service: DiscoveredService,
  registry?: ServiceRegistry,
  resolvedPorts: Record<string, number> = {},
  sharedGlobalEnv: Record<string, string> = {},
  variableResolution: ServiceVariableResolutionOptions = {},
  secureEnv: Record<string, string> = {},
): Promise<ServiceExecutableMutationBinding> {
  const state = getLifecycleState(service.manifest.id);
  const artifact = state.installArtifacts.artifact;
  const executionPlan = service.manifest.execservice
    ? registry
      ? resolveProviderExecution(service, registry)
      : null
    : createDirectExecutionPlan(service.manifest, artifact);
  const fileDigests = await digestExecutableInputCandidates(
    executionPlan
      ? await resolvedExecutionFileCandidates(
          service,
          executionPlan,
          resolvedPorts,
          sharedGlobalEnv,
          variableResolution,
          secureEnv,
        )
      : [],
  );
  const identity = {
    serviceId: service.manifest.id,
    lifecycle: {
      installed: state.installed,
      configured: state.configured,
      installArtifact: canonical(artifact),
    },
    executionPlan: canonical(executionPlan),
    fileDigests,
  };
  return {
    revision: `service-executable-${createHash("sha256").update(JSON.stringify(identity)).digest("hex")}`,
    files: fileDigests,
  };
}

export async function buildServiceExecutableMutationRevision(
  service: DiscoveredService,
  registry?: ServiceRegistry,
  resolvedPorts: Record<string, number> = {},
  sharedGlobalEnv: Record<string, string> = {},
  variableResolution: ServiceVariableResolutionOptions = {},
  secureEnv: Record<string, string> = {},
): Promise<string> {
  return (await buildServiceExecutableMutationBinding(
    service,
    registry,
    resolvedPorts,
    sharedGlobalEnv,
    variableResolution,
    secureEnv,
  )).revision;
}
