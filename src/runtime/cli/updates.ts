import { discoverServices } from "../discovery/discoverServices.js";
import { createServiceRegistry } from "../manager/DependencyGraph.js";
import { ensureRuntimeConfig, resolveRuntimeConfig, type RuntimeConfigOptions } from "../config.js";
import { rehydrateDiscoveredServices } from "../state/rehydrate.js";
import {
  checkServiceUpdatesForCli,
  downloadServiceUpdateCandidate,
  installServiceUpdateCandidate,
  listServiceUpdateStates,
  type UpdateCheckActionResult,
  type UpdateDownloadActionResult,
  type UpdateInstallActionResult,
  type UpdateServiceSummary,
} from "../updates/actions.js";

export type UpdateCliAction = "list" | "check" | "download" | "install";

export interface UpdatesCliOptions extends RuntimeConfigOptions {
  action: UpdateCliAction;
  serviceId?: string;
  force?: boolean;
}

export type UpdatesCliResult =
  | {
      action: "list";
      servicesRoot: string;
      workspaceRoot: string;
      services: UpdateServiceSummary[];
    }
  | (UpdateCheckActionResult & {
      servicesRoot: string;
      workspaceRoot: string;
    })
  | (UpdateDownloadActionResult & {
      servicesRoot: string;
      workspaceRoot: string;
    })
  | (UpdateInstallActionResult & {
      servicesRoot: string;
      workspaceRoot: string;
    });

export async function runUpdatesCliAction(options: UpdatesCliOptions): Promise<UpdatesCliResult> {
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
      services: await listServiceUpdateStates(registry.list()),
    };
  }

  if (options.action === "check") {
    return {
      ...(await checkServiceUpdatesForCli(registry.list(), options.serviceId)),
      servicesRoot: runtimeConfig.servicesRoot,
      workspaceRoot: runtimeConfig.workspaceRoot,
    };
  }

  if (!options.serviceId) {
    throw new Error(`The "updates ${options.action}" command requires a <serviceId> argument.`);
  }

  const service = registry.getById(options.serviceId);
  if (!service) {
    const available = registry.list().map((entry) => entry.manifest.id).sort();
    const hint = available.length > 0 ? ` Available services: ${available.join(", ")}.` : "";
    throw new Error(`Unknown service id: ${options.serviceId}.${hint}`);
  }

  if (options.action === "download") {
    return {
      ...(await downloadServiceUpdateCandidate(service)),
      servicesRoot: runtimeConfig.servicesRoot,
      workspaceRoot: runtimeConfig.workspaceRoot,
    };
  }

  return {
    ...(await installServiceUpdateCandidate(service, { force: options.force })),
    servicesRoot: runtimeConfig.servicesRoot,
    workspaceRoot: runtimeConfig.workspaceRoot,
  };
}
