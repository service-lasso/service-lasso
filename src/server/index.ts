import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { once } from "node:events";
import { createHealthResponse } from "./routes/health.js";
import { createServicesResponse } from "./routes/services.js";
import { createDependenciesResponse } from "./routes/dependencies.js";
import { createRuntimeSummaryResponse } from "./routes/runtime.js";
import { createServiceHealthResponse } from "./routes/service-health.js";
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
import type { LifecycleActionResponse, ServiceDetailResponse, ServiceSummary } from "../contracts/api.js";

export interface ApiServerOptions {
  port?: number;
  version?: string;
  servicesRoot?: string;
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
): Promise<ServiceSummary> {
  const dependencySummary = graph.getServiceDependencies(service.manifest.id);
  const lifecycle = getLifecycleState(service.manifest.id);
  const health = await evaluateServiceHealth(service.manifest, lifecycle);

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
  };
}

function createServiceDetailResponse(service: ServiceSummary): ServiceDetailResponse {
  return {
    service,
  };
}

async function executeLifecycleAction(action: string, service: Awaited<ReturnType<typeof loadRuntimeModel>>["discovered"][number]): Promise<LifecycleActionResponse> {
  const serviceId = service.manifest.id;
  const result = (() => {
    switch (action) {
      case "install":
        return installService(serviceId);
      case "config":
        return configService(serviceId);
      case "start":
        return startService(serviceId);
      case "stop":
        return stopService(serviceId);
      case "restart":
        return restartService(serviceId);
      default:
        throw new Error(`Unknown lifecycle action: ${action}`);
    }
  })();

  const persisted = await writeServiceState(service, result.state);
  const health = await evaluateServiceHealth(service.manifest, result.state);

  return {
    action: result.action,
    serviceId: result.serviceId,
    ok: result.ok,
    message: result.message,
    state: result.state,
    health,
    statePaths: persisted.paths,
  };
}

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: Required<Pick<ApiServerOptions, "version" | "servicesRoot">>,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (request.method === "GET" && url.pathname === "/api/health") {
    writeJson(response, 200, createHealthResponse(options.version));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/services") {
    const runtimeModel = await loadRuntimeModel(options.servicesRoot);
    const services = await Promise.all(runtimeModel.discovered.map((service) => createServiceSummary(service, runtimeModel.graph)));
    writeJson(response, 200, createServicesResponse(services));
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/api/services/")) {
    const pathParts = url.pathname.split("/").filter(Boolean);
    const runtimeModel = await loadRuntimeModel(options.servicesRoot);
    const serviceId = decodeURIComponent(pathParts[2] ?? "");
    const service = runtimeModel.registry.getById(serviceId);

    if (!service) {
      notFound(response);
      return;
    }

    if (pathParts.length === 4 && pathParts[3] === "health") {
      const lifecycle = getLifecycleState(serviceId);
      const health = await evaluateServiceHealth(service.manifest, lifecycle);
      writeJson(response, 200, createServiceHealthResponse(serviceId, health));
      return;
    }

    if (pathParts.length === 3) {
      writeJson(response, 200, createServiceDetailResponse(await createServiceSummary(service, runtimeModel.graph)));
      return;
    }
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/services/")) {
    const pathParts = url.pathname.split("/").filter(Boolean);
    if (pathParts.length === 4) {
      const [, , rawServiceId, action] = pathParts;
      const serviceId = decodeURIComponent(rawServiceId);
      const runtimeModel = await loadRuntimeModel(options.servicesRoot);
      const service = runtimeModel.registry.getById(serviceId);

      if (!service) {
        notFound(response);
        return;
      }

      writeJson(response, 200, await executeLifecycleAction(action, service));
      return;
    }
  }

  if (request.method === "GET" && url.pathname === "/api/runtime") {
    const runtimeModel = await loadRuntimeModel(options.servicesRoot);
    const serviceSummaries = await Promise.all(runtimeModel.discovered.map((service) => createServiceSummary(service, runtimeModel.graph)));
    const runningServices = serviceSummaries.filter((service) => service.lifecycle?.running).length;
    const healthyServices = serviceSummaries.filter((service) => service.health?.healthy).length;

    writeJson(
      response,
      200,
      createRuntimeSummaryResponse({
        servicesRoot: options.servicesRoot,
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
    const runtimeModel = await loadRuntimeModel(options.servicesRoot);
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

  notFound(response);
}

export function createApiServer(options: ApiServerOptions = {}): Server {
  const resolvedOptions = {
    version: options.version ?? "0.1.0",
    servicesRoot: options.servicesRoot ?? "./services",
  };

  return createServer((request, response) => {
    void routeRequest(request, response, resolvedOptions).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown API failure.";
      writeJson(response, 500, {
        error: "internal_error",
        message,
      });
    });
  });
}

export async function startApiServer(options: ApiServerOptions = {}): Promise<RunningApiServer> {
  const server = createApiServer(options);
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
      server.close();
      await once(server, "close");
    },
  };
}
