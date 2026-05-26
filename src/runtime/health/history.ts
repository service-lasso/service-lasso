import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { DiscoveredService, ServiceManifest } from "../../contracts/service.js";
import { getServiceStatePaths, relativizeServiceRootPath } from "../state/paths.js";
import type { ServiceHealthResult } from "./types.js";

export const DEFAULT_HEALTH_HISTORY_LIMIT = 50;

export type ServiceHealthTransitionStatus = "healthy" | "unhealthy";

export interface ServiceHealthObservedTarget {
  type: ServiceHealthResult["type"];
  url?: string;
  address?: string;
  port?: number;
  path?: string;
  variable?: string;
}

export interface ServiceHealthTransitionEvent {
  serviceId: string;
  status: ServiceHealthTransitionStatus;
  checkType: ServiceHealthResult["type"];
  observed: ServiceHealthObservedTarget;
  reason: string;
  detail: string;
  at: string;
}

export interface ServiceHealthHistoryState {
  serviceId: string;
  updatedAt: string;
  transitions: ServiceHealthTransitionEvent[];
}

export interface ServiceHealthRegressionServiceSummary {
  serviceId: string;
  transitionCount: number;
  firstFailure: ServiceHealthTransitionEvent | null;
  latestState: ServiceHealthTransitionEvent | null;
  flappingCount: number;
  impacted: boolean;
}

export interface ServiceHealthRegressionSummary {
  serviceCount: number;
  impactedServiceIds: string[];
  firstFailure: ServiceHealthTransitionEvent | null;
  latestState: ServiceHealthTransitionEvent | null;
  flappingCount: number;
  services: ServiceHealthRegressionServiceSummary[];
}

const healthHistoryAppendQueues = new Map<string, Promise<void>>();

function nowIso(): string {
  return new Date().toISOString();
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function statusFromHealth(health: ServiceHealthResult): ServiceHealthTransitionStatus {
  return health.healthy ? "healthy" : "unhealthy";
}

function sanitizeUrl(value: string): string {
  try {
    const parsed = new URL(value);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "<invalid-url>";
  }
}

function sanitizeAddress(value: string): string {
  const trimmed = value.trim();
  const separator = trimmed.lastIndexOf(":");
  if (separator <= 0 || separator === trimmed.length - 1) {
    return "<invalid-address>";
  }

  const host = trimmed.slice(0, separator);
  const port = Number(trimmed.slice(separator + 1));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return "<invalid-address>";
  }

  return `${host}:${port}`;
}

function portFromAddress(value: string): number | undefined {
  const port = Number(value.trim().slice(value.trim().lastIndexOf(":") + 1));
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined;
}

function sanitizeVariable(value: string): string {
  const match = value.trim().match(/^\$\{([A-Z0-9_]+)\}$/i);
  return match ? match[1] : "<expression>";
}

function sanitizeDetail(value: string): string {
  return value
    .replace(/https?:\/\/[^\s)]+/gi, (url) => sanitizeUrl(url))
    .replace(/([?&](?:token|secret|password|key|credential)=)[^\s&]+/gi, "$1<redacted>")
    .slice(0, 500);
}

function observedTarget(
  manifest: ServiceManifest,
  serviceRoot: string,
  health: ServiceHealthResult,
): ServiceHealthObservedTarget {
  const healthcheck = manifest.healthcheck;

  if (healthcheck?.type === "http") {
    return {
      type: health.type,
      url: sanitizeUrl(healthcheck.url),
    };
  }

  if (healthcheck?.type === "tcp") {
    const address = sanitizeAddress(healthcheck.address);
    return {
      type: health.type,
      address,
      port: portFromAddress(address),
    };
  }

  if (healthcheck?.type === "file") {
    const configuredPath = healthcheck.file.trim();
    const targetPath = path.isAbsolute(configuredPath) ? configuredPath : path.resolve(serviceRoot, configuredPath);
    return {
      type: health.type,
      path: relativizeServiceRootPath(serviceRoot, targetPath) ?? "<unknown>",
    };
  }

  if (healthcheck?.type === "variable") {
    return {
      type: health.type,
      variable: sanitizeVariable(healthcheck.variable),
    };
  }

  return {
    type: health.type,
  };
}

function normalizeObservedTarget(value: unknown, fallbackType: ServiceHealthResult["type"]): ServiceHealthObservedTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { type: fallbackType };
  }

  const record = value as Record<string, unknown>;
  return {
    type: stringOr(record.type, fallbackType) as ServiceHealthResult["type"],
    url: typeof record.url === "string" ? sanitizeUrl(record.url) : undefined,
    address: typeof record.address === "string" ? sanitizeAddress(record.address) : undefined,
    port: typeof record.port === "number" && Number.isInteger(record.port) ? record.port : undefined,
    path: typeof record.path === "string" ? record.path : undefined,
    variable: typeof record.variable === "string" ? sanitizeVariable(record.variable) : undefined,
  };
}

function normalizeTransition(value: unknown, fallbackServiceId: string): ServiceHealthTransitionEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const status = record.status === "healthy" || record.status === "unhealthy" ? record.status : null;
  const checkType = typeof record.checkType === "string" ? record.checkType as ServiceHealthResult["type"] : "unknown";
  if (!status) {
    return null;
  }

  return {
    serviceId: stringOr(record.serviceId, fallbackServiceId),
    status,
    checkType,
    observed: normalizeObservedTarget(record.observed, checkType),
    reason: stringOr(record.reason, status === "healthy" ? "healthcheck_passed" : "healthcheck_failed"),
    detail: sanitizeDetail(stringOr(record.detail, "")),
    at: stringOr(record.at, nowIso()),
  };
}

export function normalizeServiceHealthHistoryState(input: unknown, serviceId: string): ServiceHealthHistoryState {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      serviceId,
      updatedAt: nowIso(),
      transitions: [],
    };
  }

  const record = input as Record<string, unknown>;
  return {
    serviceId,
    updatedAt: stringOr(record.updatedAt, nowIso()),
    transitions: Array.isArray(record.transitions)
      ? record.transitions.flatMap((entry) => {
          const normalized = normalizeTransition(entry, serviceId);
          return normalized ? [normalized] : [];
        })
      : [],
  };
}

export async function readServiceHealthHistory(service: DiscoveredService): Promise<ServiceHealthHistoryState> {
  const paths = getServiceStatePaths(service.serviceRoot);

  try {
    return normalizeServiceHealthHistoryState(
      JSON.parse(await readFile(paths.health, "utf8")) as unknown,
      service.manifest.id,
    );
  } catch {
    return normalizeServiceHealthHistoryState(null, service.manifest.id);
  }
}

export async function writeServiceHealthHistory(
  service: DiscoveredService,
  state: ServiceHealthHistoryState,
): Promise<ServiceHealthHistoryState> {
  const paths = getServiceStatePaths(service.serviceRoot);
  const nextState = {
    ...state,
    serviceId: service.manifest.id,
    updatedAt: state.updatedAt || nowIso(),
  };

  await mkdir(paths.stateRoot, { recursive: true });
  await writeFile(paths.health, JSON.stringify(nextState, null, 2));

  return nextState;
}

function shouldAppendTransition(
  existing: ServiceHealthHistoryState,
  next: ServiceHealthTransitionEvent,
): boolean {
  const previous = existing.transitions.at(-1);
  return !previous ||
    previous.status !== next.status ||
    previous.checkType !== next.checkType ||
    previous.reason !== next.reason;
}

async function recordServiceHealthTransitionWithoutQueue(
  service: DiscoveredService,
  health: ServiceHealthResult,
  limit = DEFAULT_HEALTH_HISTORY_LIMIT,
): Promise<ServiceHealthHistoryState> {
  const existing = await readServiceHealthHistory(service);
  const status = statusFromHealth(health);
  const transition: ServiceHealthTransitionEvent = {
    serviceId: service.manifest.id,
    status,
    checkType: health.type,
    observed: observedTarget(service.manifest, service.serviceRoot, health),
    reason: status === "healthy" ? "healthcheck_passed" : "healthcheck_failed",
    detail: sanitizeDetail(health.detail),
    at: nowIso(),
  };

  if (!shouldAppendTransition(existing, transition)) {
    return await writeServiceHealthHistory(service, {
      ...existing,
      updatedAt: transition.at,
    });
  }

  return await writeServiceHealthHistory(service, {
    serviceId: service.manifest.id,
    updatedAt: transition.at,
    transitions: [...existing.transitions, transition].slice(-Math.max(1, limit)),
  });
}

export async function recordServiceHealthTransition(
  service: DiscoveredService,
  health: ServiceHealthResult,
  limit = DEFAULT_HEALTH_HISTORY_LIMIT,
): Promise<ServiceHealthHistoryState> {
  const paths = getServiceStatePaths(service.serviceRoot);
  const previousAppend = healthHistoryAppendQueues.get(paths.health) ?? Promise.resolve();
  const appendOperation = previousAppend
    .catch(() => undefined)
    .then(() => recordServiceHealthTransitionWithoutQueue(service, health, limit));

  const settledAppend = appendOperation.then(() => undefined, () => undefined);
  healthHistoryAppendQueues.set(paths.health, settledAppend);

  try {
    return await appendOperation;
  } finally {
    if (healthHistoryAppendQueues.get(paths.health) === settledAppend) {
      healthHistoryAppendQueues.delete(paths.health);
    }
  }
}

function transitionTime(value: ServiceHealthTransitionEvent | null): number {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }

  const parsed = Date.parse(value.at);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function latestTransitionTime(value: ServiceHealthTransitionEvent | null): number {
  const parsed = value ? Date.parse(value.at) : Number.NEGATIVE_INFINITY;
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export function summarizeServiceHealthRegression(
  history: ServiceHealthHistoryState,
): ServiceHealthRegressionServiceSummary {
  const transitions = [...history.transitions].sort((left, right) => {
    const delta = latestTransitionTime(left) - latestTransitionTime(right);
    return delta === 0 ? left.at.localeCompare(right.at) : delta;
  });
  const firstFailure = transitions
    .filter((transition) => transition.status === "unhealthy")
    .sort((left, right) => transitionTime(left) - transitionTime(right))[0] ?? null;
  const latestState = transitions.at(-1) ?? null;
  let flappingCount = 0;

  for (let index = 1; index < transitions.length; index += 1) {
    if (transitions[index - 1]?.status !== transitions[index]?.status) {
      flappingCount += 1;
    }
  }

  return {
    serviceId: history.serviceId,
    transitionCount: transitions.length,
    firstFailure,
    latestState,
    flappingCount,
    impacted: Boolean(firstFailure) || flappingCount > 0,
  };
}

export function summarizeHealthRegression(
  histories: ServiceHealthHistoryState[],
): ServiceHealthRegressionSummary {
  const services = histories
    .map((history) => summarizeServiceHealthRegression(history))
    .sort((left, right) => left.serviceId.localeCompare(right.serviceId));
  const firstFailure = services
    .map((service) => service.firstFailure)
    .filter((transition): transition is ServiceHealthTransitionEvent => Boolean(transition))
    .sort((left, right) => transitionTime(left) - transitionTime(right))[0] ?? null;
  const latestState = services
    .map((service) => service.latestState)
    .filter((transition): transition is ServiceHealthTransitionEvent => Boolean(transition))
    .sort((left, right) => latestTransitionTime(right) - latestTransitionTime(left))[0] ?? null;

  return {
    serviceCount: services.length,
    impactedServiceIds: services
      .filter((service) => service.impacted)
      .map((service) => service.serviceId),
    firstFailure,
    latestState,
    flappingCount: services.reduce((total, service) => total + service.flappingCount, 0),
    services,
  };
}
