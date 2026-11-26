import { createHash } from "node:crypto";
import type { DiscoveredService } from "../../contracts/service.js";
import type { ServiceLifecycleState } from "../lifecycle/types.js";
import { resolveServiceText } from "../operator/variables.js";
import { isProviderRole } from "../roles.js";
import type { HttpHealthcheck, ServiceHealthcheck } from "./types.js";

export interface HttpCheckSample {
  at: string;
  passed: boolean;
  durationMs: number;
}
export interface HttpCheckSampleRow {
  serviceId: string;
  state: "configured" | "not_configured";
  samples: HttpCheckSample[];
}

/** Matches evaluateServiceHealth's effective manifest order, including providers. */
export function primaryHttpCheck(service: DiscoveredService): HttpHealthcheck | undefined {
  const manifest = service.manifest;
  const checks = manifest.healthchecks?.length && (!isProviderRole(manifest) || manifest.healthcheck)
    ? manifest.healthchecks : manifest.healthcheck ? [manifest.healthcheck] : [];
  return checks.find((check): check is HttpHealthcheck => check.type === "http");
}

function configurationKey(service: DiscoveredService, lifecycle: ServiceLifecycleState, env: Record<string, string>): string | null {
  const check = primaryHttpCheck(service);
  if (service.manifest.enabled === false || !check) return null;
  const ports = lifecycle.running && Object.keys(lifecycle.runtime.ports).length
    ? lifecycle.runtime.ports : { ...lifecycle.runtime.ports, ...service.manifest.ports };
  // Only a digest is retained. Neither the recorder nor its DTO keeps target/secret material.
  try {
    const resolved = {
      ...check,
      url: resolveServiceText(check.url, service, env, ports),
      cookies: Object.fromEntries(Object.entries(check.cookies ?? {}).map(([key, value]) => [key, resolveServiceText(value, service, env, ports)])),
    };
    return createHash("sha256").update(JSON.stringify([service.serviceRoot, resolved])).digest("hex");
  } catch {
    // Resolution did not produce a target: never invent an HTTP observation.
    return null;
  }
}

/** Owned by exactly one runtime/listener generation; never persisted or global. */
export class HttpCheckSampleRecorder {
  readonly #series = new Map<string, { key: string; samples: HttpCheckSample[] }>();
  constructor(readonly now: () => Date = () => new Date()) {}

  row(service: DiscoveredService, lifecycle: ServiceLifecycleState, env: Record<string, string>, observedAt = this.now()): HttpCheckSampleRow {
    const serviceId = service.manifest.id;
    const key = configurationKey(service, lifecycle, env);
    if (!key) return { serviceId, state: service.manifest.enabled !== false && primaryHttpCheck(service) ? "configured" : "not_configured", samples: [] };
    const series = this.#series.get(serviceId);
    const observedAtMs = observedAt.getTime();
    const samples = series?.key === key ? series.samples
      .filter(sample => Date.parse(sample.at) >= observedAtMs - 900_000 && Date.parse(sample.at) <= observedAtMs)
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(-60).map(sample => ({ ...sample })) : [];
    return { serviceId, state: "configured", samples };
  }

  observer(service: DiscoveredService, lifecycle: ServiceLifecycleState, env: Record<string, string>): (check: ServiceHealthcheck, passed: boolean, durationMs: number) => void {
    const primary = primaryHttpCheck(service);
    const key = configurationKey(service, lifecycle, env);
    if (key && this.#series.get(service.manifest.id)?.key !== key) this.#series.set(service.manifest.id, { key, samples: [] });
    return (check, passed, durationMs) => {
      if (check !== primary || !key) return;
      const series = this.#series.get(service.manifest.id);
      if (!series || series.key !== key) return;
      series.samples.push({ at: this.now().toISOString(), passed, durationMs: Math.max(0, Math.round(durationMs)) });
      series.samples = series.samples.slice(-60);
    };
  }
}
