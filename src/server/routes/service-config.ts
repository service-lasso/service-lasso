import { createHash } from "node:crypto";
import path from "node:path";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import type { DiscoveredService } from "../../contracts/service.js";
import { getServiceStatePaths } from "../../runtime/state/paths.js";
import { ApiError } from "../errors.js";
import type { ServiceConfigDocumentResponse, ServiceConfigSaveResponse } from "../../contracts/api.js";

interface ServiceConfigRevisionMetadata {
  id: string;
  createdAt: string;
  actor: string;
  reason: string | null;
  path: string;
  serviceId?: string;
  relativeConfigPath?: string;
  previousHash: string;
  currentHash: string;
  validationStatus: "valid";
  runtimeVersion?: string | null;
}

interface ServiceConfigRevisionFile extends ServiceConfigRevisionMetadata {
  content: string;
}

interface ServiceConfigSaveBody {
  content: string;
  actor: string;
  reason: string | null;
}

const serviceConfigBackupDirName = "config";
const legacyServiceConfigBackupDirName = "service-config";
const legacyWorkspaceConfigBackupDirName = "service-config-backups";

function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function toRevisionId(createdAt: string, previousHash: string): string {
  const timestamp = createdAt.replaceAll(/[^0-9A-Za-z]+/g, "-").replaceAll(/^-|-$/g, "");
  return `${timestamp}-${previousHash.slice(0, 12)}`;
}

function parseServiceConfigSaveBody(input: unknown): ServiceConfigSaveBody {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ApiError("invalid_body", 400, "Service config save body must be a JSON object.");
  }

  const candidate = input as Record<string, unknown>;
  if (typeof candidate.content !== "string") {
    throw new ApiError("invalid_body", 400, "\"content\" must be a string.");
  }

  if (candidate.actor !== undefined && typeof candidate.actor !== "string") {
    throw new ApiError("invalid_body", 400, "\"actor\" must be a string when present.");
  }

  if (candidate.reason !== undefined && candidate.reason !== null && typeof candidate.reason !== "string") {
    throw new ApiError("invalid_body", 400, "\"reason\" must be a string or null when present.");
  }

  return {
    content: candidate.content,
    actor: typeof candidate.actor === "string" && candidate.actor.trim() ? candidate.actor.trim() : "unknown",
    reason: typeof candidate.reason === "string" && candidate.reason.trim() ? candidate.reason.trim() : null,
  };
}

function parseServiceJson(content: string, serviceId: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new ApiError("invalid_json", 400, "Service config content must be valid JSON.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ApiError("invalid_json", 400, "Service config content must be a JSON object.");
  }

  const id = (parsed as Record<string, unknown>).id;
  if (id !== serviceId) {
    throw new ApiError("invalid_json", 400, `Service config id must remain "${serviceId}".`);
  }

  return parsed;
}

async function getConfigBackupDir(service: DiscoveredService): Promise<string> {
  const paths = getServiceStatePaths(service.serviceRoot);
  const backupDir = path.join(paths.backups, serviceConfigBackupDirName);
  await mkdir(backupDir, { recursive: true });
  return backupDir;
}

function getLegacyServiceConfigBackupDir(service: DiscoveredService): string {
  const paths = getServiceStatePaths(service.serviceRoot);
  return path.join(paths.backups, legacyServiceConfigBackupDirName);
}

function getLegacyWorkspaceConfigBackupDir(workspaceRoot: string, service: DiscoveredService): string {
  return path.join(workspaceRoot, legacyWorkspaceConfigBackupDirName, service.manifest.id);
}

async function readPortableRevisions(service: DiscoveredService): Promise<ServiceConfigRevisionFile[]> {
  const backupDir = await getConfigBackupDir(service);
  const entries = await readdir(backupDir, { withFileTypes: true }).catch(() => []);
  const metadataEntries = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".metadata.json"));

  return Promise.all(
    metadataEntries.map(async (entry) => {
      const metadataPath = path.join(backupDir, entry.name);
      const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as ServiceConfigRevisionMetadata;
      const contentFileName = entry.name.replace(/\.metadata\.json$/u, ".server.json");
      const content = await readFile(path.join(backupDir, contentFileName), "utf8");

      return {
        ...metadata,
        content,
      };
    }),
  );
}

async function readLegacyRevisionFiles(backupDir: string): Promise<ServiceConfigRevisionFile[]> {
  const entries = await readdir(backupDir, { withFileTypes: true }).catch(() => []);

  return Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map(async (entry) => {
        const content = await readFile(path.join(backupDir, entry.name), "utf8");
        const parsed = JSON.parse(content) as ServiceConfigRevisionFile;
        return parsed;
      }),
  );
}

async function readRevisions(service: DiscoveredService, workspaceRoot: string): Promise<ServiceConfigRevisionFile[]> {
  const revisions = [
    ...(await readPortableRevisions(service)),
    ...(await readLegacyRevisionFiles(getLegacyServiceConfigBackupDir(service))),
    ...(await readLegacyRevisionFiles(getLegacyWorkspaceConfigBackupDir(workspaceRoot, service))),
  ];
  const uniqueRevisions = new Map<string, ServiceConfigRevisionFile>();

  for (const revision of revisions) {
    if (!uniqueRevisions.has(revision.id)) {
      uniqueRevisions.set(revision.id, revision);
    }
  }

  return [...uniqueRevisions.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function createServiceConfigDocumentResponse(
  service: DiscoveredService,
  workspaceRoot: string,
): Promise<ServiceConfigDocumentResponse> {
  const content = await readFile(service.manifestPath, "utf8");
  const manifestStats = await stat(service.manifestPath);
  const revisions = await readRevisions(service, workspaceRoot);

  return {
    serviceId: service.manifest.id,
    fileName: "server.json",
    path: service.manifestPath,
    content,
    hash: hashContent(content),
    updatedAt: manifestStats.mtime.toISOString(),
    backupCount: revisions.length,
    revisions,
    safety: {
      rawSecretValuesLoaded: false,
      omittedSensitiveFields: [],
    },
  };
}

export async function saveServiceConfigDocument(
  service: DiscoveredService,
  input: unknown,
): Promise<ServiceConfigSaveResponse> {
  const body = parseServiceConfigSaveBody(input);
  parseServiceJson(body.content, service.manifest.id);

  const previousContent = await readFile(service.manifestPath, "utf8");
  const previousHash = hashContent(previousContent);
  const nextHash = hashContent(body.content);
  const createdAt = new Date().toISOString();
  const backupDir = await getConfigBackupDir(service);
  const revisionId = toRevisionId(createdAt, previousHash);
  const metadata: ServiceConfigRevisionMetadata = {
    id: revisionId,
    createdAt,
    actor: body.actor,
    reason: body.reason,
    path: path.relative(service.serviceRoot, service.manifestPath).split(path.sep).join("/"),
    serviceId: service.manifest.id,
    relativeConfigPath: path.relative(service.serviceRoot, service.manifestPath).split(path.sep).join("/"),
    previousHash,
    currentHash: nextHash,
    validationStatus: "valid",
    runtimeVersion: null,
  };
  const backup: ServiceConfigRevisionFile = {
    ...metadata,
    content: previousContent,
  };

  await writeFile(path.join(backupDir, `${revisionId}.server.json`), previousContent);
  await writeFile(path.join(backupDir, `${revisionId}.metadata.json`), JSON.stringify(metadata, null, 2));
  await writeFile(service.manifestPath, body.content.endsWith("\n") ? body.content : `${body.content}\n`);

  return {
    serviceId: service.manifest.id,
    fileName: "server.json",
    path: service.manifestPath,
    hash: nextHash,
    savedAt: createdAt,
    backup,
    validationStatus: "valid",
  };
}
