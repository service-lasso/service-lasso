import { readFile } from "node:fs/promises";
import type { DiscoveredService } from "../../contracts/service.js";
import type { ServiceLifecycleState } from "../lifecycle/types.js";
import {
  getServiceRuntimeLogPaths,
  listRuntimeLogArchives,
  SERVICE_RUNTIME_LOG_ARCHIVE_RETENTION,
} from "./logs.js";

export interface ServiceMetricsPayload {
  serviceId: string;
  process: {
    running: boolean;
    pid: number | null;
    command: string | null;
    provider: "direct" | "node" | "python" | null;
    providerServiceId: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    currentRunDurationMs: number | null;
    lastRunDurationMs: number | null;
    totalRunDurationMs: number;
    launchCount: number;
    stopCount: number;
    exitCount: number;
    crashCount: number;
    restartCount: number;
    lastTermination: "stopped" | "exited" | "crashed" | null;
  };
  logs: {
    current: {
      logPath: string;
      stdoutPath: string;
      stderrPath: string;
      combinedEntries: number;
      stdoutLines: number;
      stderrLines: number;
    };
    archives: {
      count: number;
      maxArchives: number;
    };
  };
}

function calculateDurationMs(startedAt: string | null, finishedAt: string | null): number | null {
  if (!startedAt || !finishedAt) {
    return null;
  }

  const startedMs = Date.parse(startedAt);
  const finishedMs = Date.parse(finishedAt);

  if (!Number.isFinite(startedMs) || !Number.isFinite(finishedMs)) {
    return null;
  }

  return Math.max(0, finishedMs - startedMs);
}

async function readLogLineCount(logPath: string): Promise<number> {
  try {
    const content = await readFile(logPath, "utf8");
    if (content.length === 0) {
      return 0;
    }

    return content
      .split(/\r?\n/)
      .filter((line) => line.length > 0)
      .length;
  } catch {
    return 0;
  }
}

export async function buildServiceMetrics(
  service: DiscoveredService,
  lifecycle: ServiceLifecycleState,
): Promise<ServiceMetricsPayload> {
  const runtimeLogPaths = getServiceRuntimeLogPaths(service.serviceRoot);
  const [combinedEntries, stdoutLines, stderrLines, archives] = await Promise.all([
    readLogLineCount(runtimeLogPaths.logPath),
    readLogLineCount(runtimeLogPaths.stdoutPath),
    readLogLineCount(runtimeLogPaths.stderrPath),
    listRuntimeLogArchives(service.serviceRoot),
  ]);

  return {
    serviceId: service.manifest.id,
    process: {
      running: lifecycle.running,
      pid: lifecycle.runtime.pid,
      command: lifecycle.runtime.command,
      provider: lifecycle.runtime.provider,
      providerServiceId: lifecycle.runtime.providerServiceId,
      startedAt: lifecycle.runtime.startedAt,
      finishedAt: lifecycle.runtime.finishedAt,
      currentRunDurationMs: lifecycle.running
        ? calculateDurationMs(lifecycle.runtime.startedAt, new Date().toISOString())
        : null,
      lastRunDurationMs: lifecycle.runtime.metrics.lastRunDurationMs,
      totalRunDurationMs: lifecycle.runtime.metrics.totalRunDurationMs,
      launchCount: lifecycle.runtime.metrics.launchCount,
      stopCount: lifecycle.runtime.metrics.stopCount,
      exitCount: lifecycle.runtime.metrics.exitCount,
      crashCount: lifecycle.runtime.metrics.crashCount,
      restartCount: lifecycle.runtime.metrics.restartCount,
      lastTermination: lifecycle.runtime.lastTermination,
    },
    logs: {
      current: {
        ...runtimeLogPaths,
        combinedEntries,
        stdoutLines,
        stderrLines,
      },
      archives: {
        count: archives.length,
        maxArchives: SERVICE_RUNTIME_LOG_ARCHIVE_RETENTION,
      },
    },
  };
}
