import path from "node:path";
import { readFile } from "node:fs/promises";
import type { DiscoveredService } from "../../contracts/service.js";
import type { ServiceLifecycleState } from "../lifecycle/types.js";

export interface ServiceLogEntry {
  level: "info" | "stdout" | "stderr";
  message: string;
}

export interface ServiceRuntimeLogPaths {
  logPath: string;
  stdoutPath: string;
  stderrPath: string;
}

export interface ServiceLogsPayload extends ServiceRuntimeLogPaths {
  serviceId: string;
  entries: ServiceLogEntry[];
}

interface PersistedRuntimeLogEntry {
  level?: "stdout" | "stderr";
  message?: string;
}

export function getServiceRuntimeLogPaths(serviceRoot: string): ServiceRuntimeLogPaths {
  const runtimeLogsRoot = path.join(serviceRoot, "logs", "runtime");

  return {
    logPath: path.join(runtimeLogsRoot, "service.log"),
    stdoutPath: path.join(runtimeLogsRoot, "stdout.log"),
    stderrPath: path.join(runtimeLogsRoot, "stderr.log"),
  };
}

function buildSyntheticEntries(serviceId: string, lifecycle: ServiceLifecycleState): ServiceLogEntry[] {
  return lifecycle.actionHistory.map((action) => ({
    level: "info" as const,
    message: `${serviceId}:${action}`,
  }));
}

async function readRuntimeLogEntries(logPath: string): Promise<ServiceLogEntry[]> {
  try {
    const content = await readFile(logPath, "utf8");
    const entries = content
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        try {
          return JSON.parse(line) as PersistedRuntimeLogEntry;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is PersistedRuntimeLogEntry => entry !== null)
      .filter(
        (entry): entry is { level: "stdout" | "stderr"; message: string } =>
          (entry.level === "stdout" || entry.level === "stderr") && typeof entry.message === "string",
      );

    return entries.map((entry) => ({
      level: entry.level,
      message: entry.message,
    }));
  } catch {
    return [];
  }
}

export async function buildServiceLogs(
  service: DiscoveredService,
  lifecycle: ServiceLifecycleState,
): Promise<ServiceLogsPayload> {
  const runtimeLogPaths = getServiceRuntimeLogPaths(service.serviceRoot);
  const capturedEntries = await readRuntimeLogEntries(runtimeLogPaths.logPath);

  return {
    serviceId: service.manifest.id,
    ...runtimeLogPaths,
    entries: capturedEntries.length > 0 ? capturedEntries : buildSyntheticEntries(service.manifest.id, lifecycle),
  };
}
