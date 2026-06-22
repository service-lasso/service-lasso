import { createHash } from "node:crypto";
import type { DiscoveredService } from "../../contracts/service.js";
import type { ServiceHealthResult } from "../health/types.js";
import type { ServiceLifecycleState } from "../lifecycle/types.js";

export const TELEMETRY_PREVIEW_CONTRACT_VERSION = "service-lasso.telemetry-preview.v1";

export type TelemetryExporterStatus = "disabled" | "configured";
export type TelemetryExportMode = "disabled" | "dry_run";
export type TelemetrySignalKind = "span" | "metric";
export type ApiRequestOutcome = "success" | "client_error" | "server_error" | "redirect" | "informational";

export interface TelemetryAttributePolicy {
  mode: "allowlist";
  allowedAttributes: string[];
  forbiddenFieldClasses: string[];
  omittedFieldExamples: string[];
}

export interface TelemetryExporterPreview {
  status: TelemetryExporterStatus;
  protocol: "otlp-http";
  endpointConfigured: boolean;
  endpointValueReturned: false;
  headersValueReturned: false;
  reason: string;
}

export interface TelemetryResourcePreview {
  serviceName: "service-lasso-core";
  serviceNamespace: "service-lasso";
  serviceInstanceId: "local-runtime";
}

export interface TelemetryExportEnvelopePreview {
  mode: TelemetryExportMode;
  status: "not_sent";
  protocol: "otlp-http";
  contentType: "application/json";
  signalCount: number;
  serviceCount: number;
  endpointConfigured: boolean;
  endpointValueReturned: false;
  headersValueReturned: false;
  bodyValueReturned: false;
  allowedAttributeCount: number;
  droppedFieldClasses: string[];
  safeEnvelopeFields: string[];
  reason: string;
}

export interface TelemetrySignalPreview {
  kind: TelemetrySignalKind;
  name: string;
  traceId: string;
  spanId: string;
  correlationId: string;
  attributes: Record<string, string | number | boolean>;
}

export interface ServiceTelemetryPreview {
  serviceId: string;
  signals: TelemetrySignalPreview[];
}

export interface ApiRequestTelemetryPreview {
  routeGroup: string;
  routeTemplate: string;
  signal: TelemetrySignalPreview;
}

export interface RuntimeTelemetryPreview {
  contractVersion: typeof TELEMETRY_PREVIEW_CONTRACT_VERSION;
  exporter: TelemetryExporterPreview;
  resource: TelemetryResourcePreview;
  redaction: TelemetryAttributePolicy;
  exportPreview: TelemetryExportEnvelopePreview;
  apiRequests: ApiRequestTelemetryPreview[];
  services: ServiceTelemetryPreview[];
}

const allowedTelemetryAttributes = [
  "api.mutating",
  "api.route_group",
  "http.request.method",
  "http.route",
  "http.response.status_class",
  "http.response.status_code",
  "service.id",
  "service.role",
  "service.enabled",
  "service.version",
  "service.artifact.tag",
  "service.artifact.asset",
  "service.lifecycle.installed",
  "service.lifecycle.configured",
  "service.lifecycle.running",
  "service.lifecycle.last_action",
  "service.runtime.provider",
  "service.runtime.provider_service_id",
  "service.health.status",
  "service.health.readiness",
  "service.health.blocking_reason",
  "service.operation.phase",
  "service.operation.outcome",
  "service.operation.duration_ms",
  "service.operation.count",
] as const;

const allowedTelemetryAttributeSet = new Set<string>(allowedTelemetryAttributes);

export const telemetryAttributePolicy: TelemetryAttributePolicy = {
  mode: "allowlist",
  allowedAttributes: [...allowedTelemetryAttributes],
  forbiddenFieldClasses: [
    "raw secret values",
    "environment values",
    "provider tokens or credentials",
    "cookies and authorization headers",
    "private keys and recovery material",
    "raw request or response bodies",
    "raw URL paths and query strings",
    "full file contents",
    "raw service config values",
  ],
  omittedFieldExamples: [
    "env",
    "globalenv",
    "config.files[].content",
    "install.files[].content",
    "headers",
    "request.url",
    "request.query",
    "requestBody",
    "responseBody",
    "providerCredential",
  ],
};

function hashHex(input: string, length: number): string {
  return createHash("sha256").update(input).digest("hex").slice(0, length);
}

function traceIdFor(serviceId: string): string {
  return hashHex(`service-lasso:telemetry:${serviceId}`, 32);
}

function spanIdFor(serviceId: string, name: string): string {
  return hashHex(`service-lasso:telemetry:${serviceId}:${name}`, 16);
}

function correlationIdFor(serviceId: string): string {
  return `sl-${hashHex(`service-lasso:correlation:${serviceId}`, 16)}`;
}

function requestTraceIdFor(routeTemplate: string, method: string): string {
  return hashHex(`service-lasso:api-request:${method}:${routeTemplate}`, 32);
}

function requestSpanIdFor(routeTemplate: string, method: string, statusCode: number): string {
  return hashHex(`service-lasso:api-request:${method}:${routeTemplate}:${statusCode}`, 16);
}

function requestCorrelationIdFor(routeTemplate: string, method: string): string {
  return `sl-${hashHex(`service-lasso:api-correlation:${method}:${routeTemplate}`, 16)}`;
}

function allowlistedAttributes(
  attributes: Record<string, string | number | boolean | null | undefined>,
): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(attributes)) {
    if (!allowedTelemetryAttributeSet.has(key) || value === null || value === undefined) {
      continue;
    }
    result[key] = value;
  }

  return result;
}

function serviceVersion(service: DiscoveredService): string {
  const version = service.catalogProvenance.releaseTag ?? service.manifest.version;
  return typeof version === "string" && version.trim().length > 0 ? version : "unversioned";
}

function serviceArtifactTag(lifecycle: ServiceLifecycleState): string | null {
  return lifecycle.installArtifacts.artifact?.tag ?? null;
}

function serviceArtifactAsset(lifecycle: ServiceLifecycleState): string | null {
  return lifecycle.installArtifacts.artifact?.assetName ?? null;
}

function healthStatus(health: ServiceHealthResult): "healthy" | "unhealthy" {
  return health.healthy ? "healthy" : "unhealthy";
}

function lifecycleOutcome(lifecycle: ServiceLifecycleState, health: ServiceHealthResult): string {
  if (!lifecycle.installed) {
    return "not_installed";
  }
  if (!lifecycle.configured) {
    return "not_configured";
  }
  if (!lifecycle.running) {
    return "not_running";
  }
  return health.healthy ? "healthy" : "unhealthy";
}

function statusClass(statusCode: number): string {
  if (statusCode >= 100 && statusCode < 600) {
    return `${Math.trunc(statusCode / 100)}xx`;
  }
  return "unknown";
}

function requestOutcome(statusCode: number): ApiRequestOutcome {
  if (statusCode >= 500) {
    return "server_error";
  }
  if (statusCode >= 400) {
    return "client_error";
  }
  if (statusCode >= 300) {
    return "redirect";
  }
  if (statusCode >= 200) {
    return "success";
  }
  return "informational";
}

export interface ApiRequestTelemetryInput {
  method: string;
  routeGroup: string;
  routeTemplate: string;
  mutating: boolean;
  statusCode: number;
  durationMs: number;
}

export function classifyTelemetryRoute(pathname: string): {
  routeGroup: string;
  routeTemplate: string;
  mutating: boolean;
} {
  const parts = pathname.split("/").filter(Boolean);

  if (parts[0] !== "api") {
    return {
      routeGroup: "static",
      routeTemplate: "/{static}",
      mutating: false,
    };
  }

  if (parts[1] === "services") {
    if (parts.length === 2) {
      return { routeGroup: "services", routeTemplate: "/api/services", mutating: false };
    }
    if (parts.length === 3) {
      return { routeGroup: "services", routeTemplate: "/api/services/{serviceId}", mutating: false };
    }

    const leaf = parts[3];
    const child = parts[4];
    const leafTemplates: Record<string, string> = {
      "config-drift": "/api/services/{serviceId}/config-drift",
      health: child === "history" ? "/api/services/{serviceId}/health/history" : "/api/services/{serviceId}/health",
      logs: "/api/services/{serviceId}/logs",
      meta: "/api/services/{serviceId}/meta",
      metrics: "/api/services/{serviceId}/metrics",
      network: "/api/services/{serviceId}/network",
      recovery:
        child === "doctor"
          ? "/api/services/{serviceId}/recovery/doctor"
          : child === "restart-preflight"
            ? "/api/services/{serviceId}/recovery/restart-preflight"
            : "/api/services/{serviceId}/recovery",
      secrets:
        child === "audit"
          ? "/api/services/{serviceId}/secrets/audit"
          : child === "rotation-readiness"
            ? "/api/services/{serviceId}/secrets/rotation-readiness"
            : child === "provider-auth-required"
              ? "/api/services/{serviceId}/secrets/provider-auth-required"
              : "/api/services/{serviceId}/secrets/{section}",
      setup: child === "run" ? "/api/services/{serviceId}/setup/run/{stepId}" : "/api/services/{serviceId}/setup",
      "start-trace": "/api/services/{serviceId}/start-trace",
      telemetry: "/api/services/{serviceId}/telemetry",
      update:
        child === "download"
          ? "/api/services/{serviceId}/update/download"
          : child === "install"
            ? "/api/services/{serviceId}/update/install"
            : "/api/services/{serviceId}/update/{action}",
      variables: "/api/services/{serviceId}/variables",
    };

    return {
      routeGroup: "services",
      routeTemplate: leafTemplates[leaf] ?? "/api/services/{serviceId}/{section}",
      mutating: false,
    };
  }

  if (parts[1] === "runtime") {
    let routeTemplate = "/api/runtime";
    if (parts[2] === "actions") {
      routeTemplate = parts[4] === "plan" ? "/api/runtime/actions/{action}/plan" : "/api/runtime/actions/{action}";
    } else if (parts[2] === "capabilities") {
      routeTemplate = "/api/runtime/capabilities";
    } else if (parts[2] === "instance") {
      routeTemplate = "/api/runtime/instance";
    } else if (parts[2] === "ports" && parts[3] === "conflict") {
      routeTemplate = "/api/runtime/ports/conflict";
    } else if (typeof parts[2] === "string") {
      routeTemplate = "/api/runtime/{section}";
    }

    return {
      routeGroup: "runtime",
      routeTemplate,
      mutating: false,
    };
  }

  if (parts[1] === "telemetry") {
    return { routeGroup: "telemetry", routeTemplate: "/api/telemetry", mutating: false };
  }

  if (parts[1] === "health") {
    return { routeGroup: "health", routeTemplate: "/api/health", mutating: false };
  }

  const topLevelRoutes = new Set([
    "dashboard",
    "dependencies",
    "diagnostics",
    "globalenv",
    "logs",
    "metrics",
    "mcp",
    "network",
    "operator",
    "secrets",
    "updates",
    "variables",
    "workflows",
  ]);

  if (typeof parts[1] === "string" && topLevelRoutes.has(parts[1])) {
    return {
      routeGroup: parts[1],
      routeTemplate: `/api/${parts[1]}`,
      mutating: false,
    };
  }

  return {
    routeGroup: "api-other",
    routeTemplate: "/api/{unmatched}",
    mutating: false,
  };
}

export function buildApiRequestTelemetryPreview(input: ApiRequestTelemetryInput): ApiRequestTelemetryPreview {
  const method = input.method.toUpperCase();
  const durationMs = Number.isFinite(input.durationMs) ? Math.max(0, Math.round(input.durationMs)) : 0;

  return {
    routeGroup: input.routeGroup,
    routeTemplate: input.routeTemplate,
    signal: {
      kind: "span",
      name: "service_lasso.api.request",
      traceId: requestTraceIdFor(input.routeTemplate, method),
      spanId: requestSpanIdFor(input.routeTemplate, method, input.statusCode),
      correlationId: requestCorrelationIdFor(input.routeTemplate, method),
      attributes: allowlistedAttributes({
        "http.request.method": method,
        "http.route": input.routeTemplate,
        "http.response.status_code": input.statusCode,
        "http.response.status_class": statusClass(input.statusCode),
        "api.route_group": input.routeGroup,
        "api.mutating": input.mutating,
        "service.operation.phase": "api_request",
        "service.operation.outcome": requestOutcome(input.statusCode),
        "service.operation.duration_ms": durationMs,
        "service.operation.count": 1,
      }),
    },
  };
}

export function buildServiceTelemetryPreview(
  service: DiscoveredService,
  lifecycle: ServiceLifecycleState,
  health: ServiceHealthResult,
): ServiceTelemetryPreview {
  const serviceId = service.manifest.id;
  const common = {
    "service.id": serviceId,
    "service.role": service.manifest.role === "provider" ? "provider" : "service",
    "service.enabled": service.manifest.enabled !== false,
    "service.version": serviceVersion(service),
    "service.artifact.tag": serviceArtifactTag(lifecycle),
    "service.artifact.asset": serviceArtifactAsset(lifecycle),
    "service.lifecycle.installed": lifecycle.installed,
    "service.lifecycle.configured": lifecycle.configured,
    "service.lifecycle.running": lifecycle.running,
    "service.lifecycle.last_action": lifecycle.lastAction,
    "service.runtime.provider": lifecycle.runtime.provider,
    "service.runtime.provider_service_id": lifecycle.runtime.providerServiceId,
    "service.health.status": healthStatus(health),
    "service.health.readiness": health.healthy ? "ready" : "blocked",
    "service.health.blocking_reason": health.healthy ? null : health.detail,
  };

  const traceId = traceIdFor(serviceId);
  const correlationId = correlationIdFor(serviceId);

  return {
    serviceId,
    signals: [
      {
        kind: "span",
        name: "service_lasso.service.lifecycle",
        traceId,
        spanId: spanIdFor(serviceId, "lifecycle"),
        correlationId,
        attributes: allowlistedAttributes({
          ...common,
          "service.operation.phase": "lifecycle",
          "service.operation.outcome": lifecycleOutcome(lifecycle, health),
          "service.operation.duration_ms": lifecycle.runtime.metrics.lastRunDurationMs,
        }),
      },
      {
        kind: "span",
        name: "service_lasso.service.health_check",
        traceId,
        spanId: spanIdFor(serviceId, "health_check"),
        correlationId,
        attributes: allowlistedAttributes({
          ...common,
          "service.operation.phase": "health_check",
          "service.operation.outcome": healthStatus(health),
        }),
      },
      {
        kind: "metric",
        name: "service_lasso.service.runtime.launches",
        traceId,
        spanId: spanIdFor(serviceId, "runtime_launches"),
        correlationId,
        attributes: allowlistedAttributes({
          ...common,
          "service.operation.phase": "runtime_metrics",
          "service.operation.outcome": lifecycleOutcome(lifecycle, health),
          "service.operation.duration_ms": lifecycle.runtime.metrics.totalRunDurationMs,
        }),
      },
    ],
  };
}

function readExporterPreviewFromEnv(env: NodeJS.ProcessEnv): TelemetryExporterPreview {
  const enabled = env.SERVICE_LASSO_OTEL_ENABLED === "1" || env.SERVICE_LASSO_OTEL_ENABLED === "true";
  const endpointConfigured = typeof env.OTEL_EXPORTER_OTLP_ENDPOINT === "string" && env.OTEL_EXPORTER_OTLP_ENDPOINT.trim().length > 0;

  return {
    status: enabled && endpointConfigured ? "configured" : "disabled",
    protocol: "otlp-http",
    endpointConfigured,
    endpointValueReturned: false,
    headersValueReturned: false,
    reason:
      enabled && endpointConfigured
        ? "OTLP HTTP export is configured; endpoint and headers are intentionally not returned by the API."
        : "OTLP export is disabled until SERVICE_LASSO_OTEL_ENABLED and OTEL_EXPORTER_OTLP_ENDPOINT are configured.",
  };
}

function readExportModeFromEnv(
  env: NodeJS.ProcessEnv,
  exporter: TelemetryExporterPreview,
): TelemetryExportMode {
  const requestedMode = String(env.SERVICE_LASSO_OTEL_EXPORT_MODE ?? "").trim().toLowerCase();

  if (exporter.status === "configured" && requestedMode === "dry-run") {
    return "dry_run";
  }

  return "disabled";
}

function buildTelemetryExportEnvelopePreview(
  services: ServiceTelemetryPreview[],
  apiRequests: ApiRequestTelemetryPreview[],
  exporter: TelemetryExporterPreview,
  redaction: TelemetryAttributePolicy,
  env: NodeJS.ProcessEnv,
): TelemetryExportEnvelopePreview {
  const mode = readExportModeFromEnv(env, exporter);
  const serviceSignalCount = services.reduce((count, service) => count + service.signals.length, 0);
  const signalCount = serviceSignalCount + apiRequests.length;

  return {
    mode,
    status: "not_sent",
    protocol: "otlp-http",
    contentType: "application/json",
    signalCount,
    serviceCount: services.length,
    endpointConfigured: exporter.endpointConfigured,
    endpointValueReturned: false,
    headersValueReturned: false,
    bodyValueReturned: false,
    allowedAttributeCount: redaction.allowedAttributes.length,
    droppedFieldClasses: [...redaction.forbiddenFieldClasses],
    safeEnvelopeFields: [
      "resource.serviceName",
      "resource.serviceNamespace",
      "resource.serviceInstanceId",
      "signals.kind",
      "signals.name",
      "signals.traceId",
      "signals.spanId",
      "signals.correlationId",
      "signals.attributes",
      "apiRequests.routeGroup",
      "apiRequests.routeTemplate",
    ],
    reason:
      mode === "dry_run"
        ? "Dry-run OTLP export envelope is ready for local verification; the runtime does not send telemetry from this preview API."
        : "OTLP export remains disabled; set SERVICE_LASSO_OTEL_ENABLED, OTEL_EXPORTER_OTLP_ENDPOINT, and SERVICE_LASSO_OTEL_EXPORT_MODE=dry-run to preview an export envelope.",
  };
}

export function buildRuntimeTelemetryPreview(
  services: ServiceTelemetryPreview[],
  apiRequests: ApiRequestTelemetryPreview[] = [],
  env: NodeJS.ProcessEnv = process.env,
): RuntimeTelemetryPreview {
  const exporter = readExporterPreviewFromEnv(env);
  const resource: TelemetryResourcePreview = {
    serviceName: "service-lasso-core",
    serviceNamespace: "service-lasso",
    serviceInstanceId: "local-runtime",
  };

  return {
    contractVersion: TELEMETRY_PREVIEW_CONTRACT_VERSION,
    exporter,
    resource,
    redaction: telemetryAttributePolicy,
    exportPreview: buildTelemetryExportEnvelopePreview(
      services,
      apiRequests,
      exporter,
      telemetryAttributePolicy,
      env,
    ),
    apiRequests,
    services,
  };
}
