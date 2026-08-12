import { discoverServices } from "../discovery/discoverServices.js";
import { createServiceRegistry } from "../manager/DependencyGraph.js";
import { resolveRuntimeConfig, type RuntimeConfigOptions } from "../config.js";
import {
  buildSecretProviderAuthRequiredSummary,
  buildSecretReferenceAudit,
  buildSecretRotationReadinessReport,
  buildServiceSecretProviderAuthRequiredSummary,
  buildServiceSecretReferenceAudit,
  buildServiceSecretRotationReadinessReport,
  type SecretProviderAuthRequiredSummary,
  type SecretReferenceAudit,
  type SecretRotationReadinessReport,
  type ServiceSecretProviderAuthRequiredSummary,
  type ServiceSecretReferenceAudit,
  type ServiceSecretRotationReadinessReport,
} from "../operator/secret-audit.js";
import { buildSecretRotationImpactPlan, type SecretRotationImpactPlan } from "../operator/secret-rotation-plan.js";

export type SecretsCliAction = "audit" | "rotation-readiness" | "provider-auth-required" | "rotate-plan";

export interface SecretsCliOptions extends RuntimeConfigOptions {
  action: SecretsCliAction;
  serviceId?: string;
  ref?: string;
}

export type SecretsCliResult =
  | (SecretReferenceAudit & {
      action: "audit";
      servicesRoot: string;
      workspaceRoot: string;
    })
  | (ServiceSecretReferenceAudit & {
      action: "audit";
      servicesRoot: string;
      workspaceRoot: string;
    })
  | (SecretRotationReadinessReport & {
      action: "rotation-readiness";
      servicesRoot: string;
      workspaceRoot: string;
    })
  | (ServiceSecretRotationReadinessReport & {
      action: "rotation-readiness";
      servicesRoot: string;
      workspaceRoot: string;
    })
  | (SecretProviderAuthRequiredSummary & {
      action: "provider-auth-required";
      servicesRoot: string;
      workspaceRoot: string;
    })
  | (ServiceSecretProviderAuthRequiredSummary & {
      action: "provider-auth-required";
      servicesRoot: string;
      workspaceRoot: string;
    })
  | (SecretRotationImpactPlan & {
      action: "rotate-plan";
      servicesRoot: string;
      workspaceRoot: string;
    });

export async function runSecretsCliAction(options: SecretsCliOptions): Promise<SecretsCliResult> {
  const runtimeConfig = resolveRuntimeConfig({
    servicesRoot: options.servicesRoot,
    workspaceRoot: options.workspaceRoot,
    version: options.version,
  });
  const discovered = await discoverServices(runtimeConfig.servicesRoot);

  if (options.action === "rotate-plan") {
    const ref = options.ref?.trim();
    if (!ref) {
      throw new Error('The "secrets rotate-plan" command requires a <ref> argument.');
    }

    return {
      action: "rotate-plan",
      servicesRoot: runtimeConfig.servicesRoot,
      workspaceRoot: runtimeConfig.workspaceRoot,
      ...buildSecretRotationImpactPlan(discovered, ref),
    };
  }

  if (!options.serviceId && options.action === "audit") {
    return {
      action: "audit",
      servicesRoot: runtimeConfig.servicesRoot,
      workspaceRoot: runtimeConfig.workspaceRoot,
      ...buildSecretReferenceAudit(discovered),
    };
  }

  if (!options.serviceId && options.action === "rotation-readiness") {
    return {
      action: "rotation-readiness",
      servicesRoot: runtimeConfig.servicesRoot,
      workspaceRoot: runtimeConfig.workspaceRoot,
      ...buildSecretRotationReadinessReport(discovered),
    };
  }

  if (!options.serviceId) {
    return {
      action: "provider-auth-required",
      servicesRoot: runtimeConfig.servicesRoot,
      workspaceRoot: runtimeConfig.workspaceRoot,
      ...buildSecretProviderAuthRequiredSummary(discovered),
    };
  }

  const registry = createServiceRegistry(discovered);
  const service = registry.getById(options.serviceId);
  if (!service) {
    const available = registry.list().map((entry) => entry.manifest.id).sort();
    const hint = available.length > 0 ? " Available services: " + available.join(", ") + "." : "";
    throw new Error("Unknown service id: " + options.serviceId + "." + hint);
  }

  if (options.action === "audit") {
    return {
      action: "audit",
      servicesRoot: runtimeConfig.servicesRoot,
      workspaceRoot: runtimeConfig.workspaceRoot,
      ...buildServiceSecretReferenceAudit(service),
    };
  }

  if (options.action === "rotation-readiness") {
    return {
      action: "rotation-readiness",
      servicesRoot: runtimeConfig.servicesRoot,
      workspaceRoot: runtimeConfig.workspaceRoot,
      ...buildServiceSecretRotationReadinessReport(service),
    };
  }

  return {
    action: "provider-auth-required",
    servicesRoot: runtimeConfig.servicesRoot,
    workspaceRoot: runtimeConfig.workspaceRoot,
    ...buildServiceSecretProviderAuthRequiredSummary(service),
  };
}
