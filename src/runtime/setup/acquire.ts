import path from "node:path";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import AdmZip from "adm-zip";
import * as tar from "tar";
import type { DiscoveredService, ServiceArchiveArtifact, ServiceArtifactPlatform } from "../../contracts/service.js";
import { getServiceStatePaths } from "../state/paths.js";

export interface AcquiredArtifactState {
  sourceType: "github-release";
  repo: string;
  channel: string | null;
  tag: string | null;
  assetName: string;
  assetUrl: string;
  archiveType: "zip" | "tar.gz" | "tgz";
  archivePath: string;
  extractedPath: string;
  command: string | null;
  args: string[];
}

interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface GitHubReleaseResponse {
  tag_name?: string;
  assets?: GitHubReleaseAsset[];
}

interface ResolvedArtifactDownload {
  assetName: string;
  assetUrl: string;
  releaseTag: string | null;
}

function normalizeApiBaseUrl(candidate: string | undefined): string {
  return (candidate?.trim() || "https://api.github.com").replace(/\/+$/, "");
}

function githubHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
  return {
    accept: "application/vnd.github+json",
    "user-agent": "service-lasso-core-runtime",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

function getCurrentPlatformArtifact(artifact: ServiceArchiveArtifact): {
  platformKey: string;
  definition: ServiceArtifactPlatform;
} {
  const platformKey = Object.prototype.hasOwnProperty.call(artifact.platforms, process.platform)
    ? process.platform
    : "default";
  const definition = artifact.platforms[platformKey];

  if (!definition) {
    throw new Error(
      `Service artifact for "${process.platform}" is not configured and no "default" artifact entry exists.`,
    );
  }

  return { platformKey, definition };
}

async function resolveGitHubReleaseDownload(
  artifact: ServiceArchiveArtifact,
  platform: ServiceArtifactPlatform,
): Promise<ResolvedArtifactDownload> {
  if (platform.assetUrl) {
    return {
      assetName: platform.assetName ?? path.basename(new URL(platform.assetUrl).pathname),
      assetUrl: platform.assetUrl,
      releaseTag: artifact.source.tag ?? artifact.source.channel ?? null,
    };
  }

  if (!platform.assetName) {
    throw new Error("Artifact platform entry must define assetName when assetUrl is not provided.");
  }

  const apiBaseUrl = normalizeApiBaseUrl(artifact.source.api_base_url);
  const repoPath = artifact.source.repo.trim().replace(/^\/+|\/+$/g, "");
  const releasePath = artifact.source.tag?.trim()
    ? `/repos/${repoPath}/releases/tags/${encodeURIComponent(artifact.source.tag.trim())}`
    : artifact.source.channel && artifact.source.channel.trim().length > 0 && artifact.source.channel.trim() !== "latest"
      ? `/repos/${repoPath}/releases/tags/${encodeURIComponent(artifact.source.channel.trim())}`
      : `/repos/${repoPath}/releases/latest`;
  const response = await fetch(`${apiBaseUrl}${releasePath}`, {
    headers: githubHeaders(),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to resolve GitHub release metadata for "${artifact.source.repo}": ${response.status} ${response.statusText}`,
    );
  }

  const payload = (await response.json()) as GitHubReleaseResponse;
  const asset = payload.assets?.find((candidate) => candidate.name === platform.assetName);
  if (!asset) {
    throw new Error(
      `Release metadata for "${artifact.source.repo}" did not contain asset "${platform.assetName}".`,
    );
  }

  return {
    assetName: asset.name,
    assetUrl: asset.browser_download_url,
    releaseTag: typeof payload.tag_name === "string" ? payload.tag_name : artifact.source.tag ?? artifact.source.channel ?? null,
  };
}

async function downloadToFile(assetUrl: string, destinationPath: string): Promise<void> {
  const response = await fetch(assetUrl);
  if (!response.ok) {
    throw new Error(`Failed to download service artifact from "${assetUrl}": ${response.status} ${response.statusText}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await writeFile(destinationPath, bytes);
}

async function extractArchive(
  archivePath: string,
  archiveType: ServiceArtifactPlatform["archiveType"],
  destinationPath: string,
): Promise<void> {
  await rm(destinationPath, { recursive: true, force: true });
  await mkdir(destinationPath, { recursive: true });

  if (archiveType === "zip") {
    const archive = new AdmZip(archivePath);
    archive.extractAllTo(destinationPath, true);
    return;
  }

  await tar.extract({
    file: archivePath,
    cwd: destinationPath,
  });
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function acquireInstallArtifact(service: DiscoveredService): Promise<AcquiredArtifactState | null> {
  const artifact = service.manifest.artifact;
  if (!artifact) {
    return null;
  }

  const { definition } = getCurrentPlatformArtifact(artifact);
  const resolved = await resolveGitHubReleaseDownload(artifact, definition);
  const paths = getServiceStatePaths(service.serviceRoot);
  const releaseSegment = (resolved.releaseTag ?? "latest").replace(/[^\w.-]+/g, "_");
  const archivePath = path.join(paths.artifacts, releaseSegment, resolved.assetName);
  const extractedPath = path.join(paths.extracted, "current");

  await mkdir(path.dirname(archivePath), { recursive: true });
  if (!(await fileExists(archivePath))) {
    await downloadToFile(resolved.assetUrl, archivePath);
  }
  await extractArchive(archivePath, definition.archiveType, extractedPath);

  return {
    sourceType: artifact.source.type,
    repo: artifact.source.repo,
    channel: artifact.source.channel ?? null,
    tag: resolved.releaseTag,
    assetName: resolved.assetName,
    assetUrl: resolved.assetUrl,
    archiveType: definition.archiveType,
    archivePath,
    extractedPath,
    command: definition.command ?? null,
    args: definition.args ?? [],
  };
}
