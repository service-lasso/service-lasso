import net from "node:net";
import type {
  BaselineDependencyDiagnosticsResponse,
  ServiceDependencyBlockerKind,
  ServiceDependencyDiagnostic,
  ServiceDependencyDiagnosticEndpoint,
  ServiceDependencyReadiness,
} from "../../contracts/api.js";
import type { DiscoveredService } from "../../contracts/service.js";
import { evaluateServiceHealth } from "../health/evaluateHealth.js";
import { getLifecycleState } from "../lifecycle/store.js";
import type { ServiceRegistry } from "../manager/ServiceRegistry.js";
import type { DependencyGraph } from "../manager/DependencyGraph.js";
import { buildServiceNetwork } from "./network.js";

const DEFAULT_PORT_HOST = "127.0.0.1";

function sanitizeEndpointUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return value.split("?")[0]?.split("#")[0] ?? value;
  }
}

function endpointPort(value: string): number | null {
  try {
    const url = new URL(value);
    if (url.port.length > 0) {
      return Number(url.port);
    }
    if (url.protocol === "https:") {
      return 443;
    }
    if (url.protocol === "http:") {
      return 80;
    }
  } catch {
    return null;
  }

  return null;
}

function isUsablePort(port: number): boolean {
  return Number.isInteger(port) && port > 0 && port <= 65535;
}

async function canBindPort(port: number, host = DEFAULT_PORT_HOST): Promise<boolean> {
  const server = net.createServer();

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => resolve());
    });
    return true;
  } catch {
    return false;
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }).catch(() => undefined);
    }
  }
}

async function findOccupiedPort(ports: Record<string, number>, running: boolean): Promise<number | null> {
  if (running) {
    return null;
  }

  for (const port of Object.values(ports)) {
    if (isUsablePort(port) && !(await canBindPort(port))) {
      return port;
    }
  }

  return null;
}

function buildEndpoints(
  service: DiscoveredService,
  sharedGlobalEnv: Record<string, string>,
  ports: Record<string, number>,
): ServiceDependencyDiagnosticEndpoint[] {
  return buildServiceNetwork(service, sharedGlobalEnv, ports).endpoints.map((endpoint) => ({
    label: endpoint.label,
    url: sanitizeEndpointUrl(endpoint.url),
    port: endpointPort(endpoint.url),
  }));
}

function nextActionFor(readiness: ServiceDependencyReadiness, blockingReason: ServiceDependencyBlockerKind | null): string {
  if (readiness === "disabled") {
    return "Enable the service before including it in baseline start.";
  }
  if (readiness === "running") {
    return "No start action is required.";
  }
  if (readiness === "degraded") {
    return "Inspect health and recovery evidence before restarting.";
  }
  if (blockingReason === "missing_dependency") {
    return "Add or restore the missing dependency manifest.";
  }
  if (blockingReason === "dependency_not_ready") {
    return "Start or repair blocking dependencies first.";
  }
  if (blockingReason === "not_installed") {
    return "Run install for this service.";
  }
  if (blockingReason === "not_configured") {
    return "Run config for this service.";
  }
  if (blockingReason === "port_occupied") {
    return "Free the occupied port or change the service port before start.";
  }

  return "Service is ready to start.";
}

export async function buildBaselineDependencyDiagnostics(
  services: DiscoveredService[],
  registry: ServiceRegistry,
  graph: DependencyGraph,
  sharedGlobalEnv: Record<string, string>,
): Promise<BaselineDependencyDiagnosticsResponse["diagnostics"]> {
  const diagnostics = new Map<string, ServiceDependencyDiagnostic>();

  for (const service of services) {
    const lifecycle = getLifecycleState(service.manifest.id);
    const ports = Object.keys(lifecycle.runtime.ports).length > 0 ? lifecycle.runtime.ports : service.manifest.ports ?? {};
    const health = await evaluateServiceHealth(service.manifest, lifecycle, service.serviceRoot, service, sharedGlobalEnv);
    const dependencySummary = graph.getServiceDependencies(service.manifest.id);
    const missingDependencies = dependencySummary.dependencies.filter((dependencyId) => !registry.getById(dependencyId));
    const occupiedPort = await findOccupiedPort(ports, lifecycle.running);
    const enabled = service.manifest.enabled !== false;
    let readiness: ServiceDependencyReadiness = "ready";
    let blockingReason: ServiceDependencyBlockerKind | null = null;
    const blockers: string[] = [];

    if (!enabled) {
      readiness = "disabled";
      blockingReason = "disabled";
      blockers.push("Service is disabled in service.json.");
    } else if (missingDependencies.length > 0) {
      readiness = "blocked";
      blockingReason = "missing_dependency";
      blockers.push(`Missing dependency manifest: ${missingDependencies.join(", ")}.`);
    } else if (!lifecycle.installed) {
      readiness = "blocked";
      blockingReason = "not_installed";
      blockers.push("Service has not been installed.");
    } else if (!lifecycle.configured) {
      readiness = "blocked";
      blockingReason = "not_configured";
      blockers.push("Service has not been configured.");
    } else if (occupiedPort !== null) {
      readiness = "blocked";
      blockingReason = "port_occupied";
      blockers.push(`Port ${occupiedPort} is already occupied.`);
    } else if (lifecycle.running && !health.healthy) {
      readiness = "degraded";
      blockingReason = "unhealthy";
      blockers.push(health.detail);
    } else if (lifecycle.running) {
      readiness = "running";
    }

    diagnostics.set(service.manifest.id, {
      id: service.manifest.id,
      name: service.manifest.name,
      enabled,
      installed: lifecycle.installed,
      configured: lifecycle.configured,
      running: lifecycle.running,
      readiness,
      blockingReason,
      blockers,
      nextAction: nextActionFor(readiness, blockingReason),
      dependencies: [],
      dependents: dependencySummary.dependents,
      ports,
      endpoints: buildEndpoints(service, sharedGlobalEnv, ports),
      health,
    });
  }

  for (const diagnostic of diagnostics.values()) {
    const dependencySummary = graph.getServiceDependencies(diagnostic.id);
    diagnostic.dependencies = dependencySummary.dependencies.map((dependencyId) => {
      const related = diagnostics.get(dependencyId);
      if (!related) {
        return {
          id: dependencyId,
          name: dependencyId,
          ready: false,
          readiness: "blocked",
          blockingReason: "missing_dependency",
        };
      }

      const ready = related.readiness === "ready" || related.readiness === "running";
      if (!ready && diagnostic.readiness === "ready") {
        diagnostic.readiness = "blocked";
        diagnostic.blockingReason = "dependency_not_ready";
        diagnostic.blockers.push(`Dependency ${dependencyId} is ${related.readiness}.`);
        diagnostic.nextAction = nextActionFor(diagnostic.readiness, diagnostic.blockingReason);
      }

      return {
        id: related.id,
        name: related.name,
        ready,
        readiness: related.readiness,
        blockingReason: related.blockingReason,
      };
    });
  }

  const serviceDiagnostics = [...diagnostics.values()].sort((left, right) => left.id.localeCompare(right.id));
  const enabledServices = serviceDiagnostics.filter((service) => service.enabled);
  const blockedServices = enabledServices.filter((service) => service.readiness === "blocked").length;
  const degradedServices = enabledServices.filter((service) => service.readiness === "degraded").length;
  const runningServices = enabledServices.filter((service) => service.readiness === "running").length;
  const startableServices = enabledServices.filter((service) => service.readiness === "ready").length;
  const status =
    blockedServices > 0
      ? "blocked"
      : degradedServices > 0
        ? "degraded"
        : runningServices === enabledServices.length && enabledServices.length > 0
          ? "running"
          : "startable";

  return {
    summary: {
      status,
      totalServices: serviceDiagnostics.length,
      enabledServices: enabledServices.length,
      runningServices,
      startableServices,
      blockedServices,
      degradedServices,
      disabledServices: serviceDiagnostics.length - enabledServices.length,
    },
    services: serviceDiagnostics,
  };
}
