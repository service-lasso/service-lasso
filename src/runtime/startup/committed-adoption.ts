import type { DiscoveredService } from "../../contracts/service.js";
import { adoptManagedProcess, hasManagedProcess } from "../execution/supervisor.js";
import { readRuntimeGenerationRegistry } from "../instance/registry.js";
import { getLifecycleState, setLifecycleState } from "../lifecycle/store.js";
import { buildServiceNetwork } from "../operator/network.js";
import { resolveServiceEndpoints } from "../operator/endpoints.js";
import {
  servicePortsFromEndpointAllocation,
  type RuntimeEndpointAllocationPlan,
} from "../ports/allocation.js";
import {
  classifyRegisteredProcess,
  findProcessOwnership,
  recordProcessOwnership,
} from "../process/registry.js";
import { writeServiceState } from "../state/writeState.js";

export interface CommittedServiceAdoptionOptions {
  workspaceRoot: string;
  runtimeGenerationId: string;
  runtimeInstanceId: string;
  allocationPlan: RuntimeEndpointAllocationPlan;
}

function portsAgree(left: Record<string, number>, right: Record<string, number>): boolean {
  const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

export async function rebindCommittedServiceAdoption(
  service: DiscoveredService,
  options: CommittedServiceAdoptionOptions,
): Promise<number> {
  const serviceId = service.manifest.id;
  const owner = await findProcessOwnership(options.workspaceRoot, "service", serviceId);
  if (!owner?.pid || !owner.identity || await classifyRegisteredProcess(owner) !== "owned") {
    throw new Error(`Committed service "${serviceId}" no longer has verified process ownership.`);
  }

  const alreadyRebound = owner.generationId === options.runtimeGenerationId &&
    owner.allocation.revision === options.allocationPlan.allocationId;
  if (!alreadyRebound) {
    const generations = await readRuntimeGenerationRegistry(options.allocationPlan.workspaceRoot);
    const priorGeneration = generations.generations.find((entry) => entry.generationId === owner.generationId);
    if (!priorGeneration || (priorGeneration.phase !== "superseded" && priorGeneration.phase !== "failed")) {
      throw new Error(`Committed service "${serviceId}" ownership is not from a terminal predecessor generation.`);
    }
  }

  const state = getLifecycleState(serviceId);
  const stateMatchesOwner = state.runtime.generationId === owner.generationId &&
    state.runtime.allocationRevision === owner.allocation.revision;
  const stateMatchesMaterializedTarget = state.runtime.generationId === owner.generationId &&
    state.runtime.allocationRevision === options.allocationPlan.allocationId;
  const stateMatchesTarget = state.runtime.generationId === options.runtimeGenerationId &&
    state.runtime.allocationRevision === options.allocationPlan.allocationId;
  if (
    !state.running ||
    state.runtime.pid !== owner.pid ||
    (!stateMatchesOwner && !stateMatchesMaterializedTarget && !stateMatchesTarget)
  ) {
    throw new Error(`Committed service "${serviceId}" lifecycle state does not match verified ownership.`);
  }

  const ports = servicePortsFromEndpointAllocation(options.allocationPlan)[serviceId] ?? {};
  if (!portsAgree(owner.allocation.ports, ports)) {
    throw new Error(`Committed service "${serviceId}" cannot be rebound to a different endpoint allocation.`);
  }
  const requiresAdoption = !hasManagedProcess(serviceId);
  if (requiresAdoption && (!state.runtime.startedAt || !state.runtime.command)) {
    throw new Error(`Committed service "${serviceId}" cannot be adopted without runtime launch evidence.`);
  }
  const network = buildServiceNetwork(service, {}, ports);
  await recordProcessOwnership(options.workspaceRoot, {
    ownerType: "service",
    ownerId: serviceId,
    serviceId,
    generationId: options.runtimeGenerationId,
    runtimeInstanceId: options.runtimeInstanceId,
    pid: owner.pid,
    ownerRoot: service.serviceRoot,
    allocationRevision: options.allocationPlan.allocationId,
    ports,
    endpoints: network.endpoints
      .filter((endpoint): endpoint is typeof endpoint & { url: string } => typeof endpoint.url === "string")
      .map((endpoint) => ({ name: endpoint.label, url: endpoint.url })),
    lifecycleState: "running",
    source: owner.source,
    processGroup: owner.processGroup,
    expectedPrior: {
      generationId: owner.generationId,
      allocationRevision: owner.allocation.revision,
      pid: owner.pid,
      identity: owner.identity,
    },
  });

  if (requiresAdoption) {
    await adoptManagedProcess({
      service,
      pid: owner.pid,
      startedAt: state.runtime.startedAt!,
      command: state.runtime.command!,
      workspaceRoot: options.workspaceRoot,
    });
  }

  const reboundState = setLifecycleState(serviceId, {
    ...state,
    runtime: {
      ...state.runtime,
      generationId: options.runtimeGenerationId,
      allocationRevision: options.allocationPlan.allocationId,
      ports,
      endpoints: resolveServiceEndpoints(service, ports),
    },
  });
  await writeServiceState(service, reboundState);
  const reboundOwner = await findProcessOwnership(options.workspaceRoot, "service", serviceId);
  if (
    !reboundOwner ||
    reboundOwner.generationId !== options.runtimeGenerationId ||
    reboundOwner.allocation.revision !== options.allocationPlan.allocationId ||
    await classifyRegisteredProcess(reboundOwner) !== "owned"
  ) {
    throw new Error(`Committed service "${serviceId}" rebound ownership could not be verified.`);
  }
  return owner.pid;
}
