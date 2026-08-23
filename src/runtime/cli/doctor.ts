import { ensureRuntimeConfig, resolveRuntimeConfig } from "../config.js";
import { discoverServices } from "../discovery/discoverServices.js";
import { DependencyGraph, createServiceRegistry } from "../manager/DependencyGraph.js";
import { buildRuntimeDoctorStatus } from "../doctor/status.js";
import type { RuntimeDoctorResponse } from "../../contracts/api.js";

export type DoctorCliAction = "status";
export type DoctorCliResult = RuntimeDoctorResponse & { action: DoctorCliAction };

export interface DoctorCliOptions {
  action: DoctorCliAction;
  servicesRoot?: string;
  workspaceRoot?: string;
  version?: string;
}

export async function runDoctorCliAction(options: DoctorCliOptions): Promise<DoctorCliResult> {
  const config = await ensureRuntimeConfig(resolveRuntimeConfig(options));
  const discovered = await discoverServices(config.servicesRoot);
  const registry = createServiceRegistry(discovered);
  const graph = new DependencyGraph(registry);
  const response = await buildRuntimeDoctorStatus({ config, registry, graph });
  return {
    action: options.action,
    ...response,
  };
}
