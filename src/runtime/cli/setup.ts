import type { SetupServiceResult } from "../setup/steps.js";
import { discoverServices } from "../discovery/discoverServices.js";
import { createServiceRegistry } from "../manager/DependencyGraph.js";
import { ensureRuntimeConfig, resolveRuntimeConfig, type RuntimeConfigOptions } from "../config.js";
import { rehydrateDiscoveredServices } from "../state/rehydrate.js";
import { writeServiceState } from "../state/writeState.js";
import { listSetupStepIds, runServiceSetup } from "../setup/steps.js";

export type SetupCliAction = "list" | "run";

export interface SetupCliOptions extends RuntimeConfigOptions {
  action: SetupCliAction;
  serviceId?: string;
  stepId?: string;
  force?: boolean;
  includeManual?: boolean;
}

export interface SetupCliResult {
  action: SetupCliAction;
  servicesRoot: string;
  workspaceRoot: string;
  services?: Array<{
    serviceId: string;
    steps: string[];
  }>;
  result?: SetupServiceResult;
}

export async function runSetupCliAction(options: SetupCliOptions): Promise<SetupCliResult> {
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

  if (options.action === "list") {
    return {
      action: "list",
      servicesRoot: runtimeConfig.servicesRoot,
      workspaceRoot: runtimeConfig.workspaceRoot,
      services: registry
        .list()
        .map((service) => ({
          serviceId: service.manifest.id,
          steps: listSetupStepIds(service),
        }))
        .filter((service) => service.steps.length > 0),
    };
  }

  if (!options.serviceId) {
    throw new Error('The "setup run" command requires a <serviceId> argument.');
  }

  const service = registry.getById(options.serviceId);
  if (!service) {
    const available = registry.list().map((entry) => entry.manifest.id).sort();
    const hint = available.length > 0 ? ` Available services: ${available.join(", ")}.` : "";
    throw new Error(`Unknown service id: ${options.serviceId}.${hint}`);
  }

  const result = await runServiceSetup(service, registry, {
    stepId: options.stepId,
    force: options.force,
    includeManual: options.includeManual,
  });
  await writeServiceState(service, result.state);

  return {
    action: "run",
    servicesRoot: runtimeConfig.servicesRoot,
    workspaceRoot: runtimeConfig.workspaceRoot,
    result,
  };
}
