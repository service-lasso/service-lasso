import type {
  DiscoveredService,
  ServiceBrokerChangeReactionMode,
  ServiceBrokerImport,
} from "../../contracts/service.js";
import { createHash } from "node:crypto";
import { DependencyGraph, createServiceRegistry } from "../manager/DependencyGraph.js";
import {
  brokerImportMatchesReference,
  buildServiceSecretReferenceAudit,
  type SecretReferenceAuditFinding,
} from "./secret-audit.js";

export type SecretRotationImpactRole = "direct" | "dependent";
export type SecretRotationImpactAction = "restart" | "reload" | "action" | "manual" | "none";

export interface SecretRotationImpactService {
  serviceId: string;
  role: SecretRotationImpactRole;
  ref: string;
  action: SecretRotationImpactAction;
  actionId?: string;
  reason: string;
  required: boolean;
  sources: SecretReferenceAuditFinding["source"][];
  locations: string[];
  dependentsOf: string[];
  blockers: string[];
}

export interface SecretRotationImpactOperation {
  serviceId: string;
  action: Exclude<SecretRotationImpactAction, "manual" | "none">;
  actionId?: string;
  reason: string;
}

export interface SecretRotationImpactPlan {
  ref: string;
  planFingerprint: string;
  status: "ready" | "blocked";
  confirmationRequired: true;
  valuePolicy: "metadata_only";
  services: SecretRotationImpactService[];
  execution: {
    stopOrder: string[];
    startOrder: string[];
    operations: SecretRotationImpactOperation[];
  };
  summary: {
    directConsumers: number;
    dependents: number;
    restart: number;
    reload: number;
    action: number;
    manual: number;
    none: number;
    blockers: number;
  };
  blockers: string[];
}

const supportedReactionModes: ServiceBrokerChangeReactionMode[] = ["restart", "reload", "action", "manual", "none"];

function uniqueSorted<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort();
}

function importForRef(service: DiscoveredService, ref: string): ServiceBrokerImport | undefined {
  return (service.manifest.broker?.imports ?? []).find((entry) => brokerImportMatchesReference(entry, ref));
}

function findingsForRef(service: DiscoveredService, ref: string): SecretReferenceAuditFinding[] {
  const selectorRefs = new Set(
    (service.manifest.broker?.imports ?? [])
      .filter((entry) => brokerImportMatchesReference(entry, ref))
      .map((entry) => entry.ref),
  );
  selectorRefs.add(ref);
  return buildServiceSecretReferenceAudit(service).findings.filter((finding) => selectorRefs.has(finding.ref));
}

function classifyDirectAction(
  service: DiscoveredService,
  brokerImport: ServiceBrokerImport | undefined,
): Pick<SecretRotationImpactService, "action" | "actionId" | "reason" | "blockers"> {
  if (!brokerImport) {
    return {
      action: "manual",
      reason: "Reference is used but not declared as a broker import for this service.",
      blockers: ["missing_broker_import_policy"],
    };
  }

  const onChange = brokerImport.onChange;
  if (!onChange) {
    return {
      action: "manual",
      reason: "No broker import onChange policy declares how this service reacts to activated secret-version changes.",
      blockers: ["missing_change_policy"],
    };
  }

  if (!supportedReactionModes.includes(onChange.mode)) {
    return {
      action: "manual",
      reason: "Broker import onChange mode is not supported by the rotation planner.",
      blockers: ["unsupported_change_policy"],
    };
  }

  if (onChange.mode === "action") {
    const actionId = onChange.actionId?.trim();
    if (!actionId) {
      return {
        action: "manual",
        reason: "Broker import onChange policy uses action mode but does not declare an actionId.",
        blockers: ["missing_change_action"],
      };
    }

    if (!service.manifest.actions?.[actionId]) {
      return {
        action: "manual",
        actionId,
        reason: "Broker import onChange policy names an action that is not declared by this service.",
        blockers: ["undeclared_change_action"],
      };
    }

    return {
      action: "action",
      actionId,
      reason: onChange.reason ?? "Run the declared service action after the secret version is activated.",
      blockers: [],
    };
  }

  if (onChange.mode === "manual") {
    return {
      action: "manual",
      reason: onChange.reason ?? "Manifest policy requires manual operator action for this secret-version change.",
      blockers: ["manual_change_policy"],
    };
  }

  if (onChange.mode === "reload") {
    if (!service.manifest.actions?.reload) {
      return {
        action: "manual",
        actionId: "reload",
        reason: "Broker import onChange reload mode requires a declared reload service action.",
        blockers: ["missing_reload_action"],
      };
    }
    return {
      action: "reload",
      actionId: "reload",
      reason: onChange.reason ?? "Run the declared reload action after the secret version is activated.",
      blockers: [],
    };
  }

  return {
    action: onChange.mode,
    reason: onChange.reason ?? "Manifest broker import onChange policy declares " + onChange.mode + ".",
    blockers: [],
  };
}

function toDirectImpact(service: DiscoveredService, ref: string, findings: SecretReferenceAuditFinding[]): SecretRotationImpactService {
  const action = classifyDirectAction(service, importForRef(service, ref));
  const installMaterializationBlockers = findings.some((finding) => finding.source === "install")
    ? ["install_materialization_rotation_unsupported"]
    : [];
  return {
    serviceId: service.manifest.id,
    role: "direct",
    ref,
    action: action.action,
    actionId: action.actionId,
    reason: action.reason,
    required: findings.some((finding) => finding.required !== false),
    sources: uniqueSorted(findings.map((finding) => finding.source)),
    locations: uniqueSorted(findings.map((finding) => finding.location)),
    dependentsOf: [],
    blockers: uniqueSorted([...action.blockers, ...installMaterializationBlockers]),
  };
}

function toDependentImpact(service: DiscoveredService, ref: string, dependentsOf: string[]): SecretRotationImpactService {
  return {
    serviceId: service.manifest.id,
    role: "dependent",
    ref,
    action: "restart",
    reason: "Restart because an upstream dependency is planned for restart after secret activation.",
    required: true,
    sources: [],
    locations: [],
    dependentsOf: uniqueSorted(dependentsOf),
    blockers: [],
  };
}

function buildExecution(services: SecretRotationImpactService[], graph: DependencyGraph): SecretRotationImpactPlan["execution"] {
  const operationServices = services.filter(
    (service): service is SecretRotationImpactService & { action: "restart" | "reload" | "action" } =>
      service.action === "restart" || service.action === "reload" || service.action === "action",
  );
  const serviceIds = new Set(operationServices.map((service) => service.serviceId));
  const startOrder = graph.getGlobalStartupOrder().filter((serviceId) => serviceIds.has(serviceId));
  const stopOrder = [...startOrder].reverse();
  const rank = new Map(startOrder.map((serviceId, index) => [serviceId, index]));

  const operations = operationServices
    .map((service): SecretRotationImpactOperation => ({
      serviceId: service.serviceId,
      action: service.action,
      actionId: service.actionId,
      reason: service.reason,
    }))
    .sort((left, right) => (rank.get(left.serviceId) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right.serviceId) ?? Number.MAX_SAFE_INTEGER) || left.serviceId.localeCompare(right.serviceId));

  return { stopOrder, startOrder, operations };
}

function summarize(services: SecretRotationImpactService[]): SecretRotationImpactPlan["summary"] {
  return {
    directConsumers: services.filter((service) => service.role === "direct").length,
    dependents: services.filter((service) => service.role === "dependent").length,
    restart: services.filter((service) => service.action === "restart").length,
    reload: services.filter((service) => service.action === "reload").length,
    action: services.filter((service) => service.action === "action").length,
    manual: services.filter((service) => service.action === "manual").length,
    none: services.filter((service) => service.action === "none").length,
    blockers: services.reduce((total, service) => total + service.blockers.length, 0),
  };
}

export function buildSecretRotationImpactPlan(services: DiscoveredService[], ref: string): SecretRotationImpactPlan {
  const registry = createServiceRegistry(services);
  const graph = new DependencyGraph(registry);
  const directImpacts = services
    .map((service) => ({ service, findings: findingsForRef(service, ref) }))
    .filter((entry) => entry.findings.length > 0)
    .map((entry) => toDirectImpact(entry.service, ref, entry.findings));

  const dependentSources = new Map<string, string[]>();
  for (const impact of directImpacts.filter((entry) => entry.action === "restart")) {
    for (const dependent of graph.getReverseDependencies(impact.serviceId).dependents) {
      dependentSources.set(dependent.id, [...(dependentSources.get(dependent.id) ?? []), impact.serviceId]);
    }
  }

  const dependentImpacts = [...dependentSources.entries()]
    .filter(([serviceId]) => !directImpacts.some((impact) => impact.serviceId === serviceId))
    .map(([serviceId, dependentsOf]) => {
      const service = registry.getById(serviceId);
      if (!service) {
        throw new Error("Unknown dependent service id: " + serviceId);
      }
      return toDependentImpact(service, ref, dependentsOf);
    });

  const impactedServices = [...directImpacts, ...dependentImpacts].sort((left, right) =>
    left.role.localeCompare(right.role) || left.serviceId.localeCompare(right.serviceId),
  );
  const blockers = uniqueSorted(impactedServices.flatMap((service) => service.blockers.map((blocker) => service.serviceId + ":" + blocker)));

  const planWithoutFingerprint = {
    ref,
    status: blockers.length > 0 ? "blocked" : "ready",
    confirmationRequired: true,
    valuePolicy: "metadata_only",
    services: impactedServices,
    execution: buildExecution(impactedServices, graph),
    summary: summarize(impactedServices),
    blockers,
  } satisfies Omit<SecretRotationImpactPlan, "planFingerprint">;
  return {
    ...planWithoutFingerprint,
    planFingerprint: `sha256:${createHash("sha256").update(JSON.stringify(planWithoutFingerprint)).digest("hex")}`,
  };
}
