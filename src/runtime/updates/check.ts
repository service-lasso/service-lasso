import path from "node:path";
import type {
  DiscoveredService,
  ServiceArchiveArtifact,
  ServiceArtifactPlatform,
  ServiceManifest,
  ServiceUpdateMode,
} from "../../contracts/service.js";
import { readStoredState } from "../state/readState.js";

export type ServiceUpdateStatus = "latest" | "update_available" | "pinned" | "unavailable" | "check_failed";

export interface ServiceUpdateSourceSummary {
  type: "github-release";
  repo: string;
  track: string | null;
  apiBaseUrl: string;
}

export interface ServiceUpdateCurrentSummary {
  manifestTag: string | null;
  installedTag: string | null;
  version: string | null;
  assetName: string | null;
}

export interface ServiceUpdateAvailableSummary {
  tag: string | null;
  version: string | null;
  releaseUrl: string | null;
  publishedAt: string | null;
  assetNames: string[];
  matchedAssetName: string | null;
  assetUrl: string | null;
}

export interface ServiceUpdateCheckResult {
  serviceId: string;
  status: ServiceUpdateStatus;
  reason: string;
  mode: ServiceUpdateMode;
  source: ServiceUpdateSourceSummary | null;
  current: ServiceUpdateCurrentSummary;
  available: ServiceUpdateAvailableSummary | null;
  checkedAt: string;
}

interface StoredInstallArtifact {
  sourceType?: string | null;
  repo?: string | null;
  channel?: string | null;
  tag?: string | null;
  assetName?: string | null;
}

interface GitHubReleaseAsset {
  name: string;
  browser_download_url?: string;
}

interface GitHubReleaseResponse {
  tag_name?: string;
  name?: string;
  html_url?: string;
  published_at?: string;
  created_at?: string;
  assets?: GitHubReleaseAsset[];
}

function normalizeApiBaseUrl(candidate: string | undefined): string {
  return (candidate?.trim() || "https://api.github.com").replace(/\/+$/, "");
}

function getCurrentPlatformArtifact(artifact: ServiceArchiveArtifact): ServiceArtifactPlatform | null {
  if (Object.prototype.hasOwnProperty.call(artifact.platforms, process.platform)) {
    return artifact.platforms[process.platform] ?? null;
  }

  return artifact.platforms.default ?? null;
}

function getExpectedAssetName(platform: ServiceArtifactPlatform): string | null {
  if (platform.assetName) {
    return platform.assetName;
  }

  if (platform.assetUrl) {
    return path.basename(new URL(platform.assetUrl).pathname);
  }

  return null;
}

function getUpdateMode(manifest: ServiceManifest): ServiceUpdateMode {
  if (manifest.updates?.enabled === false || manifest.updates?.mode === "disabled") {
    return "disabled";
  }

  return manifest.updates?.mode ?? "disabled";
}

function getTrack(manifest: ServiceManifest): string | null {
  if (manifest.updates?.track && manifest.updates.track !== "pinned") {
    return manifest.updates.track;
  }

  return null;
}

function createCurrentSummary(
  manifest: ServiceManifest,
  installedArtifact: StoredInstallArtifact | null,
): ServiceUpdateCurrentSummary {
  return {
    manifestTag: manifest.artifact?.source.tag ?? null,
    installedTag: typeof installedArtifact?.tag === "string" ? installedArtifact.tag : null,
    version: manifest.version ?? null,
    assetName: typeof installedArtifact?.assetName === "string" ? installedArtifact.assetName : null,
  };
}

async function readInstalledArtifact(service: DiscoveredService): Promise<StoredInstallArtifact | null> {
  const snapshot = await readStoredState(service.serviceRoot);
  const install = snapshot.install && typeof snapshot.install === "object"
    ? (snapshot.install as Record<string, unknown>)
    : null;
  const artifact = install?.artifact && typeof install.artifact === "object"
    ? (install.artifact as StoredInstallArtifact)
    : null;

  return artifact?.sourceType === "github-release" ? artifact : null;
}

function createPinnedResult(
  service: DiscoveredService,
  current: ServiceUpdateCurrentSummary,
  checkedAt: string,
  reason: string,
): ServiceUpdateCheckResult {
  const source = service.manifest.artifact?.source;

  return {
    serviceId: service.manifest.id,
    status: "pinned",
    reason,
    mode: getUpdateMode(service.manifest),
    source: source
      ? {
          type: "github-release",
          repo: source.repo,
          track: service.manifest.updates?.track ?? source.tag ?? source.channel ?? null,
          apiBaseUrl: normalizeApiBaseUrl(source.api_base_url),
        }
      : null,
    current,
    available: null,
    checkedAt,
  };
}

function releasePathForTrack(repo: string, track: string): string {
  const repoPath = repo.trim().replace(/^\/+|\/+$/g, "");
  if (track === "latest") {
    return `/repos/${repoPath}/releases/latest`;
  }

  return `/repos/${repoPath}/releases/tags/${encodeURIComponent(track)}`;
}

async function fetchGitHubRelease(
  source: ServiceArchiveArtifact["source"],
  track: string,
): Promise<GitHubReleaseResponse> {
  const response = await fetch(`${normalizeApiBaseUrl(source.api_base_url)}${releasePathForTrack(source.repo, track)}`, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "service-lasso-core-runtime",
    },
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`.trim());
  }

  return (await response.json()) as GitHubReleaseResponse;
}

export function compareTimestampedReleaseTags(currentTag: string | null, availableTag: string | null): number | null {
  if (!currentTag || !availableTag) {
    return null;
  }

  const pattern = /^(\d{4})\.(\d{1,2})\.(\d{1,2})-([0-9A-Za-z]+)$/;
  const current = currentTag.match(pattern);
  const available = availableTag.match(pattern);

  if (!current || !available) {
    return null;
  }

  const currentDate = Date.UTC(Number(current[1]), Number(current[2]) - 1, Number(current[3]));
  const availableDate = Date.UTC(Number(available[1]), Number(available[2]) - 1, Number(available[3]));

  if (availableDate > currentDate) {
    return 1;
  }

  if (availableDate < currentDate) {
    return -1;
  }

  return availableTag === currentTag ? 0 : null;
}

function classifyUpdate(currentTag: string | null, availableTag: string | null): {
  status: ServiceUpdateStatus;
  reason: string;
} {
  if (!availableTag) {
    return { status: "unavailable", reason: "Release metadata did not include a tag." };
  }

  if (!currentTag) {
    return { status: "update_available", reason: "No installed release tag is recorded yet." };
  }

  if (currentTag === availableTag) {
    return { status: "latest", reason: "Installed release tag matches the tracked release." };
  }

  const timestampComparison = compareTimestampedReleaseTags(currentTag, availableTag);
  if (timestampComparison === -1) {
    return {
      status: "latest",
      reason: "Installed timestamped release tag is newer than the tracked release metadata.",
    };
  }

  return { status: "update_available", reason: "Tracked release differs from the installed release tag." };
}

export async function checkServiceUpdate(service: DiscoveredService): Promise<ServiceUpdateCheckResult> {
  const checkedAt = new Date().toISOString();
  const installedArtifact = await readInstalledArtifact(service);
  const current = createCurrentSummary(service.manifest, installedArtifact);
  const artifact = service.manifest.artifact;

  if (!artifact) {
    return createPinnedResult(service, current, checkedAt, "Service has no release artifact metadata to check.");
  }

  const mode = getUpdateMode(service.manifest);
  const track = getTrack(service.manifest);

  if (mode === "disabled" || !track) {
    return createPinnedResult(
      service,
      current,
      checkedAt,
      artifact.source.tag
        ? "Manifest is pinned to artifact.source.tag and has no active moving update policy."
        : "Service has no active update policy.",
    );
  }

  const platform = getCurrentPlatformArtifact(artifact);
  if (!platform) {
    return {
      serviceId: service.manifest.id,
      status: "unavailable",
      reason: `No artifact platform is configured for "${process.platform}" and no default platform exists.`,
      mode,
      source: {
        type: "github-release",
        repo: artifact.source.repo,
        track,
        apiBaseUrl: normalizeApiBaseUrl(artifact.source.api_base_url),
      },
      current,
      available: null,
      checkedAt,
    };
  }

  const expectedAssetName = getExpectedAssetName(platform);

  try {
    const release = await fetchGitHubRelease(artifact.source, track);
    const assets = release.assets ?? [];
    const matchedAsset = expectedAssetName
      ? assets.find((asset) => asset.name === expectedAssetName)
      : undefined;

    if (expectedAssetName && !matchedAsset) {
      return {
        serviceId: service.manifest.id,
        status: "unavailable",
        reason: `Tracked release did not contain expected asset "${expectedAssetName}".`,
        mode,
        source: {
          type: "github-release",
          repo: artifact.source.repo,
          track,
          apiBaseUrl: normalizeApiBaseUrl(artifact.source.api_base_url),
        },
        current,
        available: {
          tag: release.tag_name ?? null,
          version: release.tag_name ?? release.name ?? null,
          releaseUrl: release.html_url ?? null,
          publishedAt: release.published_at ?? release.created_at ?? null,
          assetNames: assets.map((asset) => asset.name),
          matchedAssetName: null,
          assetUrl: null,
        },
        checkedAt,
      };
    }

    const availableTag = release.tag_name ?? null;
    const classification = classifyUpdate(current.installedTag ?? current.manifestTag, availableTag);

    return {
      serviceId: service.manifest.id,
      status: classification.status,
      reason: classification.reason,
      mode,
      source: {
        type: "github-release",
        repo: artifact.source.repo,
        track,
        apiBaseUrl: normalizeApiBaseUrl(artifact.source.api_base_url),
      },
      current,
      available: {
        tag: availableTag,
        version: availableTag ?? release.name ?? null,
        releaseUrl: release.html_url ?? null,
        publishedAt: release.published_at ?? release.created_at ?? null,
        assetNames: assets.map((asset) => asset.name),
        matchedAssetName: matchedAsset?.name ?? expectedAssetName,
        assetUrl: matchedAsset?.browser_download_url ?? platform.assetUrl ?? null,
      },
      checkedAt,
    };
  } catch (error: unknown) {
    return {
      serviceId: service.manifest.id,
      status: "check_failed",
      reason: error instanceof Error ? error.message : "Unknown update check failure.",
      mode,
      source: {
        type: "github-release",
        repo: artifact.source.repo,
        track,
        apiBaseUrl: normalizeApiBaseUrl(artifact.source.api_base_url),
      },
      current,
      available: null,
      checkedAt,
    };
  }
}

export async function checkServicesForUpdates(services: DiscoveredService[]): Promise<ServiceUpdateCheckResult[]> {
  return await Promise.all(services.map((service) => checkServiceUpdate(service)));
}
