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

export interface ReverseDependencyBlockedBy {
  id: string;
  name: string | null;
  missing: boolean;
}

export interface ReverseDependencyDependent {
  id: string;
  name: string;
  relation: "direct" | "transitive";
  depth: number;
  path: string[];
  blockedBy: ReverseDependencyBlockedBy[];
}

export interface ReverseDependencyLookup {
  target: {
    id: string;
    name: string | null;
    exists: boolean;
  };
  dependents: ReverseDependencyDependent[];
  summary: {
    total: number;
    direct: number;
    transitive: number;
    missingTarget: boolean;
  };
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

  getReverseDependencies(serviceId: string): ReverseDependencyLookup {
    const target = this.#registry.getById(serviceId);
    const services = this.#registry.list();
    const visited = new Set<string>();
    const dependents: ReverseDependencyDependent[] = [];
    const queue: Array<{ id: string; path: string[] }> = services
      .filter((candidate) => (candidate.manifest.depend_on ?? []).includes(serviceId))
      .map((candidate) => ({ id: candidate.manifest.id, path: [serviceId, candidate.manifest.id] }))
      .sort((left, right) => left.id.localeCompare(right.id));

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || current.id === serviceId || visited.has(current.id)) {
        continue;
      }

      const service = this.#registry.getById(current.id);
      if (!service) {
        continue;
      }

      visited.add(current.id);
      const depth = current.path.length - 1;
      const blockedBy = current.path.slice(0, -1).map((dependencyId) => {
        const dependency = this.#registry.getById(dependencyId);
        return {
          id: dependencyId,
          name: dependency?.manifest.name ?? null,
          missing: dependency === undefined,
        };
      });

      dependents.push({
        id: service.manifest.id,
        name: service.manifest.name,
        relation: depth === 1 ? "direct" : "transitive",
        depth,
        path: current.path,
        blockedBy,
      });

      const nextDependents = services
        .filter((candidate) => (candidate.manifest.depend_on ?? []).includes(current.id))
        .map((candidate) => candidate.manifest.id)
        .sort((left, right) => left.localeCompare(right));

      for (const nextId of nextDependents) {
        if (nextId !== serviceId && !visited.has(nextId)) {
          queue.push({ id: nextId, path: [...current.path, nextId] });
        }
      }
    }

    dependents.sort((left, right) => left.depth - right.depth || left.id.localeCompare(right.id));
    const direct = dependents.filter((dependent) => dependent.relation === "direct").length;

    return {
      target: {
        id: serviceId,
        name: target?.manifest.name ?? null,
        exists: target !== undefined,
      },
      dependents,
      summary: {
        total: dependents.length,
        direct,
        transitive: dependents.length - direct,
        missingTarget: target === undefined,
      },
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

  getGlobalStartupOrder(): string[] {
    const ordered = new Set<string>();
    const serviceIds = this.#registry
      .list()
      .map((service) => service.manifest.id)
      .sort((left, right) => left.localeCompare(right));

    for (const serviceId of serviceIds) {
      for (const dependencyId of this.getStartupOrder(serviceId)) {
        ordered.add(dependencyId);
      }
      ordered.add(serviceId);
    }

    return [...ordered];
  }

  getGlobalShutdownOrder(): string[] {
    return [...this.getGlobalStartupOrder()].reverse();
  }
}

export function createServiceRegistry(services: DiscoveredService[]): ServiceRegistry {
  return new ServiceRegistry(services);
}
