import { stat } from "node:fs/promises";
import type { RuntimeDryRunPlanResponse } from "../../contracts/api.js";
import { discoverServices } from "../discovery/discoverServices.js";
import { createServiceRegistry, DependencyGraph } from "../manager/DependencyGraph.js";
import { resolveRuntimeConfig, type RuntimeConfigOptions } from "../config.js";
import { buildAppServiceImportDryRunPlan, buildRuntimeOrchestrationDryRunPlan, buildUpdateInstallDryRunPlan } from "../operator/dry-run-plan.js";
import { rehydrateDiscoveredServices } from "../state/rehydrate.js";

export type RuntimePlanCliAction = "start" | "stop" | "autostart" | "update-install" | "import";

export interface RuntimePlanCliOptions extends RuntimeConfigOptions {
  action: RuntimePlanCliAction;
  serviceId?: string;
  manifestPath?: string;
  force?: boolean;
}

export interface RuntimePlanCliResult extends RuntimeDryRunPlanResponse {
  servicesRoot: string;
  workspaceRoot: string;
}

async function assertDirectoryExists(label: string, targetPath: string): Promise<void> {
  let stats;
  try {
    stats = await stat(targetPath);
  } catch {
    throw new Error("Configured " + label + " does not exist: " + targetPath);
  }

  if (!stats.isDirectory()) {
    throw new Error("Configured " + label + " is not a directory: " + targetPath);
  }
}

async function loadPlanModel(options: RuntimeConfigOptions) {
  const runtimeConfig = resolveRuntimeConfig({
    servicesRoot: options.servicesRoot,
    workspaceRoot: options.workspaceRoot,
    version: options.version,
  });
  await assertDirectoryExists("servicesRoot", runtimeConfig.servicesRoot);
  const discovered = await discoverServices(runtimeConfig.servicesRoot);
  await rehydrateDiscoveredServices(discovered);
  const registry = createServiceRegistry(discovered);

  return {
    runtimeConfig,
    discovered,
    registry,
    graph: new DependencyGraph(registry),
  };
}

export async function runRuntimePlanCliAction(options: RuntimePlanCliOptions): Promise<RuntimePlanCliResult> {
  if (options.action === "import") {
    if (!options.manifestPath) {
      throw new Error('The "plan import" command requires a <manifestPath> argument.');
    }

    const runtimeConfig = resolveRuntimeConfig({
      servicesRoot: options.servicesRoot,
      workspaceRoot: options.workspaceRoot,
      version: options.version,
    });
    await assertDirectoryExists("servicesRoot", runtimeConfig.servicesRoot);
    return {
      ...(await buildAppServiceImportDryRunPlan({
        manifestPath: options.manifestPath,
        servicesRoot: runtimeConfig.servicesRoot,
      })),
      servicesRoot: runtimeConfig.servicesRoot,
      workspaceRoot: runtimeConfig.workspaceRoot,
    };
  }

  const model = await loadPlanModel(options);

  if (options.action === "update-install") {
    if (!options.serviceId) {
      throw new Error('The "plan update-install" command requires a <serviceId> argument.');
    }

    const service = model.registry.getById(options.serviceId);
    if (!service) {
      const available = model.registry.list().map((entry) => entry.manifest.id).sort();
      const hint = available.length > 0 ? " Available services: " + available.join(", ") + "." : "";
      throw new Error("Unknown service id: " + options.serviceId + "." + hint);
    }

    return {
      ...(await buildUpdateInstallDryRunPlan(service, { force: options.force })),
      servicesRoot: model.runtimeConfig.servicesRoot,
      workspaceRoot: model.runtimeConfig.workspaceRoot,
    };
  }

  const action =
    options.action === "start"
      ? "startAll"
      : options.action === "stop"
        ? "stopAll"
        : "autostart";

  return {
    ...buildRuntimeOrchestrationDryRunPlan(action, model.graph, model.registry),
    servicesRoot: model.runtimeConfig.servicesRoot,
    workspaceRoot: model.runtimeConfig.workspaceRoot,
  };
}
