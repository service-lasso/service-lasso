import { setTimeout as delay } from "node:timers/promises";
import type { DiscoveredService } from "../../contracts/service.js";
import { getLifecycleState } from "../lifecycle/store.js";
import { evaluateServiceHealth } from "./evaluateHealth.js";
import type { ServiceHealthcheck, ServiceHealthResult } from "./types.js";

const DEFAULT_READINESS_INTERVAL_MS = 1_000;

export interface ReadinessWaitResult {
  enabled: boolean;
  ready: boolean;
  health: ServiceHealthResult;
  attempts: number;
  message: string;
}

function resolveReadinessOptions(healthcheck?: ServiceHealthcheck): {
  enabled: boolean;
  attempts: number;
  intervalMs: number;
  startPeriodMs: number;
} {
  if (!healthcheck) {
    return {
      enabled: false,
      attempts: 1,
      intervalMs: DEFAULT_READINESS_INTERVAL_MS,
      startPeriodMs: 0,
    };
  }

  const enabled =
    healthcheck.retries !== undefined ||
    healthcheck.interval !== undefined ||
    healthcheck.start_period !== undefined;

  return {
    enabled,
    attempts: Math.max(healthcheck.retries ?? 1, 1),
    intervalMs: healthcheck.interval ?? DEFAULT_READINESS_INTERVAL_MS,
    startPeriodMs: healthcheck.start_period ?? 0,
  };
}

export async function waitForServiceReadiness(service: DiscoveredService): Promise<ReadinessWaitResult> {
  const { enabled, attempts, intervalMs, startPeriodMs } = resolveReadinessOptions(service.manifest.healthcheck);
  let lastHealth = await evaluateServiceHealth(
    service.manifest,
    getLifecycleState(service.manifest.id),
    service.serviceRoot,
    service,
  );

  if (!enabled) {
    return {
      enabled: false,
      ready: true,
      health: lastHealth,
      attempts: 1,
      message: "Start completed.",
    };
  }

  if (startPeriodMs > 0) {
    await delay(startPeriodMs);
  }

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    lastHealth = await evaluateServiceHealth(
      service.manifest,
      getLifecycleState(service.manifest.id),
      service.serviceRoot,
      service,
    );

    if (lastHealth.healthy) {
      return {
        enabled: true,
        ready: true,
        health: lastHealth,
        attempts: attempt,
        message: `Start completed after readiness succeeded on attempt ${attempt} of ${attempts}.`,
      };
    }

    if (attempt < attempts) {
      await delay(intervalMs);
    }
  }

  return {
    enabled: true,
    ready: false,
    health: lastHealth,
    attempts,
    message:
      `Service did not become ready after ${attempts} readiness attempt(s)` +
      ` with interval ${intervalMs}ms and start period ${startPeriodMs}ms.`,
  };
}
