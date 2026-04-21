import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { once } from "node:events";
import { createHealthResponse } from "./routes/health.js";
import { createServicesResponse } from "./routes/services.js";
import { createDependenciesResponse } from "./routes/dependencies.js";
import { createRuntimeSummaryResponse } from "./routes/runtime.js";
import { createServiceHealthResponse } from "./routes/service-health.js";
import { createServiceLogsResponse } from "./routes/logs.js";
import { createServiceVariablesResponse } from "./routes/variables.js";
import { createServiceNetworkResponse } from "./routes/network.js";
import { createGlobalEnvResponse } from "./routes/globalenv.js";
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
import { writeServiceState } from "../runtime/state/writeState.js";
import { buildServiceLogs } from "../runtime/operator/logs.js";
import { buildServiceVariables, collectRuntimeGlobalEnv } from "../runtime/operator/variables.js";
import { buildServiceNetwork } from "../runtime/operator/network.js";
import { resolveProviderExecution } from "../runtime/providers/resolveProvider.js";
import { ensureRuntimeConfig, resolveRuntimeConfig, type RuntimeConfig } from "../runtime/config.js";
import { rehydrateDiscoveredServices } from "../runtime/state/rehydrate.js";
import { stopAllManagedProcesses } from "../runtime/execution/supervisor.js";
import { ApiError, toApiErrorBody } from "./errors.js";
import type { LifecycleActionResponse, ServiceDetailResponse, ServiceSummary } from "../contracts/api.js";

export interface ApiServerOptions {
  port?: number;
  version?: string;
  servicesRoot?: string;
  workspaceRoot?: string;
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

async function loadRuntimeModel(servicesRoot: string) {
  const discovered = await discoverServices(servicesRoot);
  const registry = createServiceRegistry(discovered);
  const graph = new DependencyGraph(registry);

  return {
    discovered,
    registry,
    graph,
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
  const logs = buildServiceLogs(service, lifecycle);
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
      logPath: logs.logPath,
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
  service: Awaited<ReturnType<typeof loadRuntimeModel>>["discovered"][number],
  registry: Awaited<ReturnType<typeof loadRuntimeModel>>["registry"],
): Promise<LifecycleActionResponse> {
  const serviceId = service.manifest.id;
  const sharedGlobalEnv = collectRuntimeGlobalEnv(registry.list());
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

  const persisted = await writeServiceState(service, result.state);
  const health = await evaluateServiceHealth(service.manifest, result.state, service.serviceRoot, service, sharedGlobalEnv);
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

    if (request.method === "GET" && pathParts.length === 4 && pathParts[3] === "health") {
      const lifecycle = getLifecycleState(serviceId);
      const health = await evaluateServiceHealth(service.manifest, lifecycle, service.serviceRoot, service, sharedGlobalEnv);
      writeJson(response, 200, createServiceHealthResponse(serviceId, health));
      return;
    }

    if (request.method === "GET" && pathParts.length === 4 && pathParts[3] === "logs") {
      writeJson(response, 200, createServiceLogsResponse(buildServiceLogs(service, getLifecycleState(serviceId))));
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
