import { createHash } from "node:crypto";
import path from "node:path";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import type { DiscoveredService } from "../../contracts/service.js";
import { getServiceStatePaths } from "../../runtime/state/paths.js";
import { ApiError } from "../errors.js";
import type { ServiceConfigDocumentResponse, ServiceConfigSaveResponse } from "../../contracts/api.js";

interface ServiceConfigRevisionFile {
  id: string;
  createdAt: string;
  actor: string;
  reason: string | null;
  path: string;
  previousHash: string;
  currentHash: string;
  validationStatus: "valid";
  content: string;
}

interface ServiceConfigSaveBody {
  content: string;
  actor: string;
  reason: string | null;
}

const serviceConfigBackupDirName = "service-config";

function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function toRevisionId(createdAt: string): string {
  return createdAt.replaceAll(/[^0-9A-Za-z]+/g, "-").replaceAll(/^-|-$/g, "");
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

async function readRevisions(service: DiscoveredService): Promise<ServiceConfigRevisionFile[]> {
  const backupDir = await getConfigBackupDir(service);
  const entries = await readdir(backupDir, { withFileTypes: true }).catch(() => []);
  const revisions = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map(async (entry) => {
        const content = await readFile(path.join(backupDir, entry.name), "utf8");
        const parsed = JSON.parse(content) as ServiceConfigRevisionFile;
        return parsed;
      }),
  );

  return revisions.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function createServiceConfigDocumentResponse(
  service: DiscoveredService,
): Promise<ServiceConfigDocumentResponse> {
  const content = await readFile(service.manifestPath, "utf8");
  const manifestStats = await stat(service.manifestPath);
  const revisions = await readRevisions(service);

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
  const backup: ServiceConfigRevisionFile = {
    id: toRevisionId(createdAt),
    createdAt,
    actor: body.actor,
    reason: body.reason,
    path: service.manifestPath,
    previousHash,
    currentHash: nextHash,
    validationStatus: "valid",
    content: previousContent,
  };

  await writeFile(path.join(backupDir, `${backup.id}.json`), JSON.stringify(backup, null, 2));
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
