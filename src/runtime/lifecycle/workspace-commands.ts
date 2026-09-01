import path from "node:path";
import type { RuntimeInstanceRecord } from "../../contracts/api.js";
import { startRuntimeApp } from "../app.js";
import { ensureRuntimeConfig, resolveRuntimeConfig, type RuntimeConfig } from "../config.js";
import {
  markRuntimeInstanceStopped,
  readRuntimeInstanceState,
} from "../instance/registry.js";
import { getServiceRuntimeLogPaths } from "../operator/logs.js";
import type { ProcessIdentityClassification } from "../process/identity.js";
import {
  classifyRegisteredProcess,
  findProcessOwnership,
  getProcessRegistryPath,
  readProcessOwnershipRegistry,
  transitionProcessOwnership,
  type ProcessOwnershipEntry,
} from "../process/registry.js";
import { terminateOwnedProcessTree } from "../process/tree.js";
import type { RuntimeEndpointAllocationPolicy } from "../ports/allocation.js";
import { withCrossProcessFileLock } from "../security/cross-process-file-lock.js";
import {
  hasRegisteredRuntimeShutdown,
  invokeRegisteredRuntimeShutdown,
} from "./runtime-shutdown.js";

export const WORKSPACE_LIFECYCLE_SCHEMA = "service-lasso.workspace-lifecycle.v1";
const COMMAND_LOCK_FILE_NAME = "workspace-command.lock";
const COMMAND_LOCK_TIMEOUT_MS = 120_000;
const COMMAND_LOCK_STALE_MS = 5 * 60_000;
const API_PROBE_TIMEOUT_MS = 2_000;
const ONLINE_SHUTDOWN_WAIT_MS = 30_000;
const TREE_STOP_TIMEOUT_MS = process.platform === "win32" ? 15_000 : 5_000;

export type WorkspaceLifecycleAction = "start" | "stop" | "restart";
export type WorkspaceLifecycleOutcome =
  | "already_running"
  | "started"
  | "already_stopped"
  | "stopped"
  | "restarted"
  | "blocked";
export type WorkspaceLifecycleStopMode = "online" | "offline" | "in_process" | "none";
export type WorkspaceLifecycleHealth = "healthy" | "stopped" | "degraded" | "unknown";

export interface WorkspaceLifecycleEndpoint {
  name: string;
  url: string;
}

export interface WorkspaceLifecycleBaselineService {
  serviceId: string;
  status: "completed" | "skipped";
}

/**
 * Stable JSON contract for `service-lasso start|stop|restart` automation.
 */
export interface WorkspaceLifecycleResult {
  schema: typeof WORKSPACE_LIFECYCLE_SCHEMA;
  action: WorkspaceLifecycleAction;
  outcome: WorkspaceLifecycleOutcome;
  ok: boolean;
  status: "completed" | "blocked";
  workspaceRoot: string;
  servicesRoot: string;
  ownership: ProcessIdentityClassification | "unverified";
  stopMode: WorkspaceLifecycleStopMode;
  apiReachable: boolean;
  instanceId: string | null;
  generationId: string | null;
  ownerPid: number | null;
  apiUrl: string | null;
  apiPort: number | null;
  stoppedServices: string[];
  startedServices: string[];
  endpoints: WorkspaceLifecycleEndpoint[];
  health: WorkspaceLifecycleHealth;
  blockers: string[];
  logPaths: string[];
  requestedServiceIds: string[];
  serviceOrder: string[];
  services: WorkspaceLifecycleBaselineService[];
}

export interface WorkspaceLifecycleCommandOptions {
  action: WorkspaceLifecycleAction;
  servicesRoot?: string;
  workspaceRoot?: string;
  port?: number;
  portPolicy?: RuntimeEndpointAllocationPolicy;
  version?: string;
  /**
   * When true, `start` and `restart` run CLI baseline bootstrap.
   * Library callers and tests leave this false to avoid the default service set.
   */
  includeBaseline?: boolean;
}

/**
 * Host-wide command lock path for one workspace.
 */
export function getWorkspaceCommandLockPath(workspaceRoot: string): string {
  return path.join(path.resolve(workspaceRoot), ".service-lasso", COMMAND_LOCK_FILE_NAME);
}

/**
 * Serialises start/stop/restart for one workspace across CLI, demo, and HTTP callers.
 */
export async function withWorkspaceCommandLock<T>(
  workspaceRoot: string,
  work: () => Promise<T>,
): Promise<T> {
  return await withCrossProcessFileLock(
    getWorkspaceCommandLockPath(workspaceRoot),
    work,
    {
      timeoutMs: COMMAND_LOCK_TIMEOUT_MS,
      staleMs: COMMAND_LOCK_STALE_MS,
      unavailableMessage: "Timed out waiting for the workspace lifecycle command lock.",
    },
  );
}

/**
 * Runs one workspace-scoped start, stop, or restart command.
 */
export async function runWorkspaceLifecycleCommand(
  options: WorkspaceLifecycleCommandOptions,
): Promise<WorkspaceLifecycleResult> {
  const config = await ensureRuntimeConfig(resolveRuntimeConfig(options));
  return await withWorkspaceCommandLock(config.workspaceRoot, async () => {
    if (options.action === "stop") {
      return await stopWorkspaceRuntimeLocked(config, "stop");
    }
    if (options.action === "restart") {
      const stopped = await stopWorkspaceRuntimeLocked(config, "restart");
      if (!stopped.ok) {
        return stopped;
      }
      const started = await startWorkspaceRuntimeLocked(config, options);
      if (!started.ok) {
        return {
          ...started,
          action: "restart",
        };
      }
      return {
        ...started,
        action: "restart",
        outcome: "restarted",
        stopMode: stopped.stopMode,
        stoppedServices: stopped.stoppedServices,
        blockers: uniqueStrings([...stopped.blockers, ...started.blockers]),
        logPaths: uniqueStrings([...stopped.logPaths, ...started.logPaths]),
      };
    }
    return await startWorkspaceRuntimeLocked(config, options);
  });
}

async function startWorkspaceRuntimeLocked(
  config: RuntimeConfig,
  options: WorkspaceLifecycleCommandOptions,
): Promise<WorkspaceLifecycleResult> {
  const instance = await readRuntimeInstanceState(config);
  const runtimeOwnership = await classifyRuntimeOwnership(config, instance);
  const apiReachable = instance ? await probeRuntimeApi(instance.apiUrl) : false;

  if (runtimeOwnership === "identity_mismatch" || runtimeOwnership === "unknown_owner") {
    return buildResult({
      action: "start",
      outcome: "blocked",
      ok: false,
      config,
      instance,
      ownership: runtimeOwnership,
      stopMode: "none",
      apiReachable,
      startedServices: [],
      stoppedServices: [],
      health: "degraded",
      blockers: [`runtime:${runtimeOwnership}`],
    });
  }

  if (runtimeOwnership === "owned" && apiReachable) {
    const runningServices = await listOwnedRunningServiceIds(config.workspaceRoot);
    return buildResult({
      action: "start",
      outcome: "already_running",
      ok: true,
      config,
      instance,
      ownership: "owned",
      stopMode: "none",
      apiReachable: true,
      startedServices: runningServices,
      stoppedServices: [],
      health: "healthy",
      blockers: [],
    });
  }

  const app = await startRuntimeApp({
    servicesRoot: config.servicesRoot,
    workspaceRoot: config.workspaceRoot,
    version: config.version,
    port: options.port,
    portPolicy: options.portPolicy,
    baselineBootstrap: options.includeBaseline === true ? {} : undefined,
  });
  const startedInstance = await readRuntimeInstanceState(config);
  const baseline = app.apiServer.baselineBootstrap;
  const startedServices = baseline
    ? baseline.services
      .filter(
        (service) =>
          service.status === "completed" &&
          service.actions.some((action) => action.action === "start" && action.status === "completed"),
      )
      .map((service) => service.serviceId)
    : await listOwnedRunningServiceIds(config.workspaceRoot);

  return buildResult({
    action: "start",
    outcome: "started",
    ok: true,
    config,
    instance: startedInstance,
    ownership: "owned",
    stopMode: "none",
    apiReachable: true,
    startedServices,
    stoppedServices: [],
    health: "healthy",
    blockers: [],
    requestedServiceIds: baseline?.requestedServiceIds ?? [],
    serviceOrder: baseline?.serviceOrder ?? [],
    services: (baseline?.services ?? []).map((service) => ({
      serviceId: service.serviceId,
      status: service.status,
    })),
  });
}

async function stopWorkspaceRuntimeLocked(
  config: RuntimeConfig,
  action: "stop" | "restart",
): Promise<WorkspaceLifecycleResult> {
  const instance = await readRuntimeInstanceState(config);
  const runtimeOwnership = await classifyRuntimeOwnership(config, instance);
  const apiReachable = instance ? await probeRuntimeApi(instance.apiUrl) : false;

  if (!instance || runtimeOwnership === "not_running") {
    const leftover = await stopVerifiedOwnedTrees(config.workspaceRoot);
    await markRuntimeInstanceStopped(config);
    return buildResult({
      action,
      outcome: "already_stopped",
      ok: true,
      config,
      instance,
      ownership: "not_running",
      stopMode: leftover.stoppedServices.length > 0 ? "offline" : "none",
      apiReachable: false,
      startedServices: [],
      stoppedServices: leftover.stoppedServices,
      health: "stopped",
      blockers: leftover.blockers,
    });
  }

  if (hasRegisteredRuntimeShutdown(config.workspaceRoot)) {
    const runningBefore = await listOwnedRunningServiceIds(config.workspaceRoot);
    await invokeRegisteredRuntimeShutdown(config.workspaceRoot);
    const leftover = await stopVerifiedOwnedTrees(config.workspaceRoot, { includeRuntime: false });
    await markRuntimeInstanceStopped(config, instance.generationId);
    return buildResult({
      action,
      outcome: "stopped",
      ok: leftover.blockers.length === 0,
      config,
      instance: { ...instance, phase: "stopped", status: "stale" },
      ownership: "not_running",
      stopMode: "in_process",
      apiReachable: false,
      startedServices: [],
      stoppedServices: uniqueStrings([...runningBefore, ...leftover.stoppedServices]),
      health: leftover.blockers.length === 0 ? "stopped" : "degraded",
      blockers: leftover.blockers,
    });
  }

  if (apiReachable && instance.apiUrl) {
    const runningBefore = await listOwnedRunningServiceIds(config.workspaceRoot);
    const shutdown = await requestOnlineRuntimeShutdown(instance.apiUrl);
    if (!shutdown.ok) {
      return buildResult({
        action,
        outcome: "blocked",
        ok: false,
        config,
        instance,
        ownership: runtimeOwnership,
        stopMode: "online",
        apiReachable: true,
        startedServices: [],
        stoppedServices: [],
        health: "degraded",
        blockers: [shutdown.reason],
      });
    }
    await waitUntilApiUnavailable(instance.apiUrl, ONLINE_SHUTDOWN_WAIT_MS);
    const leftover = await stopVerifiedOwnedTrees(config.workspaceRoot, { includeRuntime: false });
    await markRuntimeInstanceStopped(config, instance.generationId);
    return buildResult({
      action,
      outcome: "stopped",
      ok: leftover.blockers.length === 0,
      config,
      instance: { ...instance, phase: "stopped", status: "stale" },
      ownership: "not_running",
      stopMode: "online",
      apiReachable: false,
      startedServices: [],
      stoppedServices: uniqueStrings([...runningBefore, ...leftover.stoppedServices]),
      health: leftover.blockers.length === 0 ? "stopped" : "degraded",
      blockers: leftover.blockers,
    });
  }

  const offline = await stopVerifiedOwnedTrees(config.workspaceRoot);
  await markRuntimeInstanceStopped(config, instance.generationId);
  const runtimeBlocked = runtimeOwnership === "identity_mismatch" || runtimeOwnership === "unknown_owner";
  return buildResult({
    action,
    outcome: runtimeBlocked ? "blocked" : "stopped",
    ok: !runtimeBlocked,
    config,
    instance: { ...instance, phase: "stopped", status: "stale" },
    ownership: runtimeBlocked ? runtimeOwnership : "not_running",
    stopMode: "offline",
    apiReachable: false,
    startedServices: [],
    stoppedServices: offline.stoppedServices,
    health: runtimeBlocked || offline.blockers.length > 0 ? "degraded" : "stopped",
    blockers: offline.blockers,
  });
}

async function classifyRuntimeOwnership(
  config: RuntimeConfig,
  instance: RuntimeInstanceRecord | null,
): Promise<ProcessIdentityClassification> {
  if (!instance) {
    return "not_running";
  }
  const entry = await findProcessOwnership(config.workspaceRoot, "runtime", instance.instanceId);
  if (!entry) {
    return instance.pid ? "unknown_owner" : "not_running";
  }
  return await classifyRegisteredProcess(entry);
}

async function listOwnedRunningServiceIds(workspaceRoot: string): Promise<string[]> {
  const registry = await readProcessOwnershipRegistry(workspaceRoot);
  const running: string[] = [];
  for (const entry of registry.entries) {
    if (entry.ownerType !== "service" || entry.lifecycleState === "stopped") {
      continue;
    }
    const classification = await classifyRegisteredProcess(entry);
    if (classification === "owned") {
      running.push(entry.serviceId ?? entry.ownerId);
    }
  }
  return running.sort();
}

/**
 * Stops only verified owned process trees. Mismatched and unverifiable PIDs are
 * reported as blockers and never signalled.
 */
async function stopVerifiedOwnedTrees(
  workspaceRoot: string,
  options: { includeRuntime?: boolean } = {},
): Promise<{ stoppedServices: string[]; blockers: string[] }> {
  const includeRuntime = options.includeRuntime !== false;
  const registry = await readProcessOwnershipRegistry(workspaceRoot);
  const stoppedServices: string[] = [];
  const blockers: string[] = [];

  for (const entry of registry.entries) {
    if (!includeRuntime && entry.ownerType === "runtime") {
      continue;
    }
    const label = entryLabel(entry);
    const classification = await classifyRegisteredProcess(entry);
    if (classification === "not_running") {
      if (entry.lifecycleState !== "stopped" || entry.pid !== null) {
        await transitionProcessOwnership(
          workspaceRoot,
          entry.ownerType,
          entry.ownerId,
          "stopped",
          "not_running",
        );
      }
      continue;
    }
    if (classification !== "owned" || entry.pid === null || entry.identity === null) {
      blockers.push(`${label}:${classification === "owned" ? "unverified" : classification}`);
      continue;
    }
    if (entry.pid === process.pid) {
      blockers.push(`${label}:refuses_self_pid`);
      continue;
    }
    try {
      await terminateOwnedProcessTree(
        {
          rootPid: entry.pid,
          rootIdentity: entry.identity,
          processGroup: entry.processGroup,
        },
        TREE_STOP_TIMEOUT_MS,
      );
      await transitionProcessOwnership(
        workspaceRoot,
        entry.ownerType,
        entry.ownerId,
        "stopped",
        "not_running",
      );
      if (entry.ownerType === "service") {
        stoppedServices.push(entry.serviceId ?? entry.ownerId);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "terminate_failed";
      blockers.push(`${label}:${detail}`);
    }
  }

  return {
    stoppedServices: uniqueStrings(stoppedServices),
    blockers: uniqueStrings(blockers),
  };
}

async function requestOnlineRuntimeShutdown(
  apiUrl: string,
): Promise<{ ok: boolean; reason: string }> {
  try {
    const response = await fetch(new URL("/api/runtime/actions/shutdown", apiUrlWithSlash(apiUrl)), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: true }),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) {
      return { ok: true, reason: "shutdown_accepted" };
    }
    return { ok: false, reason: `http_${response.status}` };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "shutdown_request_failed";
    return { ok: false, reason: detail };
  }
}

async function probeRuntimeApi(apiUrl: string): Promise<boolean> {
  try {
    const response = await fetch(new URL("/api/health", apiUrlWithSlash(apiUrl)), {
      method: "GET",
      signal: AbortSignal.timeout(API_PROBE_TIMEOUT_MS),
    });
    if (!response.ok) {
      return false;
    }
    const payload: unknown = await response.json();
    return isHealthOk(payload);
  } catch {
    return false;
  }
}

async function waitUntilApiUnavailable(apiUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!await probeRuntimeApi(apiUrl)) {
      return;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });
  }
}

function isHealthOk(payload: unknown): boolean {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return false;
  }
  const record: { status?: unknown; api?: { status?: unknown } } = payload;
  return record.status === "ok" && (record.api === undefined || record.api.status === "up");
}

function apiUrlWithSlash(apiUrl: string): string {
  return apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`;
}

function entryLabel(entry: ProcessOwnershipEntry): string {
  if (entry.ownerType === "runtime") {
    return "runtime";
  }
  return entry.serviceId ?? entry.ownerId;
}

async function collectLogPaths(workspaceRoot: string, servicesRoot: string): Promise<string[]> {
  const registry = await readProcessOwnershipRegistry(workspaceRoot);
  const paths = [
    getProcessRegistryPath(workspaceRoot),
    path.join(workspaceRoot, ".service-lasso", "audit", "runtime"),
    path.join(servicesRoot),
  ];
  for (const entry of registry.entries) {
    if (entry.ownerType === "service" && entry.ownerRoot) {
      paths.push(getServiceRuntimeLogPaths(entry.ownerRoot).logPath);
    }
  }
  return uniqueStrings(paths);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

async function buildResult(input: {
  action: WorkspaceLifecycleAction;
  outcome: WorkspaceLifecycleOutcome;
  ok: boolean;
  config: RuntimeConfig;
  instance: RuntimeInstanceRecord | null;
  ownership: ProcessIdentityClassification | "unverified";
  stopMode: WorkspaceLifecycleStopMode;
  apiReachable: boolean;
  startedServices: string[];
  stoppedServices: string[];
  health: WorkspaceLifecycleHealth;
  blockers: string[];
  requestedServiceIds?: string[];
  serviceOrder?: string[];
  services?: WorkspaceLifecycleBaselineService[];
}): Promise<WorkspaceLifecycleResult> {
  const endpoints: WorkspaceLifecycleEndpoint[] = [];
  if (input.instance?.apiUrl) {
    endpoints.push({ name: "api", url: input.instance.apiUrl });
  }
  const logPaths = await collectLogPaths(input.config.workspaceRoot, input.config.servicesRoot);
  return {
    schema: WORKSPACE_LIFECYCLE_SCHEMA,
    action: input.action,
    outcome: input.outcome,
    ok: input.ok,
    status: input.ok ? "completed" : "blocked",
    workspaceRoot: input.config.workspaceRoot,
    servicesRoot: input.config.servicesRoot,
    ownership: input.ownership,
    stopMode: input.stopMode,
    apiReachable: input.apiReachable,
    instanceId: input.instance?.instanceId ?? null,
    generationId: input.instance?.generationId ?? null,
    ownerPid: input.instance?.pid ?? null,
    apiUrl: input.instance?.apiUrl ?? null,
    apiPort: input.instance?.apiPort ?? null,
    stoppedServices: uniqueStrings(input.stoppedServices),
    startedServices: uniqueStrings(input.startedServices),
    endpoints,
    health: input.health,
    blockers: uniqueStrings(input.blockers),
    logPaths,
    requestedServiceIds: input.requestedServiceIds ?? [],
    serviceOrder: input.serviceOrder ?? [],
    services: input.services ?? [],
  };
}
