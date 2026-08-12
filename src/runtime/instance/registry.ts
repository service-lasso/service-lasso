import { execFile as execFileCallback } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { RuntimeConfig } from "../config.js";
import {
  classifyRegisteredProcess,
  findProcessOwnership,
  withWorkspaceLifecycleLock,
} from "../process/registry.js";
import type {
  RuntimeGenerationPhase,
  RuntimeGenerationRecord,
  RuntimeGenerationRegistrySnapshot,
  RuntimeInstanceRecord,
  RuntimeInstanceRegistrySnapshot,
  RuntimeInstanceResponse,
  RuntimeInstanceStatus,
  RuntimeLaneSelection,
  RuntimeSourceIdentity,
} from "../../contracts/api.js";

const execFileAsync = promisify(execFileCallback);
const INSTANCE_FILE_NAME = "runtime-instance.json";
const GENERATION_REGISTRY_FILE_NAME = "runtime-generations.json";
const INSTANCE_REGISTRY_FILE_NAME = "instances.json";
const HOST_REGISTRY_LOCK_TIMEOUT_MS = 5_000;
const HOST_REGISTRY_LOCK_STALE_MS = 30_000;
const HOST_REGISTRY_LOCK_RETRY_MS = 20;
const ACTIVE_GENERATION_PHASES = new Set<RuntimeGenerationPhase>(["starting", "running", "stopping"]);
const TERMINAL_GENERATION_PHASES = new Set<RuntimeGenerationPhase>(["stopped", "failed", "superseded"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMMIT_PATTERN = /^[0-9a-f]{7,64}$/i;
const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export const DEFAULT_RUNTIME_INSTANCE_LEASE_TTL_MS = 45_000;
export const DEFAULT_RUNTIME_INSTANCE_HEARTBEAT_INTERVAL_MS = 15_000;

export interface RuntimeInstanceRegistrationOptions {
  apiPort: number;
  apiUrl: string;
  generationId?: string;
  runtimeRoot?: string;
  source?: RuntimeSourceIdentity;
  phase?: RuntimeGenerationPhase;
  startedAt?: string;
}

export interface RuntimeInstanceLeaseRefreshOptions {
  now?: Date;
  generationId?: string;
}

export interface RuntimeGenerationPublication {
  phase: RuntimeGenerationPhase;
  allocationRevision?: string | null;
  endpoints?: Array<{ name: string; url: string }>;
}

export interface RuntimeLaneSelectionOptions {
  generationId?: string | null;
}

interface RuntimeGenerationRegistryFile {
  version: 1;
  updatedAt: string;
  activeGenerationId: string | null;
  generations: RuntimeGenerationRecord[];
}

export class RuntimeGenerationConflictError extends Error {
  readonly code: string;
  readonly statusCode = 409;

  constructor(code: "runtime_generation_active" | "runtime_generation_owner_unknown", message: string) {
    super(message);
    this.name = "RuntimeGenerationConflictError";
    this.code = code;
  }
}

export function resolveRuntimeInstanceId(config: RuntimeConfig): string {
  const hash = createHash("sha256")
    .update(path.resolve(config.servicesRoot))
    .update("\0")
    .update(path.resolve(config.workspaceRoot))
    .digest("hex");

  return "sl_" + hash.slice(0, 16);
}

export function createRuntimeGenerationId(): string {
  return randomUUID();
}

export function getRuntimeInstanceStatePath(workspaceRoot: string): string {
  return path.join(path.resolve(workspaceRoot), ".service-lasso", INSTANCE_FILE_NAME);
}

export function getRuntimeGenerationRegistryPath(workspaceRoot: string): string {
  return path.join(path.resolve(workspaceRoot), ".service-lasso", GENERATION_REGISTRY_FILE_NAME);
}

export function getRuntimeInstanceRegistryPath(): string {
  const configured = process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH?.trim();
  if (configured) {
    return path.resolve(configured);
  }

  return path.join(os.homedir(), ".service-lasso", INSTANCE_REGISTRY_FILE_NAME);
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return Boolean(input && typeof input === "object" && !Array.isArray(input));
}

function normalizePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function samePath(left: string, right: string): boolean {
  return normalizePath(left) === normalizePath(right);
}

function parseIsoTime(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function addMilliseconds(value: string, milliseconds: number): string {
  const parsed = parseIsoTime(value) ?? Date.now();
  return new Date(parsed + milliseconds).toISOString();
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

function normalizePhase(value: unknown, fallback: RuntimeGenerationPhase): RuntimeGenerationPhase {
  return value === "starting" || value === "running" || value === "stopping" ||
    value === "stopped" || value === "failed" || value === "superseded"
    ? value
    : fallback;
}

function sanitizeEndpoint(endpoint: { name: string; url: string }): { name: string; url: string } | null {
  if (!endpoint.name.trim() || !endpoint.url.trim()) {
    return null;
  }
  try {
    const parsed = new URL(endpoint.url);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    const sanitized = parsed.toString();
    return {
      name: endpoint.name,
      url: parsed.pathname === "/" && !endpoint.url.endsWith("/") ? sanitized.slice(0, -1) : sanitized,
    };
  } catch {
    return null;
  }
}

function normalizeEndpoints(value: unknown): Array<{ name: string; url: string }> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.name !== "string" || typeof entry.url !== "string") {
      return [];
    }
    const endpoint = sanitizeEndpoint({ name: entry.name, url: entry.url });
    return endpoint ? [endpoint] : [];
  });
}

function normalizeSource(value: unknown): RuntimeSourceIdentity {
  if (!isRecord(value)) {
    return { branch: null, commit: null };
  }
  const branch = typeof value.branch === "string" && value.branch.trim() && value.branch.length <= 200
    ? value.branch.trim()
    : null;
  const commit = typeof value.commit === "string" && COMMIT_PATTERN.test(value.commit.trim())
    ? value.commit.trim().toLowerCase()
    : null;
  return { branch, commit };
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  for (const candidate of [filePath, `${filePath}.bak`]) {
    try {
      return JSON.parse(await readFile(candidate, "utf8")) as unknown;
    } catch {
      // Try the crash-recovery backup before treating state as absent.
    }
  }
  return null;
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  const handle = await open(tempPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await copyFile(filePath, `${filePath}.bak`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      await unlink(tempPath).catch(() => undefined);
      throw error;
    }
  }
  await rename(tempPath, filePath);
  if (process.platform !== "win32") {
    const directory = await open(path.dirname(filePath), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
}

async function acquireHostRegistryLock(registryPath: string): Promise<() => Promise<void>> {
  const lockPath = `${registryPath}.lock`;
  await mkdir(path.dirname(lockPath), { recursive: true });
  const token = randomUUID();
  const deadline = Date.now() + HOST_REGISTRY_LOCK_TIMEOUT_MS;

  while (true) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify({ token, pid: process.pid, acquiredAt: new Date().toISOString() })}\n`);
        await handle.sync();
      } finally {
        await handle.close();
      }
      return async () => {
        try {
          const current = JSON.parse(await readFile(lockPath, "utf8")) as { token?: unknown };
          if (current.token === token) {
            await unlink(lockPath);
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw error;
          }
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      try {
        const lockStat = await stat(lockPath);
        if (Date.now() - lockStat.mtimeMs > HOST_REGISTRY_LOCK_STALE_MS) {
          await unlink(lockPath);
          continue;
        }
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code === "ENOENT") {
          continue;
        }
        throw statError;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for runtime instance registry lock: ${lockPath}`);
      }
      await new Promise((resolve) => setTimeout(resolve, HOST_REGISTRY_LOCK_RETRY_MS));
    }
  }
}

function normalizeGenerationRecord(input: unknown): RuntimeGenerationRecord | null {
  if (!isRecord(input)) {
    return null;
  }
  const generationId = typeof input.generationId === "string" && UUID_PATTERN.test(input.generationId)
    ? input.generationId
    : null;
  const instanceId = typeof input.instanceId === "string" && input.instanceId.trim() ? input.instanceId : null;
  const servicesRoot = typeof input.servicesRoot === "string" && input.servicesRoot.trim() ? input.servicesRoot : null;
  const workspaceRoot = typeof input.workspaceRoot === "string" && input.workspaceRoot.trim() ? input.workspaceRoot : null;
  const recordRuntimeRoot = typeof input.runtimeRoot === "string" && input.runtimeRoot.trim() ? input.runtimeRoot : null;
  const pid = typeof input.pid === "number" && Number.isInteger(input.pid) && input.pid > 0 ? input.pid : null;
  const startedAt = typeof input.startedAt === "string" && parseIsoTime(input.startedAt) !== null ? input.startedAt : null;
  const updatedAt = typeof input.updatedAt === "string" && parseIsoTime(input.updatedAt) !== null ? input.updatedAt : null;
  if (!generationId || !instanceId || !servicesRoot || !workspaceRoot || !recordRuntimeRoot || !pid || !startedAt || !updatedAt) {
    return null;
  }
  const phase = normalizePhase(input.phase, "failed");
  return {
    generationId,
    instanceId,
    servicesRoot: path.resolve(servicesRoot),
    workspaceRoot: path.resolve(workspaceRoot),
    runtimeRoot: path.resolve(recordRuntimeRoot),
    pid,
    phase,
    startedAt: new Date(startedAt).toISOString(),
    updatedAt: new Date(updatedAt).toISOString(),
    finishedAt: typeof input.finishedAt === "string" && parseIsoTime(input.finishedAt) !== null
      ? new Date(input.finishedAt).toISOString()
      : null,
    allocationRevision: typeof input.allocationRevision === "string" ? input.allocationRevision : null,
    endpoints: normalizeEndpoints(input.endpoints),
    source: normalizeSource(input.source),
  };
}

function emptyGenerationRegistry(workspaceRoot: string): RuntimeGenerationRegistryFile {
  return {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    activeGenerationId: null,
    generations: [],
  };
}

function normalizeGenerationRegistry(input: unknown, workspaceRoot: string): RuntimeGenerationRegistryFile {
  if (!isRecord(input) || input.version !== 1 || !Array.isArray(input.generations)) {
    return emptyGenerationRegistry(workspaceRoot);
  }
  const generations = input.generations
    .map((entry) => normalizeGenerationRecord(entry))
    .filter((entry): entry is RuntimeGenerationRecord => entry !== null)
    .filter((entry) => samePath(entry.workspaceRoot, workspaceRoot));
  const activeGenerationId = typeof input.activeGenerationId === "string" &&
    generations.some((entry) => entry.generationId === input.activeGenerationId && ACTIVE_GENERATION_PHASES.has(entry.phase))
    ? input.activeGenerationId
    : null;
  return {
    version: 1,
    updatedAt: typeof input.updatedAt === "string" && parseIsoTime(input.updatedAt) !== null
      ? new Date(input.updatedAt).toISOString()
      : new Date(0).toISOString(),
    activeGenerationId,
    generations,
  };
}

async function readGenerationRegistryFile(workspaceRoot: string): Promise<RuntimeGenerationRegistryFile> {
  const filePath = getRuntimeGenerationRegistryPath(workspaceRoot);
  return normalizeGenerationRegistry(await readJsonIfPresent(filePath), workspaceRoot);
}

export async function readRuntimeGenerationRegistry(
  workspaceRoot: string,
): Promise<RuntimeGenerationRegistrySnapshot> {
  const registry = await readGenerationRegistryFile(workspaceRoot);
  return {
    path: getRuntimeGenerationRegistryPath(workspaceRoot),
    activeGenerationId: registry.activeGenerationId,
    generations: [...registry.generations].sort((left, right) => left.startedAt.localeCompare(right.startedAt)),
  };
}

const sourceIdentityByRuntimeRoot = new Map<string, Promise<RuntimeSourceIdentity>>();

async function resolveRuntimeSourceIdentity(recordRuntimeRoot: string): Promise<RuntimeSourceIdentity> {
  const key = path.resolve(recordRuntimeRoot);
  const cached = sourceIdentityByRuntimeRoot.get(key);
  if (cached) {
    return await cached;
  }
  const pending = (async () => {
    const envCommit = process.env.GITHUB_SHA?.trim();
    const envBranch = process.env.GITHUB_HEAD_REF?.trim() || process.env.GITHUB_REF_NAME?.trim();
    if (envCommit && COMMIT_PATTERN.test(envCommit)) {
      return normalizeSource({ branch: envBranch ?? null, commit: envCommit });
    }
    try {
      const [branchResult, commitResult] = await Promise.all([
        execFileAsync("git", ["branch", "--show-current"], { cwd: key, windowsHide: true }),
        execFileAsync("git", ["rev-parse", "HEAD"], { cwd: key, windowsHide: true }),
      ]);
      return normalizeSource({ branch: branchResult.stdout.trim(), commit: commitResult.stdout.trim() });
    } catch {
      return { branch: null, commit: null };
    }
  })();
  sourceIdentityByRuntimeRoot.set(key, pending);
  return await pending;
}

export async function beginRuntimeGeneration(config: RuntimeConfig): Promise<RuntimeGenerationRecord> {
  const instanceId = resolveRuntimeInstanceId(config);
  const source = await resolveRuntimeSourceIdentity(runtimeRoot);
  return await withWorkspaceLifecycleLock(config.workspaceRoot, async () => {
    const registry = await readGenerationRegistryFile(config.workspaceRoot);
    const activeGeneration = registry.activeGenerationId
      ? registry.generations.find((entry) =>
          entry.generationId === registry.activeGenerationId && ACTIVE_GENERATION_PHASES.has(entry.phase),
        )
      : undefined;
    const ownership = await findProcessOwnership(config.workspaceRoot, "runtime", instanceId);
    if (ownership && ownership.lifecycleState !== "stopped") {
      const status = await classifyRegisteredProcess(ownership);
      if (status === "owned") {
        throw new RuntimeGenerationConflictError(
          "runtime_generation_active",
          `Workspace already has active runtime generation ${ownership.generationId ?? "unknown"}.`,
        );
      }
      if (status === "unknown_owner") {
        throw new RuntimeGenerationConflictError(
          "runtime_generation_owner_unknown",
          "Workspace runtime owner cannot be verified; refusing to create another generation.",
        );
      }
    }
    if (activeGeneration && processPresence(activeGeneration.pid) !== "not_running") {
      throw new RuntimeGenerationConflictError(
        "runtime_generation_owner_unknown",
        `Workspace generation ${activeGeneration.generationId} is active but its process owner cannot be verified.`,
      );
    }

    const now = new Date().toISOString();
    const generations = registry.generations.map((entry) =>
      ACTIVE_GENERATION_PHASES.has(entry.phase)
        ? { ...entry, phase: "superseded" as const, updatedAt: now, finishedAt: now }
        : entry,
    );
    const record: RuntimeGenerationRecord = {
      generationId: createRuntimeGenerationId(),
      instanceId,
      servicesRoot: path.resolve(config.servicesRoot),
      workspaceRoot: path.resolve(config.workspaceRoot),
      runtimeRoot,
      pid: process.pid,
      phase: "starting",
      startedAt: now,
      updatedAt: now,
      finishedAt: null,
      allocationRevision: null,
      endpoints: [],
      source,
    };
    generations.push(record);
    await atomicWriteJson(getRuntimeGenerationRegistryPath(config.workspaceRoot), {
      version: 1,
      updatedAt: now,
      activeGenerationId: record.generationId,
      generations,
    } satisfies RuntimeGenerationRegistryFile);
    return record;
  });
}

export async function publishRuntimeGeneration(
  config: RuntimeConfig,
  generationId: string,
  publication: RuntimeGenerationPublication,
): Promise<RuntimeGenerationRecord> {
  return await withWorkspaceLifecycleLock(config.workspaceRoot, async () => {
    const registry = await readGenerationRegistryFile(config.workspaceRoot);
    const current = registry.generations.find((entry) => entry.generationId === generationId);
    if (!current) {
      throw new Error(`Runtime generation ${generationId} is not recorded for workspace ${config.workspaceRoot}.`);
    }
    const now = new Date().toISOString();
    const endpoints = publication.endpoints === undefined
      ? current.endpoints
      : publication.endpoints.flatMap((entry) => {
          const sanitized = sanitizeEndpoint(entry);
          return sanitized ? [sanitized] : [];
        });
    const updated: RuntimeGenerationRecord = {
      ...current,
      phase: publication.phase,
      updatedAt: now,
      finishedAt: TERMINAL_GENERATION_PHASES.has(publication.phase) ? now : null,
      allocationRevision: publication.allocationRevision === undefined
        ? current.allocationRevision
        : publication.allocationRevision,
      endpoints,
    };
    const generations = registry.generations.map((entry) => entry.generationId === generationId ? updated : entry);
    const activeGenerationId = ACTIVE_GENERATION_PHASES.has(updated.phase)
      ? registry.activeGenerationId === null || registry.activeGenerationId === generationId
        ? generationId
        : registry.activeGenerationId
      : registry.activeGenerationId === generationId
        ? null
        : registry.activeGenerationId;
    await atomicWriteJson(getRuntimeGenerationRegistryPath(config.workspaceRoot), {
      version: 1,
      updatedAt: now,
      activeGenerationId,
      generations,
    } satisfies RuntimeGenerationRegistryFile);
    return updated;
  });
}

function normalizeInstanceRecord(input: unknown): RuntimeInstanceRecord | null {
  if (!isRecord(input)) {
    return null;
  }
  const instanceId = typeof input.instanceId === "string" ? input.instanceId : null;
  const generationId = typeof input.generationId === "string" && input.generationId.trim()
    ? input.generationId
    : instanceId;
  const servicesRoot = typeof input.servicesRoot === "string" ? input.servicesRoot : null;
  const workspaceRoot = typeof input.workspaceRoot === "string" ? input.workspaceRoot : null;
  const apiUrl = typeof input.apiUrl === "string" ? input.apiUrl : null;
  const startedAt = typeof input.startedAt === "string" ? input.startedAt : null;
  const updatedAt = typeof input.updatedAt === "string" ? input.updatedAt : null;
  const heartbeatAt = typeof input.heartbeatAt === "string" ? input.heartbeatAt : updatedAt;
  const version = typeof input.version === "string" ? input.version : null;
  const apiPort = typeof input.apiPort === "number" && Number.isInteger(input.apiPort) ? input.apiPort : null;
  const pid = typeof input.pid === "number" && Number.isInteger(input.pid) ? input.pid : null;
  if (!instanceId || !generationId || !servicesRoot || !workspaceRoot || !apiUrl || !startedAt || !updatedAt || !heartbeatAt || !apiPort || !pid) {
    return null;
  }
  const leaseTtlMs = normalizePositiveInteger(input.leaseTtlMs, DEFAULT_RUNTIME_INSTANCE_LEASE_TTL_MS);
  const leaseExpiresAt = typeof input.leaseExpiresAt === "string"
    ? input.leaseExpiresAt
    : addMilliseconds(heartbeatAt, leaseTtlMs);
  const status = input.status === "stale" || input.status === "unknown" ? input.status : "active";
  const statusReason = typeof input.statusReason === "string"
    ? input.statusReason
    : typeof input.staleReason === "string"
      ? input.staleReason
      : undefined;
  const phase = normalizePhase(input.phase, status === "active" ? "running" : "stopped");

  return {
    instanceId,
    generationId,
    servicesRoot: path.resolve(servicesRoot),
    workspaceRoot: path.resolve(workspaceRoot),
    runtimeRoot: typeof input.runtimeRoot === "string" && input.runtimeRoot.trim()
      ? path.resolve(input.runtimeRoot)
      : path.dirname(path.resolve(servicesRoot)),
    pid,
    apiPort,
    apiUrl,
    advertisedUrls: normalizeStringArray(input.advertisedUrls),
    startedAt,
    updatedAt,
    heartbeatAt,
    leaseExpiresAt,
    leaseTtlMs,
    version: version ?? "unknown",
    phase,
    source: normalizeSource(input.source),
    status,
    statusReason,
    staleReason: typeof input.staleReason === "string" ? input.staleReason : undefined,
  };
}

function normalizeRegistry(input: unknown): RuntimeInstanceRecord[] {
  if (!isRecord(input) || !Array.isArray(input.instances)) {
    return [];
  }
  return input.instances
    .map((entry) => normalizeInstanceRecord(entry))
    .filter((entry): entry is RuntimeInstanceRecord => entry !== null);
}

function processPresence(pid: number): "running" | "not_running" | "unknown" {
  try {
    process.kill(pid, 0);
    return "running";
  } catch (error) {
    return isRecord(error) && error.code === "ESRCH" ? "not_running" : "unknown";
  }
}

async function classifyRecord(record: RuntimeInstanceRecord, now: Date = new Date()): Promise<RuntimeInstanceRecord> {
  if (TERMINAL_GENERATION_PHASES.has(record.phase) || record.status === "stale" && record.staleReason === "stopped") {
    const reason = record.staleReason ?? `generation_${record.phase}`;
    return { ...record, status: "stale", statusReason: reason, staleReason: reason };
  }
  const ownership = await findProcessOwnership(record.workspaceRoot, "runtime", record.instanceId);
  if (!ownership) {
    if (processPresence(record.pid) === "not_running") {
      return { ...record, status: "stale", statusReason: "process_not_running", staleReason: "process_not_running" };
    }
    return { ...record, status: "unknown", statusReason: "process_ownership_missing", staleReason: undefined };
  }
  if (ownership.generationId !== record.generationId || ownership.runtimeInstanceId !== record.instanceId) {
    return { ...record, status: "stale", statusReason: "generation_owner_mismatch", staleReason: "generation_owner_mismatch" };
  }
  const ownershipStatus = await classifyRegisteredProcess(ownership);
  if (ownershipStatus === "not_running" || ownershipStatus === "identity_mismatch") {
    return { ...record, status: "stale", statusReason: ownershipStatus, staleReason: ownershipStatus };
  }
  if (ownershipStatus === "unknown_owner") {
    return { ...record, status: "unknown", statusReason: "unknown_owner", staleReason: undefined };
  }
  const leaseExpiresAt = parseIsoTime(record.leaseExpiresAt);
  if (leaseExpiresAt === null || leaseExpiresAt <= now.getTime()) {
    return { ...record, status: "unknown", statusReason: "lease_expired", staleReason: undefined };
  }
  return { ...record, status: "active", statusReason: undefined, staleReason: undefined };
}

function createInstanceRecord(config: RuntimeConfig, options: RuntimeInstanceRegistrationOptions): RuntimeInstanceRecord {
  const now = new Date().toISOString();
  const startedAt = options.startedAt ?? now;
  const leaseTtlMs = DEFAULT_RUNTIME_INSTANCE_LEASE_TTL_MS;
  return {
    instanceId: resolveRuntimeInstanceId(config),
    generationId: options.generationId ?? createRuntimeGenerationId(),
    servicesRoot: path.resolve(config.servicesRoot),
    workspaceRoot: path.resolve(config.workspaceRoot),
    runtimeRoot: path.resolve(options.runtimeRoot ?? runtimeRoot),
    pid: process.pid,
    apiPort: options.apiPort,
    apiUrl: options.apiUrl,
    advertisedUrls: [options.apiUrl],
    startedAt,
    updatedAt: now,
    heartbeatAt: now,
    leaseExpiresAt: addMilliseconds(now, leaseTtlMs),
    leaseTtlMs,
    version: config.version,
    phase: options.phase ?? "running",
    source: options.source ?? { branch: null, commit: null },
    status: "active",
  };
}

function refreshInstanceRecord(record: RuntimeInstanceRecord, options: RuntimeInstanceLeaseRefreshOptions): RuntimeInstanceRecord {
  const now = options.now ?? new Date();
  const heartbeatAt = now.toISOString();
  return {
    ...record,
    pid: process.pid,
    updatedAt: heartbeatAt,
    heartbeatAt,
    leaseExpiresAt: new Date(now.getTime() + record.leaseTtlMs).toISOString(),
    status: "active",
    statusReason: undefined,
    staleReason: undefined,
  };
}

async function mutateHostRegistry(
  recipe: (records: RuntimeInstanceRecord[]) => RuntimeInstanceRecord[],
): Promise<void> {
  const registryPath = getRuntimeInstanceRegistryPath();
  const release = await acquireHostRegistryLock(registryPath);
  try {
    const records = normalizeRegistry(await readJsonIfPresent(registryPath));
    const next = recipe(records);
    await atomicWriteJson(registryPath, {
      version: 1,
      updatedAt: new Date().toISOString(),
      instances: next,
    });
  } finally {
    await release();
  }
}

function instanceKey(record: Pick<RuntimeInstanceRecord, "instanceId" | "generationId">): string {
  return `${record.instanceId}:${record.generationId}`;
}

export async function readRuntimeInstanceRegistry(): Promise<RuntimeInstanceRegistrySnapshot> {
  const registryPath = getRuntimeInstanceRegistryPath();
  const normalized = normalizeRegistry(await readJsonIfPresent(registryPath));
  const records = await Promise.all(normalized.map((record) => classifyRecord(record)));
  records.sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  return {
    path: registryPath,
    activeCount: records.filter((record) => record.status === "active").length,
    staleCount: records.filter((record) => record.status === "stale").length,
    unknownCount: records.filter((record) => record.status === "unknown").length,
    instances: records,
  };
}

export async function readRuntimeInstanceState(config: RuntimeConfig): Promise<RuntimeInstanceRecord | null> {
  const record = normalizeInstanceRecord(await readJsonIfPresent(getRuntimeInstanceStatePath(config.workspaceRoot)));
  return record ? await classifyRecord(record) : null;
}

export async function registerRuntimeInstance(
  config: RuntimeConfig,
  options: RuntimeInstanceRegistrationOptions,
): Promise<RuntimeInstanceRecord> {
  const record = createInstanceRecord(config, options);
  await atomicWriteJson(getRuntimeInstanceStatePath(config.workspaceRoot), record);
  await mutateHostRegistry((records) => [
    ...records.filter((entry) => instanceKey(entry) !== instanceKey(record)),
    record,
  ]);
  return record;
}

export async function refreshRuntimeInstanceLease(
  config: RuntimeConfig,
  options: RuntimeInstanceLeaseRefreshOptions = {},
): Promise<RuntimeInstanceRecord | null> {
  const current = normalizeInstanceRecord(await readJsonIfPresent(getRuntimeInstanceStatePath(config.workspaceRoot)));
  if (!current || options.generationId && current.generationId !== options.generationId || TERMINAL_GENERATION_PHASES.has(current.phase)) {
    return current;
  }
  const refreshed = refreshInstanceRecord(current, options);
  await atomicWriteJson(getRuntimeInstanceStatePath(config.workspaceRoot), refreshed);
  await mutateHostRegistry((records) => [
    ...records.filter((entry) => instanceKey(entry) !== instanceKey(refreshed)),
    refreshed,
  ]);
  return refreshed;
}

export async function markRuntimeInstanceStopped(config: RuntimeConfig, generationId?: string): Promise<void> {
  const current = normalizeInstanceRecord(await readJsonIfPresent(getRuntimeInstanceStatePath(config.workspaceRoot)));
  if (!current || generationId && current.generationId !== generationId) {
    return;
  }
  const now = new Date().toISOString();
  const stopped: RuntimeInstanceRecord = {
    ...current,
    phase: "stopped",
    status: "stale",
    statusReason: "stopped",
    staleReason: "stopped",
    updatedAt: now,
  };
  await atomicWriteJson(getRuntimeInstanceStatePath(config.workspaceRoot), stopped);
  await mutateHostRegistry((records) => [
    ...records.filter((entry) => instanceKey(entry) !== instanceKey(stopped)),
    stopped,
  ]);
}

function laneCandidatesMatchConfig(
  record: Pick<RuntimeInstanceRecord, "workspaceRoot" | "servicesRoot">,
  config: RuntimeConfig,
): boolean {
  return samePath(record.workspaceRoot, config.workspaceRoot) && samePath(record.servicesRoot, config.servicesRoot);
}

async function selectRuntimeLane(
  config: RuntimeConfig,
  options: RuntimeLaneSelectionOptions,
  registry: RuntimeInstanceRegistrySnapshot,
  generations: RuntimeGenerationRegistrySnapshot,
): Promise<RuntimeLaneSelection> {
  const explicitGenerationId = options.generationId?.trim() || null;
  const authoritativeGenerationId = explicitGenerationId ?? generations.activeGenerationId;
  const generationMatches = authoritativeGenerationId
    ? registry.instances.filter((entry) => entry.generationId === authoritativeGenerationId)
    : [];
  const exact = generationMatches.filter((entry) => laneCandidatesMatchConfig(entry, config));
  const candidateGenerationIds = [...new Set(generationMatches.map((entry) => entry.generationId))].sort();
  const base = {
    workspaceRoot: path.resolve(config.workspaceRoot),
    servicesRoot: path.resolve(config.servicesRoot),
    runtimeIdentity: null,
    endpoint: null,
    selectedGenerationId: null,
    selectedInstanceId: null,
    candidateGenerationIds,
  };

  if (explicitGenerationId && exact.length === 0 && generationMatches.length > 0) {
    return { ...base, classification: "wrong_lane", reason: "generation_roots_do_not_match_selector" };
  }
  if (!authoritativeGenerationId) {
    return { ...base, classification: "not_found", reason: "no_active_workspace_generation" };
  }
  const local = generations.generations.find((entry) => entry.generationId === authoritativeGenerationId);
  if (!local) {
    return exact.length > 0
      ? {
          ...base,
          classification: "unknown_owner",
          reason: "generation_not_recorded_in_workspace",
          selectedGenerationId: authoritativeGenerationId,
          selectedInstanceId: exact.at(-1)?.instanceId ?? null,
        }
      : { ...base, classification: "not_found", reason: "no_generation_matches_selector" };
  }
  if (!laneCandidatesMatchConfig(local, config)) {
    return {
      ...base,
      classification: "wrong_lane",
      reason: "workspace_generation_roots_do_not_match_selector",
      selectedGenerationId: local.generationId,
      selectedInstanceId: local.instanceId,
    };
  }
  if (exact.length === 0) {
    return {
      ...base,
      classification: ACTIVE_GENERATION_PHASES.has(local.phase) ? "unknown_owner" : "stale",
      reason: ACTIVE_GENERATION_PHASES.has(local.phase) ? "generation_endpoint_not_published" : `generation_${local.phase}`,
      selectedGenerationId: local.generationId,
      selectedInstanceId: local.instanceId,
    };
  }

  const selected = exact.find((entry) => entry.status === "active") ?? exact.at(-1)!;
  if (local.phase !== "running" || generations.activeGenerationId !== local.generationId) {
    const classification = local.phase === "starting" ? "unknown_owner" : "stale";
    return {
      ...base,
      classification,
      reason: `generation_${local.phase}`,
      selectedGenerationId: selected.generationId,
      selectedInstanceId: selected.instanceId,
    };
  }
  const active = exact.filter((entry) => entry.status === "active" && entry.phase === "running");
  if (active.length > 1) {
    return { ...base, classification: "ambiguous", reason: "multiple_verified_generations_match_selector" };
  }
  const ownership = await findProcessOwnership(config.workspaceRoot, "runtime", selected.instanceId);
  const identity = ownership?.generationId === selected.generationId ? ownership.identity : null;
  const endpoint = local.endpoints.find((entry) => entry.name === "api")?.url ?? null;
  if (active.length === 1 && identity && ownership?.lifecycleState === "running" && endpoint) {
    return {
      ...base,
      classification: "selected",
      reason: explicitGenerationId ? "explicit_generation_verified" : "workspace_generation_verified",
      selectedGenerationId: selected.generationId,
      selectedInstanceId: selected.instanceId,
      endpoint,
      runtimeIdentity: identity,
    };
  }
  return {
    ...base,
    classification: selected.status === "unknown" ? "unknown_owner" : "stale",
    reason: selected.statusReason ?? "generation_not_active",
    selectedGenerationId: selected.generationId,
    selectedInstanceId: selected.instanceId,
    endpoint: null,
  };
}

export async function discoverRuntimeLane(
  config: RuntimeConfig,
  options: RuntimeLaneSelectionOptions = {},
): Promise<RuntimeLaneSelection> {
  const [registry, generations] = await Promise.all([
    readRuntimeInstanceRegistry(),
    readRuntimeGenerationRegistry(config.workspaceRoot),
  ]);
  return await selectRuntimeLane(config, options, registry, generations);
}

export async function createRuntimeInstanceSnapshot(
  config: RuntimeConfig,
  options: RuntimeLaneSelectionOptions = {},
): Promise<RuntimeInstanceResponse> {
  const [current, registry, generations] = await Promise.all([
    readRuntimeInstanceState(config),
    readRuntimeInstanceRegistry(),
    readRuntimeGenerationRegistry(config.workspaceRoot),
  ]);
  const selection = await selectRuntimeLane(config, options, registry, generations);
  const selectedInstance = selection.selectedGenerationId
    ? registry.instances.find((entry) =>
        entry.generationId === selection.selectedGenerationId && laneCandidatesMatchConfig(entry, config),
      ) ?? null
    : null;
  return {
    instance: options.generationId ? selectedInstance : selectedInstance ?? current,
    registry,
    generations,
    selection,
  };
}
