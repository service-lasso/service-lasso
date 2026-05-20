import path from "node:path";
import { access, mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import type { DiscoveredService } from "../../contracts/service.js";
import type { ServiceLifecycleState } from "../lifecycle/types.js";

export interface ServiceLogEntry {
  level: "info" | "stdout" | "stderr";
  message: string;
}

export interface ServiceRuntimeLogPaths {
  logPath: string;
  stdoutPath: string;
  stderrPath: string;
}

export interface ServiceRuntimeLogArchive {
  archiveId: string;
  archivedAt: string;
  directoryPath: string;
  logPath: string;
  stdoutPath: string;
  stderrPath: string;
}

export interface ServiceLogsPayload extends ServiceRuntimeLogPaths {
  serviceId: string;
  entries: ServiceLogEntry[];
  archives: ServiceRuntimeLogArchive[];
  retention: {
    maxArchives: number;
  };
}

export interface ServiceLogInfoPayload {
  serviceId: string;
  type: "default";
  path: string;
  availableTypes: ["default"];
}

export interface ServiceLogChunkPayload {
  serviceId: string;
  type: "default";
  path: string;
  totalLines: number;
  start: number;
  end: number;
  hasMore: boolean;
  nextBefore: number;
  limit: number;
  lines: string[];
}

export interface ServiceLogSearchMatchPayload {
  serviceId: string;
  type: "default";
  source: "current" | "archive";
  archiveId: string | null;
  path: string;
  lineNumber: number;
  level: "info" | "stdout" | "stderr" | "unknown";
  snippet: string;
  truncated: boolean;
}

export interface ServiceLogSearchPayload {
  serviceId: string;
  type: "default";
  query: string;
  limit: number;
  includeArchives: boolean;
  truncated: boolean;
  matches: ServiceLogSearchMatchPayload[];
}

interface PersistedRuntimeLogEntry {
  level?: "stdout" | "stderr";
  message?: string;
}

export const SERVICE_RUNTIME_LOG_ARCHIVE_RETENTION = 3;

export function getServiceRuntimeLogsRoot(serviceRoot: string): string {
  return path.join(serviceRoot, "logs");
}

export function getServiceRuntimeLogPaths(serviceRoot: string): ServiceRuntimeLogPaths {
  const runtimeLogsRoot = path.join(getServiceRuntimeLogsRoot(serviceRoot), "runtime");

  return {
    logPath: path.join(runtimeLogsRoot, "service.log"),
    stdoutPath: path.join(runtimeLogsRoot, "stdout.log"),
    stderrPath: path.join(runtimeLogsRoot, "stderr.log"),
  };
}

export function getServiceRuntimeArchiveRoot(serviceRoot: string): string {
  return path.join(getServiceRuntimeLogsRoot(serviceRoot), "archive");
}

function getArchiveLogPaths(archiveRoot: string): ServiceRuntimeLogPaths {
  return {
    logPath: path.join(archiveRoot, "service.log"),
    stdoutPath: path.join(archiveRoot, "stdout.log"),
    stderrPath: path.join(archiveRoot, "stderr.log"),
  };
}

function buildArchiveId(timestamp: Date): string {
  return timestamp.toISOString().replace(/[:.]/g, "-");
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function listRuntimeLogFiles(serviceRoot: string): Promise<Array<{ source: string; target: string }>> {
  const currentPaths = getServiceRuntimeLogPaths(serviceRoot);
  const files = Object.values(currentPaths);
  const existing = await Promise.all(files.map(async (source) => ({ source, exists: await pathExists(source) })));

  return existing
    .filter((entry) => entry.exists)
    .map((entry) => ({
      source: entry.source,
      target: path.basename(entry.source),
    }));
}

async function buildArchiveRecord(archiveRoot: string, archiveId: string): Promise<ServiceRuntimeLogArchive> {
  const archivePaths = getArchiveLogPaths(archiveRoot);
  const stats = await stat(archiveRoot);

  return {
    archiveId,
    archivedAt: stats.mtime.toISOString(),
    directoryPath: archiveRoot,
    ...archivePaths,
  };
}

async function pruneRuntimeLogArchives(
  serviceRoot: string,
  maxArchives = SERVICE_RUNTIME_LOG_ARCHIVE_RETENTION,
): Promise<ServiceRuntimeLogArchive[]> {
  const archiveRoot = getServiceRuntimeArchiveRoot(serviceRoot);
  let archiveDirectories: string[] = [];

  try {
    const entries = await readdir(archiveRoot, { withFileTypes: true });
    archiveDirectories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse();
  } catch {
    return [];
  }

  const staleArchiveIds = archiveDirectories.slice(maxArchives);

  await Promise.all(staleArchiveIds.map((archiveId) => rm(path.join(archiveRoot, archiveId), { recursive: true, force: true })));

  return Promise.all(
    archiveDirectories
      .slice(0, maxArchives)
      .map((archiveId) => buildArchiveRecord(path.join(archiveRoot, archiveId), archiveId)),
  );
}

export async function archiveRuntimeLogs(
  serviceRoot: string,
  maxArchives = SERVICE_RUNTIME_LOG_ARCHIVE_RETENTION,
): Promise<ServiceRuntimeLogArchive[]> {
  const files = await listRuntimeLogFiles(serviceRoot);
  if (files.length === 0) {
    return pruneRuntimeLogArchives(serviceRoot, maxArchives);
  }

  const archiveRoot = getServiceRuntimeArchiveRoot(serviceRoot);
  await mkdir(archiveRoot, { recursive: true });

  const baseArchiveId = buildArchiveId(new Date());
  let archiveId = baseArchiveId;
  let archiveDirectory = path.join(archiveRoot, archiveId);
  let suffix = 1;

  while (await pathExists(archiveDirectory)) {
    archiveId = `${baseArchiveId}-${suffix}`;
    archiveDirectory = path.join(archiveRoot, archiveId);
    suffix += 1;
  }

  await mkdir(archiveDirectory, { recursive: true });

  await Promise.all(
    files.map(({ source, target }) => rename(source, path.join(archiveDirectory, target))),
  );

  return pruneRuntimeLogArchives(serviceRoot, maxArchives);
}

export async function listRuntimeLogArchives(serviceRoot: string): Promise<ServiceRuntimeLogArchive[]> {
  return pruneRuntimeLogArchives(serviceRoot, SERVICE_RUNTIME_LOG_ARCHIVE_RETENTION);
}

function buildSyntheticEntries(serviceId: string, lifecycle: ServiceLifecycleState): ServiceLogEntry[] {
  return lifecycle.actionHistory.map((action) => ({
    level: "info" as const,
    message: `${serviceId}:${action}`,
  }));
}

async function readRuntimeLogEntries(logPath: string): Promise<ServiceLogEntry[]> {
  try {
    const content = await readFile(logPath, "utf8");
    const entries = content
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        try {
          return JSON.parse(line) as PersistedRuntimeLogEntry;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is PersistedRuntimeLogEntry => entry !== null)
      .filter(
        (entry): entry is { level: "stdout" | "stderr"; message: string } =>
          (entry.level === "stdout" || entry.level === "stderr") && typeof entry.message === "string",
      );

    return entries.map((entry) => ({
      level: entry.level,
      message: entry.message,
    }));
  } catch {
    return [];
  }
}

async function readRuntimeLogLines(logPath: string): Promise<string[]> {
  try {
    return (await readFile(logPath, "utf8"))
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0);
  } catch {
    return [];
  }
}

function normalizeLogSearchLimit(limit = 50): number {
  return Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.trunc(limit))) : 50;
}

function parseSearchLine(line: string): { level: ServiceLogSearchMatchPayload["level"]; message: string } {
  try {
    const entry = JSON.parse(line) as PersistedRuntimeLogEntry;
    if ((entry.level === "stdout" || entry.level === "stderr") && typeof entry.message === "string") {
      return {
        level: entry.level,
        message: entry.message,
      };
    }
  } catch {
    // Fall through to raw line search for legacy/plaintext runtime logs.
  }

  return {
    level: "unknown",
    message: line,
  };
}

function buildSearchSnippet(message: string, maxLength = 240): { snippet: string; truncated: boolean } {
  if (message.length <= maxLength) {
    return { snippet: message, truncated: false };
  }

  return {
    snippet: `${message.slice(0, maxLength)}...`,
    truncated: true,
  };
}

export async function buildServiceLogs(
  service: DiscoveredService,
  lifecycle: ServiceLifecycleState,
): Promise<ServiceLogsPayload> {
  const runtimeLogPaths = getServiceRuntimeLogPaths(service.serviceRoot);
  const capturedEntries = await readRuntimeLogEntries(runtimeLogPaths.logPath);
  const archives = await listRuntimeLogArchives(service.serviceRoot);

  return {
    serviceId: service.manifest.id,
    ...runtimeLogPaths,
    entries: capturedEntries.length > 0 ? capturedEntries : buildSyntheticEntries(service.manifest.id, lifecycle),
    archives,
    retention: {
      maxArchives: SERVICE_RUNTIME_LOG_ARCHIVE_RETENTION,
    },
  };
}

export function buildServiceLogInfo(service: DiscoveredService): ServiceLogInfoPayload {
  const runtimeLogPaths = getServiceRuntimeLogPaths(service.serviceRoot);

  return {
    serviceId: service.manifest.id,
    type: "default",
    path: runtimeLogPaths.logPath,
    availableTypes: ["default"],
  };
}

export async function readServiceLogChunk(
  service: DiscoveredService,
  before?: number,
  limit = 100,
): Promise<ServiceLogChunkPayload> {
  const runtimeLogPaths = getServiceRuntimeLogPaths(service.serviceRoot);
  const lines = await readRuntimeLogLines(runtimeLogPaths.logPath);
  const totalLines = lines.length;
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.trunc(limit))) : 100;
  const end = typeof before === "number" ? Math.max(0, Math.min(totalLines, before)) : totalLines;
  const start = Math.max(0, end - safeLimit);
  const slice = lines.slice(start, end);

  return {
    serviceId: service.manifest.id,
    type: "default",
    path: runtimeLogPaths.logPath,
    totalLines,
    start,
    end,
    hasMore: start > 0,
    nextBefore: start,
    limit: safeLimit,
    lines: slice,
  };
}

export async function searchServiceLogs(
  service: DiscoveredService,
  query: string,
  options: { limit?: number; includeArchives?: boolean } = {},
): Promise<ServiceLogSearchPayload> {
  const normalizedQuery = query.trim();
  const safeLimit = normalizeLogSearchLimit(options.limit);
  const includeArchives = options.includeArchives === true;
  const runtimeLogPaths = getServiceRuntimeLogPaths(service.serviceRoot);
  const sources: Array<{
    source: "current" | "archive";
    archiveId: string | null;
    path: string;
  }> = [
    {
      source: "current",
      archiveId: null,
      path: runtimeLogPaths.logPath,
    },
  ];

  if (includeArchives) {
    const archives = await listRuntimeLogArchives(service.serviceRoot);
    sources.push(...archives.map((archive) => ({ source: "archive" as const, archiveId: archive.archiveId, path: archive.logPath })));
  }

  const lowerQuery = normalizedQuery.toLocaleLowerCase();
  const matches: ServiceLogSearchMatchPayload[] = [];
  let truncated = false;

  for (const source of sources) {
    const lines = await readRuntimeLogLines(source.path);
    for (const [index, line] of lines.entries()) {
      const parsed = parseSearchLine(line);
      if (!parsed.message.toLocaleLowerCase().includes(lowerQuery)) {
        continue;
      }

      if (matches.length >= safeLimit) {
        truncated = true;
        break;
      }

      const snippet = buildSearchSnippet(parsed.message);
      matches.push({
        serviceId: service.manifest.id,
        type: "default",
        source: source.source,
        archiveId: source.archiveId,
        path: source.path,
        lineNumber: index + 1,
        level: parsed.level,
        snippet: snippet.snippet,
        truncated: snippet.truncated,
      });
    }

    if (truncated) {
      break;
    }
  }

  return {
    serviceId: service.manifest.id,
    type: "default",
    query: normalizedQuery,
    limit: safeLimit,
    includeArchives,
    truncated,
    matches,
  };
}
