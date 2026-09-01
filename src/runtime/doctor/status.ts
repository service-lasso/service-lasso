import path from "node:path";
import type { RuntimeConfig } from "../config.js";
import type { DependencyGraph } from "../manager/DependencyGraph.js";
import type { ServiceRegistry } from "../manager/ServiceRegistry.js";
import {
  createRuntimeInstanceSnapshot,
  getRuntimeGenerationRegistryPath,
  getRuntimeInstanceStatePath,
} from "../instance/registry.js";
import {
  classifyRegisteredProcess,
  readProcessOwnershipRegistry,
  resolveWorkspaceProcessId,
  type ProcessOwnershipEntry,
} from "../process/registry.js";
import type { ProcessIdentityClassification } from "../process/identity.js";
import {
  PROCESS_OWNERSHIP_SCHEMA_V2,
  doctorClassificationForPersistence,
  inspectWorkspaceLifecycleDocuments,
  isLifecycleStateError,
} from "../state/lifecycle-persistence.js";
import { getStartupTransactionJournalPath, readStartupTransactionJournal } from "../startup/transaction.js";
import { getRuntimeEndpointAllocationPlanPath } from "../ports/allocation.js";
import {
  readPortReservationLedger,
  type PortReservation,
} from "../ports/reservations.js";
import {
  RUNTIME_DOCTOR_CLASSIFICATIONS,
  type RuntimeDoctorClassification,
  type RuntimeDoctorRecommendedAction,
  type RuntimeDoctorResponse,
} from "../../contracts/api.js";

export { RUNTIME_DOCTOR_CLASSIFICATIONS };

/**
 * Maps a stable doctor classification to a read-only recommended action.
 * Identity mismatch and unknown ownership never recommend process termination.
 *
 * @param classification Stable doctor classification.
 * @returns Safe next action for operators and automation.
 */
export function recommendedDoctorAction(classification: RuntimeDoctorClassification): RuntimeDoctorRecommendedAction {
  switch (classification) {
    case "healthy":
      return "resume";
    case "not_running":
      return "restart";
    case "wrong_lane":
    case "ambiguous_generation":
    case "unknown_owner":
    case "identity_mismatch":
    case "preferred_port_occupied":
    case "fixed_port_conflict":
      return "request_operator_confirmation";
    case "partial_startup":
      return "roll_back";
    case "state_corrupt":
    case "migration_required":
    case "reservation_drift":
    case "configuration_drift":
      return "repair_state";
  }
}

export interface RuntimeDoctorStatusInput {
  config: RuntimeConfig;
  registry: ServiceRegistry;
  graph: DependencyGraph;
}

function normalizeEvidencePath(value: string): string {
  return path.resolve(value);
}

function mapProcessStatus(status: ProcessIdentityClassification): RuntimeDoctorClassification {
  if (status === "owned") return "healthy";
  if (status === "not_running") return "not_running";
  return status;
}

function selectClassification(candidates: RuntimeDoctorClassification[]): RuntimeDoctorClassification {
  const priority: RuntimeDoctorClassification[] = [
    "state_corrupt",
    "identity_mismatch",
    "ambiguous_generation",
    "wrong_lane",
    "fixed_port_conflict",
    "preferred_port_occupied",
    "reservation_drift",
    "configuration_drift",
    "partial_startup",
    "unknown_owner",
    "not_running",
    "migration_required",
    "healthy",
  ];

  for (const classification of priority) {
    if (candidates.includes(classification)) {
      return classification;
    }
  }

  return "healthy";
}

function summarizeReservation(reservation: PortReservation) {
  return {
    ownerId: reservation.ownerId,
    portName: reservation.portName,
    kind: reservation.kind,
    host: reservation.host,
    port: reservation.port,
    stale: reservation.stale === true,
    staleReason: reservation.staleReason ?? null,
  };
}

function findReservationConflicts(reservations: PortReservation[]) {
  const byEndpoint = new Map<string, PortReservation[]>();
  for (const reservation of reservations.filter((entry) => entry.stale !== true)) {
    const key = `${reservation.host}:${reservation.port}`;
    byEndpoint.set(key, [...(byEndpoint.get(key) ?? []), reservation]);
  }

  return [...byEndpoint.entries()]
    .filter(([, entries]) => new Set(entries.map((entry) => `${entry.kind}:${entry.ownerId}:${entry.portName}`)).size > 1)
    .map(([endpoint, entries]) => ({
      endpoint,
      owners: entries.map((entry) => ({
        ownerId: entry.ownerId,
        portName: entry.portName,
        kind: entry.kind,
      })),
    }));
}

function serviceDependencyBlockers(registry: ServiceRegistry, graph: DependencyGraph) {
  return registry.list().flatMap((service) => {
    if (service.manifest.enabled === false) {
      return [];
    }
    return graph.getServiceDependencies(service.manifest.id).dependencies
      .filter((dependencyId) => !registry.getById(dependencyId) || registry.getById(dependencyId)?.manifest.enabled === false)
      .map((dependencyId) => {
        const reason = registry.getById(dependencyId) ? "dependency_disabled" as const : "missing_dependency" as const;
        return {
          serviceId: service.manifest.id,
          dependencyId,
          reason,
        };
      });
  });
}

function summarizeProcessEntry(entry: ProcessOwnershipEntry, identityStatus: ProcessIdentityClassification) {
  return {
    ownerType: entry.ownerType,
    ownerId: entry.ownerId,
    serviceId: entry.serviceId,
    runtimeInstanceId: entry.runtimeInstanceId,
    pid: entry.pid,
    lifecycleState: entry.lifecycleState,
    identityStatus,
    allocationRevision: entry.allocation.revision,
    ports: entry.allocation.ports,
    endpoints: entry.allocation.endpoints,
    updatedAt: entry.updatedAt,
  };
}

export async function buildRuntimeDoctorStatus(input: RuntimeDoctorStatusInput): Promise<RuntimeDoctorResponse> {
  const persistenceInspections = await inspectWorkspaceLifecycleDocuments(input.config.workspaceRoot);
  let processRegistry;
  try {
    processRegistry = await readProcessOwnershipRegistry(input.config.workspaceRoot);
  } catch (error) {
    if (!isLifecycleStateError(error)) {
      throw error;
    }
    processRegistry = {
      schemaVersion: PROCESS_OWNERSHIP_SCHEMA_V2,
      version: 2,
      workspaceId: resolveWorkspaceProcessId(input.config.workspaceRoot),
      canonicalWorkspaceRoot: path.resolve(input.config.workspaceRoot),
      updatedAt: new Date(0).toISOString(),
      entries: [],
    };
  }
  const [instanceSnapshot, portLedger, startupJournal] = await Promise.all([
    createRuntimeInstanceSnapshot(input.config),
    readPortReservationLedger(input.config.workspaceRoot),
    readStartupTransactionJournal(input.config.workspaceRoot),
  ]);

  const expectedServicesRoot = path.resolve(input.config.servicesRoot);
  const expectedWorkspaceRoot = path.resolve(input.config.workspaceRoot);
  const candidateClassifications: RuntimeDoctorClassification[] = [];
  const currentInstance = instanceSnapshot.instance;

  if (!currentInstance) {
    candidateClassifications.push("not_running");
  } else {
    if (path.resolve(currentInstance.servicesRoot) !== expectedServicesRoot || path.resolve(currentInstance.workspaceRoot) !== expectedWorkspaceRoot) {
      candidateClassifications.push("wrong_lane");
    }
    if (currentInstance.status === "stale") {
      candidateClassifications.push("not_running");
    }
    if (currentInstance.status === "unknown") {
      candidateClassifications.push("ambiguous_generation");
    }
  }

  const activeCandidates = instanceSnapshot.registry.instances.filter((entry) => entry.status === "active");
  if (activeCandidates.length > 1) {
    candidateClassifications.push("ambiguous_generation");
  }

  const runtimeEntries = processRegistry.entries.filter((entry) => entry.ownerType === "runtime");
  const serviceEntries = processRegistry.entries.filter((entry) => entry.ownerType === "service");
  const runtimeOwnership = await Promise.all(
    runtimeEntries.map(async (entry) => {
      const identityStatus = await classifyRegisteredProcess(entry);
      if (entry.ownerId === currentInstance?.instanceId || entry.lifecycleState !== "stopped") {
        candidateClassifications.push(mapProcessStatus(identityStatus));
      }
      return summarizeProcessEntry(entry, identityStatus);
    }),
  );
  const serviceOwnership = await Promise.all(
    serviceEntries.map(async (entry) => {
      const identityStatus = await classifyRegisteredProcess(entry);
      if (entry.lifecycleState !== "stopped") {
        candidateClassifications.push(mapProcessStatus(identityStatus));
      }
      return summarizeProcessEntry(entry, identityStatus);
    }),
  );

  if (currentInstance && runtimeEntries.length > 0 && !runtimeEntries.some((entry) => entry.ownerId === currentInstance.instanceId)) {
    candidateClassifications.push("ambiguous_generation");
  }

  const reservationConflicts = findReservationConflicts(portLedger.reservations);
  if (reservationConflicts.length > 0) {
    candidateClassifications.push("fixed_port_conflict");
  }
  if (portLedger.reservations.some((entry) => entry.stale === true)) {
    candidateClassifications.push("reservation_drift");
  }

  const dependencyBlockers = serviceDependencyBlockers(input.registry, input.graph);
  if (dependencyBlockers.length > 0) {
    candidateClassifications.push("configuration_drift");
  }

  const resumablePhases = new Set(["preflight_reconciliation", "allocation_reserved", "configuration_materialized"]);
  let transactionRecovery: "resume" | "roll_back" | "none" = "none";
  if (startupJournal?.status === "active") {
    candidateClassifications.push("partial_startup");
    transactionRecovery = resumablePhases.has(startupJournal.phase) ? "resume" : "roll_back";
  } else if (startupJournal?.status === "blocked") {
    candidateClassifications.push("partial_startup");
    transactionRecovery = "roll_back";
  }

  const persistenceClassification = doctorClassificationForPersistence(persistenceInspections);
  if (persistenceClassification) {
    candidateClassifications.push(persistenceClassification);
  }

  const classification = selectClassification(candidateClassifications);
  let action = recommendedDoctorAction(classification);
  if (classification === "partial_startup" && transactionRecovery === "resume") {
    action = "resume";
  }
  return {
    doctor: {
      contractVersion: "service-lasso.runtime-doctor.v1",
      generatedAt: new Date().toISOString(),
      classification,
      recommendedAction: action,
      readOnly: true,
      evidencePaths: {
        runtimeInstanceState: normalizeEvidencePath(getRuntimeInstanceStatePath(input.config.workspaceRoot)),
        processRegistry: normalizeEvidencePath(path.join(input.config.workspaceRoot, ".service-lasso", "processes.json")),
        generationRegistry: normalizeEvidencePath(getRuntimeGenerationRegistryPath(input.config.workspaceRoot)),
        startupTransaction: normalizeEvidencePath(getStartupTransactionJournalPath(input.config.workspaceRoot)),
        endpointAllocation: normalizeEvidencePath(getRuntimeEndpointAllocationPlanPath(input.config.workspaceRoot)),
        portReservations: normalizeEvidencePath(path.join(input.config.workspaceRoot, "runtime", "port-reservations.json")),
      },
      persistence: persistenceInspections.map((entry) => ({
        kind: entry.kind,
        classification: entry.classification,
        schemaVersion: entry.schemaVersion,
        safePath: normalizeEvidencePath(entry.safePath),
        recoveredFromBackup: entry.recoveredFromBackup,
      })),
      runtime: {
        expected: {
          servicesRoot: expectedServicesRoot,
          workspaceRoot: expectedWorkspaceRoot,
        },
        selectedInstanceId: currentInstance?.instanceId ?? null,
        selectedGenerationStatus: currentInstance?.status ?? "stale",
        selectedGenerationReason: currentInstance?.statusReason ?? currentInstance?.staleReason ?? null,
        candidates: instanceSnapshot.registry.instances.map((entry) => ({
          instanceId: entry.instanceId,
          status: entry.status,
          statusReason: entry.statusReason ?? entry.staleReason ?? null,
          servicesRoot: entry.servicesRoot,
          workspaceRoot: entry.workspaceRoot,
          pid: entry.pid,
          apiUrl: entry.apiUrl,
          generationId: (entry as { generationId?: string }).generationId ?? null,
        })),
      },
      ownership: {
        runtime: runtimeOwnership,
        services: serviceOwnership,
      },
      endpoints: {
        reservations: portLedger.reservations.map(summarizeReservation),
        conflicts: reservationConflicts,
      },
      dependencies: {
        blockers: dependencyBlockers,
      },
      startupTransaction: {
        status: startupJournal?.status ?? null,
        phase: startupJournal?.phase ?? null,
        recoveryOption: transactionRecovery,
      },
    },
  };
}
