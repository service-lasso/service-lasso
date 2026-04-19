import path from "node:path";
import type { DiscoveredService } from "../../contracts/service.js";
import type { ServiceLifecycleState } from "../lifecycle/types.js";

export interface ServiceLogEntry {
  level: "info";
  message: string;
}

export interface ServiceLogsPayload {
  serviceId: string;
  logPath: string;
  entries: ServiceLogEntry[];
}

export function buildServiceLogs(
  service: DiscoveredService,
  lifecycle: ServiceLifecycleState,
): ServiceLogsPayload {
  const logPath = path.join(service.serviceRoot, "logs", "service.log");
  const entries = lifecycle.actionHistory.map((action) => ({
    level: "info" as const,
    message: `${service.manifest.id}:${action}`,
  }));

  return {
    serviceId: service.manifest.id,
    logPath,
    entries,
  };
}
