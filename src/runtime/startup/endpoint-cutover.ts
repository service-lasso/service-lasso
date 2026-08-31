import { createHash } from "node:crypto";
import type { DiscoveredService } from "../../contracts/service.js";
import { runServiceAction } from "../actions/runs.js";
import { configService, restartService } from "../lifecycle/actions.js";
import { getLifecycleState, setLifecycleState } from "../lifecycle/store.js";
import {
  DependencyGraph,
  type EndpointCutoverImpact,
  type EndpointCutoverImpactedService,
} from "../manager/DependencyGraph.js";
import type { ServiceRegistry } from "../manager/ServiceRegistry.js";
import { resolveServiceEndpoints } from "../operator/endpoints.js";
import {
  servicePortsFromEndpointAllocation,
  type RuntimeEndpointAllocationPlan,
  type RuntimeResolvedEndpointAllocation,
} from "../ports/allocation.js";
import { writeServiceState } from "../state/writeState.js";
import {
  createStartupMaterializationHooks,
} from "./materialization.js";
import {
  advanceStartupTransaction,
  type StartupTransactionJournal,
} from "./transaction.js";

export type EndpointCutoverAction = "rematerialize" | "reload" | "restart";
export type EndpointCutoverStatus = "applied" | "noop";

export interface EndpointCutoverChangedOwner {
  ownerId: string;
  endpointIds: string[];
}

export interface EndpointCutoverPlan {
  previousAllocationRevision: string | null;
  nextAllocationRevision: string;
  changedOwners: EndpointCutoverChangedOwner[];
  impactedServices: EndpointCutoverImpactedService[];
  cutoverOrder: string[];
  selectorConsumerIds: string[];
  allocationDigest: string;
}

export interface EndpointCutoverResult {
  status: EndpointCutoverStatus;
  previousAllocationRevision: string | null;
  nextAllocationRevision: string;
  allocationDigest: string;
  configDigest: string;
  rematerializedServiceIds: string[];
  reloadedServiceIds: string[];
  restartedServiceIds: string[];
}

export interface EndpointCutoverOperations {
  rematerialize(
    service: DiscoveredService,
    plannedPorts: Record<string, number>,
    allocationRevision: string,
  ): Promise<void>;
  reload(service: DiscoveredService): Promise<void>;
  restart(
    service: DiscoveredService,
    plannedPorts: Record<string, number>,
    allocationRevision: string,
  ): Promise<void>;
}

export interface EndpointCutoverTestHooks {
  beforePlan?: (plan: EndpointCutoverPlan) => Promise<void>;
  beforeService?: (serviceId: string, previousAllocationRevision: string | null) => Promise<void>;
  afterService?: (serviceId: string, nextAllocationRevision: string) => Promise<void>;
}

export interface ExecuteEndpointCutoverOptions {
  graph: DependencyGraph;
  registry: ServiceRegistry;
  services: DiscoveredService[];
  workspaceRoot: string;
  allocationPlan: RuntimeEndpointAllocationPlan;
  transaction?: { journal: StartupTransactionJournal };
  operations?: Partial<EndpointCutoverOperations>;
  testHooks?: EndpointCutoverTestHooks;
}

/**
 * Snapshot each service's currently materialised ports so a later allocation
 * revision can be compared without reading endpoint values from APIs.
 */
export function snapshotLifecyclePortsByService(serviceIds: string[]): Record<string, Record<string, number>> {
  const portsByService: Record<string, Record<string, number>> = {};
  for (const serviceId of serviceIds) {
    const ports = getLifecycleState(serviceId).runtime.ports;
    if (Object.keys(ports).length === 0) {
      continue;
    }
    portsByService[serviceId] = { ...ports };
  }
  return portsByService;
}

/**
 * Snapshot the first durable allocation revision still attached to lifecycle
 * state so cutover can keep the outgoing and incoming revisions distinct.
 */
export function snapshotLifecycleAllocationRevision(serviceIds: string[]): string | null {
  for (const serviceId of serviceIds) {
    const revision = getLifecycleState(serviceId).runtime.allocationRevision;
    if (revision) {
      return revision;
    }
  }
  return null;
}

/**
 * Publish a metadata-only digest of an allocation plan. Owner/id/resolution
 * identity is hashed; bind hosts, ports, and URLs stay out of the digest
 * payload that callers may log or return.
 */
export function allocationPlanDigest(plan: RuntimeEndpointAllocationPlan): string {
  const endpoints = plan.endpoints
    .map((endpoint) => ({
      ownerType: endpoint.ownerType,
      ownerId: endpoint.ownerId,
      endpointId: endpoint.endpointId,
      resolution: endpoint.resolution,
    }))
    .sort((left, right) =>
      left.ownerType.localeCompare(right.ownerType) ||
      left.ownerId.localeCompare(right.ownerId) ||
      left.endpointId.localeCompare(right.endpointId),
    );
  return sha256Json({
    allocationId: plan.allocationId,
    generationId: plan.generationId,
    attempt: plan.attempt,
    phase: plan.phase,
    endpoints,
  });
}

/**
 * Build `endpoint.<id>.<field>` overlay values from one allocation revision.
 * A consumer's own allocated endpoints win; remaining ids are filled from
 * declared dependency owners in the same plan.
 */
export function consumerEndpointSelectorValues(
  plan: RuntimeEndpointAllocationPlan,
  consumerServiceId: string,
  dependencyIds: string[],
): Record<string, string> {
  const values: Record<string, string> = {};
  const dependencySet = new Set(dependencyIds);
  const byEndpointId = new Map<string, RuntimeResolvedEndpointAllocation[]>();
  for (const endpoint of plan.endpoints) {
    if (endpoint.ownerType !== "service") {
      continue;
    }
    const current = byEndpointId.get(endpoint.endpointId) ?? [];
    current.push(endpoint);
    byEndpointId.set(endpoint.endpointId, current);
  }

  for (const [endpointId, endpoints] of [...byEndpointId.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const owned = endpoints.find((entry) => entry.ownerId === consumerServiceId);
    const fromDependency = endpoints.find((entry) => dependencySet.has(entry.ownerId));
    const selected = owned ?? fromDependency;
    if (!selected) {
      continue;
    }
    values[`endpoint.${endpointId}.bind`] = selected.selectors.bind;
    values[`endpoint.${endpointId}.host`] = selected.selectors.host;
    values[`endpoint.${endpointId}.port`] = String(selected.selectors.port);
    values[`endpoint.${endpointId}.url`] = selected.selectors.url;
  }

  return values;
}

/**
 * Compare previous lifecycle ports with a reserved allocation and return the
 * owners whose resolved endpoint identities changed.
 */
export function changedServiceEndpoints(
  previousPortsByService: Record<string, Record<string, number>>,
  nextPlan: RuntimeEndpointAllocationPlan,
): EndpointCutoverChangedOwner[] {
  const nextPorts = servicePortsFromEndpointAllocation(nextPlan);
  const ownerIds = uniqueSorted([
    ...Object.keys(previousPortsByService),
    ...Object.keys(nextPorts),
  ]);
  const changed: EndpointCutoverChangedOwner[] = [];
  for (const ownerId of ownerIds) {
    const previous = previousPortsByService[ownerId] ?? {};
    const next = nextPorts[ownerId] ?? {};
    const endpointIds = uniqueSorted([...Object.keys(previous), ...Object.keys(next)])
      .filter((endpointId) => previous[endpointId] !== next[endpointId]);
    if (endpointIds.length === 0) {
      continue;
    }
    changed.push({ ownerId, endpointIds });
  }
  return changed;
}

/**
 * Derive the minimal rematerialise/reload/restart set for a new allocation
 * revision. Cycle detection runs inside the existing impact planner and
 * throws before any lifecycle mutation.
 */
export function planEndpointCutover(
  graph: DependencyGraph,
  previousPortsByService: Record<string, Record<string, number>>,
  nextPlan: RuntimeEndpointAllocationPlan,
  previousAllocationRevision: string | null,
): EndpointCutoverPlan {
  const changedOwners = changedServiceEndpoints(previousPortsByService, nextPlan);
  const impacts: EndpointCutoverImpact[] = changedOwners.map((owner) =>
    graph.getEndpointCutoverImpact(owner.ownerId, owner.endpointIds),
  );
  const impactedServices = mergeImpactedServices(graph, impacts);
  const selectorConsumerIds = uniqueSorted(impacts.flatMap((impact) => impact.selectorConsumerIds));
  const startupOrder = graph.getGlobalStartupOrder();
  const orderIndex = new Map(startupOrder.map((serviceId, index) => [serviceId, index]));
  const cutoverOrder = [...new Set([
    ...changedOwners.map((owner) => owner.ownerId),
    ...impactedServices.map((service) => service.id),
  ])].sort((left, right) =>
    (orderIndex.get(left) ?? Number.MAX_SAFE_INTEGER) - (orderIndex.get(right) ?? Number.MAX_SAFE_INTEGER) ||
    left.localeCompare(right),
  );

  return {
    previousAllocationRevision,
    nextAllocationRevision: nextPlan.allocationId,
    changedOwners,
    impactedServices,
    cutoverOrder,
    selectorConsumerIds,
    allocationDigest: allocationPlanDigest(nextPlan),
  };
}

/**
 * Rematerialise impacted consumers from one allocation revision, then reload
 * or restart running services in provider-before-consumer order. Failure
 * throws so the enclosing startup transaction can compensate; this function
 * does not invent a parallel rollback path.
 */
export async function executeEndpointCutover(
  options: ExecuteEndpointCutoverOptions,
): Promise<EndpointCutoverResult> {
  assertTestHooksAllowed(options.testHooks);
  const serviceIds = options.services.map((service) => service.manifest.id);
  const previousPortsByService = snapshotLifecyclePortsByService(serviceIds);
  const previousAllocationRevision = snapshotLifecycleAllocationRevision(serviceIds);
  const plan = planEndpointCutover(
    options.graph,
    previousPortsByService,
    options.allocationPlan,
    previousAllocationRevision,
  );
  await options.testHooks?.beforePlan?.(plan);

  const plannedPortsByService = servicePortsFromEndpointAllocation(options.allocationPlan);
  assertPinnedRunningServices(options.services, plannedPortsByService);

  if (plan.cutoverOrder.length === 0) {
    await stampRemainingServices(options.services, plannedPortsByService, options.allocationPlan.allocationId, new Set());
    return emptyResult(plan, previousAllocationRevision);
  }

  if (options.transaction) {
    options.transaction.journal = await advanceStartupTransaction(
      options.transaction.journal,
      options.transaction.journal.phase,
      {
        completedActions: [
          `endpoint_cutover_planned:${plan.allocationDigest}`,
          `endpoint_cutover_revision:${plan.previousAllocationRevision ?? "none"}:${plan.nextAllocationRevision}`,
        ],
      },
    );
  }

  const operations = createOperations(options);
  const rematerializedServiceIds: string[] = [];
  const reloadedServiceIds: string[] = [];
  const restartedServiceIds: string[] = [];
  const processed = new Set<string>();

  for (const serviceId of plan.cutoverOrder) {
    const service = options.registry.getById(serviceId);
    if (!service) {
      continue;
    }
    const current = getLifecycleState(serviceId);
    if (!current.installed || !current.configured) {
      const plannedPorts = plannedPortsByService[serviceId];
      if (plannedPorts) {
        await stampAllocationRevision(service, plannedPorts, options.allocationPlan.allocationId);
        processed.add(serviceId);
      }
      continue;
    }

    const previousRevision = current.runtime.allocationRevision;
    await options.testHooks?.beforeService?.(serviceId, previousRevision);
    const plannedPorts = plannedPortsByService[serviceId] ?? current.runtime.ports;
    await operations.rematerialize(service, plannedPorts, options.allocationPlan.allocationId);
    rematerializedServiceIds.push(serviceId);
    processed.add(serviceId);

    const running = getLifecycleState(serviceId).running;
    if (running && service.manifest.actions?.reload) {
      await operations.reload(service);
      reloadedServiceIds.push(serviceId);
    } else if (running) {
      await operations.restart(service, plannedPorts, options.allocationPlan.allocationId);
      restartedServiceIds.push(serviceId);
    }

    if (options.transaction) {
      options.transaction.journal = await advanceStartupTransaction(
        options.transaction.journal,
        options.transaction.journal.phase,
        { completedActions: [`endpoint_cutover_service:${serviceId}`] },
      );
    }
    await options.testHooks?.afterService?.(serviceId, options.allocationPlan.allocationId);
  }

  await stampRemainingServices(
    options.services,
    plannedPortsByService,
    options.allocationPlan.allocationId,
    processed,
  );

  return {
    status: "applied",
    previousAllocationRevision,
    nextAllocationRevision: plan.nextAllocationRevision,
    allocationDigest: plan.allocationDigest,
    configDigest: configDigestFromResult(plan.allocationDigest, rematerializedServiceIds),
    rematerializedServiceIds,
    reloadedServiceIds,
    restartedServiceIds,
  };
}

function createOperations(options: ExecuteEndpointCutoverOptions): EndpointCutoverOperations {
  return {
    rematerialize: options.operations?.rematerialize ?? (async (service, plannedPorts, allocationRevision) => {
      const overlay = consumerEndpointSelectorValues(
        options.allocationPlan,
        service.manifest.id,
        options.graph.getServiceDependencies(service.manifest.id).dependencies,
      );
      const configured = await configService(service, options.registry, {
        workspaceRoot: options.workspaceRoot,
        plannedPorts,
        plannedPortsByService: servicePortsFromEndpointAllocation(options.allocationPlan),
        allocationRevision,
        variableResolution: { endpointSelectorValues: overlay },
        materializationHooks: options.transaction
          ? createStartupMaterializationHooks({
              transaction: options.transaction,
              service,
              kind: "config",
            })
          : undefined,
      });
      await writeServiceState(service, configured.state);
    }),
    reload: options.operations?.reload ?? (async (service) => {
      const overlay = consumerEndpointSelectorValues(
        options.allocationPlan,
        service.manifest.id,
        options.graph.getServiceDependencies(service.manifest.id).dependencies,
      );
      const reload = await runServiceAction(
        service,
        options.registry,
        "reload",
        { source: "manual", actor: "runtime", confirm: true },
        {
          workspaceRoot: options.workspaceRoot,
          plannedPorts: servicePortsFromEndpointAllocation(options.allocationPlan)[service.manifest.id],
          plannedPortsByService: servicePortsFromEndpointAllocation(options.allocationPlan),
          allocationRevision: options.allocationPlan.allocationId,
          variableResolution: { endpointSelectorValues: overlay },
        },
      );
      if (!reload.ok) {
        throw new Error(`Endpoint cutover reload failed for "${service.manifest.id}".`);
      }
      const current = getLifecycleState(service.manifest.id);
      const next = setLifecycleState(service.manifest.id, {
        ...current,
        lastAction: "reload",
        actionHistory: [...current.actionHistory, "reload"],
      });
      await writeServiceState(service, next);
    }),
    restart: options.operations?.restart ?? (async (service, plannedPorts, allocationRevision) => {
      const overlay = consumerEndpointSelectorValues(
        options.allocationPlan,
        service.manifest.id,
        options.graph.getServiceDependencies(service.manifest.id).dependencies,
      );
      const restarted = await restartService(service, options.registry, {
        workspaceRoot: options.workspaceRoot,
        plannedPorts,
        plannedPortsByService: servicePortsFromEndpointAllocation(options.allocationPlan),
        allocationRevision,
        variableResolution: { endpointSelectorValues: overlay },
      });
      await writeServiceState(service, restarted.state);
      if (!restarted.ok) {
        throw new Error(`Endpoint cutover restart failed for "${service.manifest.id}".`);
      }
    }),
  };
}

function assertPinnedRunningServices(
  services: DiscoveredService[],
  plannedPortsByService: Record<string, Record<string, number>>,
): void {
  for (const service of services) {
    const plannedPorts = plannedPortsByService[service.manifest.id];
    if (!plannedPorts) {
      continue;
    }
    const current = getLifecycleState(service.manifest.id);
    if (current.running && !portsMatch(current.runtime.ports, plannedPorts)) {
      throw new Error(
        `Running service "${service.manifest.id}" allocation changed instead of remaining pinned.`,
      );
    }
  }
}

async function stampRemainingServices(
  services: DiscoveredService[],
  plannedPortsByService: Record<string, Record<string, number>>,
  allocationRevision: string,
  processed: ReadonlySet<string>,
): Promise<void> {
  for (const service of services) {
    if (processed.has(service.manifest.id)) {
      continue;
    }
    const plannedPorts = plannedPortsByService[service.manifest.id];
    if (!plannedPorts) {
      continue;
    }
    const current = getLifecycleState(service.manifest.id);
    if (!current.installed && !current.configured && !current.running) {
      continue;
    }
    await stampAllocationRevision(service, plannedPorts, allocationRevision);
  }
}

async function stampAllocationRevision(
  service: DiscoveredService,
  plannedPorts: Record<string, number>,
  allocationRevision: string,
): Promise<void> {
  const current = getLifecycleState(service.manifest.id);
  const next = setLifecycleState(service.manifest.id, {
    ...current,
    runtime: {
      ...current.runtime,
      allocationRevision,
      ports: { ...plannedPorts },
      endpoints: resolveServiceEndpoints(service, plannedPorts),
    },
  });
  await writeServiceState(service, next);
}

function mergeImpactedServices(
  graph: DependencyGraph,
  impacts: EndpointCutoverImpact[],
): EndpointCutoverImpactedService[] {
  const byId = new Map<string, EndpointCutoverImpactedService>();
  for (const impact of impacts) {
    for (const service of impact.impactedServices) {
      const current = byId.get(service.id);
      if (!current) {
        byId.set(service.id, {
          ...service,
          selectorUses: [...service.selectorUses],
        });
        continue;
      }
      const selectorUses = [...current.selectorUses];
      for (const use of service.selectorUses) {
        if (!selectorUses.some((entry) => entry.selector === use.selector)) {
          selectorUses.push(use);
        }
      }
      const closer = current.depth <= service.depth;
      byId.set(service.id, {
        id: current.id,
        name: current.name,
        relation: closer ? current.relation : service.relation,
        depth: Math.min(current.depth, service.depth),
        path: closer ? current.path : service.path,
        selectorUses: selectorUses.sort((left, right) => left.selector.localeCompare(right.selector)),
      });
    }
  }
  const orderIndex = new Map(graph.getGlobalStartupOrder().map((serviceId, index) => [serviceId, index]));
  return [...byId.values()].sort(
    (left, right) =>
      (orderIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (orderIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER) ||
      left.id.localeCompare(right.id),
  );
}

function emptyResult(
  plan: EndpointCutoverPlan,
  previousAllocationRevision: string | null,
): EndpointCutoverResult {
  return {
    status: "noop",
    previousAllocationRevision,
    nextAllocationRevision: plan.nextAllocationRevision,
    allocationDigest: plan.allocationDigest,
    configDigest: configDigestFromResult(plan.allocationDigest, []),
    rematerializedServiceIds: [],
    reloadedServiceIds: [],
    restartedServiceIds: [],
  };
}

function configDigestFromResult(allocationDigest: string, rematerializedServiceIds: string[]): string {
  return sha256Json({
    allocationDigest,
    rematerializedServiceIds: [...rematerializedServiceIds].sort((left, right) => left.localeCompare(right)),
  });
}

function portsMatch(left: Record<string, number>, right: Record<string, number>): boolean {
  const leftEntries = Object.entries(left).sort(([leftName], [rightName]) => leftName.localeCompare(rightName));
  const rightEntries = Object.entries(right).sort(([leftName], [rightName]) => leftName.localeCompare(rightName));
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function sha256Json(value: unknown): string {
  return createHash("sha256").update(`${JSON.stringify(value)}\n`).digest("hex");
}

function assertTestHooksAllowed(testHooks: EndpointCutoverTestHooks | undefined): void {
  if (!testHooks) {
    return;
  }
  if (process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS !== "1") {
    throw new Error("Endpoint cutover test hooks require SERVICE_LASSO_ENABLE_TEST_HOOKS=1.");
  }
}
