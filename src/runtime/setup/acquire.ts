import path from "node:path";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import AdmZip from "adm-zip";
import * as tar from "tar";
import type { DiscoveredService, ServiceArchiveArtifact, ServiceArtifactPlatform } from "../../contracts/service.js";
import { getLockedServiceEntry, readServiceLockfile, type ServiceLockfileEntry } from "../lockfile/service-lockfile.js";
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
  checksumSha256?: string | null;
  command: string | null;
  args: string[];
  checksum: AcquiredArtifactChecksumState | null;
}

export interface AcquiredArtifactChecksumState {
  algorithm: "sha256";
  source: "manifest" | "release-asset";
  expected: string;
  actual: string;
  assetName: string;
  checksumAssetName: string | null;
  verifiedAt: string;
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
  checksumSha256: string | null;
  checksumAssetName: string | null;
  checksumAssetUrl: string | null;
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
  lockedEntry: ServiceLockfileEntry | null,
): Promise<ResolvedArtifactDownload> {
  if (lockedEntry?.assetUrl) {
    return {
      assetName: lockedEntry.assetName,
      assetUrl: lockedEntry.assetUrl,
      releaseTag: lockedEntry.releaseTag,
      checksumSha256: lockedEntry.checksumSha256,
      checksumAssetName: null,
      checksumAssetUrl: null,
    };
  }

  if (platform.assetUrl) {
    return {
      assetName: platform.assetName ?? path.basename(new URL(platform.assetUrl).pathname),
      assetUrl: platform.assetUrl,
      releaseTag: artifact.source.tag ?? artifact.source.channel ?? null,
      checksumSha256: platform.sha256 ?? null,
      checksumAssetName: null,
      checksumAssetUrl: null,
    };
  }

  const assetName = lockedEntry?.assetName ?? platform.assetName;
  if (!assetName) {
    throw new Error("Artifact platform entry must define assetName when assetUrl is not provided.");
  }

  const apiBaseUrl = normalizeApiBaseUrl(artifact.source.api_base_url);
  const repoPath = artifact.source.repo.trim().replace(/^\/+|\/+$/g, "");
  const pinnedTag = lockedEntry?.releaseTag ?? artifact.source.tag?.trim();
  const releasePath = pinnedTag
    ? "/repos/" + repoPath + "/releases/tags/" + encodeURIComponent(pinnedTag)
    : artifact.source.channel && artifact.source.channel.trim().length > 0 && artifact.source.channel.trim() !== "latest"
      ? "/repos/" + repoPath + "/releases/tags/" + encodeURIComponent(artifact.source.channel.trim())
      : "/repos/" + repoPath + "/releases/latest";
  const response = await fetch(apiBaseUrl + releasePath, {
    headers: githubHeaders(),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to resolve GitHub release metadata for "${artifact.source.repo}": ${response.status} ${response.statusText}`,
    );
  }

  const payload = (await response.json()) as GitHubReleaseResponse;
  const asset = payload.assets?.find((candidate) => candidate.name === assetName);
  if (!asset) {
    throw new Error(
      "Release metadata for " + artifact.source.repo + " did not contain asset " + assetName + ".",
    );
  }
  const checksumAssetName = platform.checksum?.assetName?.trim() || null;
  const checksumAsset = checksumAssetName
    ? payload.assets?.find((candidate) => candidate.name === checksumAssetName)
    : null;
  if (checksumAssetName && !checksumAsset) {
    throw new Error(
      `Release metadata for "${artifact.source.repo}" did not contain checksum asset "${checksumAssetName}".`,
    );
  }

  return {
    assetName: asset.name,
    assetUrl: asset.browser_download_url,
    releaseTag: lockedEntry?.releaseTag ?? (typeof payload.tag_name === "string" ? payload.tag_name : artifact.source.tag ?? artifact.source.channel ?? null),
    checksumSha256: lockedEntry?.checksumSha256 ?? platform.sha256 ?? null,
    checksumAssetName,
    checksumAssetUrl: checksumAsset?.browser_download_url ?? null,
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

async function downloadText(assetUrl: string): Promise<string> {
  const response = await fetch(assetUrl);
  if (!response.ok) {
    throw new Error(`Failed to download service artifact checksum from "${assetUrl}": ${response.status} ${response.statusText}`);
  }

  return await response.text();
}

function normalizeSha256(value: string, context: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error(`Malformed SHA-256 checksum for ${context}.`);
  }
  return normalized;
}

function findSha256InChecksumFile(content: string, artifactAssetName: string, checksumAssetName: string): string {
  let parsedEntries = 0;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const match = line.match(/^([A-Fa-f0-9]{64})\s+\*?(.+)$/);
    if (!match) {
      continue;
    }

    parsedEntries += 1;
    const [, checksum, filename] = match;
    const normalizedFilename = filename.trim().replace(/^\.\//, "");
    if (normalizedFilename === artifactAssetName || path.basename(normalizedFilename) === artifactAssetName) {
      return normalizeSha256(checksum, `artifact "${artifactAssetName}" in checksum asset "${checksumAssetName}"`);
    }
  }

  if (parsedEntries === 0) {
    throw new Error(`Malformed checksum asset "${checksumAssetName}": no SHA-256 entries were found.`);
  }

  throw new Error(`Checksum asset "${checksumAssetName}" did not contain an entry for "${artifactAssetName}".`);
}

async function verifyArchiveChecksum(
  archivePath: string,
  assetName: string,
  checksum: ServiceArtifactPlatform["checksum"],
  resolved: ResolvedArtifactDownload,
): Promise<AcquiredArtifactChecksumState | null> {
  if (!checksum) {
    return null;
  }

  if (checksum.algorithm !== "sha256") {
    throw new Error(`Unsupported service artifact checksum algorithm "${checksum.algorithm}".`);
  }

  if (checksum.value && checksum.assetName) {
    throw new Error("Artifact checksum must declare either value or assetName, not both.");
  }

  if (!checksum.value && !checksum.assetName) {
    throw new Error("Artifact checksum must declare value or assetName.");
  }

  let expected: string;
  let source: AcquiredArtifactChecksumState["source"];
  if (checksum.value) {
    expected = normalizeSha256(checksum.value, `artifact "${assetName}"`);
    source = "manifest";
  } else {
    if (!checksum.assetName || !resolved.checksumAssetUrl) {
      throw new Error(`Artifact checksum asset "${checksum.assetName}" could not be resolved from release metadata.`);
    }
    expected = findSha256InChecksumFile(
      await downloadText(resolved.checksumAssetUrl),
      assetName,
      checksum.assetName,
    );
    source = "release-asset";
  }

  const actual = createHash("sha256").update(await readFile(archivePath)).digest("hex");
  if (actual !== expected) {
    throw new Error(`Checksum mismatch for service artifact "${assetName}".`);
  }

  return {
    algorithm: "sha256",
    source,
    expected,
    actual,
    assetName,
    checksumAssetName: resolved.checksumAssetName,
    verifiedAt: new Date().toISOString(),
  };
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

  const servicesRoot = path.dirname(service.serviceRoot);
  const lockfile = await readServiceLockfile(servicesRoot);
  const lockedEntry = lockfile ? getLockedServiceEntry(service, lockfile) : null;
  const { definition } = getCurrentPlatformArtifact(artifact);
  const resolved = await resolveGitHubReleaseDownload(artifact, definition, lockedEntry);
  const paths = getServiceStatePaths(service.serviceRoot);
  const releaseSegment = (resolved.releaseTag ?? "latest").replace(/[^\w.-]+/g, "_");
  const archivePath = path.join(paths.artifacts, releaseSegment, resolved.assetName);
  const extractedPath = path.join(paths.extracted, "current");

  await mkdir(path.dirname(archivePath), { recursive: true });
  if (!(await fileExists(archivePath))) {
    await downloadToFile(resolved.assetUrl, archivePath);
  }
  const checksum = await verifyArchiveChecksum(archivePath, resolved.assetName, definition.checksum, resolved);
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
    checksumSha256: resolved.checksumSha256,
    command: definition.command ?? null,
    args: definition.args ?? [],
    checksum,
  };
}
