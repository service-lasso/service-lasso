import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import * as z from "zod/v4";
import type { DiscoveredService } from "../../contracts/service.js";
import type { ServiceHealthResult } from "../health/types.js";
import { evaluateServiceHealth } from "../health/evaluateHealth.js";
import { getLifecycleState } from "../lifecycle/store.js";
import type { ServiceRegistry } from "../manager/ServiceRegistry.js";
import type { DependencyGraph } from "../manager/DependencyGraph.js";
import { buildServiceNetwork } from "./network.js";
import { readServiceLogChunk } from "./logs.js";
import { buildBaselineDependencyDiagnostics } from "./dependencyDiagnostics.js";
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
}

export interface McpJsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

interface McpToolDefinition {
  name: ServiceLassoMcpToolName;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: false;
  };
}

interface McpResourceDefinition {
  uri: ServiceLassoMcpResourceUri;
  name: string;
  description: string;
  mimeType: "application/json";
}

type ServiceLassoMcpToolName =
  | "service_lasso_list_services"
  | "service_lasso_get_health"
  | "service_lasso_list_routes"
  | "service_lasso_dependency_status"
  | "service_lasso_logs_summary"
  | "service_lasso_diagnostics_summary"
  | "service_lasso_secret_metadata";

type ServiceLassoMcpResourceUri =
  | "servicelasso://services"
  | "servicelasso://health"
  | "servicelasso://routes"
  | "servicelasso://dependencies"
  | "servicelasso://diagnostics"
  | "servicelasso://secret-metadata";

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
const SECRETS_BROKER_SERVICE_ID = "@secretsbroker";
const SECRET_METADATA_ARGUMENT_KEYS = ["serviceId"] as const;

const READ_ONLY_TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const optionalServiceIdSchema = z.string().trim().min(1).optional();
const logLimitSchema = z.number().finite().optional();

const serviceIdInputSchema = {
  serviceId: {
    type: "string",
    description: "Optional Service Lasso service id. Omit to return all services.",
  },
};

const mcpTools: McpToolDefinition[] = [
  {
    name: "service_lasso_list_services",
    description: "List Service Lasso services with safe manifest, lifecycle, and dependency metadata.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "service_lasso_get_health",
    description: "Read health metadata for one service or every service.",
    inputSchema: {
      type: "object",
      properties: serviceIdInputSchema,
      additionalProperties: false,
    },
  },
  {
    name: "service_lasso_list_routes",
    description: "List safe route and port metadata for one service or every service.",
    inputSchema: {
      type: "object",
      properties: serviceIdInputSchema,
      additionalProperties: false,
    },
  },
  {
    name: "service_lasso_dependency_status",
    description: "Read dependency readiness, blockers, and next-action metadata.",
    inputSchema: {
      type: "object",
      properties: serviceIdInputSchema,
      additionalProperties: false,
    },
  },
  {
    name: "service_lasso_logs_summary",
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
      },
      required: ["serviceId"],
      additionalProperties: false,
    },
  },
  {
    name: "service_lasso_diagnostics_summary",
    description: "Read safe diagnostic counts, dependency status, and secret-reference audit summaries.",
    inputSchema: {
      type: "object",
      properties: serviceIdInputSchema,
      additionalProperties: false,
    },
  },
  {
    name: "service_lasso_secret_metadata",
    description:
      "Inspect secret metadata only: refs, assignment, rotation readiness, and Secrets Broker availability. Never returns secret values.",
    inputSchema: {
      type: "object",
      properties: serviceIdInputSchema,
      additionalProperties: false,
    },
  },
];

const mcpResources: McpResourceDefinition[] = [
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

function generatedAt(): string {
  return new Date().toISOString();
}

function clampLogLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_LOG_LIMIT;
  }

  return Math.max(1, Math.min(MAX_LOG_LIMIT, Math.trunc(value)));
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
 * Rejects extra JSON-RPC tool arguments so this slice runtime-validates
 * `additionalProperties: false` for secret metadata.
 */
function assertAllowedMcpArguments(
  args: Record<string, unknown>,
  allowed: readonly string[],
  toolName: ServiceLassoMcpToolName,
): void {
  const extra = Object.keys(args).filter((key) => !allowed.includes(key));
  if (extra.length > 0) {
    throw new Error(`${toolName} rejects additional properties: ${extra.join(", ")}.`);
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
    throw new Error("Unknown service id: " + serviceId);
  }

  return [service];
}

function resolvedPorts(service: DiscoveredService): Record<string, number> {
  const lifecycle = getLifecycleState(service.manifest.id);
  return Object.keys(lifecycle.runtime.ports).length > 0 ? lifecycle.runtime.ports : service.manifest.ports ?? {};
}

function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    const safePath = String(redactDiagnosticsValue(url.pathname));
    return `${url.protocol}//${url.host}${safePath}`;
  } catch {
    const redacted = String(redactDiagnosticsValue(value));
    return redacted.split("?")[0]?.split("#")[0] ?? redacted;
  }
}

function redactLogValue(value: string): string {
  return String(redactDiagnosticsValue(value));
}

function sanitizeHealth(health: ServiceHealthResult): ServiceHealthResult {
  return redactDiagnosticsValue(health) as ServiceHealthResult;
}

export function getServiceLassoMcpCapabilities(context: ServiceLassoMcpContext) {
  return {
    contractVersion: CONTRACT_VERSION,
    protocolVersion: MCP_PROTOCOL_VERSION,
    sdk: {
      packageName: MCP_SDK_PACKAGE,
      version: MCP_SDK_VERSION,
      streamableHttp: "stateless",
      stdio: "planned thin active-runtime adapter",
    },
    serverInfo: {
      name: "service-lasso-operator",
      version: context.version,
    },
    scope: {
      mutatingOperations: "omitted",
      tools: "read-only",
      resources: "read-only",
      redaction: {
        value: REDACTION_VALUE,
        rules: [
          "raw manifest env/globalenv values are not returned",
          "runtime log text is pattern-redacted before MCP responses",
          "route URLs strip username, password, query string, and fragment",
          "secret metadata returns refs, assignment, and rotation state only",
          "mutating lifecycle and command-confirmation operations are not exposed as MCP tools",
        ],
      },
    },
    tools: mcpTools,
    resources: mcpResources,
    runtime: {
      servicesRoot: context.servicesRoot,
      workspaceRoot: context.workspaceRoot ?? null,
      serviceCount: context.discovered.length,
    },
  };
}

export function createServiceLassoMcpServer(context: ServiceLassoMcpContext): McpServer {
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

  server.registerTool(
    "service_lasso_list_services",
    {
      title: "List services",
      description: "List Service Lasso services with safe manifest, lifecycle, and dependency metadata.",
      inputSchema: {},
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async () => ({ content: jsonContent(await buildMcpServicesPayload(context)) }),
  );

  server.registerTool(
    "service_lasso_get_health",
    {
      title: "Get service health",
      description: "Read health metadata for one service or every service.",
      inputSchema: {
        serviceId: optionalServiceIdSchema.describe("Optional Service Lasso service id. Omit to return all services."),
      },
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async ({ serviceId }) => ({ content: jsonContent(await buildMcpHealthPayload(context, serviceId)) }),
  );

  server.registerTool(
    "service_lasso_list_routes",
    {
      title: "List service routes",
      description: "List safe route and port metadata for one service or every service.",
      inputSchema: {
        serviceId: optionalServiceIdSchema.describe("Optional Service Lasso service id. Omit to return all services."),
      },
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async ({ serviceId }) => ({ content: jsonContent(await buildMcpRoutesPayload(context, serviceId)) }),
  );

  server.registerTool(
    "service_lasso_dependency_status",
    {
      title: "Dependency status",
      description: "Read dependency readiness, blockers, and next-action metadata.",
      inputSchema: {
        serviceId: optionalServiceIdSchema.describe("Optional Service Lasso service id. Omit to return all services."),
      },
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async ({ serviceId }) => ({ content: jsonContent(await buildMcpDependencyStatusPayload(context, serviceId)) }),
  );

  server.registerTool(
    "service_lasso_logs_summary",
    {
      title: "Logs summary",
      description: "Read a bounded, redacted runtime log summary for one service.",
      inputSchema: {
        serviceId: z.string().trim().min(1).describe("Service Lasso service id."),
        limit: logLimitSchema.describe("Maximum recent log lines to return. Defaults to 20 and is capped at 50."),
      },
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async ({ serviceId, limit }) => ({
      content: jsonContent(await buildMcpLogsSummaryPayload(context, serviceId, clampLogLimit(limit))),
    }),
  );

  server.registerTool(
    "service_lasso_diagnostics_summary",
    {
      title: "Diagnostics summary",
      description: "Read safe diagnostic counts, dependency status, and secret-reference audit summaries.",
      inputSchema: {
        serviceId: optionalServiceIdSchema.describe("Optional Service Lasso service id. Omit to return all services."),
      },
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async ({ serviceId }) => ({ content: jsonContent(await buildMcpDiagnosticsSummaryPayload(context, serviceId)) }),
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
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async ({ serviceId }) => ({ content: jsonContent(await buildMcpSecretMetadataPayload(context, serviceId)) }),
  );

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

  return server;
}

export async function buildMcpServicesPayload(context: ServiceLassoMcpContext, serviceId?: string) {
  return {
    contractVersion: CONTRACT_VERSION,
    generatedAt: generatedAt(),
    services: selectedServices(context, serviceId).map((service) => {
      const lifecycle = getLifecycleState(service.manifest.id);
      const dependencySummary = context.graph.getServiceDependencies(service.manifest.id);
      return {
        id: service.manifest.id,
        name: service.manifest.name,
        description: service.manifest.description,
        enabled: service.manifest.enabled !== false,
        role: service.manifest.role ?? "service",
        version: service.manifest.version ?? null,
        installed: lifecycle.installed,
        configured: lifecycle.configured,
        running: lifecycle.running,
        dependencies: dependencySummary.dependencies,
        dependents: dependencySummary.dependents,
        ports: resolvedPorts(service),
        manifestPath: service.manifestPath,
        serviceRoot: service.serviceRoot,
      };
    }),
    safety: {
      mutating: false,
      redacted: true,
      omittedSensitiveFields: ["manifest.env", "manifest.globalenv", "manifest.broker secret payloads"],
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
      const network = buildServiceNetwork(service, context.sharedGlobalEnv, resolvedPorts(service));
      return {
        serviceId: service.manifest.id,
        ports: network.ports,
        portmapping: redactDiagnosticsValue(network.portmapping),
        endpoints: network.endpoints.map((endpoint) => ({
          label: endpoint.label,
          kind: endpoint.kind,
          url: endpoint.url ? sanitizeUrl(endpoint.url) : null,
        })),
      };
    }),
    safety: {
      mutating: false,
      redacted: true,
      omittedSensitiveFields: ["url.username", "url.password", "url.search", "url.hash"],
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
    throw new Error("Unknown service id: " + serviceId);
  }

  return {
    contractVersion: CONTRACT_VERSION,
    generatedAt: generatedAt(),
    diagnostics: {
      summary: diagnostics.summary,
      services: selected.map((service) => ({
        ...service,
        endpoints: service.endpoints.map((endpoint) => ({
          ...endpoint,
          url: sanitizeUrl(endpoint.url),
        })),
        health: sanitizeHealth(service.health),
      })),
    },
    safety: {
      mutating: false,
      redacted: true,
    },
  };
}

export async function buildMcpLogsSummaryPayload(context: ServiceLassoMcpContext, serviceId: string, limit = DEFAULT_LOG_LIMIT) {
  const service = context.registry.getById(serviceId);
  if (!service) {
    throw new Error("Unknown service id: " + serviceId);
  }

  const logs = await readServiceLogChunk(service, undefined, clampLogLimit(limit));
  return {
    contractVersion: CONTRACT_VERSION,
    generatedAt: generatedAt(),
    serviceId,
    log: {
      type: logs.type,
      totalLines: logs.totalLines,
      start: logs.start,
      end: logs.end,
      hasMore: logs.hasMore,
      nextCursor: logs.nextCursor,
      limit: logs.limit,
      entries: logs.entries.map((entry) => ({
        source: {
          kind: entry.source.kind,
          archiveId: entry.source.archiveId,
          lineNumber: entry.source.lineNumber,
        },
        stream: entry.stream,
        message: redactLogValue(entry.message),
        text: redactLogValue(entry.text),
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
      servicesRoot: context.servicesRoot,
      workspaceRoot: context.workspaceRoot ?? null,
      serviceCount: selectedServices(context, serviceId).length,
    },
    dependencies: dependencies.diagnostics.summary,
    secretReferences: secretAudit.summary,
    services: secretAudit.services.map((service) => ({
      serviceId: service.serviceId,
      summary: service.summary,
      findings: service.findings.map((finding) => ({
        ref: finding.ref,
        namespace: finding.namespace,
        key: finding.key,
        status: finding.status,
        source: finding.source,
        location: finding.location,
        required: finding.required,
        accessPolicy: finding.accessPolicy,
      })),
    })),
    redaction: getServiceLassoMcpCapabilities(context).scope.redaction,
    safety: {
      mutating: false,
      redacted: true,
      omittedSensitiveFields: ["raw secret values", "manifest env/globalenv values", "runtime command payloads"],
    },
  };
}

async function callTool(context: ServiceLassoMcpContext, name: string, args: Record<string, unknown>) {
  const serviceId = serviceIdFromArguments(args);

  switch (name) {
    case "service_lasso_list_services":
      return buildMcpServicesPayload(context);
    case "service_lasso_get_health":
      return buildMcpHealthPayload(context, serviceId);
    case "service_lasso_list_routes":
      return buildMcpRoutesPayload(context, serviceId);
    case "service_lasso_dependency_status":
      return buildMcpDependencyStatusPayload(context, serviceId);
    case "service_lasso_logs_summary":
      if (!serviceId) {
        throw new Error("service_lasso_logs_summary requires serviceId.");
      }
      return buildMcpLogsSummaryPayload(context, serviceId, clampLogLimit(args.limit));
    case "service_lasso_diagnostics_summary":
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

function jsonContent(payload: unknown): { type: "text"; text: string }[] {
  return [
    {
      type: "text",
      text: JSON.stringify(payload, null, 2),
    },
  ];
}

export async function handleServiceLassoMcpStreamableHttpRequest(
  context: ServiceLassoMcpContext,
  request: IncomingMessage,
  response: ServerResponse,
  parsedBody: unknown,
  authInfo?: AuthInfo,
): Promise<void> {
  const server = createServiceLassoMcpServer(context);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  try {
    await server.connect(transport);
    const authenticatedRequest = request as IncomingMessage & { auth?: AuthInfo };
    if (authInfo) authenticatedRequest.auth = authInfo;
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
      const payload = await callTool(context, name, safeArguments(request.params));
      return success(request.id, {
        content: jsonContent(payload),
        isError: false,
      });
    }

    if (request.method === "resources/list") {
      return success(request.id, {
        resources: mcpResources,
      });
    }

    if (request.method === "resources/read") {
      const params = request.params && typeof request.params === "object" ? request.params as Record<string, unknown> : {};
      const uri = typeof params.uri === "string" ? params.uri : "";
      const payload = await readResource(context, uri);
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

    if (request.method === "notifications/initialized") {
      return success(request.id, {});
    }

    return failure(request.id, -32601, "Unsupported MCP method: " + request.method);
  } catch (error) {
    return failure(request.id, -32000, error instanceof Error ? error.message : "MCP request failed.");
  }
}
