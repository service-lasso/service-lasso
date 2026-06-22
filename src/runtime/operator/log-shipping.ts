import { readFile, stat } from "node:fs/promises";
import type { DiscoveredService } from "../../contracts/service.js";
import type { ServiceLifecycleState } from "../lifecycle/types.js";
import { getServiceRuntimeLogPaths } from "./logs.js";

export const LOG_SHIPPING_CONTRACT_VERSION = "service-lasso.log-shipping.v1";

export type LogShippingSinkType = "openobserve" | "otlp-http" | "generic-http" | "filebeat";
export type LogShippingSinkStatus = "disabled" | "configured";
export type LogShippingPreviewMode = "disabled" | "dry_run";
export type LogShippingSourceKind =
  | "core_runtime"
  | "service_runtime"
  | "service_admin_api"
  | "secrets_broker_audit"
  | "health_release_deploy";

export interface LogShippingRedactionPolicy {
  mode: "pattern-redacted-preview";
  redactedValue: "[REDACTED]";
  forbiddenFieldClasses: string[];
  patternClasses: string[];
}

export interface LogShippingSinkPreview {
  status: LogShippingSinkStatus;
  type: LogShippingSinkType;
  endpointConfigured: boolean;
  endpointValueReturned: false;
  headersValueReturned: false;
  spoolConfigured: boolean;
  spoolPathValueReturned: false;
  retryPolicy: {
    enabled: boolean;
    maxAttempts: number;
    backoff: "exponential";
  };
  reason: string;
}

export interface LogShippingSourcePreview {
  kind: LogShippingSourceKind;
  id: string;
  label: string;
  enabled: boolean;
  available: boolean;
  serviceId: string | null;
  currentLogConfigured: boolean;
  currentLogAvailable: boolean;
  queuedRecordEstimate: number;
  lastObservedAt: string | null;
  status: "ready" | "disabled" | "unavailable";
  reason: string;
}

export interface LogShippingSampleRecord {
  sourceId: string;
  stream: "stdout" | "stderr" | "unknown";
  text: string;
  redacted: boolean;
}

export interface LogShippingRedactionSelfTestCase {
  id: string;
  patternClass: string;
  redactedText: string;
  redacted: boolean;
  inputValueReturned: false;
}

export interface LogShippingRedactionSelfTest {
  status: "passed" | "failed";
  testCaseCount: number;
  passedTestCaseCount: number;
  sentinelValueReturned: false;
  endpointValueReturned: false;
  headersValueReturned: false;
  spoolPathValueReturned: false;
  bodyValueReturned: false;
  cases: LogShippingRedactionSelfTestCase[];
  reason: string;
}

export interface LogShippingExportPreview {
  mode: LogShippingPreviewMode;
  status: "not_sent";
  sinkType: LogShippingSinkType;
  sourceCount: number;
  enabledSourceCount: number;
  recordCountEstimate: number;
  sampleRecordCount: number;
  endpointConfigured: boolean;
  endpointValueReturned: false;
  headersValueReturned: false;
  bodyValueReturned: false;
  safeEnvelopeFields: string[];
  reason: string;
}

export interface RuntimeLogShippingPreview {
  contractVersion: typeof LOG_SHIPPING_CONTRACT_VERSION;
  sink: LogShippingSinkPreview;
  redaction: LogShippingRedactionPolicy;
  sources: LogShippingSourcePreview[];
  sampleRecords: LogShippingSampleRecord[];
  redactionSelfTest: LogShippingRedactionSelfTest;
  exportPreview: LogShippingExportPreview;
}

const REDACTED = "[REDACTED]";
const DEFAULT_SOURCES: LogShippingSourceKind[] = [
  "core_runtime",
  "service_runtime",
  "service_admin_api",
  "secrets_broker_audit",
  "health_release_deploy",
];
const MAX_SAMPLE_RECORDS_PER_SERVICE = 3;
const MAX_SAMPLE_TEXT_LENGTH = 500;
const SELF_TEST_SENTINEL = "SERVICE_LASSO_FAKE_LOG_SECRET_SENTINEL_DO_NOT_USE";

const sourceAliases: Record<string, LogShippingSourceKind> = {
  core: "core_runtime",
  runtime: "service_runtime",
  services: "service_runtime",
  service: "service_runtime",
  serviceadmin: "service_admin_api",
  admin: "service_admin_api",
  secretsbroker: "secrets_broker_audit",
  broker: "secrets_broker_audit",
  health: "health_release_deploy",
  release: "health_release_deploy",
  deploy: "health_release_deploy",
};

export const logShippingRedactionPolicy: LogShippingRedactionPolicy = {
  mode: "pattern-redacted-preview",
  redactedValue: REDACTED,
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
  patternClasses: [
    "bearer tokens",
    "GitHub-style tokens",
    "AWS access keys",
    "private key blocks",
    "basic-auth URLs",
    "sensitive key-value pairs",
    "Service Lasso secret regression sentinels",
  ],
};

function normalizeSinkType(value: string | undefined): LogShippingSinkType {
  const normalized = String(value ?? "openobserve").trim().toLowerCase();

  if (normalized === "otlp" || normalized === "otlp-http") {
    return "otlp-http";
  }
  if (normalized === "http" || normalized === "generic-http") {
    return "generic-http";
  }
  if (normalized === "filebeat") {
    return "filebeat";
  }
  return "openobserve";
}

function parseEnabled(value: string | undefined): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function parseSourceSet(env: NodeJS.ProcessEnv): Set<LogShippingSourceKind> {
  const configured = String(env.SERVICE_LASSO_LOG_SHIPPING_SOURCES ?? "").trim();
  if (configured.length === 0 || configured.toLowerCase() === "all") {
    return new Set(DEFAULT_SOURCES);
  }

  const selected = new Set<LogShippingSourceKind>();
  for (const entry of configured.split(",")) {
    const normalized = entry.trim().toLowerCase().replace(/[-\s]/g, "_");
    if (DEFAULT_SOURCES.includes(normalized as LogShippingSourceKind)) {
      selected.add(normalized as LogShippingSourceKind);
      continue;
    }
    const alias = sourceAliases[normalized];
    if (alias) {
      selected.add(alias);
    }
  }

  return selected.size > 0 ? selected : new Set(DEFAULT_SOURCES);
}

function readSinkPreviewFromEnv(env: NodeJS.ProcessEnv): LogShippingSinkPreview {
  const enabled = parseEnabled(env.SERVICE_LASSO_LOG_SHIPPING_ENABLED);
  const endpointConfigured =
    typeof env.SERVICE_LASSO_LOG_SHIPPING_ENDPOINT === "string" &&
    env.SERVICE_LASSO_LOG_SHIPPING_ENDPOINT.trim().length > 0;
  const spoolConfigured =
    typeof env.SERVICE_LASSO_LOG_SHIPPING_SPOOL_DIR === "string" &&
    env.SERVICE_LASSO_LOG_SHIPPING_SPOOL_DIR.trim().length > 0;

  return {
    status: enabled && endpointConfigured ? "configured" : "disabled",
    type: normalizeSinkType(env.SERVICE_LASSO_LOG_SHIPPING_SINK),
    endpointConfigured,
    endpointValueReturned: false,
    headersValueReturned: false,
    spoolConfigured,
    spoolPathValueReturned: false,
    retryPolicy: {
      enabled: true,
      maxAttempts: 3,
      backoff: "exponential",
    },
    reason:
      enabled && endpointConfigured
        ? "Log shipping is configured for dry-run preview; endpoint, headers, spool path, and payload bodies are intentionally not returned."
        : "Log shipping is disabled until SERVICE_LASSO_LOG_SHIPPING_ENABLED and SERVICE_LASSO_LOG_SHIPPING_ENDPOINT are configured.",
  };
}

function readPreviewMode(env: NodeJS.ProcessEnv, sink: LogShippingSinkPreview): LogShippingPreviewMode {
  const requestedMode = String(env.SERVICE_LASSO_LOG_SHIPPING_MODE ?? "").trim().toLowerCase();
  return sink.status === "configured" && requestedMode === "dry-run" ? "dry_run" : "disabled";
}

function truncateText(value: string): string {
  return value.length <= MAX_SAMPLE_TEXT_LENGTH ? value : value.slice(0, MAX_SAMPLE_TEXT_LENGTH);
}

export function redactLogShippingText(value: string): { text: string; redacted: boolean } {
  const patterns: RegExp[] = [
    /Bearer\s+[A-Za-z0-9._~+/-]{12,}/g,
    /gh[pousr]_[A-Za-z0-9_]{20,}/g,
    /AKIA[0-9A-Z]{16}/g,
    /https?:\/\/[^\s/:]+:[^\s/@]{6,}@/g,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    /SERVICE_LASSO_FAKE_[A-Z0-9_]*(SECRET|TOKEN|PASSWORD|CREDENTIAL)[A-Z0-9_]*_DO_NOT_USE/g,
    /\b(api[_-]?key|auth|authorization|bearer|cookie|credential|env|password|private[_-]?key|secret|token)\b\s*[:=]\s*("[^"]+"|'[^']+'|[^\s,;]+)/gi,
  ];
  let text = truncateText(value);

  for (const pattern of patterns) {
    text = text.replace(pattern, (match, key: string | undefined) => {
      if (typeof key === "string" && key.length > 0) {
        return match.replace(/[:=]\s*("[^"]+"|'[^']+'|[^\s,;]+)/, `=${REDACTED}`);
      }
      return REDACTED;
    });
  }

  return {
    text,
    redacted: text !== truncateText(value),
  };
}

async function fileMetadata(logPath: string): Promise<{ available: boolean; lines: string[]; updatedAt: string | null }> {
  try {
    const [stats, content] = await Promise.all([stat(logPath), readFile(logPath, "utf8")]);
    return {
      available: stats.isFile(),
      lines: content.split(/\r?\n/).filter((line) => line.trim().length > 0),
      updatedAt: stats.mtime.toISOString(),
    };
  } catch {
    return {
      available: false,
      lines: [],
      updatedAt: null,
    };
  }
}

function parseStream(line: string): "stdout" | "stderr" | "unknown" {
  try {
    const entry = JSON.parse(line) as { level?: unknown };
    if (entry.level === "stdout" || entry.level === "stderr") {
      return entry.level;
    }
  } catch {
    // Plain log lines stay ship-previewable as unknown stream records.
  }
  return "unknown";
}

async function buildServiceRuntimeSource(
  service: DiscoveredService,
  lifecycle: ServiceLifecycleState,
  enabled: boolean,
): Promise<{ source: LogShippingSourcePreview; samples: LogShippingSampleRecord[] }> {
  const paths = getServiceRuntimeLogPaths(service.serviceRoot);
  const metadata = await fileMetadata(paths.logPath);
  const sourceId = `service:${service.manifest.id}:runtime`;
  const status = enabled ? (metadata.available ? "ready" : "unavailable") : "disabled";
  const samples = enabled
    ? metadata.lines.slice(-MAX_SAMPLE_RECORDS_PER_SERVICE).map((line) => {
        const redacted = redactLogShippingText(line);
        return {
          sourceId,
          stream: parseStream(line),
          text: redacted.text,
          redacted: redacted.redacted,
        };
      })
    : [];

  return {
    source: {
      kind: "service_runtime",
      id: sourceId,
      label: `${service.manifest.id} runtime logs`,
      enabled,
      available: metadata.available || lifecycle.actionHistory.length > 0,
      serviceId: service.manifest.id,
      currentLogConfigured: true,
      currentLogAvailable: metadata.available,
      queuedRecordEstimate: metadata.lines.length,
      lastObservedAt: metadata.updatedAt,
      status,
      reason:
        status === "ready"
          ? "Runtime log records are available for redacted shipping preview."
          : status === "disabled"
            ? "The service runtime source is disabled by source selection."
            : "No current runtime log file is available yet for this service.",
    },
    samples,
  };
}

function buildStaticSource(
  kind: Exclude<LogShippingSourceKind, "service_runtime">,
  enabledSources: Set<LogShippingSourceKind>,
): LogShippingSourcePreview {
  const labels: Record<typeof kind, string> = {
    core_runtime: "Service Lasso runtime/core logs",
    service_admin_api: "Service Admin operator/API logs",
    secrets_broker_audit: "Secrets Broker audit-safe operational logs",
    health_release_deploy: "Health, release, deploy, and watchdog logs",
  };
  const enabled = enabledSources.has(kind);

  return {
    kind,
    id: kind,
    label: labels[kind],
    enabled,
    available: kind === "core_runtime" || kind === "health_release_deploy",
    serviceId: null,
    currentLogConfigured: false,
    currentLogAvailable: false,
    queuedRecordEstimate: 0,
    lastObservedAt: null,
    status: enabled ? "ready" : "disabled",
    reason: enabled
      ? "Source is part of the configured shipping coverage; concrete file adapters are wired by the owning runtime/service integration."
      : "Source is disabled by source selection.",
  };
}

function buildExportPreview(
  sink: LogShippingSinkPreview,
  sources: LogShippingSourcePreview[],
  samples: LogShippingSampleRecord[],
  env: NodeJS.ProcessEnv,
): LogShippingExportPreview {
  const mode = readPreviewMode(env, sink);
  const enabledSourceCount = sources.filter((source) => source.enabled).length;
  const recordCountEstimate = sources.reduce((count, source) => count + source.queuedRecordEstimate, 0);

  return {
    mode,
    status: "not_sent",
    sinkType: sink.type,
    sourceCount: sources.length,
    enabledSourceCount,
    recordCountEstimate,
    sampleRecordCount: samples.length,
    endpointConfigured: sink.endpointConfigured,
    endpointValueReturned: false,
    headersValueReturned: false,
    bodyValueReturned: false,
    safeEnvelopeFields: [
      "source.kind",
      "source.id",
      "source.serviceId",
      "source.status",
      "record.stream",
      "record.redactedText",
      "record.redacted",
      "shipping.sinkType",
      "shipping.mode",
    ],
    reason:
      mode === "dry_run"
        ? "Dry-run shipping preview is ready; this API does not transmit records."
        : "Log shipping remains disabled; set SERVICE_LASSO_LOG_SHIPPING_ENABLED, SERVICE_LASSO_LOG_SHIPPING_ENDPOINT, and SERVICE_LASSO_LOG_SHIPPING_MODE=dry-run to preview a redacted shipping envelope.",
  };
}

function buildRedactionSelfTest(): LogShippingRedactionSelfTest {
  const testInputs = [
    {
      id: "sensitive-key-value",
      patternClass: "sensitive key-value pairs",
      input: `password=${SELF_TEST_SENTINEL}`,
    },
    {
      id: "authorization-bearer",
      patternClass: "bearer tokens",
      input: `authorization=Bearer ${SELF_TEST_SENTINEL}`,
    },
    {
      id: "basic-auth-url",
      patternClass: "basic-auth URLs",
      input: `https://operator:${SELF_TEST_SENTINEL}@logs.example.invalid/ingest`,
    },
    {
      id: "private-key-block",
      patternClass: "private key blocks",
      input: [
        "-----BEGIN PRIVATE KEY-----",
        SELF_TEST_SENTINEL,
        "-----END PRIVATE KEY-----",
      ].join("\n"),
    },
  ];

  const cases = testInputs.map((entry) => {
    const redacted = redactLogShippingText(entry.input);
    return {
      id: entry.id,
      patternClass: entry.patternClass,
      redactedText: redacted.text,
      redacted: redacted.redacted && !redacted.text.includes(SELF_TEST_SENTINEL),
      inputValueReturned: false as const,
    };
  });
  const passedTestCaseCount = cases.filter((entry) => entry.redacted).length;
  const status = passedTestCaseCount === cases.length ? "passed" : "failed";

  return {
    status,
    testCaseCount: cases.length,
    passedTestCaseCount,
    sentinelValueReturned: false,
    endpointValueReturned: false,
    headersValueReturned: false,
    spoolPathValueReturned: false,
    bodyValueReturned: false,
    cases,
    reason:
      status === "passed"
        ? "Representative log-shipping redaction self-test cases passed without returning raw sentinel or sink values."
        : "One or more representative redaction self-test cases failed and must be treated as a shipping blocker.",
  };
}

export async function buildRuntimeLogShippingPreview(
  services: Array<{ service: DiscoveredService; lifecycle: ServiceLifecycleState }>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RuntimeLogShippingPreview> {
  const sink = readSinkPreviewFromEnv(env);
  const enabledSources = parseSourceSet(env);
  const serviceSources = await Promise.all(
    services.map(({ service, lifecycle }) =>
      buildServiceRuntimeSource(service, lifecycle, enabledSources.has("service_runtime")),
    ),
  );
  const sources = [
    buildStaticSource("core_runtime", enabledSources),
    ...serviceSources.map((entry) => entry.source),
    buildStaticSource("service_admin_api", enabledSources),
    buildStaticSource("secrets_broker_audit", enabledSources),
    buildStaticSource("health_release_deploy", enabledSources),
  ];
  const sampleRecords = serviceSources.flatMap((entry) => entry.samples);

  return {
    contractVersion: LOG_SHIPPING_CONTRACT_VERSION,
    sink,
    redaction: logShippingRedactionPolicy,
    sources,
    sampleRecords,
    redactionSelfTest: buildRedactionSelfTest(),
    exportPreview: buildExportPreview(sink, sources, sampleRecords, env),
  };
}
