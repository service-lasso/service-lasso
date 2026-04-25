import type { DiscoveredService } from "../../contracts/service.js";
import { hasManagedProcess } from "../execution/supervisor.js";
import { configService, installService, startService } from "../lifecycle/actions.js";
import { getLifecycleState } from "../lifecycle/store.js";
import type { LifecycleAction, LifecycleActionResult, ServiceLifecycleState } from "../lifecycle/types.js";
import { DependencyGraph, createServiceRegistry } from "../manager/DependencyGraph.js";
import type { ServiceRegistry } from "../manager/ServiceRegistry.js";
import { discoverServices } from "../discovery/discoverServices.js";
import { ensureRuntimeConfig, resolveRuntimeConfig, type RuntimeConfigOptions } from "../config.js";
import { rehydrateDiscoveredServices } from "../state/rehydrate.js";
import { writeServiceState } from "../state/writeState.js";

export const DEFAULT_BASELINE_SERVICE_IDS = ["@traefik", "@node", "echo-service", "service-admin"] as const;

export type BaselineServiceStatus = "completed" | "skipped";

export interface BaselineActionSummary {
  action: LifecycleAction;
  status: "completed" | "skipped";
  message: string;
}

export interface BaselineServiceSummary {
  serviceId: string;
  status: BaselineServiceStatus;
  enabled: boolean;
  actions: BaselineActionSummary[];
  state: ServiceLifecycleState;
  message: string;
}

export interface BootstrapBaselineOptions extends RuntimeConfigOptions {
  serviceIds?: readonly string[];
}

export interface BootstrapBaselineResult {
  servicesRoot: string;
  workspaceRoot: string;
  requestedServiceIds: string[];
  serviceOrder: string[];
  services: BaselineServiceSummary[];
  registry: ServiceRegistry;
}

function formatActionFailure(serviceId: string, action: LifecycleAction, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error);
  return new Error(`Baseline bootstrap failed for service "${serviceId}" during "${action}": ${detail}`);
}

function shouldStartService(service: DiscoveredService, state: ServiceLifecycleState): boolean {
  return Boolean(service.manifest.execservice || service.manifest.executable || state.installArtifacts.artifact?.command);
}

async function runLifecycleAction(
  service: DiscoveredService,
  registry: ServiceRegistry,
  action: LifecycleAction,
): Promise<LifecycleActionResult> {
  try {
    if (action === "install") {
      return await installService(service, registry);
    }

    if (action === "config") {
      return await configService(service, registry);
    }

    if (action === "start") {
      return await startService(service, registry);
    }
  } catch (error) {
    throw formatActionFailure(service.manifest.id, action, error);
  }

  throw new Error(`Unsupported baseline bootstrap action: ${action}`);
}

function resolveBaselineOrder(registry: ServiceRegistry, requestedServiceIds: readonly string[]): string[] {
  const available = new Set(registry.list().map((service) => service.manifest.id));

  for (const serviceId of requestedServiceIds) {
    if (!available.has(serviceId)) {
      const hint = [...available].sort().join(", ");
      throw new Error(`Baseline bootstrap requires service "${serviceId}", but it was not discovered. Available services: ${hint}.`);
    }
  }

  return new DependencyGraph(registry)
    .getGlobalStartupOrder()
    .filter((serviceId) => requestedServiceIds.includes(serviceId));
}

export async function bootstrapBaselineServices(options: BootstrapBaselineOptions = {}): Promise<BootstrapBaselineResult> {
  const runtimeConfig = await ensureRuntimeConfig(resolveRuntimeConfig(options));
  const discovered = await discoverServices(runtimeConfig.servicesRoot);
  await rehydrateDiscoveredServices(discovered);
  const registry = createServiceRegistry(discovered);
  const requestedServiceIds = [...(options.serviceIds ?? DEFAULT_BASELINE_SERVICE_IDS)];
  const serviceOrder = resolveBaselineOrder(registry, requestedServiceIds);
  const summaries: BaselineServiceSummary[] = [];

  for (const serviceId of serviceOrder) {
    const service = registry.getById(serviceId);
    if (!service) {
      throw new Error(`Baseline bootstrap internal error: service "${serviceId}" disappeared after discovery.`);
    }

    if (service.manifest.enabled === false) {
      summaries.push({
        serviceId,
        status: "skipped",
        enabled: false,
        actions: [],
        state: getLifecycleState(serviceId),
        message: `Skipped disabled baseline service "${serviceId}".`,
      });
      continue;
    }

    const actions: BaselineActionSummary[] = [];
    let state = getLifecycleState(serviceId);

    if (state.installed) {
      actions.push({ action: "install", status: "skipped", message: "Already installed." });
    } else {
      const result = await runLifecycleAction(service, registry, "install");
      await writeServiceState(service, result.state);
      state = result.state;
      actions.push({ action: "install", status: "completed", message: result.message });
    }

    if (state.configured) {
      actions.push({ action: "config", status: "skipped", message: "Already configured." });
    } else {
      const result = await runLifecycleAction(service, registry, "config");
      await writeServiceState(service, result.state);
      state = result.state;
      actions.push({ action: "config", status: "completed", message: result.message });
    }

    if (state.running || hasManagedProcess(serviceId)) {
      actions.push({ action: "start", status: "skipped", message: "Already running." });
    } else if (!shouldStartService(service, state)) {
      actions.push({ action: "start", status: "skipped", message: "No executable or artifact command is configured." });
    } else {
      const result = await runLifecycleAction(service, registry, "start");
      await writeServiceState(service, result.state);
      state = result.state;
      actions.push({ action: "start", status: "completed", message: result.message });
    }

    summaries.push({
      serviceId,
      status: "completed",
      enabled: true,
      actions,
      state,
      message: `Baseline service "${serviceId}" processed.`,
    });
  }

  return {
    servicesRoot: runtimeConfig.servicesRoot,
    workspaceRoot: runtimeConfig.workspaceRoot,
    requestedServiceIds,
    serviceOrder,
    services: summaries,
    registry,
  };
}
