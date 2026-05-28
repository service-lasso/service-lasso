import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { RuntimeConfig } from "../config.js";
import type {
  RuntimeInstanceRecord,
  RuntimeInstanceRegistrySnapshot,
  RuntimeInstanceStatus,
} from "../../contracts/api.js";

const INSTANCE_FILE_NAME = "runtime-instance.json";
const INSTANCE_REGISTRY_FILE_NAME = "instances.json";
export const DEFAULT_RUNTIME_INSTANCE_LEASE_TTL_MS = 45_000;
export const DEFAULT_RUNTIME_INSTANCE_HEARTBEAT_INTERVAL_MS = 15_000;

export interface RuntimeInstanceRegistrationOptions {
  apiPort: number;
  apiUrl: string;
  startedAt?: string;
}

export interface RuntimeInstanceLeaseRefreshOptions {
  now?: Date;
}

export function resolveRuntimeInstanceId(config: RuntimeConfig): string {
  const hash = createHash("sha256")
    .update(path.resolve(config.servicesRoot))
    .update("\0")
    .update(path.resolve(config.workspaceRoot))
    .digest("hex");

  return "sl_" + hash.slice(0, 16);
}

export function getRuntimeInstanceStatePath(workspaceRoot: string): string {
  return path.join(path.resolve(workspaceRoot), ".service-lasso", INSTANCE_FILE_NAME);
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

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function parseIsoTime(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function addMilliseconds(value: string, milliseconds: number): string {
  const parsed = parseIsoTime(value) ?? Date.now();
  return new Date(parsed + milliseconds).toISOString();
}

function normalizeInstanceRecord(input: unknown): RuntimeInstanceRecord | null {
  if (!isRecord(input)) {
    return null;
  }

  const instanceId = typeof input.instanceId === "string" ? input.instanceId : null;
  const servicesRoot = typeof input.servicesRoot === "string" ? input.servicesRoot : null;
  const workspaceRoot = typeof input.workspaceRoot === "string" ? input.workspaceRoot : null;
  const apiUrl = typeof input.apiUrl === "string" ? input.apiUrl : null;
  const startedAt = typeof input.startedAt === "string" ? input.startedAt : null;
  const updatedAt = typeof input.updatedAt === "string" ? input.updatedAt : null;
  const heartbeatAt = typeof input.heartbeatAt === "string" ? input.heartbeatAt : updatedAt;
  const version = typeof input.version === "string" ? input.version : null;
  const apiPort = typeof input.apiPort === "number" && Number.isInteger(input.apiPort) ? input.apiPort : null;
  const pid = typeof input.pid === "number" && Number.isInteger(input.pid) ? input.pid : null;

  if (!instanceId || !servicesRoot || !workspaceRoot || !apiUrl || !startedAt || !updatedAt || !heartbeatAt || !apiPort || !pid) {
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

  return {
    instanceId,
    servicesRoot,
    workspaceRoot,
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

function processExists(pid: number): boolean {
  if (pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function classifyRecord(record: RuntimeInstanceRecord, now: Date = new Date()): RuntimeInstanceRecord {
  if (record.status === "stale" && record.staleReason) {
    return {
      ...record,
      statusReason: record.statusReason ?? record.staleReason,
    };
  }

  if (!processExists(record.pid)) {
    return {
      ...record,
      status: "stale",
      statusReason: "process_not_running",
      staleReason: "process_not_running",
    };
  }

  const leaseExpiresAt = parseIsoTime(record.leaseExpiresAt);
  if (leaseExpiresAt === null || leaseExpiresAt <= now.getTime()) {
    return {
      ...record,
      status: "unknown",
      statusReason: "lease_expired",
      staleReason: undefined,
    };
  }

  return {
    ...record,
    status: "active",
    statusReason: undefined,
    staleReason: undefined,
  };
}

function createInstanceRecord(
  config: RuntimeConfig,
  options: RuntimeInstanceRegistrationOptions,
  status: RuntimeInstanceStatus = "active",
  staleReason?: string,
): RuntimeInstanceRecord {
  const now = new Date().toISOString();
  const startedAt = options.startedAt ?? now;
  const leaseTtlMs = DEFAULT_RUNTIME_INSTANCE_LEASE_TTL_MS;
  const statusReason = staleReason;

  return {
    instanceId: resolveRuntimeInstanceId(config),
    servicesRoot: path.resolve(config.servicesRoot),
    workspaceRoot: path.resolve(config.workspaceRoot),
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
    status,
    statusReason,
    staleReason,
  };
}

function refreshInstanceRecord(record: RuntimeInstanceRecord, options: RuntimeInstanceLeaseRefreshOptions = {}): RuntimeInstanceRecord {
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

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2) + "\n");
}

export async function readRuntimeInstanceRegistry(): Promise<RuntimeInstanceRegistrySnapshot> {
  const registryPath = getRuntimeInstanceRegistryPath();
  const records = normalizeRegistry(await readJsonIfPresent(registryPath)).map((record) => classifyRecord(record));

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
  return record ? classifyRecord(record) : null;
}

export async function registerRuntimeInstance(
  config: RuntimeConfig,
  options: RuntimeInstanceRegistrationOptions,
): Promise<RuntimeInstanceRecord> {
  const record = createInstanceRecord(config, options);
  const registry = await readRuntimeInstanceRegistry();
  const records = registry.instances.filter((entry) => entry.instanceId !== record.instanceId);
  records.push(record);

  await Promise.all([
    writeJson(getRuntimeInstanceStatePath(config.workspaceRoot), record),
    writeJson(registry.path, { version: 1, updatedAt: record.updatedAt, instances: records }),
  ]);

  return record;
}

export async function refreshRuntimeInstanceLease(
  config: RuntimeConfig,
  options: RuntimeInstanceLeaseRefreshOptions = {},
): Promise<RuntimeInstanceRecord | null> {
  const current = normalizeInstanceRecord(await readJsonIfPresent(getRuntimeInstanceStatePath(config.workspaceRoot)));
  if (!current) {
    return null;
  }

  const refreshed = refreshInstanceRecord(current, options);
  const registry = await readRuntimeInstanceRegistry();
  const records = registry.instances.filter((entry) => entry.instanceId !== refreshed.instanceId);
  records.push(refreshed);

  await Promise.all([
    writeJson(getRuntimeInstanceStatePath(config.workspaceRoot), refreshed),
    writeJson(registry.path, { version: 1, updatedAt: refreshed.updatedAt, instances: records }),
  ]);

  return refreshed;
}

export async function markRuntimeInstanceStopped(config: RuntimeConfig): Promise<void> {
  const current = await readRuntimeInstanceState(config);
  if (!current) {
    return;
  }

  const stopped: RuntimeInstanceRecord = {
    ...current,
    status: "stale",
    statusReason: "stopped",
    staleReason: "stopped",
    updatedAt: new Date().toISOString(),
  };
  const registry = await readRuntimeInstanceRegistry();
  const records = registry.instances.filter((entry) => entry.instanceId !== stopped.instanceId);
  records.push(stopped);

  await Promise.all([
    writeJson(getRuntimeInstanceStatePath(config.workspaceRoot), stopped),
    writeJson(registry.path, { version: 1, updatedAt: stopped.updatedAt, instances: records }),
  ]);
}

export async function createRuntimeInstanceSnapshot(
  config: RuntimeConfig,
): Promise<{ instance: RuntimeInstanceRecord | null; registry: RuntimeInstanceRegistrySnapshot }> {
  const [instance, registry] = await Promise.all([
    readRuntimeInstanceState(config),
    readRuntimeInstanceRegistry(),
  ]);

  return {
    instance,
    registry,
  };
}
