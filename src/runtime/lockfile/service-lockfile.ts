import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import type { DiscoveredService, ServiceArchiveArtifact, ServiceArtifactPlatform } from "../../contracts/service.js";

export const SERVICE_LOCKFILE_NAME = "service-lasso.lock.json";
export const SERVICE_LOCKFILE_VERSION = 1;

export interface ServiceLockfileEntry {
  serviceId: string;
  sourceType: "github-release";
  sourceRepo: string;
  releaseTag: string;
  channel: string | null;
  platform: string;
  assetName: string;
  assetUrl: string | null;
  archiveType: "zip" | "tar.gz" | "tgz";
  checksumSha256: string | null;
  dependencies: string[];
}

export interface ServiceLockfile {
  lockfileVersion: typeof SERVICE_LOCKFILE_VERSION;
  generatedBy: "service-lasso";
  generatedAt: string;
  services: ServiceLockfileEntry[];
}

export type ServiceLockfileVerificationStatus = "ok" | "missing" | "stale" | "extra" | "unsupported";

export interface ServiceLockfileVerificationIssue {
  serviceId: string;
  status: Exclude<ServiceLockfileVerificationStatus, "ok">;
  message: string;
}

export interface ServiceLockfileVerificationResult {
  ok: boolean;
  lockfilePath: string;
  checkedServices: number;
  issues: ServiceLockfileVerificationIssue[];
}

export class ServiceLockfileError extends Error {
  readonly issues: ServiceLockfileVerificationIssue[];

  constructor(message: string, issues: ServiceLockfileVerificationIssue[] = []) {
    super(message);
    this.name = "ServiceLockfileError";
    this.issues = issues;
  }
}

export function resolveServiceLockfilePath(servicesRoot: string): string {
  return path.join(servicesRoot, SERVICE_LOCKFILE_NAME);
}

function currentPlatformArtifact(artifact: ServiceArchiveArtifact, platform: string): {
  platformKey: string;
  definition: ServiceArtifactPlatform;
} | null {
  const platformKey = Object.prototype.hasOwnProperty.call(artifact.platforms, platform) ? platform : "default";
  const definition = artifact.platforms[platformKey];
  return definition ? { platformKey, definition } : null;
}

function trimOrNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function getExpectedServiceLockfileEntry(
  service: DiscoveredService,
  platform: string = process.platform,
): ServiceLockfileEntry | null {
  const artifact = service.manifest.artifact;
  if (!artifact) {
    return null;
  }

  const selected = currentPlatformArtifact(artifact, platform);
  if (!selected) {
    return null;
  }

  const releaseTag = trimOrNull(artifact.source.tag) ?? trimOrNull(artifact.source.channel);
  if (!releaseTag || releaseTag === "latest") {
    return null;
  }

  const assetName = selected.definition.assetName ?? (
    selected.definition.assetUrl ? path.basename(new URL(selected.definition.assetUrl).pathname) : null
  );
  if (!assetName) {
    return null;
  }

  return {
    serviceId: service.manifest.id,
    sourceType: artifact.source.type,
    sourceRepo: artifact.source.repo,
    releaseTag,
    channel: trimOrNull(artifact.source.channel),
    platform: selected.platformKey,
    assetName,
    assetUrl: trimOrNull(selected.definition.assetUrl),
    archiveType: selected.definition.archiveType,
    checksumSha256: trimOrNull(selected.definition.sha256),
    dependencies: [...(service.manifest.depend_on ?? [])].sort(),
  };
}

export function generateServiceLockfile(
  services: DiscoveredService[],
  options: { now?: () => Date; platform?: string } = {},
): ServiceLockfile {
  const platform = options.platform ?? process.platform;
  const entries = services
    .map((service) => getExpectedServiceLockfileEntry(service, platform))
    .filter((entry): entry is ServiceLockfileEntry => entry !== null)
    .sort((left, right) => left.serviceId.localeCompare(right.serviceId));

  return {
    lockfileVersion: SERVICE_LOCKFILE_VERSION,
    generatedBy: "service-lasso",
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
    services: entries,
  };
}

export async function readServiceLockfile(servicesRoot: string): Promise<ServiceLockfile | null> {
  const lockfilePath = resolveServiceLockfilePath(servicesRoot);
  try {
    return parseServiceLockfile(JSON.parse(await readFile(lockfilePath, "utf8")), lockfilePath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function writeServiceLockfile(servicesRoot: string, lockfile: ServiceLockfile): Promise<string> {
  const lockfilePath = resolveServiceLockfilePath(servicesRoot);
  await writeFile(lockfilePath, JSON.stringify(lockfile, null, 2) + "\n");
  return lockfilePath;
}

function parseServiceLockfile(input: unknown, lockfilePath: string): ServiceLockfile {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ServiceLockfileError("Invalid service lockfile at " + lockfilePath + ": expected a JSON object.");
  }
  const record = input as Record<string, unknown>;
  if (record.lockfileVersion !== SERVICE_LOCKFILE_VERSION) {
    throw new ServiceLockfileError("Invalid service lockfile at " + lockfilePath + ": expected lockfileVersion " + SERVICE_LOCKFILE_VERSION + ".");
  }
  if (record.generatedBy !== "service-lasso") {
    throw new ServiceLockfileError("Invalid service lockfile at " + lockfilePath + ": expected generatedBy service-lasso.");
  }
  if (typeof record.generatedAt !== "string" || record.generatedAt.trim().length === 0) {
    throw new ServiceLockfileError("Invalid service lockfile at " + lockfilePath + ": expected generatedAt string.");
  }
  if (!Array.isArray(record.services)) {
    throw new ServiceLockfileError("Invalid service lockfile at " + lockfilePath + ": expected services array.");
  }

  return {
    lockfileVersion: SERVICE_LOCKFILE_VERSION,
    generatedBy: "service-lasso",
    generatedAt: record.generatedAt,
    services: record.services.map((entry, index) => parseServiceLockfileEntry(entry, lockfilePath, index)),
  };
}

function parseServiceLockfileEntry(input: unknown, lockfilePath: string, index: number): ServiceLockfileEntry {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ServiceLockfileError("Invalid service lockfile at " + lockfilePath + ": expected services[" + index + "] object.");
  }
  const entry = input as Record<string, unknown>;
  const stringField = (field: keyof ServiceLockfileEntry): string => {
    const value = entry[field];
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new ServiceLockfileError("Invalid service lockfile at " + lockfilePath + ": expected services[" + index + "]." + field + " string.");
    }
    return value.trim();
  };
  const stringOrNull = (field: keyof ServiceLockfileEntry): string | null => {
    const value = entry[field];
    if (value === null) return null;
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new ServiceLockfileError("Invalid service lockfile at " + lockfilePath + ": expected services[" + index + "]." + field + " string or null.");
    }
    return value.trim();
  };

  if (entry.sourceType !== "github-release") {
    throw new ServiceLockfileError("Invalid service lockfile at " + lockfilePath + ": expected sourceType github-release.");
  }
  if (entry.archiveType !== "zip" && entry.archiveType !== "tar.gz" && entry.archiveType !== "tgz") {
    throw new ServiceLockfileError("Invalid service lockfile at " + lockfilePath + ": expected archiveType zip, tar.gz, or tgz.");
  }
  if (!Array.isArray(entry.dependencies) || entry.dependencies.some((dependency) => typeof dependency !== "string")) {
    throw new ServiceLockfileError("Invalid service lockfile at " + lockfilePath + ": expected dependencies string array.");
  }

  return {
    serviceId: stringField("serviceId"),
    sourceType: "github-release",
    sourceRepo: stringField("sourceRepo"),
    releaseTag: stringField("releaseTag"),
    channel: stringOrNull("channel"),
    platform: stringField("platform"),
    assetName: stringField("assetName"),
    assetUrl: stringOrNull("assetUrl"),
    archiveType: entry.archiveType,
    checksumSha256: stringOrNull("checksumSha256"),
    dependencies: [...entry.dependencies].map(String).sort(),
  };
}

function entriesEqual(left: ServiceLockfileEntry, right: ServiceLockfileEntry): boolean {
  return left.serviceId === right.serviceId
    && left.sourceType === right.sourceType
    && left.sourceRepo === right.sourceRepo
    && left.releaseTag === right.releaseTag
    && left.channel === right.channel
    && left.platform === right.platform
    && left.assetName === right.assetName
    && left.assetUrl === right.assetUrl
    && left.archiveType === right.archiveType
    && left.checksumSha256 === right.checksumSha256
    && left.dependencies.join("\n") === right.dependencies.join("\n");
}

export function verifyServiceLockfile(
  servicesRoot: string,
  services: DiscoveredService[],
  lockfile: ServiceLockfile,
  options: { platform?: string } = {},
): ServiceLockfileVerificationResult {
  const platform = options.platform ?? process.platform;
  const expected = generateServiceLockfile(services, { platform, now: () => new Date(0) });
  const expectedById = new Map(expected.services.map((entry) => [entry.serviceId, entry]));
  const actualById = new Map(lockfile.services.map((entry) => [entry.serviceId, entry]));
  const issues: ServiceLockfileVerificationIssue[] = [];

  for (const service of services) {
    if (service.manifest.artifact && !getExpectedServiceLockfileEntry(service, platform)) {
      issues.push({
        serviceId: service.manifest.id,
        status: "unsupported",
        message: "Service " + service.manifest.id + " has release artifact metadata that cannot be locked for the current platform.",
      });
    }
  }

  for (const [serviceId, expectedEntry] of expectedById) {
    const actual = actualById.get(serviceId);
    if (!actual) {
      issues.push({ serviceId, status: "missing", message: "Service lockfile is missing " + serviceId + "." });
      continue;
    }
    if (!entriesEqual(expectedEntry, actual)) {
      issues.push({ serviceId, status: "stale", message: "Service lockfile entry for " + serviceId + " does not match service.json." });
    }
  }

  for (const serviceId of actualById.keys()) {
    if (!expectedById.has(serviceId)) {
      issues.push({ serviceId, status: "extra", message: "Service lockfile contains " + serviceId + " but no matching locked service was discovered." });
    }
  }

  return {
    ok: issues.length === 0,
    lockfilePath: resolveServiceLockfilePath(servicesRoot),
    checkedServices: expected.services.length,
    issues,
  };
}

export function getLockedServiceEntry(service: DiscoveredService, lockfile: ServiceLockfile): ServiceLockfileEntry | null {
  const expected = getExpectedServiceLockfileEntry(service);
  if (!expected) {
    return null;
  }
  const actual = lockfile.services.find((entry) => entry.serviceId === service.manifest.id);
  if (!actual) {
    throw new ServiceLockfileError("Service lockfile is missing " + service.manifest.id + ".", [
      { serviceId: service.manifest.id, status: "missing", message: "Service lockfile is missing " + service.manifest.id + "." },
    ]);
  }
  if (!entriesEqual(expected, actual)) {
    throw new ServiceLockfileError("Service lockfile entry for " + service.manifest.id + " does not match service.json.", [
      { serviceId: service.manifest.id, status: "stale", message: "Service lockfile entry for " + service.manifest.id + " does not match service.json." },
    ]);
  }
  return actual;
}
