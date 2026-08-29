import type { IncomingMessage, ServerResponse } from "node:http";
import type { Readable, Writable } from "node:stream";
import { createHash } from "node:crypto";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { assertMcpScopes, type McpHttpAuthorization, type McpOperatingMode } from "./mcp-auth.js";
import {
  assertMcpGuardedActionAuthorization,
  auditMcpGuardedActionSchemaDenial,
  guardedActionExecutionId,
  guardedActionPolicy,
  invokeMcpGuardedAction,
  McpGuardedActionError,
  readMcpGuardedActionExecution,
  type McpGuardedActionFacade,
  type McpGuardedActionInput,
  type McpGuardedActionName,
  type McpGuardedActionProgressUpdate,
} from "./mcp-guarded-actions.js";
import {
  MCP_OPERATION_ACCEPTED_CONTRACT_VERSION,
  MCP_OPERATION_CONTRACT_VERSION,
  MAX_MCP_OPERATION_LIST_LIMIT,
  McpOperationError,
  McpOperationService,
  isDurableMcpAction,
  isSafelyCancellableMcpAction,
  type McpOperationServiceOptions,
} from "./mcp-operations.js";
import type { DiscoveredService } from "../../contracts/service.js";
import type { ServiceHealthResult } from "../health/types.js";
import type { AuditQuery } from "../../contracts/api.js";
import { evaluateServiceHealth } from "../health/evaluateHealth.js";
import { getLifecycleState } from "../lifecycle/store.js";
import type { ServiceRegistry } from "../manager/ServiceRegistry.js";
import type { DependencyGraph } from "../manager/DependencyGraph.js";
import { buildEffectiveRouteMetadata } from "./endpoints.js";
import { readServiceLogChunk } from "./logs.js";
import { buildBaselineDependencyDiagnostics } from "./dependencyDiagnostics.js";
import { readAuditEvents } from "../audit/store.js";
import { readServiceUpdateState } from "../updates/state.js";
import { buildServiceConfigDriftReport } from "./config-drift.js";
import { readServiceRecoveryHistory } from "../recovery/history.js";
import {
  buildSecretReferenceAudit,
  buildSecretRotationReadinessReport,
} from "./secret-audit.js";
import { redactDiagnosticsValue } from "../diagnostics/bundle.js";

export interface ServiceLassoMcpContext {
  version: string;
  servicesRoot: string;
  workspaceRoot?: string;
  discovered: DiscoveredService[];
  registry: ServiceRegistry;
  graph: DependencyGraph;
  sharedGlobalEnv: Record<string, string>;
  guardedActionFacade?: McpGuardedActionFacade;
  mcpOperatingMode?: McpOperatingMode;
}

export interface ServiceLassoMcpServerOptions {
  authorization?: McpHttpAuthorization;
  operatingMode?: McpOperatingMode;
  operationRequestBudgetMs?: number;
  operationRetentionMs?: number;
  operationNow?: () => Date;
  operationRecoverDetached?: McpOperationServiceOptions["recoverDetached"];
  operationCancelDetached?: McpOperationServiceOptions["cancelDetached"];
}

export interface ServiceLassoMcpStdioOptions {
  stdin?: Readable;
  stdout?: Writable;
  operatingMode?: McpOperatingMode;
}

export interface RunningServiceLassoMcpStdioAdapter {
  close: () => Promise<void>;
}

export interface McpJsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

interface McpToolDefinition {
  name: ServiceLassoMcpToolName;
  title: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: false;
  };
  outputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
}

interface McpResourceDefinition {
  uri: ServiceLassoMcpStaticResourceUri;
  name: string;
  description: string;
  mimeType: "application/json";
}

type ServiceLassoMcpToolName =
  | "service_lasso_runtime_status"
  | "service_lasso_list_services"
  | "service_lasso_get_service"
  | "service_lasso_get_health"
  | "service_lasso_list_routes"
  | "service_lasso_dependency_status"
  | "service_lasso_logs_summary"
  | "service_lasso_audit_search"
  | "service_lasso_update_status"
  | "service_lasso_config_drift"
  | "service_lasso_recovery_status"
  | "service_lasso_operation_status"
  | "service_lasso_list_operations"
  | "service_lasso_cancel_operation"
  | "service_lasso_diagnostics_summary"
  | "service_lasso_secret_metadata"
  | "service_lasso_start_service"
  | "service_lasso_stop_service"
  | "service_lasso_restart_service"
  | "service_lasso_install_service"
  | "service_lasso_configure_service"
  | "service_lasso_run_setup_step"
  | "service_lasso_check_updates"
  | "service_lasso_download_update"
  | "service_lasso_install_update"
  | "service_lasso_start_all"
  | "service_lasso_stop_all";

type ServiceLassoMcpStaticResourceUri =
  | "servicelasso://runtime"
  | "servicelasso://services"
  | "servicelasso://health"
  | "servicelasso://routes"
  | "servicelasso://dependencies"
  | "servicelasso://diagnostics"
  | "servicelasso://secret-metadata";

type ServiceLassoMcpResourceTemplateUri =
  | "servicelasso://services/{serviceId}"
  | "servicelasso://services/{serviceId}/health"
  | "servicelasso://services/{serviceId}/routes"
  | "servicelasso://services/{serviceId}/dependencies"
  | "servicelasso://services/{serviceId}/updates"
  | "servicelasso://services/{serviceId}/drift"
  | "servicelasso://services/{serviceId}/recovery";

interface McpResourceTemplateDefinition {
  uriTemplate: ServiceLassoMcpResourceTemplateUri;
  name: string;
  description: string;
  mimeType: "application/json";
}

type McpBrokerAvailability = "available" | "unavailable" | "not_discovered";
type McpLockoutQueryStatus = "not_queried";

interface McpSecretMetadataBroker {
  serviceId: string | null;
  discovered: boolean;
  installed: boolean | null;
  configured: boolean | null;
  running: boolean | null;
  availability: McpBrokerAvailability;
}

interface McpJsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

const CONTRACT_VERSION = "service-lasso-mcp.v1";
const MCP_PROTOCOL_VERSION = "2024-11-05";
const MCP_SDK_PACKAGE = "@modelcontextprotocol/sdk";
const MCP_SDK_VERSION = "1.30.0";
const REDACTION_VALUE = "[REDACTED]";
const DEFAULT_LOG_LIMIT = 20;
const MAX_LOG_LIMIT = 50;
const DEFAULT_SERVICE_LIMIT = 50;
const MAX_SERVICE_LIMIT = 100;
const DEFAULT_AUDIT_LIMIT = 50;
const MAX_AUDIT_LIMIT = 100;
const DEFAULT_RECOVERY_LIMIT = 20;
const MAX_RECOVERY_LIMIT = 100;
const SECRETS_BROKER_SERVICE_ID = "@secretsbroker";
const SECRET_METADATA_ARGUMENT_KEYS = ["serviceId"] as const;

const READ_ONLY_TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const guardedActionOutputSchema = z.object({
  contractVersion: z.literal("service-lasso-mcp-guarded-action.v1"),
  generatedAt: z.string(),
  action: z.enum([
    "service_start",
    "service_stop",
    "service_restart",
    "service_install",
    "service_configure",
    "setup_step_run",
    "update_check",
    "update_download",
    "update_install",
    "runtime_start_all",
    "runtime_stop_all",
  ]),
  status: z.enum(["preflight", "succeeded", "failed", "skipped", "replayed"]),
  ok: z.boolean(),
  correlationId: z.string(),
  preflight: z.object({
    planId: z.string(),
    targets: z.array(z.string().regex(/^@?[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u)).max(100)
      .refine((entries) => new Set(entries).size === entries.length),
    effects: z.array(z.string()).max(100),
    executable: z.boolean(),
    skippedReason: z.string().nullable(),
    requiredProfile: z.enum(["observer", "operator", "maintainer", "administrator"]),
  }).strict(),
  confirmation: z.object({
    required: z.boolean(),
    id: z.string().nullable(),
    status: z.enum(["not_required", "pending", "consumed"]),
    expiresAt: z.string().nullable(),
    confirmationPhrase: z.string().optional(),
  }).strict(),
  idempotency: z.object({
    keyId: z.string().nullable(),
    replayed: z.boolean(),
  }).strict(),
  summary: z.string(),
  result: z.object({
    targets: z.array(z.string().regex(/^@?[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u)).max(100)
      .refine((entries) => new Set(entries).size === entries.length),
    effects: z.array(z.string()).max(100),
    resultingState: z.array(z.object({
      serviceId: z.string().regex(/^@?[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u),
      installed: z.boolean(),
      configured: z.boolean(),
      running: z.boolean(),
    }).strict()).max(100).refine((entries) => new Set(entries.map((entry) => entry.serviceId)).size === entries.length),
  }).strict().nullable(),
  safety: z.object({
    mutating: z.boolean(),
    redacted: z.literal(true),
    omittedSensitiveFields: z.array(z.string()),
  }).strict(),
}).strict();

const optionalServiceIdSchema = z.string().trim().min(1).optional();
const requiredServiceIdSchema = z.string().regex(/^@?[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u);
const guardedSetupStepIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,199}$/u);
const cursorInputSchema = z.string().trim().min(1).max(32).optional();
const logLimitSchema = z.number().int().min(1).max(MAX_LOG_LIMIT).optional();
const serviceCursorSchema = z.string().trim().min(1).max(32).optional();
const serviceLimitSchema = z.number().int().min(1).max(MAX_SERVICE_LIMIT).optional();
const auditLimitSchema = z.number().int().min(1).max(MAX_AUDIT_LIMIT).optional();
const recoveryLimitSchema = z.number().int().min(1).max(MAX_RECOVERY_LIMIT).optional();
const guardedExecutionInputShape = {
  execute: z.boolean().optional(),
  idempotencyKey: z.string().regex(/^(?!(?:AKIA|ASIA)[A-Z0-9]{16}$)(?!gh[pousr]_)(?!xox[a-z]-)(?![A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$)[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u).optional(),
  confirmationId: z.string().regex(/^mcp-confirmation-[0-9a-f-]{36}$/u).optional(),
  confirmationPhrase: z.string().min(10).max(200).optional(),
  confirmationTtlSeconds: z.number().int().min(1).max(900).optional(),
};
const guardedServiceInputSchema = z.object({
  serviceId: requiredServiceIdSchema,
  ...guardedExecutionInputShape,
}).strict();
const guardedSetupInputSchema = z.object({
  serviceId: requiredServiceIdSchema,
  stepId: guardedSetupStepIdSchema,
  ...guardedExecutionInputShape,
}).strict();
const guardedUpdateInstallInputSchema = z.object({
  serviceId: requiredServiceIdSchema,
  force: z.boolean().optional(),
  ...guardedExecutionInputShape,
}).strict();
const guardedRuntimeInputSchema = z.object({ ...guardedExecutionInputShape }).strict();

const safetyOutputSchema = z.object({
  mutating: z.literal(false),
  redacted: z.literal(true),
  omittedSensitiveFields: z.array(z.string()).optional(),
}).strict();

const paginationOutputSchema = z.object({
  limit: z.number().int().nonnegative(),
  nextCursor: z.string().nullable(),
  total: z.number().int().nonnegative(),
}).strict();

const runtimeStatusOutputSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  generatedAt: z.string(),
  runtime: z.object({
    version: z.string(),
    serviceCount: z.number().int().nonnegative(),
    status: z.enum(["ready", "degraded"]),
  }).strict(),
  capabilities: z.object({
    services: z.literal(true),
    health: z.literal(true),
    routes: z.literal(true),
    dependencies: z.literal(true),
    redactedLogs: z.literal(true),
    durableAudit: z.boolean(),
    updates: z.literal(true),
    configDrift: z.literal(true),
    recovery: z.literal(true),
    guardedActions: z.boolean(),
    durableOperations: z.boolean(),
  }).strict(),
  safety: safetyOutputSchema,
}).strict();

const serviceDetailEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  enabled: z.boolean(),
  role: z.string(),
  version: z.string().nullable(),
  lifecycle: z.object({
    installed: z.boolean(),
    configured: z.boolean(),
    running: z.boolean(),
  }).strict(),
  dependencies: z.array(z.string()),
  dependents: z.array(z.string()),
  providerRequirements: z.array(z.object({
    capability: z.string(),
    requirement: z.string(),
    serviceId: z.string(),
    version: z.string(),
  }).strict()),
  ports: z.record(z.string(), z.number().int()),
}).strict();

const serviceDetailOutputSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  generatedAt: z.string(),
  service: serviceDetailEntrySchema,
  safety: safetyOutputSchema,
}).strict();

const servicesOutputSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  generatedAt: z.string(),
  services: z.array(serviceDetailEntrySchema),
  pagination: paginationOutputSchema,
  safety: safetyOutputSchema,
}).strict();

const healthCheckOutputSchema = z.object({
  id: z.string(),
  type: z.string(),
  required: z.boolean(),
  healthy: z.boolean(),
  attempts: z.number().int().nonnegative(),
  detail: z.string(),
}).strict();

const healthOutputSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  generatedAt: z.string(),
  services: z.array(z.object({
    serviceId: z.string(),
    running: z.boolean(),
    health: z.object({
      type: z.string(),
      healthy: z.boolean(),
      detail: z.string(),
      checks: z.array(healthCheckOutputSchema),
    }).strict(),
  }).strict()),
  summary: z.object({
    total: z.number().int().nonnegative(),
    healthy: z.number().int().nonnegative(),
    unhealthy: z.number().int().nonnegative(),
  }).strict(),
  safety: safetyOutputSchema,
}).strict();

const routeOutputSchema = z.object({
  serviceId: z.string(),
  serviceName: z.string(),
  endpoint: z.object({
    id: z.string(),
    label: z.string(),
    kind: z.string(),
    source: z.string(),
  }).strict(),
  exposure: z.string(),
  provider: z.string(),
  target: z.object({
    bind: z.string().optional(),
    port: z.number().int().optional(),
    protocol: z.string().optional(),
    host: z.string().optional(),
    path: z.string().optional(),
    pathPrefix: z.string().optional(),
  }).strict(),
  traefik: z.object({
    routerName: z.string(),
    serviceName: z.string(),
    middlewareNames: z.array(z.string()),
    entryPoints: z.array(z.string()),
    tls: z.string(),
    rule: z.string(),
  }).strict().nullable(),
  configSource: z.string(),
  state: z.string(),
  diagnostics: z.array(z.string()),
  nextAction: z.string(),
}).strict();

const routesOutputSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  generatedAt: z.string(),
  services: z.array(z.object({
    serviceId: z.string(),
    ports: z.record(z.string(), z.number().int()),
    routes: z.array(routeOutputSchema),
  }).strict()),
  safety: safetyOutputSchema,
}).strict();

const dependenciesOutputSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  generatedAt: z.string(),
  summary: z.object({
    status: z.string(),
    totalServices: z.number().int().nonnegative(),
    enabledServices: z.number().int().nonnegative(),
    runningServices: z.number().int().nonnegative(),
    startableServices: z.number().int().nonnegative(),
    blockedServices: z.number().int().nonnegative(),
    degradedServices: z.number().int().nonnegative(),
    disabledServices: z.number().int().nonnegative(),
  }).strict(),
  services: z.array(z.object({
    serviceId: z.string(),
    readiness: z.string(),
    blockingReason: z.string().nullable(),
    blockers: z.array(z.string()),
    nextAction: z.string(),
    dependencies: z.array(z.object({
      serviceId: z.string(),
      ready: z.boolean(),
      readiness: z.string(),
      blockingReason: z.string().nullable(),
    }).strict()),
    dependents: z.array(z.string()),
  }).strict()),
  safety: safetyOutputSchema,
}).strict();

const logsOutputSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  generatedAt: z.string(),
  serviceId: z.string(),
  log: z.object({
    type: z.string(),
    totalLines: z.number().int().nonnegative(),
    cursor: z.string(),
    nextCursor: z.string().nullable(),
    limit: z.number().int().positive(),
    entries: z.array(z.object({
      source: z.object({
        kind: z.string(),
        archiveId: z.string().nullable(),
        lineNumber: z.number().int().positive(),
      }).strict(),
      stream: z.string(),
      summary: z.string(),
      truncated: z.boolean(),
    }).strict()),
  }).strict(),
  safety: safetyOutputSchema,
}).strict();

const auditOutputSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  generatedAt: z.string(),
  chainStatus: z.string(),
  events: z.array(z.object({
    id: z.string(),
    timestamp: z.string(),
    source: z.string(),
    action: z.string(),
    actor: z.string(),
    subject: z.string().nullable(),
    serviceId: z.string().nullable(),
    method: z.string().nullable(),
    routeTemplate: z.string().nullable(),
    outcome: z.enum(["success", "failure"]),
    statusCode: z.number().int(),
    summary: z.string(),
    reason: z.string().nullable(),
    correlationId: z.string(),
    relatedRevisionId: z.string().nullable(),
    chainStatus: z.string(),
  }).strict()),
  pagination: paginationOutputSchema,
  safety: safetyOutputSchema,
}).strict();

const updatesOutputSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  generatedAt: z.string(),
  services: z.array(z.object({
    serviceId: z.string(),
    installed: z.boolean(),
    declaredVersion: z.string().nullable(),
    state: z.string(),
    updatedAt: z.string(),
    lastCheck: z.object({
      checkedAt: z.string(),
      status: z.string(),
    }).strict().nullable(),
    available: z.object({
      tag: z.string().nullable(),
      version: z.string().nullable(),
      publishedAt: z.string().nullable(),
    }).strict().nullable(),
    downloadedCandidate: z.object({
      tag: z.string(),
      version: z.string().nullable(),
      downloadedAt: z.string(),
    }).strict().nullable(),
    installDeferredAt: z.string().nullable(),
    failedAt: z.string().nullable(),
  }).strict()),
  pagination: paginationOutputSchema,
  safety: safetyOutputSchema,
}).strict();

const driftOutputSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  generatedAt: z.string(),
  serviceId: z.string(),
  checkedAt: z.string(),
  configured: z.boolean(),
  summary: z.object({
    total: z.number().int().nonnegative(),
    drifted: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative(),
    changed: z.number().int().nonnegative(),
    missing: z.number().int().nonnegative(),
    unmanaged: z.number().int().nonnegative(),
  }).strict(),
  artifacts: z.array(z.object({
    artifactId: z.string(),
    status: z.string(),
  }).strict()),
  safety: safetyOutputSchema,
}).strict();

const recoveryOutputSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  generatedAt: z.string(),
  serviceId: z.string(),
  updatedAt: z.string(),
  events: z.array(z.object({
    kind: z.string(),
    at: z.string(),
    action: z.string().nullable(),
    reason: z.string().nullable(),
    phase: z.string().nullable(),
    ok: z.boolean().nullable(),
    blocked: z.boolean().nullable(),
    stepSummary: z.object({
      total: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
      timedOut: z.number().int().nonnegative(),
    }).strict(),
  }).strict()),
  pagination: paginationOutputSchema,
  safety: safetyOutputSchema,
}).strict();

const diagnosticsOutputSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  generatedAt: z.string(),
  runtime: z.object({ version: z.string(), serviceCount: z.number().int().nonnegative() }).strict(),
  dependencies: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  secretReferences: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  redaction: z.record(z.string(), z.unknown()),
  safety: safetyOutputSchema,
}).strict();

const secretMetadataOutputSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  generatedAt: z.string(),
  broker: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  lockout: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  summary: z.record(z.string(), z.number()),
  services: z.array(z.record(z.string(), z.unknown())),
  safety: safetyOutputSchema,
}).strict();

const operationRecordSchema = z.object({
  operationId: z.string().regex(/^mcp-operation-[0-9a-f-]{36}$/u),
  action: z.enum([
    "service_start",
    "service_stop",
    "service_restart",
    "service_install",
    "service_configure",
    "setup_step_run",
    "update_check",
    "update_download",
    "update_install",
    "runtime_start_all",
    "runtime_stop_all",
  ]),
  status: z.enum(["queued", "running", "cancelling", "succeeded", "failed", "cancelled", "skipped"]),
  phase: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u),
  progress: z.number().int().min(0).max(100),
  summary: z.string().max(300),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
  expiresAt: z.string(),
  targetIds: z.array(requiredServiceIdSchema).max(100)
    .refine((entries) => new Set(entries).size === entries.length),
  correlationId: z.string().regex(/^mcp-operation-correlation-[0-9a-f-]{36}$/u),
  cancellationSupported: z.boolean(),
  outcome: z.enum(["succeeded", "failed", "cancelled", "skipped"]).nullable(),
  ownership: z.enum(["own", "other"]),
}).strict();

const operationSafetySchema = z.object({
  mutating: z.boolean(),
  redacted: z.literal(true),
  omittedSensitiveFields: z.array(z.string()),
}).strict();

const operationOutputSchema = z.object({
  contractVersion: z.literal(MCP_OPERATION_CONTRACT_VERSION),
  generatedAt: z.string(),
  operation: operationRecordSchema,
  safety: operationSafetySchema,
}).strict();

const operationListOutputSchema = z.object({
  contractVersion: z.literal(MCP_OPERATION_CONTRACT_VERSION),
  generatedAt: z.string(),
  operations: z.array(operationRecordSchema).max(MAX_MCP_OPERATION_LIST_LIMIT),
  pagination: paginationOutputSchema,
  safety: operationSafetySchema,
}).strict();

const operationCancelOutputSchema = operationOutputSchema.extend({
  cancellation: z.object({
    result: z.enum(["requested", "unsupported", "too_late"]),
    terminal: z.boolean(),
  }).strict(),
}).strict();

const operationAcceptedOutputSchema = z.object({
  contractVersion: z.literal(MCP_OPERATION_ACCEPTED_CONTRACT_VERSION),
  generatedAt: z.string(),
  accepted: z.literal(true),
  operation: operationRecordSchema,
  safety: operationSafetySchema,
}).strict();

// The MCP SDK currently normalizes tool output schemas as object schemas before
// validation. Keep an object at the root while retaining the discriminated
// branch validation so both synchronous guarded results and durable accepts are
// checked strictly.
const guardedOrOperationAcceptedOutputSchema = guardedActionOutputSchema.partial().extend({
  contractVersion: z.enum([
    "service-lasso-mcp-guarded-action.v1",
    MCP_OPERATION_ACCEPTED_CONTRACT_VERSION,
  ]),
  generatedAt: z.string(),
  accepted: z.literal(true).optional(),
  operation: operationRecordSchema.optional(),
  safety: operationSafetySchema,
}).strict().superRefine((value, context) => {
  const result = value.contractVersion === MCP_OPERATION_ACCEPTED_CONTRACT_VERSION
    ? operationAcceptedOutputSchema.safeParse(value)
    : guardedActionOutputSchema.safeParse(value);
  if (!result.success) {
    for (const issue of result.error.issues) {
      context.addIssue({ ...issue });
    }
  }
});

function outputJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema) as Record<string, unknown>;
}

const serviceIdInputSchema = {
  serviceId: {
    type: "string",
    description: "Optional Service Lasso service id. Omit to return all services.",
  },
};

const mcpTools: McpToolDefinition[] = [
  {
    name: "service_lasso_runtime_status",
    title: "Runtime status",
    description: "Read safe runtime version, readiness, and operator capability metadata.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: outputJsonSchema(runtimeStatusOutputSchema),
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
  },
  {
    name: "service_lasso_list_services",
    title: "List services",
    description: "List Service Lasso services with safe manifest, lifecycle, and dependency metadata.",
    inputSchema: {
      type: "object",
      properties: {
        cursor: { type: "string", description: "Opaque numeric cursor from a prior page." },
        limit: { type: "number", description: "Maximum services per page; defaults to 50 and is capped at 100." },
      },
      additionalProperties: false,
    },
    outputSchema: outputJsonSchema(servicesOutputSchema),
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
  },
  {
    name: "service_lasso_get_service",
    title: "Get service detail",
    description: "Read allowlisted metadata for one Service Lasso service.",
    inputSchema: {
      type: "object",
      properties: { serviceId: { type: "string", description: "Service Lasso service id." } },
      required: ["serviceId"],
      additionalProperties: false,
    },
    outputSchema: outputJsonSchema(serviceDetailOutputSchema),
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
  },
  {
    name: "service_lasso_get_health",
    title: "Get service health",
    description: "Read health metadata for one service or every service.",
    inputSchema: {
      type: "object",
      properties: serviceIdInputSchema,
      additionalProperties: false,
    },
    outputSchema: outputJsonSchema(healthOutputSchema),
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
  },
  {
    name: "service_lasso_list_routes",
    title: "List service routes",
    description: "List safe route and port metadata for one service or every service.",
    inputSchema: {
      type: "object",
      properties: serviceIdInputSchema,
      additionalProperties: false,
    },
    outputSchema: outputJsonSchema(routesOutputSchema),
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
  },
  {
    name: "service_lasso_dependency_status",
    title: "Dependency status",
    description: "Read dependency readiness, blockers, and next-action metadata.",
    inputSchema: {
      type: "object",
      properties: serviceIdInputSchema,
      additionalProperties: false,
    },
    outputSchema: outputJsonSchema(dependenciesOutputSchema),
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
  },
  {
    name: "service_lasso_logs_summary",
    title: "Logs summary",
    description: "Read a bounded, redacted runtime log summary for one service.",
    inputSchema: {
      type: "object",
      properties: {
        serviceId: {
          type: "string",
          description: "Service Lasso service id.",
        },
        limit: {
          type: "number",
          description: "Maximum recent log lines to return. Defaults to 20 and is capped at 50.",
        },
        cursor: {
          type: "string",
          description: "Opaque cursor from a prior log page.",
        },
      },
      required: ["serviceId"],
      additionalProperties: false,
    },
    outputSchema: outputJsonSchema(logsOutputSchema),
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
  },
  {
    name: "service_lasso_audit_search",
    title: "Search Audit",
    description: "Search durable Audit events with bounded filters and deterministic cursor pagination.",
    inputSchema: {
      type: "object",
      properties: {
        serviceId: { type: "string" },
        actor: { type: "string" },
        action: { type: "string" },
        outcome: { type: "string", enum: ["success", "failure"] },
        source: { type: "string" },
        since: { type: "string" },
        until: { type: "string" },
        query: { type: "string" },
        cursor: { type: "string" },
        limit: { type: "number", minimum: 1, maximum: MAX_AUDIT_LIMIT },
      },
      additionalProperties: false,
    },
    outputSchema: outputJsonSchema(auditOutputSchema),
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
  },
  {
    name: "service_lasso_update_status",
    title: "Update status",
    description: "Read allowlisted installed and available update state without URLs, paths, hooks, or raw errors.",
    inputSchema: {
      type: "object",
      properties: {
        ...serviceIdInputSchema,
        cursor: { type: "string" },
        limit: { type: "number", minimum: 1, maximum: MAX_SERVICE_LIMIT },
      },
      additionalProperties: false,
    },
    outputSchema: outputJsonSchema(updatesOutputSchema),
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
  },
  {
    name: "service_lasso_config_drift",
    title: "Configuration drift",
    description: "Read opaque configuration-artifact drift status without paths, hashes, previews, or values.",
    inputSchema: {
      type: "object",
      properties: { serviceId: { type: "string" } },
      required: ["serviceId"],
      additionalProperties: false,
    },
    outputSchema: outputJsonSchema(driftOutputSchema),
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
  },
  {
    name: "service_lasso_recovery_status",
    title: "Recovery status",
    description: "Read bounded recovery history without commands, output streams, or paths.",
    inputSchema: {
      type: "object",
      properties: {
        serviceId: { type: "string" },
        cursor: { type: "string" },
        limit: { type: "number", minimum: 1, maximum: MAX_RECOVERY_LIMIT },
      },
      required: ["serviceId"],
      additionalProperties: false,
    },
    outputSchema: outputJsonSchema(recoveryOutputSchema),
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
  },
  {
    name: "service_lasso_operation_status",
    title: "Operation status",
    description: "Read one durable MCP operation owned by the validated actor; Administrators may inspect other actors by opaque id.",
    inputSchema: {
      type: "object",
      properties: { operationId: { type: "string", pattern: "^mcp-operation-[0-9a-f-]{36}$" } },
      required: ["operationId"],
      additionalProperties: false,
    },
    outputSchema: outputJsonSchema(operationOutputSchema),
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
  },
  {
    name: "service_lasso_list_operations",
    title: "List operations",
    description: "List durable MCP operations in this workspace for the validated actor; Administrators may explicitly include all actors.",
    inputSchema: {
      type: "object",
      properties: {
        includeAllActors: { type: "boolean" },
        cursor: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: MAX_MCP_OPERATION_LIST_LIMIT },
      },
      additionalProperties: false,
    },
    outputSchema: outputJsonSchema(operationListOutputSchema),
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
  },
  {
    name: "service_lasso_diagnostics_summary",
    title: "Diagnostics summary",
    description: "Read safe diagnostic counts, dependency status, and secret-reference audit summaries.",
    inputSchema: {
      type: "object",
      properties: serviceIdInputSchema,
      additionalProperties: false,
    },
    outputSchema: outputJsonSchema(diagnosticsOutputSchema),
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
  },
  {
    name: "service_lasso_secret_metadata",
    title: "Secret metadata",
    description:
      "Inspect secret metadata only: refs, assignment, rotation readiness, and Secrets Broker availability. Never returns secret values.",
    inputSchema: {
      type: "object",
      properties: serviceIdInputSchema,
      additionalProperties: false,
    },
    outputSchema: outputJsonSchema(secretMetadataOutputSchema),
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
  },
];

const guardedActionCommonInputProperties: Record<string, unknown> = {
  execute: { type: "boolean", description: "Omit or set false for preflight; true requests guarded execution." },
  idempotencyKey: { type: "string", minLength: 8, maxLength: 200, pattern: "^(?!(?:AKIA|ASIA)[A-Z0-9]{16}$)(?!gh[pousr]_)(?!xox[a-z]-)(?![A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}$)[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$" },
  confirmationId: { type: "string", pattern: "^mcp-confirmation-[0-9a-f-]{36}$" },
  confirmationPhrase: { type: "string", minLength: 10, maxLength: 200 },
  confirmationTtlSeconds: { type: "integer", minimum: 1, maximum: 900 },
};

function guardedAnnotations(input: { destructive: boolean; openWorld?: boolean }) {
  return {
    readOnlyHint: false,
    destructiveHint: input.destructive,
    idempotentHint: true,
    openWorldHint: input.openWorld ?? false,
  };
}

function guardedToolDefinition(input: {
  name: ServiceLassoMcpToolName;
  title: string;
  description: string;
  serviceId?: boolean;
  stepId?: boolean;
  force?: boolean;
  destructive: boolean;
  openWorld?: boolean;
  durable?: boolean;
}): McpToolDefinition {
  const properties: Record<string, unknown> = {
    ...(input.serviceId ? { serviceId: { type: "string", pattern: "^@?[A-Za-z0-9][A-Za-z0-9._-]{0,127}$" } } : {}),
    ...(input.stepId ? { stepId: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:@-]{0,199}$" } } : {}),
    ...(input.force ? { force: { type: "boolean" } } : {}),
    ...guardedActionCommonInputProperties,
  };
  return {
    name: input.name,
    title: input.title,
    description: input.description,
    inputSchema: {
      type: "object",
      properties,
      ...((input.serviceId || input.stepId) ? {
        required: [
          ...(input.serviceId ? ["serviceId"] : []),
          ...(input.stepId ? ["stepId"] : []),
        ],
      } : {}),
      additionalProperties: false,
    },
    outputSchema: outputJsonSchema(input.durable ? guardedOrOperationAcceptedOutputSchema : guardedActionOutputSchema),
    annotations: guardedAnnotations(input),
  };
}

const guardedMcpTools: McpToolDefinition[] = [
  guardedToolDefinition({
    name: "service_lasso_start_service",
    title: "Start service",
    description: "Preflight or execute one confirmed service start through the shared runtime facade.",
    serviceId: true,
    destructive: false,
  }),
  guardedToolDefinition({
    name: "service_lasso_stop_service",
    title: "Stop service",
    description: "Preflight or execute one confirmed service stop through the shared runtime facade.",
    serviceId: true,
    destructive: true,
  }),
  guardedToolDefinition({
    name: "service_lasso_restart_service",
    title: "Restart service",
    description: "Preflight or execute one confirmed service restart with normal dependency, port, readiness, and recovery behavior.",
    serviceId: true,
    destructive: true,
  }),
  guardedToolDefinition({
    name: "service_lasso_install_service",
    title: "Install service",
    description: "Preflight or execute one confirmed manifest-owned service installation.",
    serviceId: true,
    destructive: true,
    openWorld: true,
    durable: true,
  }),
  guardedToolDefinition({
    name: "service_lasso_configure_service",
    title: "Configure service",
    description: "Preflight or execute manifest-owned configuration without accepting raw configuration bodies.",
    serviceId: true,
    destructive: true,
    durable: true,
  }),
  guardedToolDefinition({
    name: "service_lasso_run_setup_step",
    title: "Run setup step",
    description: "Preflight or execute one named manifest-owned setup step; no arbitrary command input is accepted.",
    serviceId: true,
    stepId: true,
    destructive: true,
    openWorld: true,
    durable: true,
  }),
  guardedToolDefinition({
    name: "service_lasso_check_updates",
    title: "Check service updates",
    description: "Preflight or execute one allowlisted update check through the shared update facade.",
    serviceId: true,
    destructive: false,
    openWorld: true,
    durable: true,
  }),
  guardedToolDefinition({
    name: "service_lasso_download_update",
    title: "Download service update",
    description: "Preflight or execute one confirmed pinned update download.",
    serviceId: true,
    destructive: false,
    openWorld: true,
    durable: true,
  }),
  guardedToolDefinition({
    name: "service_lasso_install_update",
    title: "Install service update",
    description: "Preflight or execute one confirmed update installation with rollback-readiness policy.",
    serviceId: true,
    force: true,
    destructive: true,
    openWorld: true,
    durable: true,
  }),
  guardedToolDefinition({
    name: "service_lasso_start_all",
    title: "Start all services",
    description: "Preflight or execute the confirmed dependency-ordered runtime start plan.",
    destructive: false,
    durable: true,
  }),
  guardedToolDefinition({
    name: "service_lasso_stop_all",
    title: "Stop all services",
    description: "Preflight or execute the confirmed dependency-ordered runtime stop plan.",
    destructive: true,
    durable: true,
  }),
  {
    name: "service_lasso_cancel_operation",
    title: "Cancel operation",
    description: "Request safe cancellation of one durable MCP operation. Unsupported and too-late requests are non-destructive.",
    inputSchema: {
      type: "object",
      properties: {
        operationId: { type: "string", pattern: "^mcp-operation-[0-9a-f-]{36}$" },
      },
      required: ["operationId"],
      additionalProperties: false,
    },
    outputSchema: outputJsonSchema(operationCancelOutputSchema),
    annotations: guardedAnnotations({ destructive: false }),
  },
];

const guardedActionByToolName: Partial<Record<ServiceLassoMcpToolName, McpGuardedActionName>> = {
  service_lasso_start_service: "service_start",
  service_lasso_stop_service: "service_stop",
  service_lasso_restart_service: "service_restart",
  service_lasso_install_service: "service_install",
  service_lasso_configure_service: "service_configure",
  service_lasso_run_setup_step: "setup_step_run",
  service_lasso_check_updates: "update_check",
  service_lasso_download_update: "update_download",
  service_lasso_install_update: "update_install",
  service_lasso_start_all: "runtime_start_all",
  service_lasso_stop_all: "runtime_stop_all",
};

function advertisedMcpTools(mode: McpOperatingMode): McpToolDefinition[] {
  return mode === "guarded" ? [...mcpTools, ...guardedMcpTools] : mcpTools;
}

const mcpResources: McpResourceDefinition[] = [
  {
    uri: "servicelasso://runtime",
    name: "Runtime status",
    description: "Safe runtime status and operator capability metadata.",
    mimeType: "application/json",
  },
  {
    uri: "servicelasso://services",
    name: "Service inventory",
    description: "Safe Service Lasso service list metadata.",
    mimeType: "application/json",
  },
  {
    uri: "servicelasso://health",
    name: "Service health",
    description: "Safe service health metadata.",
    mimeType: "application/json",
  },
  {
    uri: "servicelasso://routes",
    name: "Service routes",
    description: "Safe route and port metadata without URL credentials, query strings, or fragments.",
    mimeType: "application/json",
  },
  {
    uri: "servicelasso://dependencies",
    name: "Dependency status",
    description: "Baseline dependency readiness and blocker metadata.",
    mimeType: "application/json",
  },
  {
    uri: "servicelasso://diagnostics",
    name: "Diagnostics summary",
    description: "Safe operator diagnostic summary with redaction policy.",
    mimeType: "application/json",
  },
  {
    uri: "servicelasso://secret-metadata",
    name: "Secret metadata",
    description: "Secret refs, assignment, rotation readiness, and Broker availability without secret values.",
    mimeType: "application/json",
  },
];

const mcpResourceTemplates: McpResourceTemplateDefinition[] = [
  {
    uriTemplate: "servicelasso://services/{serviceId}",
    name: "Service detail",
    description: "Allowlisted metadata for one service.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "servicelasso://services/{serviceId}/health",
    name: "Service health",
    description: "Health and readiness for one service.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "servicelasso://services/{serviceId}/routes",
    name: "Service routes",
    description: "Route, port, and Traefik metadata for one service.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "servicelasso://services/{serviceId}/dependencies",
    name: "Service dependencies",
    description: "Dependency readiness and blockers for one service.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "servicelasso://services/{serviceId}/updates",
    name: "Service updates",
    description: "Allowlisted installed and available update state for one service.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "servicelasso://services/{serviceId}/drift",
    name: "Service configuration drift",
    description: "Opaque configuration-artifact drift status for one service.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "servicelasso://services/{serviceId}/recovery",
    name: "Service recovery",
    description: "Bounded recovery history for one service.",
    mimeType: "application/json",
  },
];

function generatedAt(): string {
  return new Date().toISOString();
}

class McpReadError extends Error {
  constructor(
    public readonly code: "unknown_service" | "feature_unavailable" | "forbidden" | "invalid_cursor" | "invalid_request" | McpGuardedActionError["code"] | McpOperationError["code"],
    message: string,
  ) {
    super(message);
    this.name = "McpReadError";
  }
}

function stableMcpError(error: unknown): McpReadError {
  if (error instanceof McpReadError) return error;
  if (error instanceof McpGuardedActionError) {
    return new McpReadError(error.code, error.message);
  }
  if (error instanceof McpOperationError) {
    return new McpReadError(error.code, error.message);
  }
  if (error && typeof error === "object" && "code" in error && error.code === "mcp_insufficient_scope") {
    return new McpReadError("forbidden", "The validated identity does not have the required read scope.");
  }
  if (error instanceof Error && /^Unknown service id:/u.test(error.message)) {
    return new McpReadError("unknown_service", "The requested service is not available.");
  }
  return new McpReadError("invalid_request", "The MCP read request could not be completed.");
}

function parseOpaqueCursor(value: unknown, total: number): number {
  if (value === undefined) return 0;
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/u.test(value)) {
    throw new McpReadError("invalid_cursor", "The cursor is invalid.");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > total) {
    throw new McpReadError("invalid_cursor", "The cursor is invalid or stale.");
  }
  return parsed;
}

function boundedLimit(value: unknown, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > maximum) {
    throw new McpReadError("invalid_request", `Limit must be an integer from 1 to ${maximum}.`);
  }
  return value;
}

function safeMcpText(context: ServiceLassoMcpContext, value: unknown): string {
  let result = String(redactDiagnosticsValue(String(value)));
  const roots = [context.workspaceRoot, context.servicesRoot, ...context.discovered.flatMap((service) => [
    service.serviceRoot,
    service.manifestPath,
  ])]
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .sort((left, right) => right.length - left.length);

  for (const root of roots) {
    result = result.replaceAll(root, "[REDACTED_PATH]");
    result = result.replaceAll(root.replaceAll("\\", "/"), "[REDACTED_PATH]");
  }

  return result
    .replace(/file:\/\/\/?[^\s"']+/giu, "[REDACTED_PATH]")
    .replace(/(^|[^A-Za-z0-9])(?:[A-Za-z]:[\\/]|\\\\)[^\s"']+/gu, "$1[REDACTED_PATH]")
    .replace(/(^|[\s("'=,;|{}\[\]-]|:(?=\/[^/]))\/(?:[^\s"'<>/]+\/)*[^\s"'<>/]+/gu, "$1[REDACTED_PATH]")
    .trim();
}

function safeServiceDetail(context: ServiceLassoMcpContext, service: DiscoveredService) {
  const lifecycle = getLifecycleState(service.manifest.id);
  const dependencySummary = context.graph.getServiceDependencies(service.manifest.id);
  return {
    id: service.manifest.id,
    name: safeMcpText(context, service.manifest.name),
    description: service.manifest.description ? safeMcpText(context, service.manifest.description) : null,
    enabled: service.manifest.enabled !== false,
    role: service.manifest.role ?? "service",
    version: service.manifest.version === undefined
      ? null
      : safeMcpText(context, service.manifest.version),
    lifecycle: {
      installed: lifecycle.installed,
      configured: lifecycle.configured,
      running: lifecycle.running,
    },
    dependencies: dependencySummary.dependencies,
    dependents: dependencySummary.dependents,
    providerRequirements: dependencySummary.providerRequirements.map((requirement) => ({
      capability: safeMcpText(context, requirement.capability),
      requirement: safeMcpText(context, requirement.requirement),
      serviceId: requirement.serviceId,
      version: safeMcpText(context, requirement.version),
    })),
    ports: resolvedPorts(service),
  };
}

function opaqueArtifactId(serviceId: string, relativePath: string): string {
  return `config-${createHash("sha256").update(`${serviceId}\0${relativePath}`).digest("hex").slice(0, 16)}`;
}

function safeArguments(params: unknown): Record<string, unknown> {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return {};
  }

  const args = (params as { arguments?: unknown }).arguments;
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return {};
  }

  return args as Record<string, unknown>;
}

function serviceIdFromArguments(args: Record<string, unknown>): string | undefined {
  return typeof args.serviceId === "string" && args.serviceId.trim().length > 0 ? args.serviceId.trim() : undefined;
}

/**
 * Rejects extra JSON-RPC tool arguments so the compatibility path preserves
 * the same `additionalProperties: false` boundary as the SDK registrations.
 */
function assertAllowedMcpArguments(
  args: Record<string, unknown>,
  allowed: readonly string[],
  toolName: ServiceLassoMcpToolName,
): void {
  const extra = Object.keys(args).filter((key) => !allowed.includes(key));
  if (extra.length > 0) {
    throw new McpReadError("invalid_request", `${toolName} rejects additional properties.`);
  }
}

/**
 * Reports whether `@secretsbroker` is discovered and running without reading KV.
 */
function buildMcpBrokerAvailability(context: ServiceLassoMcpContext): McpSecretMetadataBroker {
  const broker = context.registry.getById(SECRETS_BROKER_SERVICE_ID);
  if (!broker) {
    return {
      serviceId: null,
      discovered: false,
      installed: null,
      configured: null,
      running: null,
      availability: "not_discovered",
    };
  }

  const lifecycle = getLifecycleState(broker.manifest.id);
  return {
    serviceId: broker.manifest.id,
    discovered: true,
    installed: lifecycle.installed,
    configured: lifecycle.configured,
    running: lifecycle.running,
    availability: lifecycle.running ? "available" : "unavailable",
  };
}

function selectedServices(context: ServiceLassoMcpContext, serviceId?: string): DiscoveredService[] {
  if (!serviceId) {
    return [...context.discovered].sort((left, right) => left.manifest.id.localeCompare(right.manifest.id));
  }

  const service = context.registry.getById(serviceId);
  if (!service) {
    throw new McpReadError("unknown_service", "The requested service is not available.");
  }

  return [service];
}

function resolvedPorts(service: DiscoveredService): Record<string, number> {
  const lifecycle = getLifecycleState(service.manifest.id);
  return Object.keys(lifecycle.runtime.ports).length > 0 ? lifecycle.runtime.ports : service.manifest.ports ?? {};
}

function redactLogValue(value: string): string {
  return String(redactDiagnosticsValue(value));
}

function sanitizeHealth(context: ServiceLassoMcpContext, health: ServiceHealthResult) {
  return {
    type: health.type,
    healthy: health.healthy,
    detail: safeMcpText(context, health.detail),
    checks: (health.checks ?? []).map((check) => ({
      id: check.id,
      type: check.type,
      required: check.required,
      healthy: check.healthy,
      attempts: check.attempts,
      detail: safeMcpText(context, check.detail),
    })),
  };
}

export function getServiceLassoMcpCapabilities(
  context: ServiceLassoMcpContext,
  options: { operatingMode?: McpOperatingMode } = {},
) {
  const operatingMode = options.operatingMode ?? context.mcpOperatingMode ?? "read-only";
  const guardedToolsAvailable = operatingMode === "guarded" && Boolean(context.guardedActionFacade && context.workspaceRoot);
  return {
    contractVersion: CONTRACT_VERSION,
    protocolVersion: MCP_PROTOCOL_VERSION,
    sdk: {
      packageName: MCP_SDK_PACKAGE,
      version: MCP_SDK_VERSION,
      streamableHttp: "stateless",
      stdio: "opt-in thin active-runtime adapter",
    },
    serverInfo: {
      name: "service-lasso-operator",
      version: context.version,
    },
    policy: {
      operatingMode,
      guardedToolsAvailable,
      durableOperationsAvailable: Boolean(context.workspaceRoot),
    },
    scope: {
      mutatingOperations: guardedToolsAvailable ? "guarded" : "omitted",
      tools: guardedToolsAvailable ? "read and guarded actions" : "read-only",
      resources: "read-only",
      redaction: {
        value: REDACTION_VALUE,
        rules: [
          "raw manifest env/globalenv values are not returned",
          "runtime log text is pattern-redacted before MCP responses",
          "route URLs strip username, password, query string, and fragment",
          "secret metadata returns refs, assignment, and rotation state only",
          "guarded action output contains allowlisted targets, effects, status, and correlation metadata only",
          "durable operation output contains allowlisted state, progress, targets, timestamps, and safe summaries only",
        ],
      },
    },
    tools: advertisedMcpTools(guardedToolsAvailable ? "guarded" : "read-only"),
    resources: mcpResources,
    resourceTemplates: mcpResourceTemplates,
    runtime: {
      serviceCount: context.discovered.length,
    },
  };
}

function defaultOperationRecovery(
  context: ServiceLassoMcpContext,
): McpOperationServiceOptions["recoverDetached"] | undefined {
  const workspaceRoot = context.workspaceRoot;
  if (!workspaceRoot) return undefined;
  return async (operation) => {
    if (!operation.guardedExecutionId) return null;
    let completed;
    try {
      completed = await readMcpGuardedActionExecution({
        workspaceRoot,
        executionId: operation.guardedExecutionId,
        expectedCorrelationId: operation.correlationId,
      });
    } catch {
      return null;
    }
    if (!completed) return null;
    return {
      status: completed.status === "skipped" || completed.status === "replayed"
        ? "skipped"
        : completed.ok
          ? "succeeded"
          : "failed",
      phase: completed.status === "replayed" ? "replayed" : "guarded_result_reconciled",
      progress: 100,
      summary: completed.summary,
    };
  };
}

const defaultDetachedCancellation: NonNullable<McpOperationServiceOptions["cancelDetached"]> = async () => "unsupported";

export function createServiceLassoMcpServer(
  context: ServiceLassoMcpContext,
  options: ServiceLassoMcpServerOptions = {},
): McpServer {
  const operatingMode = options.operatingMode ?? context.mcpOperatingMode ?? "read-only";
  const guardedToolsAvailable = operatingMode === "guarded" && Boolean(context.guardedActionFacade && context.workspaceRoot);
  const operationService = context.workspaceRoot
    ? new McpOperationService({
        workspaceRoot: context.workspaceRoot,
        requestBudgetMs: options.operationRequestBudgetMs,
        retentionMs: options.operationRetentionMs,
        now: options.operationNow,
        recoverDetached: options.operationRecoverDetached ?? defaultOperationRecovery(context),
        cancelDetached: options.operationCancelDetached ?? defaultDetachedCancellation,
      })
    : null;
  const server = new McpServer(
    {
      name: "service-lasso-operator",
      version: context.version,
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  );

  const executeTool = async (
    requiredScopes: readonly string[],
    action: () => Promise<Record<string, unknown>>,
  ) => {
    try {
      if (options.authorization) assertMcpScopes(options.authorization, requiredScopes);
      return jsonToolResult(await action());
    } catch (error) {
      return jsonToolErrorResult(error);
    }
  };

  server.registerTool(
    "service_lasso_runtime_status",
    {
      title: "Runtime status",
      description: "Read safe runtime version, readiness, and operator capability metadata.",
      inputSchema: z.object({}).strict(),
      outputSchema: runtimeStatusOutputSchema,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async () => executeTool(["service-lasso:read"], async () => buildMcpRuntimeStatusPayload(context)),
  );

  server.registerTool(
    "service_lasso_list_services",
    {
      title: "List services",
      description: "List Service Lasso services with safe manifest, lifecycle, and dependency metadata.",
      inputSchema: z.object({ cursor: serviceCursorSchema, limit: serviceLimitSchema }).strict(),
      outputSchema: servicesOutputSchema,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async ({ cursor, limit }) => executeTool(
      ["service-lasso:read"],
      async () => buildMcpServicesPayload(context, { cursor, limit }),
    ),
  );

  server.registerTool(
    "service_lasso_get_service",
    {
      title: "Get service detail",
      description: "Read allowlisted metadata for one Service Lasso service.",
      inputSchema: z.object({ serviceId: requiredServiceIdSchema }).strict(),
      outputSchema: serviceDetailOutputSchema,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async ({ serviceId }) => executeTool(
      ["service-lasso:read"],
      async () => buildMcpServiceDetailPayload(context, serviceId),
    ),
  );

  server.registerTool(
    "service_lasso_get_health",
    {
      title: "Get service health",
      description: "Read health metadata for one service or every service.",
      inputSchema: z.object({
        serviceId: optionalServiceIdSchema.describe("Optional Service Lasso service id. Omit to return all services."),
      }).strict(),
      outputSchema: healthOutputSchema,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async ({ serviceId }) => executeTool(
      ["service-lasso:read"],
      async () => buildMcpHealthPayload(context, serviceId),
    ),
  );

  server.registerTool(
    "service_lasso_list_routes",
    {
      title: "List service routes",
      description: "List safe route and port metadata for one service or every service.",
      inputSchema: z.object({
        serviceId: optionalServiceIdSchema.describe("Optional Service Lasso service id. Omit to return all services."),
      }).strict(),
      outputSchema: routesOutputSchema,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async ({ serviceId }) => executeTool(
      ["service-lasso:read"],
      async () => buildMcpRoutesPayload(context, serviceId),
    ),
  );

  server.registerTool(
    "service_lasso_dependency_status",
    {
      title: "Dependency status",
      description: "Read dependency readiness, blockers, and next-action metadata.",
      inputSchema: z.object({
        serviceId: optionalServiceIdSchema.describe("Optional Service Lasso service id. Omit to return all services."),
      }).strict(),
      outputSchema: dependenciesOutputSchema,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async ({ serviceId }) => executeTool(
      ["service-lasso:read"],
      async () => buildMcpDependencyStatusPayload(context, serviceId),
    ),
  );

  server.registerTool(
    "service_lasso_logs_summary",
    {
      title: "Logs summary",
      description: "Read a bounded, redacted runtime log summary for one service.",
      inputSchema: z.object({
        serviceId: requiredServiceIdSchema.describe("Service Lasso service id."),
        cursor: cursorInputSchema.describe("Opaque cursor from a prior page."),
        limit: logLimitSchema.describe("Maximum recent log lines to return. Defaults to 20 and is capped at 50."),
      }).strict(),
      outputSchema: logsOutputSchema,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async ({ serviceId, cursor, limit }) => executeTool(
      ["service-lasso:read", "service-lasso:logs:read"],
      async () => buildMcpLogsSummaryPayload(context, serviceId, { cursor, limit }),
    ),
  );

  server.registerTool(
    "service_lasso_audit_search",
    {
      title: "Search Audit",
      description: "Search durable Audit events with bounded filters and deterministic cursor pagination.",
      inputSchema: z.object({
        serviceId: optionalServiceIdSchema,
        actor: z.string().trim().min(1).max(200).optional(),
        action: z.string().trim().min(1).max(200).optional(),
        outcome: z.enum(["success", "failure"]).optional(),
        source: z.string().trim().min(1).max(200).optional(),
        since: z.string().trim().min(1).max(64).optional(),
        until: z.string().trim().min(1).max(64).optional(),
        query: z.string().trim().min(1).max(200).optional(),
        cursor: cursorInputSchema,
        limit: auditLimitSchema,
      }).strict(),
      outputSchema: auditOutputSchema,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async (input) => executeTool(
      ["service-lasso:read", "service-lasso:audit:read"],
      async () => buildMcpAuditPayload(context, input),
    ),
  );

  server.registerTool(
    "service_lasso_update_status",
    {
      title: "Update status",
      description: "Read allowlisted installed and available update state without URLs, paths, hooks, or raw errors.",
      inputSchema: z.object({
        serviceId: optionalServiceIdSchema,
        cursor: cursorInputSchema,
        limit: serviceLimitSchema,
      }).strict(),
      outputSchema: updatesOutputSchema,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async (input) => executeTool(
      ["service-lasso:read"],
      async () => buildMcpUpdatesPayload(context, input),
    ),
  );

  server.registerTool(
    "service_lasso_config_drift",
    {
      title: "Configuration drift",
      description: "Read opaque configuration-artifact drift status without paths, hashes, previews, or values.",
      inputSchema: z.object({ serviceId: requiredServiceIdSchema }).strict(),
      outputSchema: driftOutputSchema,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async ({ serviceId }) => executeTool(
      ["service-lasso:read"],
      async () => buildMcpConfigDriftPayload(context, serviceId),
    ),
  );

  server.registerTool(
    "service_lasso_recovery_status",
    {
      title: "Recovery status",
      description: "Read bounded recovery history without commands, output streams, or paths.",
      inputSchema: z.object({
        serviceId: requiredServiceIdSchema,
        cursor: cursorInputSchema,
        limit: recoveryLimitSchema,
      }).strict(),
      outputSchema: recoveryOutputSchema,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async ({ serviceId, cursor, limit }) => executeTool(
      ["service-lasso:read"],
      async () => buildMcpRecoveryPayload(context, serviceId, { cursor, limit }),
    ),
  );

  server.registerTool(
    "service_lasso_operation_status",
    {
      title: "Operation status",
      description: "Read one durable MCP operation owned by the validated actor; Administrators may inspect other actors by opaque id.",
      inputSchema: z.object({ operationId: z.string().regex(/^mcp-operation-[0-9a-f-]{36}$/u) }).strict(),
      outputSchema: operationOutputSchema,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async ({ operationId }) => executeTool(
      ["service-lasso:read"],
      async () => {
        if (!operationService) throw new McpReadError("feature_unavailable", "Durable MCP operation state is unavailable for this runtime.");
        return await operationService.get(operationId, options.authorization) as unknown as Record<string, unknown>;
      },
    ),
  );

  server.registerTool(
    "service_lasso_list_operations",
    {
      title: "List operations",
      description: "List durable MCP operations in this workspace for the validated actor; Administrators may explicitly include all actors.",
      inputSchema: z.object({
        includeAllActors: z.boolean().optional(),
        cursor: cursorInputSchema,
        limit: z.number().int().min(1).max(MAX_MCP_OPERATION_LIST_LIMIT).optional(),
      }).strict(),
      outputSchema: operationListOutputSchema,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async ({ includeAllActors, cursor, limit }) => executeTool(
      ["service-lasso:read"],
      async () => {
        if (!operationService) throw new McpReadError("feature_unavailable", "Durable MCP operation state is unavailable for this runtime.");
        const parsedCursor = cursor === undefined ? 0 : parseOpaqueCursor(cursor, Number.MAX_SAFE_INTEGER);
        return await operationService.list({
          authorization: options.authorization,
          includeAllActors,
          cursor: parsedCursor,
          limit,
        }) as unknown as Record<string, unknown>;
      },
    ),
  );

  server.registerTool(
    "service_lasso_diagnostics_summary",
    {
      title: "Diagnostics summary",
      description: "Read safe diagnostic counts, dependency status, and secret-reference audit summaries.",
      inputSchema: z.object({
        serviceId: optionalServiceIdSchema.describe("Optional Service Lasso service id. Omit to return all services."),
      }).strict(),
      outputSchema: diagnosticsOutputSchema,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async ({ serviceId }) => executeTool(
      ["service-lasso:read"],
      async () => buildMcpDiagnosticsSummaryPayload(context, serviceId),
    ),
  );

  server.registerTool(
    "service_lasso_secret_metadata",
    {
      title: "Secret metadata",
      description:
        "Inspect secret metadata only: refs, assignment, rotation readiness, and Secrets Broker availability. Never returns secret values.",
      inputSchema: z.object({
        serviceId: optionalServiceIdSchema.describe("Optional Service Lasso service id. Omit to return all services."),
      }).strict(),
      outputSchema: secretMetadataOutputSchema,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async ({ serviceId }) => executeTool(
      ["service-lasso:read"],
      async () => buildMcpSecretMetadataPayload(context, serviceId),
    ),
  );

  if (guardedToolsAvailable) {
    server.registerTool(
      "service_lasso_cancel_operation",
      {
        title: "Cancel operation",
        description: "Request safe cancellation of one durable MCP operation. Unsupported and too-late requests are non-destructive.",
        inputSchema: z.object({ operationId: z.string().regex(/^mcp-operation-[0-9a-f-]{36}$/u) }).strict(),
        outputSchema: operationCancelOutputSchema,
        annotations: guardedAnnotations({ destructive: false }),
      },
      async ({ operationId }) => executeTool(
        ["service-lasso:read"],
        async () => {
          if (!operationService) throw new McpReadError("feature_unavailable", "Durable MCP operation state is unavailable for this runtime.");
          return await operationService.cancel(operationId, options.authorization) as unknown as Record<string, unknown>;
        },
      ),
    );

    const registerGuardedAction = (
      toolName: ServiceLassoMcpToolName,
      action: McpGuardedActionName,
      inputSchema: z.ZodType<McpGuardedActionInput>,
    ) => {
      const definition = guardedMcpTools.find((entry) => entry.name === toolName);
      if (!definition) throw new Error(`Missing guarded MCP tool definition: ${toolName}`);
      server.registerTool(
        toolName,
        {
          title: definition.title,
          description: definition.description,
          inputSchema,
          outputSchema: isDurableMcpAction(action) ? guardedOrOperationAcceptedOutputSchema : guardedActionOutputSchema,
          annotations: definition.annotations,
        },
        async (parameters, extra) => {
          try {
            const invoke = async (
              signal?: AbortSignal,
              reportProgress?: (update: McpGuardedActionProgressUpdate) => Promise<void>,
              correlationId?: string,
            ) => await invokeMcpGuardedAction({
              workspaceRoot: context.workspaceRoot,
              operatingMode,
              authorization: options.authorization,
              facade: context.guardedActionFacade,
              action,
              parameters,
              correlationId,
              signal,
              reportProgress,
            });
            let payload;
            if (parameters.execute === true && isDurableMcpAction(action) && operationService) {
              await assertMcpGuardedActionAuthorization({
                workspaceRoot: context.workspaceRoot!,
                operatingMode,
                authorization: options.authorization,
                action,
              });
              const authorization = options.authorization;
              if (!authorization) throw new McpGuardedActionError("authorization_required", "A validated MCP identity is required.");
              const submission = await operationService.submit({
                authorization,
                action,
                targetIds: parameters.serviceId
                  ? [parameters.serviceId]
                  : (action === "runtime_start_all" || action === "runtime_stop_all")
                    ? context.discovered.map((service) => service.manifest.id)
                    : [],
                cancellationSupported: isSafelyCancellableMcpAction(action),
                guardedExecutionId: guardedActionExecutionId(
                  authorization.actor.actorId,
                  authorization.actor.clientId,
                  parameters.idempotencyKey ?? "",
                ),
                requestSignal: extra.signal,
                execute: async (signal, reportProgress, correlationId) => await invoke(signal, reportProgress, correlationId),
              });
              payload = submission.kind === "completed" ? submission.response : submission.payload;
            } else {
              payload = await invoke();
            }
            return jsonToolResult(payload as unknown as Record<string, unknown>);
          } catch (error) {
            return jsonToolErrorResult(error);
          }
        },
      );
    };

    registerGuardedAction("service_lasso_start_service", "service_start", guardedServiceInputSchema);
    registerGuardedAction("service_lasso_stop_service", "service_stop", guardedServiceInputSchema);
    registerGuardedAction("service_lasso_restart_service", "service_restart", guardedServiceInputSchema);
    registerGuardedAction("service_lasso_install_service", "service_install", guardedServiceInputSchema);
    registerGuardedAction("service_lasso_configure_service", "service_configure", guardedServiceInputSchema);
    registerGuardedAction("service_lasso_run_setup_step", "setup_step_run", guardedSetupInputSchema);
    registerGuardedAction("service_lasso_check_updates", "update_check", guardedServiceInputSchema);
    registerGuardedAction("service_lasso_download_update", "update_download", guardedServiceInputSchema);
    registerGuardedAction("service_lasso_install_update", "update_install", guardedUpdateInstallInputSchema);
    registerGuardedAction("service_lasso_start_all", "runtime_start_all", guardedRuntimeInputSchema);
    registerGuardedAction("service_lasso_stop_all", "runtime_stop_all", guardedRuntimeInputSchema);
  }

  for (const resource of mcpResources) {
    server.registerResource(
      resource.name,
      resource.uri,
      {
        description: resource.description,
        mimeType: resource.mimeType,
      },
      async () => ({
        contents: [
          {
            uri: resource.uri,
            mimeType: resource.mimeType,
            text: JSON.stringify(await readResource(context, resource.uri), null, 2),
          },
        ],
      }),
    );
  }

  for (const resource of mcpResourceTemplates) {
    server.registerResource(
      resource.name,
      new ResourceTemplate(resource.uriTemplate, {
        list: undefined,
        complete: {
          serviceId: (value) => context.discovered
            .map((service) => service.manifest.id)
            .filter((serviceId) => serviceId.startsWith(value))
            .slice(0, 100),
        },
      }),
      {
        description: resource.description,
        mimeType: resource.mimeType,
      },
      async (uri, variables) => ({
        contents: [
          {
            uri: uri.toString(),
            mimeType: resource.mimeType,
            text: JSON.stringify(
              await readResourceTemplate(context, resource.uriTemplate, String(variables.serviceId ?? "")),
              null,
              2,
            ),
          },
        ],
      }),
    );
  }

  if (guardedToolsAvailable && context.workspaceRoot && options.authorization) {
    // The pinned MCP SDK validates tool inputs before registered callbacks. Wrap
    // that single validation boundary so recognized guarded denials are durably
    // audited for every transport, including stdio, without logging arguments.
    const validationBoundary = server as unknown as {
      validateToolInput: (tool: unknown, args: unknown, toolName: string) => Promise<unknown>;
    };
    const validateToolInput = validationBoundary.validateToolInput.bind(server);
    validationBoundary.validateToolInput = async (tool, args, toolName) => {
      try {
        return await validateToolInput(tool, args, toolName);
      } catch (error) {
        const action = guardedActionByToolName[toolName as ServiceLassoMcpToolName];
        if (!action) throw error;
        await auditMcpGuardedActionSchemaDenial({
          workspaceRoot: context.workspaceRoot as string,
          authorization: options.authorization as McpHttpAuthorization,
          action,
          parameters: args,
        });
        throw new McpGuardedActionError("invalid_request", "The guarded action request did not match the strict tool schema.");
      }
    };
  }

  return server;
}

/**
 * Connects stdio to the already-running runtime model. The caller owns the
 * process lifetime; this adapter never starts an API server or calls it over
 * HTTP.
 */
export async function startServiceLassoMcpStdioAdapter(
  context: ServiceLassoMcpContext,
  authorization: McpHttpAuthorization,
  options: ServiceLassoMcpStdioOptions = {},
): Promise<RunningServiceLassoMcpStdioAdapter> {
  const server = createServiceLassoMcpServer(context, {
    authorization,
    operatingMode: options.operatingMode ?? context.mcpOperatingMode ?? "read-only",
  });
  const transport = new StdioServerTransport(options.stdin, options.stdout);
  await server.connect(transport);
  return {
    close: async () => {
      await server.close().catch(() => undefined);
      await transport.close().catch(() => undefined);
    },
  };
}

export async function buildMcpRuntimeStatusPayload(context: ServiceLassoMcpContext) {
  const lifecycleStates = context.discovered.map((service) => getLifecycleState(service.manifest.id));
  const degraded = lifecycleStates.some((state) => state.runtime.startTrace.current?.status === "failed");
  return {
    contractVersion: CONTRACT_VERSION,
    generatedAt: generatedAt(),
    runtime: {
      version: context.version,
      serviceCount: context.discovered.length,
      status: degraded ? "degraded" as const : "ready" as const,
    },
    capabilities: {
      services: true as const,
      health: true as const,
      routes: true as const,
      dependencies: true as const,
      redactedLogs: true as const,
      durableAudit: Boolean(context.workspaceRoot || context.discovered.length > 0),
      updates: true as const,
      configDrift: true as const,
      recovery: true as const,
      guardedActions: context.mcpOperatingMode === "guarded" && Boolean(context.guardedActionFacade && context.workspaceRoot),
      durableOperations: Boolean(context.workspaceRoot),
    },
    safety: {
      mutating: false as const,
      redacted: true as const,
      omittedSensitiveFields: ["runtime paths", "process command lines", "environment and config values"],
    },
  };
}

export async function buildMcpServiceDetailPayload(context: ServiceLassoMcpContext, serviceId: string) {
  const [service] = selectedServices(context, serviceId);
  if (!service) throw new McpReadError("unknown_service", "The requested service is not available.");
  return {
    contractVersion: CONTRACT_VERSION,
    generatedAt: generatedAt(),
    service: safeServiceDetail(context, service),
    safety: {
      mutating: false as const,
      redacted: true as const,
      omittedSensitiveFields: ["manifest and service paths", "environment and config values", "process command lines"],
    },
  };
}

export async function buildMcpServicesPayload(
  context: ServiceLassoMcpContext,
  page: { cursor?: unknown; limit?: unknown } = {},
) {
  const allServices = selectedServices(context);
  const cursor = parseOpaqueCursor(page.cursor, allServices.length);
  const limit = boundedLimit(page.limit, DEFAULT_SERVICE_LIMIT, MAX_SERVICE_LIMIT);
  const services = allServices.slice(cursor, cursor + limit);
  return {
    contractVersion: CONTRACT_VERSION,
    generatedAt: generatedAt(),
    services: services.map((service) => safeServiceDetail(context, service)),
    pagination: {
      limit,
      nextCursor: cursor + services.length < allServices.length ? String(cursor + services.length) : null,
      total: allServices.length,
    },
    safety: {
      mutating: false,
      redacted: true,
      omittedSensitiveFields: [
        "manifest and service paths",
        "manifest.env",
        "manifest.globalenv",
        "manifest.broker secret payloads",
      ],
    },
  };
}

export async function buildMcpHealthPayload(context: ServiceLassoMcpContext, serviceId?: string) {
  const services = await Promise.all(
    selectedServices(context, serviceId).map(async (service) => {
      const lifecycle = getLifecycleState(service.manifest.id);
      return {
        serviceId: service.manifest.id,
        running: lifecycle.running,
        health: sanitizeHealth(
          context,
          await evaluateServiceHealth(service.manifest, lifecycle, service.serviceRoot, service, context.sharedGlobalEnv),
        ),
      };
    }),
  );

  return {
    contractVersion: CONTRACT_VERSION,
    generatedAt: generatedAt(),
    services,
    summary: {
      total: services.length,
      healthy: services.filter((service) => service.health.healthy).length,
      unhealthy: services.filter((service) => !service.health.healthy).length,
    },
    safety: {
      mutating: false,
      redacted: true,
    },
  };
}

export async function buildMcpRoutesPayload(context: ServiceLassoMcpContext, serviceId?: string) {
  return {
    contractVersion: CONTRACT_VERSION,
    generatedAt: generatedAt(),
    services: selectedServices(context, serviceId).map((service) => {
      const ports = resolvedPorts(service);
      const routeMetadata = buildEffectiveRouteMetadata(service, ports);
      return {
        serviceId: service.manifest.id,
        ports,
        routes: routeMetadata.routes.map((route) => ({
          serviceId: route.serviceId,
          serviceName: safeMcpText(context, route.serviceName),
          endpoint: route.endpoint,
          exposure: route.exposure,
          provider: route.provider,
          target: route.target,
          traefik: route.traefik ?? null,
          configSource: route.configSource,
          state: route.state,
          diagnostics: route.diagnostics.map((entry) => safeMcpText(context, entry)),
          nextAction: safeMcpText(context, route.nextAction),
        })),
      };
    }),
    safety: {
      mutating: false,
      redacted: true,
      omittedSensitiveFields: [
        "route URL credentials, query strings, and fragments",
        "manifest and service paths",
        "raw generated proxy configuration",
      ],
    },
  };
}

export async function buildMcpDependencyStatusPayload(context: ServiceLassoMcpContext, serviceId?: string) {
  const diagnostics = await buildBaselineDependencyDiagnostics(
    context.discovered,
    context.registry,
    context.graph,
    context.sharedGlobalEnv,
  );
  const selected = serviceId
    ? diagnostics.services.filter((service) => service.id === serviceId)
    : diagnostics.services;

  if (serviceId && selected.length === 0) {
    throw new McpReadError("unknown_service", "The requested service is not available.");
  }

  return {
    contractVersion: CONTRACT_VERSION,
    generatedAt: generatedAt(),
    summary: diagnostics.summary,
    services: selected.map((service) => ({
      serviceId: service.id,
      readiness: service.readiness,
      blockingReason: service.blockingReason,
      blockers: service.blockers.map((entry) => safeMcpText(context, entry)),
      nextAction: safeMcpText(context, service.nextAction),
      dependencies: service.dependencies.map((dependency) => ({
        serviceId: dependency.id,
        ready: dependency.ready,
        readiness: dependency.readiness,
        blockingReason: dependency.blockingReason,
      })),
      dependents: service.dependents,
    })),
    safety: {
      mutating: false,
      redacted: true,
      omittedSensitiveFields: ["endpoint URLs", "health payload details that contain local paths"],
    },
  };
}

export async function buildMcpLogsSummaryPayload(
  context: ServiceLassoMcpContext,
  serviceId: string,
  page: { cursor?: unknown; limit?: unknown } = {},
) {
  const service = context.registry.getById(serviceId);
  if (!service) {
    throw new McpReadError("unknown_service", "The requested service is not available.");
  }

  const limit = boundedLimit(page.limit, DEFAULT_LOG_LIMIT, MAX_LOG_LIMIT);
  const requestedCursor = page.cursor === undefined ? undefined : parseOpaqueCursor(page.cursor, Number.MAX_SAFE_INTEGER);
  const logs = await readServiceLogChunk(service, requestedCursor, limit);
  if (requestedCursor !== undefined && requestedCursor > logs.totalLines) {
    throw new McpReadError("invalid_cursor", "The cursor is invalid or stale.");
  }
  return {
    contractVersion: CONTRACT_VERSION,
    generatedAt: generatedAt(),
    serviceId,
    log: {
      type: logs.type,
      totalLines: logs.totalLines,
      cursor: logs.cursor,
      nextCursor: logs.nextCursor,
      limit: logs.limit,
      entries: logs.entries.map((entry) => ({
        source: {
          kind: entry.source.kind,
          archiveId: entry.source.archiveId ?? null,
          lineNumber: entry.source.lineNumber,
        },
        stream: entry.stream,
        summary: safeMcpText(context, redactLogValue(entry.message)),
        truncated: entry.truncated,
      })),
    },
    safety: {
      mutating: false,
      redacted: true,
      omittedSensitiveFields: ["log.path", "log.source.path", "raw secret-like log text"],
    },
  };
}

export async function buildMcpAuditPayload(
  context: ServiceLassoMcpContext,
  input: {
    serviceId?: string;
    actor?: string;
    action?: string;
    outcome?: "success" | "failure";
    source?: string;
    since?: string;
    until?: string;
    query?: string;
    cursor?: unknown;
    limit?: unknown;
  } = {},
) {
  const services = selectedServices(context, input.serviceId);
  const cursor = parseOpaqueCursor(input.cursor, Number.MAX_SAFE_INTEGER);
  const limit = boundedLimit(input.limit, DEFAULT_AUDIT_LIMIT, MAX_AUDIT_LIMIT);
  const query: AuditQuery = {
    serviceId: input.serviceId,
    actor: input.actor,
    action: input.action,
    outcome: input.outcome,
    source: input.source,
    since: input.since,
    until: input.until,
    query: input.query,
    cursor: String(cursor),
    limit: String(limit),
  };
  const audit = await readAuditEvents({
    workspaceRoot: context.workspaceRoot,
    serviceRoots: services.map((service) => service.serviceRoot),
    query,
  });
  if (cursor > audit.pagination.total) {
    throw new McpReadError("invalid_cursor", "The cursor is invalid or stale.");
  }

  return {
    contractVersion: CONTRACT_VERSION,
    generatedAt: generatedAt(),
    chainStatus: audit.chainStatus,
    events: audit.events.map((event) => ({
      id: event.id,
      timestamp: event.timestamp,
      source: safeMcpText(context, event.source),
      action: safeMcpText(context, event.action),
      actor: safeMcpText(context, event.actor),
      subject: event.subject ? safeMcpText(context, event.subject) : null,
      serviceId: event.serviceId ?? null,
      method: event.method ?? null,
      routeTemplate: event.routeTemplate ? safeMcpText(context, event.routeTemplate) : null,
      outcome: event.outcome,
      statusCode: event.statusCode,
      summary: safeMcpText(context, event.summary),
      reason: event.reason ? safeMcpText(context, event.reason) : null,
      correlationId: event.correlationId,
      relatedRevisionId: event.relatedRevisionId,
      chainStatus: event.chainStatus,
    })),
    pagination: audit.pagination,
    safety: {
      mutating: false as const,
      redacted: true as const,
      omittedSensitiveFields: [
        "Audit metadata payloads",
        "chain hashes and storage paths",
        "raw request, config, log, and secret material",
      ],
    },
  };
}

export async function buildMcpUpdatesPayload(
  context: ServiceLassoMcpContext,
  input: { serviceId?: string; cursor?: unknown; limit?: unknown } = {},
) {
  const allServices = selectedServices(context, input.serviceId);
  const cursor = parseOpaqueCursor(input.cursor, allServices.length);
  const limit = boundedLimit(input.limit, DEFAULT_SERVICE_LIMIT, MAX_SERVICE_LIMIT);
  const services = allServices.slice(cursor, cursor + limit);
  const states = await Promise.all(services.map(async (service) => ({
    service,
    update: await readServiceUpdateState(service),
  })));

  return {
    contractVersion: CONTRACT_VERSION,
    generatedAt: generatedAt(),
    services: states.map(({ service, update }) => ({
      serviceId: service.manifest.id,
      installed: getLifecycleState(service.manifest.id).installed,
      declaredVersion: service.manifest.version === undefined
        ? null
        : safeMcpText(context, service.manifest.version),
      state: update.state,
      updatedAt: update.updatedAt,
      lastCheck: update.lastCheck ? {
        checkedAt: update.lastCheck.checkedAt,
        status: update.lastCheck.status,
      } : null,
      available: update.available ? {
        tag: update.available.tag === null ? null : safeMcpText(context, update.available.tag),
        version: update.available.version === null ? null : safeMcpText(context, update.available.version),
        publishedAt: update.available.publishedAt,
      } : null,
      downloadedCandidate: update.downloadedCandidate ? {
        tag: safeMcpText(context, update.downloadedCandidate.tag),
        version: update.downloadedCandidate.version === null
          ? null
          : safeMcpText(context, update.downloadedCandidate.version),
        downloadedAt: update.downloadedCandidate.downloadedAt,
      } : null,
      installDeferredAt: update.installDeferred?.deferredAt ?? null,
      failedAt: update.failed?.failedAt ?? null,
    })),
    pagination: {
      limit,
      nextCursor: cursor + services.length < allServices.length ? String(cursor + services.length) : null,
      total: allServices.length,
    },
    safety: {
      mutating: false as const,
      redacted: true as const,
      omittedSensitiveFields: [
        "release and asset URLs",
        "source repository configuration",
        "archive and extraction paths",
        "hook commands, stdout, and stderr",
        "raw failure and deferral reasons",
      ],
    },
  };
}

export async function buildMcpConfigDriftPayload(context: ServiceLassoMcpContext, serviceId: string) {
  const [service] = selectedServices(context, serviceId);
  if (!service) throw new McpReadError("unknown_service", "The requested service is not available.");
  const drift = await buildServiceConfigDriftReport(service, context.discovered);
  return {
    contractVersion: CONTRACT_VERSION,
    generatedAt: generatedAt(),
    serviceId,
    checkedAt: drift.checkedAt,
    configured: drift.configured,
    summary: drift.summary,
    artifacts: drift.files.map((file) => ({
      artifactId: opaqueArtifactId(serviceId, file.path),
      status: file.status,
    })),
    safety: {
      mutating: false as const,
      redacted: true as const,
      omittedSensitiveFields: [
        "relative and absolute config paths",
        "desired and current hashes, sizes, previews, and values",
      ],
    },
  };
}

export async function buildMcpRecoveryPayload(
  context: ServiceLassoMcpContext,
  serviceId: string,
  page: { cursor?: unknown; limit?: unknown } = {},
) {
  const [service] = selectedServices(context, serviceId);
  if (!service) throw new McpReadError("unknown_service", "The requested service is not available.");
  const recovery = await readServiceRecoveryHistory(service);
  const ordered = recovery.events
    .map((event, index) => ({ event, index }))
    .sort((left, right) => right.event.at.localeCompare(left.event.at) || right.index - left.index);
  const cursor = parseOpaqueCursor(page.cursor, ordered.length);
  const limit = boundedLimit(page.limit, DEFAULT_RECOVERY_LIMIT, MAX_RECOVERY_LIMIT);
  const events = ordered.slice(cursor, cursor + limit).map(({ event }) => {
    const steps = event.kind === "doctor" || event.kind === "hook" ? event.steps : [];
    return {
      kind: event.kind,
      at: event.at,
      action: event.kind === "monitor" ? event.action : null,
      reason: event.kind === "monitor" ? event.reason : null,
      phase: event.kind === "hook" ? safeMcpText(context, event.phase) : null,
      ok: event.kind === "doctor" || event.kind === "hook" || event.kind === "restart" ? event.ok : null,
      blocked: event.kind === "doctor" || event.kind === "hook" ? event.blocked : null,
      stepSummary: {
        total: steps.length,
        failed: steps.filter((step) => !step.ok).length,
        timedOut: steps.filter((step) => step.timedOut).length,
      },
    };
  });

  return {
    contractVersion: CONTRACT_VERSION,
    generatedAt: generatedAt(),
    serviceId,
    updatedAt: recovery.updatedAt,
    events,
    pagination: {
      limit,
      nextCursor: cursor + events.length < ordered.length ? String(cursor + events.length) : null,
      total: ordered.length,
    },
    safety: {
      mutating: false as const,
      redacted: true as const,
      omittedSensitiveFields: ["hook and doctor commands", "stdout and stderr", "paths", "raw recovery messages"],
    },
  };
}

export async function buildMcpOperationStatusPayload(
  context: ServiceLassoMcpContext,
  operationId: string,
  authorization?: McpHttpAuthorization,
  options: Omit<McpOperationServiceOptions, "workspaceRoot"> = {},
) {
  if (!context.workspaceRoot) {
    throw new McpReadError("feature_unavailable", "Durable MCP operation state is unavailable for this runtime.");
  }
  return await new McpOperationService({ workspaceRoot: context.workspaceRoot, ...options }).get(operationId, authorization);
}

export async function buildMcpOperationListPayload(
  context: ServiceLassoMcpContext,
  input: { includeAllActors?: boolean; cursor?: unknown; limit?: unknown } = {},
  authorization?: McpHttpAuthorization,
  options: Omit<McpOperationServiceOptions, "workspaceRoot"> = {},
) {
  if (!context.workspaceRoot) {
    throw new McpReadError("feature_unavailable", "Durable MCP operation state is unavailable for this runtime.");
  }
  const cursor = input.cursor === undefined ? 0 : parseOpaqueCursor(input.cursor, Number.MAX_SAFE_INTEGER);
  const limit = boundedLimit(input.limit, 50, MAX_MCP_OPERATION_LIST_LIMIT);
  return await new McpOperationService({ workspaceRoot: context.workspaceRoot, ...options }).list({
    authorization,
    includeAllActors: input.includeAllActors,
    cursor,
    limit,
  });
}

/**
 * Builds the AC-6A secret-metadata payload from existing audit and rotation
 * facades. Omits absolute paths, secret values, and live lockout fetches.
 */
export async function buildMcpSecretMetadataPayload(context: ServiceLassoMcpContext, serviceId?: string) {
  const services = selectedServices(context, serviceId);
  const secretAudit = buildSecretReferenceAudit(services);
  const rotation = buildSecretRotationReadinessReport(services);
  const rotationByServiceId = new Map(rotation.services.map((service) => [service.serviceId, service]));
  const lockoutStatus: McpLockoutQueryStatus = "not_queried";

  return {
    contractVersion: CONTRACT_VERSION,
    generatedAt: generatedAt(),
    broker: buildMcpBrokerAvailability(context),
    lockout: {
      status: lockoutStatus,
      reason: "Live broker lockout counts stay on the telemetry bridge; this MCP slice does not fetch KV or lockout payloads.",
    },
    summary: {
      services: secretAudit.summary.services,
      references: secretAudit.summary.references,
      present: secretAudit.summary.present,
      missing: secretAudit.summary.missing,
      malformed: secretAudit.summary.malformed,
      rotationReady: rotation.summary.ready,
      rotationNeedsPolicy: rotation.summary.needsPolicy,
      rotationNeedsCapability: rotation.summary.needsCapability,
      rotationNeedsAuthCheck: rotation.summary.needsAuthCheck,
      rotationBlocked: rotation.summary.blocked,
    },
    services: secretAudit.services.map((service) => {
      const rotationReport = rotationByServiceId.get(service.serviceId);
      return {
        serviceId: service.serviceId,
        summary: service.summary,
        references: service.findings.map((finding) => ({
          ref: finding.ref,
          namespace: finding.namespace ?? null,
          key: finding.key ?? null,
          status: finding.status,
          source: finding.source,
          location: finding.location,
          required: finding.required !== false,
          reason: finding.reason,
          accessPolicy: finding.accessPolicy,
        })),
        rotation: (rotationReport?.refs ?? []).map((entry) => ({
          ref: entry.ref,
          namespace: entry.namespace ?? null,
          key: entry.key ?? null,
          status: entry.status,
          policy: entry.policy,
          providerCapability: entry.providerCapability,
          authRequirement: entry.authRequirement,
          blockers: entry.blockers,
        })),
      };
    }),
    safety: {
      mutating: false,
      redacted: true,
      omittedSensitiveFields: [
        "raw secret values",
        "manifest env/globalenv values",
        "broker KV payloads",
        "tokens",
        "cookies",
        "private keys",
        "recovery material",
        "absolute workspace, manifest, and log paths",
        "live lockout payloads",
      ],
    },
  };
}

export async function buildMcpDiagnosticsSummaryPayload(context: ServiceLassoMcpContext, serviceId?: string) {
  const dependencies = await buildMcpDependencyStatusPayload(context, serviceId);
  const secretAudit = buildSecretReferenceAudit(selectedServices(context, serviceId));

  return {
    contractVersion: CONTRACT_VERSION,
    generatedAt: generatedAt(),
    runtime: {
      version: context.version,
      serviceCount: selectedServices(context, serviceId).length,
    },
    dependencies: dependencies.summary,
    secretReferences: secretAudit.summary,
    redaction: getServiceLassoMcpCapabilities(context).scope.redaction,
    safety: {
      mutating: false,
      redacted: true,
      omittedSensitiveFields: [
        "raw secret values and per-reference metadata",
        "manifest env/globalenv values",
        "runtime command payloads",
        "workspace, service, manifest, config, and log paths",
      ],
    },
  };
}

async function callTool(context: ServiceLassoMcpContext, name: string, args: Record<string, unknown>) {
  const serviceId = serviceIdFromArguments(args);

  switch (name) {
    case "service_lasso_runtime_status":
      assertAllowedMcpArguments(args, [], "service_lasso_runtime_status");
      return buildMcpRuntimeStatusPayload(context);
    case "service_lasso_list_services":
      assertAllowedMcpArguments(args, ["cursor", "limit"], "service_lasso_list_services");
      return buildMcpServicesPayload(context, { cursor: args.cursor, limit: args.limit });
    case "service_lasso_get_service":
      assertAllowedMcpArguments(args, ["serviceId"], "service_lasso_get_service");
      if (!serviceId) throw new McpReadError("invalid_request", "serviceId is required.");
      return buildMcpServiceDetailPayload(context, serviceId);
    case "service_lasso_get_health":
      assertAllowedMcpArguments(args, ["serviceId"], "service_lasso_get_health");
      return buildMcpHealthPayload(context, serviceId);
    case "service_lasso_list_routes":
      assertAllowedMcpArguments(args, ["serviceId"], "service_lasso_list_routes");
      return buildMcpRoutesPayload(context, serviceId);
    case "service_lasso_dependency_status":
      assertAllowedMcpArguments(args, ["serviceId"], "service_lasso_dependency_status");
      return buildMcpDependencyStatusPayload(context, serviceId);
    case "service_lasso_logs_summary":
      assertAllowedMcpArguments(args, ["serviceId", "cursor", "limit"], "service_lasso_logs_summary");
      if (!serviceId) {
        throw new McpReadError("invalid_request", "serviceId is required.");
      }
      return buildMcpLogsSummaryPayload(context, serviceId, { cursor: args.cursor, limit: args.limit });
    case "service_lasso_audit_search":
      assertAllowedMcpArguments(
        args,
        ["serviceId", "actor", "action", "outcome", "source", "since", "until", "query", "cursor", "limit"],
        "service_lasso_audit_search",
      );
      return buildMcpAuditPayload(context, {
        serviceId,
        actor: typeof args.actor === "string" ? args.actor : undefined,
        action: typeof args.action === "string" ? args.action : undefined,
        outcome: args.outcome === "success" || args.outcome === "failure" ? args.outcome : undefined,
        source: typeof args.source === "string" ? args.source : undefined,
        since: typeof args.since === "string" ? args.since : undefined,
        until: typeof args.until === "string" ? args.until : undefined,
        query: typeof args.query === "string" ? args.query : undefined,
        cursor: args.cursor,
        limit: args.limit,
      });
    case "service_lasso_update_status":
      assertAllowedMcpArguments(args, ["serviceId", "cursor", "limit"], "service_lasso_update_status");
      return buildMcpUpdatesPayload(context, { serviceId, cursor: args.cursor, limit: args.limit });
    case "service_lasso_config_drift":
      assertAllowedMcpArguments(args, ["serviceId"], "service_lasso_config_drift");
      if (!serviceId) throw new McpReadError("invalid_request", "serviceId is required.");
      return buildMcpConfigDriftPayload(context, serviceId);
    case "service_lasso_recovery_status":
      assertAllowedMcpArguments(args, ["serviceId", "cursor", "limit"], "service_lasso_recovery_status");
      if (!serviceId) throw new McpReadError("invalid_request", "serviceId is required.");
      return buildMcpRecoveryPayload(context, serviceId, { cursor: args.cursor, limit: args.limit });
    case "service_lasso_operation_status":
      assertAllowedMcpArguments(args, ["operationId"], "service_lasso_operation_status");
      if (typeof args.operationId !== "string" || !args.operationId.trim()) {
        throw new McpReadError("invalid_request", "operationId is required.");
      }
      return buildMcpOperationStatusPayload(context, args.operationId.trim());
    case "service_lasso_list_operations":
      assertAllowedMcpArguments(args, ["includeAllActors", "cursor", "limit"], "service_lasso_list_operations");
      return buildMcpOperationListPayload(context, {
        includeAllActors: args.includeAllActors === true,
        cursor: args.cursor,
        limit: args.limit,
      });
    case "service_lasso_diagnostics_summary":
      assertAllowedMcpArguments(args, ["serviceId"], "service_lasso_diagnostics_summary");
      return buildMcpDiagnosticsSummaryPayload(context, serviceId);
    case "service_lasso_secret_metadata":
      assertAllowedMcpArguments(args, SECRET_METADATA_ARGUMENT_KEYS, "service_lasso_secret_metadata");
      return buildMcpSecretMetadataPayload(context, serviceId);
    default:
      throw new Error(`Unknown MCP tool: ${name}`);
  }
}

async function readResource(context: ServiceLassoMcpContext, uri: string) {
  switch (uri) {
    case "servicelasso://runtime":
      return buildMcpRuntimeStatusPayload(context);
    case "servicelasso://services":
      return buildMcpServicesPayload(context);
    case "servicelasso://health":
      return buildMcpHealthPayload(context);
    case "servicelasso://routes":
      return buildMcpRoutesPayload(context);
    case "servicelasso://dependencies":
      return buildMcpDependencyStatusPayload(context);
    case "servicelasso://diagnostics":
      return buildMcpDiagnosticsSummaryPayload(context);
    case "servicelasso://secret-metadata":
      return buildMcpSecretMetadataPayload(context);
    default:
      throw new Error(`Unknown MCP resource: ${uri}`);
  }
}

async function readResourceTemplate(
  context: ServiceLassoMcpContext,
  uriTemplate: ServiceLassoMcpResourceTemplateUri,
  serviceId: string,
) {
  if (!serviceId.trim()) throw new McpReadError("invalid_request", "serviceId is required.");
  switch (uriTemplate) {
    case "servicelasso://services/{serviceId}":
      return buildMcpServiceDetailPayload(context, serviceId);
    case "servicelasso://services/{serviceId}/health":
      return buildMcpHealthPayload(context, serviceId);
    case "servicelasso://services/{serviceId}/routes":
      return buildMcpRoutesPayload(context, serviceId);
    case "servicelasso://services/{serviceId}/dependencies":
      return buildMcpDependencyStatusPayload(context, serviceId);
    case "servicelasso://services/{serviceId}/updates":
      return buildMcpUpdatesPayload(context, { serviceId });
    case "servicelasso://services/{serviceId}/drift":
      return buildMcpConfigDriftPayload(context, serviceId);
    case "servicelasso://services/{serviceId}/recovery":
      return buildMcpRecoveryPayload(context, serviceId);
  }
}

async function readResourceByUri(context: ServiceLassoMcpContext, uri: string) {
  if (mcpResources.some((resource) => resource.uri === uri)) {
    return readResource(context, uri);
  }
  const match = uri.match(/^servicelasso:\/\/services\/([^/]+)(?:\/(health|routes|dependencies|updates|drift|recovery))?$/u);
  if (!match) throw new McpReadError("invalid_request", "Unknown MCP resource.");
  const serviceId = decodeURIComponent(match[1] ?? "");
  const suffix = match[2] ?? null;
  const template = suffix
    ? `servicelasso://services/{serviceId}/${suffix}` as ServiceLassoMcpResourceTemplateUri
    : "servicelasso://services/{serviceId}";
  return readResourceTemplate(context, template, serviceId);
}

function jsonContent(payload: unknown): { type: "text"; text: string }[] {
  return [
    {
      type: "text",
      text: JSON.stringify(payload, null, 2),
    },
  ];
}

function jsonToolResult(payload: Record<string, unknown>) {
  return {
    content: jsonContent(payload),
    structuredContent: payload,
  };
}

function jsonToolErrorResult(error: unknown) {
  const stable = stableMcpError(error);
  const payload = {
    contractVersion: CONTRACT_VERSION,
    error: {
      code: stable.code,
      message: stable.message,
    },
    safety: {
      mutating: false,
      redacted: true,
    },
  };
  return {
    content: jsonContent(payload),
    isError: true as const,
  };
}

export async function handleServiceLassoMcpStreamableHttpRequest(
  context: ServiceLassoMcpContext,
  request: IncomingMessage,
  response: ServerResponse,
  parsedBody: unknown,
  authorization?: McpHttpAuthorization,
  operatingMode: McpOperatingMode = "read-only",
): Promise<void> {
  const server = createServiceLassoMcpServer(context, { authorization, operatingMode });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  try {
    await server.connect(transport);
    const authenticatedRequest = request as IncomingMessage & { auth?: McpHttpAuthorization["authInfo"] };
    if (authorization) authenticatedRequest.auth = authorization.authInfo;
    await transport.handleRequest(authenticatedRequest, response, parsedBody);
  } finally {
    await server.close().catch(() => undefined);
  }
}

function success(id: McpJsonRpcRequest["id"], result: unknown): McpJsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    result,
  };
}

function failure(id: McpJsonRpcRequest["id"], code: number, message: string): McpJsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code,
      message,
    },
  };
}

export async function handleServiceLassoMcpJsonRpcRequest(
  context: ServiceLassoMcpContext,
  request: McpJsonRpcRequest,
): Promise<McpJsonRpcResponse> {
  try {
    if (request.jsonrpc !== "2.0" || typeof request.method !== "string") {
      return failure(request.id, -32600, "Invalid JSON-RPC 2.0 request.");
    }

    if (request.method === "initialize") {
      return success(request.id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: {},
          resources: {},
        },
        serverInfo: {
          name: "service-lasso-operator",
          version: context.version,
        },
      });
    }

    if (request.method === "tools/list") {
      return success(request.id, {
        tools: mcpTools,
      });
    }

    if (request.method === "tools/call") {
      const params = request.params && typeof request.params === "object" ? request.params as Record<string, unknown> : {};
      const name = typeof params.name === "string" ? params.name : "";
      try {
        const payload = await callTool(context, name, safeArguments(request.params));
        return success(request.id, jsonToolResult(payload as unknown as Record<string, unknown>));
      } catch (error) {
        return success(request.id, jsonToolErrorResult(error));
      }
    }

    if (request.method === "resources/list") {
      return success(request.id, {
        resources: mcpResources,
      });
    }

    if (request.method === "resources/read") {
      const params = request.params && typeof request.params === "object" ? request.params as Record<string, unknown> : {};
      const uri = typeof params.uri === "string" ? params.uri : "";
      const payload = await readResourceByUri(context, uri);
      return success(request.id, {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(payload, null, 2),
          },
        ],
      });
    }

    if (request.method === "resources/templates/list") {
      return success(request.id, {
        resourceTemplates: mcpResourceTemplates,
      });
    }

    if (request.method === "notifications/initialized") {
      return success(request.id, {});
    }

    return failure(request.id, -32601, "Unsupported MCP method: " + request.method);
  } catch (error) {
    return failure(request.id, -32000, error instanceof Error ? error.message : "MCP request failed.");
  }
}
