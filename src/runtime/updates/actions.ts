import path from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import AdmZip from "adm-zip";
import * as tar from "tar";
import type {
  DiscoveredService,
  ServiceArchiveArtifact,
  ServiceArtifactPlatform,
  ServiceUpdateInstallWindow,
} from "../../contracts/service.js";
import { createServiceRegistry } from "../manager/DependencyGraph.js";
import type { ServiceRegistry } from "../manager/ServiceRegistry.js";
import { getLifecycleState, setLifecycleState } from "../lifecycle/store.js";
import type { ServiceLifecycleState } from "../lifecycle/types.js";
import { startService, stopService } from "../lifecycle/actions.js";
import { runLifecycleHookPhase, type LifecycleHookPhaseResult, type ServiceHookPhase } from "../recovery/hooks.js";
import { getServiceStatePaths } from "../state/paths.js";
import { writeServiceState } from "../state/writeState.js";
import { checkServiceUpdate, type ServiceUpdateCheckResult } from "./check.js";
import {
  appendUpdateHookResults,
  persistDownloadedUpdateCandidate,
  persistUpdateFailure,
  persistUpdateCheckResult,
  persistUpdateInstallDeferred,
  readServiceUpdateState,
  writeServiceUpdateState,
  type ServiceUpdateState,
} from "./state.js";

export interface UpdateServiceSummary {
  serviceId: string;
  update: ServiceUpdateState;
}

export interface UpdateCheckActionResult {
  action: "check";
  services: Array<{
    serviceId: string;
    result: ServiceUpdateCheckResult;
    update: ServiceUpdateState;
    recommendedAction: "none" | "download" | "inspect";
  }>;
}

export interface UpdateDownloadActionResult {
  action: "download";
  serviceId: string;
  result: ServiceUpdateCheckResult;
  update: ServiceUpdateState;
  archivePath: string;
}

export interface UpdateInstallActionResult {
  action: "install";
  serviceId: string;
  update: ServiceUpdateState;
  state: ServiceLifecycleState;
  forced: boolean;
  stoppedForInstall: boolean;
  restartedAfterInstall: boolean;
}

export interface UpdateInstallOptions {
  force?: boolean;
  registry?: ServiceRegistry;
  now?: () => Date;
}

const windowDays = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export class UpdateInstallDeferredError extends Error {
  readonly update: ServiceUpdateState;

  constructor(message: string, update: ServiceUpdateState) {
    super(message);
    this.name = "UpdateInstallDeferredError";
    this.update = update;
  }
}

function getCurrentPlatformArtifact(artifact: ServiceArchiveArtifact): ServiceArtifactPlatform {
  const platform = Object.prototype.hasOwnProperty.call(artifact.platforms, process.platform)
    ? artifact.platforms[process.platform]
    : artifact.platforms.default;

  if (!platform) {
    throw new Error(`No update artifact platform is configured for "${process.platform}" and no default platform exists.`);
  }

  return platform;
}

function findService(registry: ServiceRegistry, serviceId: string): DiscoveredService {
  const service = registry.getById(serviceId);
  if (!service) {
    const available = registry.list().map((entry) => entry.manifest.id).sort();
    const hint = available.length > 0 ? ` Available services: ${available.join(", ")}.` : "";
    throw new Error(`Unknown service id: ${serviceId}.${hint}`);
  }

  return service;
}

function parseTimeOfDayMinutes(value: string): number {
  const [hour, minute] = value.split(":").map((part) => Number.parseInt(part, 10));
  return hour * 60 + minute;
}

function getZonedClock(date: Date, timezone?: string): { day: string; minutes: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const day = parts.weekday?.slice(0, 3).toLowerCase();
  const hour = Number.parseInt(parts.hour ?? "", 10);
  const minute = Number.parseInt(parts.minute ?? "", 10);

  if (!day || !Number.isFinite(hour) || !Number.isFinite(minute)) {
    throw new Error("Unable to evaluate update install window for the configured timezone.");
  }

  return {
    day,
    minutes: hour * 60 + minute,
  };
}

function isInWindow(window: ServiceUpdateInstallWindow, now: Date): boolean {
  const clock = getZonedClock(now, window.timezone);
  const start = parseTimeOfDayMinutes(window.start);
  const end = parseTimeOfDayMinutes(window.end);
  const days = new Set(window.days ?? windowDays);
  const dayIndex = windowDays.indexOf(clock.day as (typeof windowDays)[number]);
  const previousDay = windowDays[(dayIndex + windowDays.length - 1) % windowDays.length];

  if (start === end) {
    return days.has(clock.day as (typeof windowDays)[number]);
  }

  if (start < end) {
    return days.has(clock.day as (typeof windowDays)[number]) && clock.minutes >= start && clock.minutes < end;
  }

  return (
    (days.has(clock.day as (typeof windowDays)[number]) && clock.minutes >= start) ||
    (days.has(previousDay) && clock.minutes < end)
  );
}

function findNextEligibleAt(window: ServiceUpdateInstallWindow, now: Date): string | null {
  const cursor = new Date(now.getTime() + 60_000);
  const maxChecks = 8 * 24 * 60;

  for (let index = 0; index < maxChecks; index += 1) {
    if (isInWindow(window, cursor)) {
      return cursor.toISOString();
    }
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1, 0, 0);
  }

  return null;
}

async function assertInstallWindowAllows(
  service: DiscoveredService,
  options: UpdateInstallOptions,
): Promise<void> {
  if (options.force === true) {
    return;
  }

  const window = service.manifest.updates?.installWindow;
  if (!window) {
    return;
  }

  const now = options.now?.() ?? new Date();
  if (isInWindow(window, now)) {
    return;
  }

  const nextEligibleAt = findNextEligibleAt(window, now);
  const update = await persistUpdateInstallDeferred(service, {
    reason: `Current time is outside updates.installWindow (${window.start}-${window.end}${window.timezone ? ` ${window.timezone}` : ""}).`,
    nextEligibleAt,
  });
  throw new UpdateInstallDeferredError(`Update install for "${service.manifest.id}" is outside the configured install window.`, update);
}

async function stopRunningServiceForInstall(
  service: DiscoveredService,
  options: UpdateInstallOptions,
): Promise<{ stoppedForInstall: boolean; restartAfterInstall: boolean }> {
  const current = getLifecycleState(service.manifest.id);
  if (options.force === true || !current.running) {
    return {
      stoppedForInstall: false,
      restartAfterInstall: false,
    };
  }

  const policy = service.manifest.updates?.runningService ?? "skip";
  if (policy === "skip" || policy === "require-stopped") {
    const update = await persistUpdateInstallDeferred(service, {
      reason: `Service is running and updates.runningService is "${policy}".`,
    });
    throw new UpdateInstallDeferredError(`Update install for "${service.manifest.id}" is blocked because the service is running.`, update);
  }

  const stopped = await stopService(service);
  await writeServiceState(service, stopped.state);
  return {
    stoppedForInstall: true,
    restartAfterInstall: true,
  };
}

async function recordHookPhase(
  service: DiscoveredService,
  phase: ServiceHookPhase,
): Promise<LifecycleHookPhaseResult> {
  const result = await runLifecycleHookPhase(service, phase);
  if (result.steps.length > 0) {
    await appendUpdateHookResults(service, [result]);
  }
  return result;
}

async function recordFailureHooks(service: DiscoveredService): Promise<void> {
  await recordHookPhase(service, "rollback");
  await recordHookPhase(service, "onFailure");
}

function findBlockingHookStep(result: LifecycleHookPhaseResult): string {
  return result.steps.find((step) => !step.ok && step.failurePolicy === "block")?.name ?? "unknown";
}

async function assertHookPhaseAllowsUpgrade(
  service: DiscoveredService,
  phase: ServiceHookPhase,
  sourceStatus: string,
): Promise<void> {
  const result = await recordHookPhase(service, phase);
  if (!result.blocked) {
    return;
  }

  await persistUpdateFailure(service, {
    reason: `${phase} hook blocked update install at step "${findBlockingHookStep(result)}".`,
    sourceStatus,
  });
  await recordFailureHooks(service);
  throw new Error(`${phase} hook blocked update install for "${service.manifest.id}".`);
}

async function downloadToFile(assetUrl: string, destinationPath: string): Promise<void> {
  const response = await fetch(assetUrl);
  if (!response.ok) {
    throw new Error(`Failed to download update candidate from "${assetUrl}": ${response.status} ${response.statusText}`);
  }

  await mkdir(path.dirname(destinationPath), { recursive: true });
  await writeFile(destinationPath, Buffer.from(await response.arrayBuffer()));
}

async function extractArchive(
  archivePath: string,
  archiveType: ServiceArtifactPlatform["archiveType"],
  destinationPath: string,
): Promise<void> {
  await rm(destinationPath, { recursive: true, force: true });
  await mkdir(destinationPath, { recursive: true });

  if (archiveType === "zip") {
    new AdmZip(archivePath).extractAllTo(destinationPath, true);
    return;
  }

  await tar.extract({
    file: archivePath,
    cwd: destinationPath,
  });
}

export async function listServiceUpdateStates(services: DiscoveredService[]): Promise<UpdateServiceSummary[]> {
  return await Promise.all(
    services.map(async (service) => ({
      serviceId: service.manifest.id,
      update: await readServiceUpdateState(service),
    })),
  );
}

export async function checkServiceUpdatesForCli(
  services: DiscoveredService[],
  serviceId?: string,
): Promise<UpdateCheckActionResult> {
  const registry = createServiceRegistry(services);
  const selected = serviceId ? [findService(registry, serviceId)] : registry.list();
  const checked = await Promise.all(
    selected.map(async (service) => {
      const result = await checkServiceUpdate(service);
      const update = await persistUpdateCheckResult(service, result);
      return {
        serviceId: service.manifest.id,
        result,
        update,
        recommendedAction:
          result.status === "update_available"
            ? "download"
            : result.status === "check_failed" || result.status === "unavailable"
              ? "inspect"
              : "none",
      } as const;
    }),
  );

  return {
    action: "check",
    services: checked,
  };
}

export async function downloadServiceUpdateCandidate(
  service: DiscoveredService,
): Promise<UpdateDownloadActionResult> {
  const result = await checkServiceUpdate(service);
  const persistedCheck = await persistUpdateCheckResult(service, result);

  if (result.status !== "update_available" || !result.available?.assetUrl || !result.available.matchedAssetName || !result.available.tag) {
    throw new Error(`No downloadable update candidate is available for "${service.manifest.id}": ${result.reason}`);
  }

  const paths = getServiceStatePaths(service.serviceRoot);
  const releaseSegment = result.available.tag.replace(/[^\w.-]+/g, "_");
  const archivePath = path.join(paths.updateCandidates, releaseSegment, result.available.matchedAssetName);
  try {
    await downloadToFile(result.available.assetUrl, archivePath);
  } catch (error) {
    await persistUpdateFailure(service, {
      reason: error instanceof Error ? error.message : "Failed to download update candidate.",
      sourceStatus: "download_failed",
    });
    throw error;
  }
  const update = await persistDownloadedUpdateCandidate(service, {
    tag: result.available.tag,
    version: result.available.version,
    assetName: result.available.matchedAssetName,
    assetUrl: result.available.assetUrl,
    archivePath,
    extractedPath: null,
  });

  return {
    action: "download",
    serviceId: service.manifest.id,
    result,
    update: {
      ...update,
      lastCheck: update.lastCheck ?? persistedCheck.lastCheck,
    },
    archivePath,
  };
}

export async function installServiceUpdateCandidate(
  service: DiscoveredService,
  options: UpdateInstallOptions = {},
): Promise<UpdateInstallActionResult> {
  const artifact = service.manifest.artifact;
  if (!artifact) {
    throw new Error(`Service "${service.manifest.id}" has no artifact metadata for update install.`);
  }

  const canInstallByPolicy = service.manifest.updates?.mode === "install";
  if (!canInstallByPolicy && options.force !== true) {
    const update = await persistUpdateInstallDeferred(service, {
      reason: `updates.mode is "${service.manifest.updates?.mode ?? "disabled"}"; use --force to install explicitly.`,
    });
    throw new UpdateInstallDeferredError(`Update install for "${service.manifest.id}" is blocked by policy. Use --force to override.`, update);
  }

  await assertInstallWindowAllows(service, options);
  const runningSafety = await stopRunningServiceForInstall(service, options);
  let update = await readServiceUpdateState(service);
  if (!update.downloadedCandidate) {
    update = (await downloadServiceUpdateCandidate(service)).update;
  }

  const candidate = update.downloadedCandidate;
  if (!candidate) {
    throw new Error(`Service "${service.manifest.id}" has no downloaded update candidate.`);
  }

  const platform = getCurrentPlatformArtifact(artifact);
  const paths = getServiceStatePaths(service.serviceRoot);
  const extractedPath = path.join(paths.extracted, "current");
  await assertHookPhaseAllowsUpgrade(service, "preUpgrade", "pre_upgrade_hook_failed");
  try {
    await extractArchive(candidate.archivePath, platform.archiveType, extractedPath);
  } catch (error) {
    await persistUpdateFailure(service, {
      reason: error instanceof Error ? error.message : "Failed to install update candidate.",
      sourceStatus: "install_failed",
    });
    await recordFailureHooks(service);
    throw error;
  }

  const current = getLifecycleState(service.manifest.id);
  const installedAt = new Date().toISOString();
  const nextState = setLifecycleState(service.manifest.id, {
    ...current,
    installed: true,
    lastAction: "install",
    actionHistory: [...current.actionHistory, "install"],
    installArtifacts: {
      ...current.installArtifacts,
      updatedAt: installedAt,
      artifact: {
        sourceType: artifact.source.type,
        repo: artifact.source.repo,
        channel: artifact.source.channel ?? null,
        tag: candidate.tag,
        assetName: candidate.assetName,
        assetUrl: candidate.assetUrl,
        archiveType: platform.archiveType,
        archivePath: candidate.archivePath,
        extractedPath,
        command: platform.command ?? null,
        args: platform.args ?? [],
      },
    },
  });
  await writeServiceState(service, nextState);
  const installedUpdateState = await persistUpdateCheckResult(service, {
    serviceId: service.manifest.id,
    status: "latest",
    reason: "Downloaded update candidate was installed.",
    mode: service.manifest.updates?.mode ?? "disabled",
    source: {
      type: "github-release",
      repo: artifact.source.repo,
      track: service.manifest.updates?.track ?? artifact.source.channel ?? artifact.source.tag ?? null,
      apiBaseUrl: artifact.source.api_base_url ?? "https://api.github.com",
    },
    current: {
      manifestTag: artifact.source.tag ?? null,
      installedTag: candidate.tag,
      version: service.manifest.version ?? null,
      assetName: candidate.assetName,
    },
    available: {
      tag: candidate.tag,
      version: candidate.version,
      releaseUrl: update.available?.releaseUrl ?? null,
      publishedAt: update.available?.publishedAt ?? null,
      assetNames: [candidate.assetName],
      matchedAssetName: candidate.assetName,
      assetUrl: candidate.assetUrl,
    },
    checkedAt: installedAt,
  });
  await writeServiceUpdateState(service, {
    ...installedUpdateState,
    state: "installed",
    updatedAt: installedAt,
    downloadedCandidate: null,
    installDeferred: null,
    failed: null,
  });
  let finalState = nextState;
  let restartedAfterInstall = false;
  if (runningSafety.restartAfterInstall) {
    const restarted = await startService(service, options.registry);
    await writeServiceState(service, restarted.state);
    finalState = restarted.state;
    restartedAfterInstall = restarted.ok;
  }
  await assertHookPhaseAllowsUpgrade(service, "postUpgrade", "post_upgrade_hook_failed");
  const finalUpdateState = await readServiceUpdateState(service);

  return {
    action: "install",
    serviceId: service.manifest.id,
    update: finalUpdateState,
    state: finalState,
    forced: options.force === true,
    stoppedForInstall: runningSafety.stoppedForInstall,
    restartedAfterInstall,
  };
}
