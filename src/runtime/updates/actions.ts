import path from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import AdmZip from "adm-zip";
import * as tar from "tar";
import type { DiscoveredService, ServiceArchiveArtifact, ServiceArtifactPlatform } from "../../contracts/service.js";
import { createServiceRegistry } from "../manager/DependencyGraph.js";
import type { ServiceRegistry } from "../manager/ServiceRegistry.js";
import { getLifecycleState, setLifecycleState } from "../lifecycle/store.js";
import type { ServiceLifecycleState } from "../lifecycle/types.js";
import { getServiceStatePaths } from "../state/paths.js";
import { writeServiceState } from "../state/writeState.js";
import { checkServiceUpdate, type ServiceUpdateCheckResult } from "./check.js";
import {
  persistDownloadedUpdateCandidate,
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
  await downloadToFile(result.available.assetUrl, archivePath);
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
  options: { force?: boolean } = {},
): Promise<UpdateInstallActionResult> {
  const artifact = service.manifest.artifact;
  if (!artifact) {
    throw new Error(`Service "${service.manifest.id}" has no artifact metadata for update install.`);
  }

  const canInstallByPolicy = service.manifest.updates?.mode === "install";
  if (!canInstallByPolicy && options.force !== true) {
    await persistUpdateInstallDeferred(service, {
      reason: `updates.mode is "${service.manifest.updates?.mode ?? "disabled"}"; use --force to install explicitly.`,
    });
    throw new Error(`Update install for "${service.manifest.id}" is blocked by policy. Use --force to override.`);
  }

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
  await extractArchive(candidate.archivePath, platform.archiveType, extractedPath);

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
  const nextUpdateState = await writeServiceUpdateState(service, {
    ...installedUpdateState,
    state: "installed",
    updatedAt: installedAt,
    downloadedCandidate: null,
    installDeferred: null,
    failed: null,
  });

  return {
    action: "install",
    serviceId: service.manifest.id,
    update: nextUpdateState,
    state: nextState,
    forced: options.force === true,
  };
}
