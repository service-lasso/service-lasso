import type { DiscoveredService } from "../../contracts/service.js";
import { ServiceRegistry } from "./ServiceRegistry.js";

export interface DependencyNode {
  id: string;
  name: string;
}

export interface DependencyEdge {
  from: string;
  to: string;
}

export interface ServiceDependencySummary {
  dependencies: string[];
  dependents: string[];
}

export class DependencyGraph {
  readonly #registry: ServiceRegistry;

  constructor(registry: ServiceRegistry) {
    this.#registry = registry;
  }

  listNodes(): DependencyNode[] {
    return this.#registry.list().map((service) => ({
      id: service.manifest.id,
      name: service.manifest.name,
    }));
  }

  listEdges(): DependencyEdge[] {
    return this.#registry
      .list()
      .flatMap((service) =>
        (service.manifest.depend_on ?? []).map((dependencyId) => ({
          from: dependencyId,
          to: service.manifest.id,
        })),
      );
  }

  getServiceDependencies(serviceId: string): ServiceDependencySummary {
    const service = this.#registry.getById(serviceId);
    if (!service) {
      throw new Error(`Unknown service id: ${serviceId}`);
    }

    const dependencies = [...(service.manifest.depend_on ?? [])].sort();
    const dependents = this.#registry
      .list()
      .filter((candidate) => (candidate.manifest.depend_on ?? []).includes(serviceId))
      .map((candidate) => candidate.manifest.id)
      .sort();

    return {
      dependencies,
      dependents,
    };
  }

  getStartupOrder(serviceId: string): string[] {
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const ordered: string[] = [];

    const visit = (currentServiceId: string) => {
      if (visited.has(currentServiceId)) {
        return;
      }

      if (visiting.has(currentServiceId)) {
        throw new Error(`Dependency cycle detected while resolving startup order for "${serviceId}".`);
      }

      const service = this.#registry.getById(currentServiceId);
      if (!service) {
        throw new Error(`Unknown service id: ${currentServiceId}`);
      }

      visiting.add(currentServiceId);
      for (const dependencyId of service.manifest.depend_on ?? []) {
        visit(dependencyId);
        if (!ordered.includes(dependencyId)) {
          ordered.push(dependencyId);
        }
      }
      visiting.delete(currentServiceId);
      visited.add(currentServiceId);
    };

    visit(serviceId);
    return ordered;
  }
}

export function createServiceRegistry(services: DiscoveredService[]): ServiceRegistry {
  return new ServiceRegistry(services);
}
