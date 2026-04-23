import type { LifecycleActionResponse } from "../../contracts/api.js";
import { discoverServices } from "../discovery/discoverServices.js";
import { installService } from "../lifecycle/actions.js";
import { createServiceRegistry } from "../manager/DependencyGraph.js";
import { ensureRuntimeConfig, resolveRuntimeConfig, type RuntimeConfigOptions } from "../config.js";
import { rehydrateDiscoveredServices } from "../state/rehydrate.js";
import { writeServiceState } from "../state/writeState.js";

export interface InstallServiceCliOptions extends RuntimeConfigOptions {
  serviceId: string;
}

export interface InstallServiceCliResult extends LifecycleActionResponse {
  servicesRoot: string;
  workspaceRoot: string;
}

export async function installServiceFromCli(options: InstallServiceCliOptions): Promise<InstallServiceCliResult> {
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
  const service = registry.getById(options.serviceId);

  if (!service) {
    const available = registry.list().map((entry) => entry.manifest.id).sort();
    const hint = available.length > 0 ? ` Available services: ${available.join(", ")}.` : "";
    throw new Error(`Unknown service id: ${options.serviceId}.${hint}`);
  }

  const result = await installService(service, registry);
  const persisted = await writeServiceState(service, result.state);

  return {
    action: result.action,
    serviceId: result.serviceId,
    ok: result.ok,
    message: result.message,
    state: result.state,
    statePaths: persisted.paths,
    servicesRoot: runtimeConfig.servicesRoot,
    workspaceRoot: runtimeConfig.workspaceRoot,
  };
}
