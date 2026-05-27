import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { DiscoveredService } from "../../contracts/service.js";
import { discoverServices } from "../discovery/discoverServices.js";
import { getLifecycleState } from "../lifecycle/store.js";
import type { ServiceLifecycleState } from "../lifecycle/types.js";
import { DependencyGraph, createServiceRegistry } from "../manager/DependencyGraph.js";
import { getServiceStatePaths } from "../state/paths.js";
import { rehydrateDiscoveredServices } from "../state/rehydrate.js";
import { readServiceRecoveryHistory } from "../recovery/history.js";
import { readServiceUpdateState } from "../updates/state.js";
import { getServiceRuntimeLogPaths } from "../operator/logs.js";
import {
  readServiceHealthHistory,
  summarizeHealthRegression,
  summarizeServiceHealthRegression,
  type ServiceHealthRegressionServiceSummary,
  type ServiceHealthRegressionSummary,
} from "../health/history.js";
import type { RuntimeConfigOptions } from "../config.js";
import { ensureRuntimeConfig, resolveRuntimeConfig } from "../config.js";

const REDACTED = "[REDACTED]";
const MAX_LOG_LINES = 40;

const sensitiveKeyPattern = /(api[_-]?key|auth|bearer|cookie|credential|env|key|password|private|secret|token)/i;
const sensitiveValuePatterns = [
  /Bearer\s+[A-Za-z0-9._~+/-]{12,}/g,
  /https?:\/\/[^\s/:]+:[^\s/@]{6,}@/g,
  /AKIA[0-9A-Z]{16}/g,
  /gh[pousr]_[A-Za-z0-9_]{20,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /SERVICE_LASSO_FAKE_SECRET_SENTINEL_[A-Z_]+_DO_NOT_USE/g,
];

export interface DiagnosticsBundleOptions extends RuntimeConfigOptions {
  serviceId?: string;
  generatedAt?: string;
}

export interface DiagnosticsBundleLogExcerpt {
  type: "service" | "stdout" | "stderr";
  path: string;
  totalLines: number;
  lines: string[];
}

export interface DiagnosticsBundleService {
  serviceId: string;
  manifestPath: string;
  serviceRoot: string;
  manifest: {
    id: string;
    name: string;
    description: string;
    enabled: boolean;
    role: string | null;
    version: string | null;
    dependencies: string[];
    dependents: string[];
    ports: Record<string, number>;
    urlKeys: string[];
    envKeys: string[];
    globalenvKeys: string[];
    broker: unknown;
  };
  statePaths: ReturnType<typeof getServiceStatePaths>;
  lifecycle: ReturnType<typeof summarizeLifecycle>;
  healthRegression: ServiceHealthRegressionServiceSummary;
  updates: Awaited<ReturnType<typeof readServiceUpdateState>>;
  recovery: Awaited<ReturnType<typeof readServiceRecoveryHistory>>;
  logs: DiagnosticsBundleLogExcerpt[];
}

export interface DiagnosticsBundle {
  bundleVersion: 1;
  generatedAt: string;
  scope: {
    kind: "baseline" | "service";
    serviceId: string | null;
  };
  runtime: {
    version: string;
    servicesRoot: string;
    workspaceRoot: string;
    serviceCount: number;
  };
  healthRegression: ServiceHealthRegressionSummary;
  services: DiagnosticsBundleService[];
  redaction: {
    value: typeof REDACTED;
    rules: string[];
  };
}

export interface DiagnosticsBundlePreviewFile {
  path: string;
  sourcePath: string | null;
  wouldWrite: true;
  contents: string[];
}

export interface DiagnosticsBundlePreviewLogSegment {
  type: DiagnosticsBundleLogExcerpt["type"];
  sourcePath: string;
  totalLines: number;
  includedLines: number;
  redaction: "pattern-redacted";
}

export interface DiagnosticsBundlePreviewRedaction {
  surface: string;
  action: "keys-only" | "field-redacted" | "pattern-redacted";
  keys?: string[];
  redacted: boolean;
}

export interface DiagnosticsBundlePreviewService {
  serviceId: string;
  manifestPath: string;
  serviceRoot: string;
  files: DiagnosticsBundlePreviewFile[];
  includedFields: string[];
  logSegments: DiagnosticsBundlePreviewLogSegment[];
  redactions: DiagnosticsBundlePreviewRedaction[];
}

export interface DiagnosticsBundlePreview {
  previewVersion: 1;
  generatedAt: string;
  mutated: false;
  scope: DiagnosticsBundle["scope"];
  runtime: DiagnosticsBundle["runtime"];
  output: {
    wouldWriteBundle: false;
    files: DiagnosticsBundlePreviewFile[];
  };
  services: DiagnosticsBundlePreviewService[];
  redaction: DiagnosticsBundle["redaction"];
}

function redactString(value: string): string {
  return sensitiveValuePatterns.reduce((current, pattern) => current.replace(pattern, REDACTED), value);
}

export function redactDiagnosticsValue(input: unknown, key = ""): unknown {
  if (input === null || input === undefined) {
    return input;
  }

  if (sensitiveKeyPattern.test(key)) {
    if (Array.isArray(input)) {
      return input.map(() => REDACTED);
    }
    if (typeof input === "object") {
      return REDACTED;
    }
    return REDACTED;
  }

  if (typeof input === "string") {
    return redactString(input);
  }

  if (typeof input === "number" || typeof input === "boolean") {
    return input;
  }

  if (Array.isArray(input)) {
    return input.map((entry) => redactDiagnosticsValue(entry, key));
  }

  if (typeof input === "object") {
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>).map(([entryKey, value]) => [
        entryKey,
        redactDiagnosticsValue(value, entryKey),
      ]),
    );
  }

  return input;
}

function objectKeys(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  return Object.keys(value as Record<string, unknown>).sort();
}

function summarizeLifecycle(lifecycle: ServiceLifecycleState) {
  return {
    installed: lifecycle.installed,
    configured: lifecycle.configured,
    running: lifecycle.running,
    lastAction: lifecycle.lastAction,
    actionHistory: [...lifecycle.actionHistory],
    installArtifacts: redactDiagnosticsValue(lifecycle.installArtifacts),
    configArtifacts: redactDiagnosticsValue(lifecycle.configArtifacts),
    setup: redactDiagnosticsValue(lifecycle.setup),
    runtime: {
      pid: lifecycle.runtime.pid,
      startedAt: lifecycle.runtime.startedAt,
      finishedAt: lifecycle.runtime.finishedAt,
      exitCode: lifecycle.runtime.exitCode,
      command: lifecycle.runtime.command ? REDACTED : null,
      provider: lifecycle.runtime.provider,
      providerServiceId: lifecycle.runtime.providerServiceId,
      lastTermination: lifecycle.runtime.lastTermination,
      ports: { ...lifecycle.runtime.ports },
      logs: { ...lifecycle.runtime.logs },
      metrics: { ...lifecycle.runtime.metrics },
      brokerIdentity: redactDiagnosticsValue(lifecycle.runtime.brokerIdentity),
    },
  };
}

async function readLogExcerpt(type: DiagnosticsBundleLogExcerpt["type"], filePath: string): Promise<DiagnosticsBundleLogExcerpt> {
  let lines: string[] = [];

  try {
    lines = (await readFile(filePath, "utf8")).split(/\r?\n/).filter((line) => line.trim().length > 0);
  } catch {
    lines = [];
  }

  return {
    type,
    path: filePath,
    totalLines: lines.length,
    lines: lines.slice(-MAX_LOG_LINES).map((line) => redactString(line)),
  };
}

async function buildServiceBundle(
  service: DiscoveredService,
  graph: DependencyGraph,
): Promise<DiagnosticsBundleService> {
  const lifecycle = getLifecycleState(service.manifest.id);
  const logPaths = getServiceRuntimeLogPaths(service.serviceRoot);
  const dependencySummary = graph.getServiceDependencies(service.manifest.id);
  const healthHistory = await readServiceHealthHistory(service);

  return {
    serviceId: service.manifest.id,
    manifestPath: service.manifestPath,
    serviceRoot: service.serviceRoot,
    manifest: {
      id: service.manifest.id,
      name: service.manifest.name,
      description: service.manifest.description,
      enabled: service.manifest.enabled !== false,
      role: typeof service.manifest.role === "string" ? service.manifest.role : null,
      version: typeof service.manifest.version === "string" ? service.manifest.version : null,
      dependencies: dependencySummary.dependencies,
      dependents: dependencySummary.dependents,
      ports: { ...(service.manifest.ports ?? {}) },
      urlKeys: objectKeys(service.manifest.urls),
      envKeys: objectKeys(service.manifest.env),
      globalenvKeys: objectKeys(service.manifest.globalenv),
      broker: redactDiagnosticsValue(service.manifest.broker),
    },
    statePaths: getServiceStatePaths(service.serviceRoot),
    lifecycle: summarizeLifecycle(lifecycle),
    healthRegression: redactDiagnosticsValue(
      summarizeServiceHealthRegression(healthHistory),
    ) as ServiceHealthRegressionServiceSummary,
    updates: redactDiagnosticsValue(await readServiceUpdateState(service)) as Awaited<ReturnType<typeof readServiceUpdateState>>,
    recovery: redactDiagnosticsValue(await readServiceRecoveryHistory(service)) as Awaited<ReturnType<typeof readServiceRecoveryHistory>>,
    logs: await Promise.all([
      readLogExcerpt("service", logPaths.logPath),
      readLogExcerpt("stdout", logPaths.stdoutPath),
      readLogExcerpt("stderr", logPaths.stderrPath),
    ]),
  };
}

export async function buildDiagnosticsBundle(options: DiagnosticsBundleOptions = {}): Promise<DiagnosticsBundle> {
  const config = await ensureRuntimeConfig(resolveRuntimeConfig(options));
  const discovered = await discoverServices(config.servicesRoot);
  await rehydrateDiscoveredServices(discovered);
  const registry = createServiceRegistry(discovered);
  const graph = new DependencyGraph(registry);
  const selected = options.serviceId ? ([registry.getById(options.serviceId)].filter(Boolean) as DiscoveredService[]) : discovered;

  if (options.serviceId && selected.length === 0) {
    throw new Error("Unknown service id: " + options.serviceId);
  }

  const healthHistories = await Promise.all(selected.map((service) => readServiceHealthHistory(service)));
  const services = await Promise.all(selected.map((service) => buildServiceBundle(service, graph)));

  return {
    bundleVersion: 1,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    scope: {
      kind: options.serviceId ? "service" : "baseline",
      serviceId: options.serviceId ?? null,
    },
    runtime: {
      version: config.version,
      servicesRoot: config.servicesRoot,
      workspaceRoot: config.workspaceRoot,
      serviceCount: selected.length,
    },
    healthRegression: redactDiagnosticsValue(
      summarizeHealthRegression(healthHistories),
    ) as ServiceHealthRegressionSummary,
    services,
    redaction: {
      value: REDACTED,
      rules: [
        "manifest env/globalenv values are summarized by key only",
        "token/password/private-key/cookie/auth/credential fields are replaced",
        "common credential shapes in log excerpts are replaced",
      ],
    },
  };
}

function safeServiceDirectoryName(serviceId: string): string {
  return encodeURIComponent(serviceId).replace(/%/g, "_");
}

function buildServicePreview(service: DiagnosticsBundleService): DiagnosticsBundlePreviewService {
  const serviceDirectoryName = safeServiceDirectoryName(service.serviceId);
  return {
    serviceId: service.serviceId,
    manifestPath: service.manifestPath,
    serviceRoot: service.serviceRoot,
    files: [
      {
        path: path.posix.join("services", serviceDirectoryName, "summary.json"),
        sourcePath: service.manifestPath,
        wouldWrite: true,
        contents: [
          "service manifest metadata",
          "state paths",
          "lifecycle summary",
          "health regression summary",
          "update and recovery summaries",
        ],
      },
      {
        path: path.posix.join("services", serviceDirectoryName, "logs.json"),
        sourcePath: null,
        wouldWrite: true,
        contents: ["bounded redacted service/stdout/stderr log excerpts"],
      },
    ],
    includedFields: [
      "manifest.id",
      "manifest.name",
      "manifest.description",
      "manifest.enabled",
      "manifest.role",
      "manifest.version",
      "manifest.dependencies",
      "manifest.dependents",
      "manifest.ports",
      "manifest.urlKeys",
      "manifest.envKeys",
      "manifest.globalenvKeys",
      "manifest.broker",
      "statePaths",
      "lifecycle",
      "healthRegression",
      "updates",
      "recovery",
      "logs",
    ],
    logSegments: service.logs.map((log) => ({
      type: log.type,
      sourcePath: log.path,
      totalLines: log.totalLines,
      includedLines: log.lines.length,
      redaction: "pattern-redacted",
    })),
    redactions: [
      {
        surface: "manifest.env",
        action: "keys-only",
        keys: service.manifest.envKeys,
        redacted: service.manifest.envKeys.length > 0,
      },
      {
        surface: "manifest.globalenv",
        action: "keys-only",
        keys: service.manifest.globalenvKeys,
        redacted: service.manifest.globalenvKeys.length > 0,
      },
      {
        surface: "manifest.broker",
        action: "field-redacted",
        redacted: service.manifest.broker !== null && service.manifest.broker !== undefined,
      },
      {
        surface: "lifecycle.runtime.command",
        action: "field-redacted",
        redacted: service.lifecycle.runtime.command === REDACTED,
      },
      {
        surface: "logs.lines",
        action: "pattern-redacted",
        redacted: service.logs.some((log) => log.lines.length > 0),
      },
    ],
  };
}

export function buildDiagnosticsBundlePreview(bundle: DiagnosticsBundle): DiagnosticsBundlePreview {
  const services = bundle.services.map((service) => buildServicePreview(service));
  return {
    previewVersion: 1,
    generatedAt: bundle.generatedAt,
    mutated: false,
    scope: bundle.scope,
    runtime: bundle.runtime,
    output: {
      wouldWriteBundle: false,
      files: [
        {
          path: "manifest.json",
          sourcePath: null,
          wouldWrite: true,
          contents: ["bundle metadata", "runtime summary", "service summaries", "redaction rules"],
        },
        ...services.flatMap((service) => service.files),
      ],
    },
    services,
    redaction: bundle.redaction,
  };
}

export async function writeDiagnosticsBundleFolder(bundle: DiagnosticsBundle, outputRoot: string): Promise<string> {
  const bundleRoot = path.resolve(outputRoot);
  await mkdir(bundleRoot, { recursive: true });
  await writeFile(path.join(bundleRoot, "manifest.json"), JSON.stringify(bundle, null, 2) + "\n");

  const servicesRoot = path.join(bundleRoot, "services");
  await mkdir(servicesRoot, { recursive: true });

  for (const service of bundle.services) {
    const serviceRoot = path.join(servicesRoot, safeServiceDirectoryName(service.serviceId));
    await mkdir(serviceRoot, { recursive: true });
    await writeFile(path.join(serviceRoot, "summary.json"), JSON.stringify(service, null, 2) + "\n");
    await writeFile(path.join(serviceRoot, "logs.json"), JSON.stringify(service.logs, null, 2) + "\n");
  }

  return bundleRoot;
}
