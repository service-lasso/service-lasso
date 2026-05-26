import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { once } from "node:events";
import { cp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHealthResponse } from "./routes/health.js";
import { createServicesResponse } from "./routes/services.js";
import { createDependenciesResponse } from "./routes/dependencies.js";
import { createRuntimeCapabilitiesResponse, createRuntimeSummaryResponse } from "./routes/runtime.js";
import { createServiceHealthResponse } from "./routes/service-health.js";
import { createServiceLogsResponse } from "./routes/logs.js";
import { createServiceLogChunkResponse, createServiceLogInfoResponse } from "./routes/log-reader.js";
import { createServiceMetricsResponse } from "./routes/metrics.js";
import { createServiceVariablesResponse } from "./routes/variables.js";
import { createServiceNetworkResponse } from "./routes/network.js";
import { createGlobalEnvResponse } from "./routes/globalenv.js";
import { createServiceMetaResponse, createServicesMetaResponse } from "./routes/service-meta.js";
import {
  createDashboardServiceDetailResponse,
  createDashboardServicesResponse,
  createDashboardSummaryResponse,
} from "./routes/dashboard.js";
import { discoverServices } from "../runtime/discovery/discoverServices.js";
import { DependencyGraph, createServiceRegistry } from "../runtime/manager/DependencyGraph.js";
import {
  configService,
  installService,
  restartService,
  startService,
  stopService,
} from "../runtime/lifecycle/actions.js";
import { getLifecycleState } from "../runtime/lifecycle/store.js";
import { evaluateServiceHealth } from "../runtime/health/evaluateHealth.js";
import { getServiceStatePaths } from "../runtime/state/paths.js";
import { buildPersistedServiceMeta, writeServiceMeta } from "../runtime/state/meta.js";
import { writeServiceState } from "../runtime/state/writeState.js";
import {
  buildServiceLogInfo,
  buildServiceLogs,
  getServiceRuntimeLogPaths,
  readServiceLogChunk,
} from "../runtime/operator/logs.js";
import { buildDashboardService, buildDashboardSummary } from "../runtime/operator/dashboard.js";
import { buildServiceMetrics } from "../runtime/operator/metrics.js";
import { buildServiceVariables, collectRuntimeGlobalEnv } from "../runtime/operator/variables.js";
import { buildServiceNetwork } from "../runtime/operator/network.js";
import { resolveProviderExecution } from "../runtime/providers/resolveProvider.js";
import { ensureRuntimeConfig, resolveRuntimeConfig, type RuntimeConfig } from "../runtime/config.js";
import { rehydrateDiscoveredServices } from "../runtime/state/rehydrate.js";
import { stopAllManagedProcesses } from "../runtime/execution/supervisor.js";
import { runAndRecordDoctorPreflight } from "../runtime/recovery/doctor.js";
import { readServiceRecoveryHistory } from "../runtime/recovery/history.js";
import { listSetupStepIds, runServiceSetup } from "../runtime/setup/steps.js";
import { createRuntimeServiceMonitor, type RuntimeServiceMonitor } from "../runtime/recovery/monitor.js";
import { readServiceUpdateState } from "../runtime/updates/state.js";
import { createRuntimeUpdateScheduler, type RuntimeUpdateScheduler } from "../runtime/updates/scheduler.js";
import {
  exampleWorkflowPackageCatalog,
  listWorkflowPackagesSecretSafe,
  loadWorkflowCatalogFromDirectories,
  validateWorkflowCatalogEntries,
  type WorkflowCatalogEntry,
  type WorkflowPackageSourceKind,
} from "../platform/workflowCatalog.js";
import {
  activateWorkflowRepoSources,
  readWorkflowRepoSyncState,
  rollbackWorkflowRepoActivation,
  type WorkflowRepoSource,
} from "../platform/workflowSyncController.js";
import {
  checkServiceUpdatesForCli,
  downloadServiceUpdateCandidate,
  installServiceUpdateCandidate,
  listServiceUpdateStates,
} from "../runtime/updates/actions.js";
import {
  assertWorkflowRunFacadeSecretSafe,
  cancelWorkflowFacadeRun,
  exampleWorkflowRunFacadeState,
  getWorkflowFacadeDefinition,
  getWorkflowFacadeRun,
  listWorkflowFacadeDefinitions,
  retryWorkflowFacadeRun,
  startWorkflowFacadeRun,
  type WorkflowFacadeErrorCode,
  type WorkflowFacadeRun,
  type WorkflowRunFacadeState,
} from "../platform/workflowRunFacade.js";
import type { PlatformEntitlement, PlatformRequestContext } from "../platform/facade.js";
import { ApiError, toApiErrorBody } from "./errors.js";
import type {
  DashboardServiceResponse,
  LifecycleActionResponse,
  RuntimeOrchestrationResponse,
  ServiceDetailResponse,
  ServicesMetaResponse,
  ServiceSummary,
} from "../contracts/api.js";

export interface ApiServerOptions {
  port?: number;
  version?: string;
  servicesRoot?: string;
  workspaceRoot?: string;
  autostart?: boolean;
  monitor?: boolean;
  monitorIntervalMs?: number;
  updateScheduler?: boolean;
  updateSchedulerIntervalMs?: number;
  workflowRunFacadeState?: WorkflowRunFacadeState;
}

interface ApiRouteConfig extends RuntimeConfig {
  features: {
    autostart: boolean;
    monitor: boolean;
    updateScheduler: boolean;
  };
}

export interface RunningApiServer {
  server: Server;
  port: number;
  url: string;
  monitor: RuntimeServiceMonitor | null;
  updateScheduler: RuntimeUpdateScheduler | null;
  stop: () => Promise<void>;
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body, null, 2));
}

function notFound(response: ServerResponse): void {
  writeJson(response, 404, {
    error: "not_found",
    message: "Route not found.",
    statusCode: 404,
  });
}

function cloneWorkflowRunFacadeState(state: WorkflowRunFacadeState): WorkflowRunFacadeState {
  return JSON.parse(JSON.stringify(state)) as WorkflowRunFacadeState;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const body = Buffer.concat(chunks).toString("utf8").trim();
  if (body.length === 0) {
    return {};
  }

  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new ApiError("invalid_json", 400, "Request body must be valid JSON.");
  }
}

function parseServiceMetaPatch(
  input: unknown,
): { favorite?: boolean; dependencyGraphPosition?: { x: number; y: number } | null } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ApiError("invalid_body", 400, "Service meta patch must be a JSON object.");
  }

  const candidate = input as Record<string, unknown>;
  const patch: { favorite?: boolean; dependencyGraphPosition?: { x: number; y: number } | null } = {};

  if ("favorite" in candidate) {
    if (typeof candidate.favorite !== "boolean") {
      throw new ApiError("invalid_body", 400, "\"favorite\" must be a boolean.");
    }
    patch.favorite = candidate.favorite;
  }

  if ("dependencyGraphPosition" in candidate) {
    if (candidate.dependencyGraphPosition === null) {
      patch.dependencyGraphPosition = null;
    } else if (
      candidate.dependencyGraphPosition &&
      typeof candidate.dependencyGraphPosition === "object" &&
      !Array.isArray(candidate.dependencyGraphPosition)
    ) {
      const position = candidate.dependencyGraphPosition as Record<string, unknown>;
      if (typeof position.x !== "number" || typeof position.y !== "number") {
        throw new ApiError("invalid_body", 400, "\"dependencyGraphPosition\" must contain numeric x/y values.");
      }
      patch.dependencyGraphPosition = { x: position.x, y: position.y };
    } else {
      throw new ApiError(
        "invalid_body",
        400,
        "\"dependencyGraphPosition\" must be null or an object with numeric x/y values.",
      );
    }
  }

  if (!("favorite" in patch) && !("dependencyGraphPosition" in patch)) {
    throw new ApiError("invalid_body", 400, "Service meta patch must include \"favorite\" and/or \"dependencyGraphPosition\".");
  }

  return patch;
}

function parseUpdateCheckBody(input: unknown): { serviceId?: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ApiError("invalid_body", 400, "Update check body must be a JSON object.");
  }

  const candidate = input as Record<string, unknown>;
  if (candidate.serviceId !== undefined && typeof candidate.serviceId !== "string") {
    throw new ApiError("invalid_body", 400, "\"serviceId\" must be a string when present.");
  }

  return {
    serviceId: typeof candidate.serviceId === "string" ? candidate.serviceId : undefined,
  };
}

function parseUpdateInstallBody(input: unknown): { force?: boolean } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ApiError("invalid_body", 400, "Update install body must be a JSON object.");
  }

  const candidate = input as Record<string, unknown>;
  if (candidate.force !== undefined && typeof candidate.force !== "boolean") {
    throw new ApiError("invalid_body", 400, "\"force\" must be a boolean when present.");
  }

  return {
    force: typeof candidate.force === "boolean" ? candidate.force : undefined,
  };
}

function parseWorkflowCatalogValidateBody(input: unknown): WorkflowCatalogEntry[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ApiError("invalid_body", 400, "Workflow package validation body must be a JSON object.");
  }

  const candidate = input as Record<string, unknown>;
  const rawEntries = Array.isArray(candidate.entries)
    ? candidate.entries
    : Array.isArray(candidate.packages)
      ? candidate.packages.map((metadata, index) => ({ metadata, metadataPath: `request.packages[${index}]` }))
      : candidate.metadata
        ? [{ metadata: candidate.metadata, metadataPath: "request.metadata" }]
        : undefined;

  if (!rawEntries) {
    throw new ApiError("invalid_body", 400, "Workflow package validation requires entries, packages, or metadata.");
  }

  return rawEntries.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ApiError("invalid_body", 400, `Workflow package entry ${index} must be a JSON object.`);
    }
    const record = entry as Record<string, unknown>;
    const metadata = "metadata" in record ? record.metadata : record;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      throw new ApiError("invalid_body", 400, `Workflow package entry ${index} must include metadata.`);
    }
    return {
      metadata: metadata as WorkflowCatalogEntry["metadata"],
      metadataPath: typeof record.metadataPath === "string" ? record.metadataPath : `request.entries[${index}]`,
    };
  });
}

function parseWorkflowRepoSourcesBody(input: unknown): WorkflowRepoSource[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ApiError("invalid_body", 400, "Workflow repo request body must be a JSON object.");
  }

  const sources = (input as Record<string, unknown>).sources;
  if (!Array.isArray(sources)) {
    throw new ApiError("invalid_body", 400, "Workflow repo request requires a sources array.");
  }

  return sources.map((source, index) => {
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      throw new ApiError("invalid_body", 400, `Workflow repo source ${index} must be a JSON object.`);
    }
    return source as WorkflowRepoSource;
  });
}

function workflowRepoWorkspaceRoot(config: RuntimeConfig): string {
  return path.join(config.workspaceRoot, "workflow-repos");
}

function workflowRepoStatePath(config: RuntimeConfig): string {
  return path.join(workflowRepoWorkspaceRoot(config), "state.json");
}

function resolveLocalWorkflowRepo(repo: string): string {
  if (repo.startsWith("file:")) {
    return fileURLToPath(repo);
  }
  if (path.isAbsolute(repo)) {
    return repo;
  }
  throw new ApiError(
    "unsupported_workflow_repo_source",
    400,
    "Workflow repo HTTP sync currently accepts local absolute paths or file:// sources only.",
  );
}

function countWorkflowPackageSources(packages: Array<{ source: WorkflowPackageSourceKind }>): Record<WorkflowPackageSourceKind, number> {
  return packages.reduce<Record<WorkflowPackageSourceKind, number>>(
    (counts, workflowPackage) => {
      counts[workflowPackage.source] += 1;
      return counts;
    },
    { official: 0, custom: 0 },
  );
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function parseEntitlements(request: IncomingMessage): PlatformEntitlement[] {
  const header = firstHeader(request.headers["x-service-lasso-entitlements"]);
  if (header === undefined) {
    return ["workspace:read", "secrets-broker-source:use", "secrets-broker:resolve", "workflow:run"];
  }

  return header
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean) as PlatformEntitlement[];
}

function createWorkflowPlatformContext(request: IncomingMessage, workspaceId: string): PlatformRequestContext {
  const contextWorkspaceId = firstHeader(request.headers["x-service-lasso-workspace-id"]) ?? workspaceId;
  const instanceId = firstHeader(request.headers["x-service-lasso-instance-id"]) ?? "inst_local_demo";
  const userId = firstHeader(request.headers["x-service-lasso-user-id"]) ?? "usr_01hzy9operator";
  const linkedIdentityId = firstHeader(request.headers["x-service-lasso-linked-identity-id"]) ?? "lid_zitadel_operator";

  return {
    userId,
    workspaceId: contextWorkspaceId,
    instanceId,
    linkedIdentityId,
    entitlements: parseEntitlements(request),
    actor: {
      kind: "user",
      id: userId,
      displayName: "Operator Example",
    },
    authMethod: "zitadel-session",
    audit: {
      actorKind: "user",
      actorId: userId,
      workspaceId: contextWorkspaceId,
      instanceId,
      linkedIdentityId,
      authMethod: "zitadel-session",
    },
  };
}

function workflowFacadeStatusCode(code: WorkflowFacadeErrorCode): number {
  if (code === "workflow-not-found" || code === "run-not-found") return 404;
  if (code === "invalid-transition") return 409;
  return 403;
}

function throwWorkflowFacadeError(result: { ok: false; error: { code: WorkflowFacadeErrorCode; message: string } }): never {
  throw new ApiError(result.error.code, workflowFacadeStatusCode(result.error.code), result.error.message);
}

function upsertWorkflowRun(state: WorkflowRunFacadeState, run: WorkflowFacadeRun): void {
  const index = state.runs.findIndex((candidate) => candidate.facadeRunId === run.facadeRunId);
  if (index === -1) {
    state.runs.push(run);
    return;
  }

  state.runs[index] = run;
}

async function parseStartWorkflowRunInput(request: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const body = await readJsonBody(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError("invalid_request", 400, "Workflow run start body must be a JSON object.");
  }

  const input = (body as { input?: unknown }).input;
  if (input === undefined) return undefined;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ApiError("invalid_request", 400, "Workflow run input must be an object when provided.");
  }

  return input as Record<string, unknown>;
}

async function loadRuntimeModel(servicesRoot: string) {
  const discovered = await discoverServices(servicesRoot);
  const registry = createServiceRegistry(discovered);
  const graph = new DependencyGraph(registry);

  return {
    servicesRoot,
    discovered,
    registry,
    graph,
  };
}

type RuntimeModel = Awaited<ReturnType<typeof loadRuntimeModel>>;

async function createServiceSummary(
  service: Awaited<ReturnType<typeof loadRuntimeModel>>["discovered"][number],
  graph: DependencyGraph,
  registry: Awaited<ReturnType<typeof loadRuntimeModel>>["registry"],
  sharedGlobalEnv: Record<string, string>,
): Promise<ServiceSummary> {
  const dependencySummary = graph.getServiceDependencies(service.manifest.id);
  const lifecycle = getLifecycleState(service.manifest.id);
  const resolvedPorts = Object.keys(lifecycle.runtime.ports).length > 0 ? lifecycle.runtime.ports : service.manifest.ports ?? {};
  const health = await evaluateServiceHealth(service.manifest, lifecycle, service.serviceRoot, service, sharedGlobalEnv);
  const runtimeLogs = getServiceRuntimeLogPaths(service.serviceRoot);
  const variables = buildServiceVariables(service, sharedGlobalEnv, resolvedPorts);
  const network = buildServiceNetwork(service, sharedGlobalEnv, resolvedPorts);
  const provider = resolveProviderExecution(service, registry);
  const updates = await readServiceUpdateState(service);
  const recovery = await readServiceRecoveryHistory(service);

  return {
    id: service.manifest.id,
    name: service.manifest.name,
    description: service.manifest.description,
    status: "discovered",
    source: "manifest",
    manifestPath: service.manifestPath,
    serviceRoot: service.serviceRoot,
    enabled: service.manifest.enabled !== false,
    version: service.manifest.version,
    dependencies: dependencySummary.dependencies,
    dependents: dependencySummary.dependents,
    lifecycle,
    health,
    updates,
    recovery,
    statePaths: getServiceStatePaths(service.serviceRoot),
    provider,
    operator: {
      logPath: lifecycle.runtime.logs.logPath ?? runtimeLogs.logPath,
      variableCount: variables.variables.length,
      endpointCount: network.endpoints.length,
    },
  };
}

function createServiceDetailResponse(service: ServiceSummary): ServiceDetailResponse {
  return {
    service,
  };
}

async function executeLifecycleAction(
  action: string,
  service: RuntimeModel["discovered"][number],
  registry: RuntimeModel["registry"],
): Promise<LifecycleActionResponse> {
  const result = await (async () => {
    switch (action) {
      case "install":
        return await installService(service, registry);
      case "config":
        return await configService(service, registry);
      case "start":
        return await startService(service, registry);
      case "stop":
        return await stopService(service);
      case "restart":
        return await restartService(service, registry);
      default:
        throw new ApiError("invalid_action", 400, `Unknown lifecycle action: ${action}`);
    }
  })();

  return await buildLifecycleActionResponse(service, registry, result);
}

async function buildLifecycleActionResponse(
  service: RuntimeModel["discovered"][number],
  registry: RuntimeModel["registry"],
  result: Awaited<ReturnType<typeof installService>>,
): Promise<LifecycleActionResponse> {
  const persisted = await writeServiceState(service, result.state);
  const sharedGlobalEnv = collectRuntimeGlobalEnv(registry.list());
  const health = await evaluateServiceHealth(
    service.manifest,
    result.state,
    service.serviceRoot,
    service,
    sharedGlobalEnv,
  );
  const provider = resolveProviderExecution(service, registry);

  return {
    action: result.action,
    serviceId: result.serviceId,
    ok: result.ok,
    message: result.message,
    state: result.state,
    health,
    statePaths: persisted.paths,
    provider,
  };
}

async function executeRuntimeOrchestrationAction(
  action: "startAll" | "stopAll" | "autostart" | "reload",
  runtimeModel: RuntimeModel,
): Promise<RuntimeOrchestrationResponse> {
  if (action === "reload") {
    const stopped: LifecycleActionResponse[] = [];
    const skipped: RuntimeOrchestrationResponse["skipped"] = [];
    const runningServiceIds = runtimeModel.graph
      .getGlobalShutdownOrder()
      .filter((serviceId) => getLifecycleState(serviceId).running);

    for (const serviceId of runningServiceIds) {
      const service = runtimeModel.registry.getById(serviceId);

      if (!service) {
        continue;
      }

      const result = await stopService(service);
      stopped.push(await buildLifecycleActionResponse(service, runtimeModel.registry, result));
    }

    const reloadedModel = await loadRuntimeModel(runtimeModel.servicesRoot);
    const runningServiceIdSet = new Set(runningServiceIds);
    const results: LifecycleActionResponse[] = [];

    for (const serviceId of reloadedModel.graph.getGlobalStartupOrder()) {
      if (!runningServiceIdSet.has(serviceId)) {
        continue;
      }

      const service = reloadedModel.registry.getById(serviceId);
      if (!service) {
        skipped.push({ serviceId, reason: "missing_after_reload" });
        continue;
      }

      if (service.manifest.enabled === false) {
        skipped.push({ serviceId, reason: "disabled_after_reload" });
        continue;
      }

      const lifecycle = getLifecycleState(serviceId);
      if (!lifecycle.installed) {
        skipped.push({ serviceId, reason: "not_installed" });
        continue;
      }

      if (!lifecycle.configured) {
        skipped.push({ serviceId, reason: "not_configured" });
        continue;
      }

      if (lifecycle.running) {
        skipped.push({ serviceId, reason: "already_running" });
        continue;
      }

      const result = await startService(service, reloadedModel.registry);
      results.push(await buildLifecycleActionResponse(service, reloadedModel.registry, result));
    }

    return {
      action,
      ok: true,
      results,
      stopped,
      skipped,
    };
  }

  const orderedServiceIds =
    action === "stopAll"
      ? runtimeModel.graph.getGlobalShutdownOrder()
      : runtimeModel.graph.getGlobalStartupOrder();
  const results: LifecycleActionResponse[] = [];
  const skipped: RuntimeOrchestrationResponse["skipped"] = [];

  for (const serviceId of orderedServiceIds) {
    const service = runtimeModel.registry.getById(serviceId);

    if (!service || service.manifest.enabled === false) {
      continue;
    }

    const lifecycle = getLifecycleState(serviceId);

    if (action !== "stopAll") {
      if (action === "autostart" && service.manifest.autostart !== true) {
        skipped.push({ serviceId, reason: "autostart_disabled" });
        continue;
      }

      if (lifecycle.running) {
        skipped.push({ serviceId, reason: "already_running" });
        continue;
      }

      if (!lifecycle.installed) {
        skipped.push({ serviceId, reason: "not_installed" });
        continue;
      }

      if (!lifecycle.configured) {
        skipped.push({ serviceId, reason: "not_configured" });
        continue;
      }

      const result = await startService(service, runtimeModel.registry);
      results.push(await buildLifecycleActionResponse(service, runtimeModel.registry, result));
      continue;
    }

    if (!lifecycle.running) {
      skipped.push({ serviceId, reason: "not_running" });
      continue;
    }

    const result = await stopService(service);
    results.push(await buildLifecycleActionResponse(service, runtimeModel.registry, result));
  }

  return {
    action,
    ok: true,
    results,
    skipped,
  };
}

async function routeWorkflowFacadeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  state: WorkflowRunFacadeState,
): Promise<boolean> {
  if (!url.pathname.startsWith("/api/platform/workspaces/")) return false;

  const pathParts = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
  const workspaceId = pathParts[3] ?? "";
  const resource = pathParts[4];
  const context = createWorkflowPlatformContext(request, workspaceId);

  if (!workspaceId || !resource) {
    notFound(response);
    return true;
  }

  if (resource === "workflows") {
    const workflowId = pathParts[5];

    if (request.method === "GET" && pathParts.length === 5) {
      const result = listWorkflowFacadeDefinitions(context, workspaceId, state);
      if (!result.ok) throwWorkflowFacadeError(result);
      writeJson(response, 200, { workflows: result.value });
      return true;
    }

    if (request.method === "GET" && pathParts.length === 6 && workflowId) {
      const result = getWorkflowFacadeDefinition(context, workspaceId, workflowId, state);
      if (!result.ok) throwWorkflowFacadeError(result);
      writeJson(response, 200, { workflow: result.value });
      return true;
    }

    if (request.method === "POST" && pathParts.length === 7 && workflowId && pathParts[6] === "runs") {
      const input = await parseStartWorkflowRunInput(request);
      const result = startWorkflowFacadeRun(context, { workspaceId, workflowId, input }, state);
      if (!result.ok) throwWorkflowFacadeError(result);
      upsertWorkflowRun(state, result.value);
      writeJson(response, 200, { run: result.value, auditEvent: result.auditEvent });
      return true;
    }
  }

  if (resource === "workflow-runs") {
    const runId = pathParts[5];
    const action = pathParts[6];

    if (request.method === "GET" && pathParts.length === 6 && runId) {
      const result = getWorkflowFacadeRun(context, workspaceId, runId, state);
      if (!result.ok) throwWorkflowFacadeError(result);
      writeJson(response, 200, { run: result.value });
      return true;
    }

    if (request.method === "POST" && pathParts.length === 7 && runId && action === "cancel") {
      const result = cancelWorkflowFacadeRun(context, workspaceId, runId, state);
      if (!result.ok) throwWorkflowFacadeError(result);
      upsertWorkflowRun(state, result.value);
      writeJson(response, 200, { run: result.value, auditEvent: result.auditEvent });
      return true;
    }

    if (request.method === "POST" && pathParts.length === 7 && runId && action === "retry") {
      const result = retryWorkflowFacadeRun(context, workspaceId, runId, state);
      if (!result.ok) throwWorkflowFacadeError(result);
      upsertWorkflowRun(state, result.value);
      writeJson(response, 200, { run: result.value, auditEvent: result.auditEvent });
      return true;
    }

    if (request.method === "GET" && pathParts.length === 7 && runId && action === "logs") {
      const result = getWorkflowFacadeRun(context, workspaceId, runId, state);
      if (!result.ok) throwWorkflowFacadeError(result);
      assertWorkflowRunFacadeSecretSafe(result.value);
      writeJson(response, 200, { runId: result.value.facadeRunId, logs: result.value.logsSummary ?? { available: false } });
      return true;
    }

    if (request.method === "GET" && pathParts.length === 7 && runId && action === "artifacts") {
      const result = getWorkflowFacadeRun(context, workspaceId, runId, state);
      if (!result.ok) throwWorkflowFacadeError(result);
      assertWorkflowRunFacadeSecretSafe(result.value);
      writeJson(response, 200, { runId: result.value.facadeRunId, artifacts: result.value.artifactsSummary ?? [] });
      return true;
    }
  }

  notFound(response);
  return true;
}

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: ApiRouteConfig,
  workflowRunFacadeState: WorkflowRunFacadeState,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (await routeWorkflowFacadeRequest(request, response, url, workflowRunFacadeState)) {
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    writeJson(response, 200, createHealthResponse(config.version));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/services") {
    const runtimeModel = await loadRuntimeModel(config.servicesRoot);
    const sharedGlobalEnv = collectRuntimeGlobalEnv(runtimeModel.registry.list());
    const services = await Promise.all(
      runtimeModel.discovered.map((service) =>
        createServiceSummary(service, runtimeModel.graph, runtimeModel.registry, sharedGlobalEnv),
      ),
    );
    writeJson(response, 200, createServicesResponse(services));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/updates") {
    const runtimeModel = await loadRuntimeModel(config.servicesRoot);
    writeJson(response, 200, {
      action: "list",
      services: await listServiceUpdateStates(runtimeModel.registry.list()),
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/recovery") {
    const runtimeModel = await loadRuntimeModel(config.servicesRoot);
    writeJson(response, 200, {
      action: "status",
      services: await Promise.all(runtimeModel.registry.list().map(async (service) => ({
        serviceId: service.manifest.id,
        recovery: await readServiceRecoveryHistory(service),
      }))),
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/setup") {
    const runtimeModel = await loadRuntimeModel(config.servicesRoot);
    writeJson(response, 200, {
      services: runtimeModel.registry
        .list()
        .map((service) => ({
          serviceId: service.manifest.id,
          steps: listSetupStepIds(service),
          state: getLifecycleState(service.manifest.id).setup,
        }))
        .filter((service) => service.steps.length > 0),
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/platform/workflow-packages") {
    const state = await readWorkflowRepoSyncState(workflowRepoStatePath(config));
    const activeSources = state.active?.sources ?? [];
    const catalog = activeSources.length > 0
      ? await loadWorkflowCatalogFromDirectories(activeSources.map((source) => ({ root: source.packageRoot, source: source.source })))
      : validateWorkflowCatalogEntries(exampleWorkflowPackageCatalog);
    const packages = listWorkflowPackagesSecretSafe(catalog.entries);
    writeJson(response, 200, {
      ok: catalog.ok,
      packages,
      diagnostics: catalog.diagnostics,
      sources: countWorkflowPackageSources(packages),
      activeRevision: state.active?.revision ?? null,
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/platform/workflow-packages/validate") {
    const entries = parseWorkflowCatalogValidateBody(await readJsonBody(request));
    const validation = validateWorkflowCatalogEntries(entries);
    let packages: ReturnType<typeof listWorkflowPackagesSecretSafe> = [];
    try {
      packages = listWorkflowPackagesSecretSafe(validation.entries);
    } catch {
      packages = [];
    }
    writeJson(response, 200, {
      ok: validation.ok,
      packages,
      diagnostics: validation.diagnostics,
      sources: countWorkflowPackageSources(packages),
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/platform/workflow-repos/state") {
    writeJson(response, 200, await readWorkflowRepoSyncState(workflowRepoStatePath(config)));
    return;
  }

  if (
    request.method === "POST" &&
    (url.pathname === "/api/platform/workflow-repos/sync" || url.pathname === "/api/platform/workflow-repos/activate")
  ) {
    const sources = parseWorkflowRepoSourcesBody(await readJsonBody(request));
    const result = await activateWorkflowRepoSources(sources, {
      workspaceRoot: workflowRepoWorkspaceRoot(config),
      statePath: workflowRepoStatePath(config),
      fetcher: async ({ source, destination }) => {
        await cp(resolveLocalWorkflowRepo(source.repo), destination, { recursive: true, force: true });
        return { revision: source.ref, packageRoot: source.path ?? "." };
      },
    });
    writeJson(response, result.ok ? 200 : 400, result);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/platform/workflow-repos/rollback") {
    writeJson(response, 200, await rollbackWorkflowRepoActivation({
      workspaceRoot: workflowRepoWorkspaceRoot(config),
      statePath: workflowRepoStatePath(config),
    }));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/updates/check") {
    const runtimeModel = await loadRuntimeModel(config.servicesRoot);
    const body = parseUpdateCheckBody(await readJsonBody(request));
    writeJson(response, 200, await checkServiceUpdatesForCli(runtimeModel.registry.list(), body.serviceId));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/services/meta") {
    const runtimeModel = await loadRuntimeModel(config.servicesRoot);
    const payload: ServicesMetaResponse["services"] = await Promise.all(
      runtimeModel.discovered.map((service) => buildPersistedServiceMeta(service.manifest.id, service.serviceRoot)),
    );
    writeJson(response, 200, createServicesMetaResponse(payload));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/dashboard") {
    const runtimeModel = await loadRuntimeModel(config.servicesRoot);
    const sharedGlobalEnv = collectRuntimeGlobalEnv(runtimeModel.registry.list());
    const services = await Promise.all(
      runtimeModel.discovered.map((service) =>
        buildDashboardService(service, runtimeModel.registry, runtimeModel.graph, sharedGlobalEnv),
      ),
    );

    writeJson(response, 200, createDashboardSummaryResponse(buildDashboardSummary(services)));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/dashboard/services") {
    const runtimeModel = await loadRuntimeModel(config.servicesRoot);
    const sharedGlobalEnv = collectRuntimeGlobalEnv(runtimeModel.registry.list());
    const services: DashboardServiceResponse[] = await Promise.all(
      runtimeModel.discovered.map((service) =>
        buildDashboardService(service, runtimeModel.registry, runtimeModel.graph, sharedGlobalEnv),
      ),
    );

    writeJson(response, 200, createDashboardServicesResponse(services));
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/api/dashboard/services/")) {
    const runtimeModel = await loadRuntimeModel(config.servicesRoot);
    const sharedGlobalEnv = collectRuntimeGlobalEnv(runtimeModel.registry.list());
    const serviceId = decodeURIComponent(url.pathname.split("/").filter(Boolean)[3] ?? "");
    const service = runtimeModel.registry.getById(serviceId);

    if (!service) {
      notFound(response);
      return;
    }

    writeJson(
      response,
      200,
      createDashboardServiceDetailResponse(
        await buildDashboardService(service, runtimeModel.registry, runtimeModel.graph, sharedGlobalEnv),
      ),
    );
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/services/log-info") {
    const runtimeModel = await loadRuntimeModel(config.servicesRoot);
    const serviceId = url.searchParams.get("service");
    const type = url.searchParams.get("type") ?? "default";

    if (!serviceId) {
      throw new ApiError("invalid_request", 400, "Missing required \"service\" query parameter.");
    }

    if (type !== "default") {
      throw new ApiError("invalid_request", 400, "Only the default runtime log type is currently supported.");
    }

    const service = runtimeModel.registry.getById(serviceId);
    if (!service) {
      notFound(response);
      return;
    }

    writeJson(response, 200, createServiceLogInfoResponse(buildServiceLogInfo(service)));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/logs/read") {
    const runtimeModel = await loadRuntimeModel(config.servicesRoot);
    const serviceId = url.searchParams.get("service");
    const type = url.searchParams.get("type") ?? "default";
    const beforeParam = url.searchParams.get("before");
    const limitParam = url.searchParams.get("limit");

    if (!serviceId) {
      throw new ApiError("invalid_request", 400, "Missing required \"service\" query parameter.");
    }

    if (type !== "default") {
      throw new ApiError("invalid_request", 400, "Only the default runtime log type is currently supported.");
    }

    const service = runtimeModel.registry.getById(serviceId);
    if (!service) {
      notFound(response);
      return;
    }

    const before = beforeParam === null ? undefined : Number(beforeParam);
    const limit = limitParam === null ? undefined : Number(limitParam);

    writeJson(response, 200, createServiceLogChunkResponse(await readServiceLogChunk(service, before, limit)));
    return;
  }

  if (url.pathname.startsWith("/api/services/")) {
    const pathParts = url.pathname.split("/").filter(Boolean);
    const runtimeModel = await loadRuntimeModel(config.servicesRoot);
    const sharedGlobalEnv = collectRuntimeGlobalEnv(runtimeModel.registry.list());
    const serviceId = decodeURIComponent(pathParts[2] ?? "");
    const service = runtimeModel.registry.getById(serviceId);

    if (!service) {
      notFound(response);
      return;
    }

    if (request.method === "PATCH" && pathParts.length === 4 && pathParts[3] === "meta") {
      const patch = parseServiceMetaPatch(await readJsonBody(request));
      const persisted = await writeServiceMeta(service.serviceRoot, patch);

      writeJson(
        response,
        200,
        createServiceMetaResponse(serviceId, {
          id: serviceId,
          favorite: persisted.favorite,
          dependencyGraphPosition: persisted.dependencyGraphPosition,
        }),
      );
      return;
    }

    if (request.method === "GET" && pathParts.length === 4 && pathParts[3] === "health") {
      const lifecycle = getLifecycleState(serviceId);
      const health = await evaluateServiceHealth(service.manifest, lifecycle, service.serviceRoot, service, sharedGlobalEnv);
      writeJson(response, 200, createServiceHealthResponse(serviceId, health));
      return;
    }

    if (request.method === "GET" && pathParts.length === 4 && pathParts[3] === "logs") {
      writeJson(response, 200, createServiceLogsResponse(await buildServiceLogs(service, getLifecycleState(serviceId))));
      return;
    }

    if (request.method === "GET" && pathParts.length === 4 && pathParts[3] === "metrics") {
      writeJson(response, 200, createServiceMetricsResponse(await buildServiceMetrics(service, getLifecycleState(serviceId))));
      return;
    }

    if (request.method === "GET" && pathParts.length === 4 && pathParts[3] === "variables") {
      const lifecycle = getLifecycleState(serviceId);
      const resolvedPorts = Object.keys(lifecycle.runtime.ports).length > 0 ? lifecycle.runtime.ports : service.manifest.ports ?? {};
      writeJson(
        response,
        200,
        createServiceVariablesResponse(buildServiceVariables(service, sharedGlobalEnv, resolvedPorts)),
      );
      return;
    }

    if (request.method === "GET" && pathParts.length === 4 && pathParts[3] === "network") {
      const lifecycle = getLifecycleState(serviceId);
      const resolvedPorts = Object.keys(lifecycle.runtime.ports).length > 0 ? lifecycle.runtime.ports : service.manifest.ports ?? {};
      writeJson(
        response,
        200,
        createServiceNetworkResponse(buildServiceNetwork(service, sharedGlobalEnv, resolvedPorts)),
      );
      return;
    }

    if (request.method === "GET" && pathParts.length === 4 && pathParts[3] === "updates") {
      writeJson(response, 200, {
        serviceId,
        update: await readServiceUpdateState(service),
      });
      return;
    }

    if (request.method === "GET" && pathParts.length === 4 && pathParts[3] === "recovery") {
      writeJson(response, 200, {
        serviceId,
        recovery: await readServiceRecoveryHistory(service),
      });
      return;
    }

    if (request.method === "GET" && pathParts.length === 4 && pathParts[3] === "setup") {
      writeJson(response, 200, {
        serviceId,
        steps: listSetupStepIds(service),
        setup: getLifecycleState(serviceId).setup,
      });
      return;
    }

    if (request.method === "POST" && pathParts.length >= 5 && pathParts[3] === "setup" && pathParts[4] === "run") {
      const stepId = pathParts.length === 6 ? decodeURIComponent(pathParts[5] ?? "") : undefined;
      const result = await runServiceSetup(service, runtimeModel.registry, { stepId, includeManual: stepId !== undefined });
      await writeServiceState(service, result.state);
      writeJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && pathParts.length === 5 && pathParts[3] === "recovery" && pathParts[4] === "doctor") {
      writeJson(response, 200, {
        serviceId,
        doctor: await runAndRecordDoctorPreflight(service),
        recovery: await readServiceRecoveryHistory(service),
      });
      return;
    }

    if (request.method === "POST" && pathParts.length === 5 && pathParts[3] === "update" && pathParts[4] === "download") {
      writeJson(response, 200, await downloadServiceUpdateCandidate(service));
      return;
    }

    if (request.method === "POST" && pathParts.length === 5 && pathParts[3] === "update" && pathParts[4] === "install") {
      const body = parseUpdateInstallBody(await readJsonBody(request));
      writeJson(response, 200, await installServiceUpdateCandidate(service, { force: body.force, registry: runtimeModel.registry }));
      return;
    }

    if (request.method === "GET" && pathParts.length === 3) {
      writeJson(
        response,
        200,
        createServiceDetailResponse(
          await createServiceSummary(service, runtimeModel.graph, runtimeModel.registry, sharedGlobalEnv),
        ),
      );
      return;
    }

    if (request.method === "POST" && pathParts.length === 4) {
      const action = pathParts[3];
      writeJson(response, 200, await executeLifecycleAction(action, service, runtimeModel.registry));
      return;
    }
  }

  if (request.method === "GET" && url.pathname === "/api/runtime") {
    const runtimeModel = await loadRuntimeModel(config.servicesRoot);
    const sharedGlobalEnv = collectRuntimeGlobalEnv(runtimeModel.registry.list());
    const serviceSummaries = await Promise.all(
      runtimeModel.discovered.map((service) =>
        createServiceSummary(service, runtimeModel.graph, runtimeModel.registry, sharedGlobalEnv),
      ),
    );
    const runningServices = serviceSummaries.filter((service) => service.lifecycle?.running).length;
    const healthyServices = serviceSummaries.filter((service) => service.health?.healthy).length;

    writeJson(
      response,
      200,
      createRuntimeSummaryResponse({
        servicesRoot: config.servicesRoot,
        workspaceRoot: config.workspaceRoot,
        totalServices: runtimeModel.registry.count(),
        enabledServices: runtimeModel.registry.countEnabled(),
        dependencyEdges: runtimeModel.graph.listEdges().length,
        runningServices,
        healthyServices,
      }),
    );
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/runtime/capabilities") {
    const runtimeModel = await loadRuntimeModel(config.servicesRoot);
    writeJson(
      response,
      200,
      createRuntimeCapabilitiesResponse({
        version: config.version,
        services: runtimeModel.discovered,
        features: config.features,
      }),
    );
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/runtime/actions/")) {
    const action = url.pathname.split("/").filter(Boolean)[3];

    if (action !== "startAll" && action !== "stopAll" && action !== "autostart" && action !== "reload") {
      throw new ApiError("invalid_action", 400, `Unknown runtime action: ${action}`);
    }

    const runtimeModel = await loadRuntimeModel(config.servicesRoot);
    writeJson(response, 200, await executeRuntimeOrchestrationAction(action, runtimeModel));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/dependencies") {
    const runtimeModel = await loadRuntimeModel(config.servicesRoot);
    writeJson(
      response,
      200,
      createDependenciesResponse({
        nodes: runtimeModel.graph.listNodes(),
        edges: runtimeModel.graph.listEdges(),
      }),
    );
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/variables") {
    const runtimeModel = await loadRuntimeModel(config.servicesRoot);
    const sharedGlobalEnv = collectRuntimeGlobalEnv(runtimeModel.registry.list());
    const payload = runtimeModel.discovered.map((service) =>
      buildServiceVariables(
        service,
        sharedGlobalEnv,
        Object.keys(getLifecycleState(service.manifest.id).runtime.ports).length > 0
          ? getLifecycleState(service.manifest.id).runtime.ports
          : service.manifest.ports ?? {},
      ),
    );
    writeJson(response, 200, { services: payload });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/globalenv") {
    const runtimeModel = await loadRuntimeModel(config.servicesRoot);
    writeJson(response, 200, createGlobalEnvResponse(collectRuntimeGlobalEnv(runtimeModel.registry.list())));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/network") {
    const runtimeModel = await loadRuntimeModel(config.servicesRoot);
    const sharedGlobalEnv = collectRuntimeGlobalEnv(runtimeModel.registry.list());
    const payload = runtimeModel.discovered.map((service) =>
      buildServiceNetwork(
        service,
        sharedGlobalEnv,
        Object.keys(getLifecycleState(service.manifest.id).runtime.ports).length > 0
          ? getLifecycleState(service.manifest.id).runtime.ports
          : service.manifest.ports ?? {},
      ),
    );
    writeJson(response, 200, { services: payload });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/metrics") {
    const runtimeModel = await loadRuntimeModel(config.servicesRoot);
    const payload = await Promise.all(
      runtimeModel.discovered.map((service) => buildServiceMetrics(service, getLifecycleState(service.manifest.id))),
    );
    writeJson(response, 200, { services: payload });
    return;
  }

  notFound(response);
}

export function createApiServer(options: ApiServerOptions = {}): Server {
  const resolvedConfig = resolveRuntimeConfig(options);
  const routeConfig: ApiRouteConfig = {
    ...resolvedConfig,
    features: {
      autostart: options.autostart === true,
      monitor: options.monitor === true,
      updateScheduler: options.updateScheduler === true,
    },
  };
  const workflowRunFacadeState = cloneWorkflowRunFacadeState(options.workflowRunFacadeState ?? exampleWorkflowRunFacadeState);

  return createServer((request, response) => {
    void routeRequest(request, response, routeConfig, workflowRunFacadeState).catch((error: unknown) => {
      const body = toApiErrorBody(error);
      writeJson(response, body.statusCode, body);
    });
  });
}

export async function startApiServer(options: ApiServerOptions = {}): Promise<RunningApiServer> {
  const bindHost = process.env.SERVICE_LASSO_HOST ?? "0.0.0.0";
  const publicHost = bindHost === "0.0.0.0" ? "127.0.0.1" : bindHost;
  const config = await ensureRuntimeConfig(resolveRuntimeConfig(options));
  const bootModel = await loadRuntimeModel(config.servicesRoot);
  await rehydrateDiscoveredServices(bootModel.discovered);
  if (options.autostart) {
    await executeRuntimeOrchestrationAction("autostart", bootModel);
  }
  const monitor = options.monitor
    ? createRuntimeServiceMonitor({
        registry: bootModel.registry,
        intervalMs: options.monitorIntervalMs,
      })
    : null;
  const updateScheduler = options.updateScheduler
    ? createRuntimeUpdateScheduler({
        registry: bootModel.registry,
        intervalMs: options.updateSchedulerIntervalMs,
      })
    : null;
  const server = createApiServer({
    ...config,
    autostart: options.autostart,
    monitor: options.monitor,
    updateScheduler: options.updateScheduler,
    workflowRunFacadeState: options.workflowRunFacadeState,
  });
  const port = options.port ?? 18080;

  server.listen(port, bindHost);
  await once(server, "listening");
  monitor?.start();
  updateScheduler?.start();

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("API server failed to expose a TCP address.");
  }

  const resolvedPort = address.port;

  return {
    server,
    port: resolvedPort,
    url: `http://${publicHost}:${resolvedPort}`,
    monitor,
    updateScheduler,
    stop: async () => {
      await monitor?.stop();
      await updateScheduler?.stop();
      await stopAllManagedProcesses();
      server.close();
      await once(server, "close");
    },
  };
}
