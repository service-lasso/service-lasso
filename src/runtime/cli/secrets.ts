import { discoverServices } from "../discovery/discoverServices.js";
import { createServiceRegistry } from "../manager/DependencyGraph.js";
import { resolveRuntimeConfig, type RuntimeConfigOptions } from "../config.js";
import {
  buildSecretReferenceAudit,
  buildServiceSecretReferenceAudit,
  type SecretReferenceAudit,
  type ServiceSecretReferenceAudit,
} from "../operator/secret-audit.js";

export type SecretsCliAction = "audit";

export interface SecretsCliOptions extends RuntimeConfigOptions {
  action: SecretsCliAction;
  serviceId?: string;
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
    });

export async function runSecretsCliAction(options: SecretsCliOptions): Promise<SecretsCliResult> {
  const runtimeConfig = resolveRuntimeConfig({
    servicesRoot: options.servicesRoot,
    workspaceRoot: options.workspaceRoot,
    version: options.version,
  });
  const discovered = await discoverServices(runtimeConfig.servicesRoot);

  if (!options.serviceId) {
    return {
      action: "audit",
      servicesRoot: runtimeConfig.servicesRoot,
      workspaceRoot: runtimeConfig.workspaceRoot,
      ...buildSecretReferenceAudit(discovered),
    };
  }

  const registry = createServiceRegistry(discovered);
  const service = registry.getById(options.serviceId);
  if (!service) {
    const available = registry.list().map((entry) => entry.manifest.id).sort();
    const hint = available.length > 0 ? " Available services: " + available.join(", ") + "." : "";
    throw new Error("Unknown service id: " + options.serviceId + "." + hint);
  }

  return {
    action: "audit",
    servicesRoot: runtimeConfig.servicesRoot,
    workspaceRoot: runtimeConfig.workspaceRoot,
    ...buildServiceSecretReferenceAudit(service),
  };
}
