import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { DiscoveredService } from "../../contracts/service.js";
import { appendServiceRecoveryHistoryEvents } from "../recovery/history.js";
import { getServiceStatePaths } from "../state/paths.js";
import type { ServiceUpdateCheckResult } from "./check.js";

export type ServiceUpdateStateKind =
  | "installed"
  | "available"
  | "downloadedCandidate"
  | "installDeferred"
  | "failed";

export interface ServiceUpdateAvailableState {
  tag: string | null;
  version: string | null;
  releaseUrl: string | null;
  publishedAt: string | null;
  assetName: string | null;
  assetUrl: string | null;
}

export interface ServiceUpdateDownloadedCandidateState {
  tag: string;
  version: string | null;
  assetName: string;
  assetUrl: string;
  archivePath: string;
  extractedPath: string | null;
  downloadedAt: string;
}

export interface ServiceUpdateDeferredState {
  reason: string;
  deferredAt: string;
  nextEligibleAt: string | null;
}

export interface ServiceUpdateFailureState {
  reason: string;
  failedAt: string;
  sourceStatus: string | null;
}

export interface ServiceUpdateHookStepState {
  phase: string;
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

export interface ServiceUpdateHookRunState {
  phase: string;
  ok: boolean;
  blocked: boolean;
  steps: ServiceUpdateHookStepState[];
  recordedAt: string;
}

export interface ServiceUpdateLastCheckState {
  checkedAt: string;
  status: ServiceUpdateCheckResult["status"];
  reason: string;
  sourceRepo: string | null;
  track: string | null;
  installedTag: string | null;
  manifestTag: string | null;
  latestTag: string | null;
}

export interface ServiceUpdateState {
  serviceId: string;
  state: ServiceUpdateStateKind;
  updatedAt: string;
  lastCheck: ServiceUpdateLastCheckState | null;
  available: ServiceUpdateAvailableState | null;
  downloadedCandidate: ServiceUpdateDownloadedCandidateState | null;
  installDeferred: ServiceUpdateDeferredState | null;
  failed: ServiceUpdateFailureState | null;
  hookResults: ServiceUpdateHookRunState[];
}

export interface DownloadedCandidateInput {
  tag: string;
  version?: string | null;
  assetName: string;
  assetUrl: string;
  archivePath: string;
  extractedPath?: string | null;
  downloadedAt?: string;
}

export interface InstallDeferredInput {
  reason: string;
  nextEligibleAt?: string | null;
  deferredAt?: string;
}

export interface UpdateFailureInput {
  reason: string;
  sourceStatus?: string | null;
  failedAt?: string;
}

export const EMPTY_UPDATE_STATE: Omit<ServiceUpdateState, "serviceId"> = {
  state: "installed",
  updatedAt: "",
  lastCheck: null,
  available: null,
  downloadedCandidate: null,
  installDeferred: null,
  failed: null,
  hookResults: [],
};

function nowIso(): string {
  return new Date().toISOString();
}

function isStateKind(value: unknown): value is ServiceUpdateStateKind {
  return (
    value === "installed" ||
    value === "available" ||
    value === "downloadedCandidate" ||
    value === "installDeferred" ||
    value === "failed"
  );
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeAvailable(value: unknown): ServiceUpdateAvailableState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  return {
    tag: stringOrNull(record.tag),
    version: stringOrNull(record.version),
    releaseUrl: stringOrNull(record.releaseUrl),
    publishedAt: stringOrNull(record.publishedAt),
    assetName: stringOrNull(record.assetName),
    assetUrl: stringOrNull(record.assetUrl),
  };
}

function normalizeDownloadedCandidate(value: unknown): ServiceUpdateDownloadedCandidateState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (
    typeof record.tag !== "string" ||
    typeof record.assetName !== "string" ||
    typeof record.assetUrl !== "string" ||
    typeof record.archivePath !== "string" ||
    typeof record.downloadedAt !== "string"
  ) {
    return null;
  }

  return {
    tag: record.tag,
    version: stringOrNull(record.version),
    assetName: record.assetName,
    assetUrl: record.assetUrl,
    archivePath: record.archivePath,
    extractedPath: stringOrNull(record.extractedPath),
    downloadedAt: record.downloadedAt,
  };
}

function normalizeDeferred(value: unknown): ServiceUpdateDeferredState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.reason !== "string" || typeof record.deferredAt !== "string") {
    return null;
  }

  return {
    reason: record.reason,
    deferredAt: record.deferredAt,
    nextEligibleAt: stringOrNull(record.nextEligibleAt),
  };
}

function normalizeFailure(value: unknown): ServiceUpdateFailureState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.reason !== "string" || typeof record.failedAt !== "string") {
    return null;
  }

  return {
    reason: record.reason,
    failedAt: record.failedAt,
    sourceStatus: stringOrNull(record.sourceStatus),
  };
}

function normalizeLastCheck(value: unknown): ServiceUpdateLastCheckState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const status = record.status;
  if (
    typeof record.checkedAt !== "string" ||
    typeof record.reason !== "string" ||
    (status !== "latest" &&
      status !== "update_available" &&
      status !== "pinned" &&
      status !== "unavailable" &&
      status !== "check_failed")
  ) {
    return null;
  }

  return {
    checkedAt: record.checkedAt,
    status,
    reason: record.reason,
    sourceRepo: stringOrNull(record.sourceRepo),
    track: stringOrNull(record.track),
    installedTag: stringOrNull(record.installedTag),
    manifestTag: stringOrNull(record.manifestTag),
    latestTag: stringOrNull(record.latestTag),
  };
}

function normalizeHookStep(value: unknown): ServiceUpdateHookStepState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (
    typeof record.phase !== "string" ||
    typeof record.name !== "string" ||
    typeof record.command !== "string" ||
    typeof record.ok !== "boolean" ||
    typeof record.timedOut !== "boolean" ||
    typeof record.failurePolicy !== "string" ||
    typeof record.stdout !== "string" ||
    typeof record.stderr !== "string" ||
    typeof record.startedAt !== "string" ||
    typeof record.finishedAt !== "string"
  ) {
    return null;
  }

  return {
    phase: record.phase,
    name: record.name,
    command: record.command,
    ok: record.ok,
    exitCode: typeof record.exitCode === "number" ? record.exitCode : null,
    timedOut: record.timedOut,
    failurePolicy: record.failurePolicy,
    stdout: record.stdout,
    stderr: record.stderr,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
  };
}

function normalizeHookResults(value: unknown): ServiceUpdateHookRunState[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }

    const record = entry as Record<string, unknown>;
    if (
      typeof record.phase !== "string" ||
      typeof record.ok !== "boolean" ||
      typeof record.blocked !== "boolean" ||
      typeof record.recordedAt !== "string" ||
      !Array.isArray(record.steps)
    ) {
      return [];
    }

    return [{
      phase: record.phase,
      ok: record.ok,
      blocked: record.blocked,
      steps: record.steps.flatMap((step) => {
        const normalized = normalizeHookStep(step);
        return normalized ? [normalized] : [];
      }),
      recordedAt: record.recordedAt,
    }];
  });
}

export function createEmptyServiceUpdateState(serviceId: string): ServiceUpdateState {
  return {
    serviceId,
    ...EMPTY_UPDATE_STATE,
    updatedAt: nowIso(),
  };
}

export function normalizeServiceUpdateState(input: unknown, serviceId: string): ServiceUpdateState {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return createEmptyServiceUpdateState(serviceId);
  }

  const record = input as Record<string, unknown>;
  return {
    serviceId,
    state: isStateKind(record.state) ? record.state : "installed",
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : nowIso(),
    lastCheck: normalizeLastCheck(record.lastCheck),
    available: normalizeAvailable(record.available),
    downloadedCandidate: normalizeDownloadedCandidate(record.downloadedCandidate),
    installDeferred: normalizeDeferred(record.installDeferred),
    failed: normalizeFailure(record.failed),
    hookResults: normalizeHookResults(record.hookResults),
  };
}

export async function readServiceUpdateState(service: DiscoveredService): Promise<ServiceUpdateState> {
  const paths = getServiceStatePaths(service.serviceRoot);

  try {
    return normalizeServiceUpdateState(JSON.parse(await readFile(paths.updates, "utf8")) as unknown, service.manifest.id);
  } catch {
    return createEmptyServiceUpdateState(service.manifest.id);
  }
}

export async function writeServiceUpdateState(
  service: DiscoveredService,
  state: ServiceUpdateState,
): Promise<ServiceUpdateState> {
  const paths = getServiceStatePaths(service.serviceRoot);
  const nextState = {
    ...state,
    serviceId: service.manifest.id,
    updatedAt: state.updatedAt || nowIso(),
  };

  await mkdir(paths.stateRoot, { recursive: true });
  await writeFile(paths.updates, JSON.stringify(nextState, null, 2));

  return nextState;
}

export async function persistUpdateCheckResult(
  service: DiscoveredService,
  result: ServiceUpdateCheckResult,
): Promise<ServiceUpdateState> {
  const existing = await readServiceUpdateState(service);
  const available = result.available
    ? {
        tag: result.available.tag,
        version: result.available.version,
        releaseUrl: result.available.releaseUrl,
        publishedAt: result.available.publishedAt,
        assetName: result.available.matchedAssetName,
        assetUrl: result.available.assetUrl,
      }
    : null;
  const failed = result.status === "check_failed" || result.status === "unavailable"
    ? {
        reason: result.reason,
        failedAt: result.checkedAt,
        sourceStatus: result.status,
      }
    : null;
  const state: ServiceUpdateStateKind =
    failed ? "failed" : result.status === "update_available" ? "available" : existing.downloadedCandidate ? "downloadedCandidate" : "installed";

  return await writeServiceUpdateState(service, {
    serviceId: service.manifest.id,
    state,
    updatedAt: result.checkedAt,
    lastCheck: {
      checkedAt: result.checkedAt,
      status: result.status,
      reason: result.reason,
      sourceRepo: result.source?.repo ?? null,
      track: result.source?.track ?? null,
      installedTag: result.current.installedTag,
      manifestTag: result.current.manifestTag,
      latestTag: result.available?.tag ?? null,
    },
    available,
    downloadedCandidate: state === "installed" ? null : existing.downloadedCandidate,
    installDeferred: existing.installDeferred,
    failed,
    hookResults: existing.hookResults,
  });
}

export async function persistDownloadedUpdateCandidate(
  service: DiscoveredService,
  candidate: DownloadedCandidateInput,
): Promise<ServiceUpdateState> {
  const existing = await readServiceUpdateState(service);
  const downloadedAt = candidate.downloadedAt ?? nowIso();

  return await writeServiceUpdateState(service, {
    ...existing,
    serviceId: service.manifest.id,
    state: "downloadedCandidate",
    updatedAt: downloadedAt,
    downloadedCandidate: {
      tag: candidate.tag,
      version: candidate.version ?? null,
      assetName: candidate.assetName,
      assetUrl: candidate.assetUrl,
      archivePath: candidate.archivePath,
      extractedPath: candidate.extractedPath ?? null,
      downloadedAt,
    },
    failed: null,
  });
}

export async function persistUpdateInstallDeferred(
  service: DiscoveredService,
  deferred: InstallDeferredInput,
): Promise<ServiceUpdateState> {
  const existing = await readServiceUpdateState(service);
  const deferredAt = deferred.deferredAt ?? nowIso();

  return await writeServiceUpdateState(service, {
    ...existing,
    serviceId: service.manifest.id,
    state: "installDeferred",
    updatedAt: deferredAt,
    installDeferred: {
      reason: deferred.reason,
      deferredAt,
      nextEligibleAt: deferred.nextEligibleAt ?? null,
    },
  });
}

export async function persistUpdateFailure(
  service: DiscoveredService,
  failure: UpdateFailureInput,
): Promise<ServiceUpdateState> {
  const existing = await readServiceUpdateState(service);
  const failedAt = failure.failedAt ?? nowIso();

  return await writeServiceUpdateState(service, {
    ...existing,
    serviceId: service.manifest.id,
    state: "failed",
    updatedAt: failedAt,
    failed: {
      reason: failure.reason,
      failedAt,
      sourceStatus: failure.sourceStatus ?? null,
    },
  });
}

export async function appendUpdateHookResults(
  service: DiscoveredService,
  hookResults: Array<Omit<ServiceUpdateHookRunState, "recordedAt">>,
): Promise<ServiceUpdateState> {
  const existing = await readServiceUpdateState(service);
  if (hookResults.length === 0) {
    return existing;
  }

  const recordedAt = nowIso();
  await appendServiceRecoveryHistoryEvents(service, hookResults.map((result) => ({
    kind: "hook",
    serviceId: service.manifest.id,
    phase: result.phase,
    ok: result.ok,
    blocked: result.blocked,
    steps: result.steps,
    at: recordedAt,
  })));

  return await writeServiceUpdateState(service, {
    ...existing,
    serviceId: service.manifest.id,
    updatedAt: recordedAt,
    hookResults: [
      ...existing.hookResults,
      ...hookResults.map((result) => ({
        ...result,
        recordedAt,
      })),
    ],
  });
}
