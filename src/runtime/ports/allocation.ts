import dgram from "node:dgram";
import { randomUUID } from "node:crypto";
import { copyFile, lstat, mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { DiscoveredService, ServiceEndpointPortStrategy } from "../../contracts/service.js";
import { getLifecycleState } from "../lifecycle/store.js";
import { normalizeServiceEndpoints } from "../operator/endpoints.js";
import {
  classifyRegisteredProcess,
  readProcessOwnershipRegistry,
  resolveWorkspaceProcessId,
} from "../process/registry.js";
import {
  classifyProcessIdentity,
  inspectProcess,
  type ProcessFingerprint,
  type ProcessIdentityClassification,
} from "../process/identity.js";
import {
  readPortReservationLedger,
  reconcilePortReservationLedger,
  type PortReservationInput,
} from "./reservations.js";
import {
  ENDPOINT_ALLOCATION_POLICY,
  ENDPOINT_ALLOCATION_SCHEMA_V2,
  isRedirectedOrSpecialFile,
  readLifecycleDocument,
  writeLifecycleDocument,
} from "../state/lifecycle-persistence.js";

const DEFAULT_BIND = "127.0.0.1";
const DEFAULT_DYNAMIC_PORT_START = 4000;
const HOST_ALLOCATION_REGISTRY_MAX_BYTES = 8 * 1024 * 1024;
const HOST_REGISTRY_LOCK_TIMEOUT_MS = 10_000;
const HOST_REGISTRY_LOCK_STALE_MS = 30_000;
const HOST_REGISTRY_LOCK_RETRY_MS = 20;
const WORKSPACE_PLAN_FILE_NAME = "endpoint-allocation.json";

export type RuntimeEndpointOwnerType = "runtime" | "service";
export type RuntimeEndpointAllocationPolicy = ServiceEndpointPortStrategy;
export type RuntimeEndpointAllocationResolution = "pinned" | "fixed" | "preferred" | "renegotiated" | "automatic";

export interface RuntimeEndpointAllocationRequest {
  ownerType: RuntimeEndpointOwnerType;
  ownerId: string;
  endpointId: string;
  host: string;
  advertiseHost: string;
  transport: "tcp" | "udp";
  protocol: string;
  policy: RuntimeEndpointAllocationPolicy;
  preferredPorts: number[];
  range: { start: number; end: number } | null;
  pinnedPort: number | null;
}

export interface RuntimeResolvedEndpointAllocation {
  ownerType: RuntimeEndpointOwnerType;
  ownerId: string;
  endpointId: string;
  host: string;
  advertiseHost: string;
  transport: "tcp" | "udp";
  protocol: string;
  policy: RuntimeEndpointAllocationPolicy;
  resolution: RuntimeEndpointAllocationResolution;
  port: number;
  preferredPorts: number[];
  range: { start: number; end: number } | null;
  pinned: boolean;
  selectors: {
    bind: string;
    host: string;
    port: number;
    url: string;
  };
}

export interface RuntimeEndpointAllocationPlan {
  version: 1;
  allocationId: string;
  laneId: string;
  generationId: string | null;
  servicesRoot: string;
  workspaceRoot: string;
  phase: "reserved" | "released";
  attempt: number;
  createdAt: string;
  updatedAt: string;
  endpoints: RuntimeResolvedEndpointAllocation[];
}

export type RuntimeEndpointAllocationRecoveryStatus =
  | "recoverable"
  | "active_owner"
  | "unknown_owner"
  | "missing"
  | "mismatch"
  | "released";

export interface RuntimeEndpointAllocationRecoveryInspection {
  status: RuntimeEndpointAllocationRecoveryStatus;
  reason: string;
  allocationId: string;
  ownerStatuses: ProcessIdentityClassification[];
}

interface HostEndpointAllocation extends RuntimeResolvedEndpointAllocation {
  allocationId: string;
  laneId: string;
  generationId: string | null;
  workspaceRoot: string;
  reservationIdentity: ProcessFingerprint;
  reservedAt: string;
  updatedAt: string;
}

interface HostEndpointAllocationRegistry {
  version: 1;
  updatedAt: string;
  allocations: HostEndpointAllocation[];
}

export interface RuntimeApiEndpointProposal {
  host?: string;
  advertiseHost?: string;
  port: number;
  policy?: RuntimeEndpointAllocationPolicy;
  range?: { start: number; end: number } | null;
}

export interface PlanRuntimeEndpointAllocationOptions {
  laneId: string;
  generationId?: string | null;
  servicesRoot: string;
  workspaceRoot: string;
  api: RuntimeApiEndpointProposal;
  services: DiscoveredService[];
  attempt?: number;
  now?: Date;
  probePort?: (request: Pick<RuntimeEndpointAllocationRequest, "host" | "transport"> & { port: number }) => Promise<boolean>;
}

export class RuntimeEndpointAllocationError extends Error {
  readonly code: "endpoint_allocation_conflict" | "endpoint_allocation_exhausted";
  readonly statusCode = 409;
  readonly ownerId: string;
  readonly endpointId: string;
  readonly host: string;
  readonly port: number | null;

  constructor(
    code: RuntimeEndpointAllocationError["code"],
    request: RuntimeEndpointAllocationRequest,
    message: string,
    port: number | null = null,
  ) {
    super(message);
    this.name = "RuntimeEndpointAllocationError";
    this.code = code;
    this.ownerId = request.ownerId;
    this.endpointId = request.endpointId;
    this.host = request.host;
    this.port = port;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => {
    const resolved = path.resolve(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function isUsablePort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 65535;
}

function normalizeHost(value: string | undefined): string {
  const host = value?.trim().toLowerCase();
  if (!host || host === "localhost") return DEFAULT_BIND;
  if (host === "[::]") return "::";
  if (host === "[::1]") return "::1";
  return host;
}

function isWildcardHost(host: string): boolean {
  return host === "0.0.0.0" || host === "::" || host === "*";
}

export function endpointHostsOverlap(left: string, right: string): boolean {
  const normalizedLeft = normalizeHost(left);
  const normalizedRight = normalizeHost(right);
  if (normalizedLeft === normalizedRight) return true;
  if (normalizedLeft === "::" || normalizedRight === "::") return true;
  if (isWildcardHost(normalizedLeft) && normalizedRight !== "::1") return true;
  if (isWildcardHost(normalizedRight) && normalizedLeft !== "::1") return true;
  return false;
}

function normalizeRange(value: { start: number; end: number } | null | undefined): { start: number; end: number } | null {
  if (!value) return null;
  if (!isUsablePort(value.start) || !isUsablePort(value.end) || value.end < value.start) {
    throw new Error(`Invalid endpoint port range ${value.start}-${value.end}.`);
  }
  return { start: value.start, end: value.end };
}

function intersectRanges(
  endpointRange: { start: number; end: number } | null | undefined,
  globalRange: { start: number; end: number } | null,
): { start: number; end: number } | null {
  const endpoint = normalizeRange(endpointRange);
  if (!endpoint) return globalRange;
  if (!globalRange) return endpoint;
  const range = { start: Math.max(endpoint.start, globalRange.start), end: Math.min(endpoint.end, globalRange.end) };
  if (range.end < range.start) {
    throw new Error(
      `Endpoint range ${endpoint.start}-${endpoint.end} does not overlap configured range ${globalRange.start}-${globalRange.end}.`,
    );
  }
  return range;
}

function configuredPortRange(): { start: number; end: number } | null {
  const startValue = process.env.SERVICE_LASSO_PORT_RANGE_START;
  const endValue = process.env.SERVICE_LASSO_PORT_RANGE_END;
  if (startValue === undefined && endValue === undefined) return null;
  return normalizeRange({ start: Number(startValue), end: Number(endValue) });
}

function inRange(port: number, range: { start: number; end: number } | null): boolean {
  return !range || port >= range.start && port <= range.end;
}

function uniqueUsablePorts(values: Array<number | null | undefined>): number[] {
  return [...new Set(values.filter((value): value is number => isUsablePort(value)))];
}

function endpointUrl(protocol: string, host: string, port: number): string {
  const urlProtocol = protocol === "http" || protocol === "https" ? protocol : protocol === "udp" ? "udp" : "tcp";
  const urlHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `${urlProtocol}://${urlHost}:${port}/`;
}

export function getRuntimeEndpointAllocationPlanPath(workspaceRoot: string): string {
  return path.join(path.resolve(workspaceRoot), "runtime", WORKSPACE_PLAN_FILE_NAME);
}

export function getHostEndpointAllocationRegistryPath(): string {
  const configured = process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH?.trim();
  if (configured) return path.resolve(configured);
  const instanceRegistry = process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH?.trim();
  if (instanceRegistry) return path.join(path.dirname(path.resolve(instanceRegistry)), "endpoint-allocations.json");
  return path.join(os.homedir(), ".service-lasso", "endpoint-allocations.json");
}

async function lstatRegularFileIfPresent(filePath: string): Promise<boolean> {
  try {
    const info = await lstat(filePath);
    if (isRedirectedOrSpecialFile(info) || !info.isFile()) {
      throw new Error("Allocation registry file is redirected or an unsupported filesystem object.");
    }
    if (info.size > HOST_ALLOCATION_REGISTRY_MAX_BYTES) {
      throw new Error("Allocation registry file exceeds the bounded size.");
    }
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await lstatRegularFileIfPresent(filePath);
  await lstatRegularFileIfPresent(`${filePath}.bak`);
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

async function readJsonWithBackup(filePath: string): Promise<unknown | null> {
  for (const candidate of [filePath, `${filePath}.bak`]) {
    try {
      if (!await lstatRegularFileIfPresent(candidate)) continue;
      return JSON.parse(await readFile(candidate, "utf8")) as unknown;
    } catch {
      // Try the crash-recovery backup before treating the registry as absent.
    }
  }
  return null;
}

function emptyHostRegistry(): HostEndpointAllocationRegistry {
  return { version: 1, updatedAt: new Date(0).toISOString(), allocations: [] };
}

function normalizeFingerprint(value: unknown): ProcessFingerprint | null {
  if (!isRecord(value) || typeof value.pid !== "number" || !Number.isInteger(value.pid) || value.pid <= 0) {
    return null;
  }
  if (
    typeof value.createdAt !== "string" ||
    typeof value.executablePath !== "string" ||
    typeof value.commandHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.commandHash)
  ) {
    return null;
  }
  return {
    pid: value.pid as number,
    createdAt: value.createdAt,
    executablePath: value.executablePath,
    commandHash: value.commandHash,
  };
}

function normalizeResolvedEndpoint(value: unknown): RuntimeResolvedEndpointAllocation | null {
  if (!isRecord(value)) return null;
  if (
    (value.ownerType !== "runtime" && value.ownerType !== "service") ||
    typeof value.ownerId !== "string" ||
    typeof value.endpointId !== "string" ||
    typeof value.host !== "string" ||
    typeof value.advertiseHost !== "string" ||
    (value.transport !== "tcp" && value.transport !== "udp") ||
    typeof value.protocol !== "string" ||
    (value.policy !== "automatic" && value.policy !== "preferred" && value.policy !== "fixed") ||
    !isUsablePort(value.port)
  ) {
    return null;
  }
  const resolution = value.resolution === "pinned" || value.resolution === "fixed" || value.resolution === "preferred" ||
    value.resolution === "renegotiated" || value.resolution === "automatic"
    ? value.resolution
    : "automatic";
  const host = normalizeHost(value.host);
  const advertiseHost = normalizeHost(value.advertiseHost);
  const protocol = value.protocol;
  const port = value.port;
  let range: { start: number; end: number } | null = null;
  try {
    range = isRecord(value.range) ? normalizeRange({ start: Number(value.range.start), end: Number(value.range.end) }) : null;
  } catch {
    return null;
  }
  return {
    ownerType: value.ownerType,
    ownerId: value.ownerId,
    endpointId: value.endpointId,
    host,
    advertiseHost,
    transport: value.transport,
    protocol,
    policy: value.policy,
    resolution,
    port,
    preferredPorts: Array.isArray(value.preferredPorts) ? uniqueUsablePorts(value.preferredPorts as number[]) : [],
    range,
    pinned: resolution === "pinned",
    selectors: { bind: host, host: advertiseHost, port, url: endpointUrl(protocol, advertiseHost, port) },
  };
}

function normalizeHostAllocation(value: unknown): HostEndpointAllocation | null {
  if (!isRecord(value)) return null;
  const endpoint = normalizeResolvedEndpoint(value);
  const identity = normalizeFingerprint(value.reservationIdentity);
  if (
    !endpoint ||
    typeof value.allocationId !== "string" ||
    typeof value.laneId !== "string" ||
    typeof value.workspaceRoot !== "string" ||
    !identity
  ) {
    return null;
  }
  return {
    ...endpoint,
    allocationId: value.allocationId,
    laneId: value.laneId,
    generationId: typeof value.generationId === "string" ? value.generationId : null,
    workspaceRoot: path.resolve(value.workspaceRoot),
    reservationIdentity: identity,
    reservedAt: typeof value.reservedAt === "string" ? value.reservedAt : new Date(0).toISOString(),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date(0).toISOString(),
  };
}

async function readHostRegistry(): Promise<HostEndpointAllocationRegistry> {
  const input = await readJsonWithBackup(getHostEndpointAllocationRegistryPath());
  if (!isRecord(input) || input.version !== 1 || !Array.isArray(input.allocations)) {
    return emptyHostRegistry();
  }
  return {
    version: 1,
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : new Date(0).toISOString(),
    allocations: input.allocations.flatMap((entry) => {
      try {
        const normalized = normalizeHostAllocation(entry);
        return normalized ? [normalized] : [];
      } catch {
        return [];
      }
    }),
  };
}

async function acquireHostAllocationLock(): Promise<() => Promise<void>> {
  const lockPath = `${getHostEndpointAllocationRegistryPath()}.lock`;
  await mkdir(path.dirname(lockPath), { recursive: true });
  const token = randomUUID();
  const deadline = Date.now() + HOST_REGISTRY_LOCK_TIMEOUT_MS;
  const ownerInspection = await inspectProcess(process.pid);
  if (ownerInspection.status !== "running") {
    throw new Error(`Cannot verify host endpoint allocation lock owner: ${ownerInspection.reason}.`);
  }
  while (true) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify({
          token,
          reservationIdentity: ownerInspection.identity,
          createdAt: new Date().toISOString(),
        })}\n`);
        await handle.sync();
      } finally {
        await handle.close();
      }
      return async () => {
        try {
          const current = JSON.parse(await readFile(lockPath, "utf8")) as { token?: unknown };
          if (current.token === token) await unlink(lockPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let identity: ProcessFingerprint | null = null;
      try {
        const lock = JSON.parse(await readFile(lockPath, "utf8")) as unknown;
        identity = isRecord(lock) ? normalizeFingerprint(lock.reservationIdentity) : null;
      } catch {
        // A malformed lock is only recoverable once its bounded stale age passes.
      }
      try {
        if (identity && classifyProcessIdentity(identity, await inspectProcess(identity.pid)) !== "owned") {
          await unlink(lockPath);
          continue;
        }
        const current = await stat(lockPath);
        if (!identity && Date.now() - current.mtimeMs > HOST_REGISTRY_LOCK_STALE_MS) {
          await unlink(lockPath);
          continue;
        }
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw statError;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for host endpoint allocation lock: ${lockPath}`);
      }
      await new Promise((resolve) => setTimeout(resolve, HOST_REGISTRY_LOCK_RETRY_MS));
    }
  }
}

async function activeHostAllocations(registry: HostEndpointAllocationRegistry): Promise<HostEndpointAllocation[]> {
  const inspectionByPid = new Map<number, Awaited<ReturnType<typeof inspectProcess>>>();
  const active: HostEndpointAllocation[] = [];
  for (const allocation of registry.allocations) {
    let inspection = inspectionByPid.get(allocation.reservationIdentity.pid);
    if (!inspection) {
      inspection = await inspectProcess(allocation.reservationIdentity.pid);
      inspectionByPid.set(allocation.reservationIdentity.pid, inspection);
    }
    if (classifyProcessIdentity(allocation.reservationIdentity, inspection) === "owned") {
      active.push(allocation);
    }
  }
  return active;
}

function hostAllocationMatchesPlan(
  entry: HostEndpointAllocation,
  endpoint: RuntimeResolvedEndpointAllocation,
  plan: RuntimeEndpointAllocationPlan,
): boolean {
  return entry.allocationId === plan.allocationId &&
    entry.laneId === plan.laneId &&
    entry.generationId === plan.generationId &&
    samePath(entry.workspaceRoot, plan.workspaceRoot) &&
    entry.ownerType === endpoint.ownerType &&
    entry.ownerId === endpoint.ownerId &&
    entry.endpointId === endpoint.endpointId &&
    entry.host === endpoint.host &&
    entry.transport === endpoint.transport &&
    entry.port === endpoint.port;
}

async function inspectAllocationRecoveryInRegistry(
  registry: HostEndpointAllocationRegistry,
  plan: RuntimeEndpointAllocationPlan,
): Promise<RuntimeEndpointAllocationRecoveryInspection> {
  if (plan.phase === "released") {
    return {
      status: "released",
      reason: "workspace_allocation_released",
      allocationId: plan.allocationId,
      ownerStatuses: [],
    };
  }
  const entries = registry.allocations.filter((entry) => entry.allocationId === plan.allocationId);
  if (entries.length === 0) {
    return {
      status: "missing",
      reason: "host_allocation_missing",
      allocationId: plan.allocationId,
      ownerStatuses: [],
    };
  }
  const exact = plan.endpoints.every((endpoint) =>
    entries.some((entry) => hostAllocationMatchesPlan(entry, endpoint, plan)),
  ) && entries.length === plan.endpoints.length;
  if (!exact) {
    return {
      status: "mismatch",
      reason: "host_allocation_does_not_match_workspace_plan",
      allocationId: plan.allocationId,
      ownerStatuses: [],
    };
  }

  const inspections = new Map<number, Awaited<ReturnType<typeof inspectProcess>>>();
  const ownerStatuses: ProcessIdentityClassification[] = [];
  for (const entry of entries) {
    let inspection = inspections.get(entry.reservationIdentity.pid);
    if (!inspection) {
      inspection = await inspectProcess(entry.reservationIdentity.pid);
      inspections.set(entry.reservationIdentity.pid, inspection);
    }
    ownerStatuses.push(classifyProcessIdentity(entry.reservationIdentity, inspection));
  }
  if (ownerStatuses.includes("unknown_owner")) {
    return {
      status: "unknown_owner",
      reason: "host_allocation_owner_unverifiable",
      allocationId: plan.allocationId,
      ownerStatuses,
    };
  }
  if (ownerStatuses.includes("owned")) {
    return {
      status: "active_owner",
      reason: "host_allocation_owner_still_running",
      allocationId: plan.allocationId,
      ownerStatuses,
    };
  }
  return {
    status: "recoverable",
    reason: "host_allocation_owner_ended",
    allocationId: plan.allocationId,
    ownerStatuses,
  };
}

export async function inspectRuntimeEndpointAllocationRecovery(
  plan: RuntimeEndpointAllocationPlan,
): Promise<RuntimeEndpointAllocationRecoveryInspection> {
  return await inspectAllocationRecoveryInRegistry(await readHostRegistry(), plan);
}

export async function claimRuntimeEndpointAllocation(
  plan: RuntimeEndpointAllocationPlan,
): Promise<RuntimeEndpointAllocationPlan> {
  const release = await acquireHostAllocationLock();
  try {
    const registry = await readHostRegistry();
    const inspection = await inspectAllocationRecoveryInRegistry(registry, plan);
    if (inspection.status !== "recoverable") {
      throw new Error(
        `Cannot claim runtime endpoint allocation ${plan.allocationId}: ${inspection.reason}.`,
      );
    }
    const current = await inspectProcess(process.pid);
    if (current.status !== "running") {
      throw new Error(`Cannot verify recovering endpoint allocation owner: ${current.reason}.`);
    }
    const now = new Date().toISOString();
    const claimed = { ...plan, updatedAt: now } satisfies RuntimeEndpointAllocationPlan;
    // Updating the workspace timestamp is non-authoritative. Persist it before
    // the host owner swap so any write failure leaves the host claim untouched.
    await writeWorkspaceAllocationPlan(plan.workspaceRoot, claimed);
    await atomicWriteJson(getHostEndpointAllocationRegistryPath(), {
      version: 1,
      updatedAt: now,
      allocations: registry.allocations.map((entry) => entry.allocationId === plan.allocationId
        ? { ...entry, reservationIdentity: current.identity, updatedAt: now }
        : entry),
    } satisfies HostEndpointAllocationRegistry);
    return claimed;
  } finally {
    await release();
  }
}

function localInterfaceAddresses(family: "IPv4" | "IPv6"): string[] {
  const addresses = Object.values(os.networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === family)
    .map((entry) => normalizeHost(entry.address));
  return [...new Set(addresses)];
}

function overlappingProbeHosts(host: string): string[] {
  const normalized = normalizeHost(host);
  if (normalized === "::") {
    return [...new Set(["::", "::1", ...localInterfaceAddresses("IPv6"), "0.0.0.0", "127.0.0.1", ...localInterfaceAddresses("IPv4")])];
  }
  if (normalized === "0.0.0.0" || normalized === "*") {
    return [...new Set(["0.0.0.0", "127.0.0.1", ...localInterfaceAddresses("IPv4")])];
  }
  if (normalized.includes(":")) {
    return [...new Set([normalized, "::"])];
  }
  return [...new Set([normalized, "0.0.0.0"])];
}

async function probeTcpPortOnHost(port: number, host: string): Promise<boolean> {
  const server = net.createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, resolve);
    });
    return true;
  } catch {
    return false;
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
}

async function probeTcpPort(port: number, host: string): Promise<boolean> {
  for (const probeHost of overlappingProbeHosts(host)) {
    if (!(await probeTcpPortOnHost(port, probeHost))) return false;
  }
  return true;
}

async function probeUdpPortOnHost(port: number, host: string): Promise<boolean> {
  const socket = dgram.createSocket(host.includes(":") ? "udp6" : "udp4");
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.bind(port, host, resolve);
    });
    return true;
  } catch {
    return false;
  } finally {
    await new Promise<void>((resolve) => socket.close(() => resolve())).catch(() => undefined);
  }
}

async function probeUdpPort(port: number, host: string): Promise<boolean> {
  for (const probeHost of overlappingProbeHosts(host)) {
    if (!(await probeUdpPortOnHost(port, probeHost))) return false;
  }
  return true;
}

async function defaultProbePort(request: Pick<RuntimeEndpointAllocationRequest, "host" | "transport"> & { port: number }): Promise<boolean> {
  return request.transport === "udp"
    ? await probeUdpPort(request.port, request.host)
    : await probeTcpPort(request.port, request.host);
}

function allocationsConflict(
  request: Pick<RuntimeEndpointAllocationRequest, "host" | "transport">,
  port: number,
  existing: Pick<RuntimeResolvedEndpointAllocation, "host" | "transport" | "port">,
): boolean {
  return request.transport === existing.transport && port === existing.port && endpointHostsOverlap(request.host, existing.host);
}

async function findPinnedPorts(workspaceRoot: string): Promise<Map<string, number>> {
  const registry = await readProcessOwnershipRegistry(workspaceRoot);
  const pinned = new Map<string, number>();
  for (const entry of registry.entries) {
    if ((entry.lifecycleState !== "launching" && entry.lifecycleState !== "running") || await classifyRegisteredProcess(entry) !== "owned") {
      continue;
    }
    for (const [endpointId, port] of Object.entries(entry.allocation.ports)) {
      if (!isUsablePort(port)) continue;
      if (entry.ownerType === "runtime") {
        if (endpointId === "api" || endpointId === "http") pinned.set("runtime:runtime-api:http", port);
      } else {
        pinned.set(`service:${entry.ownerId}:${endpointId}`, port);
      }
    }
  }
  return pinned;
}

function endpointPolicy(value: ServiceEndpointPortStrategy | undefined, proposedPort: number | undefined): RuntimeEndpointAllocationPolicy {
  if (value === "automatic" || value === "preferred" || value === "fixed") return value;
  return proposedPort === 0 || proposedPort === undefined ? "automatic" : "preferred";
}

async function buildRequests(options: PlanRuntimeEndpointAllocationOptions): Promise<RuntimeEndpointAllocationRequest[]> {
  const [pinned, ledger] = await Promise.all([
    findPinnedPorts(options.workspaceRoot),
    readPortReservationLedger(options.workspaceRoot),
  ]);
  const ledgerPreferences = new Map(
    ledger.reservations
      .filter((entry) => entry.stale !== true)
      .map((entry) => [`${entry.ownerId}:${entry.portName}`, entry.port]),
  );
  const globalRange = configuredPortRange();
  const apiHost = normalizeHost(options.api.host);
  const apiAdvertiseHost = normalizeHost(options.api.advertiseHost ?? (isWildcardHost(apiHost) ? DEFAULT_BIND : apiHost));
  const apiPolicy = options.api.policy ?? (options.api.port === 0 ? "automatic" : "preferred");
  const requests: RuntimeEndpointAllocationRequest[] = [{
    ownerType: "runtime",
    ownerId: "runtime-api",
    endpointId: "http",
    host: apiHost,
    advertiseHost: apiAdvertiseHost,
    transport: "tcp",
    protocol: "http",
    policy: apiPolicy,
    preferredPorts: apiPolicy === "fixed"
      ? uniqueUsablePorts([options.api.port])
      : uniqueUsablePorts([ledgerPreferences.get("runtime-api:http"), options.api.port]),
    range: intersectRanges(options.api.range, globalRange),
    pinnedPort: pinned.get("runtime:runtime-api:http") ?? null,
  }];

  for (const service of options.services) {
    const priorPorts = getLifecycleState(service.manifest.id).runtime.ports;
    for (const endpoint of normalizeServiceEndpoints(service.manifest)) {
      if (endpoint.kind !== "network" || endpoint.direction === "outbound") continue;
      const host = normalizeHost(endpoint.bind);
      const policy = endpointPolicy(endpoint.portStrategy, endpoint.portDefault);
      const preferredPorts = policy === "fixed"
        ? uniqueUsablePorts([endpoint.portDefault])
        : uniqueUsablePorts([
            priorPorts[endpoint.id],
            ledgerPreferences.get(`${service.manifest.id}:${endpoint.id}`),
            endpoint.portDefault,
          ]);
      requests.push({
        ownerType: "service",
        ownerId: service.manifest.id,
        endpointId: endpoint.id,
        host,
        advertiseHost: isWildcardHost(host) ? DEFAULT_BIND : host,
        transport: endpoint.transport === "udp" ? "udp" : "tcp",
        protocol: endpoint.protocol ?? endpoint.transport ?? "tcp",
        policy,
        preferredPorts,
        range: intersectRanges(endpoint.portRange, globalRange),
        pinnedPort: pinned.get(`service:${service.manifest.id}:${endpoint.id}`) ?? null,
      });
    }
  }
  return requests.sort((left, right) => {
    const priority = (request: RuntimeEndpointAllocationRequest) => request.pinnedPort ? 0 : request.policy === "fixed" ? 1 : request.ownerType === "runtime" ? 2 : request.policy === "preferred" ? 3 : 4;
    return priority(left) - priority(right) || left.ownerId.localeCompare(right.ownerId) || left.endpointId.localeCompare(right.endpointId);
  });
}

function allocationFor(request: RuntimeEndpointAllocationRequest, port: number, resolution: RuntimeEndpointAllocationResolution): RuntimeResolvedEndpointAllocation {
  return {
    ownerType: request.ownerType,
    ownerId: request.ownerId,
    endpointId: request.endpointId,
    host: request.host,
    advertiseHost: request.advertiseHost,
    transport: request.transport,
    protocol: request.protocol,
    policy: request.policy,
    resolution,
    port,
    preferredPorts: [...request.preferredPorts],
    range: request.range ? { ...request.range } : null,
    pinned: resolution === "pinned",
    selectors: {
      bind: request.host,
      host: request.advertiseHost,
      port,
      url: endpointUrl(request.protocol, request.advertiseHost, port),
    },
  };
}

async function allocateRequests(
  requests: RuntimeEndpointAllocationRequest[],
  hostAllocations: HostEndpointAllocation[],
  probePort: PlanRuntimeEndpointAllocationOptions["probePort"],
): Promise<RuntimeResolvedEndpointAllocation[]> {
  const resolved: RuntimeResolvedEndpointAllocation[] = [];
  const unavailable = (request: RuntimeEndpointAllocationRequest, port: number) =>
    [...hostAllocations, ...resolved].some((entry) => allocationsConflict(request, port, entry));
  const probe = probePort ?? defaultProbePort;

  for (const request of requests) {
    if (request.pinnedPort) {
      if (!inRange(request.pinnedPort, request.range) || unavailable(request, request.pinnedPort)) {
        throw new RuntimeEndpointAllocationError(
          "endpoint_allocation_conflict",
          request,
          `Pinned endpoint ${request.ownerId}.${request.endpointId} cannot retain ${request.host}:${request.pinnedPort}.`,
          request.pinnedPort,
        );
      }
      resolved.push(allocationFor(request, request.pinnedPort, "pinned"));
      continue;
    }

    if (request.policy === "fixed") {
      const fixedPort = request.preferredPorts[0];
      if (!fixedPort || !inRange(fixedPort, request.range) || unavailable(request, fixedPort) || !(await probe({ host: request.host, transport: request.transport, port: fixedPort }))) {
        throw new RuntimeEndpointAllocationError(
          "endpoint_allocation_conflict",
          request,
          `Fixed endpoint ${request.ownerId}.${request.endpointId} cannot bind ${request.host}:${fixedPort ?? "unset"}.`,
          fixedPort ?? null,
        );
      }
      resolved.push(allocationFor(request, fixedPort, "fixed"));
      continue;
    }

    for (const preferredPort of request.preferredPorts) {
      if (!inRange(preferredPort, request.range) || unavailable(request, preferredPort)) continue;
      if (await probe({ host: request.host, transport: request.transport, port: preferredPort })) {
        const resolution = request.policy === "automatic" ? "automatic" : "preferred";
        resolved.push(allocationFor(request, preferredPort, resolution));
        break;
      }
    }
    if (resolved.some((entry) => entry.ownerType === request.ownerType && entry.ownerId === request.ownerId && entry.endpointId === request.endpointId)) {
      continue;
    }

    const rangeStart = request.range?.start ?? DEFAULT_DYNAMIC_PORT_START;
    const rangeEnd = request.range?.end ?? 65535;
    const preferredAnchor = request.policy === "preferred"
      ? request.preferredPorts.find((port) => port >= rangeStart && port <= rangeEnd) ?? null
      : null;
    const candidateRanges = preferredAnchor
      ? [
          { start: preferredAnchor + 1, end: rangeEnd },
          { start: rangeStart, end: preferredAnchor - 1 },
        ]
      : [{ start: rangeStart, end: rangeEnd }];
    let selected: number | null = null;
    for (const candidateRange of candidateRanges) {
      for (let port = candidateRange.start; port <= candidateRange.end; port += 1) {
        if (unavailable(request, port)) continue;
        if (await probe({ host: request.host, transport: request.transport, port })) {
          selected = port;
          break;
        }
      }
      if (selected) break;
    }
    if (!selected) {
      throw new RuntimeEndpointAllocationError(
        "endpoint_allocation_exhausted",
        request,
        `No available port remains for ${request.ownerId}.${request.endpointId}${request.range ? ` in ${request.range.start}-${request.range.end}` : ""}.`,
      );
    }
    resolved.push(allocationFor(
      request,
      selected,
      request.policy === "automatic" ? "automatic" : "renegotiated",
    ));
  }
  return resolved.sort((left, right) => left.ownerType.localeCompare(right.ownerType) || left.ownerId.localeCompare(right.ownerId) || left.endpointId.localeCompare(right.endpointId));
}

function toLegacyReservations(plan: RuntimeEndpointAllocationPlan): PortReservationInput[] {
  return plan.endpoints.map((endpoint) => ({
    host: endpoint.host,
    port: endpoint.port,
    kind: endpoint.ownerType === "runtime" ? "api" : endpoint.policy === "fixed" ? "service-fixed" : "service-negotiated",
    ownerId: endpoint.ownerId,
    portName: endpoint.endpointId,
  }));
}

export async function planAndReserveRuntimeEndpoints(
  options: PlanRuntimeEndpointAllocationOptions,
): Promise<RuntimeEndpointAllocationPlan> {
  const requests = await buildRequests(options);
  const release = await acquireHostAllocationLock();
  try {
    const ownerInspection = await inspectProcess(process.pid);
    if (ownerInspection.status !== "running") {
      throw new Error(`Cannot verify endpoint allocation owner: ${ownerInspection.reason}.`);
    }
    const registry = await readHostRegistry();
    const retained = await activeHostAllocations(registry);
    const endpoints = await allocateRequests(requests, retained, options.probePort);
    const now = (options.now ?? new Date()).toISOString();
    const plan: RuntimeEndpointAllocationPlan = {
      version: 1,
      allocationId: randomUUID(),
      laneId: options.laneId,
      generationId: options.generationId ?? null,
      servicesRoot: path.resolve(options.servicesRoot),
      workspaceRoot: path.resolve(options.workspaceRoot),
      phase: "reserved",
      attempt: options.attempt ?? 1,
      createdAt: now,
      updatedAt: now,
      endpoints,
    };
    const hostEntries: HostEndpointAllocation[] = endpoints.map((endpoint) => ({
      ...endpoint,
      allocationId: plan.allocationId,
      laneId: plan.laneId,
      generationId: plan.generationId,
      workspaceRoot: plan.workspaceRoot,
      reservationIdentity: ownerInspection.identity,
      reservedAt: now,
      updatedAt: now,
    }));
    await atomicWriteJson(getHostEndpointAllocationRegistryPath(), {
      version: 1,
      updatedAt: now,
      allocations: [...retained, ...hostEntries],
    } satisfies HostEndpointAllocationRegistry);
    await writeWorkspaceAllocationPlan(options.workspaceRoot, plan);
    await reconcilePortReservationLedger(
      options.workspaceRoot,
      toLegacyReservations(plan),
      "not present in authoritative endpoint allocation",
      now,
    );
    return plan;
  } finally {
    await release();
  }
}

export async function releaseRuntimeEndpointAllocation(plan: RuntimeEndpointAllocationPlan): Promise<void> {
  const release = await acquireHostAllocationLock();
  try {
    const registry = await readHostRegistry();
    const now = new Date().toISOString();
    await atomicWriteJson(getHostEndpointAllocationRegistryPath(), {
      version: 1,
      updatedAt: now,
      allocations: registry.allocations.filter((entry) => entry.allocationId !== plan.allocationId),
    } satisfies HostEndpointAllocationRegistry);
    await writeWorkspaceAllocationPlan(plan.workspaceRoot, {
      ...plan,
      phase: "released",
      updatedAt: now,
    });
    await reconcilePortReservationLedger(
      plan.workspaceRoot,
      [],
      "runtime endpoint allocation released",
      now,
    );
  } finally {
    await release();
  }
}

function normalizePlanPayload(value: unknown): RuntimeEndpointAllocationPlan | null {
  if (!isRecord(value) || !Array.isArray(value.endpoints)) return null;
  if (
    typeof value.allocationId !== "string" ||
    typeof value.laneId !== "string" ||
    typeof value.servicesRoot !== "string" ||
    typeof value.workspaceRoot !== "string" ||
    (value.phase !== "reserved" && value.phase !== "released")
  ) return null;
  const endpoints = value.endpoints.flatMap((entry) => {
    const normalized = normalizeResolvedEndpoint(entry);
    return normalized ? [normalized] : [];
  });
  return {
    version: 1,
    allocationId: value.allocationId,
    laneId: value.laneId,
    generationId: typeof value.generationId === "string" ? value.generationId : null,
    servicesRoot: path.resolve(value.servicesRoot),
    workspaceRoot: path.resolve(value.workspaceRoot),
    phase: value.phase,
    attempt: typeof value.attempt === "number" && Number.isInteger(value.attempt) ? value.attempt : 1,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date(0).toISOString(),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date(0).toISOString(),
    endpoints,
  };
}

function serializeAllocationPlan(workspaceRoot: string, plan: RuntimeEndpointAllocationPlan): unknown {
  const canonicalWorkspaceRoot = path.resolve(workspaceRoot);
  return {
    schemaVersion: ENDPOINT_ALLOCATION_SCHEMA_V2,
    version: 2,
    workspaceId: resolveWorkspaceProcessId(canonicalWorkspaceRoot),
    canonicalWorkspaceRoot,
    allocationId: plan.allocationId,
    laneId: plan.laneId,
    generationId: plan.generationId,
    servicesRoot: plan.servicesRoot,
    workspaceRoot: plan.workspaceRoot,
    phase: plan.phase,
    attempt: plan.attempt,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
    endpoints: plan.endpoints,
  };
}

function parseCurrentAllocationPlan(workspaceRoot: string, value: unknown): RuntimeEndpointAllocationPlan | null {
  const canonicalWorkspaceRoot = path.resolve(workspaceRoot);
  if (
    !isRecord(value)
    || value.schemaVersion !== ENDPOINT_ALLOCATION_SCHEMA_V2
    || value.version !== 2
    || typeof value.workspaceId !== "string"
    || value.workspaceId !== resolveWorkspaceProcessId(canonicalWorkspaceRoot)
    || typeof value.canonicalWorkspaceRoot !== "string"
    || !samePath(value.canonicalWorkspaceRoot, canonicalWorkspaceRoot)
  ) {
    return null;
  }
  const plan = normalizePlanPayload(value);
  if (!plan || !samePath(plan.workspaceRoot, workspaceRoot)) return null;
  return plan;
}

function parseLegacyAllocationPlan(workspaceRoot: string, value: unknown): RuntimeEndpointAllocationPlan | null {
  if (!isRecord(value) || value.version !== 1) return null;
  const plan = normalizePlanPayload(value);
  if (!plan || !samePath(plan.workspaceRoot, workspaceRoot)) return null;
  return plan;
}

async function writeWorkspaceAllocationPlan(
  workspaceRoot: string,
  plan: RuntimeEndpointAllocationPlan,
): Promise<void> {
  await writeLifecycleDocument(workspaceRoot, ENDPOINT_ALLOCATION_POLICY, plan, {
    parseCurrent: (value) => parseCurrentAllocationPlan(workspaceRoot, value),
    parseLegacy: (value) => parseLegacyAllocationPlan(workspaceRoot, value),
    serialize: (document) => serializeAllocationPlan(workspaceRoot, document),
  });
}

export async function readRuntimeEndpointAllocationPlan(workspaceRoot: string): Promise<RuntimeEndpointAllocationPlan | null> {
  const result = await readLifecycleDocument(workspaceRoot, ENDPOINT_ALLOCATION_POLICY, {
    parseCurrent: (value) => parseCurrentAllocationPlan(workspaceRoot, value),
    parseLegacy: (value) => parseLegacyAllocationPlan(workspaceRoot, value),
    serialize: (document) => serializeAllocationPlan(workspaceRoot, document),
  });
  return result.document;
}

export function servicePortsFromEndpointAllocation(
  plan: RuntimeEndpointAllocationPlan,
): Record<string, Record<string, number>> {
  const ports: Record<string, Record<string, number>> = {};
  for (const endpoint of plan.endpoints) {
    if (endpoint.ownerType !== "service") continue;
    ports[endpoint.ownerId] ??= {};
    ports[endpoint.ownerId][endpoint.endpointId] = endpoint.port;
  }
  return ports;
}

export function runtimeApiEndpointFromAllocation(plan: RuntimeEndpointAllocationPlan): RuntimeResolvedEndpointAllocation {
  const endpoint = plan.endpoints.find((entry) => entry.ownerType === "runtime" && entry.ownerId === "runtime-api");
  if (!endpoint) throw new Error(`Endpoint allocation ${plan.allocationId} does not include the runtime API.`);
  return endpoint;
}
