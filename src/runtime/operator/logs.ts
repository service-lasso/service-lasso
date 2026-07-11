import path from "node:path";
import { access, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import type { DiscoveredService } from "../../contracts/service.js";
import type { ServiceLifecycleState } from "../lifecycle/types.js";

export interface ServiceLogEntry {
  level: "info" | "stdout" | "stderr";
  message: string;
}

export interface ServiceRuntimeLogPaths {
  runId: string;
  logPath: string;
  stdoutPath: string;
  stderrPath: string;
}

export interface ServiceRuntimeLogArchive {
  archiveId: string;
  runId: string;
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
  type: ServiceLogReadType;
  path: string;
  available: boolean;
  availableTypes: ServiceLogReadType[];
  sources: ServiceLogSourceInfo[];
}

export interface ServiceLogChunkPayload {
  serviceId: string;
  type: ServiceLogReadType;
  path: string;
  available: boolean;
  source: ServiceLogSourceInfo;
  totalLines: number;
  start: number;
  end: number;
  hasMore: boolean;
  nextBefore: number;
  cursor: string;
  nextCursor: string | null;
  limit: number;
  entries: ServiceLogLinePayload[];
  lines: string[];
}

export interface ServiceLogLinePayload {
  source: {
    kind: "current" | "archive";
    archiveId?: string;
    path: string;
    lineNumber: number;
  };
  stream: "stdout" | "stderr" | "unknown";
  message: string;
  text: string;
  truncated: boolean;
}

export interface ServiceLogSearchPayload {
  serviceId: string;
  type: ServiceLogReadType;
  path: string;
  query: string;
  includeArchives: boolean;
  limit: number;
  cursor: string;
  nextCursor: string | null;
  hasMore: boolean;
  totalScanned: number;
  matches: ServiceLogLinePayload[];
}

interface PersistedRuntimeLogEntry {
  level?: "stdout" | "stderr";
  message?: string;
}

export type ServiceLogReadType = "default" | "stdout" | "stderr";

export interface ServiceLogSourceInfo {
  kind: "current" | "archive";
  stream: "combined" | "stdout" | "stderr";
  runId: string;
  archiveId?: string;
  path: string;
  available: boolean;
  id?: string;
  label?: string;
  origin?: "builtin" | "declared" | "discovered";
  type?: "stream" | "file" | "glob";
  relativePath?: string;
  pattern?: string;
  format?: "text" | "json" | "ndjson";
  status?: "available" | "missing" | "unavailable";
  lastSeenAt?: string | null;
  sizeBytes?: number | null;
  tail?: boolean;
}

export const SERVICE_RUNTIME_LOG_ARCHIVE_RETENTION = 3;
const DEFAULT_LOG_CHUNK_LIMIT = 100;
const MAX_LOG_CHUNK_LIMIT = 500;
const DEFAULT_LOG_SEARCH_LIMIT = 50;
const MAX_LOG_SEARCH_LIMIT = 100;
const MAX_LOG_SEARCH_QUERY_LENGTH = 200;
const MAX_LOG_LINE_TEXT_LENGTH = 2_000;

export function getServiceRuntimeLogsRoot(serviceRoot: string): string {
  return path.join(serviceRoot, "logs");
}

function buildRunId(timestamp = new Date()): string {
  return timestamp.toISOString().replace(/[:.]/g, "-");
}

export function getServiceRuntimeLogPaths(serviceRoot: string, runId = "current"): ServiceRuntimeLogPaths {
  const runtimeLogsRoot = path.join(getServiceRuntimeLogsRoot(serviceRoot), "runtime");

  return {
    runId,
    logPath: path.join(runtimeLogsRoot, "service.log"),
    stdoutPath: path.join(runtimeLogsRoot, "stdout.log"),
    stderrPath: path.join(runtimeLogsRoot, "stderr.log"),
  };
}

export function getServiceRuntimeArchiveRoot(serviceRoot: string): string {
  return path.join(getServiceRuntimeLogsRoot(serviceRoot), "archive");
}

function getArchiveLogPaths(archiveRoot: string): ServiceRuntimeLogPaths {
  const runId = path.basename(archiveRoot);

  return {
    runId,
    logPath: path.join(archiveRoot, "service.log"),
    stdoutPath: path.join(archiveRoot, "stdout.log"),
    stderrPath: path.join(archiveRoot, "stderr.log"),
  };
}

function buildArchiveId(timestamp: Date): string {
  return buildRunId(timestamp);
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

export function buildServiceRuntimeLogRunId(startedAt?: string | null): string {
  if (!startedAt) {
    return buildRunId();
  }

  const parsed = new Date(startedAt);
  if (Number.isNaN(parsed.getTime())) {
    return buildRunId();
  }

  return buildRunId(parsed);
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

async function runtimeLogAvailable(logPath: string): Promise<boolean> {
  return pathExists(logPath);
}

function getLogSourceStatePath(serviceRoot: string): string {
  return path.join(serviceRoot, ".state", "log-sources.json");
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function resolveServiceOwnedPath(serviceRoot: string, relativePath: string): string | null {
  const normalized = normalizeRelativePath(relativePath);
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || normalized.split("/").some((segment) => segment === "..")) {
    return null;
  }

  const root = path.resolve(serviceRoot);
  const resolved = path.resolve(root, normalized);
  return resolved === root || resolved.startsWith(root + path.sep) ? resolved : null;
}

async function readFileSourceStatus(targetPath: string): Promise<{
  available: boolean;
  status: ServiceLogSourceInfo["status"];
  lastSeenAt: string | null;
  sizeBytes: number | null;
}> {
  try {
    const stats = await stat(targetPath);
    return {
      available: stats.isFile(),
      status: stats.isFile() ? "available" : "unavailable",
      lastSeenAt: stats.mtime.toISOString(),
      sizeBytes: stats.isFile() ? stats.size : null,
    };
  } catch {
    return {
      available: false,
      status: "missing",
      lastSeenAt: null,
      sizeBytes: null,
    };
  }
}

function sanitizePositiveInteger(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.min(max, Math.trunc(value)));
}

function sanitizeCursor(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.min(max, Math.trunc(value)));
}

function truncateLogText(value: string): { text: string; truncated: boolean } {
  if (value.length <= MAX_LOG_LINE_TEXT_LENGTH) {
    return { text: value, truncated: false };
  }

  return { text: value.slice(0, MAX_LOG_LINE_TEXT_LENGTH), truncated: true };
}

function parseRuntimeLogLine(text: string): { stream: ServiceLogLinePayload["stream"]; message: string } {
  try {
    const entry = JSON.parse(text) as PersistedRuntimeLogEntry;
    if ((entry.level === "stdout" || entry.level === "stderr") && typeof entry.message === "string") {
      return { stream: entry.level, message: entry.message };
    }
  } catch {
    // Plain text service logs are still searchable/readable, just not structured.
  }

  return { stream: "unknown", message: text };
}

function createLogLinePayload(
  text: string,
  source: { kind: "current" | "archive"; archiveId?: string; path: string; lineNumber: number },
): ServiceLogLinePayload {
  const parsed = parseRuntimeLogLine(text);
  const safeText = truncateLogText(text);
  const safeMessage = truncateLogText(parsed.message);

  return {
    source,
    stream: parsed.stream,
    message: safeMessage.text,
    text: safeText.text,
    truncated: safeText.truncated || safeMessage.truncated,
  };
}

function getLogPathForType(paths: ServiceRuntimeLogPaths, type: ServiceLogReadType): string {
  if (type === "stdout") return paths.stdoutPath;
  if (type === "stderr") return paths.stderrPath;
  return paths.logPath;
}

function getStreamForType(type: ServiceLogReadType): ServiceLogSourceInfo["stream"] {
  if (type === "stdout") return "stdout";
  if (type === "stderr") return "stderr";
  return "combined";
}

async function buildCurrentSourceInfo(
  paths: ServiceRuntimeLogPaths,
  type: ServiceLogReadType,
): Promise<ServiceLogSourceInfo> {
  const logPath = getLogPathForType(paths, type);
  const available = await runtimeLogAvailable(logPath);
  const id = type === "default" ? "combined" : type;

  return {
    kind: "current",
    stream: getStreamForType(type),
    runId: paths.runId,
    path: logPath,
    available,
    id,
    label: type === "default" ? "Combined runtime log" : type,
    origin: "builtin",
    type: "stream",
    status: available ? "available" : "missing",
    tail: true,
  };
}

async function buildLogSources(
  service: DiscoveredService,
  paths: ServiceRuntimeLogPaths,
): Promise<ServiceLogSourceInfo[]> {
  const builtin = await Promise.all(
    (["default", "stdout", "stderr"] as const).map((type) =>
      buildCurrentSourceInfo(paths, type),
    ),
  );
  const declared = await buildDeclaredLogSources(service, paths.runId);
  const discovered = await buildDiscoveredLogSources(service, paths.runId, new Set(declared.map((source) => source.relativePath)));
  const sources = [...builtin, ...declared, ...discovered];

  await persistLogSourceInventory(service.serviceRoot, service.manifest.id, sources);

  return sources;
}

async function buildDeclaredLogSources(service: DiscoveredService, runId: string): Promise<ServiceLogSourceInfo[]> {
  return Promise.all(
    (service.manifest.logSources ?? []).map(async (declaration) => {
      const relativePath = declaration.path ? normalizeRelativePath(declaration.path) : undefined;
      const pattern = declaration.pattern ? normalizeRelativePath(declaration.pattern) : undefined;
      const resolvedPath = relativePath ? resolveServiceOwnedPath(service.serviceRoot, relativePath) : null;
      const status = resolvedPath ? await readFileSourceStatus(resolvedPath) : null;

      return {
        kind: "current" as const,
        stream: "combined" as const,
        runId,
        path: resolvedPath ?? path.join(service.serviceRoot, relativePath ?? pattern ?? declaration.id),
        available: status?.available ?? false,
        id: declaration.id,
        label: declaration.label,
        origin: "declared" as const,
        type: declaration.type,
        relativePath,
        pattern,
        format: declaration.format ?? "text",
        status: declaration.type === "glob" ? "unavailable" : status?.status ?? "unavailable",
        lastSeenAt: status?.lastSeenAt ?? null,
        sizeBytes: status?.sizeBytes ?? null,
        tail: declaration.type === "file" && (status?.available ?? false),
      };
    }),
  );
}

async function buildDiscoveredLogSources(
  service: DiscoveredService,
  runId: string,
  declaredRelativePaths: Set<string | undefined>,
): Promise<ServiceLogSourceInfo[]> {
  const searchRoots = ["logs", path.join("var", "log")];
  const candidates = (
    await Promise.all(
      searchRoots.map(async (relativeRoot) => {
        const root = resolveServiceOwnedPath(service.serviceRoot, relativeRoot);
        if (!root) return [];
        try {
          const entries = await readdir(root, { withFileTypes: true });
          return entries
            .filter((entry) => entry.isFile() && /\.(?:log|out|err|txt|jsonl?|ndjson)$/i.test(entry.name))
            .map((entry) => normalizeRelativePath(path.join(relativeRoot, entry.name)));
        } catch {
          return [];
        }
      }),
    )
  ).flat();

  return Promise.all(
    [...new Set(candidates)]
      .filter((relativePath) => !declaredRelativePaths.has(relativePath) && !relativePath.startsWith("logs/runtime/"))
      .map(async (relativePath) => {
        const resolvedPath = resolveServiceOwnedPath(service.serviceRoot, relativePath);
        const status = resolvedPath
          ? await readFileSourceStatus(resolvedPath)
          : { available: false, status: "unavailable" as const, lastSeenAt: null, sizeBytes: null };

        return {
          kind: "current" as const,
          stream: "combined" as const,
          runId,
          path: resolvedPath ?? path.join(service.serviceRoot, relativePath),
          available: status.available,
          id: `discovered:${relativePath}`,
          label: path.basename(relativePath),
          origin: "discovered" as const,
          type: "file" as const,
          relativePath,
          format: "text" as const,
          status: status.status,
          lastSeenAt: status.lastSeenAt,
          sizeBytes: status.sizeBytes,
          tail: status.available,
        };
      }),
  );
}

async function persistLogSourceInventory(
  serviceRoot: string,
  serviceId: string,
  sources: ServiceLogSourceInfo[],
): Promise<void> {
  const statePath = getLogSourceStatePath(serviceRoot);
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(
    statePath,
    JSON.stringify(
      {
        serviceId,
        updatedAt: new Date().toISOString(),
        sources: sources.map((source) => ({
          id: source.id,
          label: source.label,
          origin: source.origin,
          type: source.type,
          relativePath: source.relativePath,
          pattern: source.pattern,
          format: source.format,
          status: source.status,
          available: source.available,
          lastSeenAt: source.lastSeenAt ?? null,
          sizeBytes: source.sizeBytes ?? null,
          tail: source.tail === true,
        })),
      },
      null,
      2,
    ),
  );
}

export async function buildServiceLogs(
  service: DiscoveredService,
  lifecycle: ServiceLifecycleState,
): Promise<ServiceLogsPayload> {
  const runtimeLogPaths = getServiceRuntimeLogPaths(service.serviceRoot, lifecycle.runtime.logs.runId ?? "current");
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

export async function buildServiceLogInfo(
  service: DiscoveredService,
  type: ServiceLogReadType = "default",
  runId = "current",
): Promise<ServiceLogInfoPayload> {
  const runtimeLogPaths = getServiceRuntimeLogPaths(service.serviceRoot, runId);
  const source = await buildCurrentSourceInfo(runtimeLogPaths, type);

  return {
    serviceId: service.manifest.id,
    type,
    path: source.path,
    available: source.available,
    availableTypes: ["default", "stdout", "stderr"],
    sources: await buildLogSources(service, { ...runtimeLogPaths, runId }),
  };
}

export async function readServiceLogChunk(
  service: DiscoveredService,
  before?: number,
  limit = DEFAULT_LOG_CHUNK_LIMIT,
  type: ServiceLogReadType = "default",
  runId = "current",
): Promise<ServiceLogChunkPayload> {
  const runtimeLogPaths = getServiceRuntimeLogPaths(service.serviceRoot, runId);
  const logPath = getLogPathForType(runtimeLogPaths, type);
  const source = await buildCurrentSourceInfo(runtimeLogPaths, type);
  const lines = await readRuntimeLogLines(logPath);
  const totalLines = lines.length;
  const safeLimit = sanitizePositiveInteger(limit, DEFAULT_LOG_CHUNK_LIMIT, MAX_LOG_CHUNK_LIMIT);
  const end = sanitizeCursor(before, totalLines, totalLines);
  const start = Math.max(0, end - safeLimit);
  const slice = lines.slice(start, end);
  const entries = slice.map((line, index) => {
    const entry = createLogLinePayload(line, {
      kind: "current",
      path: logPath,
      lineNumber: start + index + 1,
    });
    return type === "default"
      ? entry
      : {
          ...entry,
          stream: type,
          message: truncateLogText(line).text,
          text: truncateLogText(line).text,
        };
  });

  return {
    serviceId: service.manifest.id,
    type,
    path: logPath,
    available: source.available,
    source,
    totalLines,
    start,
    end,
    hasMore: start > 0,
    nextBefore: start,
    cursor: String(end),
    nextCursor: start > 0 ? String(start) : null,
    limit: safeLimit,
    entries,
    lines: entries.map((entry) => entry.text),
  };
}

async function collectSearchableLogLines(
  service: DiscoveredService,
  includeArchives: boolean,
): Promise<ServiceLogLinePayload[]> {
  const runtimeLogPaths = getServiceRuntimeLogPaths(service.serviceRoot);
  const currentLines = await readRuntimeLogLines(runtimeLogPaths.logPath);
  const currentEntries = currentLines.map((line, index) =>
    createLogLinePayload(line, {
      kind: "current",
      path: runtimeLogPaths.logPath,
      lineNumber: index + 1,
    }),
  );

  if (!includeArchives) {
    return currentEntries;
  }

  const archives = await listRuntimeLogArchives(service.serviceRoot);
  const archivedEntries = await Promise.all(
    archives.map(async (archive) => {
      const archivedLines = await readRuntimeLogLines(archive.logPath);
      return archivedLines.map((line, index) =>
        createLogLinePayload(line, {
          kind: "archive",
          archiveId: archive.archiveId,
          path: archive.logPath,
          lineNumber: index + 1,
        }),
      );
    }),
  );

  return [...currentEntries, ...archivedEntries.flat()];
}

export async function searchServiceLogs(
  service: DiscoveredService,
  query: string,
  options: {
    cursor?: number;
    includeArchives?: boolean;
    limit?: number;
    type?: ServiceLogReadType;
  } = {},
): Promise<ServiceLogSearchPayload> {
  const runtimeLogPaths = getServiceRuntimeLogPaths(service.serviceRoot);
  const type = options.type ?? "default";
  const safeQuery = query.trim().slice(0, MAX_LOG_SEARCH_QUERY_LENGTH);
  const includeArchives = options.includeArchives === true;
  const limit = sanitizePositiveInteger(options.limit, DEFAULT_LOG_SEARCH_LIMIT, MAX_LOG_SEARCH_LIMIT);
  const lines = type === "default"
    ? await collectSearchableLogLines(service, includeArchives)
    : (await readRuntimeLogLines(getLogPathForType(runtimeLogPaths, type))).map((line, index) => ({
        source: {
          kind: "current" as const,
          path: getLogPathForType(runtimeLogPaths, type),
          lineNumber: index + 1,
        },
        stream: type,
        message: truncateLogText(line).text,
        text: truncateLogText(line).text,
        truncated: truncateLogText(line).truncated,
      }));
  const cursor = sanitizeCursor(options.cursor, 0, lines.length);
  const normalizedQuery = safeQuery.toLocaleLowerCase();
  const matches: ServiceLogLinePayload[] = [];
  let nextIndex = cursor;

  for (; nextIndex < lines.length; nextIndex += 1) {
    const entry = lines[nextIndex];
    const haystack = `${entry.text}\n${entry.message}`.toLocaleLowerCase();

    if (haystack.includes(normalizedQuery)) {
      matches.push(entry);
    }

    if (matches.length >= limit) {
      nextIndex += 1;
      break;
    }
  }

  return {
    serviceId: service.manifest.id,
    type,
    path: getLogPathForType(runtimeLogPaths, type),
    query: safeQuery,
    includeArchives,
    limit,
    cursor: String(cursor),
    nextCursor: nextIndex < lines.length ? String(nextIndex) : null,
    hasMore: nextIndex < lines.length,
    totalScanned: Math.max(0, nextIndex - cursor),
    matches,
  };
}
