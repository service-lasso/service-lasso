import { createHash } from "node:crypto";
import path from "node:path";
import { access, readFile } from "node:fs/promises";
import type { ServiceArchiveArtifact, ServiceArtifactPlatform, ServiceManifest } from "../../contracts/service.js";
import { loadServiceManifest } from "../discovery/loadManifest.js";

export type ReleaseManifestFindingSeverity = "error" | "warning";

export type ReleaseManifestFindingCode =
  | "invalid-service-manifest"
  | "missing-release-artifact-metadata"
  | "missing-runtime-version"
  | "missing-release-version"
  | "invalid-release-version"
  | "release-version-mismatch"
  | "missing-service-json-asset"
  | "missing-asset-name"
  | "missing-release-asset"
  | "checksum-missing"
  | "checksum-asset-missing"
  | "checksum-entry-missing"
  | "checksum-mismatch";

export interface ReleaseManifestVerificationFinding {
  severity: ReleaseManifestFindingSeverity;
  code: ReleaseManifestFindingCode;
  message: string;
  platform?: string;
  assetName?: string;
}

export type ReleaseAssetVerificationStatus = "present" | "missing";
export type ReleaseAssetChecksumSource = "manifest-sha256" | "manifest-checksum" | "release-asset" | "none";
export type ReleaseAssetChecksumStatus = "verified" | "mismatch" | "missing" | "not-declared";

export interface ReleaseAssetVerification {
  platform: string;
  assetName: string | null;
  archiveType: ServiceArtifactPlatform["archiveType"];
  status: ReleaseAssetVerificationStatus;
  checksum: {
    source: ReleaseAssetChecksumSource;
    status: ReleaseAssetChecksumStatus;
    assetName: string | null;
    expectedSha256: string | null;
    actualSha256: string | null;
  };
}

export interface ReleaseManifestVerificationReport {
  ok: boolean;
  status: "verified" | "blocked";
  manifestPath: string;
  assetsRoot: string;
  releaseVersion: string | null;
  service: {
    id: string | null;
    version: string | null;
    sourceRepo: string | null;
    releaseTag: string | null;
  };
  summary: {
    errors: number;
    warnings: number;
    platforms: number;
    expectedAssets: number;
    presentAssets: number;
    checksumsVerified: number;
  };
  assets: ReleaseAssetVerification[];
  findings: ReleaseManifestVerificationFinding[];
}

export interface VerifyReleaseManifestOptions {
  manifestPath: string;
  assetsRoot?: string;
  releaseVersion?: string;
}

const releaseVersionPattern = /^\d{4}\.\d{1,2}\.\d{1,2}-[0-9a-f]{7,40}$/i;
const defaultChecksumAssetNames = ["SHA256SUMS.txt", "SHA256SUMS"];

function normalizeSha256(value: string | undefined): string | null {
  const candidate = value?.trim().toLowerCase();
  return candidate && /^[a-f0-9]{64}$/.test(candidate) ? candidate : null;
}

function normalizeOptional(value: string | undefined): string | null {
  const candidate = value?.trim();
  return candidate ? candidate : null;
}

function assetNameFromPlatform(platform: ServiceArtifactPlatform): string | null {
  if (platform.assetName?.trim()) {
    return platform.assetName.trim();
  }

  if (!platform.assetUrl?.trim()) {
    return null;
  }

  try {
    return path.basename(new URL(platform.assetUrl).pathname);
  } catch {
    return path.basename(platform.assetUrl);
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function sha256File(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

function findSha256InChecksumFile(content: string, artifactAssetName: string): string | null {
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const match = /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(line);
    if (!match) {
      continue;
    }

    const [, checksum, filename] = match;
    if (path.basename(filename.trim()) === artifactAssetName) {
      return checksum.toLowerCase();
    }
  }

  return null;
}

async function readChecksumFromAsset(
  assetsRoot: string,
  checksumAssetName: string,
  artifactAssetName: string,
): Promise<{ status: "found"; checksum: string } | { status: "asset-missing" } | { status: "entry-missing" }> {
  const checksumPath = path.join(assetsRoot, checksumAssetName);
  if (!(await fileExists(checksumPath))) {
    return { status: "asset-missing" };
  }

  const checksum = findSha256InChecksumFile(await readFile(checksumPath, "utf8"), artifactAssetName);
  return checksum ? { status: "found", checksum } : { status: "entry-missing" };
}

async function resolveChecksum(
  assetsRoot: string,
  platform: ServiceArtifactPlatform,
  assetName: string,
): Promise<{
  source: ReleaseAssetChecksumSource;
  expectedSha256: string | null;
  checksumAssetName: string | null;
  finding: ReleaseManifestVerificationFinding | null;
}> {
  const directChecksum = normalizeSha256(platform.checksum?.value) ?? normalizeSha256(platform.sha256);
  if (directChecksum) {
    return {
      source: platform.checksum?.value ? "manifest-checksum" : "manifest-sha256",
      expectedSha256: directChecksum,
      checksumAssetName: null,
      finding: null,
    };
  }

  const checksumAssetCandidates = [
    ...(platform.checksum?.assetName ? [platform.checksum.assetName] : []),
    ...defaultChecksumAssetNames,
  ];

  for (const checksumAssetName of checksumAssetCandidates) {
    const result = await readChecksumFromAsset(assetsRoot, checksumAssetName, assetName);
    if (result.status === "found") {
      return {
        source: "release-asset",
        expectedSha256: result.checksum,
        checksumAssetName,
        finding: null,
      };
    }

    if (platform.checksum?.assetName === checksumAssetName && result.status === "asset-missing") {
      return {
        source: "release-asset",
        expectedSha256: null,
        checksumAssetName,
        finding: {
          severity: "error",
          code: "checksum-asset-missing",
          message: `Checksum asset "${checksumAssetName}" is missing.`,
          assetName,
        },
      };
    }

    if (platform.checksum?.assetName === checksumAssetName && result.status === "entry-missing") {
      return {
        source: "release-asset",
        expectedSha256: null,
        checksumAssetName,
        finding: {
          severity: "error",
          code: "checksum-entry-missing",
          message: `Checksum asset "${checksumAssetName}" does not contain an entry for "${assetName}".`,
          assetName,
        },
      };
    }
  }

  return {
    source: "none",
    expectedSha256: null,
    checksumAssetName: null,
    finding: {
      severity: "error",
      code: "checksum-missing",
      message: `Release asset "${assetName}" has no verifiable SHA-256 checksum.`,
      assetName,
    },
  };
}

function buildEmptyReport(
  manifestPath: string,
  assetsRoot: string,
  releaseVersion: string | null,
  finding: ReleaseManifestVerificationFinding,
): ReleaseManifestVerificationReport {
  return {
    ok: false,
    status: "blocked",
    manifestPath,
    assetsRoot,
    releaseVersion,
    service: {
      id: null,
      version: null,
      sourceRepo: null,
      releaseTag: null,
    },
    summary: {
      errors: finding.severity === "error" ? 1 : 0,
      warnings: finding.severity === "warning" ? 1 : 0,
      platforms: 0,
      expectedAssets: 0,
      presentAssets: 0,
      checksumsVerified: 0,
    },
    assets: [],
    findings: [finding],
  };
}

async function verifyPlatformAsset(
  assetsRoot: string,
  platformName: string,
  platform: ServiceArtifactPlatform,
): Promise<{ asset: ReleaseAssetVerification; findings: ReleaseManifestVerificationFinding[] }> {
  const findings: ReleaseManifestVerificationFinding[] = [];
  const assetName = assetNameFromPlatform(platform);

  if (!assetName) {
    const asset: ReleaseAssetVerification = {
      platform: platformName,
      assetName: null,
      archiveType: platform.archiveType,
      status: "missing",
      checksum: {
        source: "none",
        status: "not-declared",
        assetName: null,
        expectedSha256: null,
        actualSha256: null,
      },
    };
    findings.push({
      severity: "error",
      code: "missing-asset-name",
      message: `Platform "${platformName}" does not declare an asset name or asset URL.`,
      platform: platformName,
    });
    return { asset, findings };
  }

  const assetPath = path.join(assetsRoot, assetName);
  const exists = await fileExists(assetPath);
  const checksum = await resolveChecksum(assetsRoot, platform, assetName);
  if (checksum.finding) {
    findings.push({ ...checksum.finding, platform: platformName });
  }

  let actualSha256: string | null = null;
  let checksumStatus: ReleaseAssetChecksumStatus = checksum.expectedSha256 ? "missing" : "not-declared";
  if (exists && checksum.expectedSha256) {
    actualSha256 = await sha256File(assetPath);
    checksumStatus = actualSha256 === checksum.expectedSha256 ? "verified" : "mismatch";
    if (checksumStatus === "mismatch") {
      findings.push({
        severity: "error",
        code: "checksum-mismatch",
        message: `Release asset "${assetName}" checksum did not match expected SHA-256.`,
        platform: platformName,
        assetName,
      });
    }
  }

  if (!exists) {
    findings.push({
      severity: "error",
      code: "missing-release-asset",
      message: `Release asset "${assetName}" is missing.`,
      platform: platformName,
      assetName,
    });
  }

  return {
    asset: {
      platform: platformName,
      assetName,
      archiveType: platform.archiveType,
      status: exists ? "present" : "missing",
      checksum: {
        source: checksum.source,
        status: checksumStatus,
        assetName: checksum.checksumAssetName,
        expectedSha256: checksum.expectedSha256,
        actualSha256,
      },
    },
    findings,
  };
}

function validateReleaseMetadata(
  manifest: ServiceManifest,
  artifact: ServiceArchiveArtifact,
  releaseVersion: string | null,
): ReleaseManifestVerificationFinding[] {
  const findings: ReleaseManifestVerificationFinding[] = [];
  const manifestReleaseTag = normalizeOptional(artifact.source.tag);
  const effectiveReleaseVersion = releaseVersion ?? manifestReleaseTag;

  if (!normalizeOptional(manifest.version)) {
    findings.push({
      severity: "error",
      code: "missing-runtime-version",
      message: "service.json must include runtime/service version metadata.",
    });
  }

  if (!effectiveReleaseVersion) {
    findings.push({
      severity: "error",
      code: "missing-release-version",
      message: "Release verification requires artifact.source.tag or --release-version.",
    });
  } else if (!releaseVersionPattern.test(effectiveReleaseVersion)) {
    findings.push({
      severity: "error",
      code: "invalid-release-version",
      message: `Release version "${effectiveReleaseVersion}" must use yyyy.m.d-<shortsha>.`,
    });
  }

  if (releaseVersion && manifestReleaseTag && releaseVersion !== manifestReleaseTag) {
    findings.push({
      severity: "error",
      code: "release-version-mismatch",
      message: `--release-version "${releaseVersion}" does not match artifact.source.tag "${manifestReleaseTag}".`,
    });
  }

  return findings;
}

export async function verifyReleaseManifest(
  options: VerifyReleaseManifestOptions,
): Promise<ReleaseManifestVerificationReport> {
  const manifestPath = path.resolve(options.manifestPath);
  const assetsRoot = path.resolve(options.assetsRoot ?? path.dirname(manifestPath));
  const releaseVersion = normalizeOptional(options.releaseVersion);

  let manifest: ServiceManifest;
  try {
    manifest = await loadServiceManifest(manifestPath);
  } catch (error) {
    return buildEmptyReport(manifestPath, assetsRoot, releaseVersion, {
      severity: "error",
      code: "invalid-service-manifest",
      message: error instanceof Error ? error.message : "service.json could not be parsed or validated.",
    });
  }

  if (!manifest.artifact) {
    return buildEmptyReport(manifestPath, assetsRoot, releaseVersion, {
      severity: "error",
      code: "missing-release-artifact-metadata",
      message: "service.json must include archive artifact metadata for release verification.",
    });
  }

  const findings: ReleaseManifestVerificationFinding[] = [
    ...validateReleaseMetadata(manifest, manifest.artifact, releaseVersion),
  ];

  if (!(await fileExists(path.join(assetsRoot, "service.json")))) {
    findings.push({
      severity: "error",
      code: "missing-service-json-asset",
      message: "Release asset set must include service.json.",
      assetName: "service.json",
    });
  }

  const assets: ReleaseAssetVerification[] = [];
  for (const [platformName, platform] of Object.entries(manifest.artifact.platforms)) {
    const result = await verifyPlatformAsset(assetsRoot, platformName, platform);
    assets.push(result.asset);
    findings.push(...result.findings);
  }

  const errors = findings.filter((finding) => finding.severity === "error").length;
  const warnings = findings.filter((finding) => finding.severity === "warning").length;
  const checksumsVerified = assets.filter((asset) => asset.checksum.status === "verified").length;

  return {
    ok: errors === 0,
    status: errors === 0 ? "verified" : "blocked",
    manifestPath,
    assetsRoot,
    releaseVersion: releaseVersion ?? normalizeOptional(manifest.artifact.source.tag),
    service: {
      id: manifest.id,
      version: normalizeOptional(manifest.version),
      sourceRepo: manifest.artifact.source.repo,
      releaseTag: normalizeOptional(manifest.artifact.source.tag),
    },
    summary: {
      errors,
      warnings,
      platforms: Object.keys(manifest.artifact.platforms).length,
      expectedAssets: assets.length,
      presentAssets: assets.filter((asset) => asset.status === "present").length,
      checksumsVerified,
    },
    assets,
    findings,
  };
}
