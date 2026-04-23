import { readFile, stat } from "node:fs/promises";
import type { DiscoveredService } from "../../contracts/service.js";
import type {
  DashboardActionResponse,
  DashboardDependencyResponse,
  DashboardEndpointResponse,
  DashboardLogPreviewEntryResponse,
  DashboardServiceResponse,
  DashboardSummaryResponse,
} from "../../contracts/api.js";
import type { ServiceHealthResult } from "../health/types.js";
import { evaluateServiceHealth } from "../health/evaluateHealth.js";
import { getLifecycleState } from "../lifecycle/store.js";
import type { ServiceRegistry } from "../manager/ServiceRegistry.js";
import type { DependencyGraph } from "../manager/DependencyGraph.js";
import { buildServiceNetwork } from "./network.js";
import { getServiceRuntimeLogPaths } from "./logs.js";
import { buildServiceVariables } from "./variables.js";
import { readServiceMeta } from "../state/meta.js";
import { getServiceStatePaths } from "../state/paths.js";
import { resolveProviderExecution } from "../providers/resolveProvider.js";

type DashboardServiceStatus = DashboardServiceResponse["status"];

interface PersistedRuntimePreviewEntry {
  timestamp?: string;
  level?: "stdout" | "stderr";
  message?: string;
}

function mapServiceStatus(
  lifecycle: ReturnType<typeof getLifecycleState>,
  health: ServiceHealthResult,
): DashboardServiceStatus {
  if (!lifecycle.running) {
    return "stopped";
  }

  return health.healthy ? "running" : "degraded";
}

function mapRuntimeHealth(
  status: DashboardServiceStatus,
): DashboardServiceResponse["runtimeHealth"]["health"] {
  if (status === "running") {
    return "healthy";
  }

  if (status === "degraded") {
    return "warning";
  }

  return "critical";
}

function formatDuration(ms: number | null): string {
  if (!ms || ms <= 0) {
    return "0m";
  }

  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return `${days}d ${hours}h`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

function calculateRunDurationMs(
  lifecycle: ReturnType<typeof getLifecycleState>,
  nowIso: string,
): number | null {
  if (lifecycle.running && lifecycle.runtime.startedAt) {
    const startedAt = Date.parse(lifecycle.runtime.startedAt);
    const now = Date.parse(nowIso);
    if (Number.isFinite(startedAt) && Number.isFinite(now)) {
      return Math.max(0, now - startedAt);
    }
  }

  return lifecycle.runtime.metrics.lastRunDurationMs;
}

function inferExposure(hostname: string, kind?: string): "local" | "lan" | "public" {
  if (kind === "local" || kind === "lan" || kind === "public") {
    return kind;
  }

  if (hostname === "127.0.0.1" || hostname === "localhost") {
    return "local";
  }

  if (
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
  ) {
    return "lan";
  }

  return "public";
}

function buildDashboardEndpoints(
  service: DiscoveredService,
  sharedGlobalEnv: Record<string, string>,
  resolvedPorts: Record<string, number>,
): DashboardEndpointResponse[] {
  return buildServiceNetwork(service, sharedGlobalEnv, resolvedPorts).endpoints.map((endpoint) => {
    try {
      const parsed = new URL(endpoint.url);
      const protocol = parsed.protocol.replace(/:$/, "");
      const safeProtocol =
        protocol === "http" || protocol === "https" || protocol === "tcp" ? protocol : "http";
      const port =
        parsed.port.length > 0
          ? Number(parsed.port)
          : safeProtocol === "https"
            ? 443
            : safeProtocol === "http"
              ? 80
              : 0;
      const exposure = inferExposure(parsed.hostname, endpoint.kind);

      return {
        label: endpoint.label,
        url: endpoint.url,
        bind: parsed.hostname,
        port,
        protocol: safeProtocol,
        exposure,
      };
    } catch {
      return {
        label: endpoint.label,
        url: endpoint.url,
        bind: "unknown",
        port: 0,
        protocol: "http",
        exposure: endpoint.kind === "lan" ? "lan" : endpoint.kind === "public" ? "public" : "local",
      };
    }
  });
}

function buildDashboardLinks(endpoints: DashboardEndpointResponse[]): DashboardServiceResponse["links"] {
  return endpoints
    .filter((endpoint) => endpoint.label !== "health")
    .map((endpoint) => ({
      label: endpoint.label,
      url: endpoint.url,
      kind:
        endpoint.label.toLowerCase().includes("ui") || endpoint.label.toLowerCase().includes("admin")
          ? "admin"
          : endpoint.exposure === "public"
            ? "remote"
            : endpoint.exposure,
    }));
}

function mapVariableScope(scope: "manifest" | "derived" | "global"): "global" | "service" {
  return scope === "global" ? "global" : "service";
}

function mapVariableSource(scope: "manifest" | "derived" | "global"): string {
  if (scope === "manifest") {
    return "service.json";
  }

  if (scope === "global") {
    return "globalenv";
  }

  return "runtime";
}

function inferServiceType(service: DiscoveredService, runtimeLabel: string, endpoints: DashboardEndpointResponse[]): string {
  if (service.manifest.id.startsWith("@")) {
    return "runtime";
  }

  if (runtimeLabel.includes("python") || runtimeLabel.includes("node")) {
    return "app";
  }

  if (endpoints.length > 0) {
    return "app";
  }

  return "utility";
}

async function readRecentLogPreview(
  serviceRoot: string,
  lifecycle: ReturnType<typeof getLifecycleState>,
  nowIso: string,
): Promise<DashboardLogPreviewEntryResponse[]> {
  const { logPath } = getServiceRuntimeLogPaths(serviceRoot);

  try {
    const [content, fileStat] = await Promise.all([readFile(logPath, "utf8"), stat(logPath)]);
    const fileTimestamp = fileStat.mtime.toISOString();
    const parsed = content
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        try {
          return JSON.parse(line) as PersistedRuntimePreviewEntry;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is PersistedRuntimePreviewEntry => entry !== null)
      .filter(
        (entry): entry is PersistedRuntimePreviewEntry & { level: "stdout" | "stderr"; message: string } =>
          (entry.level === "stdout" || entry.level === "stderr") && typeof entry.message === "string",
      )
      .slice(-5)
      .reverse();

    return parsed.map((entry) => ({
      timestamp: entry.timestamp ?? fileTimestamp,
      level: entry.level === "stderr" ? "error" : "info",
      source: entry.level,
      message: entry.message,
    }));
  } catch {
    return lifecycle.actionHistory
      .slice(-5)
      .reverse()
      .map((action) => ({
        timestamp:
          lifecycle.runtime.finishedAt ??
          lifecycle.runtime.startedAt ??
          nowIso,
        level: "info" as const,
        source: "supervisor" as const,
        message: `${serviceRoot}:${action}`,
      }));
  }
}

async function buildRelatedServices(
  serviceIds: string[],
  relation: DashboardDependencyResponse["relation"],
  registry: ServiceRegistry,
  sharedGlobalEnv: Record<string, string>,
  nowIso: string,
): Promise<DashboardDependencyResponse[]> {
  return Promise.all(
    serviceIds.map(async (serviceId) => {
      const related = registry.getById(serviceId);
      if (!related) {
        return {
          id: serviceId,
          name: serviceId,
          status: "stopped" as const,
          relation,
        };
      }

      const lifecycle = getLifecycleState(serviceId);
      const resolvedPorts =
        Object.keys(lifecycle.runtime.ports).length > 0
          ? lifecycle.runtime.ports
          : related.manifest.ports ?? {};
      const health = await evaluateServiceHealth(
        related.manifest,
        lifecycle,
        related.serviceRoot,
        related,
        sharedGlobalEnv,
      );

      return {
        id: serviceId,
        name: related.manifest.name,
        status: mapServiceStatus(lifecycle, health),
        relation,
        note:
          health.healthy || !lifecycle.running
            ? undefined
            : `Last evaluated ${nowIso}: ${health.detail}`,
      };
    }),
  );
}

function buildDashboardActions(service: DashboardServiceResponse): DashboardActionResponse[] {
  const actions: DashboardActionResponse[] = [
    { id: "install", label: "Install service", kind: "install" },
    { id: "start", label: "Start service", kind: "start" },
    { id: "stop", label: "Stop service", kind: "stop" },
    { id: "restart", label: "Restart service", kind: "restart" },
    { id: "reload", label: "Reload service", kind: "reload" },
    { id: "open_logs", label: "Open logs", kind: "open_logs" },
    { id: "open_config", label: "Open config", kind: "open_config" },
  ];

  if (service.links.length > 0) {
    actions.push({ id: "open_admin", label: "Open endpoint", kind: "open_admin" });
  }

  return actions;
}

export async function buildDashboardService(
  service: DiscoveredService,
  registry: ServiceRegistry,
  graph: DependencyGraph,
  sharedGlobalEnv: Record<string, string>,
  nowIso = new Date().toISOString(),
): Promise<DashboardServiceResponse> {
  const lifecycle = getLifecycleState(service.manifest.id);
  const resolvedPorts =
    Object.keys(lifecycle.runtime.ports).length > 0
      ? lifecycle.runtime.ports
      : service.manifest.ports ?? {};
  const health = await evaluateServiceHealth(
    service.manifest,
    lifecycle,
    service.serviceRoot,
    service,
    sharedGlobalEnv,
  );
  const meta = await readServiceMeta(service.serviceRoot);
  const provider = resolveProviderExecution(service, registry);
  const endpoints = buildDashboardEndpoints(service, sharedGlobalEnv, resolvedPorts);
  const variables = buildServiceVariables(service, sharedGlobalEnv, resolvedPorts).variables;
  const dependencySummary = graph.getServiceDependencies(service.manifest.id);
  const status = mapServiceStatus(lifecycle, health);
  const runtimeLabel =
    lifecycle.runtime.provider ??
    provider.provider ??
    service.manifest.execservice ??
    service.manifest.executable ??
    "direct";
  const runtimeHealth = {
    state: status,
    health: mapRuntimeHealth(status),
    uptime: formatDuration(calculateRunDurationMs(lifecycle, nowIso)),
    lastCheckAt: nowIso,
    lastRestartAt: lifecycle.runtime.startedAt,
    summary: health.detail,
  } as DashboardServiceResponse["runtimeHealth"];

  const dashboardService: DashboardServiceResponse = {
    id: service.manifest.id,
    name: service.manifest.name,
    status,
    favorite: meta.favorite,
    note: health.detail,
    links: buildDashboardLinks(endpoints),
    installed: lifecycle.installed,
    role: runtimeLabel,
    runtimeHealth,
    endpoints,
    metadata: {
      serviceType: inferServiceType(service, runtimeLabel, endpoints),
      runtime: runtimeLabel,
      version: service.manifest.version ?? "unversioned",
      build: lifecycle.runtime.command ?? service.manifest.executable ?? service.manifest.execservice ?? "manifest-only",
      packageId: service.manifest.id,
      installPath: service.serviceRoot,
      configPath: service.manifestPath,
      dataPath: getServiceStatePaths(service.serviceRoot).stateRoot,
      logPath: lifecycle.runtime.logs.logPath ?? getServiceRuntimeLogPaths(service.serviceRoot).logPath,
      workPath: service.serviceRoot,
      profile: "develop",
    },
    dependencies: await buildRelatedServices(
      dependencySummary.dependencies,
      "depends_on",
      registry,
      sharedGlobalEnv,
      nowIso,
    ),
    dependents: await buildRelatedServices(
      dependencySummary.dependents,
      "dependent",
      registry,
      sharedGlobalEnv,
      nowIso,
    ),
    environmentVariables: variables.map((variable) => ({
      key: variable.key,
      value: variable.value,
      scope: mapVariableScope(variable.scope),
      secret: false,
      source: mapVariableSource(variable.scope),
    })),
    recentLogs: await readRecentLogPreview(service.serviceRoot, lifecycle, nowIso),
    actions: [],
  };

  dashboardService.actions = buildDashboardActions(dashboardService);
  return dashboardService;
}

export function buildDashboardSummary(
  services: DashboardServiceResponse[],
  nowIso = new Date().toISOString(),
): DashboardSummaryResponse["summary"] {
  const favorites = services.filter((service) => service.favorite);
  const others = services.filter((service) => !service.favorite);
  const warnings: string[] = [];

  if (services.some((service) => service.status === "degraded")) {
    warnings.push("One or more services are degraded and need attention.");
  }

  if (services.some((service) => service.status === "stopped")) {
    warnings.push("At least one managed service is currently stopped.");
  }

  if (favorites.length === 0) {
    warnings.push("No favorite services are configured for quick access.");
  }

  return {
    runtime: {
      status: warnings.length === 0 ? "healthy" : "warning",
      lastReloadedAt: nowIso,
      warningCount: warnings.length,
    },
    servicesTotal: services.length,
    servicesRunning: services.filter((service) => service.status === "running").length,
    servicesStopped: services.filter((service) => service.status === "stopped").length,
    servicesDegraded: services.filter((service) => service.status === "degraded").length,
    networkExposureCount: services.reduce((count, service) => count + service.links.length, 0),
    installedCount: services.filter((service) => service.installed).length,
    favorites,
    others,
    warnings,
    problemServices: services.filter((service) => service.status !== "running"),
  };
}
