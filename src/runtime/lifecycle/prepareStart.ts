import type { DiscoveredService } from "../../contracts/service.js";
import { LifecycleStateError } from "../../server/errors.js";
import { hasManagedProcess } from "../execution/supervisor.js";
import type { ServiceRegistry } from "../manager/ServiceRegistry.js";
import { DependencyGraph } from "../manager/DependencyGraph.js";
import { isProviderRole } from "../roles.js";
import { listSetupStepIds, runServiceSetup } from "../setup/steps.js";
import { writeServiceState } from "../state/writeState.js";
import { configService, installService, startService } from "./actions.js";
import { getLifecycleState } from "./store.js";
import type { LifecycleActionResult, ServiceLifecycleState } from "./types.js";

export type PreparedStartSkipReason = "already_running" | "provider_role" | "not_startable";

export interface PreparedStartResult {
  result: LifecycleActionResult | null;
  skippedReason: PreparedStartSkipReason | null;
  state: ServiceLifecycleState;
}

function hasStartableCommand(service: DiscoveredService, state: ServiceLifecycleState): boolean {
  return Boolean(service.manifest.execservice || service.manifest.executable || state.installArtifacts.artifact?.command);
}

async function persistResult(service: DiscoveredService, result: Pick<LifecycleActionResult, "state">): Promise<void> {
  await writeServiceState(service, result.state);
}

async function prepareServicePrerequisites(
  service: DiscoveredService,
  registry: ServiceRegistry,
  workspaceRoot?: string,
): Promise<ServiceLifecycleState> {
  let state = getLifecycleState(service.manifest.id);

  if (!state.installed) {
    const result = await installService(service, registry);
    await persistResult(service, result);
    state = result.state;
  }

  if (!state.configured) {
    const result = await configService(service, registry, { workspaceRoot });
    await persistResult(service, result);
    state = result.state;
  }

  if (listSetupStepIds(service).length > 0) {
    const result = await runServiceSetup(service, registry);
    await writeServiceState(service, result.state);
    state = result.state;

    if (!result.ok) {
      throw new LifecycleStateError(result.message);
    }
  }

  return state;
}

export async function prepareAndStartService(
  service: DiscoveredService,
  registry: ServiceRegistry,
  options: { workspaceRoot?: string } = {},
): Promise<PreparedStartResult> {
  const serviceId = service.manifest.id;
  const graph = new DependencyGraph(registry);

  for (const dependencyId of graph.getStartupOrder(serviceId)) {
    const dependency = registry.getById(dependencyId);
    if (!dependency) {
      throw new LifecycleStateError(
        `Cannot start service "${serviceId}" because dependency "${dependencyId}" was not found.`,
      );
    }

    await prepareAndStartService(dependency, registry, options);
  }

  let state = await prepareServicePrerequisites(service, registry, options.workspaceRoot);

  if (state.running || hasManagedProcess(serviceId)) {
    return { result: null, skippedReason: "already_running", state };
  }

  if (isProviderRole(service.manifest)) {
    return { result: null, skippedReason: "provider_role", state };
  }

  if (!hasStartableCommand(service, state)) {
    return { result: null, skippedReason: "not_startable", state };
  }

  const result = await startService(service, registry, options);
  await writeServiceState(service, result.state);
  state = result.state;

  return { result, skippedReason: null, state };
}

