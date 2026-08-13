import type { DiscoveredService } from "../../contracts/service.js";
import { compileServiceSelectorPlan, type ServiceSelectorRef } from "../operator/variables.js";
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
  providerRequirements: ResolvedProviderRequirement[];
}

export interface ResolvedProviderRequirement {
  capability: string;
  requirement: string;
  serviceId: string;
  version: string;
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

export type EndpointCutoverArtifact =
  | "env"
  | "globalenv"
  | "commandline"
  | "args"
  | "urls"
  | "healthchecks"
  | "install"
  | "config"
  | "setup"
  | "actions";

export interface EndpointSelectorUse {
  selector: string;
  endpointId: string;
  field: string;
  artifacts: EndpointCutoverArtifact[];
}

export interface EndpointCutoverImpactedService {
  id: string;
  name: string;
  relation: "direct" | "transitive";
  depth: number;
  path: string[];
  selectorUses: EndpointSelectorUse[];
}

export interface EndpointCutoverImpact {
  providerServiceId: string;
  changedEndpointIds: string[];
  impactedServices: EndpointCutoverImpactedService[];
  restartOrder: string[];
  selectorConsumerIds: string[];
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
        this.#resolveDependencyIds(service.manifest.id).map((dependencyId) => ({
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

    const providerRequirements = this.#resolveProviderRequirements(service.manifest.id);
    const dependencies = [
      ...new Set(this.#sortServiceIds([...(service.manifest.depend_on ?? []), ...providerRequirements.map((requirement) => requirement.serviceId)])),
    ];
    const dependents = this.#registry
      .list()
      .filter((candidate) => this.#resolveDependencyIds(candidate.manifest.id).includes(serviceId))
      .map((candidate) => candidate.manifest.id)
      .sort();

    return {
      dependencies,
      dependents,
      providerRequirements,
    };
  }

  getReverseDependencies(serviceId: string): ReverseDependencyLookup {
    const target = this.#registry.getById(serviceId);
    const services = this.#registry.list();
    const visited = new Set<string>();
    const dependents: ReverseDependencyDependent[] = [];
    const queue: Array<{ id: string; path: string[] }> = services
      .filter((candidate) => this.#resolveDependencyIds(candidate.manifest.id).includes(serviceId))
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
        .filter((candidate) => this.#resolveDependencyIds(candidate.manifest.id).includes(current.id))
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
      for (const dependencyId of this.#resolveDependencyIds(currentServiceId)) {
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

      for (const dependencyId of this.#resolveDependencyIds(serviceId)) {
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

  getEndpointCutoverImpact(
    providerServiceId: string,
    changedEndpointIds: string[] = [],
  ): EndpointCutoverImpact {
    const normalizedChangedEndpointIds = [...new Set(changedEndpointIds.map((id) => id.trim()).filter(Boolean))].sort();
    const reverse = this.getReverseDependencies(providerServiceId);
    const selectorConsumers = new Map<string, EndpointSelectorUse[]>();

    for (const dependent of reverse.dependents) {
      const service = this.#registry.getById(dependent.id);
      if (!service) {
        continue;
      }

      const selectorUses = collectEndpointSelectorUses(service, normalizedChangedEndpointIds);
      if (selectorUses.length > 0) {
        selectorConsumers.set(dependent.id, selectorUses);
      }
    }

    const impactedIds = new Set(selectorConsumers.keys());
    for (const selectorConsumerId of selectorConsumers.keys()) {
      for (const downstream of this.getReverseDependencies(selectorConsumerId).dependents) {
        impactedIds.add(downstream.id);
      }
    }

    let globalStartupOrder: string[];
    try {
      globalStartupOrder = this.getGlobalStartupOrder();
    } catch (error) {
      throw new Error(
        `Dependency cycle detected while resolving endpoint cutover impact for "${providerServiceId}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const orderIndex = new Map(globalStartupOrder.map((serviceId, index) => [serviceId, index]));
    const impactedServices = reverse.dependents
      .filter((dependent) => impactedIds.has(dependent.id))
      .sort(
        (left, right) =>
          (orderIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
            (orderIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER) ||
          left.depth - right.depth ||
          left.id.localeCompare(right.id),
      )
      .map((dependent) => ({
        id: dependent.id,
        name: dependent.name,
        relation: dependent.relation,
        depth: dependent.depth,
        path: dependent.path,
        selectorUses: selectorConsumers.get(dependent.id) ?? [],
      }));

    return {
      providerServiceId,
      changedEndpointIds: normalizedChangedEndpointIds,
      impactedServices,
      restartOrder: impactedServices.map((service) => service.id),
      selectorConsumerIds: [...selectorConsumers.keys()].sort(),
    };
  }

  #sortServiceIds(serviceIds: string[]): string[] {
    return [...serviceIds].sort((left, right) => this.#compareServiceIds(left, right));
  }

  #resolveDependencyIds(serviceId: string): string[] {
    const service = this.#registry.getById(serviceId);
    if (!service) {
      throw new Error(`Unknown service id: ${serviceId}`);
    }

    const providerRequirements = this.#resolveProviderRequirements(serviceId);
    return [
      ...new Set(this.#sortServiceIds([...(service.manifest.depend_on ?? []), ...providerRequirements.map((requirement) => requirement.serviceId)])),
    ];
  }

  #resolveProviderRequirements(serviceId: string): ResolvedProviderRequirement[] {
    const service = this.#registry.getById(serviceId);
    if (!service) {
      throw new Error(`Unknown service id: ${serviceId}`);
    }

    return Object.entries(service.manifest.requires ?? {})
      .map(([rawCapability, rawRequirement]) => {
        const capability = rawCapability.trim();
        const requirement = rawRequirement.trim();
        const providers = this.#registry
          .list()
          .filter((candidate) => candidate.manifest.enabled !== false)
          .map((candidate) => ({
            serviceId: candidate.manifest.id,
            version: candidate.manifest.provides?.[capability],
          }))
          .filter((candidate): candidate is { serviceId: string; version: string } =>
            typeof candidate.version === "string" &&
            candidate.version.trim().length > 0 &&
            satisfiesCapabilityVersion(candidate.version, requirement),
          )
          .sort((left, right) => this.#compareServiceIds(left.serviceId, right.serviceId));
        const pinnedProviders = providers.filter((provider) => (service.manifest.depend_on ?? []).includes(provider.serviceId));
        const candidates = pinnedProviders.length > 0 ? pinnedProviders : providers;

        if (candidates.length === 0) {
          throw new Error(
            `No installed provider satisfies capability "${capability}" required by "${serviceId}" (${requirement}).`,
          );
        }

        if (candidates.length > 1) {
          throw new Error(
            `Ambiguous provider capability "${capability}" required by "${serviceId}": ${candidates
              .map((provider) => provider.serviceId)
              .join(", ")}. Pin one provider with depend_on or remove duplicate providers.`,
          );
        }

        return {
          capability,
          requirement,
          serviceId: candidates[0].serviceId,
          version: candidates[0].version.trim(),
        };
      })
      .sort((left, right) => left.capability.localeCompare(right.capability));
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

function serviceSelectorValuesByArtifact(service: DiscoveredService): Array<{ artifact: EndpointCutoverArtifact; values: string[] }> {
  const manifest = service.manifest;
  const healthchecks = manifest.healthchecks ?? (manifest.healthcheck ? [manifest.healthcheck] : []);
  const setupSteps = Object.values(manifest.setup?.steps ?? {});
  const actions = Object.values(manifest.actions ?? {});

  return [
    { artifact: "env", values: selectorValuesFromRecord(manifest.env) },
    { artifact: "globalenv", values: selectorValuesFromRecord(manifest.globalenv) },
    { artifact: "commandline", values: selectorValuesFromRecord(manifest.commandline) },
    { artifact: "args", values: manifest.args ?? [] },
    { artifact: "urls", values: (manifest.urls ?? []).map((entry) => entry.url) },
    {
      artifact: "healthchecks",
      values: healthchecks.flatMap((entry) => selectorValuesFromUnknown(entry)),
    },
    {
      artifact: "install",
      values: [
        ...(manifest.install?.files ?? []).flatMap((file) => [file.path, file.content]),
        ...(manifest.install?.templates ?? []).map((template) => template.target),
      ],
    },
    {
      artifact: "config",
      values: [
        ...(manifest.config?.files ?? []).flatMap((file) => [file.path, file.content]),
        ...(manifest.config?.templates ?? []).map((template) => template.target),
      ],
    },
    {
      artifact: "setup",
      values: setupSteps.flatMap((step) => [
        ...(step.args ?? []),
        ...selectorValuesFromRecord(step.commandline),
        ...selectorValuesFromRecord(step.env),
      ]),
    },
    {
      artifact: "actions",
      values: actions.flatMap((action) => [
        action.command ?? "",
        ...(action.args ?? []),
        ...selectorValuesFromRecord(action.commandline),
        ...selectorValuesFromRecord(action.env),
      ]),
    },
  ];
}

function selectorValuesFromRecord(record: Record<string, string | string[]> | undefined): string[] {
  return Object.values(record ?? {}).flatMap((value) => (Array.isArray(value) ? value : [value]));
}

function selectorValuesFromUnknown(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => selectorValuesFromUnknown(entry));
  }

  if (value && typeof value === "object") {
    return Object.values(value).flatMap((entry) => selectorValuesFromUnknown(entry));
  }

  return [];
}

function parseEndpointSelector(ref: ServiceSelectorRef): { endpointId: string; field: string } | null {
  const match = /^endpoint\.([A-Za-z][A-Za-z0-9_:-]*)\.([A-Za-z][A-Za-z0-9_-]*)$/.exec(ref.selector);
  if (!match) {
    return null;
  }

  return { endpointId: match[1], field: match[2] };
}

function collectEndpointSelectorUses(
  service: DiscoveredService,
  changedEndpointIds: string[],
): EndpointSelectorUse[] {
  const changedEndpointSet = new Set(changedEndpointIds);
  const bySelector = new Map<string, EndpointSelectorUse>();

  for (const { artifact, values } of serviceSelectorValuesByArtifact(service)) {
    const nonEmptyValues = values.filter((value) => value.trim().length > 0);
    if (nonEmptyValues.length === 0) {
      continue;
    }

    for (const ref of compileServiceSelectorPlan(nonEmptyValues).selectors) {
      const endpoint = parseEndpointSelector(ref);
      if (!endpoint || (changedEndpointSet.size > 0 && !changedEndpointSet.has(endpoint.endpointId))) {
        continue;
      }

      const current = bySelector.get(ref.selector) ?? {
        selector: ref.selector,
        endpointId: endpoint.endpointId,
        field: endpoint.field,
        artifacts: [],
      };
      if (!current.artifacts.includes(artifact)) {
        current.artifacts.push(artifact);
      }
      bySelector.set(ref.selector, current);
    }
  }

  return [...bySelector.values()].sort((left, right) => left.selector.localeCompare(right.selector));
}

export function createServiceRegistry(services: DiscoveredService[]): ServiceRegistry {
  return new ServiceRegistry(services);
}

function parseVersionParts(value: string): number[] {
  return value
    .replace(/^v/i, "")
    .split(/[.+-]/)
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part));
}

function compareVersions(left: string, right: string): number {
  const leftParts = parseVersionParts(left);
  const rightParts = parseVersionParts(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;
    if (leftPart !== rightPart) {
      return leftPart - rightPart;
    }
  }

  return 0;
}

function satisfiesCapabilityVersion(version: string, requirement: string): boolean {
  const trimmedRequirement = requirement.trim();
  if (trimmedRequirement.length === 0 || trimmedRequirement === "*") {
    return true;
  }

  const match = /^(>=|<=|>|<|=)?\s*(.+)$/.exec(trimmedRequirement);
  if (!match) {
    return false;
  }

  const operator = match[1] ?? "=";
  const requiredVersion = match[2].trim();
  const comparison = compareVersions(version.trim(), requiredVersion);

  if (operator === ">=") return comparison >= 0;
  if (operator === "<=") return comparison <= 0;
  if (operator === ">") return comparison > 0;
  if (operator === "<") return comparison < 0;
  return comparison === 0;
}
