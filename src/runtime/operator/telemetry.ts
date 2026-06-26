import { createHash, randomUUID } from "node:crypto";
import type { DiscoveredService } from "../../contracts/service.js";
import { summarizeServiceHealthRegression, type ServiceHealthHistoryState } from "../health/history.js";
import type { ServiceHealthResult } from "../health/types.js";
import type { ServiceLifecycleState, ServiceStartTraceAttempt, ServiceStartTraceEvent } from "../lifecycle/types.js";
import type { ServiceUpdateState, ServiceUpdateStateKind } from "../updates/state.js";

export const TELEMETRY_PREVIEW_CONTRACT_VERSION = "service-lasso.telemetry-preview.v1";
export const TELEMETRY_CORRELATION_ID_HEADER = "x-service-lasso-correlation-id";
export const TELEMETRY_TRACE_ID_HEADER = "x-service-lasso-trace-id";
export const TELEMETRY_TRACEPARENT_HEADER = "traceparent";

export type TelemetryExporterStatus = "disabled" | "configured";
export type TelemetryExportMode = "disabled" | "dry_run" | "export_configured";
export type TelemetryExportTestMode = "disabled" | "mock_collector";
export type TelemetryExportTestStatus = "not_sent" | "sent" | "failed" | "blocked";
export type TelemetryExportActionMode = "disabled" | "export";
export type TelemetryContinuousExportStatus = "disabled" | "configured" | "running";
export type TelemetrySignalKind = "span" | "metric";
export type ApiRequestOutcome = "success" | "client_error" | "server_error" | "redirect" | "informational";

export interface TelemetryAttributePolicy {
  mode: "allowlist";
  redactedValue: "[REDACTED]";
  allowedAttributes: string[];
  forbiddenFieldClasses: string[];
  patternClasses: string[];
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

export interface TelemetryExportTestResult {
  mode: TelemetryExportTestMode;
  status: TelemetryExportTestStatus;
  protocol: "otlp-http";
  contentType: "application/json";
  signalCount: number;
  serviceCount: number;
  endpointConfigured: boolean;
  endpointValueReturned: false;
  headersValueReturned: false;
  bodyValueReturned: false;
  localCollectorOnly: true;
  collectorStatusCode: number | null;
  reason: string;
}

export interface TelemetryExportActionResult {
  mode: TelemetryExportActionMode;
  status: TelemetryExportTestStatus;
  protocol: "otlp-http";
  contentType: "application/json";
  signalCount: number;
  serviceCount: number;
  endpointConfigured: boolean;
  endpointValueReturned: false;
  headersConfigured: boolean;
  headersValueReturned: false;
  bodyValueReturned: false;
  exporterStatusCode: number | null;
  reason: string;
}

export interface TelemetryContinuousExportRuntimeState {
  running: boolean;
  intervalMs: number;
  inFlight: boolean;
  lastAttemptAt: string | null;
  lastResult: TelemetryExportActionResult | null;
}

export interface TelemetryContinuousExportPreview {
  status: TelemetryContinuousExportStatus;
  intervalMs: number | null;
  inFlight: boolean;
  lastAttemptAt: string | null;
  lastStatus: TelemetryExportTestStatus | null;
  exporterStatusCode: number | null;
  endpointConfigured: boolean;
  endpointValueReturned: false;
  headersConfigured: boolean;
  headersValueReturned: false;
  bodyValueReturned: false;
  reason: string;
}

export interface TelemetrySignalPreview {
  kind: TelemetrySignalKind;
  name: string;
  traceId: string;
  spanId: string;
  traceparent: string;
  correlationId: string;
  attributes: Record<string, string | number | boolean>;
}

export interface ApiRequestTelemetryIdentity {
  traceId: string;
  spanId: string;
  traceparent: string;
  correlationId: string;
}

export interface TelemetryTraceContextPreview {
  propagation: "w3c-trace-context";
  responseHeaders: {
    correlationId: typeof TELEMETRY_CORRELATION_ID_HEADER;
    traceId: typeof TELEMETRY_TRACE_ID_HEADER;
    traceparent: typeof TELEMETRY_TRACEPARENT_HEADER;
  };
  traceparentSampled: true;
  incomingHeadersAccepted: false;
  incomingHeadersReturned: false;
  rawHeadersReturned: false;
  routeTemplateOnly: true;
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

export interface ApiRequestTelemetryBufferPreview {
  capacity: number;
  retainedCount: number;
  droppedCount: number;
  routeTemplateOnly: true;
  rawMaterialReturned: false;
}

export interface ApiRequestTelemetryCountPreview {
  key: string;
  count: number;
}

export interface ApiRequestTelemetrySummaryPreview {
  retainedCount: number;
  droppedCount: number;
  totalObservedCount: number;
  mutatingCount: number;
  routeGroups: ApiRequestTelemetryCountPreview[];
  statusClasses: ApiRequestTelemetryCountPreview[];
  outcomes: ApiRequestTelemetryCountPreview[];
  latencyBuckets: ApiRequestTelemetryCountPreview[];
  routeTemplateOnly: true;
  rawMaterialReturned: false;
}

export interface RuntimeTelemetryPreview {
  contractVersion: typeof TELEMETRY_PREVIEW_CONTRACT_VERSION;
  exporter: TelemetryExporterPreview;
  resource: TelemetryResourcePreview;
  traceContext: TelemetryTraceContextPreview;
  redaction: TelemetryAttributePolicy;
  exportPreview: TelemetryExportEnvelopePreview;
  continuousExport: TelemetryContinuousExportPreview;
  apiRequestBuffer: ApiRequestTelemetryBufferPreview;
  apiRequestSummary: ApiRequestTelemetrySummaryPreview;
  apiRequests: ApiRequestTelemetryPreview[];
  services: ServiceTelemetryPreview[];
}

export interface TelemetryExportPayload {
  resource: TelemetryResourcePreview;
  signals: TelemetrySignalPreview[];
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
  "service.start_trace.action",
  "service.start_trace.attempt_status",
  "service.start_trace.event_order",
  "service.start_trace.event_phase",
  "service.start_trace.event_status",
] as const;

const allowedTelemetryAttributeSet = new Set<string>(allowedTelemetryAttributes);
const REDACTED = "[REDACTED]";

export const telemetryAttributePolicy: TelemetryAttributePolicy = {
  mode: "allowlist",
  redactedValue: REDACTED,
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
  patternClasses: [
    "bearer tokens",
    "GitHub-style tokens",
    "AWS access keys",
    "private key blocks",
    "basic-auth URLs",
    "sensitive key-value pairs",
    "Service Lasso secret regression sentinels",
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

function redactTelemetryString(value: string): string {
  const patterns: RegExp[] = [
    /Bearer\s+[A-Za-z0-9._~+/-]{12,}/g,
    /gh[pousr]_[A-Za-z0-9_]{20,}/g,
    /AKIA[0-9A-Z]{16}/g,
    /https?:\/\/[^\s/:]+:[^\s/@]{6,}@/g,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    /SERVICE_LASSO_FAKE_[A-Z0-9_]*(SECRET|TOKEN|PASSWORD|CREDENTIAL)[A-Z0-9_]*_DO_NOT_USE/g,
    /\b(api[_-]?key|auth|authorization|bearer|cookie|credential|env|password|private[_-]?key|secret|token)\b\s*[:=]\s*("[^"]+"|'[^']+'|[^\s,;]+)/gi,
  ];
  let redacted = value;

  for (const pattern of patterns) {
    redacted = redacted.replace(pattern, (match, key: string | undefined) => {
      if (typeof key === "string" && key.length > 0 && /[:=]\s*/.test(match)) {
        return match.replace(/[:=]\s*("[^"]+"|'[^']+'|[^\s,;]+)/, `=${REDACTED}`);
      }
      return REDACTED;
    });
  }

  return redacted;
}

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

export function traceparentFor(traceId: string, spanId: string): string {
  return `00-${traceId}-${spanId}-01`;
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

export function createApiRequestTelemetryIdentity(seed = randomUUID()): ApiRequestTelemetryIdentity {
  const traceId = hashHex(`service-lasso:api-request-trace:${seed}`, 32);
  const spanId = hashHex(`service-lasso:api-request-span:${seed}`, 16);
  return {
    traceId,
    spanId,
    traceparent: traceparentFor(traceId, spanId),
    correlationId: `sl-${hashHex(`service-lasso:api-request-correlation:${seed}`, 16)}`,
  };
}

function allowlistedAttributes(
  attributes: Record<string, string | number | boolean | null | undefined>,
): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(attributes)) {
    if (!allowedTelemetryAttributeSet.has(key) || value === null || value === undefined) {
      continue;
    }
    result[key] = typeof value === "string" ? redactTelemetryString(value) : value;
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

function latestStartTraceAttempt(lifecycle: ServiceLifecycleState): ServiceStartTraceAttempt | null {
  return lifecycle.runtime.startTrace.current ?? lifecycle.runtime.startTrace.history[0] ?? null;
}

function durationBetween(startedAt: string, finishedAt: string | null): number | null {
  if (finishedAt === null) {
    return null;
  }

  const started = Date.parse(startedAt);
  const finished = Date.parse(finishedAt);

  if (!Number.isFinite(started) || !Number.isFinite(finished)) {
    return null;
  }

  return Math.max(0, Math.round(finished - started));
}

function startTraceEventDuration(attempt: ServiceStartTraceAttempt, event: ServiceStartTraceEvent): number | null {
  if (event.phase === "terminal_outcome") {
    return durationBetween(attempt.startedAt, attempt.finishedAt);
  }

  return durationBetween(event.startedAt, event.finishedAt);
}

function runtimeOperationCountSignals(
  serviceId: string,
  traceId: string,
  correlationId: string,
  common: Record<string, string | number | boolean | null>,
  lifecycle: ServiceLifecycleState,
): TelemetrySignalPreview[] {
  const counts = [
    ["launch", lifecycle.runtime.metrics.launchCount],
    ["stop", lifecycle.runtime.metrics.stopCount],
    ["exit", lifecycle.runtime.metrics.exitCount],
    ["crash", lifecycle.runtime.metrics.crashCount],
    ["restart", lifecycle.runtime.metrics.restartCount],
  ] as const;

  return counts.map(([operation, count]) => {
    const spanId = spanIdFor(serviceId, `runtime_operation_count:${operation}`);

    return {
      kind: "metric",
      name: "service_lasso.service.runtime.operation_count",
      traceId,
      spanId,
      traceparent: traceparentFor(traceId, spanId),
      correlationId,
      attributes: allowlistedAttributes({
        ...common,
        "service.operation.phase": `runtime_metrics.${operation}`,
        "service.operation.outcome": operation,
        "service.operation.count": count,
      }),
    };
  });
}

function healthTransitionCountSignals(
  serviceId: string,
  traceId: string,
  correlationId: string,
  common: Record<string, string | number | boolean | null>,
  healthHistory: ServiceHealthHistoryState,
): TelemetrySignalPreview[] {
  const summary = summarizeServiceHealthRegression(healthHistory);
  const healthyCount = healthHistory.transitions.filter((transition) => transition.status === "healthy").length;
  const unhealthyCount = healthHistory.transitions.filter((transition) => transition.status === "unhealthy").length;
  const counts = [
    ["total", healthHistory.transitions.length],
    ["healthy", healthyCount],
    ["unhealthy", unhealthyCount],
    ["flapping", summary.flappingCount],
  ] as const;

  return counts.map(([transition, count]) => {
    const spanId = spanIdFor(serviceId, `health_transition_count:${transition}`);

    return {
      kind: "metric",
      name: "service_lasso.service.health.transition_count",
      traceId,
      spanId,
      traceparent: traceparentFor(traceId, spanId),
      correlationId,
      attributes: allowlistedAttributes({
        ...common,
        "service.operation.phase": `health_history.${transition}`,
        "service.operation.outcome": transition,
        "service.operation.count": count,
      }),
    };
  });
}

function dependencyReadinessCountSignals(
  serviceId: string,
  traceId: string,
  correlationId: string,
  common: Record<string, string | number | boolean | null>,
  dependencyIds: string[],
  knownServiceIds: ReadonlySet<string>,
): TelemetrySignalPreview[] {
  const uniqueDependencyIds = [...new Set(dependencyIds)].sort((left, right) => left.localeCompare(right));
  const presentCount = uniqueDependencyIds.filter((dependencyId) => knownServiceIds.has(dependencyId)).length;
  const counts = [
    ["declared", uniqueDependencyIds.length],
    ["present", presentCount],
    ["missing", uniqueDependencyIds.length - presentCount],
  ] as const;

  return counts.map(([status, count]) => {
    const spanId = spanIdFor(serviceId, `dependency_readiness_count:${status}`);

    return {
      kind: "metric",
      name: "service_lasso.service.dependency.readiness_count",
      traceId,
      spanId,
      traceparent: traceparentFor(traceId, spanId),
      correlationId,
      attributes: allowlistedAttributes({
        ...common,
        "service.operation.phase": `dependency.${status}`,
        "service.operation.outcome": status,
        "service.operation.count": count,
      }),
    };
  });
}

function hasCurrentPlatformArtifact(service: DiscoveredService): boolean {
  const platforms = service.manifest.artifact?.platforms;
  if (!platforms) {
    return false;
  }

  return Boolean(platforms[process.platform] ?? platforms.default);
}

function artifactReadinessCountSignals(
  service: DiscoveredService,
  lifecycle: ServiceLifecycleState,
  traceId: string,
  correlationId: string,
  common: Record<string, string | number | boolean | null>,
): TelemetrySignalPreview[] {
  const installedArtifact = lifecycle.installArtifacts.artifact;
  const installedArtifactPresent = Boolean(
    installedArtifact?.sourceType ??
      installedArtifact?.tag ??
      installedArtifact?.assetName ??
      installedArtifact?.assetUrl ??
      installedArtifact?.checksum,
  );
  const counts = [
    ["manifest_source", service.manifest.artifact?.source.type === "github-release" ? 1 : 0],
    ["platform_asset", hasCurrentPlatformArtifact(service) ? 1 : 0],
    ["installed", installedArtifactPresent ? 1 : 0],
    ["checksum_verified", installedArtifact?.checksum ? 1 : 0],
  ] as const;

  return counts.map(([status, count]) => {
    const spanId = spanIdFor(service.manifest.id, `artifact_readiness_count:${status}`);

    return {
      kind: "metric",
      name: "service_lasso.service.artifact.readiness_count",
      traceId,
      spanId,
      traceparent: traceparentFor(traceId, spanId),
      correlationId,
      attributes: allowlistedAttributes({
        ...common,
        "service.operation.phase": `artifact.${status}`,
        "service.operation.outcome": status,
        "service.operation.count": count,
      }),
    };
  });
}

function endpointUrlKind(value: string): "local" | "external" | "unknown" {
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return "unknown";
    }
    if (["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname)) {
      return "local";
    }
    return "external";
  } catch {
    if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|::1)(?::|\b|\/)/i.test(value)) {
      return "local";
    }
    if (/^https?:\/\//i.test(value)) {
      return "external";
    }
    return "unknown";
  }
}

function networkEndpointCountSignals(
  service: DiscoveredService,
  traceId: string,
  correlationId: string,
  common: Record<string, string | number | boolean | null>,
): TelemetrySignalPreview[] {
  const endpointUrls = (service.manifest.urls ?? []).map((endpoint) => ({
    kind: endpoint.kind ?? endpoint.label,
    url: endpoint.url,
  }));
  if (service.manifest.healthcheck?.type === "http") {
    endpointUrls.push({ kind: "health", url: service.manifest.healthcheck.url });
  }

  const localCount = endpointUrls.filter((endpoint) => endpointUrlKind(endpoint.url) === "local").length;
  const externalCount = endpointUrls.filter((endpoint) => endpointUrlKind(endpoint.url) === "external").length;
  const healthCount = endpointUrls.filter((endpoint) => endpoint.kind === "health").length;
  const counts = [
    ["declared", endpointUrls.length],
    ["local", localCount],
    ["external", externalCount],
    ["health", healthCount],
  ] as const;

  return counts.map(([status, count]) => {
    const spanId = spanIdFor(service.manifest.id, `network_endpoint_count:${status}`);

    return {
      kind: "metric",
      name: "service_lasso.service.network.endpoint_count",
      traceId,
      spanId,
      traceparent: traceparentFor(traceId, spanId),
      correlationId,
      attributes: allowlistedAttributes({
        ...common,
        "service.operation.phase": `network.endpoint.${status}`,
        "service.operation.outcome": status,
        "service.operation.count": count,
      }),
    };
  });
}

const updateStatePhaseByKind: Record<ServiceUpdateStateKind, string> = {
  installed: "installed",
  available: "available",
  downloadedCandidate: "downloaded_candidate",
  installDeferred: "install_deferred",
  failed: "failed",
};

function updateStateCountSignals(
  serviceId: string,
  traceId: string,
  correlationId: string,
  common: Record<string, string | number | boolean | null>,
  updateState?: ServiceUpdateState | null,
): TelemetrySignalPreview[] {
  const activeState = updateState?.state ?? "installed";
  const states = Object.keys(updateStatePhaseByKind) as ServiceUpdateStateKind[];

  return states.map((state) => {
    const phase = updateStatePhaseByKind[state];
    const spanId = spanIdFor(serviceId, `update_state_count:${phase}`);

    return {
      kind: "metric",
      name: "service_lasso.service.update.state_count",
      traceId,
      spanId,
      traceparent: traceparentFor(traceId, spanId),
      correlationId,
      attributes: allowlistedAttributes({
        ...common,
        "service.operation.phase": `update.${phase}`,
        "service.operation.outcome": phase,
        "service.operation.count": activeState === state ? 1 : 0,
      }),
    };
  });
}

const setupStatePhases = ["declared", "succeeded", "failed", "timeout", "skipped"] as const;

function setupStepStateCountSignals(
  service: DiscoveredService,
  lifecycle: ServiceLifecycleState,
  traceId: string,
  correlationId: string,
  common: Record<string, string | number | boolean | null>,
): TelemetrySignalPreview[] {
  const declaredStepIds = Object.keys(service.manifest.setup?.steps ?? {});
  const statusCounts = {
    declared: declaredStepIds.length,
    succeeded: 0,
    failed: 0,
    timeout: 0,
    skipped: 0,
  };

  for (const stepId of declaredStepIds) {
    const status = lifecycle.setup.steps[stepId]?.status;
    if (status === "succeeded" || status === "failed" || status === "timeout" || status === "skipped") {
      statusCounts[status] += 1;
    }
  }

  return setupStatePhases.map((phase) => {
    const spanId = spanIdFor(service.manifest.id, `setup_step_state_count:${phase}`);

    return {
      kind: "metric",
      name: "service_lasso.service.setup.step_state_count",
      traceId,
      spanId,
      traceparent: traceparentFor(traceId, spanId),
      correlationId,
      attributes: allowlistedAttributes({
        ...common,
        "service.operation.phase": `setup.${phase}`,
        "service.operation.outcome": phase,
        "service.operation.count": statusCounts[phase],
      }),
    };
  });
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
  identity?: ApiRequestTelemetryIdentity;
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
    if (parts[2] === "export") {
      return { routeGroup: "telemetry", routeTemplate: "/api/telemetry/export", mutating: true };
    }
    if (parts[2] === "export-test") {
      return { routeGroup: "telemetry", routeTemplate: "/api/telemetry/export-test", mutating: true };
    }
    return { routeGroup: "telemetry", routeTemplate: "/api/telemetry", mutating: false };
  }

  if (parts[1] === "log-shipping") {
    if (parts[2] === "export-test") {
      return { routeGroup: "log-shipping", routeTemplate: "/api/log-shipping/export-test", mutating: true };
    }
    return { routeGroup: "log-shipping", routeTemplate: "/api/log-shipping", mutating: false };
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
  const traceId = input.identity?.traceId ?? requestTraceIdFor(input.routeTemplate, method);
  const spanId = input.identity?.spanId ?? requestSpanIdFor(input.routeTemplate, method, input.statusCode);

  return {
    routeGroup: input.routeGroup,
    routeTemplate: input.routeTemplate,
    signal: {
      kind: "span",
      name: "service_lasso.api.request",
      traceId,
      spanId,
      traceparent: input.identity?.traceparent ?? traceparentFor(traceId, spanId),
      correlationId: input.identity?.correlationId ?? requestCorrelationIdFor(input.routeTemplate, method),
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
  healthHistory: ServiceHealthHistoryState,
  knownServiceIds: ReadonlySet<string> = new Set([service.manifest.id]),
  updateState?: ServiceUpdateState | null,
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
  const lifecycleSpanId = spanIdFor(serviceId, "lifecycle");
  const healthCheckSpanId = spanIdFor(serviceId, "health_check");
  const runtimeLaunchesSpanId = spanIdFor(serviceId, "runtime_launches");
  const runtimeOperationSignals = runtimeOperationCountSignals(serviceId, traceId, correlationId, common, lifecycle);
  const healthTransitionSignals = healthTransitionCountSignals(serviceId, traceId, correlationId, common, healthHistory);
  const dependencyReadinessSignals = dependencyReadinessCountSignals(
    serviceId,
    traceId,
    correlationId,
    common,
    service.manifest.depend_on ?? [],
    knownServiceIds,
  );
  const artifactReadinessSignals = artifactReadinessCountSignals(service, lifecycle, traceId, correlationId, common);
  const networkEndpointSignals = networkEndpointCountSignals(service, traceId, correlationId, common);
  const updateStateSignals = updateStateCountSignals(serviceId, traceId, correlationId, common, updateState);
  const setupStateSignals = setupStepStateCountSignals(service, lifecycle, traceId, correlationId, common);
  const startTrace = latestStartTraceAttempt(lifecycle);
  const startTraceSignals: TelemetrySignalPreview[] =
    startTrace?.events.map((event) => {
      const spanId = spanIdFor(serviceId, `start_trace:${startTrace.attemptId}:${event.order}:${event.phase}`);

      return {
        kind: "span",
        name: "service_lasso.service.start_trace_event",
        traceId,
        spanId,
        traceparent: traceparentFor(traceId, spanId),
        correlationId,
        attributes: allowlistedAttributes({
          ...common,
          "service.operation.phase": `start_trace.${event.phase}`,
          "service.operation.outcome": event.status,
          "service.operation.duration_ms": startTraceEventDuration(startTrace, event),
          "service.operation.count": 1,
          "service.start_trace.action": startTrace.action,
          "service.start_trace.attempt_status": startTrace.status,
          "service.start_trace.event_order": event.order,
          "service.start_trace.event_phase": event.phase,
          "service.start_trace.event_status": event.status,
        }),
      };
    }) ?? [];

  return {
    serviceId,
    signals: [
      {
        kind: "span",
        name: "service_lasso.service.lifecycle",
        traceId,
        spanId: lifecycleSpanId,
        traceparent: traceparentFor(traceId, lifecycleSpanId),
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
        spanId: healthCheckSpanId,
        traceparent: traceparentFor(traceId, healthCheckSpanId),
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
        spanId: runtimeLaunchesSpanId,
        traceparent: traceparentFor(traceId, runtimeLaunchesSpanId),
        correlationId,
        attributes: allowlistedAttributes({
          ...common,
          "service.operation.phase": "runtime_metrics",
          "service.operation.outcome": lifecycleOutcome(lifecycle, health),
          "service.operation.duration_ms": lifecycle.runtime.metrics.totalRunDurationMs,
        }),
      },
      ...startTraceSignals,
      ...runtimeOperationSignals,
      ...healthTransitionSignals,
      ...dependencyReadinessSignals,
      ...artifactReadinessSignals,
      ...networkEndpointSignals,
      ...updateStateSignals,
      ...setupStateSignals,
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
  if (exporter.status === "configured" && requestedMode === "export") {
    return "export_configured";
  }

  return "disabled";
}

function readExportTestModeFromEnv(
  env: NodeJS.ProcessEnv,
  exporter: TelemetryExporterPreview,
): TelemetryExportTestMode {
  const requestedMode = String(env.SERVICE_LASSO_OTEL_EXPORT_MODE ?? "").trim().toLowerCase();

  if (exporter.status === "configured" && requestedMode === "mock-collector") {
    return "mock_collector";
  }

  return "disabled";
}

export function isTelemetryContinuousExportEnabled(
  env: NodeJS.ProcessEnv,
  exporter: TelemetryExporterPreview = readExporterPreviewFromEnv(env),
): boolean {
  const continuousExportEnabled =
    env.SERVICE_LASSO_OTEL_CONTINUOUS_EXPORT === "1" ||
    String(env.SERVICE_LASSO_OTEL_CONTINUOUS_EXPORT ?? "").toLowerCase() === "true";
  const requestedMode = String(env.SERVICE_LASSO_OTEL_EXPORT_MODE ?? "").trim().toLowerCase();

  return continuousExportEnabled && exporter.status === "configured" && requestedMode === "export";
}

export function readTelemetryContinuousExportIntervalMs(env: NodeJS.ProcessEnv): number {
  const parsed = Number(env.SERVICE_LASSO_OTEL_EXPORT_INTERVAL_MS);
  if (!Number.isFinite(parsed)) {
    return 60000;
  }

  return Math.max(5000, Math.trunc(parsed));
}

function isLoopbackEndpoint(endpoint: string): boolean {
  try {
    const parsed = new URL(endpoint);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname)
    );
  } catch {
    return false;
  }
}

function isHttpEndpoint(endpoint: string): boolean {
  try {
    const parsed = new URL(endpoint);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function parseOtlpHeadersFromEnv(env: NodeJS.ProcessEnv): Record<string, string> | null {
  const rawHeaders = String(env.OTEL_EXPORTER_OTLP_HEADERS ?? "").trim();
  if (rawHeaders.length === 0) {
    return {};
  }

  const headers: Record<string, string> = {};
  for (const entry of rawHeaders.split(",")) {
    const separator = entry.indexOf("=");
    if (separator <= 0) {
      return null;
    }
    const name = entry.slice(0, separator).trim().toLowerCase();
    const value = entry.slice(separator + 1).trim();
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name) || name === "content-type") {
      return null;
    }
    headers[name] = value;
  }

  return headers;
}

function telemetryHeadersConfigured(env: NodeJS.ProcessEnv): boolean {
  return String(env.OTEL_EXPORTER_OTLP_HEADERS ?? "").trim().length > 0;
}

export function buildTelemetryExportPayload(telemetry: RuntimeTelemetryPreview): TelemetryExportPayload {
  return {
    resource: telemetry.resource,
    signals: [
      ...telemetry.services.flatMap((service) => service.signals),
      ...telemetry.apiRequests.map((request) => request.signal),
    ],
  };
}

function buildTelemetryContinuousExportPreview(
  env: NodeJS.ProcessEnv,
  exporter: TelemetryExporterPreview,
  runtimeState?: TelemetryContinuousExportRuntimeState | null,
): TelemetryContinuousExportPreview {
  const enabled = isTelemetryContinuousExportEnabled(env, exporter);
  const status: TelemetryContinuousExportStatus = runtimeState?.running ? "running" : enabled ? "configured" : "disabled";
  const intervalMs = enabled ? runtimeState?.intervalMs ?? readTelemetryContinuousExportIntervalMs(env) : null;

  return {
    status,
    intervalMs,
    inFlight: runtimeState?.inFlight ?? false,
    lastAttemptAt: runtimeState?.lastAttemptAt ?? null,
    lastStatus: runtimeState?.lastResult?.status ?? null,
    exporterStatusCode: runtimeState?.lastResult?.exporterStatusCode ?? null,
    endpointConfigured: exporter.endpointConfigured,
    endpointValueReturned: false,
    headersConfigured: telemetryHeadersConfigured(env),
    headersValueReturned: false,
    bodyValueReturned: false,
    reason:
      status === "running"
        ? "Continuous OTLP export is running with sanitized envelopes only; endpoint, headers, and payload bodies are not returned."
        : status === "configured"
          ? "Continuous OTLP export is configured but not running in this server context."
          : "Continuous OTLP export is disabled until SERVICE_LASSO_OTEL_CONTINUOUS_EXPORT, SERVICE_LASSO_OTEL_ENABLED, OTEL_EXPORTER_OTLP_ENDPOINT, and SERVICE_LASSO_OTEL_EXPORT_MODE=export are configured.",
  };
}

export async function sendRuntimeTelemetryExport(
  telemetry: RuntimeTelemetryPreview,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<TelemetryExportActionResult> {
  const requestedMode = String(env.SERVICE_LASSO_OTEL_EXPORT_MODE ?? "").trim().toLowerCase();
  const mode: TelemetryExportActionMode =
    telemetry.exporter.status === "configured" && requestedMode === "export" ? "export" : "disabled";
  const endpoint = String(env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "").trim();
  const configuredHeaders = parseOtlpHeadersFromEnv(env);
  const baseResult = {
    mode,
    protocol: "otlp-http" as const,
    contentType: "application/json" as const,
    signalCount: telemetry.exportPreview.signalCount,
    serviceCount: telemetry.exportPreview.serviceCount,
    endpointConfigured: telemetry.exporter.endpointConfigured,
    endpointValueReturned: false as const,
    headersConfigured: configuredHeaders !== null && Object.keys(configuredHeaders).length > 0,
    headersValueReturned: false as const,
    bodyValueReturned: false as const,
  };

  if (mode !== "export") {
    return {
      ...baseResult,
      status: "not_sent",
      exporterStatusCode: null,
      reason:
        "Telemetry export is disabled; set SERVICE_LASSO_OTEL_ENABLED, OTEL_EXPORTER_OTLP_ENDPOINT, and SERVICE_LASSO_OTEL_EXPORT_MODE=export to send the sanitized envelope.",
    };
  }

  if (configuredHeaders === null) {
    return {
      ...baseResult,
      status: "blocked",
      exporterStatusCode: null,
      reason: "OTLP export headers are configured with an unsupported header shape.",
    };
  }

  if (!isHttpEndpoint(endpoint)) {
    return {
      ...baseResult,
      status: "blocked",
      exporterStatusCode: null,
      reason: "OTLP export requires an HTTP(S) endpoint.",
    };
  }

  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        ...configuredHeaders,
        "content-type": "application/json",
      },
      body: JSON.stringify(buildTelemetryExportPayload(telemetry)),
    });

    return {
      ...baseResult,
      status: response.ok ? "sent" : "failed",
      exporterStatusCode: response.status,
      reason: response.ok
        ? "Sanitized telemetry was sent to the configured OTLP HTTP endpoint."
        : "The configured OTLP HTTP endpoint returned a non-success response.",
    };
  } catch (error) {
    return {
      ...baseResult,
      status: "failed",
      exporterStatusCode: null,
      reason: `OTLP export failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function sendRuntimeTelemetryMockExport(
  telemetry: RuntimeTelemetryPreview,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<TelemetryExportTestResult> {
  const mode = readExportTestModeFromEnv(env, telemetry.exporter);
  const endpoint = String(env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "").trim();
  const baseResult = {
    mode,
    protocol: "otlp-http" as const,
    contentType: "application/json" as const,
    signalCount: telemetry.exportPreview.signalCount,
    serviceCount: telemetry.exportPreview.serviceCount,
    endpointConfigured: telemetry.exporter.endpointConfigured,
    endpointValueReturned: false as const,
    headersValueReturned: false as const,
    bodyValueReturned: false as const,
    localCollectorOnly: true as const,
  };

  if (mode !== "mock_collector") {
    return {
      ...baseResult,
      status: "not_sent",
      collectorStatusCode: null,
      reason:
        "Mock collector export is disabled; set SERVICE_LASSO_OTEL_ENABLED, OTEL_EXPORTER_OTLP_ENDPOINT, and SERVICE_LASSO_OTEL_EXPORT_MODE=mock-collector to run a local export smoke test.",
    };
  }

  if (!isLoopbackEndpoint(endpoint)) {
    return {
      ...baseResult,
      status: "blocked",
      collectorStatusCode: null,
      reason: "Mock collector export only sends to loopback HTTP(S) endpoints.",
    };
  }

  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(buildTelemetryExportPayload(telemetry)),
    });

    return {
      ...baseResult,
      status: response.ok ? "sent" : "failed",
      collectorStatusCode: response.status,
      reason: response.ok
        ? "Sanitized telemetry was sent to the configured local mock collector."
        : "The configured local mock collector returned a non-success response.",
    };
  } catch (error) {
    return {
      ...baseResult,
      status: "failed",
      collectorStatusCode: null,
      reason: `Mock collector export failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
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
      "signals.traceparent",
      "signals.correlationId",
      "signals.attributes",
      "apiRequests.routeGroup",
      "apiRequests.routeTemplate",
    ],
    reason:
      mode === "dry_run"
        ? "Dry-run OTLP export envelope is ready for local verification; the runtime does not send telemetry from this preview API."
        : mode === "export_configured"
          ? "Explicit OTLP export is configured; this preview API still does not send telemetry."
        : "OTLP export remains disabled; set SERVICE_LASSO_OTEL_ENABLED, OTEL_EXPORTER_OTLP_ENDPOINT, and SERVICE_LASSO_OTEL_EXPORT_MODE=dry-run to preview an export envelope.",
  };
}

function incrementCount(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function toSortedCounts(counts: Map<string, number>): ApiRequestTelemetryCountPreview[] {
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

function apiRequestLatencyBucket(durationMs: number): string {
  if (durationMs < 50) {
    return "lt_50ms";
  }
  if (durationMs < 250) {
    return "50_249ms";
  }
  if (durationMs < 1000) {
    return "250_999ms";
  }
  return "1s_plus";
}

function buildApiRequestTelemetrySummaryPreview(
  apiRequests: ApiRequestTelemetryPreview[],
  droppedCount: number,
): ApiRequestTelemetrySummaryPreview {
  const routeGroups = new Map<string, number>();
  const statusClasses = new Map<string, number>();
  const outcomes = new Map<string, number>();
  const latencyBuckets = new Map<string, number>();
  let mutatingCount = 0;

  for (const request of apiRequests) {
    const attributes = request.signal.attributes;
    incrementCount(routeGroups, request.routeGroup);
    incrementCount(statusClasses, String(attributes["http.response.status_class"] ?? "unknown"));
    incrementCount(outcomes, String(attributes["service.operation.outcome"] ?? "unknown"));
    const durationMs =
      typeof attributes["service.operation.duration_ms"] === "number"
        ? attributes["service.operation.duration_ms"]
        : 0;
    incrementCount(latencyBuckets, apiRequestLatencyBucket(durationMs));
    if (attributes["api.mutating"] === true) {
      mutatingCount += 1;
    }
  }

  return {
    retainedCount: apiRequests.length,
    droppedCount,
    totalObservedCount: apiRequests.length + droppedCount,
    mutatingCount,
    routeGroups: toSortedCounts(routeGroups),
    statusClasses: toSortedCounts(statusClasses),
    outcomes: toSortedCounts(outcomes),
    latencyBuckets: toSortedCounts(latencyBuckets),
    routeTemplateOnly: true,
    rawMaterialReturned: false,
  };
}

export function buildRuntimeTelemetryPreview(
  services: ServiceTelemetryPreview[],
  apiRequests: ApiRequestTelemetryPreview[] = [],
  apiRequestBuffer?: Partial<Pick<ApiRequestTelemetryBufferPreview, "capacity" | "droppedCount">>,
  env: NodeJS.ProcessEnv = process.env,
  continuousExportState?: TelemetryContinuousExportRuntimeState | null,
): RuntimeTelemetryPreview {
  const exporter = readExporterPreviewFromEnv(env);
  const droppedCount = apiRequestBuffer?.droppedCount ?? 0;
  const resource: TelemetryResourcePreview = {
    serviceName: "service-lasso-core",
    serviceNamespace: "service-lasso",
    serviceInstanceId: "local-runtime",
  };

  return {
    contractVersion: TELEMETRY_PREVIEW_CONTRACT_VERSION,
    exporter,
    resource,
    traceContext: {
      propagation: "w3c-trace-context",
      responseHeaders: {
        correlationId: TELEMETRY_CORRELATION_ID_HEADER,
        traceId: TELEMETRY_TRACE_ID_HEADER,
        traceparent: TELEMETRY_TRACEPARENT_HEADER,
      },
      traceparentSampled: true,
      incomingHeadersAccepted: false,
      incomingHeadersReturned: false,
      rawHeadersReturned: false,
      routeTemplateOnly: true,
    },
    redaction: telemetryAttributePolicy,
    exportPreview: buildTelemetryExportEnvelopePreview(
      services,
      apiRequests,
      exporter,
      telemetryAttributePolicy,
      env,
    ),
    continuousExport: buildTelemetryContinuousExportPreview(env, exporter, continuousExportState),
    apiRequestBuffer: {
      capacity: apiRequestBuffer?.capacity ?? apiRequests.length,
      retainedCount: apiRequests.length,
      droppedCount,
      routeTemplateOnly: true,
      rawMaterialReturned: false,
    },
    apiRequestSummary: buildApiRequestTelemetrySummaryPreview(apiRequests, droppedCount),
    apiRequests,
    services,
  };
}
