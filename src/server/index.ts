import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { once } from "node:events";
import { createHealthResponse } from "./routes/health.js";
import { createServicesResponse } from "./routes/services.js";
import { createDependenciesResponse } from "./routes/dependencies.js";
import { createRuntimeSummaryResponse } from "./routes/runtime.js";
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
}

export interface RunningApiServer {
  server: Server;
  port: number;
  url: string;
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

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: RuntimeConfig,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

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

  return createServer((request, response) => {
    void routeRequest(request, response, resolvedConfig).catch((error: unknown) => {
      const body = toApiErrorBody(error);
      writeJson(response, body.statusCode, body);
    });
  });
}

export async function startApiServer(options: ApiServerOptions = {}): Promise<RunningApiServer> {
  const config = await ensureRuntimeConfig(resolveRuntimeConfig(options));
  const bootModel = await loadRuntimeModel(config.servicesRoot);
  await rehydrateDiscoveredServices(bootModel.discovered);
  if (options.autostart) {
    await executeRuntimeOrchestrationAction("autostart", bootModel);
  }
  const server = createApiServer(config);
  const port = options.port ?? 18080;

  server.listen(port, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("API server failed to expose a TCP address.");
  }

  const resolvedPort = address.port;

  return {
    server,
    port: resolvedPort,
    url: `http://127.0.0.1:${resolvedPort}`,
    stop: async () => {
      await stopAllManagedProcesses();
      server.close();
      await once(server, "close");
    },
  };
}
