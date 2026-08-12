import { discoverServices } from "../discovery/discoverServices.js";
import { createServiceRegistry } from "../manager/DependencyGraph.js";
import { ensureRuntimeConfig, resolveRuntimeConfig, type RuntimeConfigOptions } from "../config.js";
import { runAndRecordDoctorPreflight, type DoctorRunResult } from "../recovery/doctor.js";
import { readServiceRecoveryHistory, type ServiceRecoveryHistoryState } from "../recovery/history.js";
import {
  buildRestartSafetyPreflightReport,
  type RestartSafetyPreflightReport,
} from "../operator/restart-safety-preflight.js";
import { rehydrateDiscoveredServices } from "../state/rehydrate.js";

export type RecoveryCliAction = "status" | "doctor" | "restart-preflight";

export interface RecoveryCliOptions extends RuntimeConfigOptions {
  action: RecoveryCliAction;
  serviceId?: string;
}

export type RecoveryCliResult =
  | {
      action: "status";
      servicesRoot: string;
      workspaceRoot: string;
      services: Array<{
        serviceId: string;
        recovery: ServiceRecoveryHistoryState;
      }>;
    }
  | {
      action: "doctor";
      servicesRoot: string;
      workspaceRoot: string;
      serviceId: string;
      doctor: DoctorRunResult;
      recovery: ServiceRecoveryHistoryState;
    }
  | {
      action: "restart-preflight";
      servicesRoot: string;
      workspaceRoot: string;
      serviceId: string;
      preflight: RestartSafetyPreflightReport;
    };

export async function runRecoveryCliAction(options: RecoveryCliOptions): Promise<RecoveryCliResult> {
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

  if (options.action === "status") {
    const services = options.serviceId
      ? [registry.getById(options.serviceId)].flatMap((service) => service ? [service] : [])
      : registry.list();

    if (options.serviceId && services.length === 0) {
      throw new Error(`Unknown service id: ${options.serviceId}.`);
    }

    return {
      action: "status",
      servicesRoot: runtimeConfig.servicesRoot,
      workspaceRoot: runtimeConfig.workspaceRoot,
      services: await Promise.all(services.map(async (service) => ({
        serviceId: service.manifest.id,
        recovery: await readServiceRecoveryHistory(service),
      }))),
    };
  }

  if (!options.serviceId) {
    throw new Error(`The "recovery ${options.action}" command requires a <serviceId> argument.`);
  }

  const service = registry.getById(options.serviceId);
  if (!service) {
    throw new Error(`Unknown service id: ${options.serviceId}.`);
  }

  if (options.action === "restart-preflight") {
    return {
      action: "restart-preflight",
      servicesRoot: runtimeConfig.servicesRoot,
      workspaceRoot: runtimeConfig.workspaceRoot,
      serviceId: service.manifest.id,
      preflight: buildRestartSafetyPreflightReport(service, registry),
    };
  }

  const doctor = await runAndRecordDoctorPreflight(service);
  return {
    action: "doctor",
    servicesRoot: runtimeConfig.servicesRoot,
    workspaceRoot: runtimeConfig.workspaceRoot,
    serviceId: service.manifest.id,
    doctor,
    recovery: await readServiceRecoveryHistory(service),
  };
}
