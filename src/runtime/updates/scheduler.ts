import type { DiscoveredService, ServiceUpdateMode } from "../../contracts/service.js";
import type { ServiceRegistry } from "../manager/ServiceRegistry.js";
import { checkServiceUpdate } from "./check.js";
import {
  downloadServiceUpdateCandidate,
  installServiceUpdateCandidate,
  UpdateInstallDeferredError,
} from "./actions.js";
import { persistUpdateCheckResult } from "./state.js";

export type UpdateSchedulerEventAction = "check" | "download" | "install" | "skip";
export type UpdateSchedulerEventReason =
  | "updates_disabled"
  | "interval_not_elapsed"
  | "in_flight"
  | "latest"
  | "pinned"
  | "update_available"
  | "downloaded"
  | "installed"
  | "install_deferred"
  | "check_failed"
  | "unavailable"
  | "action_failed";

export interface UpdateSchedulerEvent {
  serviceId: string;
  action: UpdateSchedulerEventAction;
  reason: UpdateSchedulerEventReason;
  mode: ServiceUpdateMode;
  message: string;
  at: string;
}

export interface RuntimeUpdateSchedulerOptions {
  registry: ServiceRegistry;
  intervalMs?: number;
  logger?: Pick<Console, "log" | "warn">;
  now?: () => Date;
}

export interface RuntimeUpdateScheduler {
  start: () => void;
  stop: () => void;
  runOnce: (options?: { force?: boolean }) => Promise<UpdateSchedulerEvent[]>;
}

function isActiveMode(mode: ServiceUpdateMode): boolean {
  return mode === "notify" || mode === "download" || mode === "install";
}

function getMode(service: DiscoveredService): ServiceUpdateMode {
  if (service.manifest.updates?.enabled === false || service.manifest.updates?.mode === "disabled") {
    return "disabled";
  }

  return service.manifest.updates?.mode ?? "disabled";
}

function getCheckIntervalMs(service: DiscoveredService, fallbackIntervalMs: number): number {
  return (service.manifest.updates?.checkIntervalSeconds ?? Math.ceil(fallbackIntervalMs / 1000)) * 1000;
}

function createEvent(
  service: DiscoveredService,
  action: UpdateSchedulerEventAction,
  reason: UpdateSchedulerEventReason,
  mode: ServiceUpdateMode,
  message: string,
  now: () => Date,
): UpdateSchedulerEvent {
  return {
    serviceId: service.manifest.id,
    action,
    reason,
    mode,
    message,
    at: now().toISOString(),
  };
}

export function createRuntimeUpdateScheduler(options: RuntimeUpdateSchedulerOptions): RuntimeUpdateScheduler {
  const intervalMs = options.intervalMs ?? 60_000;
  const logger = options.logger ?? console;
  const now = options.now ?? (() => new Date());
  const lastCheckedAtMs = new Map<string, number>();
  const inFlight = new Set<string>();
  let timer: ReturnType<typeof setInterval> | null = null;

  async function inspectService(service: DiscoveredService, force: boolean): Promise<UpdateSchedulerEvent> {
    const mode = getMode(service);
    const currentTimeMs = now().getTime();
    const serviceId = service.manifest.id;

    if (!isActiveMode(mode) || service.manifest.updates?.track === undefined || service.manifest.updates.track === "pinned") {
      return createEvent(service, "skip", "updates_disabled", mode, "Updates are not enabled for this service.", now);
    }

    if (inFlight.has(serviceId)) {
      return createEvent(service, "skip", "in_flight", mode, "Update action is already in progress.", now);
    }

    const nextAllowedAtMs = (lastCheckedAtMs.get(serviceId) ?? 0) + getCheckIntervalMs(service, intervalMs);
    if (!force && lastCheckedAtMs.has(serviceId) && currentTimeMs < nextAllowedAtMs) {
      return createEvent(service, "skip", "interval_not_elapsed", mode, "Update check interval has not elapsed.", now);
    }

    inFlight.add(serviceId);
    try {
      if (mode === "notify") {
        const result = await checkServiceUpdate(service);
        await persistUpdateCheckResult(service, result);
        lastCheckedAtMs.set(serviceId, currentTimeMs);
        if (result.status === "update_available") {
          const message = `Service "${serviceId}" has update ${result.current.installedTag ?? result.current.manifestTag ?? "unknown"} -> ${result.available?.tag ?? "unknown"}.`;
          logger.log(`[service-lasso] ${message}`);
          return createEvent(service, "check", "update_available", mode, message, now);
        }

        if (result.status === "check_failed" || result.status === "unavailable") {
          logger.warn(`[service-lasso] Update check for "${serviceId}" failed: ${result.reason}`);
          return createEvent(service, "check", result.status, mode, result.reason, now);
        }

        return createEvent(service, "check", result.status === "pinned" ? "pinned" : "latest", mode, result.reason, now);
      }

      if (mode === "download") {
        const result = await downloadServiceUpdateCandidate(service);
        lastCheckedAtMs.set(serviceId, currentTimeMs);
        const message = `Service "${serviceId}" downloaded update candidate ${result.update.downloadedCandidate?.tag ?? "unknown"}.`;
        logger.log(`[service-lasso] ${message}`);
        return createEvent(service, "download", "downloaded", mode, message, now);
      }

      const result = await installServiceUpdateCandidate(service, { registry: options.registry });
      lastCheckedAtMs.set(serviceId, currentTimeMs);
      const message = `Service "${serviceId}" installed update ${result.state.installArtifacts.artifact?.tag ?? "unknown"}.`;
      logger.log(`[service-lasso] ${message}`);
      return createEvent(service, "install", "installed", mode, message, now);
    } catch (error) {
      lastCheckedAtMs.set(serviceId, currentTimeMs);
      if (error instanceof UpdateInstallDeferredError) {
        logger.log(`[service-lasso] Update install deferred for "${serviceId}": ${error.message}`);
        return createEvent(service, "skip", "install_deferred", mode, error.message, now);
      }

      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`[service-lasso] Update scheduler action failed for "${serviceId}": ${message}`);
      return createEvent(service, "skip", "action_failed", mode, message, now);
    } finally {
      inFlight.delete(serviceId);
    }
  }

  async function runOnce(runOptions: { force?: boolean } = {}): Promise<UpdateSchedulerEvent[]> {
    const events: UpdateSchedulerEvent[] = [];

    for (const service of options.registry.list()) {
      events.push(await inspectService(service, runOptions.force === true));
    }

    return events;
  }

  return {
    start: () => {
      if (timer) {
        return;
      }

      timer = setInterval(() => {
        void runOnce();
      }, intervalMs);
      timer.unref?.();
    },
    stop: () => {
      if (!timer) {
        return;
      }

      clearInterval(timer);
      timer = null;
    },
    runOnce,
  };
}
