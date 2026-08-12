import type { DiscoveredService, ServiceHookFailurePolicy } from "../../contracts/service.js";
import { getLifecycleState } from "../lifecycle/store.js";
import { DependencyGraph } from "../manager/DependencyGraph.js";
import type { ServiceRegistry } from "../manager/ServiceRegistry.js";

export type RestartSafetyPreflightStatus = "allowed" | "warning" | "blocked";

export type RestartSafetyBlockerCode =
  | "service_not_installed"
  | "service_not_configured"
  | "dependency_missing"
  | "dependency_cycle"
  | "provider_missing"
  | "provider_not_installed"
  | "provider_not_configured";

export interface RestartSafetyPreflightIssue {
  code: RestartSafetyBlockerCode | "running_dependents" | "doctor_required";
  serviceId: string;
  reason: string;
}

export interface RestartSafetyDependent {
  serviceId: string;
  relationship: "direct" | "transitive";
  via: string[];
  running: boolean;
  configured: boolean;
}

export interface RestartSafetyProviderRef {
  serviceId: string;
  status: "none" | "available" | "missing" | "not_ready";
  installed: boolean | null;
  configured: boolean | null;
}

export interface RestartSafetyDoctorRequirement {
  required: boolean;
  enabled: boolean;
  stepCount: number;
  failurePolicy: ServiceHookFailurePolicy;
  status: "disabled" | "will_run_before_restart";
}

export interface RestartSafetyPreflightReport {
  action: "restart-preflight";
  ok: boolean;
  dryRun: true;
  mutated: false;
  generatedAt: string;
  serviceId: string;
  status: RestartSafetyPreflightStatus;
  lifecycle: {
    installed: boolean;
    configured: boolean;
    running: boolean;
  };
  dependencyGraph: {
    dependencies: string[];
    startupOrder: string[];
    missingDependencies: string[];
    dependents: RestartSafetyDependent[];
  };
  providerRef: RestartSafetyProviderRef;
  doctorRequirement: RestartSafetyDoctorRequirement;
  restartOrderRisk: {
    level: "none" | "dependent_restart_recommended" | "blocked";
    reason: string;
    stopBeforeTarget: string[];
    startAfterTarget: string[];
  };
  blockers: RestartSafetyPreflightIssue[];
  warnings: RestartSafetyPreflightIssue[];
  expectedOperatorImpact: string[];
}

function addUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

function collectDirectDependents(registry: ServiceRegistry, serviceId: string): string[] {
  return registry
    .list()
    .filter((service) =>
      (service.manifest.depend_on ?? []).includes(serviceId) ||
      service.manifest.execservice === serviceId,
    )
    .map((service) => service.manifest.id)
    .sort((left, right) => left.localeCompare(right));
}

function collectDependents(registry: ServiceRegistry, serviceId: string): RestartSafetyDependent[] {
  const queue: Array<{
    dependentId: string;
    via: string[];
    relationship: RestartSafetyDependent["relationship"];
  }> = collectDirectDependents(registry, serviceId).map((dependentId) => ({
    dependentId,
    via: [serviceId],
    relationship: "direct" as const,
  }));
  const visited = new Set<string>();
  const dependents: RestartSafetyDependent[] = [];

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (!current || current.dependentId === serviceId || visited.has(current.dependentId)) {
      continue;
    }
    visited.add(current.dependentId);

    const service = registry.getById(current.dependentId);
    if (!service) {
      continue;
    }

    const lifecycle = getLifecycleState(current.dependentId);
    dependents.push({
      serviceId: current.dependentId,
      relationship: current.relationship,
      via: current.via,
      running: lifecycle.running,
      configured: lifecycle.configured,
    });

    for (const nextDependentId of collectDirectDependents(registry, current.dependentId)) {
      if (nextDependentId === serviceId) {
        continue;
      }
      queue.push({
        dependentId: nextDependentId,
        via: [...current.via, current.dependentId],
        relationship: "transitive",
      });
    }
  }

  return dependents.sort((left, right) => left.serviceId.localeCompare(right.serviceId));
}

function buildProviderRef(service: DiscoveredService, registry: ServiceRegistry): RestartSafetyProviderRef {
  const providerServiceId = service.manifest.execservice;
  if (!providerServiceId) {
    return {
      serviceId: "",
      status: "none",
      installed: null,
      configured: null,
    };
  }

  const provider = registry.getById(providerServiceId);
  if (!provider) {
    return {
      serviceId: providerServiceId,
      status: "missing",
      installed: null,
      configured: null,
    };
  }

  const lifecycle = getLifecycleState(providerServiceId);
  return {
    serviceId: providerServiceId,
    status: lifecycle.installed && lifecycle.configured ? "available" : "not_ready",
    installed: lifecycle.installed,
    configured: lifecycle.configured,
  };
}

function buildDoctorRequirement(service: DiscoveredService): RestartSafetyDoctorRequirement {
  const doctor = service.manifest.doctor;
  const enabled = doctor?.enabled === true;
  const stepCount = doctor?.steps?.length ?? 0;
  const failurePolicy = doctor?.failurePolicy ?? "block";
  return {
    required: enabled && stepCount > 0,
    enabled,
    stepCount,
    failurePolicy,
    status: enabled && stepCount > 0 ? "will_run_before_restart" : "disabled",
  };
}

function worstStatus(blockers: RestartSafetyPreflightIssue[], warnings: RestartSafetyPreflightIssue[]): RestartSafetyPreflightStatus {
  if (blockers.length > 0) {
    return "blocked";
  }
  if (warnings.length > 0) {
    return "warning";
  }
  return "allowed";
}

function buildImpact(
  status: RestartSafetyPreflightStatus,
  dependents: RestartSafetyDependent[],
  doctorRequirement: RestartSafetyDoctorRequirement,
  providerRef: RestartSafetyProviderRef,
): string[] {
  const impact: string[] = [
    "Restart preflight is read-only and does not mutate lifecycle state.",
  ];
  if (providerRef.status === "available") {
    impact.push(`Provider ${providerRef.serviceId} is installed and configured.`);
  } else if (providerRef.status === "missing" || providerRef.status === "not_ready") {
    impact.push(`Provider ${providerRef.serviceId} must be ready before restart.`);
  }
  if (dependents.length > 0) {
    impact.push(`${dependents.length} dependent service(s) may need coordinated restart after dependency/provider changes.`);
  }
  if (doctorRequirement.required) {
    impact.push(`Doctor preflight will run ${doctorRequirement.stepCount} step(s) before restart.`);
  }
  if (status === "blocked") {
    impact.push("Restart should not proceed until blockers are resolved.");
  }
  impact.push("No raw secret values, provider credentials, env values, tokens, cookies, or recovery material are included.");
  return impact;
}

export function buildRestartSafetyPreflightReport(
  service: DiscoveredService,
  registry: ServiceRegistry,
): RestartSafetyPreflightReport {
  const serviceId = service.manifest.id;
  const lifecycle = getLifecycleState(serviceId);
  const graph = new DependencyGraph(registry);
  const dependencies = [...(service.manifest.depend_on ?? [])].sort((left, right) => left.localeCompare(right));
  const missingDependencies = dependencies.filter((dependencyId) => !registry.getById(dependencyId));
  const blockers: RestartSafetyPreflightIssue[] = [];
  const warnings: RestartSafetyPreflightIssue[] = [];
  let startupOrder: string[] = [];

  if (!lifecycle.installed) {
    blockers.push({
      code: "service_not_installed",
      serviceId,
      reason: "Restart requires the service to be installed first.",
    });
  }
  if (!lifecycle.configured) {
    blockers.push({
      code: "service_not_configured",
      serviceId,
      reason: "Restart requires the service to be configured first.",
    });
  }
  for (const dependencyId of missingDependencies) {
    blockers.push({
      code: "dependency_missing",
      serviceId: dependencyId,
      reason: `Declared dependency "${dependencyId}" is not present in the service registry.`,
    });
  }

  try {
    startupOrder = graph.getStartupOrder(serviceId);
  } catch (error) {
    blockers.push({
      code: "dependency_cycle",
      serviceId,
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  const providerRef = buildProviderRef(service, registry);
  if (providerRef.status === "missing") {
    blockers.push({
      code: "provider_missing",
      serviceId: providerRef.serviceId,
      reason: `Provider service "${providerRef.serviceId}" is not present in the service registry.`,
    });
  } else if (providerRef.status === "not_ready") {
    if (providerRef.installed === false) {
      blockers.push({
        code: "provider_not_installed",
        serviceId: providerRef.serviceId,
        reason: `Provider service "${providerRef.serviceId}" is not installed.`,
      });
    }
    if (providerRef.configured === false) {
      blockers.push({
        code: "provider_not_configured",
        serviceId: providerRef.serviceId,
        reason: `Provider service "${providerRef.serviceId}" is not configured.`,
      });
    }
  }

  const dependents = collectDependents(registry, serviceId);
  const runningDependents = dependents.filter((dependent) => dependent.running);
  if (runningDependents.length > 0) {
    warnings.push({
      code: "running_dependents",
      serviceId,
      reason: "Running dependent services may need to be stopped before the target restart and started after it.",
    });
  }

  const doctorRequirement = buildDoctorRequirement(service);
  if (doctorRequirement.required) {
    warnings.push({
      code: "doctor_required",
      serviceId,
      reason: "Configured doctor preflight will run before restart and may block based on its failure policy.",
    });
  }

  const status = worstStatus(blockers, warnings);
  const stopBeforeTarget: string[] = [];
  const startAfterTarget: string[] = [];
  for (const dependent of runningDependents) {
    addUnique(stopBeforeTarget, dependent.serviceId);
    addUnique(startAfterTarget, dependent.serviceId);
  }
  const restartOrderRisk = {
    level: blockers.length > 0
      ? "blocked" as const
      : runningDependents.length > 0
        ? "dependent_restart_recommended" as const
        : "none" as const,
    reason: blockers.length > 0
      ? "Dependency/provider/lifecycle blockers must be resolved before restart."
      : runningDependents.length > 0
        ? "The target has running dependents that may observe dependency/provider changes."
        : "No running dependent services were detected.",
    stopBeforeTarget: stopBeforeTarget.sort((left, right) => left.localeCompare(right)),
    startAfterTarget: startAfterTarget.sort((left, right) => left.localeCompare(right)),
  };

  return {
    action: "restart-preflight",
    ok: blockers.length === 0,
    dryRun: true,
    mutated: false,
    generatedAt: new Date().toISOString(),
    serviceId,
    status,
    lifecycle: {
      installed: lifecycle.installed,
      configured: lifecycle.configured,
      running: lifecycle.running,
    },
    dependencyGraph: {
      dependencies,
      startupOrder,
      missingDependencies,
      dependents,
    },
    providerRef,
    doctorRequirement,
    restartOrderRisk,
    blockers,
    warnings,
    expectedOperatorImpact: buildImpact(status, dependents, doctorRequirement, providerRef),
  };
}
