import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ServiceConfigDocumentResponse,
  ServiceConfigRevisionResponse,
  ServiceConfigSaveResponse,
} from "../../contracts/api.js";
import type { DiscoveredService } from "../../contracts/service.js";
import { getServiceStatePaths } from "../state/paths.js";
import { ApiError } from "../../server/errors.js";

type ServiceConfigSaveInput = {
  content: string;
  actor?: string;
  reason?: string | null;
};

const PORTABLE_BACKUP_ROOT_NAME = "config";
const LEGACY_WORKSPACE_BACKUP_ROOT_NAME = "service-config-backups";

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function safeServiceId(serviceId: string): string {
  return serviceId.replace(/[^A-Za-z0-9_.-]/g, "_");
}

function safeRevisionTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function portableBackupRoot(service: DiscoveredService): string {
  return path.join(getServiceStatePaths(service.serviceRoot).backups, PORTABLE_BACKUP_ROOT_NAME);
}

function legacyWorkspaceBackupRoot(workspaceRoot: string, serviceId: string): string {
  return path.join(workspaceRoot, LEGACY_WORKSPACE_BACKUP_ROOT_NAME, safeServiceId(serviceId));
}

function metadataPathForRevision(contentPath: string): string {
  return `${contentPath}.metadata.json`;
}

function normalizeJsonContent(content: string, serviceId: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new ApiError("invalid_json", 400, "server.json content must be valid JSON before save.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ApiError("invalid_json", 400, "server.json content must be a JSON object.");
  }

  if ((parsed as Record<string, unknown>).id !== serviceId) {
    throw new ApiError("invalid_json", 400, `server.json id must remain "${serviceId}".`);
  }

  return `${JSON.stringify(parsed, null, 2)}\n`;
}

async function fileUpdatedAt(filePath: string): Promise<string> {
  try {
    return (await stat(filePath)).mtime.toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

async function readRevision(contentPath: string): Promise<ServiceConfigRevisionResponse | null> {
  try {
    const [content, rawMetadata] = await Promise.all([
      readFile(contentPath, "utf8"),
      readFile(metadataPathForRevision(contentPath), "utf8"),
    ]);
    const metadata = JSON.parse(rawMetadata) as Omit<ServiceConfigRevisionResponse, "content">;
    return {
      ...metadata,
      content,
    };
  } catch {
    return null;
  }
}

async function readLegacyRevision(filePath: string): Promise<ServiceConfigRevisionResponse | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as ServiceConfigRevisionResponse;
  } catch {
    return null;
  }
}

export async function listServiceConfigRevisions(
  service: DiscoveredService,
  workspaceRoot: string,
): Promise<ServiceConfigRevisionResponse[]> {
  const roots = [
    portableBackupRoot(service),
    legacyWorkspaceBackupRoot(workspaceRoot, service.manifest.id),
  ];
  const revisions = (
    await Promise.all(
      roots.map(async (root) => {
        const entries = await readdir(root).catch(() => [] as string[]);
        const paired = entries
            .filter((entry) => entry.endsWith(".server.json"))
            .map((entry) => readRevision(path.join(root, entry)));
        const legacy = entries
          .filter((entry) => entry.endsWith(".json") && !entry.endsWith(".server.json") && !entry.endsWith(".metadata.json"))
          .map((entry) => readLegacyRevision(path.join(root, entry)));
        return Promise.all([...paired, ...legacy]);
      }),
    )
  ).flat();
  const unique = new Map<string, ServiceConfigRevisionResponse>();

  for (const revision of revisions) {
    if (revision && !unique.has(revision.id)) {
      unique.set(revision.id, revision);
    }
  }

  return [...unique.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function readServiceConfigDocument(
  service: DiscoveredService,
  workspaceRoot: string,
): Promise<ServiceConfigDocumentResponse> {
  const content = await readFile(service.manifestPath, "utf8");
  const revisions = await listServiceConfigRevisions(service, workspaceRoot);

  return {
    serviceId: service.manifest.id,
    fileName: "server.json",
    path: service.manifestPath,
    content,
    hash: sha256(content),
    updatedAt: await fileUpdatedAt(service.manifestPath),
    backupCount: revisions.length,
    revisions,
    safety: {
      rawSecretValuesLoaded: false,
      omittedSensitiveFields: [
        "resolved environment values",
        "provider credentials",
        "authorization headers",
        "runtime-only process state",
      ],
    },
  };
}

export async function saveServiceConfigDocument(
  service: DiscoveredService,
  workspaceRoot: string,
  input: ServiceConfigSaveInput,
): Promise<ServiceConfigSaveResponse> {
  const previousContent = await readFile(service.manifestPath, "utf8");
  const normalizedContent = normalizeJsonContent(input.content, service.manifest.id);
  const previousHash = sha256(previousContent);
  const currentHash = sha256(normalizedContent);
  const savedAt = new Date();
  const revisionId = `${safeRevisionTimestamp(savedAt)}-${previousHash.slice(0, 12)}`;
  const revisionPath = path.join(portableBackupRoot(service), `${revisionId}.server.json`);
  const relativeConfigPath = path.relative(service.serviceRoot, service.manifestPath).split(path.sep).join("/");
  const revision: ServiceConfigRevisionResponse = {
    id: revisionId,
    createdAt: savedAt.toISOString(),
    actor: input.actor?.trim() || "service-admin",
    reason: input.reason?.trim() || null,
    path: relativeConfigPath,
    previousHash,
    currentHash,
    validationStatus: "valid",
    content: previousContent,
  };

  await mkdir(path.dirname(revisionPath), { recursive: true });
  await writeFile(revisionPath, previousContent, "utf8");
  await writeFile(
    metadataPathForRevision(revisionPath),
    JSON.stringify({ ...revision, content: undefined }, null, 2),
    "utf8",
  );

  const tempPath = path.join(path.dirname(service.manifestPath), `.service.json.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tempPath, normalizedContent, "utf8");
  await rename(tempPath, service.manifestPath);

  return {
    serviceId: service.manifest.id,
    fileName: "server.json",
    path: service.manifestPath,
    hash: currentHash,
    savedAt: savedAt.toISOString(),
    backup: revision,
    validationStatus: "valid",
  };
}
