import { setTimeout as delay } from "node:timers/promises";
import type { DiscoveredService } from "../../contracts/service.js";
import { getLifecycleState } from "../lifecycle/store.js";
import { buildAggregateHealth, evaluateServiceHealth, evaluateServiceHealthcheck } from "./evaluateHealth.js";
import {
  attributeServiceReadiness,
  type ReadinessAttributionEvidence,
  type ReadinessAttributionOptions,
} from "./readinessAttribution.js";
import type { ServiceHealthcheck, ServiceHealthcheckResult, ServiceHealthResult } from "./types.js";

const DEFAULT_READINESS_INTERVAL_MS = 1_000;
const DEFAULT_READINESS_ATTEMPTS = 10;

export interface ReadinessWaitResult {
  enabled: boolean;
  ready: boolean;
  health: ServiceHealthResult;
  attempts: number;
  message: string;
  attribution: ReadinessAttributionEvidence;
}

const NOT_APPLICABLE_ATTRIBUTION: ReadinessAttributionEvidence = {
  classification: "not_applicable",
  checkedEndpointCount: 0,
};

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

  return {
    enabled: true,
    attempts: Math.max(healthcheck.retries ?? DEFAULT_READINESS_ATTEMPTS, 1),
    intervalMs: healthcheck.interval ?? DEFAULT_READINESS_INTERVAL_MS,
    startPeriodMs: healthcheck.start_period ?? 0,
  };
}

export async function waitForServiceReadiness(
  service: DiscoveredService,
  sharedGlobalEnv: Record<string, string> = {},
  attributionOptions: ReadinessAttributionOptions = {},
): Promise<ReadinessWaitResult> {
  if (service.manifest.healthchecks && service.manifest.healthchecks.length > 0) {
    const checks: ServiceHealthcheckResult[] = [];

    for (const healthcheck of service.manifest.healthchecks) {
      const { attempts, intervalMs, startPeriodMs } = resolveReadinessOptions(healthcheck);
      const required = healthcheck.required !== false;
      let lastCheck: ServiceHealthcheckResult | undefined;

      if (startPeriodMs > 0) {
        await delay(startPeriodMs);
      }

      const maxAttempts = required ? attempts : 1;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        lastCheck = {
          ...(await evaluateServiceHealthcheck(
            healthcheck,
            service.manifest,
            getLifecycleState(service.manifest.id),
            service.serviceRoot,
            service,
            sharedGlobalEnv,
          )),
          attempts: attempt,
        };

        if (lastCheck.healthy || !required) {
          break;
        }

        if (attempt < maxAttempts) {
          await delay(intervalMs);
        }
      }

      if (lastCheck) {
        checks.push(lastCheck);
      }

      if (required && lastCheck && !lastCheck.healthy) {
        const health = buildAggregateHealth(checks);
        return {
          enabled: true,
          ready: false,
          health,
          attempts: checks.reduce((total, check) => total + check.attempts, 0),
          message:
            `Service did not become ready because healthcheck "${lastCheck.id}" failed after ${lastCheck.attempts} readiness attempt(s)` +
            ` with interval ${intervalMs}ms and start period ${startPeriodMs}ms.`,
          attribution: NOT_APPLICABLE_ATTRIBUTION,
        };
      }
    }

    const health = buildAggregateHealth(checks);
    const attribution = health.healthy
      ? await attributeServiceReadiness(
          service,
          getLifecycleState(service.manifest.id),
          sharedGlobalEnv,
          attributionOptions,
        )
      : null;
    return {
      enabled: true,
      ready: health.healthy && (attribution?.ready ?? true),
      health,
      attempts: checks.reduce((total, check) => total + check.attempts, 0),
      message: health.healthy && attribution && !attribution.ready
        ? attribution.message
        : health.healthy
          ? `Start completed after ${checks.length} healthcheck(s) reached required readiness.`
        : `Service did not become ready: ${health.detail}`,
      attribution: attribution?.evidence ?? NOT_APPLICABLE_ATTRIBUTION,
    };
  }

  const { enabled, attempts, intervalMs, startPeriodMs } = resolveReadinessOptions(service.manifest.healthcheck);
  let lastHealth = await evaluateServiceHealth(
    service.manifest,
    getLifecycleState(service.manifest.id),
    service.serviceRoot,
    service,
    sharedGlobalEnv,
  );

  if (!enabled) {
    return {
      enabled: false,
      ready: true,
      health: lastHealth,
      attempts: 1,
      message: "Start completed.",
      attribution: NOT_APPLICABLE_ATTRIBUTION,
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
      sharedGlobalEnv,
    );

    if (lastHealth.healthy) {
      const attribution = await attributeServiceReadiness(
        service,
        getLifecycleState(service.manifest.id),
        sharedGlobalEnv,
        attributionOptions,
      );
      return {
        enabled: true,
        ready: attribution.ready,
        health: lastHealth,
        attempts: attempt,
        message: attribution.ready
          ? `Start completed after readiness succeeded on attempt ${attempt} of ${attempts}.`
          : attribution.message,
        attribution: attribution.evidence,
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
    attribution: NOT_APPLICABLE_ATTRIBUTION,
  };
}
