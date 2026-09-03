import { discoverServices } from "../discovery/discoverServices.js";
import { createServiceRegistry } from "../manager/DependencyGraph.js";
import { resolveRuntimeConfig, type RuntimeConfigOptions } from "../config.js";
import { enforceLeftoverCliMutation } from "../permissions/leftover-cli.js";
import type { PermissionActor } from "../permissions/enforcement.js";
import {
  createSecretsBrokerBackup,
  restoreSecretsBrokerBackup,
  type SecretsBrokerBackupResult,
} from "../broker/backup.js";
import { SECRETSBROKER_SERVICE_ID } from "../broker/operator-config.js";
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

export type SecretsCliAction =
  | "audit"
  | "rotation-readiness"
  | "provider-auth-required"
  | "rotate-plan"
  | "broker-backup"
  | "broker-restore";

export interface SecretsCliOptions extends RuntimeConfigOptions {
  action: SecretsCliAction;
  serviceId?: string;
  ref?: string;
  archivePath?: string;
  /** Test override. Production leftover CLI mutations use `cli-local-root`. */
  permissionActor?: PermissionActor;
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
    })
  | (SecretsBrokerBackupResult & {
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

  if (options.action === "broker-backup" || options.action === "broker-restore") {
    await enforceLeftoverCliMutation({
      workspaceRoot: runtimeConfig.workspaceRoot,
      kind: options.action === "broker-backup" ? "secrets-broker-backup" : "secrets-broker-restore",
      permissionActor: options.permissionActor,
      subject: SECRETSBROKER_SERVICE_ID,
      serviceId: SECRETSBROKER_SERVICE_ID,
    });
    const registry = createServiceRegistry(discovered);
    const broker = registry.getById(SECRETSBROKER_SERVICE_ID);
    if (!broker) {
      throw new Error(`Unknown service id: ${SECRETSBROKER_SERVICE_ID}.`);
    }

    const backupResult = options.action === "broker-backup"
      ? await createSecretsBrokerBackup(broker, { outputPath: options.archivePath })
      : await restoreSecretsBrokerBackup(broker, options.archivePath ?? "");

    return {
      ...backupResult,
      servicesRoot: runtimeConfig.servicesRoot,
      workspaceRoot: runtimeConfig.workspaceRoot,
    };
  }

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
