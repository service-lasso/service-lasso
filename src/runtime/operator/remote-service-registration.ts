import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { ApiError } from "../../server/errors.js";
import { importServiceManifestFromCli } from "../cli/importService.js";
import type { PermissionActor } from "../permissions/enforcement.js";
import type { ServiceManifest } from "../../contracts/service.js";

export interface RemoteServiceRegistrationRequest {
  repo: string;
  tag: string;
  idempotencyKey: string;
}

export interface RemoteServiceRegistrationOperation {
  id: string;
  kind: "service_registration";
  status: "completed" | "conflict";
  replayed: boolean;
  actorId: string;
  repo: string;
  tag: string;
  serviceId: string;
  version: string | null;
  createdAt: string;
  completedAt: string;
  errorCode: string | null;
}

interface PersistedOperation extends Omit<RemoteServiceRegistrationOperation, "replayed"> {
  requestFingerprint: string;
}

interface PersistedOperationStore {
  version: 1;
  operations: PersistedOperation[];
}

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const TAG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertApprovedReleaseManifest(manifest: ServiceManifest, repo: string, tag: string): void {
  if (!repo.startsWith("service-lasso/")) {
    throw new ApiError("unapproved_release", 403, "Only approved Service Lasso publisher releases can be registered.");
  }
  const artifact = manifest.artifact;
  if (
    !artifact || artifact.kind !== "archive" || artifact.source.type !== "github-release" ||
    artifact.source.repo !== repo || artifact.source.tag !== tag
  ) {
    throw new ApiError("release_manifest_mismatch", 409, "The release manifest does not bind to the requested approved release.");
  }
  const platforms = Object.values(artifact.platforms);
  if (platforms.length === 0 || platforms.some((platform) => platform.checksum?.algorithm !== "sha256" || (!platform.checksum.value && !platform.checksum.assetName))) {
    throw new ApiError("release_checksum_required", 409, "Approved release manifests require SHA-256 checksum bindings for every platform artifact.");
  }
}

function storePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".service-lasso", "operator", "service-registration-operations.json");
}

async function readStore(workspaceRoot: string): Promise<PersistedOperationStore> {
  try {
    const parsed = JSON.parse(await readFile(storePath(workspaceRoot), "utf8")) as Partial<PersistedOperationStore>;
    if (parsed.version !== 1 || !Array.isArray(parsed.operations)) {
      throw new ApiError("operation_store_invalid", 503, "Service registration operation state is unavailable.");
    }
    return { version: 1, operations: parsed.operations };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { version: 1, operations: [] };
    }
    throw error;
  }
}

async function writeStore(workspaceRoot: string, store: PersistedOperationStore): Promise<void> {
  const targetPath = storePath(workspaceRoot);
  await mkdir(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(store)}\n`, "utf8");
  await rename(temporaryPath, targetPath);
}

function toPublicOperation(operation: PersistedOperation, replayed: boolean): RemoteServiceRegistrationOperation {
  const { requestFingerprint: _requestFingerprint, ...publicOperation } = operation;
  return { ...publicOperation, replayed };
}

export function parseRemoteServiceRegistrationRequest(input: unknown): RemoteServiceRegistrationRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ApiError("invalid_body", 400, "Service registration body must be a JSON object.");
  }
  const candidate = input as Record<string, unknown>;
  const allowed = new Set(["repo", "tag", "idempotencyKey", "confirm"]);
  if (Object.keys(candidate).some((key) => !allowed.has(key))) {
    throw new ApiError("invalid_body", 400, "Service registration accepts only repo, tag, idempotencyKey, and confirm.");
  }
  if (typeof candidate.repo !== "string" || !REPO_PATTERN.test(candidate.repo)) {
    throw new ApiError("invalid_repo", 400, '"repo" must be an owner/repository release reference.');
  }
  if (typeof candidate.tag !== "string" || !TAG_PATTERN.test(candidate.tag)) {
    throw new ApiError("invalid_tag", 400, '"tag" must be an immutable release tag.');
  }
  if (typeof candidate.idempotencyKey !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(candidate.idempotencyKey)) {
    throw new ApiError("invalid_idempotency_key", 400, '"idempotencyKey" must be an opaque 8-128 character key.');
  }
  if (candidate.confirm !== true) {
    throw new ApiError("confirmation_required", 409, "Service registration requires explicit server-side confirmation.");
  }
  return { repo: candidate.repo, tag: candidate.tag, idempotencyKey: candidate.idempotencyKey };
}

export async function registerReleasedService(input: {
  workspaceRoot: string;
  servicesRoot: string;
  actor: PermissionActor;
  request: RemoteServiceRegistrationRequest;
}): Promise<RemoteServiceRegistrationOperation> {
  const requestFingerprint = sha256(JSON.stringify({ repo: input.request.repo, tag: input.request.tag }));
  const keyFingerprint = sha256(`${input.actor.id}\u0000${input.request.idempotencyKey}`);
  const operationId = `sro_${keyFingerprint.slice(0, 32)}`;
  const store = await readStore(input.workspaceRoot);
  const existing = store.operations.find((operation) => operation.id === operationId && operation.actorId === input.actor.id);
  if (existing) {
    if (existing.requestFingerprint !== requestFingerprint) {
      throw new ApiError("idempotency_key_reused", 409, "The idempotency key was already used for a different registration request.");
    }
    return toPublicOperation(existing, true);
  }

  let result;
  try {
    result = await importServiceManifestFromCli({
      repo: input.request.repo,
      tag: input.request.tag,
      servicesRoot: input.servicesRoot,
      workspaceRoot: input.workspaceRoot,
      permissionActor: input.actor,
      validateReleasedManifest: (manifest) => assertApprovedReleaseManifest(manifest, input.request.repo, input.request.tag),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const match = /^Refusing to overwrite existing manifest for "([^"]+)"/.exec(message);
    if (!match) throw error;
    result = {
      ok: false,
      resolvedTag: input.request.tag,
      serviceId: match[1],
      version: null,
      conflict: { kind: "target_manifest_exists" as const },
    };
  }
  const now = new Date().toISOString();
  const operation: PersistedOperation = {
    id: operationId,
    kind: "service_registration",
    status: result.ok ? "completed" : "conflict",
    actorId: input.actor.id,
    repo: input.request.repo,
    tag: result.resolvedTag ?? input.request.tag,
    serviceId: result.serviceId,
    version: result.version,
    createdAt: now,
    completedAt: now,
    errorCode: result.conflict?.kind ?? null,
    requestFingerprint,
  };
  store.operations.push(operation);
  await writeStore(input.workspaceRoot, store);
  return toPublicOperation(operation, false);
}

export async function readRemoteServiceRegistrationOperation(input: {
  workspaceRoot: string;
  actor: PermissionActor;
  operationId: string;
}): Promise<RemoteServiceRegistrationOperation> {
  if (!/^sro_[a-f0-9]{32}$/.test(input.operationId)) {
    throw new ApiError("operation_not_found", 404, "Service registration operation was not found.");
  }
  const store = await readStore(input.workspaceRoot);
  const operation = store.operations.find((candidate) => candidate.id === input.operationId && candidate.actorId === input.actor.id);
  if (!operation) {
    throw new ApiError("operation_not_found", 404, "Service registration operation was not found.");
  }
  return toPublicOperation(operation, false);
}
