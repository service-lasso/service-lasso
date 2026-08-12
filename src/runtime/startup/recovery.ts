import path from "node:path";
import type { DiscoveredService } from "../../contracts/service.js";
import type { RuntimeGenerationRecord, RuntimeInstanceRecord } from "../../contracts/api.js";
import type { RuntimeConfig } from "../config.js";
import {
  readRuntimeGenerationRegistry,
  readRuntimeInstanceRegistry,
  readRuntimeInstanceState,
  resolveRuntimeInstanceId,
} from "../instance/registry.js";
import {
  inspectRuntimeEndpointAllocationRecovery,
  readRuntimeEndpointAllocationPlan,
  type RuntimeEndpointAllocationPlan,
  type RuntimeEndpointAllocationRecoveryInspection,
} from "../ports/allocation.js";
import { classifyRegisteredProcess, findProcessOwnership } from "../process/registry.js";
import { inspectProcess, type ProcessIdentityClassification } from "../process/identity.js";
import { readStoredState } from "../state/readState.js";
import {
  inspectStartupMaterializations,
  type StartupMaterializationInspection,
} from "./materialization.js";
import { readStartupTransactionJournal, type StartupTransactionJournal } from "./transaction.js";

export type StartupRecoveryClassification = "none" | "resume" | "rollback" | "blocked" | "commit_cleanup";

export interface StartupServiceRecoveryEvidence {
  serviceId: string;
  ownership: ProcessIdentityClassification | "missing" | "mismatch";
  reason: string;
}

export interface StartupRecoveryInspection {
  classification: StartupRecoveryClassification;
  reason: string;
  journal: StartupTransactionJournal | null;
  generation: RuntimeGenerationRecord | null;
  workspaceInstance: RuntimeInstanceRecord | null;
  hostInstance: RuntimeInstanceRecord | null;
  runtimeOwnership: ProcessIdentityClassification | "missing" | "mismatch";
  allocationPlan: RuntimeEndpointAllocationPlan | null;
  allocation: RuntimeEndpointAllocationRecoveryInspection | null;
  materialization: StartupMaterializationInspection | null;
  services: StartupServiceRecoveryEvidence[];
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => {
    const resolved = path.resolve(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function instanceMatchesJournal(record: RuntimeInstanceRecord, journal: StartupTransactionJournal): boolean {
  return record.instanceId === journal.instanceId &&
    record.generationId === journal.generationId &&
    samePath(record.servicesRoot, journal.servicesRoot) &&
    samePath(record.workspaceRoot, journal.workspaceRoot);
}

function instancesAgree(left: RuntimeInstanceRecord, right: RuntimeInstanceRecord): boolean {
  return left.instanceId === right.instanceId &&
    left.generationId === right.generationId &&
    samePath(left.servicesRoot, right.servicesRoot) &&
    samePath(left.workspaceRoot, right.workspaceRoot) &&
    samePath(left.runtimeRoot, right.runtimeRoot) &&
    left.pid === right.pid &&
    left.apiPort === right.apiPort &&
    left.apiUrl === right.apiUrl;
}

function result(
  classification: StartupRecoveryClassification,
  reason: string,
  evidence: Omit<StartupRecoveryInspection, "classification" | "reason">,
): StartupRecoveryInspection {
  return { classification, reason, ...evidence };
}

export async function inspectStartupRecovery(
  config: RuntimeConfig,
  discovered: DiscoveredService[],
): Promise<StartupRecoveryInspection> {
  const journal = await readStartupTransactionJournal(config.workspaceRoot);
  const emptyEvidence = {
    journal,
    generation: null,
    workspaceInstance: null,
    hostInstance: null,
    runtimeOwnership: "missing" as const,
    allocationPlan: null,
    allocation: null,
    materialization: null,
    services: [],
  };
  if (!journal || (journal.status !== "active" && journal.status !== "blocked")) {
    return result("none", "no_interrupted_transaction", emptyEvidence);
  }
  if (
    !samePath(journal.servicesRoot, config.servicesRoot) ||
    !samePath(journal.workspaceRoot, config.workspaceRoot) ||
    journal.instanceId !== resolveRuntimeInstanceId(config)
  ) {
    return result("blocked", "journal_lane_mismatch", emptyEvidence);
  }
  const materialization = await inspectStartupMaterializations(journal);
  const materializationEvidence = { ...emptyEvidence, materialization };
  if (materialization.status === "blocked") {
    return result("blocked", materialization.reason, materializationEvidence);
  }

  const [workspaceInstance, hostRegistry] = await Promise.all([
    readRuntimeInstanceState(config),
    readRuntimeInstanceRegistry(),
  ]);
  const laneHostInstances = hostRegistry.instances.filter((entry) =>
    entry.instanceId === journal.instanceId &&
    samePath(entry.servicesRoot, config.servicesRoot) &&
    samePath(entry.workspaceRoot, config.workspaceRoot),
  );
  const hostInstances = laneHostInstances.filter((entry) => entry.generationId === journal.generationId);
  const instanceEvidence = {
    ...materializationEvidence,
    workspaceInstance,
    hostInstance: hostInstances.length === 1 ? hostInstances[0] : null,
  };
  if (laneHostInstances.some((entry) =>
    entry.generationId !== journal.generationId && (entry.status === "active" || entry.status === "unknown")
  )) {
    return result("blocked", "host_runtime_instance_generation_conflict", instanceEvidence);
  }
  if (
    workspaceInstance &&
    !instanceMatchesJournal(workspaceInstance, journal) &&
    (workspaceInstance.status === "active" || workspaceInstance.status === "unknown")
  ) {
    return result("blocked", "workspace_runtime_instance_generation_conflict", instanceEvidence);
  }

  const generations = await readRuntimeGenerationRegistry(config.workspaceRoot);
  const generation = generations.generations.find((entry) => entry.generationId === journal.generationId) ?? null;
  const baseEvidence = { ...instanceEvidence, generation };
  if (!generation && !journal.completedActions.includes("generation_started")) {
    return result("rollback", "preflight_interrupted_before_generation", baseEvidence);
  }
  const failedGenerationRollback = Boolean(
    generation &&
    journal.status === "blocked" &&
    generations.activeGenerationId === null &&
    generation.phase === "failed",
  );
  if (
    !generation ||
    (generations.activeGenerationId !== journal.generationId && !failedGenerationRollback) ||
    generation.instanceId !== journal.instanceId ||
    !samePath(generation.servicesRoot, config.servicesRoot) ||
    !samePath(generation.workspaceRoot, config.workspaceRoot)
  ) {
    return result("blocked", "generation_authority_mismatch", baseEvidence);
  }

  const runtimeOwner = await findProcessOwnership(config.workspaceRoot, "runtime", journal.instanceId);
  const runtimeOwnership: StartupRecoveryInspection["runtimeOwnership"] = runtimeOwner
    ? runtimeOwner.generationId === journal.generationId
      ? await classifyRegisteredProcess(runtimeOwner)
      : "mismatch"
    : "missing";
  const runtimeEvidence = { ...baseEvidence, runtimeOwnership };
  if (runtimeOwnership === "owned") {
    return result("blocked", "runtime_owner_still_running", runtimeEvidence);
  }
  if (runtimeOwnership === "unknown_owner" || runtimeOwnership === "mismatch") {
    return result("blocked", "runtime_owner_unverifiable_or_mismatched", runtimeEvidence);
  }
  if (!runtimeOwner && !failedGenerationRollback) {
    const generationProcess = await inspectProcess(generation.pid);
    if (generationProcess.status !== "not_running") {
      return result("blocked", "generation_process_unverifiable_without_runtime_ownership", runtimeEvidence);
    }
  }

  if (materialization.status === "commit_cleanup") {
    if (journal.status === "blocked" && journal.failureCode !== "materialization_commit_cleanup_failed") {
      return result("blocked", "committed_transaction_blocked_for_unrelated_failure", runtimeEvidence);
    }
    if (generation.phase !== "running") {
      return result("blocked", "committed_generation_not_running", runtimeEvidence);
    }
    let allocationPlan: RuntimeEndpointAllocationPlan | null = null;
    let allocation: RuntimeEndpointAllocationRecoveryInspection | null = null;
    if (journal.allocationRevision) {
      allocationPlan = await readRuntimeEndpointAllocationPlan(config.workspaceRoot);
      if (
        !allocationPlan || allocationPlan.allocationId !== journal.allocationRevision ||
        allocationPlan.generationId !== journal.generationId || allocationPlan.laneId !== journal.instanceId ||
        !samePath(allocationPlan.servicesRoot, config.servicesRoot) ||
        !samePath(allocationPlan.workspaceRoot, config.workspaceRoot)
      ) {
        return result("blocked", "committed_allocation_plan_missing_or_mismatched", {
          ...runtimeEvidence,
          allocationPlan,
          allocation,
        });
      }
      allocation = await inspectRuntimeEndpointAllocationRecovery(allocationPlan);
    }
    const expectsRuntimeInstance = journal.completedActions.includes("runtime_instance_registered") ||
      journal.pendingCompensations.includes("stop_runtime_instance");
    const exactWorkspaceInstance = workspaceInstance && instanceMatchesJournal(workspaceInstance, journal)
      ? workspaceInstance
      : null;
    const exactHostInstance = hostInstances.length === 1 ? hostInstances[0] : null;
    if (expectsRuntimeInstance || exactWorkspaceInstance || hostInstances.length > 0) {
      const committedEvidence = {
        ...runtimeEvidence,
        workspaceInstance,
        hostInstance: exactHostInstance,
        allocationPlan,
        allocation,
      };
      if (!exactWorkspaceInstance || !exactHostInstance || hostInstances.length !== 1) {
        return result("blocked", "committed_runtime_instance_workspace_host_mismatch", committedEvidence);
      }
      if (!instancesAgree(exactWorkspaceInstance, exactHostInstance)) {
        return result("blocked", "committed_runtime_instance_records_disagree", committedEvidence);
      }
      const runtimeEndpoint = allocationPlan?.endpoints.find((endpoint) =>
        endpoint.ownerType === "runtime" && endpoint.ownerId === "runtime-api",
      );
      if (!runtimeEndpoint || runtimeEndpoint.port !== exactWorkspaceInstance.apiPort) {
        return result("blocked", "committed_runtime_instance_allocation_mismatch", committedEvidence);
      }
    }
    return result("commit_cleanup", "generation_committed_cleanup_only", {
      ...runtimeEvidence,
      allocationPlan,
      allocation,
    });
  }

  let allocationPlan: RuntimeEndpointAllocationPlan | null = null;
  let allocation: RuntimeEndpointAllocationRecoveryInspection | null = null;
  if (journal.allocationRevision) {
    allocationPlan = await readRuntimeEndpointAllocationPlan(config.workspaceRoot);
    if (
      !allocationPlan ||
      allocationPlan.allocationId !== journal.allocationRevision ||
      allocationPlan.generationId !== journal.generationId ||
      allocationPlan.laneId !== journal.instanceId ||
      !samePath(allocationPlan.servicesRoot, config.servicesRoot) ||
      !samePath(allocationPlan.workspaceRoot, config.workspaceRoot)
    ) {
      return result("blocked", "allocation_plan_missing_or_mismatched", {
        ...runtimeEvidence,
        allocationPlan,
        allocation,
      });
    }
    allocation = await inspectRuntimeEndpointAllocationRecovery(allocationPlan);
    if (allocation.status === "active_owner" || allocation.status === "unknown_owner" || allocation.status === "mismatch") {
      return result("blocked", allocation.reason, {
        ...runtimeEvidence,
        allocationPlan,
        allocation,
      });
    }
    if (allocation.status !== "recoverable") {
      return result("rollback", allocation.reason, {
        ...runtimeEvidence,
        allocationPlan,
        allocation,
      });
    }
  }


  const expectsRuntimeInstance = journal.completedActions.includes("runtime_instance_registered") ||
    journal.pendingCompensations.includes("stop_runtime_instance");
  const exactWorkspaceInstance = workspaceInstance && instanceMatchesJournal(workspaceInstance, journal)
    ? workspaceInstance
    : null;
  const exactHostInstance = hostInstances.length === 1 ? hostInstances[0] : null;
  if (expectsRuntimeInstance || exactWorkspaceInstance || hostInstances.length > 0) {
    const instanceRecoveryEvidence = {
      ...runtimeEvidence,
      workspaceInstance,
      hostInstance: exactHostInstance,
      allocationPlan,
      allocation,
    };
    if (!exactWorkspaceInstance || !exactHostInstance || hostInstances.length !== 1) {
      return result("blocked", "runtime_instance_workspace_host_mismatch", instanceRecoveryEvidence);
    }
    if (!instancesAgree(exactWorkspaceInstance, exactHostInstance)) {
      return result("blocked", "runtime_instance_records_disagree", instanceRecoveryEvidence);
    }
    if (
      exactWorkspaceInstance.status === "active" || exactWorkspaceInstance.status === "unknown" ||
      exactHostInstance.status === "active" || exactHostInstance.status === "unknown"
    ) {
        return result("blocked", "runtime_instance_owner_active_or_unverifiable", instanceRecoveryEvidence);
      }
    if (!allocationPlan) {
      return result("blocked", "runtime_instance_allocation_missing", instanceRecoveryEvidence);
    }
    const runtimeEndpoint = allocationPlan.endpoints.find((endpoint) =>
      endpoint.ownerType === "runtime" && endpoint.ownerId === "runtime-api",
    );
    if (!runtimeEndpoint || runtimeEndpoint.port !== exactWorkspaceInstance.apiPort) {
      return result("blocked", "runtime_instance_allocation_mismatch", instanceRecoveryEvidence);
    }
  }

  const discoveredById = new Map(discovered.map((service) => [service.manifest.id, service]));
  const services: StartupServiceRecoveryEvidence[] = [];
  let requiresRollback = journal.status === "blocked" || generation.phase === "stopping" ||
    failedGenerationRollback || materialization.status === "rollback";
  for (const serviceId of journal.startedServiceIds) {
    const service = discoveredById.get(serviceId);
    if (!service) {
      services.push({ serviceId, ownership: "missing", reason: "service_not_discovered" });
      return result("blocked", "recorded_service_not_discovered", {
        ...runtimeEvidence,
        allocationPlan,
        allocation,
        services,
      });
    }
    const ownership = await findProcessOwnership(config.workspaceRoot, "service", serviceId);
    if (!ownership) {
      services.push({ serviceId, ownership: "missing", reason: "ownership_missing" });
      const storedRuntime = (await readStoredState(service.serviceRoot)).runtime;
      if (isRecord(storedRuntime) && storedRuntime.running === true) {
        return result("blocked", "recorded_service_running_without_ownership", {
          ...runtimeEvidence,
          allocationPlan,
          allocation,
          services,
        });
      }
      requiresRollback = true;
      continue;
    }
    if (
      ownership.generationId !== journal.generationId ||
      ownership.allocation.revision !== journal.allocationRevision
    ) {
      services.push({ serviceId, ownership: "mismatch", reason: "generation_or_allocation_mismatch" });
      return result("blocked", "recorded_service_ownership_mismatch", {
        ...runtimeEvidence,
        allocationPlan,
        allocation,
        services,
      });
    }
    const status = await classifyRegisteredProcess(ownership);
    services.push({ serviceId, ownership: status, reason: `process_${status}` });
    if (status === "unknown_owner") {
      return result("blocked", "recorded_service_owner_unverifiable", {
        ...runtimeEvidence,
        allocationPlan,
        allocation,
        services,
      });
    }
    if (status !== "owned") requiresRollback = true;
  }

  return result(requiresRollback ? "rollback" : "resume", requiresRollback
    ? "transaction_resources_require_rollback"
    : "transaction_evidence_agrees", {
    ...runtimeEvidence,
    allocationPlan,
    allocation,
    services,
  });
}
