import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, rename, rm, rmdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ApiError } from "../../server/errors.js";
import { discoverServices } from "../discovery/discoverServices.js";
import { validateServiceManifest } from "../discovery/validateManifest.js";
import type { PermissionActor } from "../permissions/enforcement.js";
import type { ServiceManifest } from "../../contracts/service.js";
import type { DirectChildImporter } from "../release/staged-service-transfer.js";
import { withCrossProcessFileLock } from "../security/cross-process-file-lock.js";

export interface RemoteServiceRegistrationRequest {
  repo: string;
  tag: string;
  expectedCommit: string;
  expectedManifestSha256: string;
  idempotencyKey: string;
}

export interface RemoteServiceRegistrationOperation {
  id: string;
  kind: "service_registration";
  status: "completed" | "conflict" | "unknown";
  replayed: boolean;
  actorId: string;
  repo: string;
  tag: string;
  sourceCommit: string;
  serviceId: string;
  version: string | null;
  createdAt: string;
  completedAt: string | null;
  errorCode: string | null;
}

interface PersistedOperation extends Omit<RemoteServiceRegistrationOperation, "replayed"> {
  requestFingerprint: string;
  manifestSha256: string;
  staged?: {
    source: "staged_release_asset";
    workspaceId: string;
    stageId: string;
    byteObjectId: string;
    byteLength: number;
    fullDigest: string;
    platform: "win32" | "linux" | "darwin";
    assetName: string;
    archiveType: "zip" | "tar.gz" | "tgz";
    manifestAssetId: string | null;
    checksumAssetId: string | null;
  };
}

export interface PersistedOperationStore {
  version: 1;
  operations: PersistedOperation[];
  /**
   * #1463 keeps its stages in this document as well.  It is deliberately
   * opaque here: the stage owner validates its own schema, while ordinary
   * #1462 records retain their exact v1 shape.
   */
  stagedTransfer?: unknown;
}

interface GitHubReleaseResponse {
  tag_name?: unknown;
  assets?: unknown;
}

interface GitRefResponse {
  object?: { sha?: unknown; type?: unknown };
}

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const TAG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const registrationLocks = new Map<string, Promise<void>>();
const TRUSTED_GITHUB_API_ORIGIN = "https://api.github.com";
const APPROVED_RELEASE_REPOSITORIES = new Set([
  "service-lasso/lasso-archive",
  "service-lasso/lasso-bpmn-server",
  "service-lasso/lasso-cacao-roaster",
  "service-lasso/lasso-dagu",
  "service-lasso/lasso-fastapi",
  "service-lasso/lasso-filebeat",
  "service-lasso/lasso-files",
  "service-lasso/lasso-java",
  "service-lasso/lasso-jupyterlab",
  "service-lasso/lasso-keycloak",
  "service-lasso/lasso-localcert",
  "service-lasso/lasso-mongo",
  "service-lasso/lasso-node",
  "service-lasso/lasso-openobserve",
  "service-lasso/lasso-pgadmin4",
  "service-lasso/lasso-postgres",
  "service-lasso/lasso-python",
  "service-lasso/lasso-secretsbroker",
  "service-lasso/lasso-soarca",
  "service-lasso/lasso-totaljs-flow",
  "service-lasso/lasso-totaljs-messageservice",
  "service-lasso/lasso-typedb",
  "service-lasso/lasso-websight-cms",
  "service-lasso/lasso-zitadel",
]);

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function githubHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
  return {
    accept: "application/vnd.github+json",
    "user-agent": "service-lasso-core-runtime",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

function assertApprovedReleaseRepository(repo: string): void {
  if (!APPROVED_RELEASE_REPOSITORIES.has(repo)) {
    throw new ApiError("unapproved_release", 403, "Only explicitly approved Service Lasso publisher releases can be registered.");
  }
}

export function serviceRegistrationOperationStorePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".service-lasso", "operator", "service-registration-operations.json");
}

async function readStore(workspaceRoot: string): Promise<PersistedOperationStore> {
  try {
    const parsed = JSON.parse(await readFile(serviceRegistrationOperationStorePath(workspaceRoot), "utf8")) as Partial<PersistedOperationStore>;
    if (parsed.version !== 1 || !Array.isArray(parsed.operations)) {
      throw new ApiError("operation_store_invalid", 503, "Service registration operation state is unavailable.");
    }
    // Preserve the co-resident staged journal.  Dropping unknown data here
    // would recreate the split-store crash window this adapter is meant to
    // close.
    return parsed as PersistedOperationStore;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return { version: 1, operations: [] };
    throw error;
  }
}

async function writeStore(workspaceRoot: string, store: PersistedOperationStore): Promise<void> {
  const targetPath = serviceRegistrationOperationStorePath(workspaceRoot);
  await mkdir(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(store)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporaryPath, targetPath);
}

function toPublicOperation(operation: PersistedOperation, replayed: boolean): RemoteServiceRegistrationOperation {
  const { requestFingerprint: _requestFingerprint, manifestSha256: _manifestSha256, ...publicOperation } = operation;
  return { ...publicOperation, replayed };
}

async function withWorkspaceRegistrationLock<T>(workspaceRoot: string, action: () => Promise<T>): Promise<T> {
  const key = path.resolve(workspaceRoot);
  const prior = registrationLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = prior.then(() => current);
  registrationLocks.set(key, queued);
  await prior;
  try {
    return await withCrossProcessFileLock(serviceRegistrationOperationStorePath(workspaceRoot) + ".lock", action, {
      unavailableMessage: "service registration operation state is unavailable",
    });
  } finally {
    release();
    if (registrationLocks.get(key) === queued) registrationLocks.delete(key);
  }
}

function assertApprovedReleaseManifest(manifest: ServiceManifest, request: RemoteServiceRegistrationRequest): void {
  assertApprovedReleaseRepository(request.repo);
  const artifact = manifest.artifact;
  if (
    !artifact || artifact.kind !== "archive" || artifact.source.type !== "github-release" ||
    artifact.source.repo !== request.repo || artifact.source.tag !== request.tag
  ) {
    throw new ApiError("release_manifest_mismatch", 409, "The release manifest does not bind to the requested approved release.");
  }
  const platforms = Object.values(artifact.platforms);
  if (platforms.length === 0 || platforms.some((platform) => platform.checksum?.algorithm !== "sha256" || (!platform.checksum.value && !platform.checksum.assetName))) {
    throw new ApiError("release_checksum_required", 409, "Approved release manifests require SHA-256 checksum bindings for every platform artifact.");
  }
}

async function resolveReleasedManifest(request: RemoteServiceRegistrationRequest): Promise<{ manifest: ServiceManifest; manifestBytes: string }> {
  const headers = githubHeaders();
  const tagRef = await fetch(`${TRUSTED_GITHUB_API_ORIGIN}/repos/${request.repo}/git/ref/tags/${encodeURIComponent(request.tag)}`, { headers });
  if (!tagRef.ok) throw new ApiError("release_provenance_unavailable", 503, "Release provenance could not be resolved.");
  const ref = await tagRef.json() as GitRefResponse;
  if (ref.object?.type !== "commit" || ref.object.sha !== request.expectedCommit) {
    throw new ApiError("release_commit_mismatch", 409, "The release tag does not resolve to the caller-bound commit.");
  }
  const releaseResponse = await fetch(`${TRUSTED_GITHUB_API_ORIGIN}/repos/${request.repo}/releases/tags/${encodeURIComponent(request.tag)}`, { headers });
  if (!releaseResponse.ok) throw new ApiError("release_provenance_unavailable", 503, "Release metadata could not be resolved.");
  const release = await releaseResponse.json() as GitHubReleaseResponse;
  if (release.tag_name !== request.tag || !Array.isArray(release.assets)) {
    throw new ApiError("release_manifest_mismatch", 409, "Release metadata does not match the requested tag.");
  }
  const assets = release.assets.filter((asset): asset is { name: string; browser_download_url: string } =>
    Boolean(asset && typeof asset === "object" && (asset as { name?: unknown }).name === "service.json" && typeof (asset as { browser_download_url?: unknown }).browser_download_url === "string"),
  );
  if (assets.length !== 1) throw new ApiError("release_manifest_mismatch", 409, "Release metadata must contain exactly one service.json asset.");
  let manifestAssetUrl: URL;
  try { manifestAssetUrl = new URL(assets[0].browser_download_url); } catch { throw new ApiError("release_manifest_mismatch", 409, "Release manifest asset URL is invalid."); }
  if (manifestAssetUrl.protocol !== "https:" || !isApprovedGitHubAssetHost(manifestAssetUrl.hostname)) {
    throw new ApiError("release_manifest_mismatch", 409, "Release manifest asset URL is not an approved GitHub HTTPS destination.");
  }
  const manifestResponse = await fetchApprovedManifestAsset(manifestAssetUrl);
  if (!manifestResponse.ok) throw new ApiError("release_manifest_unavailable", 503, "Release manifest could not be downloaded.");
  const manifestBytes = await manifestResponse.text();
  if (sha256(manifestBytes) !== request.expectedManifestSha256) {
    throw new ApiError("release_manifest_digest_mismatch", 409, "Downloaded release manifest does not match the caller-bound digest.");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(manifestBytes); } catch { throw new ApiError("release_manifest_invalid", 409, "Release manifest is not valid JSON."); }
  const manifest = validateServiceManifest(parsed, `${request.repo}@${request.tag}:service.json`);
  assertApprovedReleaseManifest(manifest, request);
  return { manifest, manifestBytes };
}

function isApprovedGitHubAssetHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "github.com" || host.endsWith(".githubusercontent.com");
}

async function fetchApprovedManifestAsset(initialUrl: URL): Promise<Response> {
  let currentUrl = initialUrl;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    if (currentUrl.protocol !== "https:" || !isApprovedGitHubAssetHost(currentUrl.hostname)) {
      throw new ApiError("release_manifest_mismatch", 409, "Release manifest redirected outside approved GitHub HTTPS destinations.");
    }
    const response = await fetch(currentUrl, { headers: { accept: "application/json" }, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) throw new ApiError("release_manifest_mismatch", 409, "Release manifest redirect is missing a destination.");
    try { currentUrl = new URL(location, currentUrl); } catch { throw new ApiError("release_manifest_mismatch", 409, "Release manifest redirect destination is invalid."); }
  }
  throw new ApiError("release_manifest_mismatch", 409, "Release manifest redirect limit exceeded.");
}

async function isSafeDirectChildManifest(servicesRoot: string, serviceId: string): Promise<string | null> {
  try {
    const root = await safeDirectChildRoot(servicesRoot);
    if (!root) return null;
    const serviceRoot = path.resolve(root, serviceId);
    if (path.dirname(serviceRoot) !== root) return null;
    const serviceStat = await lstat(serviceRoot);
    if (!serviceStat.isDirectory() || serviceStat.isSymbolicLink()) return null;
    if (path.dirname(await realpath(serviceRoot)) !== await realpath(root)) return null;
    const targetPath = path.join(serviceRoot, "service.json");
    const targetStat = await lstat(targetPath);
    if (!targetStat.isFile() || targetStat.isSymbolicLink()) return null;
    return targetPath;
  } catch {
    return null;
  }
}

/**
 * A staged release is admitted only beneath the caller-selected services
 * authority.  Do not create that authority on demand: a missing, linked, or
 * otherwise redirected root is an unavailable direct-child boundary, not an
 * invitation to follow it and write a durable release attachment elsewhere.
 */
async function safeDirectChildRoot(servicesRoot: string): Promise<string | null> {
  try {
    const root = path.resolve(servicesRoot);
    const rootStat = await lstat(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return null;
    return root;
  } catch {
    return null;
  }
}

async function manifestAtTargetMatches(servicesRoot: string, operation: PersistedOperation): Promise<boolean> {
  try {
    const target = await isSafeDirectChildManifest(servicesRoot, operation.serviceId);
    if (!target) return false;
    return sha256(await readFile(target, "utf8")) === operation.manifestSha256 &&
      (await discoverServices(servicesRoot)).some((service) => service.manifest.id === operation.serviceId && service.manifestPath === target);
  } catch {
    return false;
  }
}

async function rollbackOwnedManifest(serviceRoot: string, targetPath: string, manifestBytes: string): Promise<boolean> {
  try {
    const root = path.dirname(serviceRoot);
    const rootStat = await lstat(root);
    const serviceStat = await lstat(serviceRoot);
    const targetStat = await lstat(targetPath);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || !serviceStat.isDirectory() || serviceStat.isSymbolicLink() || !targetStat.isFile() || targetStat.isSymbolicLink()) return false;
    if (path.dirname(await realpath(serviceRoot)) !== await realpath(root)) return false;
    if ((await readFile(targetPath, "utf8")) !== manifestBytes) return false;
    await unlink(targetPath);
    await rmdir(serviceRoot);
    return true;
  } catch {
    return false;
  }
}

async function importVerifiedManifest(input: { servicesRoot: string; manifest: ServiceManifest; manifestBytes: string }): Promise<"completed" | "conflict" | "unknown"> {
  const root = path.resolve(input.servicesRoot);
  const serviceRoot = path.resolve(root, input.manifest.id);
  if (path.dirname(serviceRoot) !== root) return "unknown";
  const targetPath = path.join(serviceRoot, "service.json");
  try {
    await mkdir(root, { recursive: true });
    await mkdir(serviceRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return "conflict";
    return "unknown";
  }
  try {
    await writeFile(targetPath, input.manifestBytes, { encoding: "utf8", flag: "wx" });
    const discovered = await discoverServices(root);
    if (!discovered.some((service) => service.manifest.id === input.manifest.id && service.manifestPath === targetPath)) {
      await rollbackOwnedManifest(serviceRoot, targetPath, input.manifestBytes);
      return "unknown";
    }
    return "completed";
  } catch {
    await rollbackOwnedManifest(serviceRoot, targetPath, input.manifestBytes);
    return "unknown";
  }
}

const STAGED_INPUT_DIRECTORY = ".service-lasso";
const STAGED_INPUT_FILE = "staged-release-input.json";
const STAGED_INPUT_PUBLICATION_FILE = "staged-release-input.published";
// The metadata document alone is not an attachment: it can name an object
// that has already been removed or replaced.  Registration therefore keeps a
// private immutable byte copy beside the direct-child manifest.  This is only
// custody of the caller-held release asset; it is never extracted, acquired,
// installed, or executed here.
const STAGED_INPUT_BYTES_FILE = "staged-release-input.bin";
const WINDOWS_DIRECTORY_SYNC_HELPER_PATH = fileURLToPath(new URL("./windows-directory-sync-helper.exe", import.meta.url));
const WINDOWS_DIRECTORY_SYNC_HELPER_PROVENANCE_PATH = fileURLToPath(new URL("./windows-directory-sync-helper.provenance.json", import.meta.url));
const WINDOWS_DIRECTORY_SYNC_HELPER_BYTES = 4608;
const WINDOWS_DIRECTORY_SYNC_HELPER_PROVENANCE_BYTES = 700;
const WINDOWS_DIRECTORY_SYNC_HELPER_SHA256 = "b2e1fd8fd2ff08d8fb2cbc69ca89d454da0fd3fdcb397d26bb22f2f156a79c91";
const WINDOWS_DIRECTORY_SYNC_HELPER_PROVENANCE_SHA256 = "f32758ae98bc7196a779f8825f82bf0d80dc58f6e10d43871216ba0247eff031";

/**
 * Test-only observation points for the durable direct-child transaction. They
 * are deliberately after the named primitive has returned, so a controlled
 * failure exercises the same uncertain-recovery path as a process loss at
 * that boundary without making the production importer configurable.
 */
export type StagedAttachmentDurabilityBoundary =
  | "manifest_file_synced"
  | "attachment_bytes_file_synced"
  | "attachment_metadata_file_synced"
  | "publication_receipt_file_synced"
  | "attachment_directory_synced"
  | "private_directory_synced"
  | "attachment_files_durable"
  | "publication_renamed"
  | "live_parent_directory_synced"
  | "publication_durable";

type StagedReleaseInputAttachment = {
  schema: "service-lasso.staged-release-input/v1";
  operationId: string; stageId: string; actorId: string; workspaceId: string; targetServiceId: string; idempotencyKey: string;
  byteObject: { id: string; length: number; sha256: string };
  release: {
    id: string; repo: string; tag: string; targetSha: string; assetId: string; assetName: string;
    archiveType: "zip" | "tar.gz" | "tgz"; platform: "win32" | "linux" | "darwin"; manifestAssetId: string | null; checksumAssetId: string | null;
    manifestSha256: string;
  };
};

function stagedInputAttachment(claimed: Omit<Parameters<DirectChildImporter["import"]>[0], "readByteObject" | "manifestBytes">): StagedReleaseInputAttachment {
  return {
    schema: "service-lasso.staged-release-input/v1", operationId: claimed.operationId, stageId: claimed.stageId,
    actorId: claimed.actorId, workspaceId: claimed.workspaceId, targetServiceId: claimed.serviceId,
    idempotencyKey: claimed.idempotencyKey,
    byteObject: { id: claimed.byteObjectId, length: claimed.byteLength, sha256: claimed.archiveSha256 },
    release: {
      id: claimed.releaseId, repo: claimed.repo, tag: claimed.releaseTag, targetSha: claimed.targetSha,
      assetId: claimed.assetId, assetName: claimed.assetName, archiveType: claimed.archiveType, platform: claimed.platform,
      manifestAssetId: claimed.manifestAssetId ?? null, checksumAssetId: claimed.checksumAssetId ?? null,
      manifestSha256: claimed.manifestSha256,
    },
  };
}

function isSameStagedInputAttachment(value: unknown, expected: StagedReleaseInputAttachment): boolean {
  return JSON.stringify(value) === JSON.stringify(expected);
}

function stagedInputPublicationReceipt(attachment: StagedReleaseInputAttachment): string {
  return `${JSON.stringify({ schema: "service-lasso.staged-release-publication/v1", attachmentSha256: sha256(JSON.stringify(attachment)) })}\n`;
}

async function stagedInputAttachmentPath(servicesRoot: string, serviceId: string): Promise<string | null> {
  const manifestPath = await isSafeDirectChildManifest(servicesRoot, serviceId);
  if (!manifestPath) return null;
  const serviceRoot = path.dirname(manifestPath);
  const attachmentDirectory = path.join(serviceRoot, STAGED_INPUT_DIRECTORY);
  try {
    const directory = await lstat(attachmentDirectory);
    if (!directory.isDirectory() || directory.isSymbolicLink()) return null;
    if (path.dirname(await realpath(attachmentDirectory)) !== await realpath(serviceRoot)) return null;
    const attachmentPath = path.join(attachmentDirectory, STAGED_INPUT_FILE);
    const attachment = await lstat(attachmentPath);
    if (!attachment.isFile() || attachment.isSymbolicLink()) return null;
    return attachmentPath;
  } catch { return null; }
}

async function stagedInputBytesPath(servicesRoot: string, serviceId: string): Promise<string | null> {
  const attachmentPath = await stagedInputAttachmentPath(servicesRoot, serviceId);
  if (!attachmentPath) return null;
  const bytesPath = path.join(path.dirname(attachmentPath), STAGED_INPUT_BYTES_FILE);
  try {
    const bytes = await lstat(bytesPath);
    if (!bytes.isFile() || bytes.isSymbolicLink()) return null;
    if (path.dirname(await realpath(bytesPath)) !== await realpath(path.dirname(attachmentPath))) return null;
    return bytesPath;
  } catch { return null; }
}

async function stagedInputPublicationPath(servicesRoot: string, serviceId: string): Promise<string | null> {
  const attachmentPath = await stagedInputAttachmentPath(servicesRoot, serviceId);
  if (!attachmentPath) return null;
  const receiptPath = path.join(path.dirname(attachmentPath), STAGED_INPUT_PUBLICATION_FILE);
  try {
    const receipt = await lstat(receiptPath);
    if (!receipt.isFile() || receipt.isSymbolicLink() || path.dirname(await realpath(receiptPath)) !== await realpath(path.dirname(attachmentPath))) return null;
    return receiptPath;
  } catch { return null; }
}

async function syncDirectory(directory: string): Promise<void> {
  // POSIX uses fsync through Node. Windows cannot fsync a directory handle
  // through Node, so use the checked-in native helper which opens the
  // directory with FILE_FLAG_BACKUP_SEMANTICS and calls FlushFileBuffers.
  // Every failed primitive remains an unverifiable publication boundary.
  if (process.platform === "win32") {
    await syncWindowsDirectory(directory);
    return;
  }
  const handle = await open(directory, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

async function syncWindowsDirectory(directory: string): Promise<void> {
  const helperPath = await assertWindowsDirectorySyncHelperIntegrity();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(helperPath, [directory], { windowsHide: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 && signal === null ? resolve() : reject(new Error("Windows directory durability helper failed")));
  });
}

async function assertWindowsDirectorySyncHelperIntegrity(): Promise<string> {
  const readExactRegularAsset = async (assetPath: string, expectedBytes: number): Promise<Buffer> => {
    const beforeOpen = await lstat(assetPath);
    if (!beforeOpen.isFile() || beforeOpen.isSymbolicLink() || beforeOpen.size !== expectedBytes) throw new Error("Windows directory durability helper is unavailable");
    const handle = await open(assetPath, constants.O_RDONLY);
    try {
      const afterOpen = await handle.stat();
      if (!afterOpen.isFile() || afterOpen.size !== expectedBytes) throw new Error("Windows directory durability helper identity changed while opening");
      const bytes = await handle.readFile();
      const afterRead = await handle.stat();
      if (!afterRead.isFile() || afterRead.size !== expectedBytes || bytes.byteLength !== expectedBytes) throw new Error("Windows directory durability helper identity changed while reading");
      return bytes;
    } finally { await handle.close(); }
  };
  let helperBytes: Buffer | null = null;
  let provenanceBytes: Buffer | null = null;
  try {
    helperBytes = await readExactRegularAsset(WINDOWS_DIRECTORY_SYNC_HELPER_PATH, WINDOWS_DIRECTORY_SYNC_HELPER_BYTES);
    provenanceBytes = await readExactRegularAsset(WINDOWS_DIRECTORY_SYNC_HELPER_PROVENANCE_PATH, WINDOWS_DIRECTORY_SYNC_HELPER_PROVENANCE_BYTES);
    if (
      createHash("sha256").update(helperBytes).digest("hex") !== WINDOWS_DIRECTORY_SYNC_HELPER_SHA256 ||
      createHash("sha256").update(provenanceBytes).digest("hex") !== WINDOWS_DIRECTORY_SYNC_HELPER_PROVENANCE_SHA256
    ) throw new Error("Windows directory durability helper integrity verification failed");
    return WINDOWS_DIRECTORY_SYNC_HELPER_PATH;
  } finally {
    helperBytes?.fill(0);
    provenanceBytes?.fill(0);
  }
}

async function writePrivateDurableFile(file: string, bytes: Uint8Array | string, onSynced?: () => Promise<void> | void): Promise<void> {
  const handle = await open(file, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally { await handle.close(); }
  await onSynced?.();
}

async function removePrivateTransaction(privateRoot: string): Promise<void> {
  try { await rm(privateRoot, { recursive: true, force: true, maxRetries: 0 }); } catch { /* retained private evidence is safer than an unproved cleanup */ }
}

async function importStagedReleaseAttachment(input: { servicesRoot: string; manifest: ServiceManifest; manifestBytes: string; attachment: StagedReleaseInputAttachment; archiveBytes: Uint8Array; onDurabilityBoundary?: (boundary: StagedAttachmentDurabilityBoundary) => Promise<void> | void }): Promise<"completed" | "conflict" | "unknown"> {
  // A normal empty workspace may not have its services directory yet.  Create
  // only that configured directory, then prove it is still a real directory
  // before resolving any child path; mkdir on an existing junction is harmless
  // but the subsequent lstat rejects the redirection.
  try { await mkdir(path.resolve(input.servicesRoot), { recursive: true }); } catch { return "unknown"; }
  const root = await safeDirectChildRoot(input.servicesRoot);
  if (!root) return "unknown";
  const serviceRoot = path.resolve(root, input.manifest.id);
  if (path.dirname(serviceRoot) !== root) return "unknown";
  // Build the complete direct child in a private sibling.  A power loss can
  // expose either no child or a child whose manifest, bytes, and metadata were
  // all synced before the one directory rename; it can never expose a sealed
  // success with a partially written attachment.
  const privateRoot = path.join(root, `.${input.manifest.id}.staged-${randomBytes(12).toString("hex")}`);
  const manifestPath = path.join(privateRoot, "service.json");
  const attachmentDirectory = path.join(privateRoot, STAGED_INPUT_DIRECTORY);
  const attachmentPath = path.join(attachmentDirectory, STAGED_INPUT_FILE);
  const bytesPath = path.join(attachmentDirectory, STAGED_INPUT_BYTES_FILE);
  const attachmentBytes = `${JSON.stringify(input.attachment)}\n`;
  let privateCreated = false;
  if (input.archiveBytes.byteLength !== input.attachment.byteObject.length || createHash("sha256").update(input.archiveBytes).digest("hex") !== input.attachment.byteObject.sha256) return "unknown";
  try {
    await mkdir(privateRoot, { mode: 0o700 });
    privateCreated = true;
    await writePrivateDurableFile(manifestPath, input.manifestBytes, () => input.onDurabilityBoundary?.("manifest_file_synced"));
    await mkdir(attachmentDirectory, { mode: 0o700 });
    const directory = await lstat(attachmentDirectory);
    if (!directory.isDirectory() || directory.isSymbolicLink() || path.dirname(await realpath(attachmentDirectory)) !== await realpath(privateRoot)) throw new Error("unsafe attachment directory");
    await writePrivateDurableFile(bytesPath, input.archiveBytes, () => input.onDurabilityBoundary?.("attachment_bytes_file_synced"));
    await writePrivateDurableFile(attachmentPath, attachmentBytes, () => input.onDurabilityBoundary?.("attachment_metadata_file_synced"));
    // The receipt binds the manifest, byte attachment and metadata while this
    // directory is still private. Discovery therefore never sees a child that
    // lacks its composite receipt.
    await writePrivateDurableFile(path.join(attachmentDirectory, STAGED_INPUT_PUBLICATION_FILE), stagedInputPublicationReceipt(input.attachment), () => input.onDurabilityBoundary?.("publication_receipt_file_synced"));
    await syncDirectory(attachmentDirectory);
    await input.onDurabilityBoundary?.("attachment_directory_synced");
    await syncDirectory(privateRoot);
    await input.onDurabilityBoundary?.("private_directory_synced");
    await input.onDurabilityBoundary?.("attachment_files_durable");
    await rename(privateRoot, serviceRoot);
    await input.onDurabilityBoundary?.("publication_renamed");
    await syncDirectory(root);
    await input.onDurabilityBoundary?.("live_parent_directory_synced");
    await input.onDurabilityBoundary?.("publication_durable");
    const discovered = await discoverServices(root);
    const publishedManifestPath = path.join(serviceRoot, "service.json");
    if (!discovered.some((service) => service.manifest.id === input.manifest.id && service.manifestPath === publishedManifestPath) || Buffer.compare(await readFile(path.join(serviceRoot, STAGED_INPUT_DIRECTORY, STAGED_INPUT_BYTES_FILE)), Buffer.from(input.archiveBytes)) !== 0) return "unknown";
    return "completed";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      if (privateCreated) await removePrivateTransaction(privateRoot);
      return "conflict";
    }
    // Once renamed, ownership of the retained child is intentionally not
    // guessed.  The caller retains unknown and restart reconciliation decides.
    if (privateCreated) await removePrivateTransaction(privateRoot);
    return "unknown";
  }
}

/**
 * The #1463 adapter deliberately shares the existing direct-child importer.
 * The archive is never downloaded here: the only archive input is the byte
 * object retained and claimed by StagedServiceTransfer. The same-release
 * manifest bytes must travel from the resolver through that held record; the
 * child never fetches a release asset, extracts an archive, or starts a service.
 */
export function createStagedReleaseAssetImporter(input: { servicesRoot: string; onDurabilityBoundary?: (boundary: StagedAttachmentDurabilityBoundary) => Promise<void> | void }): DirectChildImporter {
  return {
    import: async (claimed) => {
      const archiveBytes = claimed.readByteObject();
      if (
        !/^[a-f0-9]{64}$/.test(claimed.archiveSha256) ||
        !/^[a-f0-9]{64}$/.test(claimed.manifestSha256) ||
        !/^[a-f0-9]{40}$/.test(claimed.targetSha) ||
        !claimed.byteObjectId || !claimed.workspaceId || !claimed.actorId || !claimed.stageId || !claimed.operationId || !IDEMPOTENCY_KEY_PATTERN.test(claimed.idempotencyKey) ||
         !archiveBytes || archiveBytes.byteLength < 1 || archiveBytes.byteLength !== claimed.byteLength ||
         !claimed.assetId || !claimed.assetName || !["zip", "tar.gz", "tgz"].includes(claimed.archiveType) || !["win32", "linux", "darwin"].includes(claimed.platform) ||
        !claimed.manifestBytes || claimed.manifestBytes.byteLength < 1 ||
        createHash("sha256").update(archiveBytes).digest("hex") !== claimed.archiveSha256
      ) {
        return "unknown";
      }

      let manifest: ServiceManifest;
      const manifestBytes = Buffer.from(claimed.manifestBytes).toString("utf8");
      try {
        if (sha256(manifestBytes) !== claimed.manifestSha256) return "unknown";
        manifest = validateServiceManifest(JSON.parse(manifestBytes), `${claimed.repo}@${claimed.releaseTag}:service.json`);
        assertApprovedReleaseManifest(manifest, {
          repo: claimed.repo,
          tag: claimed.releaseTag,
          expectedCommit: claimed.targetSha,
          expectedManifestSha256: claimed.manifestSha256,
          idempotencyKey: "staged-importer-source-read",
        });
      } catch {
        return "unknown";
      }

      if (
        manifest.id !== claimed.serviceId ||
        sha256(manifestBytes) !== claimed.manifestSha256
      ) {
        return "unknown";
      }
      return await importStagedReleaseAttachment({
        servicesRoot: input.servicesRoot,
        manifest,
        manifestBytes,
        attachment: stagedInputAttachment(claimed),
        archiveBytes,
        onDurabilityBoundary: input.onDurabilityBoundary,
      });
    },
    reconcile: async (claimed) => {
      if (
        !claimed.byteObjectId || !claimed.workspaceId || !claimed.actorId || !claimed.stageId || !claimed.operationId || !IDEMPOTENCY_KEY_PATTERN.test(claimed.idempotencyKey) || claimed.byteLength < 1 ||
         !claimed.assetId || !claimed.assetName || !["zip", "tar.gz", "tgz"].includes(claimed.archiveType) || !["win32", "linux", "darwin"].includes(claimed.platform) ||
        !/^[a-f0-9]{64}$/.test(claimed.archiveSha256) ||
        !/^[a-f0-9]{64}$/.test(claimed.manifestSha256) ||
        !/^[a-f0-9]{40}$/.test(claimed.targetSha) ||
        createHash("sha256").update(claimed.manifestBytes).digest("hex") !== claimed.manifestSha256
      ) return "unknown";
      const target = await isSafeDirectChildManifest(input.servicesRoot, claimed.serviceId);
      const attachmentPath = await stagedInputAttachmentPath(input.servicesRoot, claimed.serviceId);
      const bytesPath = await stagedInputBytesPath(input.servicesRoot, claimed.serviceId);
      const publicationPath = await stagedInputPublicationPath(input.servicesRoot, claimed.serviceId);
      if (!target || !attachmentPath || !bytesPath || !publicationPath) return "unknown";
      try {
        const attachment = JSON.parse(await readFile(attachmentPath, "utf8")) as unknown;
        const archiveBytes = await readFile(bytesPath);
        return equalBuffer(await readFile(target), claimed.manifestBytes) &&
          archiveBytes.byteLength === claimed.byteLength &&
          createHash("sha256").update(archiveBytes).digest("hex") === claimed.archiveSha256 &&
          isSameStagedInputAttachment(attachment, stagedInputAttachment(claimed)) &&
          (await readFile(publicationPath, "utf8")) === stagedInputPublicationReceipt(stagedInputAttachment(claimed)) ? "completed" : "conflict";
      } catch {
        return "unknown";
      }
    },
  };
}

function equalBuffer(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

export function parseRemoteServiceRegistrationRequest(input: unknown): RemoteServiceRegistrationRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ApiError("invalid_body", 400, "Service registration body must be a JSON object.");
  const candidate = input as Record<string, unknown>;
  const allowed = new Set(["repo", "tag", "expectedCommit", "expectedManifestSha256", "idempotencyKey", "confirm"]);
  if (Object.keys(candidate).some((key) => !allowed.has(key))) throw new ApiError("invalid_body", 400, "Service registration accepts only release identity, digest, idempotencyKey, and confirm.");
  if (typeof candidate.repo !== "string" || !REPO_PATTERN.test(candidate.repo)) throw new ApiError("invalid_repo", 400, '"repo" must be an owner/repository release reference.');
  assertApprovedReleaseRepository(candidate.repo);
  if (typeof candidate.tag !== "string" || !TAG_PATTERN.test(candidate.tag)) throw new ApiError("invalid_tag", 400, '"tag" must be a release tag.');
  if (typeof candidate.expectedCommit !== "string" || !COMMIT_PATTERN.test(candidate.expectedCommit)) throw new ApiError("invalid_expected_commit", 400, '"expectedCommit" must be a lowercase 40-character commit SHA.');
  if (typeof candidate.expectedManifestSha256 !== "string" || !SHA256_PATTERN.test(candidate.expectedManifestSha256)) throw new ApiError("invalid_expected_manifest_sha256", 400, '"expectedManifestSha256" must be a lowercase SHA-256 digest.');
  if (typeof candidate.idempotencyKey !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(candidate.idempotencyKey)) throw new ApiError("invalid_idempotency_key", 400, '"idempotencyKey" must be an opaque 8-128 character key.');
  if (candidate.confirm !== true) throw new ApiError("confirmation_required", 409, "Service registration requires explicit server-side confirmation.");
  return { repo: candidate.repo, tag: candidate.tag, expectedCommit: candidate.expectedCommit, expectedManifestSha256: candidate.expectedManifestSha256, idempotencyKey: candidate.idempotencyKey };
}

export async function registerReleasedService(input: { workspaceRoot: string; servicesRoot: string; actor: PermissionActor; request: RemoteServiceRegistrationRequest }): Promise<RemoteServiceRegistrationOperation> {
  const requestFingerprint = sha256(JSON.stringify({ repo: input.request.repo, tag: input.request.tag, expectedCommit: input.request.expectedCommit, expectedManifestSha256: input.request.expectedManifestSha256 }));
  const operationId = `sro_${sha256(`${input.actor.id}\u0000${input.request.idempotencyKey}`).slice(0, 32)}`;
  return withWorkspaceRegistrationLock(input.workspaceRoot, async () => {
    const store = await readStore(input.workspaceRoot);
    const existing = store.operations.find((operation) => operation.id === operationId && operation.actorId === input.actor.id);
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) throw new ApiError("idempotency_key_reused", 409, "The idempotency key was already used for a different registration request.");
      if (existing.status === "unknown" && await manifestAtTargetMatches(input.servicesRoot, existing)) {
        existing.status = "completed";
        existing.completedAt = new Date().toISOString();
        existing.errorCode = null;
        await writeStore(input.workspaceRoot, store);
      }
      return toPublicOperation(existing, true);
    }
    const resolved = await resolveReleasedManifest(input.request);
    const now = new Date().toISOString();
    const operation: PersistedOperation = {
      id: operationId, kind: "service_registration", status: "unknown", actorId: input.actor.id,
      repo: input.request.repo, tag: input.request.tag, sourceCommit: input.request.expectedCommit,
      serviceId: resolved.manifest.id, version: resolved.manifest.version ?? null, createdAt: now, completedAt: null,
      errorCode: "registration_interrupted", requestFingerprint, manifestSha256: input.request.expectedManifestSha256,
    };
    store.operations.push(operation);
    await writeStore(input.workspaceRoot, store);
    const outcome = await importVerifiedManifest({ servicesRoot: input.servicesRoot, manifest: resolved.manifest, manifestBytes: resolved.manifestBytes });
    operation.status = outcome;
    operation.completedAt = outcome === "unknown" ? null : new Date().toISOString();
    operation.errorCode = outcome === "conflict" ? "target_manifest_exists" : outcome === "unknown" ? "registration_unknown" : null;
    await writeStore(input.workspaceRoot, store);
    return toPublicOperation(operation, false);
  });
}

export async function readRemoteServiceRegistrationOperation(input: { workspaceRoot: string; actor: PermissionActor; operationId: string }): Promise<RemoteServiceRegistrationOperation> {
  if (!/^sro_[a-f0-9]{32}$/.test(input.operationId)) throw new ApiError("operation_not_found", 404, "Service registration operation was not found.");
  const store = await readStore(input.workspaceRoot);
  const operation = store.operations.find((candidate) => candidate.id === input.operationId && candidate.actorId === input.actor.id);
  if (!operation) throw new ApiError("operation_not_found", 404, "Service registration operation was not found.");
  return toPublicOperation(operation, false);
}

export interface StagedRegistrationOperationInput {
  workspaceRoot: string;
  actorId: string;
  workspaceId: string;
  idempotencyKey: string;
  fingerprint: string;
  stageId: string;
  byteObjectId: string;
  byteLength: number;
  fullDigest: string;
  repo: string;
  releaseTag: string;
  commitSha: string;
  serviceId: string;
  manifestSha256: string;
  releaseId: string;
  platform: "win32" | "linux" | "darwin";
  assetName: string;
  archiveType: "zip" | "tar.gz" | "tgz";
  manifestAssetId: string | null;
  checksumAssetId: string | null;
}

/**
 * #1463's operation is a compatible extension of the existing #1464 durable
 * store. The stage file keeps only stage/journal state; this is the one
 * actor-owned operation that operator readback exposes.
 */
/** Mutates an already locked compatible v1 document; callers must persist it atomically. */
export function claimStagedRegistrationInStore(store: PersistedOperationStore, input: StagedRegistrationOperationInput): RemoteServiceRegistrationOperation {
  const operationId = `sro_${sha256(`${input.actorId}\u0000${input.idempotencyKey}`).slice(0, 32)}`;
  const existing = store.operations.find((candidate) => candidate.id === operationId && candidate.actorId === input.actorId);
  if (existing) {
    if (existing.requestFingerprint !== input.fingerprint || existing.staged?.workspaceId !== input.workspaceId) {
      throw new ApiError("idempotency_key_reused", 409, "The idempotency key was already used for a different registration request.");
    }
    return toPublicOperation(existing, true);
  }
  const now = new Date().toISOString();
  const operation: PersistedOperation = {
        id: operationId, kind: "service_registration", status: "unknown", actorId: input.actorId,
        repo: input.repo, tag: input.releaseTag, sourceCommit: input.commitSha, serviceId: input.serviceId,
        version: null, createdAt: now, completedAt: null, errorCode: "registration_interrupted",
        requestFingerprint: input.fingerprint, manifestSha256: input.manifestSha256,
        staged: {
          source: "staged_release_asset", workspaceId: input.workspaceId, stageId: input.stageId,
          byteObjectId: input.byteObjectId, byteLength: input.byteLength, fullDigest: input.fullDigest,
          platform: input.platform, assetName: input.assetName, archiveType: input.archiveType,
          manifestAssetId: input.manifestAssetId, checksumAssetId: input.checksumAssetId,
        },
  };
  store.operations.push(operation);
  return toPublicOperation(operation, false);
}

export async function claimStagedRegistrationOperation(input: StagedRegistrationOperationInput): Promise<RemoteServiceRegistrationOperation> {
  return await withWorkspaceRegistrationLock(input.workspaceRoot, async () => {
      const store = await readStore(input.workspaceRoot);
      const operation = claimStagedRegistrationInStore(store, input);
      await writeStore(input.workspaceRoot, store);
      return operation;
  });
}

export function completeStagedRegistrationInStore(store: PersistedOperationStore, input: { actorId: string; operationId: string; outcome: "completed" | "conflict" | "unknown" }): void {
  const operation = store.operations.find((candidate) => candidate.id === input.operationId && candidate.actorId === input.actorId && candidate.staged);
  if (!operation) throw new ApiError("operation_store_invalid", 503, "Service registration operation state is unavailable.");
  operation.status = input.outcome;
  operation.completedAt = input.outcome === "unknown" ? null : new Date().toISOString();
  operation.errorCode = input.outcome === "completed" ? null : input.outcome === "conflict" ? "target_manifest_exists" : "registration_unknown";
}

export async function completeStagedRegistrationOperation(input: {
  workspaceRoot: string; actorId: string; operationId: string; outcome: "completed" | "conflict" | "unknown";
}): Promise<void> {
  await withWorkspaceRegistrationLock(input.workspaceRoot, async () => {
      const store = await readStore(input.workspaceRoot);
      completeStagedRegistrationInStore(store, input);
      await writeStore(input.workspaceRoot, store);
  });
}
