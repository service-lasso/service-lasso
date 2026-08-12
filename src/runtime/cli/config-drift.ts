import { discoverServices } from "../discovery/discoverServices.js";
import { createServiceRegistry } from "../manager/DependencyGraph.js";
import { ensureRuntimeConfig, resolveRuntimeConfig, type RuntimeConfigOptions } from "../config.js";
import { rehydrateDiscoveredServices } from "../state/rehydrate.js";
import { buildServiceConfigDriftReport, type ConfigDriftReport } from "../operator/config-drift.js";

export interface ConfigDriftCliOptions extends RuntimeConfigOptions {
  serviceId?: string;
}

export interface ConfigDriftCliResult {
  servicesRoot: string;
  workspaceRoot: string;
  services: ConfigDriftReport[];
}

export async function runConfigDriftCliAction(options: ConfigDriftCliOptions = {}): Promise<ConfigDriftCliResult> {
  const runtimeConfig = await ensureRuntimeConfig(
    resolveRuntimeConfig({
      servicesRoot: options.servicesRoot,
      workspaceRoot: options.workspaceRoot,
      version: options.version,
    }),
  );
  const discovered = await discoverServices(runtimeConfig.servicesRoot);
  await rehydrateDiscoveredServices(discovered);
  const registry = createServiceRegistry(discovered);
  const services = options.serviceId
    ? [registry.getById(options.serviceId)].filter((service) => service !== undefined)
    : registry.list();

  if (options.serviceId && services.length === 0) {
    const available = registry.list().map((entry) => entry.manifest.id).sort();
    const hint = available.length > 0 ? ` Available services: ${available.join(", ")}.` : "";
    throw new Error(`Unknown service id: ${options.serviceId}.${hint}`);
  }

  return {
    servicesRoot: runtimeConfig.servicesRoot,
    workspaceRoot: runtimeConfig.workspaceRoot,
    services: await Promise.all(services.map((service) => buildServiceConfigDriftReport(service, registry.list()))),
  };
}
