import { createHash } from "node:crypto";
import type { DiscoveredService } from "../../contracts/service.js";
import type { ServiceHealthResult } from "../health/types.js";
import type { ServiceLifecycleState } from "../lifecycle/types.js";

export const TELEMETRY_PREVIEW_CONTRACT_VERSION = "service-lasso.telemetry-preview.v1";

export type TelemetryExporterStatus = "disabled" | "configured";
export type TelemetrySignalKind = "span" | "metric";

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

export interface RuntimeTelemetryPreview {
  contractVersion: typeof TELEMETRY_PREVIEW_CONTRACT_VERSION;
  exporter: TelemetryExporterPreview;
  resource: TelemetryResourcePreview;
  redaction: TelemetryAttributePolicy;
  services: ServiceTelemetryPreview[];
}

const allowedTelemetryAttributes = [
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
    "full file contents",
    "raw service config values",
  ],
  omittedFieldExamples: [
    "env",
    "globalenv",
    "config.files[].content",
    "install.files[].content",
    "headers",
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

export function buildRuntimeTelemetryPreview(
  services: ServiceTelemetryPreview[],
  env: NodeJS.ProcessEnv = process.env,
): RuntimeTelemetryPreview {
  return {
    contractVersion: TELEMETRY_PREVIEW_CONTRACT_VERSION,
    exporter: readExporterPreviewFromEnv(env),
    resource: {
      serviceName: "service-lasso-core",
      serviceNamespace: "service-lasso",
      serviceInstanceId: "local-runtime",
    },
    redaction: telemetryAttributePolicy,
    services,
  };
}
