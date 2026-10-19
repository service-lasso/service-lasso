import { createHash } from "node:crypto";
import path from "node:path";
import { readFile } from "node:fs/promises";
import type { DiscoveredService, ServiceMaterializedFile } from "../../contracts/service.js";
import { getLifecycleState } from "../lifecycle/store.js";
import { collectRuntimeGlobalEnv, resolveServiceText } from "./variables.js";

export type ConfigDriftStatus = "unchanged" | "changed" | "missing" | "unmanaged";

export interface ConfigDriftFile {
  path: string;
  absolutePath: string;
  status: ConfigDriftStatus;
  desiredHash?: string;
  currentHash?: string;
  desiredSize?: number;
  currentSize?: number;
  desiredPreview?: string;
  currentPreview?: string;
}

export interface ConfigDriftReport {
  serviceId: string;
  checkedAt: string;
  configured: boolean;
  summary: {
    total: number;
    drifted: number;
    unchanged: number;
    changed: number;
    missing: number;
    unmanaged: number;
  };
  files: ConfigDriftFile[];
}

const SENSITIVE_LINE_PATTERN = /(secret|token|password|passwd|credential|cookie|private[_-]?key|api[_-]?key|dsn)/i;
const SENSITIVE_JSON_PATTERN =
  /("(?:[^"]*(?:secret|token|password|passwd|credential|cookie|private[_-]?key|api[_-]?key|dsn)[^"]*)"s*:s*)"[^"]*"/gi;
const SENSITIVE_ASSIGNMENT_PATTERN =
  /^([^\n:=]*(?:secret|token|password|passwd|credential|cookie|private[_-]?key|api[_-]?key|dsn)[^\n:=]*\s*[:=]).*$/gim;

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function redactPreview(content: string): string {
  const normalized = content.length > 1_000 ? `${content.slice(0, 1_000)}\n[truncated]` : content;
  return normalized
    .replace(SENSITIVE_JSON_PATTERN, '$1"[redacted]"')
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, "$1 [redacted]")
    .split("\n")
    .map((line) => (SENSITIVE_LINE_PATTERN.test(line) ? line.replace(/(:|=)\s*.+$/, "$1 [redacted]") : line))
    .join("\n");
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

async function readTextIfPresent(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function buildDesiredConfigFiles(
  service: DiscoveredService,
  services: DiscoveredService[],
): Array<{ path: string; absolutePath: string; content: string }> {
  const lifecycle = getLifecycleState(service.manifest.id);
  const resolvedPorts = Object.keys(lifecycle.runtime.ports).length > 0 ? lifecycle.runtime.ports : service.manifest.ports ?? {};
  const sharedGlobalEnv = collectRuntimeGlobalEnv(services);

  return (service.manifest.config?.files ?? []).map((file: ServiceMaterializedFile) => {
    const renderedPath = resolveServiceText(file.path, service, sharedGlobalEnv, resolvedPorts);
    const renderedContent = resolveServiceText(file.content, service, sharedGlobalEnv, resolvedPorts);
    const resolved = resolveArtifactPath(service.serviceRoot, renderedPath);
    return {
      path: resolved.relativePath,
      absolutePath: resolved.absolutePath,
      content: renderedContent,
    };
  });
}

export async function buildServiceConfigDriftReport(
  service: DiscoveredService,
  services: DiscoveredService[],
): Promise<ConfigDriftReport> {
  const lifecycle = getLifecycleState(service.manifest.id);
  const desiredFiles = buildDesiredConfigFiles(service, services);
  const desiredByPath = new Map(desiredFiles.map((file) => [file.path, file]));
  const files: ConfigDriftFile[] = [];

  for (const desired of desiredFiles) {
    const current = await readTextIfPresent(desired.absolutePath);
    const desiredHash = hashContent(desired.content);

    if (current === null) {
      files.push({
        path: desired.path,
        absolutePath: desired.absolutePath,
        status: "missing",
        desiredHash,
        desiredSize: desired.content.length,
        desiredPreview: redactPreview(desired.content),
      });
      continue;
    }

    const currentHash = hashContent(current);
    files.push({
      path: desired.path,
      absolutePath: desired.absolutePath,
      status: currentHash === desiredHash ? "unchanged" : "changed",
      desiredHash,
      currentHash,
      desiredSize: desired.content.length,
      currentSize: current.length,
      desiredPreview: currentHash === desiredHash ? undefined : redactPreview(desired.content),
      currentPreview: currentHash === desiredHash ? undefined : redactPreview(current),
    });
  }

  for (const recordedPath of lifecycle.configArtifacts.files) {
    const resolved = resolveArtifactPath(service.serviceRoot, recordedPath);
    if (desiredByPath.has(resolved.relativePath)) {
      continue;
    }
    const current = await readTextIfPresent(resolved.absolutePath);
    files.push({
      path: resolved.relativePath,
      absolutePath: resolved.absolutePath,
      status: "unmanaged",
      currentHash: current === null ? undefined : hashContent(current),
      currentSize: current?.length,
      currentPreview: current === null ? undefined : redactPreview(current),
    });
  }

  const summary = {
    total: files.length,
    drifted: files.filter((file) => file.status !== "unchanged").length,
    unchanged: files.filter((file) => file.status === "unchanged").length,
    changed: files.filter((file) => file.status === "changed").length,
    missing: files.filter((file) => file.status === "missing").length,
    unmanaged: files.filter((file) => file.status === "unmanaged").length,
  };

  return {
    serviceId: service.manifest.id,
    checkedAt: new Date().toISOString(),
    configured: lifecycle.configured,
    summary,
    files,
  };
}
