import { discoverServices } from "../discovery/discoverServices.js";
import { createServiceRegistry } from "../manager/DependencyGraph.js";
import { ensureRuntimeConfig, resolveRuntimeConfig, type RuntimeConfigOptions } from "../config.js";
import { rehydrateDiscoveredServices } from "../state/rehydrate.js";
import { buildConfigApplyPreflightReport, type ConfigApplyPreflightReport } from "../operator/config-apply-preflight.js";

export type ConfigApplyCliAction = "preflight";

export interface ConfigApplyCliOptions extends RuntimeConfigOptions {
  action: ConfigApplyCliAction;
  serviceId?: string;
}

export interface ConfigApplyCliResult extends ConfigApplyPreflightReport {
  servicesRoot: string;
  workspaceRoot: string;
}

export async function runConfigApplyCliAction(options: ConfigApplyCliOptions): Promise<ConfigApplyCliResult> {
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
  const report = await buildConfigApplyPreflightReport(registry, options.serviceId);

  return {
    servicesRoot: runtimeConfig.servicesRoot,
    workspaceRoot: runtimeConfig.workspaceRoot,
    ...report,
  };
}
