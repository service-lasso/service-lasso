import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { DiscoveredService } from "../../contracts/service.js";
import { getServiceStatePaths } from "../state/paths.js";
import type { ServiceMonitorEvent } from "./monitor.js";
import type { ServiceHookPhase } from "./hooks.js";

export const DEFAULT_RECOVERY_HISTORY_LIMIT = 100;

export type ServiceRecoveryHistoryEventKind = "monitor" | "doctor" | "restart" | "hook";

export interface ServiceRecoveryStepResult {
  phase?: string;
  name: string;
  command: string;
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
  failurePolicy: string;
  stdout: string;
  stderr: string;
  startedAt: string;
  finishedAt: string;
}

export interface ServiceRecoveryMonitorHistoryEvent {
  kind: "monitor";
  serviceId: string;
  action: ServiceMonitorEvent["action"];
  reason: ServiceMonitorEvent["reason"];
  message: string;
  at: string;
}

export interface ServiceRecoveryDoctorHistoryEvent {
  kind: "doctor";
  serviceId: string;
  ok: boolean;
  blocked: boolean;
  steps: ServiceRecoveryStepResult[];
  at: string;
}

export interface ServiceRecoveryRestartHistoryEvent {
  kind: "restart";
  serviceId: string;
  ok: boolean;
  message: string;
  at: string;
}

export interface ServiceRecoveryHookHistoryEvent {
  kind: "hook";
  serviceId: string;
  phase: ServiceHookPhase | string;
  ok: boolean;
  blocked: boolean;
  steps: ServiceRecoveryStepResult[];
  at: string;
}

export type ServiceRecoveryHistoryEvent =
  | ServiceRecoveryMonitorHistoryEvent
  | ServiceRecoveryDoctorHistoryEvent
  | ServiceRecoveryRestartHistoryEvent
  | ServiceRecoveryHookHistoryEvent;

export interface ServiceRecoveryHistoryState {
  serviceId: string;
  updatedAt: string;
  events: ServiceRecoveryHistoryEvent[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeStepArray(value: unknown): ServiceRecoveryStepResult[] {
  return Array.isArray(value) ? value.filter((entry) => entry && typeof entry === "object") as ServiceRecoveryStepResult[] : [];
}

function normalizeEvent(value: unknown, fallbackServiceId: string): ServiceRecoveryHistoryEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const kind = record.kind;
  const serviceId = stringOr(record.serviceId, fallbackServiceId);
  const at = stringOr(record.at, nowIso());

  if (kind === "monitor") {
    return {
      kind,
      serviceId,
      action: stringOr(record.action, "skip") as ServiceMonitorEvent["action"],
      reason: stringOr(record.reason, "not_configured") as ServiceMonitorEvent["reason"],
      message: stringOr(record.message, ""),
      at,
    };
  }

  if (kind === "doctor") {
    return {
      kind,
      serviceId,
      ok: booleanOr(record.ok, false),
      blocked: booleanOr(record.blocked, false),
      steps: normalizeStepArray(record.steps),
      at,
    };
  }

  if (kind === "restart") {
    return {
      kind,
      serviceId,
      ok: booleanOr(record.ok, false),
      message: stringOr(record.message, ""),
      at,
    };
  }

  if (kind === "hook") {
    return {
      kind,
      serviceId,
      phase: stringOr(record.phase, "unknown"),
      ok: booleanOr(record.ok, false),
      blocked: booleanOr(record.blocked, false),
      steps: normalizeStepArray(record.steps),
      at,
    };
  }

  return null;
}

export function normalizeServiceRecoveryHistoryState(input: unknown, serviceId: string): ServiceRecoveryHistoryState {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      serviceId,
      updatedAt: nowIso(),
      events: [],
    };
  }

  const record = input as Record<string, unknown>;
  return {
    serviceId,
    updatedAt: stringOr(record.updatedAt, nowIso()),
    events: Array.isArray(record.events)
      ? record.events.flatMap((entry) => {
          const normalized = normalizeEvent(entry, serviceId);
          return normalized ? [normalized] : [];
        })
      : [],
  };
}

export async function readServiceRecoveryHistory(service: DiscoveredService): Promise<ServiceRecoveryHistoryState> {
  const paths = getServiceStatePaths(service.serviceRoot);

  try {
    return normalizeServiceRecoveryHistoryState(
      JSON.parse(await readFile(paths.recovery, "utf8")) as unknown,
      service.manifest.id,
    );
  } catch {
    return normalizeServiceRecoveryHistoryState(null, service.manifest.id);
  }
}

export async function writeServiceRecoveryHistory(
  service: DiscoveredService,
  state: ServiceRecoveryHistoryState,
): Promise<ServiceRecoveryHistoryState> {
  const paths = getServiceStatePaths(service.serviceRoot);
  const nextState = {
    ...state,
    serviceId: service.manifest.id,
    updatedAt: state.updatedAt || nowIso(),
  };

  await mkdir(paths.stateRoot, { recursive: true });
  await writeFile(paths.recovery, JSON.stringify(nextState, null, 2));

  return nextState;
}

export async function appendServiceRecoveryHistoryEvents(
  service: DiscoveredService,
  events: ServiceRecoveryHistoryEvent[],
  limit = DEFAULT_RECOVERY_HISTORY_LIMIT,
): Promise<ServiceRecoveryHistoryState> {
  const existing = await readServiceRecoveryHistory(service);
  if (events.length === 0) {
    return existing;
  }

  const updatedAt = nowIso();
  return await writeServiceRecoveryHistory(service, {
    serviceId: service.manifest.id,
    updatedAt,
    events: [
      ...existing.events,
      ...events.map((event) => ({
        ...event,
        serviceId: service.manifest.id,
      })),
    ].slice(-Math.max(1, limit)),
  });
}
