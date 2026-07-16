import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { once } from "node:events";
import { createHash, timingSafeEqual } from "node:crypto";
import { cp, readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHealthResponse } from "./routes/health.js";
import { createServicesResponse } from "./routes/services.js";
import { createDependenciesResponse, createDependencyReverseLookupResponse } from "./routes/dependencies.js";
import { createRuntimeCapabilitiesResponse, createRuntimeSummaryResponse } from "./routes/runtime.js";
import { createServiceHealthHistoryResponse, createServiceHealthResponse } from "./routes/service-health.js";
import { createServiceLogsResponse } from "./routes/logs.js";
import { createServiceLogChunkResponse, createServiceLogInfoResponse, createServiceLogSearchResponse } from "./routes/log-reader.js";
import { createServiceMetricsResponse } from "./routes/metrics.js";
import {
  createRuntimeTelemetryPreviewResponse,
  createServiceTelemetryPreviewResponse,
} from "./routes/telemetry.js";
import { createRuntimeLogShippingPreviewResponse } from "./routes/log-shipping.js";
import { createServiceVariablesResponse } from "./routes/variables.js";
import { createServiceNetworkResponse } from "./routes/network.js";
import { createGlobalEnvResponse } from "./routes/globalenv.js";
import { createServiceMetaResponse, createServicesMetaResponse } from "./routes/service-meta.js";
import { createManagedWorkflowRegistryResponse } from "./routes/workflows.js";
import {
  createDashboardServiceDetailResponse,
  createDashboardServicesResponse,
  createDashboardSummaryResponse,
} from "./routes/dashboard.js";
import { createOperatorNotificationsResponse } from "./routes/operator-notifications.js";
import type { DiscoveredService } from "../contracts/service.js";
import { discoverServices } from "../runtime/discovery/discoverServices.js";
import { DependencyGraph, createServiceRegistry } from "../runtime/manager/DependencyGraph.js";
import {
  configService,
  installService,
  restartService,
  startService,
  stopService,
} from "../runtime/lifecycle/actions.js";
import { prepareAndStartService, type PreparedStartSkipReason } from "../runtime/lifecycle/prepareStart.js";
import { getLifecycleState } from "../runtime/lifecycle/store.js";
import { evaluateServiceHealth } from "../runtime/health/evaluateHealth.js";
import type { ServiceHealthResult } from "../runtime/health/types.js";
import { readServiceHealthHistory, recordServiceHealthTransition } from "../runtime/health/history.js";
import { getServiceStatePaths } from "../runtime/state/paths.js";
import { buildPersistedServiceMeta, writeServiceMeta } from "../runtime/state/meta.js";
import { writeServiceState } from "../runtime/state/writeState.js";
import {
  buildServiceLogInfo,
  buildServiceLogs,
  getServiceRuntimeLogPaths,
  readServiceLogChunk,
  searchServiceLogs,
  type ServiceLogReadType,
} from "../runtime/operator/logs.js";
import { buildDashboardService, buildDashboardSummary } from "../runtime/operator/dashboard.js";
import {
  buildAppServiceImportDryRunPlan,
  buildRuntimeOrchestrationDryRunPlan,
  buildUpdateInstallDryRunPlan,
} from "../runtime/operator/dry-run-plan.js";
import { buildBaselineDependencyDiagnostics } from "../runtime/operator/dependencyDiagnostics.js";
import { buildOperatorNotifications } from "../runtime/operator/notifications.js";
import { buildServiceMetrics } from "../runtime/operator/metrics.js";
import {
  buildApiRequestTelemetryPreview,
  createApiRequestTelemetryIdentity,
  buildRuntimeTelemetryPreview,
  buildServiceTelemetryPreview,
  classifyTelemetryRoute,
  normalizeExternalServiceTelemetrySignals,
  sendRuntimeTelemetryExport,
  sendRuntimeTelemetryMockExport,
  TELEMETRY_CORRELATION_ID_HEADER,
  TELEMETRY_TRACE_ID_HEADER,
  TELEMETRY_TRACEPARENT_HEADER,
  type ApiRequestTelemetryPreview,
  type RuntimeTelemetryPreview,
  type ServiceTelemetryPreview,
  type TelemetryContinuousExportRuntimeState,
} from "../runtime/operator/telemetry.js";
import {
  createRuntimeTelemetryExportScheduler,
  type RuntimeTelemetryExportScheduler,
} from "../runtime/operator/telemetry-scheduler.js";
import { buildRuntimeLogShippingPreview, sendRuntimeLogShippingMockExport } from "../runtime/operator/log-shipping.js";
import { buildServiceVariables, collectRuntimeGlobalEnv } from "../runtime/operator/variables.js";
import { buildServiceNetwork } from "../runtime/operator/network.js";
import { appendAuditEvent, readAuditEvents } from "../runtime/audit/store.js";
import { executeOperatorCommandFacade } from "../runtime/operator/command-facade.js";
import {
  confirmOperatorCommandConfirmation,
  executeOperatorCommandConfirmation,
  issueOperatorCommandConfirmation,
} from "../runtime/operator/command-confirmations.js";
import { buildRestartSafetyPreflightReport } from "../runtime/operator/restart-safety-preflight.js";
import { buildServiceCompatibilityReport } from "../runtime/operator/catalog-compatibility.js";
import { buildServiceConfigDriftReport } from "../runtime/operator/config-drift.js";
import {
  listServiceConfigRevisions,
  readServiceConfigDocument,
  saveServiceConfigDocument,
} from "../runtime/operator/service-config-editor.js";
import {
  buildSecretProviderAuthRequiredSummary,
  buildSecretReferenceAudit,
  buildSecretRotationReadinessReport,
  buildServiceSecretProviderAuthRequiredSummary,
  buildServiceSecretReferenceAudit,
  buildServiceSecretRotationReadinessReport,
} from "../runtime/operator/secret-audit.js";
import {
  getServiceLassoMcpCapabilities,
  handleServiceLassoMcpJsonRpcRequest,
  type McpJsonRpcRequest,
} from "../runtime/operator/mcp.js";
import {
  mutateOperatorActionItem,
  readOperatorActionAcknowledgementHistory,
  readOperatorActionQueue,
  upsertOperatorActionItem,
  type OperatorActionInput,
  type OperatorActionItem,
  type OperatorActionMutationInput,
  type OperatorActionQueueState,
} from "../runtime/operator/action-queue.js";
import { buildDiagnosticsBundle } from "../runtime/diagnostics/bundle.js";
import { resolveProviderExecution } from "../runtime/providers/resolveProvider.js";
import { ensureRuntimeConfig, resolveRuntimeConfig, type RuntimeConfig } from "../runtime/config.js";
import { rehydrateDiscoveredServices } from "../runtime/state/rehydrate.js";
import { stopAllManagedProcesses } from "../runtime/execution/supervisor.js";
import { isProviderRole } from "../runtime/roles.js";
import { reconcilePortReservationLedger, reservePorts, type PortReservationInput } from "../runtime/ports/reservations.js";
import { explainPortConflict } from "../runtime/ports/conflicts.js";
import { runAndRecordDoctorPreflight } from "../runtime/recovery/doctor.js";
import { readServiceRecoveryHistory } from "../runtime/recovery/history.js";
import { listSetupStepIds, runServiceSetup } from "../runtime/setup/steps.js";
import { listServiceActionRuns, parseServiceActionRunRequest, runServiceAction } from "../runtime/actions/runs.js";
import { buildManagedWorkflowRegistry } from "../runtime/workflows/registry.js";
import { createRuntimeServiceMonitor, type RuntimeServiceMonitor } from "../runtime/recovery/monitor.js";
import { readServiceUpdateState } from "../runtime/updates/state.js";
import { createRuntimeUpdateScheduler, type RuntimeUpdateScheduler } from "../runtime/updates/scheduler.js";
import {
  DEFAULT_RUNTIME_INSTANCE_HEARTBEAT_INTERVAL_MS,
  createRuntimeInstanceSnapshot,
  markRuntimeInstanceStopped,
  refreshRuntimeInstanceLease,
  registerRuntimeInstance,
} from "../runtime/instance/registry.js";
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
import { ApiError, LifecycleStateError, toApiErrorBody } from "./errors.js";
import type {
  DashboardServiceResponse,
  LifecycleActionResponse,
  OperatorCommandConfirmationExecuteRequest,
  OperatorCommandConfirmationConfirmRequest,
  OperatorCommandConfirmationIssueRequest,
  RuntimeOrchestrationResponse,
  OperatorCommandRequest,
  AuditQuery,
  ServiceActionRunResponse,
  ServiceActionRunsResponse,
  ServiceDetailResponse,
  ServiceStartTraceResponse,
  ServicesMetaResponse,
  ServiceSummary,
} from "../contracts/api.js";

export interface ApiServerOptions {
  port?: number;
  host?: string;
  version?: string;
  servicesRoot?: string;
  workspaceRoot?: string;
  autostart?: boolean;
  monitor?: boolean;
  monitorIntervalMs?: number;
  updateScheduler?: boolean;
  updateSchedulerIntervalMs?: number;
  workflowRunFacadeState?: WorkflowRunFacadeState;
  telemetryExportScheduler?: RuntimeTelemetryExportScheduler | null;
  apiRequestTelemetryState?: ApiRequestTelemetryState;
}

interface ApiRequestTelemetryState {
  requests: ApiRequestTelemetryPreview[];
  droppedCount: number;
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
  telemetryExportScheduler: RuntimeTelemetryExportScheduler | null;
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

function parseOptionalInteger(value: string | null): number | undefined {
  if (value === null || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

function parseBooleanQuery(value: string | null): boolean {
  return value === "1" || value?.toLocaleLowerCase() === "true";
}

function parseServiceLogReadType(value: string | null): ServiceLogReadType {
  if (value === null || value === "default") {
    return "default";
  }

  if (value === "stdout" || value === "stderr") {
    return value;
  }

  throw new ApiError("invalid_request", 400, "Log type must be one of: default, stdout, stderr.");
}

function cloneWorkflowRunFacadeState(state: WorkflowRunFacadeState): WorkflowRunFacadeState {
  return JSON.parse(JSON.stringify(state)) as WorkflowRunFacadeState;
}

function parseOperatorActionRecordBody(input: unknown): OperatorActionInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ApiError("invalid_body", 400, "Operator action record body must be a JSON object.");
  }
  const candidate = input as Record<string, unknown>;
  if (typeof candidate.dedupeKey !== "string" || !candidate.dedupeKey.trim()) {
    throw new ApiError("invalid_body", 400, '"dedupeKey" must be a non-empty string.');
  }
  if (candidate.severity !== "info" && candidate.severity !== "warning" && candidate.severity !== "critical") {
    throw new ApiError("invalid_body", 400, '"severity" must be one of: info, warning, critical.');
  }
  if (typeof candidate.title !== "string" || !candidate.title.trim()) {
    throw new ApiError("invalid_body", 400, '"title" must be a non-empty string.');
  }
  if (typeof candidate.summary !== "string") {
    throw new ApiError("invalid_body", 400, '"summary" must be a string.');
  }

  return {
    dedupeKey: candidate.dedupeKey,
    severity: candidate.severity,
    source: candidate.source as OperatorActionInput["source"],
    title: candidate.title,
    summary: candidate.summary,
    evidence: Array.isArray(candidate.evidence) ? candidate.evidence as OperatorActionInput["evidence"] : [],
    observedAt: typeof candidate.observedAt === "string" ? candidate.observedAt : undefined,
  };
}

function parseOperatorActionMutationBody(input: unknown): OperatorActionMutationInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  const candidate = input as Record<string, unknown>;
  if (candidate.deferredUntil !== undefined && candidate.deferredUntil !== null && typeof candidate.deferredUntil !== "string") {
    throw new ApiError("invalid_body", 400, '"deferredUntil" must be a string or null when present.');
  }
  if (candidate.actor !== undefined && candidate.actor !== null && typeof candidate.actor !== "string") {
    throw new ApiError("invalid_body", 400, '"actor" must be a string or null when present.');
  }
  if (candidate.reason !== undefined && candidate.reason !== null && typeof candidate.reason !== "string") {
    throw new ApiError("invalid_body", 400, '"reason" must be a string or null when present.');
  }
  return {
    deferredUntil: typeof candidate.deferredUntil === "string" ? candidate.deferredUntil : null,
    actor: typeof candidate.actor === "string" ? candidate.actor : null,
    reason: typeof candidate.reason === "string" ? candidate.reason : null,
  };
}

function parseOperatorCommandBody(input: unknown): OperatorCommandRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ApiError("invalid_body", 400, "Operator command body must be a JSON object.");
  }

  const candidate = input as Record<string, unknown>;
  if (candidate.command !== undefined && typeof candidate.command !== "string") {
    throw new ApiError("invalid_body", 400, '"command" must be a string when present.');
  }
  if (candidate.args !== undefined && (!Array.isArray(candidate.args) || candidate.args.some((entry) => typeof entry !== "string"))) {
    throw new ApiError("invalid_body", 400, '"args" must be an array of strings when present.');
  }
  if (candidate.serviceId !== undefined && typeof candidate.serviceId !== "string") {
    throw new ApiError("invalid_body", 400, '"serviceId" must be a string when present.');
  }
  if (candidate.tail !== undefined && typeof candidate.tail !== "number") {
    throw new ApiError("invalid_body", 400, '"tail" must be a number when present.');
  }

  return {
    command: typeof candidate.command === "string" ? candidate.command : undefined,
    args: Array.isArray(candidate.args) ? candidate.args : undefined,
    serviceId: typeof candidate.serviceId === "string" ? candidate.serviceId : undefined,
    tail: typeof candidate.tail === "number" ? candidate.tail : undefined,
    actor: candidate.actor as OperatorCommandRequest["actor"],
  };
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

function getAuditActor(input: unknown): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return "unknown";
  }

  const actor = (input as Record<string, unknown>).actor;
  return typeof actor === "string" && actor.trim().length > 0 ? actor.trim() : "unknown";
}

function redactAuditText(value: string): string {
  return value
    .replace(/([\w.-]*(?:password|passwd|secret|token|key|credential)[\w.-]*\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]")
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]")
    .replace(/(gh[pousr]_[A-Za-z0-9_]+)/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim();
}

function safeAuditText(value: unknown, fallback: string | null = null): string | null {
  if (typeof value !== "string") {
    return fallback;
  }
  const redacted = redactAuditText(value).slice(0, 240);
  return redacted || fallback;
}

function getApiErrorStatusCode(error: unknown): number {
  return toApiErrorBody(error).statusCode;
}

function getAuditFailureReason(error: unknown): string {
  return redactAuditText(toApiErrorBody(error).message);
}

function getOperatorActionAuditItem(queue: OperatorActionQueueState, itemId?: string | null): OperatorActionItem | null {
  if (itemId) {
    return queue.items.find((item) => item.id === itemId) ?? null;
  }
  return queue.items[0] ?? null;
}

async function appendOperatorActionQueueAuditEvent(input: {
  workspaceRoot: string;
  action: "operator.action.record" | "operator.action.acknowledge" | "operator.action.defer" | "operator.action.reopen";
  routeTemplate: string;
  outcome: "success" | "failure";
  statusCode: number;
  item?: OperatorActionItem | null;
  itemId?: string | null;
  actor?: string | null;
  reason?: string | null;
  mutation?: string | null;
}): Promise<void> {
  const item = input.item ?? null;
  const subject = item?.id ?? safeAuditText(input.itemId);
  const metadata: Record<string, string | null> = {
    itemId: subject,
    queueStatus: item?.status ?? null,
    severity: item?.severity ?? null,
    sourceKind: item?.source.kind ?? null,
    serviceId: item?.source.serviceId ?? null,
    reference: item?.source.reference ?? null,
    mutation: input.mutation ?? null,
  };

  await appendAuditEvent({
    workspaceRoot: input.workspaceRoot,
    source: "runtime-api",
    action: input.action,
    actor: safeAuditText(input.actor, "unknown") ?? "unknown",
    subject: subject ?? undefined,
    method: "POST",
    routeTemplate: input.routeTemplate,
    outcome: input.outcome,
    statusCode: input.statusCode,
    summary:
      input.outcome === "success"
        ? `Operator action queue ${input.action.replace("operator.action.", "")} completed.`
        : `Operator action queue ${input.action.replace("operator.action.", "")} failed.`,
    reason: safeAuditText(input.reason),
    metadata,
  });
}

function parseAuditQuery(searchParams: URLSearchParams): AuditQuery {
  const query: AuditQuery = {};

  for (const key of ["serviceId", "actor", "action", "source", "since", "until", "query", "limit", "cursor"] as const) {
    const value = searchParams.get(key);
    if (value !== null && value.trim()) {
      query[key] = value.trim();
    }
  }

  const outcome = searchParams.get("outcome");
  if (outcome === "success" || outcome === "failure") {
    query.outcome = outcome;
  }

  return query;
}

function parseServiceMetaPatch(input: unknown): {
  patch: { favorite?: boolean; dependencyGraphPosition?: { x: number; y: number } | null };
  actor?: string;
  reason?: string | null;
} {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ApiError("invalid_body", 400, "Service meta patch must be a JSON object.");
  }

  const candidate = input as Record<string, unknown>;
  const patch: { favorite?: boolean; dependencyGraphPosition?: { x: number; y: number } | null } = {};
  if (candidate.actor !== undefined && candidate.actor !== null && typeof candidate.actor !== "string") {
    throw new ApiError("invalid_body", 400, '"actor" must be a string when present.');
  }
  if (candidate.reason !== undefined && candidate.reason !== null && typeof candidate.reason !== "string") {
    throw new ApiError("invalid_body", 400, '"reason" must be a string or null when present.');
  }

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

  return {
    patch,
    actor: typeof candidate.actor === "string" ? candidate.actor : undefined,
    reason: typeof candidate.reason === "string" ? candidate.reason : candidate.reason === null ? null : undefined,
  };
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

function parseServiceConfigSaveBody(input: unknown): { content: string; actor?: string; reason?: string | null } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ApiError("invalid_body", 400, "Service config save body must be a JSON object.");
  }

  const candidate = input as Record<string, unknown>;
  if (typeof candidate.content !== "string") {
    throw new ApiError("invalid_body", 400, '"content" must be a JSON string.');
  }
  if (candidate.actor !== undefined && candidate.actor !== null && typeof candidate.actor !== "string") {
    throw new ApiError("invalid_body", 400, '"actor" must be a string when present.');
  }
  if (candidate.reason !== undefined && candidate.reason !== null && typeof candidate.reason !== "string") {
    throw new ApiError("invalid_body", 400, '"reason" must be a string or null when present.');
  }

  try {
    const parsed = JSON.parse(candidate.content) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not_object");
    }
  } catch {
    throw new ApiError("invalid_json", 400, '"content" must be a valid JSON object string.');
  }

  return {
    content: candidate.content,
    actor: typeof candidate.actor === "string" ? candidate.actor : undefined,
    reason: typeof candidate.reason === "string" ? candidate.reason : null,
  };
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function hashFileContent(filePath: string): Promise<string | null> {
  try {
    return sha256(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
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

function isTrustedChatBridgeRequest(request: IncomingMessage): boolean {
  const expected = process.env.SERVICE_LASSO_CHAT_BRIDGE_TOKEN;
  const provided = firstHeader(request.headers["x-service-lasso-chat-bridge-token"]);
  if (!expected || !provided) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(provided, "utf8");
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
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

function isUsablePort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 65535;
}

function toServicePortReservations(runtimeModel: RuntimeModel): PortReservationInput[] {
  return runtimeModel.discovered.flatMap((service) => {
    const state = getLifecycleState(service.manifest.id);
    return Object.entries(state.runtime.ports)
      .filter(([, port]) => isUsablePort(port))
      .map(([portName, port]) => {
        const desiredPort = service.manifest.ports?.[portName];
        return {
          kind: desiredPort === port && desiredPort !== 0 ? "service-fixed" : "service-negotiated",
          ownerId: service.manifest.id,
          portName,
          port,
        };
      });
  });
}

function toApiPortReservation(port: number, bindHost: string): PortReservationInput {
  return {
    host: bindHost,
    kind: "api",
    ownerId: "runtime-api",
    portName: "http",
    port,
  };
}

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
  const healthHistory = await readServiceHealthHistory(service);
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
    healthHistory,
    updates,
    recovery,
    catalogProvenance: service.catalogProvenance,
    statePaths: getServiceStatePaths(service.serviceRoot),
    provider,
    compatibility: buildServiceCompatibilityReport(service, registry, { updateState: updates }),
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
  workspaceRoot?: string,
): Promise<LifecycleActionResponse> {
  const result = await (async () => {
    switch (action) {
      case "install":
        return await installService(service, registry);
      case "config":
        return await configService(service, registry, { workspaceRoot });
      case "start":
        return await executePreparedServiceStart(service, registry, workspaceRoot);
      case "stop":
        return await stopService(service);
      case "restart":
        return await restartService(service, registry, { workspaceRoot });
      default:
        throw new ApiError("invalid_action", 400, `Unknown lifecycle action: ${action}`);
    }
  })();

  return await buildLifecycleActionResponse(service, registry, result);
}

async function executePreparedServiceStart(
  service: RuntimeModel["discovered"][number],
  registry: RuntimeModel["registry"],
  workspaceRoot?: string,
): Promise<Awaited<ReturnType<typeof startService>>> {
  const prepared = await prepareAndStartService(service, registry, { workspaceRoot });

  if (prepared.result) {
    return prepared.result;
  }

  if (prepared.skippedReason === "provider_role") {
    return {
      action: "start",
      serviceId: service.manifest.id,
      ok: true,
      state: prepared.state,
      message: `Prepared provider-role service "${service.manifest.id}"; no managed daemon process is required.`,
    };
  }

  throw new LifecycleStateError(formatPreparedStartSkipMessage(service.manifest.id, prepared.skippedReason));
}

function formatPreparedStartSkipMessage(serviceId: string, reason: PreparedStartSkipReason | null): string {
  if (reason === "already_running") {
    return `Cannot start service "${serviceId}" because it is already running.`;
  }

  if (reason === "not_startable") {
    return `Cannot start service "${serviceId}" because no executable is configured.`;
  }

  return `Cannot start service "${serviceId}".`;
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
  const healthHistory = await recordServiceHealthTransition(service, health);
  const provider = resolveProviderExecution(service, registry);

  return {
    action: result.action,
    serviceId: result.serviceId,
    ok: result.ok,
    message: result.message,
    state: result.state,
    health,
    healthHistory,
    statePaths: persisted.paths,
    provider,
  };
}

async function executeRuntimeOrchestrationAction(
  action: "startAll" | "stopAll" | "autostart" | "reload",
  runtimeModel: RuntimeModel,
  workspaceRoot?: string,
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

      const result = await startService(service, reloadedModel.registry, { workspaceRoot });
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

    if (!service) {
      continue;
    }

    if (service.manifest.enabled === false && !isProviderRole(service.manifest)) {
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

      const prepared = await prepareAndStartService(service, runtimeModel.registry, { workspaceRoot });
      if (prepared.result) {
        results.push(await buildLifecycleActionResponse(service, runtimeModel.registry, prepared.result));
      } else {
        skipped.push({ serviceId, reason: prepared.skippedReason ?? "not_started" });
      }
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

const API_TELEMETRY_BUFFER_LIMIT = 50;
const BROKER_TELEMETRY_TIMEOUT_MS = 800;

function isMutatingHttpMethod(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

function servicePortValue(service: DiscoveredService, lifecycle: ReturnType<typeof getLifecycleState>): number | null {
  const runtimePort = lifecycle.runtime.ports.service;
  if (Number.isInteger(runtimePort) && runtimePort > 0) {
    return runtimePort;
  }
  const manifestPort = service.manifest.ports?.service;
  if (typeof manifestPort === "number" && Number.isInteger(manifestPort) && manifestPort > 0) {
    return manifestPort;
  }
  return null;
}

async function readLocalSecretsBrokerTelemetrySignals(
  service: DiscoveredService,
  lifecycle: ReturnType<typeof getLifecycleState>,
): Promise<ServiceTelemetryPreview["signals"]> {
  if (service.manifest.id !== "@secretsbroker") {
    return [];
  }

  const port = servicePortValue(service, lifecycle);
  if (port === null) {
    return [];
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BROKER_TELEMETRY_TIMEOUT_MS);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/telemetry`, {
      signal: controller.signal,
    });
    if (!response.ok) {
      return [];
    }
    const payload = (await response.json()) as { signals?: unknown[] };
    return normalizeExternalServiceTelemetrySignals(service.manifest.id, Array.isArray(payload.signals) ? payload.signals : []);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function buildServiceTelemetrySnapshot(
  service: DiscoveredService,
  sharedGlobalEnv: Record<string, string>,
  knownServiceIds: ReadonlySet<string>,
): Promise<ServiceTelemetryPreview> {
  const lifecycle = getLifecycleState(service.manifest.id);
  const healthHistory = await readServiceHealthHistory(service);
  const latestHealth = healthHistory.transitions.at(-1);
  const health: ServiceHealthResult = latestHealth
    ? {
        type: latestHealth.checkType,
        healthy: latestHealth.status === "healthy",
        detail: latestHealth.detail,
      }
    : service.manifest.role === "provider"
      ? {
          type: "provider",
          healthy: lifecycle.installed && lifecycle.configured,
          detail: lifecycle.installed && lifecycle.configured
            ? "Provider is installed and configured."
            : "Provider is not ready.",
        }
      : {
          type: service.manifest.healthcheck?.type ?? "unknown",
          healthy: service.manifest.healthcheck?.type === "process" && lifecycle.running,
          detail: lifecycle.running
            ? "No passive health observation has been recorded."
            : "Service is not running.",
        };
  const updateState = await readServiceUpdateState(service);
  const telemetry = buildServiceTelemetryPreview(service, lifecycle, health, healthHistory, knownServiceIds, updateState);
  const externalSignals = await readLocalSecretsBrokerTelemetrySignals(service, lifecycle);
  return externalSignals.length > 0 ? { ...telemetry, signals: [...telemetry.signals, ...externalSignals] } : telemetry;
}

async function buildRuntimeTelemetrySnapshot(
  config: Pick<ApiRouteConfig, "servicesRoot">,
  apiRequestTelemetry: ApiRequestTelemetryPreview[],
  getApiRequestTelemetryDroppedCount: () => number,
  continuousExportState?: TelemetryContinuousExportRuntimeState | null,
): Promise<RuntimeTelemetryPreview> {
  const runtimeModel = await loadRuntimeModel(config.servicesRoot);
  const sharedGlobalEnv = collectRuntimeGlobalEnv(runtimeModel.registry.list());
  const knownServiceIds = new Set(runtimeModel.discovered.map((service) => service.manifest.id));
  const services = await Promise.all(
    runtimeModel.discovered.map(async (service) => {
      return buildServiceTelemetrySnapshot(service, sharedGlobalEnv, knownServiceIds);
    }),
  );

  return buildRuntimeTelemetryPreview(services, apiRequestTelemetry, {
    capacity: API_TELEMETRY_BUFFER_LIMIT,
    droppedCount: getApiRequestTelemetryDroppedCount(),
  }, process.env, continuousExportState);
}

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: ApiRouteConfig,
  workflowRunFacadeState: WorkflowRunFacadeState,
  apiRequestTelemetry: ApiRequestTelemetryPreview[],
  getApiRequestTelemetryDroppedCount: () => number,
  getTelemetryContinuousExportState: () => TelemetryContinuousExportRuntimeState | null,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (await routeWorkflowFacadeRequest(request, response, url, workflowRunFacadeState)) {
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    writeJson(response, 200, createHealthResponse(config.version));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/mcp") {
    const runtimeModel = await loadRuntimeModel(config.servicesRoot);
    writeJson(
      response,
      200,
      getServiceLassoMcpCapabilities({
        ...runtimeModel,
        version: config.version,
        workspaceRoot: config.workspaceRoot,
        sharedGlobalEnv: collectRuntimeGlobalEnv(runtimeModel.registry.list()),
      }),
    );
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/mcp") {
    const runtimeModel = await loadRuntimeModel(config.servicesRoot);
    writeJson(
      response,
      200,
      await handleServiceLassoMcpJsonRpcRequest(
        {
          ...runtimeModel,
          version: config.version,
          workspaceRoot: config.workspaceRoot,
          sharedGlobalEnv: collectRuntimeGlobalEnv(runtimeModel.registry.list()),
        },
        await readJsonBody(request) as McpJsonRpcRequest,
      ),
    );
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

  if (request.method === "GET" && url.pathname === "/api/workflows/registry") {
    const runtimeModel = await loadRuntimeModel(config.servicesRoot);
    writeJson(response, 200, createManagedWorkflowRegistryResponse(buildManagedWorkflowRegistry(runtimeModel.discovered)));
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

  if (request.method === "GET" && url.pathname === "/api/audit") {
    const runtimeModel = await loadRuntimeModel(config.servicesRoot);
    writeJson(
      response,
      200,
      await readAuditEvents({
        workspaceRoot: config.workspaceRoot,
        serviceRoots: runtimeModel.registry.list().map((service) => service.serviceRoot),
        query: parseAuditQuery(url.searchParams),
      }),
    );
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/operator/notifications") {
    const runtimeModel = await loadRuntimeModel(config.servicesRoot);
    const sharedGlobalEnv = collectRuntimeGlobalEnv(runtimeModel.registry.list());
    writeJson(
      response,
      200,
      createOperatorNotificationsResponse(
        await buildOperatorNotifications(runtimeModel.discovered, runtimeModel.registry, sharedGlobalEnv),
      ),
    );
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/operator/commands") {
    const runtimeModel = await loadRuntimeModel(config.servicesRoot);
    const sharedGlobalEnv = collectRuntimeGlobalEnv(runtimeModel.registry.list());
    const commandResponse = await executeOperatorCommandFacade(parseOperatorCommandBody(await readJsonBody(request)), {
      discovered: runtimeModel.discovered,
      registry: runtimeModel.registry,
      graph: runtimeModel.graph,
      servicesRoot: config.servicesRoot,
      workspaceRoot: config.workspaceRoot,
      version: config.version,
      sharedGlobalEnv,
      trustedChatBridge: isTrustedChatBridgeRequest(request),
    });

    writeJson(response, commandResponse.statusCode, commandResponse);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/operator/confirmations") {
    const runtimeModel = await loadRuntimeModel(config.servicesRoot);
    writeJson(
      response,
      201,
      await issueOperatorCommandConfirmation(await readJsonBody(request) as OperatorCommandConfirmationIssueRequest, {
        workspaceRoot: config.workspaceRoot,
        registry: runtimeModel.registry,
        trustedChatBridge: isTrustedChatBridgeRequest(request),
      }),
    );
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/operator/confirmations/")) {
    const pathParts = url.pathname.split("/").filter(Boolean);
    if (pathParts.length !== 5 || (pathParts[4] !== "confirm" && pathParts[4] !== "execute")) {
      throw new ApiError("invalid_action", 400, "Unknown operator confirmation route.");
    }
    const runtimeModel = await loadRuntimeModel(config.servicesRoot);
    const confirmationId = decodeURIComponent(pathParts[3] ?? "");
    const confirmationModel = {
      workspaceRoot: config.workspaceRoot,
      registry: runtimeModel.registry,
      trustedChatBridge: isTrustedChatBridgeRequest(request),
    };
    if (pathParts[4] === "confirm") {
      const confirmationResponse = await confirmOperatorCommandConfirmation(
        confirmationId,
        await readJsonBody(request) as OperatorCommandConfirmationConfirmRequest,
        confirmationModel,
      );
      writeJson(response, 200, confirmationResponse);
      return;
    }

    const executionResponse = await executeOperatorCommandConfirmation(
      confirmationId,
      await readJsonBody(request) as OperatorCommandConfirmationExecuteRequest,
      confirmationModel,
      async (record) => {
        const service = runtimeModel.registry.getById(record.targetServiceId);
        if (!service) {
          throw new ApiError("service_not_found", 404, `Unknown service id: ${record.targetServiceId}.`);
        }
        return await executeLifecycleAction(record.command, service, runtimeModel.registry, config.workspaceRoot);
      },
    );
    writeJson(response, executionResponse.action.ok ? 200 : 409, executionResponse);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/operator/actions") {
    writeJson(response, 200, {
      queue: await readOperatorActionQueue(config.workspaceRoot),
    });
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/api/operator/actions/")) {
    const pathParts = url.pathname.split("/").filter(Boolean);
    const actionId = decodeURIComponent(pathParts[3] ?? "");
    const resource = pathParts[4];
    if (actionId && resource === "acknowledgements") {
      writeJson(response, 200, {
        itemId: actionId,
        acknowledgements: await readOperatorActionAcknowledgementHistory(config.workspaceRoot, actionId),
      });
      return;
    }
  }

  if (request.method === "POST" && url.pathname === "/api/operator/actions/record") {
    try {
      const queue = await upsertOperatorActionItem(config.workspaceRoot, parseOperatorActionRecordBody(await readJsonBody(request)));
      await appendOperatorActionQueueAuditEvent({
        workspaceRoot: config.workspaceRoot,
        action: "operator.action.record",
        routeTemplate: "/api/operator/actions/record",
        outcome: "success",
        statusCode: 200,
        item: getOperatorActionAuditItem(queue),
      });
      writeJson(response, 200, {
        queue,
      });
    } catch (error) {
      await appendOperatorActionQueueAuditEvent({
        workspaceRoot: config.workspaceRoot,
        action: "operator.action.record",
        routeTemplate: "/api/operator/actions/record",
        outcome: "failure",
        statusCode: getApiErrorStatusCode(error),
        reason: getAuditFailureReason(error),
      });
      throw error;
    }
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/operator/actions/")) {
    const pathParts = url.pathname.split("/").filter(Boolean);
    const actionId = decodeURIComponent(pathParts[3] ?? "");
    const mutation = pathParts[4];
    if (!actionId || (mutation !== "acknowledge" && mutation !== "defer" && mutation !== "reopen")) {
      const error = new ApiError("invalid_action", 400, "Unknown operator action mutation route.");
      await appendOperatorActionQueueAuditEvent({
        workspaceRoot: config.workspaceRoot,
        action: "operator.action.reopen",
        routeTemplate: "/api/operator/actions/:id/:mutation",
        outcome: "failure",
        statusCode: getApiErrorStatusCode(error),
        itemId: actionId,
        mutation: safeAuditText(mutation),
        reason: getAuditFailureReason(error),
      });
      throw error;
    }
    const auditAction =
      mutation === "acknowledge"
        ? "operator.action.acknowledge"
        : mutation === "defer"
          ? "operator.action.defer"
          : "operator.action.reopen";
    try {
      const body = parseOperatorActionMutationBody(await readJsonBody(request));
      const queue = await mutateOperatorActionItem(config.workspaceRoot, actionId, mutation, body);
      await appendOperatorActionQueueAuditEvent({
        workspaceRoot: config.workspaceRoot,
        action: auditAction,
        routeTemplate: "/api/operator/actions/:id/:mutation",
        outcome: "success",
        statusCode: 200,
        item: getOperatorActionAuditItem(queue, actionId),
        actor: body.actor,
        reason: body.reason,
        mutation,
      });
      writeJson(response, 200, {
        queue,
      });
    } catch (error) {
      await appendOperatorActionQueueAuditEvent({
        workspaceRoot: config.workspaceRoot,
        action: auditAction,
        routeTemplate: "/api/operator/actions/:id/:mutation",
        outcome: "failure",
        statusCode: getApiErrorStatusCode(error),
        itemId: actionId,
        mutation,
        reason: getAuditFailureReason(error),
      });
      throw error;
    }
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
    const result = await checkServiceUpdatesForCli(runtimeModel.registry.list(), body.serviceId);
    await Promise.all(result.services.map(async (checked) => {
      const service = runtimeModel.registry.getById(checked.serviceId);
      if (!service) {
        return;
      }

      await appendAuditEvent({
        serviceRoot: service.serviceRoot,
        source: "runtime-api",
        action: "service.update.check",
        actor: "unknown",
        subject: "update-check",
        serviceId: checked.serviceId,
        method: "POST",
        routeTemplate: "/api/updates/check",
        outcome: checked.result.status === "check_failed" || checked.result.status === "unavailable" ? "failure" : "success",
        statusCode: 200,
        summary: `Update check returned ${checked.result.status}; recommended action ${checked.recommendedAction}.`,
        relatedRevisionId: checked.result.available?.tag ?? null,
      });
    }));
    writeJson(response, 200, result);
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
    const type = parseServiceLogReadType(url.searchParams.get("type"));

    if (!serviceId) {
      throw new ApiError("invalid_request", 400, "Missing required \"service\" query parameter.");
    }

    const service = runtimeModel.registry.getById(serviceId)
      ?? (!serviceId.startsWith("@") ? runtimeModel.registry.getById(`@${serviceId}`) : undefined);
    if (!service) {
      notFound(response);
      return;
    }

    writeJson(
      response,
      200,
      createServiceLogInfoResponse(await buildServiceLogInfo(service, type, getLifecycleState(service.manifest.id).runtime.logs.runId ?? "current")),
    );
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/logs/read") {
    const runtimeModel = await loadRuntimeModel(config.servicesRoot);
    const serviceId = url.searchParams.get("service");
    const type = parseServiceLogReadType(url.searchParams.get("type"));
    const cursorParam = url.searchParams.get("cursor");
    const beforeParam = url.searchParams.get("before");
    const limitParam = url.searchParams.get("limit");

    if (!serviceId) {
      throw new ApiError("invalid_request", 400, "Missing required \"service\" query parameter.");
    }

    const service = runtimeModel.registry.getById(serviceId)
      ?? (!serviceId.startsWith("@") ? runtimeModel.registry.getById(`@${serviceId}`) : undefined);
    if (!service) {
      notFound(response);
      return;
    }

    const before = parseOptionalInteger(cursorParam) ?? parseOptionalInteger(beforeParam);
    const limit = parseOptionalInteger(limitParam);

    writeJson(
      response,
      200,
      createServiceLogChunkResponse(await readServiceLogChunk(service, before, limit, type, getLifecycleState(service.manifest.id).runtime.logs.runId ?? "current")),
    );
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/logs/search") {
    const runtimeModel = await loadRuntimeModel(config.servicesRoot);
    const serviceId = url.searchParams.get("service");
    const type = parseServiceLogReadType(url.searchParams.get("type"));
    const query = url.searchParams.get("q") ?? url.searchParams.get("query");
    const cursor = parseOptionalInteger(url.searchParams.get("cursor"));
    const limit = parseOptionalInteger(url.searchParams.get("limit"));
    const includeArchives = parseBooleanQuery(url.searchParams.get("includeArchives"));

    if (!serviceId) {
      throw new ApiError("invalid_request", 400, "Missing required \"service\" query parameter.");
    }

    if (query === null || query.trim().length === 0) {
      throw new ApiError("invalid_request", 400, "Missing required \"q\" query parameter.");
    }

    const service = runtimeModel.registry.getById(serviceId)
      ?? (!serviceId.startsWith("@") ? runtimeModel.registry.getById(`@${serviceId}`) : undefined);
    if (!service) {
      notFound(response);
      return;
    }

    writeJson(
      response,
      200,
      createServiceLogSearchResponse(await searchServiceLogs(service, query, { cursor, includeArchives, limit, type })),
    );
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
      let auditActor = "unknown";
      let auditReason: string | null = null;
      try {
        const { patch, actor, reason } = parseServiceMetaPatch(await readJsonBody(request));
        auditActor = actor?.trim() || "unknown";
        auditReason = reason?.trim() || null;
        const persisted = await writeServiceMeta(service.serviceRoot, patch);
        const changedFields = [
          patch.favorite !== undefined ? "favorite" : null,
          "dependencyGraphPosition" in patch ? "dependencyGraphPosition" : null,
        ].filter((field): field is string => Boolean(field));

        await appendAuditEvent({
          serviceRoot: service.serviceRoot,
          source: "runtime-api",
          action: "service.meta.update",
          actor: auditActor,
          subject: "service-meta",
          serviceId,
          method: "PATCH",
          routeTemplate: "/api/services/:serviceId/meta",
          outcome: "success",
          statusCode: 200,
          summary: changedFields.join(", "),
          reason: auditReason,
          metadata: {
            changedFields,
            favorite: persisted.favorite,
            dependencyGraphPosition: persisted.dependencyGraphPosition
              ? {
                  x: persisted.dependencyGraphPosition.x,
                  y: persisted.dependencyGraphPosition.y,
                }
              : null,
          },
        });
        writeJson(
          response,
          200,
          createServiceMetaResponse(serviceId, {
            id: serviceId,
            favorite: persisted.favorite,
            dependencyGraphPosition: persisted.dependencyGraphPosition,
          }),
        );
      } catch (error) {
        await appendAuditEvent({
          serviceRoot: service.serviceRoot,
          source: "runtime-api",
          action: "service.meta.update",
          actor: auditActor,
          subject: "service-meta",
          serviceId,
          method: "PATCH",
          routeTemplate: "/api/services/:serviceId/meta",
          outcome: "failure",
          statusCode: getApiErrorStatusCode(error),
          summary: "Failed to update service metadata.",
          reason: getAuditFailureReason(error),
          metadata: {
            validationStatus: "invalid",
          },
        });
        throw error;
      }
      return;
    }

    if (request.method === "GET" && pathParts.length === 4 && pathParts[3] === "health") {
      const lifecycle = getLifecycleState(serviceId);
      const health = await evaluateServiceHealth(service.manifest, lifecycle, service.serviceRoot, service, sharedGlobalEnv);
      const history = await recordServiceHealthTransition(service, health);
      writeJson(response, 200, createServiceHealthResponse(serviceId, health, history));
      return;
    }

    if (request.method === "GET" && pathParts.length === 5 && pathParts[3] === "health" && pathParts[4] === "history") {
      writeJson(response, 200, createServiceHealthHistoryResponse(serviceId, await readServiceHealthHistory(service)));
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

    if (request.method === "GET" && pathParts.length === 4 && pathParts[3] === "telemetry") {
      const knownServiceIds = new Set(runtimeModel.discovered.map((candidate) => candidate.manifest.id));
      writeJson(
        response,
        200,
        createServiceTelemetryPreviewResponse(
          await buildServiceTelemetrySnapshot(service, sharedGlobalEnv, knownServiceIds),
        ),
      );
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

    if (request.method === "GET" && pathParts.length === 4 && pathParts[3] === "config") {
      writeJson(response, 200, await readServiceConfigDocument(service, config.workspaceRoot));
      return;
    }

    if (request.method === "PUT" && pathParts.length === 4 && pathParts[3] === "config") {
      let requestBody: unknown;
      let body: { content: string; actor?: string; reason?: string | null } | undefined;
      const relativeConfigPath = path.relative(service.serviceRoot, service.manifestPath).split(path.sep).join("/");
      try {
        requestBody = await readJsonBody(request);
        body = parseServiceConfigSaveBody(requestBody);
        const result = await saveServiceConfigDocument(service, config.workspaceRoot, body);
        await appendAuditEvent({
          serviceRoot: service.serviceRoot,
          source: "runtime-api",
          action: "service.config.save",
          actor: result.backup.actor,
          subject: "server.json",
          serviceId,
          method: "PUT",
          routeTemplate: "/api/services/:serviceId/config",
          outcome: "success",
          statusCode: 200,
          summary: "Saved service config document.",
          reason: result.backup.reason,
          relatedRevisionId: result.backup.id,
          metadata: {
            configPath: result.backup.path,
            previousHash: result.backup.previousHash,
            currentHash: result.backup.currentHash,
            validationStatus: result.backup.validationStatus,
          },
        });
        writeJson(response, 200, result);
      } catch (error) {
        const requestRecord =
          requestBody && typeof requestBody === "object" && !Array.isArray(requestBody)
            ? (requestBody as Record<string, unknown>)
            : {};
        const requestedContent = body?.content ?? requestRecord.content;
        const requestedReason = body?.reason ?? (typeof requestRecord.reason === "string" ? requestRecord.reason : null);
        await appendAuditEvent({
          serviceRoot: service.serviceRoot,
          source: "runtime-api",
          action: "service.config.save",
          actor: body?.actor ?? getAuditActor(requestBody),
          subject: "server.json",
          serviceId,
          method: "PUT",
          routeTemplate: "/api/services/:serviceId/config",
          outcome: "failure",
          statusCode: getApiErrorStatusCode(error),
          summary: "Failed to save service config document.",
          reason: getAuditFailureReason(error),
          metadata: {
            configPath: relativeConfigPath,
            previousHash: await hashFileContent(service.manifestPath),
            currentHash: typeof requestedContent === "string" ? sha256(requestedContent) : null,
            validationStatus: "invalid",
            requestedReason: typeof requestedReason === "string" && requestedReason.trim() ? requestedReason.trim() : null,
          },
        });
        throw error;
      }
      return;
    }

    if (request.method === "GET" && pathParts.length === 5 && pathParts[3] === "config" && pathParts[4] === "backups") {
      writeJson(response, 200, {
        serviceId,
        fileName: "server.json",
        revisions: await listServiceConfigRevisions(service, config.workspaceRoot),
      });
      return;
    }

    if (request.method === "GET" && pathParts.length === 4 && pathParts[3] === "config-drift") {
      writeJson(response, 200, {
        drift: await buildServiceConfigDriftReport(service, runtimeModel.registry.list()),
      });
      return;
    }

    if (request.method === "GET" && pathParts.length === 5 && pathParts[3] === "secrets" && pathParts[4] === "audit") {
      writeJson(response, 200, buildServiceSecretReferenceAudit(service));
      return;
    }

    if (request.method === "GET" && pathParts.length === 5 && pathParts[3] === "secrets" && pathParts[4] === "rotation-readiness") {
      writeJson(response, 200, buildServiceSecretRotationReadinessReport(service));
      return;
    }

    if (request.method === "GET" && pathParts.length === 5 && pathParts[3] === "secrets" && pathParts[4] === "provider-auth-required") {
      writeJson(response, 200, buildServiceSecretProviderAuthRequiredSummary(service));
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

    if (request.method === "GET" && pathParts.length === 5 && pathParts[3] === "recovery" && pathParts[4] === "restart-preflight") {
      writeJson(response, 200, {
        serviceId,
        preflight: buildRestartSafetyPreflightReport(service, runtimeModel.registry),
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

    if (request.method === "GET" && pathParts.length === 4 && pathParts[3] === "actions") {
      const payload: ServiceActionRunsResponse = {
        serviceId,
        runs: await listServiceActionRuns(service),
      };
      writeJson(response, 200, payload);
      return;
    }

    if (request.method === "GET" && pathParts.length === 6 && pathParts[3] === "actions" && pathParts[5] === "runs") {
      const actionId = decodeURIComponent(pathParts[4] ?? "");
      const payload: ServiceActionRunsResponse = {
        serviceId,
        actionId,
        runs: await listServiceActionRuns(service, actionId),
      };
      writeJson(response, 200, payload);
      return;
    }

    if (request.method === "POST" && pathParts.length === 6 && pathParts[3] === "actions" && pathParts[5] === "runs") {
      const actionId = decodeURIComponent(pathParts[4] ?? "");
      const requestBody = await readJsonBody(request);
      const auditActor = getAuditActor(requestBody);
      try {
        const payload: ServiceActionRunResponse = await runServiceAction(
          service,
          runtimeModel.registry,
          actionId,
          parseServiceActionRunRequest(requestBody),
        );
        await appendAuditEvent({
          serviceRoot: service.serviceRoot,
          source: "runtime-api",
          action: "service.action.run",
          actor: auditActor,
          subject: actionId,
          serviceId,
          method: "POST",
          routeTemplate: "/api/services/:serviceId/actions/:actionId/runs",
          outcome: payload.ok ? "success" : "failure",
          statusCode: 200,
          summary: `Service action ${actionId} completed from ${payload.run.metadata.source}.`,
          relatedRevisionId: payload.run.runId,
        });
        writeJson(response, 200, payload);
      } catch (error) {
        await appendAuditEvent({
          serviceRoot: service.serviceRoot,
          source: "runtime-api",
          action: "service.action.run",
          actor: auditActor,
          subject: actionId,
          serviceId,
          method: "POST",
          routeTemplate: "/api/services/:serviceId/actions/:actionId/runs",
          outcome: "failure",
          statusCode: getApiErrorStatusCode(error),
          summary: `Failed to run service action ${actionId}.`,
          reason: getAuditFailureReason(error),
        });
        throw error;
      }
      return;
    }

    if (request.method === "GET" && pathParts.length === 4 && pathParts[3] === "start-trace") {
      const startTrace = getLifecycleState(serviceId).runtime.startTrace;
      const payload: ServiceStartTraceResponse = {
        serviceId,
        trace: startTrace.current,
        history: startTrace.history,
      };
      writeJson(response, 200, payload);
      return;
    }

    if (request.method === "POST" && pathParts.length >= 5 && pathParts[3] === "setup" && pathParts[4] === "run") {
      const stepId = pathParts.length === 6 ? decodeURIComponent(pathParts[5] ?? "") : undefined;
      try {
        const result = await runServiceSetup(service, runtimeModel.registry, { stepId, includeManual: stepId !== undefined });
        await writeServiceState(service, result.state);
        await appendAuditEvent({
          serviceRoot: service.serviceRoot,
          source: "runtime-api",
          action: "service.setup.run",
          actor: "unknown",
          subject: stepId ?? "all",
          serviceId,
          method: "POST",
          routeTemplate: stepId ? "/api/services/:serviceId/setup/run/:stepId" : "/api/services/:serviceId/setup/run",
          outcome: result.ok ? "success" : "failure",
          statusCode: 200,
          summary: `Setup run completed for ${result.runs.length} step(s), ${result.skipped.length} skipped.`,
          relatedRevisionId: result.runs[0]?.runId ?? null,
        });
        writeJson(response, 200, result);
      } catch (error) {
        await appendAuditEvent({
          serviceRoot: service.serviceRoot,
          source: "runtime-api",
          action: "service.setup.run",
          actor: "unknown",
          subject: stepId ?? "all",
          serviceId,
          method: "POST",
          routeTemplate: stepId ? "/api/services/:serviceId/setup/run/:stepId" : "/api/services/:serviceId/setup/run",
          outcome: "failure",
          statusCode: getApiErrorStatusCode(error),
          summary: "Failed to run service setup.",
          reason: getAuditFailureReason(error),
        });
        throw error;
      }
      return;
    }

    if (request.method === "POST" && pathParts.length === 5 && pathParts[3] === "recovery" && pathParts[4] === "doctor") {
      try {
        const doctor = await runAndRecordDoctorPreflight(service);
        await appendAuditEvent({
          serviceRoot: service.serviceRoot,
          source: "runtime-api",
          action: "service.recovery.doctor",
          actor: "unknown",
          subject: "doctor",
          serviceId,
          method: "POST",
          routeTemplate: "/api/services/:serviceId/recovery/doctor",
          outcome: doctor.ok ? "success" : "failure",
          statusCode: 200,
          summary: `Recovery doctor completed with ${doctor.steps.length} step(s).`,
        });
        writeJson(response, 200, {
          serviceId,
          doctor,
          recovery: await readServiceRecoveryHistory(service),
        });
      } catch (error) {
        await appendAuditEvent({
          serviceRoot: service.serviceRoot,
          source: "runtime-api",
          action: "service.recovery.doctor",
          actor: "unknown",
          subject: "doctor",
          serviceId,
          method: "POST",
          routeTemplate: "/api/services/:serviceId/recovery/doctor",
          outcome: "failure",
          statusCode: getApiErrorStatusCode(error),
          summary: "Failed to run recovery doctor.",
          reason: getAuditFailureReason(error),
        });
        throw error;
      }
      return;
    }

    if (request.method === "POST" && pathParts.length === 5 && pathParts[3] === "update" && pathParts[4] === "download") {
      try {
        const result = await downloadServiceUpdateCandidate(service);
        await appendAuditEvent({
          serviceRoot: service.serviceRoot,
          source: "runtime-api",
          action: "service.update.download",
          actor: "unknown",
          subject: "update-candidate",
          serviceId,
          method: "POST",
          routeTemplate: "/api/services/:serviceId/update/download",
          outcome: "success",
          statusCode: 200,
          summary: `Downloaded update candidate with status ${result.result.status}.`,
          relatedRevisionId: result.update.available?.tag ?? null,
        });
        writeJson(response, 200, result);
      } catch (error) {
        await appendAuditEvent({
          serviceRoot: service.serviceRoot,
          source: "runtime-api",
          action: "service.update.download",
          actor: "unknown",
          subject: "update-candidate",
          serviceId,
          method: "POST",
          routeTemplate: "/api/services/:serviceId/update/download",
          outcome: "failure",
          statusCode: getApiErrorStatusCode(error),
          summary: "Failed to download update candidate.",
          reason: getAuditFailureReason(error),
        });
        throw error;
      }
      return;
    }

    if (request.method === "POST" && pathParts.length === 5 && pathParts[3] === "update" && pathParts[4] === "install") {
      try {
        const body = parseUpdateInstallBody(await readJsonBody(request));
        const result = await installServiceUpdateCandidate(service, { force: body.force, registry: runtimeModel.registry });
        await appendAuditEvent({
          serviceRoot: service.serviceRoot,
          source: "runtime-api",
          action: "service.update.install",
          actor: "unknown",
          subject: "update-candidate",
          serviceId,
          method: "POST",
          routeTemplate: "/api/services/:serviceId/update/install",
          outcome: "success",
          statusCode: 200,
          summary: `Installed update candidate with force=${result.forced}.`,
          relatedRevisionId: result.state.installArtifacts.artifact?.tag ?? null,
        });
        writeJson(response, 200, result);
      } catch (error) {
        await appendAuditEvent({
          serviceRoot: service.serviceRoot,
          source: "runtime-api",
          action: "service.update.install",
          actor: "unknown",
          subject: "update-candidate",
          serviceId,
          method: "POST",
          routeTemplate: "/api/services/:serviceId/update/install",
          outcome: "failure",
          statusCode: getApiErrorStatusCode(error),
          summary: "Failed to install update candidate.",
          reason: getAuditFailureReason(error),
        });
        throw error;
      }
      return;
    }

    if (request.method === "GET" && pathParts.length === 6 && pathParts[3] === "update" && pathParts[4] === "install" && pathParts[5] === "plan") {
      writeJson(response, 200, await buildUpdateInstallDryRunPlan(service, { force: url.searchParams.get("force") === "true" }));
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
      try {
        const result = await executeLifecycleAction(action, service, runtimeModel.registry, config.workspaceRoot);
        await appendAuditEvent({
          serviceRoot: service.serviceRoot,
          source: "runtime-api",
          action: `service.lifecycle.${action}`,
          actor: "unknown",
          subject: "service-lifecycle",
          serviceId,
          method: "POST",
          routeTemplate: "/api/services/:serviceId/:action",
          outcome: result.ok ? "success" : "failure",
          statusCode: 200,
          summary: result.message,
        });
        writeJson(response, 200, result);
      } catch (error) {
        await appendAuditEvent({
          serviceRoot: service.serviceRoot,
          source: "runtime-api",
          action: `service.lifecycle.${action}`,
          actor: "unknown",
          subject: "service-lifecycle",
          serviceId,
          method: "POST",
          routeTemplate: "/api/services/:serviceId/:action",
          outcome: "failure",
          statusCode: getApiErrorStatusCode(error),
          summary: `Failed to execute lifecycle action ${action}.`,
          reason: getAuditFailureReason(error),
        });
        throw error;
      }
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

  if (request.method === "GET" && url.pathname === "/api/runtime/instance") {
    writeJson(response, 200, await createRuntimeInstanceSnapshot(config));
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

  if (request.method === "GET" && url.pathname === "/api/runtime/ports/conflict") {
    const port = parseOptionalInteger(url.searchParams.get("port"));
    if (!isUsablePort(port)) {
      throw new ApiError("invalid_request", 400, '"port" query parameter must be an integer between 1 and 65535.');
    }

    writeJson(
      response,
      200,
      await explainPortConflict({
        workspaceRoot: config.workspaceRoot,
        host: url.searchParams.get("host"),
        port,
        serviceId: url.searchParams.get("serviceId"),
        portName: url.searchParams.get("portName"),
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
    try {
      const result = await executeRuntimeOrchestrationAction(action, runtimeModel, config.workspaceRoot);
      await appendAuditEvent({
        workspaceRoot: config.workspaceRoot,
        source: "runtime-api",
        action: `runtime.${action}`,
        actor: "unknown",
        subject: "runtime",
        method: "POST",
        routeTemplate: "/api/runtime/actions/:action",
        outcome: result.ok ? "success" : "failure",
        statusCode: 200,
        summary: `Runtime action ${action} completed for ${result.results.length} service result(s).`,
      });
      writeJson(response, 200, result);
    } catch (error) {
      await appendAuditEvent({
        workspaceRoot: config.workspaceRoot,
        source: "runtime-api",
        action: `runtime.${action}`,
        actor: "unknown",
        subject: "runtime",
        method: "POST",
        routeTemplate: "/api/runtime/actions/:action",
        outcome: "failure",
        statusCode: getApiErrorStatusCode(error),
        summary: `Failed to execute runtime action ${action}.`,
        reason: getAuditFailureReason(error),
      });
      throw error;
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/runtime/actions/importService/plan") {
    const manifestPath = url.searchParams.get("manifestPath");
    if (!manifestPath) {
      throw new ApiError("invalid_request", 400, '"manifestPath" query parameter is required.');
    }

    writeJson(
      response,
      200,
      await buildAppServiceImportDryRunPlan({
        manifestPath,
        servicesRoot: config.servicesRoot,
      }),
    );
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/api/runtime/actions/") && url.pathname.endsWith("/plan")) {
    const pathParts = url.pathname.split("/").filter(Boolean);
    const action = pathParts[3];

    if (action !== "startAll" && action !== "stopAll" && action !== "autostart") {
      throw new ApiError("invalid_action", 400, "Unknown runtime plan action: " + action);
    }

    const runtimeModel = await loadRuntimeModel(config.servicesRoot);
    writeJson(response, 200, buildRuntimeOrchestrationDryRunPlan(action, runtimeModel.graph, runtimeModel.registry));
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

  if (request.method === "GET" && url.pathname.startsWith("/api/dependencies/")) {
    const pathParts = url.pathname.split("/").filter(Boolean);
    const serviceId = decodeURIComponent(pathParts[2] ?? "");

    if (pathParts.length === 4 && pathParts[3] === "dependents") {
      const runtimeModel = await loadRuntimeModel(config.servicesRoot);
      writeJson(response, 200, createDependencyReverseLookupResponse(runtimeModel.graph.getReverseDependencies(serviceId)));
      return;
    }
  }

  if (request.method === "GET" && url.pathname === "/api/diagnostics/dependencies") {
    const runtimeModel = await loadRuntimeModel(config.servicesRoot);
    const sharedGlobalEnv = collectRuntimeGlobalEnv(runtimeModel.registry.list());
    writeJson(response, 200, {
      diagnostics: await buildBaselineDependencyDiagnostics(
        runtimeModel.discovered,
        runtimeModel.registry,
        runtimeModel.graph,
        sharedGlobalEnv,
      ),
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/diagnostics/bundle") {
    const serviceId = url.searchParams.get("serviceId") ?? undefined;
    writeJson(response, 200, await buildDiagnosticsBundle({
      servicesRoot: config.servicesRoot,
      workspaceRoot: config.workspaceRoot,
      version: config.version,
      serviceId,
    }));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/secrets/audit") {
    const runtimeModel = await loadRuntimeModel(config.servicesRoot);
    writeJson(response, 200, buildSecretReferenceAudit(runtimeModel.discovered));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/secrets/rotation-readiness") {
    const runtimeModel = await loadRuntimeModel(config.servicesRoot);
    writeJson(response, 200, buildSecretRotationReadinessReport(runtimeModel.discovered));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/secrets/provider-auth-required") {
    const runtimeModel = await loadRuntimeModel(config.servicesRoot);
    writeJson(response, 200, buildSecretProviderAuthRequiredSummary(runtimeModel.discovered));
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

  if (request.method === "GET" && url.pathname === "/api/telemetry") {
    writeJson(
      response,
      200,
      createRuntimeTelemetryPreviewResponse(
        await buildRuntimeTelemetrySnapshot(
          config,
          apiRequestTelemetry,
          getApiRequestTelemetryDroppedCount,
          getTelemetryContinuousExportState(),
        ),
      ),
    );
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/telemetry/export-test") {
    const telemetry = await buildRuntimeTelemetrySnapshot(
      config,
      apiRequestTelemetry,
      getApiRequestTelemetryDroppedCount,
      getTelemetryContinuousExportState(),
    );
    writeJson(response, 200, { exportTest: await sendRuntimeTelemetryMockExport(telemetry) });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/telemetry/export") {
    const telemetry = await buildRuntimeTelemetrySnapshot(
      config,
      apiRequestTelemetry,
      getApiRequestTelemetryDroppedCount,
      getTelemetryContinuousExportState(),
    );
    writeJson(response, 200, { export: await sendRuntimeTelemetryExport(telemetry) });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/log-shipping") {
    const runtimeModel = await loadRuntimeModel(config.servicesRoot);
    const services = runtimeModel.discovered.map((service) => ({
      service,
      lifecycle: getLifecycleState(service.manifest.id),
    }));
    writeJson(response, 200, createRuntimeLogShippingPreviewResponse(await buildRuntimeLogShippingPreview(services)));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/log-shipping/export-test") {
    const runtimeModel = await loadRuntimeModel(config.servicesRoot);
    const services = runtimeModel.discovered.map((service) => ({
      service,
      lifecycle: getLifecycleState(service.manifest.id),
    }));
    const logShipping = await buildRuntimeLogShippingPreview(services);
    writeJson(response, 200, { exportTest: await sendRuntimeLogShippingMockExport(logShipping) });
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
  const apiRequestTelemetryState = options.apiRequestTelemetryState ?? { requests: [], droppedCount: 0 };
  const apiRequestTelemetry = apiRequestTelemetryState.requests;
  const getTelemetryContinuousExportState = () => options.telemetryExportScheduler?.getStatus() ?? null;

  return createServer((request, response) => {
    const startedAt = performance.now();
    const method = request.method ?? "GET";
    const route = classifyTelemetryRoute(new URL(request.url ?? "/", "http://localhost").pathname);
    const telemetryIdentity = createApiRequestTelemetryIdentity();
    response.setHeader(TELEMETRY_CORRELATION_ID_HEADER, telemetryIdentity.correlationId);
    response.setHeader(TELEMETRY_TRACE_ID_HEADER, telemetryIdentity.traceId);
    response.setHeader(TELEMETRY_TRACEPARENT_HEADER, telemetryIdentity.traceparent);

    response.once("finish", () => {
      apiRequestTelemetry.push(buildApiRequestTelemetryPreview({
        method,
        routeGroup: route.routeGroup,
        routeTemplate: route.routeTemplate,
        mutating: route.mutating || isMutatingHttpMethod(method),
        statusCode: response.statusCode,
        durationMs: performance.now() - startedAt,
        identity: telemetryIdentity,
      }));
      if (apiRequestTelemetry.length > API_TELEMETRY_BUFFER_LIMIT) {
        const overflowCount = apiRequestTelemetry.length - API_TELEMETRY_BUFFER_LIMIT;
        apiRequestTelemetry.splice(0, overflowCount);
        apiRequestTelemetryState.droppedCount += overflowCount;
      }
    });

    void routeRequest(
      request,
      response,
      routeConfig,
      workflowRunFacadeState,
      apiRequestTelemetry,
      () => apiRequestTelemetryState.droppedCount,
      getTelemetryContinuousExportState,
    ).catch((error: unknown) => {
      const body = toApiErrorBody(error);
      writeJson(response, body.statusCode, body);
    });
  });
}

export async function startApiServer(options: ApiServerOptions = {}): Promise<RunningApiServer> {
  const bindHost = options.host ?? process.env.SERVICE_LASSO_HOST ?? "0.0.0.0";
  const publicHost = bindHost === "0.0.0.0" ? "127.0.0.1" : bindHost;
  const config = await ensureRuntimeConfig(resolveRuntimeConfig(options));
  const bootModel = await loadRuntimeModel(config.servicesRoot);
  await rehydrateDiscoveredServices(bootModel.discovered);
  const requestedPort = options.port ?? 18080;
  const activeReservations = [...toServicePortReservations(bootModel)];
  if (requestedPort !== 0) {
    activeReservations.push(toApiPortReservation(requestedPort, bindHost));
    await reservePorts(config.workspaceRoot, [toApiPortReservation(requestedPort, bindHost)]);
  }
  await reconcilePortReservationLedger(
    config.workspaceRoot,
    activeReservations,
    "not present in rehydrated runtime state",
  );
  if (options.autostart) {
    await executeRuntimeOrchestrationAction("autostart", bootModel, config.workspaceRoot);
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
  const apiRequestTelemetryState: ApiRequestTelemetryState = { requests: [], droppedCount: 0 };
  let telemetryExportScheduler: RuntimeTelemetryExportScheduler | null = null;
  telemetryExportScheduler = createRuntimeTelemetryExportScheduler({
    collectTelemetry: (status) =>
      buildRuntimeTelemetrySnapshot(
        config,
        apiRequestTelemetryState.requests,
        () => apiRequestTelemetryState.droppedCount,
        status,
      ),
  });
  const server = createApiServer({
    ...config,
    autostart: options.autostart,
    monitor: options.monitor,
    updateScheduler: options.updateScheduler,
    telemetryExportScheduler,
    apiRequestTelemetryState,
    workflowRunFacadeState: options.workflowRunFacadeState,
  });
  const port = requestedPort;

  server.listen(port, bindHost);
  await once(server, "listening");
  monitor?.start();
  updateScheduler?.start();
  telemetryExportScheduler.start();

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("API server failed to expose a TCP address.");
  }

  const resolvedPort = address.port;
  const instance = await registerRuntimeInstance(config, {
    apiPort: resolvedPort,
    apiUrl: "http://" + publicHost + ":" + resolvedPort,
  });
  const leaseHeartbeat = setInterval(() => {
    void refreshRuntimeInstanceLease(config).catch(() => undefined);
  }, DEFAULT_RUNTIME_INSTANCE_HEARTBEAT_INTERVAL_MS);
  leaseHeartbeat.unref?.();
  if (requestedPort === 0) {
    await reservePorts(config.workspaceRoot, [toApiPortReservation(resolvedPort, bindHost)]);
  }

  return {
    server,
    port: resolvedPort,
    url: instance.apiUrl,
    monitor,
    updateScheduler,
    telemetryExportScheduler,
    stop: async () => {
      clearInterval(leaseHeartbeat);
      await monitor?.stop();
      await updateScheduler?.stop();
      await telemetryExportScheduler?.stop();
      await stopAllManagedProcesses();
      await markRuntimeInstanceStopped(config);
      server.close();
      await once(server, "close");
    },
  };
}
