import { discoverServices } from "../discovery/discoverServices.js";
import { createServiceRegistry } from "../manager/DependencyGraph.js";
import { ensureRuntimeConfig, resolveRuntimeConfig, type RuntimeConfigOptions } from "../config.js";
import { readServiceHealthHistory, type ServiceHealthHistoryState } from "../health/history.js";
import { rehydrateDiscoveredServices } from "../state/rehydrate.js";

export type HealthCliAction = "history";

export interface HealthCliOptions extends RuntimeConfigOptions {
  action: HealthCliAction;
  serviceId?: string;
}

export interface HealthCliResult {
  action: "history";
  servicesRoot: string;
  workspaceRoot: string;
  services: Array<{
    serviceId: string;
    healthHistory: ServiceHealthHistoryState;
  }>;
}

export async function runHealthCliAction(options: HealthCliOptions): Promise<HealthCliResult> {
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
    ? [registry.getById(options.serviceId)].flatMap((service) => service ? [service] : [])
    : registry.list();

  if (options.serviceId && services.length === 0) {
    throw new Error(`Unknown service id: ${options.serviceId}.`);
  }

  return {
    action: "history",
    servicesRoot: runtimeConfig.servicesRoot,
    workspaceRoot: runtimeConfig.workspaceRoot,
    services: await Promise.all(services.map(async (service) => ({
      serviceId: service.manifest.id,
      healthHistory: await readServiceHealthHistory(service),
    }))),
  };
}
