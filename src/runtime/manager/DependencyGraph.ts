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
      for (const dependencyId of this.#sortServiceIds(service.manifest.depend_on ?? [])) {
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
    const services = this.#registry.list();
    const serviceIds = services.map((service) => service.manifest.id);
    const remainingDependencies = new Map<string, Set<string>>();
    const dependents = new Map<string, Set<string>>();

    for (const service of services) {
      const serviceId = service.manifest.id;
      const dependencies = new Set<string>();

      for (const dependencyId of service.manifest.depend_on ?? []) {
        if (!this.#registry.getById(dependencyId)) {
          throw new Error(`Unknown service id: ${dependencyId}`);
        }

        dependencies.add(dependencyId);
        const currentDependents = dependents.get(dependencyId) ?? new Set<string>();
        currentDependents.add(serviceId);
        dependents.set(dependencyId, currentDependents);
      }

      remainingDependencies.set(serviceId, dependencies);
    }

    const ordered: string[] = [];
    const ready = this.#sortServiceIds(serviceIds.filter((serviceId) => (remainingDependencies.get(serviceId)?.size ?? 0) === 0));

    while (ready.length > 0) {
      const serviceId = ready.shift();
      if (!serviceId) {
        continue;
      }

      ordered.push(serviceId);

      for (const dependentId of this.#sortServiceIds([...(dependents.get(serviceId) ?? [])])) {
        const dependencies = remainingDependencies.get(dependentId);
        if (!dependencies) {
          continue;
        }

        dependencies.delete(serviceId);
        if (dependencies.size === 0) {
          ready.push(dependentId);
          ready.sort((left, right) => this.#compareServiceIds(left, right));
        }
      }
    }

    if (ordered.length !== serviceIds.length) {
      throw new Error("Dependency cycle detected while resolving global startup order.");
    }

    return ordered;
  }

  getGlobalShutdownOrder(): string[] {
    return [...this.getGlobalStartupOrder()].reverse();
  }

  #sortServiceIds(serviceIds: string[]): string[] {
    return [...serviceIds].sort((left, right) => this.#compareServiceIds(left, right));
  }

  #compareServiceIds(left: string, right: string): number {
    const leftOrder = this.#serviceOrder(left);
    const rightOrder = this.#serviceOrder(right);
    return leftOrder - rightOrder || left.localeCompare(right);
  }

  #serviceOrder(serviceId: string): number {
    const service = this.#registry.getById(serviceId);
    return service?.manifest.serviceorder ?? service?.manifest.execconfig?.serviceorder ?? Number.MAX_SAFE_INTEGER;
  }
}

export function createServiceRegistry(services: DiscoveredService[]): ServiceRegistry {
  return new ServiceRegistry(services);
}
