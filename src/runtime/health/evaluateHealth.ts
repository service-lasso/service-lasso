import type { ServiceManifest } from "../../contracts/service.js";
import type { DiscoveredService } from "../../contracts/service.js";
import type { ServiceLifecycleState } from "../lifecycle/types.js";
import { checkFileHealth } from "./checkFile.js";
import { checkHttpHealth } from "./checkHttp.js";
import { checkProcessHealth } from "./checkProcess.js";
import { checkTcpHealth } from "./checkTcp.js";
import { checkUdpHealth } from "./checkUdp.js";
import { checkVariableHealth } from "./checkVariable.js";
import type { ServiceHealthcheck, ServiceHealthcheckResult, ServiceHealthResult } from "./types.js";
import { isProviderRole } from "../roles.js";
import { resolveServiceText } from "../operator/variables.js";

function inferSingleTcpPort(resolvedPorts: Record<string, number>): number | string {
  const validPorts = [...new Set(Object.values(resolvedPorts).filter((port) => Number.isInteger(port) && port > 0 && port <= 65535))];

  if (validPorts.length === 1) {
    return validPorts[0];
  }

  if (validPorts.length === 0) {
    return "TCP healthcheck requires an explicit address or host + port because no resolved service port is available.";
  }

  return "TCP healthcheck requires an explicit address or host + port because multiple service ports are available.";
}

async function evaluateHealthcheck(
  healthcheck: ServiceHealthcheck,
  manifest: ServiceManifest,
  lifecycle: ServiceLifecycleState,
  serviceRoot?: string,
  service?: DiscoveredService,
  sharedGlobalEnv: Record<string, string> = {},
): Promise<ServiceHealthResult> {
  if (healthcheck.type === "process") {
    return checkProcessHealth(lifecycle);
  }

  const resolvedPorts = Object.keys(lifecycle.runtime.ports).length > 0 ? lifecycle.runtime.ports : manifest.ports ?? {};

  if (healthcheck.type === "http") {
    return checkHttpHealth({
      ...healthcheck,
      url: service ? resolveServiceText(healthcheck.url, service, sharedGlobalEnv, resolvedPorts) : healthcheck.url,
      cookies: service
        ? Object.fromEntries(
            Object.entries(healthcheck.cookies ?? {}).map(([name, value]) => [
              name,
              resolveServiceText(value, service, sharedGlobalEnv, resolvedPorts),
            ]),
          )
        : healthcheck.cookies,
    });
  }

  if (healthcheck.type === "tcp") {
    if (healthcheck.address !== undefined) {
      return checkTcpHealth({
        ...healthcheck,
        address: service
          ? resolveServiceText(healthcheck.address, service, sharedGlobalEnv, resolvedPorts)
          : healthcheck.address,
      });
    }

    if (healthcheck.host !== undefined && healthcheck.port !== undefined) {
      return checkTcpHealth({
        ...healthcheck,
        host: service
          ? resolveServiceText(healthcheck.host, service, sharedGlobalEnv, resolvedPorts)
          : healthcheck.host,
        port: service
          ? resolveServiceText(String(healthcheck.port), service, sharedGlobalEnv, resolvedPorts)
          : healthcheck.port,
      });
    }

    const inferredPort = inferSingleTcpPort(resolvedPorts);
    if (typeof inferredPort === "string") {
      return {
        type: "tcp",
        healthy: false,
        detail: inferredPort,
      };
    }

    return checkTcpHealth({
      ...healthcheck,
      host: "127.0.0.1",
      port: inferredPort,
    });
  }

  if (healthcheck.type === "udp") {
    return checkUdpHealth({
      ...healthcheck,
      address:
        service && healthcheck.address !== undefined
          ? resolveServiceText(healthcheck.address, service, sharedGlobalEnv, resolvedPorts)
          : healthcheck.address,
      host:
        service && healthcheck.host !== undefined
          ? resolveServiceText(healthcheck.host, service, sharedGlobalEnv, resolvedPorts)
          : healthcheck.host,
      port:
        service && healthcheck.port !== undefined
          ? resolveServiceText(String(healthcheck.port), service, sharedGlobalEnv, resolvedPorts)
          : healthcheck.port,
      send: service ? resolveServiceText(healthcheck.send, service, sharedGlobalEnv, resolvedPorts) : healthcheck.send,
      expect: service
        ? resolveServiceText(healthcheck.expect, service, sharedGlobalEnv, resolvedPorts)
        : healthcheck.expect,
    });
  }

  if (healthcheck.type === "file") {
    return checkFileHealth(
      {
        ...healthcheck,
        file: service
          ? resolveServiceText(healthcheck.file, service, sharedGlobalEnv, resolvedPorts)
          : healthcheck.file,
      },
      serviceRoot,
    );
  }

  if (healthcheck.type === "variable") {
    return checkVariableHealth(
      healthcheck,
      service,
      sharedGlobalEnv,
      resolvedPorts,
    );
  }

  return {
    type: "unknown",
    healthy: false,
    detail: "Unsupported healthcheck type.",
  };
}

function toCheckResult(
  healthcheck: ServiceHealthcheck,
  health: ServiceHealthResult,
  attempts = 1,
): ServiceHealthcheckResult {
  return {
    id: healthcheck.id ?? healthcheck.type,
    type: healthcheck.type,
    required: healthcheck.required !== false,
    healthy: health.healthy,
    attempts,
    detail: health.detail,
  };
}

function aggregateHealth(checks: ServiceHealthcheckResult[]): ServiceHealthResult {
  const failedRequired = checks.filter((check) => check.required && !check.healthy);

  return {
    type: "aggregate",
    healthy: failedRequired.length === 0,
    detail:
      failedRequired.length === 0
        ? "All required healthchecks passed."
        : `Required healthcheck(s) failed: ${failedRequired.map((check) => check.id).join(", ")}.`,
    checks,
  };
}

export async function evaluateServiceHealthcheck(
  healthcheck: ServiceHealthcheck,
  manifest: ServiceManifest,
  lifecycle: ServiceLifecycleState,
  serviceRoot?: string,
  service?: DiscoveredService,
  sharedGlobalEnv: Record<string, string> = {},
): Promise<ServiceHealthcheckResult> {
  const health = await evaluateHealthcheck(healthcheck, manifest, lifecycle, serviceRoot, service, sharedGlobalEnv);
  return toCheckResult(healthcheck, health);
}

export function buildAggregateHealth(checks: ServiceHealthcheckResult[]): ServiceHealthResult {
  return aggregateHealth(checks);
}

export async function evaluateServiceHealth(
  manifest: ServiceManifest,
  lifecycle: ServiceLifecycleState,
  serviceRoot?: string,
  service?: DiscoveredService,
  sharedGlobalEnv: Record<string, string> = {},
): Promise<ServiceHealthResult> {
  const healthcheck = manifest.healthcheck;
  const healthchecks = manifest.healthchecks && (!isProviderRole(manifest) || healthcheck) ? manifest.healthchecks : undefined;

  if (healthchecks && healthchecks.length > 0) {
    const checks: ServiceHealthcheckResult[] = [];
    for (const entry of healthchecks) {
      checks.push(await evaluateServiceHealthcheck(entry, manifest, lifecycle, serviceRoot, service, sharedGlobalEnv));
    }
    return aggregateHealth(checks);
  }

  if (!healthcheck && isProviderRole(manifest)) {
    const ready = lifecycle.installed && lifecycle.configured;
    return {
      type: "provider",
      healthy: ready,
      detail: ready
        ? "Provider is installed/configured and does not require a managed daemon process."
        : "Provider is not installed/configured yet.",
    };
  }

  if (!healthcheck || healthcheck.type === "process") {
    return checkProcessHealth(lifecycle);
  }

  return evaluateHealthcheck(healthcheck, manifest, lifecycle, serviceRoot, service, sharedGlobalEnv);
}
