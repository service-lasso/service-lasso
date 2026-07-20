import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import {
  classifyProcessIdentity,
  hashProcessCommandLine,
  inspectProcess,
  type ProcessFingerprint,
  type ProcessIdentityClassification,
  type ProcessInspection,
  type ProcessInspectorDependencies,
} from "./identity.js";

export const PROCESS_REGISTRY_VERSION = 1;
const PROCESS_REGISTRY_FILE_NAME = "processes.json";
const PROCESS_REGISTRY_BACKUP_FILE_NAME = "processes.json.bak";
const WORKSPACE_LIFECYCLE_LOCK_FILE_NAME = "workspace-lifecycle.lock";
const LOCK_RETRY_MS = 20;
const LOCK_TIMEOUT_MS = 5_000;
const STALE_LOCK_MS = 30_000;
const LEGACY_START_TOLERANCE_MS = 2_000;

export type ProcessOwnerType = "runtime" | "service";
export type ProcessOwnershipLifecycleState = "launching" | "running" | "stopping" | "stopped";

export interface ProcessOwnershipEndpoint {
  name: string;
  url: string;
}

export interface ProcessOwnershipEntry {
  ownerType: ProcessOwnerType;
  ownerId: string;
  serviceId: string | null;
  workspaceId: string;
  runtimeInstanceId: string | null;
  pid: number | null;
  identity: ProcessFingerprint | null;
  ownerRoot: string;
  processGroup: {
    kind: "none" | "posix" | "windows-job";
    id: string | null;
  };
  allocation: {
    revision: string | null;
    ports: Record<string, number>;
    endpoints: ProcessOwnershipEndpoint[];
  };
  lifecycleState: ProcessOwnershipLifecycleState;
  identityStatus: ProcessIdentityClassification;
  source: "spawn" | "runtime" | "legacy-verified";
  recordedAt: string;
  updatedAt: string;
}

export interface ProcessOwnershipRegistry {
  version: typeof PROCESS_REGISTRY_VERSION;
  updatedAt: string;
  entries: ProcessOwnershipEntry[];
}

export interface RecordProcessOwnershipInput {
  ownerType: ProcessOwnerType;
  ownerId: string;
  serviceId?: string | null;
  runtimeInstanceId?: string | null;
  pid: number;
  ownerRoot: string;
  allocationRevision?: string | null;
  ports?: Record<string, number>;
  endpoints?: ProcessOwnershipEndpoint[];
  lifecycleState: "launching" | "running";
  source: ProcessOwnershipEntry["source"];
  processGroup?: ProcessOwnershipEntry["processGroup"];
}

export interface LegacyProcessOwnershipInput {
  ownerId: string;
  serviceId: string;
  runtimeInstanceId?: string | null;
  pid: number;
  startedAt: string;
  command: string;
  expectedExecutablePath?: string | null;
  ownerRoot: string;
  allocationRevision?: string | null;
  ports?: Record<string, number>;
  endpoints?: ProcessOwnershipEndpoint[];
  inspectorDependencies?: ProcessInspectorDependencies;
}

export interface LegacyProcessOwnershipResult {
  status: ProcessIdentityClassification;
  migrated: boolean;
  reason: string;
}

function registryRoot(workspaceRoot: string): string {
  return path.join(path.resolve(workspaceRoot), ".service-lasso");
}

export function getProcessRegistryPath(workspaceRoot: string): string {
  return path.join(registryRoot(workspaceRoot), PROCESS_REGISTRY_FILE_NAME);
}

export function getProcessRegistryBackupPath(workspaceRoot: string): string {
  return path.join(registryRoot(workspaceRoot), PROCESS_REGISTRY_BACKUP_FILE_NAME);
}

export function getWorkspaceLifecycleLockPath(workspaceRoot: string): string {
  return path.join(registryRoot(workspaceRoot), WORKSPACE_LIFECYCLE_LOCK_FILE_NAME);
}

export function resolveWorkspaceProcessId(workspaceRoot: string): string {
  return "slw_" + createHash("sha256").update(path.resolve(workspaceRoot)).digest("hex").slice(0, 16);
}

function ownerKey(ownerType: ProcessOwnerType, ownerId: string): string {
  return `${ownerType}:${ownerId}`;
}

function emptyRegistry(now = new Date().toISOString()): ProcessOwnershipRegistry {
  return { version: PROCESS_REGISTRY_VERSION, updatedAt: now, entries: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizePorts(value: unknown): Record<string, number> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      ([name, port]) => name.trim() && typeof port === "number" && Number.isInteger(port) && port > 0 && port <= 65535,
    ),
  ) as Record<string, number>;
}

function normalizeEndpoints(value: unknown): ProcessOwnershipEndpoint[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.name !== "string" || !entry.name.trim() || typeof entry.url !== "string") {
      return [];
    }
    let sanitizedUrl: string;
    try {
      const parsed = new URL(entry.url);
      parsed.username = "";
      parsed.password = "";
      parsed.search = "";
      parsed.hash = "";
      sanitizedUrl = parsed.toString();
    } catch {
      sanitizedUrl = entry.url
        .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/i, "$1")
        .replace(/[?#].*$/, "");
    }
    return [{ name: entry.name, url: sanitizedUrl }];
  });
}

function normalizeFingerprint(value: unknown): ProcessFingerprint | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.pid !== "number" ||
    !Number.isInteger(value.pid) ||
    value.pid <= 0 ||
    typeof value.createdAt !== "string" ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    typeof value.executablePath !== "string" ||
    !value.executablePath ||
    typeof value.commandHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.commandHash)
  ) {
    return null;
  }
  return {
    pid: value.pid,
    createdAt: new Date(value.createdAt).toISOString(),
    executablePath: value.executablePath,
    commandHash: value.commandHash,
  };
}

function isIdentityStatus(value: unknown): value is ProcessIdentityClassification {
  return value === "owned" || value === "not_running" || value === "identity_mismatch" || value === "unknown_owner";
}

function isLifecycleState(value: unknown): value is ProcessOwnershipLifecycleState {
  return value === "launching" || value === "running" || value === "stopping" || value === "stopped";
}

function normalizeEntry(value: unknown): ProcessOwnershipEntry | null {
  if (!isRecord(value)) {
    return null;
  }
  const ownerType = value.ownerType === "runtime" || value.ownerType === "service" ? value.ownerType : null;
  const identity = normalizeFingerprint(value.identity);
  const pid = typeof value.pid === "number" && Number.isInteger(value.pid) && value.pid > 0 ? value.pid : null;
  if (
    !ownerType ||
    typeof value.ownerId !== "string" ||
    !value.ownerId.trim() ||
    typeof value.workspaceId !== "string" ||
    !value.workspaceId.trim() ||
    typeof value.ownerRoot !== "string" ||
    !value.ownerRoot.trim() ||
    !isLifecycleState(value.lifecycleState) ||
    !isIdentityStatus(value.identityStatus) ||
    (value.source !== "spawn" && value.source !== "runtime" && value.source !== "legacy-verified") ||
    typeof value.recordedAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    return null;
  }
  if (pid !== null && (!identity || identity.pid !== pid)) {
    return null;
  }

  const allocation = isRecord(value.allocation) ? value.allocation : {};
  const processGroup = isRecord(value.processGroup) ? value.processGroup : {};
  const groupKind = processGroup.kind === "posix" || processGroup.kind === "windows-job" ? processGroup.kind : "none";
  return {
    ownerType,
    ownerId: value.ownerId,
    serviceId: typeof value.serviceId === "string" ? value.serviceId : null,
    workspaceId: value.workspaceId,
    runtimeInstanceId: typeof value.runtimeInstanceId === "string" ? value.runtimeInstanceId : null,
    pid,
    identity,
    ownerRoot: path.resolve(value.ownerRoot),
    processGroup: {
      kind: groupKind,
      id: typeof processGroup.id === "string" ? processGroup.id : null,
    },
    allocation: {
      revision: typeof allocation.revision === "string" ? allocation.revision : null,
      ports: normalizePorts(allocation.ports),
      endpoints: normalizeEndpoints(allocation.endpoints),
    },
    lifecycleState: value.lifecycleState,
    identityStatus: value.identityStatus,
    source: value.source,
    recordedAt: value.recordedAt,
    updatedAt: value.updatedAt,
  };
}

function normalizeRegistry(value: unknown): ProcessOwnershipRegistry | null {
  if (!isRecord(value) || value.version !== PROCESS_REGISTRY_VERSION || !Array.isArray(value.entries)) {
    return null;
  }
  const entries = value.entries.map(normalizeEntry).filter((entry): entry is ProcessOwnershipEntry => entry !== null);
  return {
    version: PROCESS_REGISTRY_VERSION,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
    entries,
  };
}

async function readRegistryFile(filePath: string): Promise<ProcessOwnershipRegistry | null> {
  try {
    return normalizeRegistry(JSON.parse(await readFile(filePath, "utf8")) as unknown);
  } catch {
    return null;
  }
}

export async function readProcessOwnershipRegistry(workspaceRoot: string): Promise<ProcessOwnershipRegistry> {
  const primary = await readRegistryFile(getProcessRegistryPath(workspaceRoot));
  if (primary) {
    return primary;
  }
  return (await readRegistryFile(getProcessRegistryBackupPath(workspaceRoot))) ?? emptyRegistry();
}

async function atomicWriteRegistry(workspaceRoot: string, registry: ProcessOwnershipRegistry): Promise<void> {
  const registryPath = getProcessRegistryPath(workspaceRoot);
  const backupPath = getProcessRegistryBackupPath(workspaceRoot);
  await mkdir(path.dirname(registryPath), { recursive: true });
  const tempPath = `${registryPath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  const handle = await open(tempPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(registry, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await copyFile(registryPath, backupPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      await unlink(tempPath).catch(() => undefined);
      throw error;
    }
  }
  await rename(tempPath, registryPath);
}

async function acquireWorkspaceLifecycleLock(workspaceRoot: string): Promise<() => Promise<void>> {
  const lockPath = getWorkspaceLifecycleLockPath(workspaceRoot);
  await mkdir(path.dirname(lockPath), { recursive: true });
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  const token = randomUUID();
  const ownerInspection = await inspectProcess(process.pid);
  if (ownerInspection.status !== "running") {
    throw new Error(`Cannot verify workspace lifecycle lock owner: ${ownerInspection.reason}`);
  }

  while (true) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify({
          version: 1,
          token,
          pid: process.pid,
          identity: ownerInspection.identity,
          acquiredAt: new Date().toISOString(),
        })}\n`, "utf8");
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
        let ownership: ProcessIdentityClassification | "legacy_or_invalid" = "legacy_or_invalid";
        try {
          const lock = JSON.parse(await readFile(lockPath, "utf8")) as { pid?: unknown; identity?: unknown };
          const identity = normalizeFingerprint(lock.identity);
          if (identity && lock.pid === identity.pid) {
            ownership = classifyProcessIdentity(identity, await inspectProcess(identity.pid));
          }
        } catch {
          // Legacy and interrupted lock files retain the bounded stale timeout.
        }

        if (ownership === "not_running" || ownership === "identity_mismatch") {
          await unlink(lockPath);
          continue;
        }
        if (ownership === "legacy_or_invalid" && Date.now() - lockStat.mtimeMs > STALE_LOCK_MS) {
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
        throw new Error(`Timed out waiting for workspace lifecycle lock: ${lockPath}`);
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
    }
  }
}

async function mutateRegistry(
  workspaceRoot: string,
  recipe: (registry: ProcessOwnershipRegistry, now: string) => ProcessOwnershipRegistry,
): Promise<ProcessOwnershipRegistry> {
  const release = await acquireWorkspaceLifecycleLock(workspaceRoot);
  try {
    const now = new Date().toISOString();
    const next = recipe(await readProcessOwnershipRegistry(workspaceRoot), now);
    await atomicWriteRegistry(workspaceRoot, next);
    return next;
  } finally {
    await release();
  }
}

function replaceEntry(registry: ProcessOwnershipRegistry, entry: ProcessOwnershipEntry, now: string): ProcessOwnershipRegistry {
  const key = ownerKey(entry.ownerType, entry.ownerId);
  return {
    version: PROCESS_REGISTRY_VERSION,
    updatedAt: now,
    entries: [
      ...registry.entries.filter((candidate) => ownerKey(candidate.ownerType, candidate.ownerId) !== key),
      entry,
    ].sort((left, right) => ownerKey(left.ownerType, left.ownerId).localeCompare(ownerKey(right.ownerType, right.ownerId))),
  };
}

export async function recordProcessOwnership(
  workspaceRoot: string,
  input: RecordProcessOwnershipInput,
  inspectorDependencies: ProcessInspectorDependencies = {},
): Promise<ProcessOwnershipEntry> {
  const inspection = await inspectProcess(input.pid, inspectorDependencies);
  if (inspection.status !== "running") {
    throw new Error(`Cannot persist process ownership for ${input.ownerType} "${input.ownerId}": ${inspection.reason}.`);
  }

  let recorded!: ProcessOwnershipEntry;
  await mutateRegistry(workspaceRoot, (registry, now) => {
    const prior = registry.entries.find(
      (entry) => entry.ownerType === input.ownerType && entry.ownerId === input.ownerId,
    );
    recorded = {
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      serviceId: input.serviceId ?? (input.ownerType === "service" ? input.ownerId : null),
      workspaceId: resolveWorkspaceProcessId(workspaceRoot),
      runtimeInstanceId: input.runtimeInstanceId ?? null,
      pid: input.pid,
      identity: inspection.identity,
      ownerRoot: path.resolve(input.ownerRoot),
      processGroup: input.processGroup ?? { kind: "none", id: null },
      allocation: {
        revision: input.allocationRevision ?? null,
        ports: normalizePorts(input.ports),
        endpoints: normalizeEndpoints(input.endpoints),
      },
      lifecycleState: input.lifecycleState,
      identityStatus: "owned",
      source: input.source,
      recordedAt: prior?.recordedAt ?? now,
      updatedAt: now,
    };
    return replaceEntry(registry, recorded, now);
  });
  return recorded;
}

export async function transitionProcessOwnership(
  workspaceRoot: string,
  ownerType: ProcessOwnerType,
  ownerId: string,
  lifecycleState: ProcessOwnershipLifecycleState,
  identityStatus?: ProcessIdentityClassification,
  expectedPid?: number,
): Promise<ProcessOwnershipEntry | null> {
  let transitioned: ProcessOwnershipEntry | null = null;
  await mutateRegistry(workspaceRoot, (registry, now) => {
    const current = registry.entries.find((entry) => entry.ownerType === ownerType && entry.ownerId === ownerId);
    if (!current) {
      return { ...registry, updatedAt: now };
    }
    if (expectedPid !== undefined && current.pid !== expectedPid) {
      return { ...registry, updatedAt: now };
    }
    const clearIdentity = lifecycleState === "stopped" && identityStatus !== "unknown_owner";
    transitioned = {
      ...current,
      pid: clearIdentity ? null : current.pid,
      identity: clearIdentity ? null : current.identity,
      lifecycleState,
      identityStatus: identityStatus ?? (clearIdentity ? "not_running" : current.identityStatus),
      updatedAt: now,
    };
    return replaceEntry(registry, transitioned, now);
  });
  return transitioned;
}

export async function findProcessOwnership(
  workspaceRoot: string,
  ownerType: ProcessOwnerType,
  ownerId: string,
): Promise<ProcessOwnershipEntry | null> {
  const registry = await readProcessOwnershipRegistry(workspaceRoot);
  return registry.entries.find((entry) => entry.ownerType === ownerType && entry.ownerId === ownerId) ?? null;
}

export async function classifyRegisteredProcess(
  entry: ProcessOwnershipEntry,
  inspectorDependencies: ProcessInspectorDependencies = {},
): Promise<ProcessIdentityClassification> {
  if (!entry.pid || !entry.identity) {
    return "not_running";
  }
  return classifyProcessIdentity(entry.identity, await inspectProcess(entry.pid, inspectorDependencies), inspectorDependencies.platform);
}

export async function reconcileRegisteredProcess(
  workspaceRoot: string,
  ownerType: ProcessOwnerType,
  ownerId: string,
  inspectorDependencies: ProcessInspectorDependencies = {},
): Promise<ProcessIdentityClassification> {
  const entry = await findProcessOwnership(workspaceRoot, ownerType, ownerId);
  if (!entry) {
    return "not_running";
  }
  const status = await classifyRegisteredProcess(entry, inspectorDependencies);
  if (status !== "owned") {
    await transitionProcessOwnership(workspaceRoot, ownerType, ownerId, status === "unknown_owner" ? entry.lifecycleState : "stopped", status);
  }
  return status;
}

function legacyExecutableMatches(
  expectedExecutablePath: string | null | undefined,
  command: string,
  actualExecutablePath: string,
  platform: NodeJS.Platform,
): boolean {
  const normalize = (value: string) => {
    const normalized = platform === "win32"
      ? path.win32.normalize(value.trim())
      : path.normalize(value.trim());
    return platform === "win32" ? normalized.toLowerCase() : normalized;
  };
  const actual = normalize(actualExecutablePath);
  if (expectedExecutablePath) {
    return normalize(expectedExecutablePath) === actual;
  }
  const normalizedCommand = platform === "win32" ? command.trim().toLowerCase() : command.trim();
  return normalizedCommand.startsWith(actual);
}

export async function migrateLegacyProcessOwnership(
  workspaceRoot: string,
  input: LegacyProcessOwnershipInput,
): Promise<LegacyProcessOwnershipResult> {
  const inspection: ProcessInspection = await inspectProcess(input.pid, input.inspectorDependencies);
  if (inspection.status !== "running") {
    const status = inspection.status === "not_running" ? "not_running" : "unknown_owner";
    if (status === "not_running") {
      await transitionProcessOwnership(workspaceRoot, "service", input.ownerId, "stopped", status);
    }
    return { status, migrated: false, reason: inspection.reason };
  }

  const platform = input.inspectorDependencies?.platform ?? process.platform;
  const recordedStart = Date.parse(input.startedAt);
  const actualStart = Date.parse(inspection.identity.createdAt);
  const startMatches = Number.isFinite(recordedStart) &&
    Number.isFinite(actualStart) &&
    Math.abs(recordedStart - actualStart) <= LEGACY_START_TOLERANCE_MS;
  const executableMatches = legacyExecutableMatches(
    input.expectedExecutablePath,
    input.command,
    inspection.identity.executablePath,
    platform,
  );
  const commandMatches = hashProcessCommandLine(input.command) === inspection.identity.commandHash;

  if (!startMatches || !executableMatches || !commandMatches) {
    await transitionProcessOwnership(workspaceRoot, "service", input.ownerId, "stopped", "identity_mismatch");
    return {
      status: "identity_mismatch",
      migrated: false,
      reason: [
        !startMatches ? "creation_time_mismatch" : null,
        !executableMatches ? "executable_mismatch" : null,
        !commandMatches ? "command_mismatch" : null,
      ].filter(Boolean).join(","),
    };
  }

  await recordProcessOwnership(
    workspaceRoot,
    {
      ownerType: "service",
      ownerId: input.ownerId,
      serviceId: input.serviceId,
      runtimeInstanceId: input.runtimeInstanceId,
      pid: input.pid,
      ownerRoot: input.ownerRoot,
      allocationRevision: input.allocationRevision,
      ports: input.ports,
      endpoints: input.endpoints,
      lifecycleState: "running",
      source: "legacy-verified",
    },
    input.inspectorDependencies,
  );
  return { status: "owned", migrated: true, reason: "legacy_identity_verified" };
}
