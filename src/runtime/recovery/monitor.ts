import type { DiscoveredService } from "../../contracts/service.js";
import { evaluateServiceHealth } from "../health/evaluateHealth.js";
import { restartService } from "../lifecycle/actions.js";
import { getLifecycleState } from "../lifecycle/store.js";
import type { ServiceRegistry } from "../manager/ServiceRegistry.js";
import { collectRuntimeGlobalEnv } from "../operator/variables.js";
import { writeServiceState } from "../state/writeState.js";

export type ServiceMonitorEventAction = "restart" | "skip" | "healthy";
export type ServiceMonitorEventReason =
  | "monitoring_disabled"
  | "restart_policy_disabled"
  | "not_installed"
  | "not_configured"
  | "not_running"
  | "crashed"
  | "unhealthy"
  | "unhealthy_threshold"
  | "backoff"
  | "max_attempts"
  | "in_flight"
  | "healthy"
  | "restart_failed";

export interface ServiceMonitorEvent {
  serviceId: string;
  action: ServiceMonitorEventAction;
  reason: ServiceMonitorEventReason;
  message: string;
  at: string;
}

export interface RuntimeServiceMonitorOptions {
  registry: ServiceRegistry;
  intervalMs?: number;
  logger?: Pick<Console, "log" | "warn">;
  now?: () => Date;
}

export interface RuntimeServiceMonitor {
  start: () => void;
  stop: () => void;
  runOnce: () => Promise<ServiceMonitorEvent[]>;
}

interface RestartAttemptState {
  attempts: number;
  nextAllowedAtMs: number;
}

function isPolicyEnabled(value: boolean | undefined): boolean {
  return value === true;
}

function createEvent(
  service: DiscoveredService,
  action: ServiceMonitorEventAction,
  reason: ServiceMonitorEventReason,
  message: string,
  now: () => Date,
): ServiceMonitorEvent {
  return {
    serviceId: service.manifest.id,
    action,
    reason,
    message,
    at: now().toISOString(),
  };
}

export function createRuntimeServiceMonitor(options: RuntimeServiceMonitorOptions): RuntimeServiceMonitor {
  const intervalMs = options.intervalMs ?? 30_000;
  const logger = options.logger ?? console;
  const now = options.now ?? (() => new Date());
  const attemptsByService = new Map<string, RestartAttemptState>();
  const unhealthyCounts = new Map<string, number>();
  const inFlight = new Set<string>();
  let timer: ReturnType<typeof setInterval> | null = null;

  async function restartMonitoredService(
    service: DiscoveredService,
    reason: "crashed" | "unhealthy",
  ): Promise<ServiceMonitorEvent> {
    const serviceId = service.manifest.id;
    const policy = service.manifest.restartPolicy;
    const attemptState = attemptsByService.get(serviceId) ?? { attempts: 0, nextAllowedAtMs: 0 };
    const currentTimeMs = now().getTime();

    if (inFlight.has(serviceId)) {
      return createEvent(service, "skip", "in_flight", "Restart already in progress.", now);
    }

    if (attemptState.nextAllowedAtMs > currentTimeMs) {
      return createEvent(service, "skip", "backoff", "Restart deferred by backoff policy.", now);
    }

    if (policy?.maxAttempts !== undefined && attemptState.attempts >= policy.maxAttempts) {
      return createEvent(service, "skip", "max_attempts", "Restart skipped because maxAttempts was reached.", now);
    }

    inFlight.add(serviceId);
    try {
      const result = await restartService(service, options.registry);
      await writeServiceState(service, result.state);
      const nextAttempts = attemptState.attempts + 1;
      const backoffSeconds = policy?.backoffSeconds ?? 0;
      attemptsByService.set(serviceId, {
        attempts: nextAttempts,
        nextAllowedAtMs: currentTimeMs + backoffSeconds * 1000,
      });
      unhealthyCounts.set(serviceId, 0);
      const message = `Service "${serviceId}" restarted by monitor after ${reason}.`;
      logger.log(`[service-lasso] ${message}`);
      return createEvent(service, "restart", reason, message, now);
    } catch (error) {
      const nextAttempts = attemptState.attempts + 1;
      attemptsByService.set(serviceId, {
        attempts: nextAttempts,
        nextAllowedAtMs: currentTimeMs + (policy?.backoffSeconds ?? 0) * 1000,
      });
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`[service-lasso] Monitor failed to restart "${serviceId}": ${message}`);
      return createEvent(service, "skip", "restart_failed", message, now);
    } finally {
      inFlight.delete(serviceId);
    }
  }

  async function inspectService(service: DiscoveredService): Promise<ServiceMonitorEvent> {
    const serviceId = service.manifest.id;
    const monitoring = service.manifest.monitoring;
    const restartPolicy = service.manifest.restartPolicy;
    const lifecycle = getLifecycleState(serviceId);

    if (service.manifest.enabled === false || !isPolicyEnabled(monitoring?.enabled)) {
      return createEvent(service, "skip", "monitoring_disabled", "Monitoring is not enabled for this service.", now);
    }

    if (!isPolicyEnabled(restartPolicy?.enabled)) {
      return createEvent(service, "skip", "restart_policy_disabled", "Restart policy is not enabled for this service.", now);
    }
    const activeRestartPolicy = restartPolicy!;

    if (!lifecycle.installed) {
      return createEvent(service, "skip", "not_installed", "Service is not installed.", now);
    }

    if (!lifecycle.configured) {
      return createEvent(service, "skip", "not_configured", "Service is not configured.", now);
    }

    if (!lifecycle.running) {
      if (lifecycle.runtime.lastTermination === "crashed" && activeRestartPolicy.onCrash === true) {
        return restartMonitoredService(service, "crashed");
      }

      return createEvent(service, "skip", "not_running", "Service is not running and did not crash.", now);
    }

    const sharedGlobalEnv = collectRuntimeGlobalEnv(options.registry.list());
    const health = await evaluateServiceHealth(service.manifest, lifecycle, service.serviceRoot, service, sharedGlobalEnv);
    if (health.healthy) {
      unhealthyCounts.set(serviceId, 0);
      return createEvent(service, "healthy", "healthy", "Service is healthy.", now);
    }

    if (activeRestartPolicy.onUnhealthy !== true) {
      return createEvent(service, "skip", "unhealthy", "Service is unhealthy but onUnhealthy is not enabled.", now);
    }

    const threshold = monitoring?.unhealthyThreshold ?? 1;
    const unhealthyCount = (unhealthyCounts.get(serviceId) ?? 0) + 1;
    unhealthyCounts.set(serviceId, unhealthyCount);
    if (unhealthyCount < threshold) {
      return createEvent(service, "skip", "unhealthy_threshold", "Service is unhealthy but has not reached threshold.", now);
    }

    return restartMonitoredService(service, "unhealthy");
  }

  async function runOnce(): Promise<ServiceMonitorEvent[]> {
    const events: ServiceMonitorEvent[] = [];

    for (const service of options.registry.list()) {
      events.push(await inspectService(service));
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
