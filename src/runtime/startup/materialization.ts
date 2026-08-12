import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { chmod, lstat, mkdir, open, readdir, rename, rm, unlink, type FileHandle } from "node:fs/promises";
import path from "node:path";
import type { DiscoveredService } from "../../contracts/service.js";
import { getLifecycleState, setLifecycleState } from "../lifecycle/store.js";
import type { ServiceLifecycleState } from "../lifecycle/types.js";
import type { SetupTransactionHooks } from "../setup/steps.js";
import { writeServiceState } from "../state/writeState.js";
import { readStoredState } from "../state/readState.js";
import {
  advanceStartupTransaction,
  type StartupTransactionJournal,
} from "./transaction.js";

const MAX_ENTRIES = 128;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_PREIMAGE_BYTES = 8 * 1024 * 1024;
const MAX_SIDECAR_BYTES = MAX_TOTAL_PREIMAGE_BYTES * 2;
const MAX_EVIDENCE_TEXT_LENGTH = 2048;
const MAX_ARTIFACT_TREE_FILES = 100_000;
const MAX_ARTIFACT_TREE_BYTES = 8 * 1024 * 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ACTION_ID_PATTERN = /^[a-f0-9]{24}$/;
const windowsSidecarKeys = new Map<string, { key: Buffer; wrappedKey: string }>();
const execFileAsync = promisify(execFile);
let windowsCurrentUserSid: Promise<string> | null = null;

export type StartupMaterializationKind = "install" | "config" | "setup";

interface MaterializationImage {
  digest: string;
  size: number;
  mode: number;
  contentBase64: string;
}

interface MaterializationEntry {
  actionId: string;
  serviceId: string;
  kind: StartupMaterializationKind;
  serviceRelativeRoot: string;
  targetRelativePath: string;
  preimage: MaterializationImage | null;
  postimageRecorded: boolean;
  expectedPostimage: Omit<MaterializationImage, "contentBase64"> | null;
}

interface MaterializationSidecar {
  version: 1;
  transactionId: string;
  workspaceRoot: string;
  servicesRoot: string;
  entries: MaterializationEntry[];
  artifactEntries?: ArtifactAcquisitionEntry[];
}

type InstalledArtifactEvidence = ServiceLifecycleState["installArtifacts"]["artifact"];

interface ArtifactTreeEvidence {
  digest: string;
  files: number;
  bytes: number;
}

export interface StartupArtifactArchiveEvidence {
  digest: string;
  size: number;
}
type ArtifactFileEvidence = StartupArtifactArchiveEvidence;

interface ArtifactAcquisitionEntry {
  actionId: string;
  serviceId: string;
  serviceRelativeRoot: string;
  archiveRelativePath: string;
  archiveTempRelativePath: string;
  extractionStagingRelativePath: string;
  extractionRelativePath: string;
  priorInstalled: boolean;
  priorArtifact: InstalledArtifactEvidence | null;
  expectedArtifact: InstalledArtifactEvidence | null;
  expectedArchive: ArtifactFileEvidence | null;
  expectedTree: ArtifactTreeEvidence | null;
  extractionPublished: boolean;
}

interface WindowsProtectedSidecarEnvelope {
  version: 1;
  protection: "windows-dpapi-aes-256-gcm";
  wrappedKey: string;
  iv: string;
  authTag: string;
  ciphertext: string;
}

export interface MaterializationWriteHooks {
  beforeWrite(input: { absolutePath: string; relativePath: string }): Promise<string>;
  afterWrite(actionId: string): Promise<void>;
}

export interface StartupMaterializationRollbackResult {
  completedActionIds: string[];
  blockedActionIds: string[];
  stateReconciliationRequiredActionIds: string[];
}

export interface StartupMaterializationInspection {
  status: "agree" | "rollback" | "blocked" | "commit_cleanup";
  reason: string;
  actionIds: string[];
}

export interface StartupMaterializationStateReconciliationResult {
  journal: StartupTransactionJournal;
  reconciledActionIds: string[];
  blockedActionIds: string[];
}

export interface StartupArtifactAcquisitionPlan {
  actionId: string;
  archiveTempPath: string;
  extractionStagingPath: string;
  extractionPath: string;
}

export interface StartupArtifactAcquisitionHooks {
  prepare(input: { archivePath: string }): Promise<StartupArtifactAcquisitionPlan>;
  prepareArchiveDownload(actionId: string): Promise<void>;
  recordArchive(actionId: string, archivePath: string): Promise<StartupArtifactArchiveEvidence>;
  prepareExtraction(actionId: string): Promise<void>;
  beforeExtractionPublish(actionId: string): Promise<void>;
  afterExtractionPublish(actionId: string): Promise<void>;
  complete(actionId: string, artifact: NonNullable<InstalledArtifactEvidence>): Promise<void>;
}

export interface StartupArtifactRollbackResult {
  journal: StartupTransactionJournal;
  completedActionIds: string[];
  blockedActionIds: string[];
}

function digest(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function normalize(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function assertContained(base: string, target: string): string {
  const relative = path.relative(path.resolve(base), path.resolve(target));
  if (!relative || relative === "." || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Startup materialization path escapes its governed root.");
  }
  return relative;
}

async function assertSafePath(base: string, target: string, targetMayBeMissing: boolean): Promise<void> {
  const relative = assertContained(base, target);
  const parts = relative.split(path.sep).filter(Boolean);
  let current = path.resolve(base);
  const baseStat = await lstat(current);
  if (!baseStat.isDirectory() || baseStat.isSymbolicLink()) {
    throw new Error("Startup materialization root must be a real directory.");
  }
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) throw new Error("Startup materialization path contains a redirected object.");
      const targetComponent = index === parts.length - 1;
      if (targetComponent) {
        if (!stat.isFile()) throw new Error("Startup materialization target must be a regular file.");
      } else if (!stat.isDirectory()) {
        throw new Error("Startup materialization parent must be a directory.");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (!targetMayBeMissing && index === parts.length - 1) throw error;
      break;
    }
  }
}

async function ensureSafeDirectoryTree(base: string, targetDirectory: string): Promise<void> {
  const relative = assertContained(base, targetDirectory);
  let current = path.resolve(base);
  const baseStat = await lstat(current);
  if (!baseStat.isDirectory() || baseStat.isSymbolicLink()) {
    throw new Error("Startup materialization root must be a real directory.");
  }
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      const stat = await lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error("Startup materialization state path contains a redirected object.");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await mkdir(current, { mode: 0o700 });
      const created = await lstat(current);
      if (!created.isDirectory() || created.isSymbolicLink()) {
        throw new Error("Startup materialization state directory is unsafe.");
      }
    }
  }
}

function sidecarRoot(journal: StartupTransactionJournal): string {
  return path.join(journal.workspaceRoot, ".service-lasso", "startup-transactions", journal.transactionId);
}

function sidecarPath(journal: StartupTransactionJournal): string {
  return path.join(sidecarRoot(journal), "materialization-preimages.json");
}

function isTransactionTempName(name: string, basename: string, suffix: ".tmp" | ".restore.tmp"): boolean {
  if (!name.startsWith(`${basename}.`) || !name.endsWith(suffix)) return false;
  const middle = name.slice(basename.length + 1, -suffix.length);
  return /^\d+\.[a-f0-9-]{36}$/i.test(middle);
}

async function sweepTransactionTemps(base: string, governedTarget: string, suffix: ".tmp" | ".restore.tmp"): Promise<void> {
  const directoryPath = path.dirname(governedTarget);
  let entries;
  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (!isTransactionTempName(entry.name, path.basename(governedTarget), suffix)) continue;
    const candidate = path.join(directoryPath, entry.name);
    await assertSafePath(base, candidate, false);
    await unlink(candidate);
  }
  await syncDirectoryOnPosix(directoryPath);
}

async function syncDirectoryOnPosix(directoryPath: string): Promise<void> {
  if (process.platform === "win32") return;
  const directory = await open(directoryPath, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

async function runWindowsPowerShell(script: string, input: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let errorBytes = 0;
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error("Windows private-state protection timed out."));
    }, 15_000);
    timeout.unref?.();
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes <= MAX_FILE_BYTES) stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      errorBytes += chunk.length;
      if (errorBytes <= 8192) stderr.push(chunk);
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.stdin.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code !== 0 || outputBytes > MAX_FILE_BYTES) {
        reject(new Error(`Windows private-state protection failed (${code ?? "unknown"}): ${Buffer.concat(stderr).toString("utf8").trim().slice(0, 500)}`));
        return;
      }
      resolve(Buffer.concat(stdout).toString("utf8").trim());
    });
    child.stdin.end(input);
  });
}

async function protectWindowsKey(key: Buffer): Promise<string> {
  const script = [
    "Add-Type -AssemblyName System.Security",
    "$raw = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())",
    "$protected = [Security.Cryptography.ProtectedData]::Protect($raw, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[Console]::Out.Write([Convert]::ToBase64String($protected))",
  ].join("; ");
  return await runWindowsPowerShell(script, key.toString("base64"));
}

async function unprotectWindowsKey(wrappedKey: string): Promise<Buffer> {
  const script = [
    "Add-Type -AssemblyName System.Security",
    "$raw = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())",
    "$plain = [Security.Cryptography.ProtectedData]::Unprotect($raw, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[Console]::Out.Write([Convert]::ToBase64String($plain))",
  ].join("; ");
  const key = Buffer.from(await runWindowsPowerShell(script, wrappedKey), "base64");
  if (key.length !== 32) throw new Error("Windows private-state key length is invalid.");
  return key;
}

async function enforceWindowsPrivateAcl(filePath: string): Promise<void> {
  if (process.platform !== "win32") return;
  windowsCurrentUserSid ??= execFileAsync("whoami.exe", ["/user", "/fo", "csv", "/nh"], {
    windowsHide: true,
    maxBuffer: 16 * 1024,
  }).then(({ stdout }) => {
    const match = stdout.match(/,"(S-\d+(?:-\d+)+)"\s*$/i);
    if (!match) throw new Error("Cannot resolve the current Windows user SID for private materialization state.");
    return match[1];
  });
  const sid = await windowsCurrentUserSid;
  await execFileAsync("icacls.exe", [filePath, "/inheritance:r", "/grant:r", `*${sid}:(F)`], {
    windowsHide: true,
    maxBuffer: 64 * 1024,
  });
}

async function serializeSidecar(sidecar: MaterializationSidecar): Promise<string> {
  const plaintext = Buffer.from(`${JSON.stringify(sidecar)}\n`, "utf8");
  if (process.platform !== "win32") return plaintext.toString("utf8");
  let protectedKey = windowsSidecarKeys.get(sidecar.transactionId);
  if (!protectedKey) {
    const key = randomBytes(32);
    try {
      protectedKey = { key, wrappedKey: await protectWindowsKey(key) };
      windowsSidecarKeys.set(sidecar.transactionId, protectedKey);
    } catch (error) {
      key.fill(0);
      throw error;
    }
  }
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", protectedKey.key, iv);
    cipher.setAAD(Buffer.from(sidecar.transactionId, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const envelope: WindowsProtectedSidecarEnvelope = {
      version: 1,
      protection: "windows-dpapi-aes-256-gcm",
      wrappedKey: protectedKey.wrappedKey,
      iv: iv.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
    return `${JSON.stringify(envelope)}\n`;
  } finally {
    plaintext.fill(0);
  }
}

async function deserializeSidecar(raw: Buffer, journal: StartupTransactionJournal): Promise<unknown> {
  if (process.platform !== "win32") return JSON.parse(raw.toString("utf8")) as unknown;
  const envelope = JSON.parse(raw.toString("utf8")) as unknown;
  if (!isRecord(envelope) || envelope.version !== 1 || envelope.protection !== "windows-dpapi-aes-256-gcm" ||
    typeof envelope.wrappedKey !== "string" || typeof envelope.iv !== "string" ||
    typeof envelope.authTag !== "string" || typeof envelope.ciphertext !== "string") {
    throw new Error("Windows startup materialization sidecar is not protected.");
  }
  const iv = Buffer.from(envelope.iv, "base64");
  const authTag = Buffer.from(envelope.authTag, "base64");
  if (envelope.wrappedKey.length > 16 * 1024 || iv.length !== 12 || authTag.length !== 16 ||
    envelope.ciphertext.length > Math.ceil(MAX_SIDECAR_BYTES / 3) * 4 + 4) {
    throw new Error("Windows startup materialization envelope is invalid or oversized.");
  }
  let protectedKey = windowsSidecarKeys.get(journal.transactionId);
  if (!protectedKey || protectedKey.wrappedKey !== envelope.wrappedKey) {
    const key = await unprotectWindowsKey(envelope.wrappedKey);
    protectedKey?.key.fill(0);
    protectedKey = { key, wrappedKey: envelope.wrappedKey };
    windowsSidecarKeys.set(journal.transactionId, protectedKey);
  }
  const decipher = createDecipheriv("aes-256-gcm", protectedKey.key, iv);
  decipher.setAAD(Buffer.from(journal.transactionId, "utf8"));
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]);
  if (plaintext.length > MAX_SIDECAR_BYTES) throw new Error("Startup materialization plaintext is oversized.");
  try {
    return JSON.parse(plaintext.toString("utf8")) as unknown;
  } finally {
    plaintext.fill(0);
  }
}

async function readBoundedHandle(handle: FileHandle, maximumBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maximumBytes + 1 - total));
    const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > maximumBytes) throw new Error("Startup materialization file grew beyond its bounded limit.");
    chunks.push(chunk.subarray(0, bytesRead));
  }
  return Buffer.concat(chunks, total);
}

async function openValidatedRegularFile(base: string, target: string, maximumBytes: number): Promise<{
  handle: FileHandle;
  mode: number;
}> {
  await assertSafePath(base, target, false);
  const before = await lstat(target);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maximumBytes) {
    throw new Error("Startup materialization file is not a bounded regular file.");
  }
  const handle = await open(target, "r");
  try {
    const opened = await handle.stat();
    await assertSafePath(base, target, false);
    const after = await lstat(target);
    if (!opened.isFile() || opened.size > maximumBytes || before.dev !== opened.dev || before.ino !== opened.ino ||
      after.dev !== opened.dev || after.ino !== opened.ino) {
      throw new Error("Startup materialization file identity changed during validation.");
    }
    return { handle, mode: opened.mode };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function atomicWriteSidecar(filePath: string, sidecar: MaterializationSidecar): Promise<void> {
  await ensureSafeDirectoryTree(sidecar.workspaceRoot, path.dirname(filePath));
  await assertSafePath(path.resolve(sidecar.workspaceRoot), filePath, true);
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const serialized = await serializeSidecar(sidecar);
    const handle = await open(tempPath, "wx", 0o600);
    try {
      await handle.writeFile(serialized, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tempPath, filePath);
    if (process.platform !== "win32") await chmod(filePath, 0o600);
    await syncDirectoryOnPosix(path.dirname(filePath));
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function boundedString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_EVIDENCE_TEXT_LENGTH) {
    throw new Error(`Startup materialization ${label} is invalid.`);
  }
  return value;
}

function relativeEvidence(value: unknown, label: string): string {
  const candidate = boundedString(value, label);
  if (path.isAbsolute(candidate)) throw new Error(`Startup materialization ${label} must be relative.`);
  const normalized = path.normalize(candidate);
  if (!normalized || normalized === "." || normalized.startsWith(`..${path.sep}`) || normalized === "..") {
    throw new Error(`Startup materialization ${label} escapes its root.`);
  }
  return candidate;
}

function parseImage(value: unknown, includeContent: boolean): MaterializationImage | Omit<MaterializationImage, "contentBase64"> {
  if (!isRecord(value) || typeof value.size !== "number" || !Number.isSafeInteger(value.size) || value.size < 0 ||
    value.size > MAX_FILE_BYTES || typeof value.mode !== "number" || !Number.isSafeInteger(value.mode) ||
    value.mode < 0 || typeof value.digest !== "string" || !SHA256_PATTERN.test(value.digest)) {
    throw new Error("Startup materialization image evidence is invalid.");
  }
  const image = { digest: value.digest, size: value.size, mode: value.mode };
  if (!includeContent) return image;
  if (typeof value.contentBase64 !== "string" || value.contentBase64.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 + 4) {
    throw new Error("Startup materialization preimage content is invalid.");
  }
  const content = Buffer.from(value.contentBase64, "base64");
  if (content.length !== value.size || digest(content) !== value.digest || content.toString("base64") !== value.contentBase64) {
    throw new Error("Startup materialization preimage content does not match its evidence.");
  }
  return { ...image, contentBase64: value.contentBase64 };
}

function nullableEvidenceString(value: unknown, label: string): string | null {
  return value === null ? null : boundedString(value, label);
}

function parseInstalledArtifactEvidence(value: unknown): InstalledArtifactEvidence | null {
  if (value === null) return null;
  if (!isRecord(value) || (value.sourceType !== null && value.sourceType !== "github-release") ||
    (value.archiveType !== null && value.archiveType !== "zip" && value.archiveType !== "tar.gz" && value.archiveType !== "tgz") ||
    !Array.isArray(value.args) || value.args.length > 128 || value.args.some((arg) => typeof arg !== "string" || arg.length > MAX_EVIDENCE_TEXT_LENGTH)) {
    throw new Error("Startup artifact lifecycle evidence is invalid.");
  }
  const checksum = value.checksum === null
    ? null
    : (() => {
        if (!isRecord(value.checksum) || value.checksum.algorithm !== "sha256" ||
          (value.checksum.source !== "manifest" && value.checksum.source !== "release-asset") ||
          typeof value.checksum.expected !== "string" || !SHA256_PATTERN.test(value.checksum.expected) ||
          typeof value.checksum.actual !== "string" || !SHA256_PATTERN.test(value.checksum.actual)) {
          throw new Error("Startup artifact checksum evidence is invalid.");
        }
        return {
          algorithm: "sha256" as const,
          source: value.checksum.source as "manifest" | "release-asset",
          expected: value.checksum.expected,
          actual: value.checksum.actual,
          assetName: boundedString(value.checksum.assetName, "checksum asset name"),
          checksumAssetName: nullableEvidenceString(value.checksum.checksumAssetName, "checksum filename"),
          verifiedAt: boundedString(value.checksum.verifiedAt, "checksum time"),
        };
      })();
  return {
    sourceType: value.sourceType,
    repo: nullableEvidenceString(value.repo, "artifact repo"),
    channel: nullableEvidenceString(value.channel, "artifact channel"),
    tag: nullableEvidenceString(value.tag, "artifact tag"),
    assetName: nullableEvidenceString(value.assetName, "artifact asset name"),
    assetUrl: nullableEvidenceString(value.assetUrl, "artifact asset URL"),
    archiveType: value.archiveType,
    archivePath: nullableEvidenceString(value.archivePath, "artifact archive path"),
    extractedPath: nullableEvidenceString(value.extractedPath, "artifact extraction path"),
    command: nullableEvidenceString(value.command, "artifact command"),
    args: [...value.args] as string[],
    checksum,
  };
}

function parseArtifactTreeEvidence(value: unknown): ArtifactTreeEvidence | null {
  if (value === null) return null;
  if (!isRecord(value) || typeof value.digest !== "string" || !SHA256_PATTERN.test(value.digest) ||
    typeof value.files !== "number" || !Number.isSafeInteger(value.files) || value.files < 0 || value.files > MAX_ARTIFACT_TREE_FILES ||
    typeof value.bytes !== "number" || !Number.isSafeInteger(value.bytes) || value.bytes < 0 || value.bytes > MAX_ARTIFACT_TREE_BYTES) {
    throw new Error("Startup artifact tree evidence is invalid.");
  }
  return { digest: value.digest, files: value.files, bytes: value.bytes };
}

function parseArtifactFileEvidence(value: unknown): ArtifactFileEvidence | null {
  if (value === null) return null;
  if (!isRecord(value) || typeof value.digest !== "string" || !SHA256_PATTERN.test(value.digest) ||
    typeof value.size !== "number" || !Number.isSafeInteger(value.size) || value.size < 0 || value.size > MAX_ARTIFACT_TREE_BYTES) {
    throw new Error("Startup artifact archive evidence is invalid.");
  }
  return { digest: value.digest, size: value.size };
}

function parseSidecar(value: unknown, journal: StartupTransactionJournal): MaterializationSidecar {
  if (!isRecord(value) || value.version !== 1 || value.transactionId !== journal.transactionId ||
    typeof value.workspaceRoot !== "string" || typeof value.servicesRoot !== "string" ||
    normalize(value.workspaceRoot) !== normalize(journal.workspaceRoot) ||
    normalize(value.servicesRoot) !== normalize(journal.servicesRoot) ||
    !Array.isArray(value.entries) || value.entries.length > MAX_ENTRIES) {
    throw new Error("Startup materialization sidecar does not match the transaction.");
  }
  const actionIds = new Set<string>();
  let totalPreimageBytes = 0;
  const entries = value.entries.map((candidate): MaterializationEntry => {
    if (!isRecord(candidate)) throw new Error("Startup materialization entry is invalid.");
    const actionId = boundedString(candidate.actionId, "action id");
    if (!ACTION_ID_PATTERN.test(actionId) || actionIds.has(actionId)) {
      throw new Error("Startup materialization action id is invalid or duplicated.");
    }
    actionIds.add(actionId);
    const kind = candidate.kind;
    if (kind !== "install" && kind !== "config" && kind !== "setup") {
      throw new Error("Startup materialization kind is invalid.");
    }
    if (typeof candidate.postimageRecorded !== "boolean") {
      throw new Error("Startup materialization completion evidence is invalid.");
    }
    const preimage = candidate.preimage === null
      ? null
      : parseImage(candidate.preimage, true) as MaterializationImage;
    totalPreimageBytes += preimage?.size ?? 0;
    if (totalPreimageBytes > MAX_TOTAL_PREIMAGE_BYTES) {
      throw new Error("Startup materialization sidecar exceeds the preimage byte limit.");
    }
    const expectedPostimage = candidate.expectedPostimage === null
      ? null
      : parseImage(candidate.expectedPostimage, false) as Omit<MaterializationImage, "contentBase64">;
    if (!candidate.postimageRecorded && expectedPostimage !== null) {
      throw new Error("Startup materialization postimage exists before completion.");
    }
    return {
      actionId,
      serviceId: boundedString(candidate.serviceId, "service id"),
      kind,
      serviceRelativeRoot: relativeEvidence(candidate.serviceRelativeRoot, "service root"),
      targetRelativePath: relativeEvidence(candidate.targetRelativePath, "target path"),
      preimage,
      postimageRecorded: candidate.postimageRecorded,
      expectedPostimage,
    };
  });
  const artifactValues = value.artifactEntries === undefined ? [] : value.artifactEntries;
  if (!Array.isArray(artifactValues) || artifactValues.length > MAX_ENTRIES) {
    throw new Error("Startup artifact acquisition evidence is invalid.");
  }
  const artifactEntries = artifactValues.map((candidate): ArtifactAcquisitionEntry => {
    if (!isRecord(candidate)) throw new Error("Startup artifact acquisition entry is invalid.");
    const actionId = boundedString(candidate.actionId, "artifact action id");
    if (!ACTION_ID_PATTERN.test(actionId) || actionIds.has(actionId)) {
      throw new Error("Startup artifact action id is invalid or duplicated.");
    }
    actionIds.add(actionId);
    if (typeof candidate.priorInstalled !== "boolean" || typeof candidate.extractionPublished !== "boolean") {
      throw new Error("Startup artifact acquisition completion evidence is invalid.");
    }
    const expectedTree = parseArtifactTreeEvidence(candidate.expectedTree);
    if (candidate.extractionPublished && expectedTree === null) {
      throw new Error("Published startup artifact extraction lacks digest evidence.");
    }
    return {
      actionId,
      serviceId: boundedString(candidate.serviceId, "artifact service id"),
      serviceRelativeRoot: relativeEvidence(candidate.serviceRelativeRoot, "artifact service root"),
      archiveRelativePath: relativeEvidence(candidate.archiveRelativePath, "artifact archive path"),
      archiveTempRelativePath: relativeEvidence(candidate.archiveTempRelativePath, "artifact archive temp path"),
      extractionStagingRelativePath: relativeEvidence(candidate.extractionStagingRelativePath, "artifact extraction staging path"),
      extractionRelativePath: relativeEvidence(candidate.extractionRelativePath, "artifact extraction path"),
      priorInstalled: candidate.priorInstalled,
      priorArtifact: parseInstalledArtifactEvidence(candidate.priorArtifact),
      expectedArtifact: parseInstalledArtifactEvidence(candidate.expectedArtifact),
      expectedArchive: parseArtifactFileEvidence(candidate.expectedArchive),
      expectedTree,
      extractionPublished: candidate.extractionPublished,
    };
  });
  return {
    version: 1,
    transactionId: value.transactionId,
    workspaceRoot: value.workspaceRoot,
    servicesRoot: value.servicesRoot,
    entries,
    artifactEntries,
  };
}

async function readSidecar(journal: StartupTransactionJournal): Promise<MaterializationSidecar> {
  const filePath = sidecarPath(journal);
  await sweepTransactionTemps(journal.workspaceRoot, filePath, ".tmp");
  const opened = await openValidatedRegularFile(journal.workspaceRoot, filePath, MAX_SIDECAR_BYTES);
  try {
    const raw = await readBoundedHandle(opened.handle, MAX_SIDECAR_BYTES);
    return parseSidecar(await deserializeSidecar(raw, journal), journal);
  } finally {
    await opened.handle.close();
  }
}

async function readImage(base: string, target: string): Promise<MaterializationImage | null> {
  try {
    const opened = await openValidatedRegularFile(base, target, MAX_FILE_BYTES);
    try {
      const content = await readBoundedHandle(opened.handle, MAX_FILE_BYTES);
      return { digest: digest(content), size: content.length, mode: opened.mode, contentBase64: content.toString("base64") };
    } finally {
      await opened.handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function readArtifactTreeEvidence(base: string, root: string): Promise<ArtifactTreeEvidence | null> {
  const relative = assertContained(base, root);
  let current = path.resolve(base);
  const baseStat = await lstat(current);
  if (!baseStat.isDirectory() || baseStat.isSymbolicLink()) {
    throw new Error("Startup artifact service root is not a real directory.");
  }
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      const stat = await lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error("Startup artifact extraction path contains an unsafe object.");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  let rootStat;
  try {
    rootStat = await lstat(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("Startup artifact extraction root is not a real directory.");
  }
  const hash = createHash("sha256");
  let files = 0;
  let bytes = 0;
  const walk = async (directory: string): Promise<void> => {
    const entries = (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = assertContained(root, absolutePath).replaceAll("\\", "/");
      const stat = await lstat(absolutePath);
      if (stat.isSymbolicLink()) throw new Error("Startup artifact extraction contains a redirected object.");
      if (stat.isDirectory()) {
        hash.update(`d\0${relativePath}\0`);
        await walk(absolutePath);
        continue;
      }
      if (!stat.isFile()) throw new Error("Startup artifact extraction contains an unsupported object.");
      files += 1;
      bytes += stat.size;
      if (files > MAX_ARTIFACT_TREE_FILES || bytes > MAX_ARTIFACT_TREE_BYTES) {
        throw new Error("Startup artifact extraction exceeds its verification bound.");
      }
      hash.update(`f\0${relativePath}\0${stat.size}\0`);
      const handle = await open(absolutePath, "r");
      try {
        const opened = await handle.stat();
        if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size) {
          throw new Error("Startup artifact file identity changed during verification.");
        }
        const buffer = Buffer.allocUnsafe(64 * 1024);
        let offset = 0;
        while (offset < opened.size) {
          const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, opened.size - offset), offset);
          if (bytesRead === 0) throw new Error("Startup artifact file truncated during verification.");
          hash.update(buffer.subarray(0, bytesRead));
          offset += bytesRead;
        }
        const after = await handle.stat();
        if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size) {
          throw new Error("Startup artifact file changed during verification.");
        }
      } finally {
        await handle.close();
      }
    }
  };
  await walk(root);
  const afterRoot = await lstat(root);
  if (!afterRoot.isDirectory() || afterRoot.isSymbolicLink() ||
    afterRoot.dev !== rootStat.dev || afterRoot.ino !== rootStat.ino) {
    throw new Error("Startup artifact extraction root changed during verification.");
  }
  return { digest: hash.digest("hex"), files, bytes };
}

async function readArtifactFileEvidence(base: string, target: string): Promise<ArtifactFileEvidence | null> {
  try {
    await assertSafePath(base, target, false);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const before = await lstat(target);
  if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_ARTIFACT_TREE_BYTES) {
    throw new Error("Startup artifact archive is not a bounded regular file.");
  }
  const handle = await open(target, "r");
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) {
      throw new Error("Startup artifact archive identity changed during verification.");
    }
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let offset = 0;
    while (offset < opened.size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, opened.size - offset), offset);
      if (bytesRead === 0) throw new Error("Startup artifact archive truncated during verification.");
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    const after = await handle.stat();
    await assertSafePath(base, target, false);
    const pathAfter = await lstat(target);
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size ||
      pathAfter.dev !== opened.dev || pathAfter.ino !== opened.ino || pathAfter.size !== opened.size) {
      throw new Error("Startup artifact archive changed during verification.");
    }
    return { digest: hash.digest("hex"), size: opened.size };
  } finally {
    await handle.close();
  }
}

function artifactFileMatches(left: ArtifactFileEvidence | null, right: ArtifactFileEvidence | null): boolean {
  return left === null ? right === null : right !== null && left.digest === right.digest && left.size === right.size;
}

function artifactTreeMatches(left: ArtifactTreeEvidence | null, right: ArtifactTreeEvidence | null): boolean {
  return left === null ? right === null : right !== null && left.digest === right.digest &&
    left.files === right.files && left.bytes === right.bytes;
}

async function removeTransactionArtifactTree(base: string, target: string, expected?: ArtifactTreeEvidence): Promise<void> {
  const current = await readArtifactTreeEvidence(base, target);
  if (current === null) return;
  if (expected && !artifactTreeMatches(current, expected)) {
    throw new Error("Startup artifact extraction changed after transaction publication.");
  }
  const quarantine = `${target}.${process.pid}.${randomUUID()}.rollback`;
  await rename(target, quarantine);
  try {
    const quarantined = await readArtifactTreeEvidence(base, quarantine);
    if (expected && !artifactTreeMatches(quarantined, expected)) {
      await rename(quarantine, target);
      throw new Error("Startup artifact extraction identity changed during rollback.");
    }
    await rm(quarantine, { recursive: true, force: false });
    await syncDirectoryOnPosix(path.dirname(target));
  } catch (error) {
    try {
      await lstat(target);
    } catch (targetError) {
      if ((targetError as NodeJS.ErrnoException).code === "ENOENT") {
        await rename(quarantine, target).catch(() => undefined);
      }
    }
    throw error;
  }
}

function imageMatches(current: MaterializationImage | null, expected: MaterializationImage | null): boolean {
  return expected === null
    ? current === null
    : current?.digest === expected.digest && current.size === expected.size;
}

function imageMetadataMatches(
  left: MaterializationImage | null,
  right: Omit<MaterializationImage, "contentBase64"> | null,
): boolean {
  return left === null
    ? right === null
    : right !== null && left.digest === right.digest && left.size === right.size;
}

function sameEntryTarget(left: MaterializationEntry, right: MaterializationEntry): boolean {
  const normalizeEvidence = (value: string) => {
    const normalized = path.normalize(value).replaceAll("\\", "/");
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
  };
  return normalizeEvidence(left.serviceRelativeRoot) === normalizeEvidence(right.serviceRelativeRoot) &&
    normalizeEvidence(left.targetRelativePath) === normalizeEvidence(right.targetRelativePath);
}

function setupStepIdsForEntry(service: DiscoveredService, entry: MaterializationEntry): string[] {
  if (entry.kind !== "setup") return [];
  const normalizedTarget = entry.targetRelativePath.replaceAll("\\", "/");
  return Object.entries(service.manifest.setup?.steps ?? {})
    .filter(([, step]) => step.outputs?.some((output) => output.replaceAll("\\", "/") === normalizedTarget))
    .map(([stepId]) => stepId)
    .sort((left, right) => left.localeCompare(right));
}

function reconcileLifecycleState(
  current: ServiceLifecycleState,
  kinds: ReadonlySet<StartupMaterializationKind>,
  setupStepIds: ReadonlySet<string>,
): ServiceLifecycleState {
  const setupSteps = { ...current.setup.steps };
  for (const stepId of setupStepIds) delete setupSteps[stepId];
  return {
    ...current,
    installed: kinds.has("install") ? false : current.installed,
    configured: kinds.has("config") ? false : current.configured,
    installArtifacts: kinds.has("install")
      ? { ...current.installArtifacts, files: [], updatedAt: null }
      : current.installArtifacts,
    configArtifacts: kinds.has("config")
      ? { ...current.configArtifacts, files: [], updatedAt: null }
      : current.configArtifacts,
    setup: setupStepIds.size > 0
      ? { ...current.setup, updatedAt: new Date().toISOString(), steps: setupSteps }
      : current.setup,
  };
}

async function prepareEntry(input: {
  transaction: { journal: StartupTransactionJournal };
  service: DiscoveredService;
  kind: StartupMaterializationKind;
  absolutePath: string;
  relativePath: string;
}): Promise<string> {
  if (normalize(path.resolve(input.service.serviceRoot, input.relativePath)) !== normalize(input.absolutePath)) {
    throw new Error("Startup materialization target path evidence does not agree.");
  }
  await assertSafePath(input.service.serviceRoot, input.absolutePath, true);
  let journal = input.transaction.journal;
  if (!journal.pendingCompensations.includes("discard_materialization_sidecar")) {
    journal = await advanceStartupTransaction(journal, journal.phase, {
      completedActions: ["materialization_sidecar_intended"],
      addCompensations: ["discard_materialization_sidecar"],
    });
    input.transaction.journal = journal;
  }
  const sidecar: MaterializationSidecar = await readSidecar(journal).catch((error): MaterializationSidecar => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        version: 1 as const,
        transactionId: journal.transactionId,
        workspaceRoot: journal.workspaceRoot,
        servicesRoot: journal.servicesRoot,
        entries: [],
      };
    }
    throw error;
  });
  if (sidecar.entries.length >= MAX_ENTRIES) throw new Error("Startup materialization entry limit exceeded.");
  const preimage = await readImage(input.service.serviceRoot, input.absolutePath);
  const priorBytes = sidecar.entries.reduce((sum, entry) => sum + (entry.preimage?.size ?? 0), 0);
  if (priorBytes + (preimage?.size ?? 0) > MAX_TOTAL_PREIMAGE_BYTES) {
    throw new Error("Startup materialization preimage byte limit exceeded.");
  }
  const serviceRelativeRoot = assertContained(journal.servicesRoot, input.service.serviceRoot);
  const actionId = createHash("sha256")
    .update(`${journal.transactionId}\0${input.service.manifest.id}\0${input.kind}\0${input.relativePath}\0${sidecar.entries.length}`)
    .digest("hex")
    .slice(0, 24);
  sidecar.entries.push({
    actionId,
    serviceId: input.service.manifest.id,
    kind: input.kind,
    serviceRelativeRoot,
    targetRelativePath: input.relativePath,
    preimage,
    postimageRecorded: false,
    expectedPostimage: null,
  });
  await atomicWriteSidecar(sidecarPath(journal), sidecar);
  journal = await advanceStartupTransaction(journal, journal.phase, {
    completedActions: [`materialization_preimage:${actionId}`],
    addCompensations: [`restore_materialization:${actionId}`],
  });
  input.transaction.journal = journal;
  return actionId;
}

async function completeEntry(journal: StartupTransactionJournal, actionId: string): Promise<StartupTransactionJournal> {
  const sidecar = await readSidecar(journal);
  const entry = sidecar.entries.find((candidate) => candidate.actionId === actionId);
  if (!entry || entry.postimageRecorded) throw new Error("Startup materialization action is missing or already completed.");
  const serviceRoot = path.resolve(journal.servicesRoot, entry.serviceRelativeRoot);
  const target = path.resolve(serviceRoot, entry.targetRelativePath);
  await assertSafePath(serviceRoot, target, false);
  const image = await readImage(serviceRoot, target);
  entry.postimageRecorded = true;
  entry.expectedPostimage = image ? { digest: image.digest, size: image.size, mode: image.mode } : null;
  await atomicWriteSidecar(sidecarPath(journal), sidecar);
  return await advanceStartupTransaction(journal, journal.phase, {
    completedActions: [`materialization_written:${actionId}`],
    materializationDigests: { [actionId]: image?.digest ?? "missing" },
  });
}

export function createStartupMaterializationHooks(input: {
  transaction: { journal: StartupTransactionJournal };
  service: DiscoveredService;
  kind: StartupMaterializationKind;
}): MaterializationWriteHooks {
  return {
    beforeWrite: async ({ absolutePath, relativePath }) => {
      return await prepareEntry({
        transaction: input.transaction,
        service: input.service,
        kind: input.kind,
        absolutePath,
        relativePath,
      });
    },
    afterWrite: async (actionId) => {
      input.transaction.journal = await completeEntry(input.transaction.journal, actionId);
    },
  };
}

function artifactEvidenceAgrees(left: InstalledArtifactEvidence | null | undefined, right: InstalledArtifactEvidence | null): boolean {
  const normalizedLeft = left ? parseInstalledArtifactEvidence(left) : null;
  const normalizedRight = right ? parseInstalledArtifactEvidence(right) : null;
  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
}

function withoutInstalledArtifact(
  artifacts: ServiceLifecycleState["installArtifacts"],
): ServiceLifecycleState["installArtifacts"] {
  const { artifact: _artifact, ...rest } = artifacts;
  return rest;
}

export function createStartupArtifactAcquisitionHooks(input: {
  transaction: { journal: StartupTransactionJournal };
  service: DiscoveredService;
}): StartupArtifactAcquisitionHooks {
  return {
    prepare: async ({ archivePath }) => {
      if (normalize(path.resolve(archivePath)) !== normalize(archivePath)) {
        throw new Error("Startup artifact archive path evidence does not agree.");
      }
      await assertSafePath(input.service.serviceRoot, archivePath, true);
      let journal = input.transaction.journal;
      if (!journal.pendingCompensations.includes("discard_materialization_sidecar")) {
        journal = await advanceStartupTransaction(journal, journal.phase, {
          completedActions: ["materialization_sidecar_intended"],
          addCompensations: ["discard_materialization_sidecar"],
        });
        input.transaction.journal = journal;
      }
      const sidecar = await readSidecar(journal).catch((error): MaterializationSidecar => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return {
            version: 1,
            transactionId: journal.transactionId,
            workspaceRoot: journal.workspaceRoot,
            servicesRoot: journal.servicesRoot,
            entries: [],
            artifactEntries: [],
          };
        }
        throw error;
      });
      sidecar.artifactEntries ??= [];
      if (sidecar.artifactEntries.length >= MAX_ENTRIES) {
        throw new Error("Startup artifact acquisition entry limit exceeded.");
      }
      const serviceRelativeRoot = assertContained(journal.servicesRoot, input.service.serviceRoot);
      const actionId = createHash("sha256")
        .update(`${journal.transactionId}\0${input.service.manifest.id}\0artifact\0${archivePath}\0${sidecar.artifactEntries.length}`)
        .digest("hex")
        .slice(0, 24);
      const archiveRelativePath = assertContained(input.service.serviceRoot, archivePath);
      const archiveTempRelativePath = `${archiveRelativePath}.startup-${actionId}.tmp`;
      const extractionRelativePath = path.join(".state", "extracted", `startup-${actionId}`);
      const extractionStagingRelativePath = `${extractionRelativePath}.staging`;
      const archiveTempPath = path.resolve(input.service.serviceRoot, archiveTempRelativePath);
      const extractionPath = path.resolve(input.service.serviceRoot, extractionRelativePath);
      const extractionStagingPath = path.resolve(input.service.serviceRoot, extractionStagingRelativePath);
      await assertSafePath(input.service.serviceRoot, archiveTempPath, true);
      if (await readArtifactTreeEvidence(input.service.serviceRoot, extractionPath) !== null ||
        await readArtifactTreeEvidence(input.service.serviceRoot, extractionStagingPath) !== null) {
        throw new Error("Startup artifact transaction path already exists.");
      }
      const current = getLifecycleState(input.service.manifest.id);
      sidecar.artifactEntries.push({
        actionId,
        serviceId: input.service.manifest.id,
        serviceRelativeRoot,
        archiveRelativePath,
        archiveTempRelativePath,
        extractionStagingRelativePath,
        extractionRelativePath,
        priorInstalled: current.installed,
        priorArtifact: current.installArtifacts.artifact ?? null,
        expectedArtifact: null,
        expectedArchive: null,
        expectedTree: null,
        extractionPublished: false,
      });
      await atomicWriteSidecar(sidecarPath(journal), sidecar);
      journal = await advanceStartupTransaction(journal, journal.phase, {
        completedActions: [`artifact_acquisition_intended:${actionId}`],
        addCompensations: [`rollback_artifact:${actionId}`],
      });
      input.transaction.journal = journal;
      return { actionId, archiveTempPath, extractionStagingPath, extractionPath };
    },
    prepareArchiveDownload: async (actionId) => {
      const sidecar = await readSidecar(input.transaction.journal);
      const entry = sidecar.artifactEntries?.find((candidate) => candidate.actionId === actionId);
      if (!entry) throw new Error("Startup artifact acquisition preparation is missing.");
      const serviceRoot = path.resolve(input.transaction.journal.servicesRoot, entry.serviceRelativeRoot);
      const archiveTempPath = path.resolve(serviceRoot, entry.archiveTempRelativePath);
      await ensureSafeDirectoryTree(serviceRoot, path.dirname(archiveTempPath));
      await assertSafePath(serviceRoot, archiveTempPath, true);
    },
    recordArchive: async (actionId, archivePath) => {
      const sidecar = await readSidecar(input.transaction.journal);
      const entry = sidecar.artifactEntries?.find((candidate) => candidate.actionId === actionId);
      if (!entry) throw new Error("Startup artifact acquisition preparation is missing.");
      const serviceRoot = path.resolve(input.transaction.journal.servicesRoot, entry.serviceRelativeRoot);
      const expectedPath = [
        path.resolve(serviceRoot, entry.archiveRelativePath),
        path.resolve(serviceRoot, entry.archiveTempRelativePath),
      ];
      if (!expectedPath.some((candidate) => normalize(candidate) === normalize(archivePath))) {
        throw new Error("Startup artifact archive digest path does not match transaction evidence.");
      }
      const evidence = await readArtifactFileEvidence(serviceRoot, archivePath);
      if (!evidence) throw new Error("Startup artifact archive is missing before publication.");
      if (entry.expectedArchive && !artifactFileMatches(entry.expectedArchive, evidence)) {
        throw new Error("Startup artifact archive changed during publication.");
      }
      entry.expectedArchive = evidence;
      await atomicWriteSidecar(sidecarPath(input.transaction.journal), sidecar);
      input.transaction.journal = await advanceStartupTransaction(input.transaction.journal, input.transaction.journal.phase, {
        completedActions: [`artifact_archive_digest_recorded:${actionId}`],
      });
      return evidence;
    },
    prepareExtraction: async (actionId) => {
      const sidecar = await readSidecar(input.transaction.journal);
      const entry = sidecar.artifactEntries?.find((candidate) => candidate.actionId === actionId);
      if (!entry?.expectedArchive) throw new Error("Startup artifact archive evidence is missing before extraction.");
      const serviceRoot = path.resolve(input.transaction.journal.servicesRoot, entry.serviceRelativeRoot);
      const stagingPath = path.resolve(serviceRoot, entry.extractionStagingRelativePath);
      const extractionPath = path.resolve(serviceRoot, entry.extractionRelativePath);
      await ensureSafeDirectoryTree(serviceRoot, path.dirname(stagingPath));
      if (await readArtifactTreeEvidence(serviceRoot, stagingPath) !== null ||
        await readArtifactTreeEvidence(serviceRoot, extractionPath) !== null) {
        throw new Error("Startup artifact transaction extraction path already exists.");
      }
      await mkdir(stagingPath, { mode: 0o700 });
      const created = await lstat(stagingPath);
      if (!created.isDirectory() || created.isSymbolicLink()) {
        throw new Error("Startup artifact extraction staging path is unsafe.");
      }
    },
    beforeExtractionPublish: async (actionId) => {
      const sidecar = await readSidecar(input.transaction.journal);
      const entry = sidecar.artifactEntries?.find((candidate) => candidate.actionId === actionId);
      if (!entry || entry.expectedTree) throw new Error("Startup artifact acquisition preparation is missing or completed.");
      const serviceRoot = path.resolve(input.transaction.journal.servicesRoot, entry.serviceRelativeRoot);
      const stagingPath = path.resolve(serviceRoot, entry.extractionStagingRelativePath);
      const tree = await readArtifactTreeEvidence(serviceRoot, stagingPath);
      if (!tree) throw new Error("Startup artifact extraction staging tree is missing.");
      entry.expectedTree = tree;
      await atomicWriteSidecar(sidecarPath(input.transaction.journal), sidecar);
      input.transaction.journal = await advanceStartupTransaction(input.transaction.journal, input.transaction.journal.phase, {
        completedActions: [`artifact_extraction_digest:${actionId}`],
        materializationDigests: { [actionId]: tree.digest },
      });
    },
    afterExtractionPublish: async (actionId) => {
      const sidecar = await readSidecar(input.transaction.journal);
      const entry = sidecar.artifactEntries?.find((candidate) => candidate.actionId === actionId);
      if (!entry?.expectedTree || entry.extractionPublished) {
        throw new Error("Startup artifact extraction publication evidence is missing or completed.");
      }
      const serviceRoot = path.resolve(input.transaction.journal.servicesRoot, entry.serviceRelativeRoot);
      const extractionPath = path.resolve(serviceRoot, entry.extractionRelativePath);
      const tree = await readArtifactTreeEvidence(serviceRoot, extractionPath);
      if (!artifactTreeMatches(tree, entry.expectedTree)) {
        throw new Error("Startup artifact published extraction does not match its staged digest.");
      }
      entry.extractionPublished = true;
      await atomicWriteSidecar(sidecarPath(input.transaction.journal), sidecar);
      input.transaction.journal = await advanceStartupTransaction(input.transaction.journal, input.transaction.journal.phase, {
        completedActions: [`artifact_extraction_published:${actionId}`],
      });
    },
    complete: async (actionId, artifact) => {
      const sidecar = await readSidecar(input.transaction.journal);
      const entry = sidecar.artifactEntries?.find((candidate) => candidate.actionId === actionId);
      if (!entry?.extractionPublished || entry.expectedArtifact) {
        throw new Error("Startup artifact acquisition publication is missing or completed.");
      }
      const serviceRoot = path.resolve(input.transaction.journal.servicesRoot, entry.serviceRelativeRoot);
      if (normalize(artifact.archivePath ?? "") !== normalize(path.resolve(serviceRoot, entry.archiveRelativePath)) ||
        normalize(artifact.extractedPath ?? "") !== normalize(path.resolve(serviceRoot, entry.extractionRelativePath))) {
        throw new Error("Startup artifact lifecycle metadata does not match transaction paths.");
      }
      entry.expectedArtifact = parseInstalledArtifactEvidence(artifact);
      await atomicWriteSidecar(sidecarPath(input.transaction.journal), sidecar);
      input.transaction.journal = await advanceStartupTransaction(input.transaction.journal, input.transaction.journal.phase, {
        completedActions: [`artifact_acquired:${actionId}`],
      });
    },
  };
}

export async function rollbackStartupArtifactAcquisitions(input: {
  journal: StartupTransactionJournal;
  discovered: DiscoveredService[];
}): Promise<StartupArtifactRollbackResult> {
  let journal = input.journal;
  const pending = journal.pendingCompensations
    .filter((action) => action.startsWith("rollback_artifact:"))
    .map((action) => action.slice("rollback_artifact:".length));
  if (pending.length === 0) return { journal, completedActionIds: [], blockedActionIds: [] };
  let sidecar: MaterializationSidecar;
  try {
    sidecar = await readSidecar(journal);
  } catch {
    return { journal, completedActionIds: [], blockedActionIds: pending };
  }
  const discoveredById = new Map(input.discovered.map((service) => [service.manifest.id, service]));
  const completedActionIds: string[] = [];
  const blockedActionIds: string[] = [];
  for (const actionId of [...pending].reverse()) {
    const entry = sidecar.artifactEntries?.find((candidate) => candidate.actionId === actionId);
    const service = entry ? discoveredById.get(entry.serviceId) : undefined;
    if (!entry || !service ||
      normalize(service.serviceRoot) !== normalize(path.resolve(journal.servicesRoot, entry.serviceRelativeRoot))) {
      blockedActionIds.push(actionId);
      continue;
    }
    try {
      const serviceRoot = service.serviceRoot;
      const archiveTempPath = path.resolve(serviceRoot, entry.archiveTempRelativePath);
      const archivePath = path.resolve(serviceRoot, entry.archiveRelativePath);
      const stagingPath = path.resolve(serviceRoot, entry.extractionStagingRelativePath);
      const extractionPath = path.resolve(serviceRoot, entry.extractionRelativePath);
      const currentTree = await readArtifactTreeEvidence(serviceRoot, extractionPath);
      const stagingTree = await readArtifactTreeEvidence(serviceRoot, stagingPath);
      const archiveTemp = await readArtifactFileEvidence(serviceRoot, archiveTempPath);
      const archive = await readArtifactFileEvidence(serviceRoot, archivePath);
      if (archiveTemp && entry.expectedArchive && (!artifactFileMatches(archiveTemp, entry.expectedArchive) ||
        (archive && !artifactFileMatches(archive, entry.expectedArchive)))) {
        throw new Error("Startup artifact cache publish evidence changed while its hard-link temp remained.");
      }
      if (currentTree && (!entry.expectedTree || !artifactTreeMatches(currentTree, entry.expectedTree))) {
        throw new Error("Startup artifact extraction is not attributable to the transaction.");
      }
      if (stagingTree && entry.expectedTree && !artifactTreeMatches(stagingTree, entry.expectedTree)) {
        throw new Error("Startup artifact staging tree changed after digest capture.");
      }
      const current = getLifecycleState(entry.serviceId);
      const currentArtifact = current.installArtifacts.artifact ?? null;
      const stateIsPrior = artifactEvidenceAgrees(currentArtifact, entry.priorArtifact) && current.installed === entry.priorInstalled;
      const stateIsExpected = entry.expectedArtifact !== null && artifactEvidenceAgrees(currentArtifact, entry.expectedArtifact);
      if (!stateIsPrior && !stateIsExpected) {
        throw new Error("Startup artifact lifecycle state changed outside the transaction.");
      }
      if (stateIsExpected) {
        const installArtifacts = entry.priorArtifact
          ? { ...current.installArtifacts, artifact: entry.priorArtifact }
          : withoutInstalledArtifact(current.installArtifacts);
        const nextState = { ...current, installed: entry.priorInstalled, installArtifacts };
        await writeServiceState(service, nextState);
        setLifecycleState(entry.serviceId, nextState);
      }
      if (currentTree) await removeTransactionArtifactTree(serviceRoot, extractionPath, entry.expectedTree ?? undefined);
      if (stagingTree) await removeTransactionArtifactTree(serviceRoot, stagingPath, entry.expectedTree ?? undefined);
      if (archiveTemp) await unlink(archiveTempPath);
      journal = await advanceStartupTransaction(journal, journal.phase, {
        completedActions: [`artifact_rolled_back:${actionId}`],
        removeCompensations: [`rollback_artifact:${actionId}`],
      });
      completedActionIds.push(actionId);
    } catch {
      blockedActionIds.push(actionId);
    }
  }
  return { journal, completedActionIds, blockedActionIds };
}

export function createStartupSetupTransactionHooks(
  transaction: { journal: StartupTransactionJournal },
): SetupTransactionHooks {
  const prepared = new Map<string, { hooks: MaterializationWriteHooks; actionIds: string[] }>();
  return {
    beforeStep: async (service, stepId, outputs) => {
      const key = `${service.manifest.id}\0${stepId}`;
      if (outputs === undefined) {
        const actionId = createHash("sha256")
          .update(`${transaction.journal.transactionId}\0${service.manifest.id}\0${stepId}\0unverifiable`)
          .digest("hex")
          .slice(0, 24);
        transaction.journal = await advanceStartupTransaction(transaction.journal, transaction.journal.phase, {
          completedActions: [`setup_output_unverifiable:${actionId}`],
          addCompensations: [`verify_setup_output:${actionId}`],
        });
        return;
      }
      const hooks = createStartupMaterializationHooks({ transaction, service, kind: "setup" });
      const actionIds: string[] = [];
      for (const output of outputs) {
        const absolutePath = path.resolve(service.serviceRoot, output);
        actionIds.push(await hooks.beforeWrite({ absolutePath, relativePath: output.replaceAll("\\", "/") }));
      }
      prepared.set(key, { hooks, actionIds });
    },
    afterStep: async (service, stepId, outputs) => {
      if (outputs === undefined) return;
      const record = prepared.get(`${service.manifest.id}\0${stepId}`);
      if (!record) throw new Error("Setup materialization preparation is missing.");
      for (const actionId of record.actionIds) await record.hooks.afterWrite(actionId);
      prepared.delete(`${service.manifest.id}\0${stepId}`);
    },
  };
}

export async function rollbackStartupMaterializations(
  journal: StartupTransactionJournal,
): Promise<StartupMaterializationRollbackResult> {
  const pending = journal.pendingCompensations
    .filter((action) => action.startsWith("restore_materialization:"))
    .map((action) => action.slice("restore_materialization:".length));
  if (pending.length === 0) {
    return { completedActionIds: [], blockedActionIds: [], stateReconciliationRequiredActionIds: [] };
  }
  let sidecar: MaterializationSidecar;
  try {
    sidecar = await readSidecar(journal);
  } catch {
    return { completedActionIds: [], blockedActionIds: pending, stateReconciliationRequiredActionIds: [] };
  }
  const completedActionIds: string[] = [];
  const blockedActionIds: string[] = [];
  const stateReconciliationRequiredActionIds: string[] = [];
  for (const actionId of [...pending].reverse()) {
    const entry = sidecar.entries.find((candidate) => candidate.actionId === actionId);
    if (!entry) {
      blockedActionIds.push(actionId);
      continue;
    }
    try {
      const serviceRoot = path.resolve(journal.servicesRoot, entry.serviceRelativeRoot);
      const target = path.resolve(serviceRoot, entry.targetRelativePath);
      await sweepTransactionTemps(serviceRoot, target, ".restore.tmp");
      await assertSafePath(serviceRoot, target, true);
      const current = await readImage(serviceRoot, target);
      const entryIndex = sidecar.entries.indexOf(entry);
      const alreadyRestored = sidecar.entries
        .slice(0, entryIndex + 1)
        .filter((candidate) => sameEntryTarget(candidate, entry))
        .some((candidate) => imageMatches(current, candidate.preimage));
      if (alreadyRestored) {
        completedActionIds.push(actionId);
        if (entry.postimageRecorded && !imageMetadataMatches(entry.preimage, entry.expectedPostimage)) {
          stateReconciliationRequiredActionIds.push(actionId);
        }
        continue;
      }
      if (!entry.postimageRecorded) {
        throw new Error("Materialization write outcome is unverifiable.");
      } else {
        const postimageAgrees = entry.expectedPostimage === null
          ? current === null
          : current?.digest === entry.expectedPostimage.digest && current.size === entry.expectedPostimage.size;
        if (!postimageAgrees) {
          throw new Error("Materialization output changed after the transaction write.");
        }
        if (entry.preimage === null) {
          if (current) {
            await unlink(target);
            await syncDirectoryOnPosix(path.dirname(target));
          }
        } else {
          const content = Buffer.from(entry.preimage.contentBase64, "base64");
          if (content.length !== entry.preimage.size || digest(content) !== entry.preimage.digest) {
            throw new Error("Materialization preimage digest mismatch.");
          }
          const tempPath = `${target}.${process.pid}.${randomUUID()}.restore.tmp`;
          try {
            const handle = await open(tempPath, "wx", entry.preimage.mode & 0o777);
            try {
              await enforceWindowsPrivateAcl(tempPath);
              await handle.writeFile(content);
              await handle.sync();
            } finally {
              await handle.close();
            }
            await rename(tempPath, target);
            if (process.platform !== "win32") await chmod(target, entry.preimage.mode & 0o777);
            await syncDirectoryOnPosix(path.dirname(target));
          } catch (error) {
            await unlink(tempPath).catch(() => undefined);
            throw error;
          }
        }
      }
      completedActionIds.push(actionId);
      stateReconciliationRequiredActionIds.push(actionId);
    } catch {
      blockedActionIds.push(actionId);
    }
  }
  return { completedActionIds, blockedActionIds, stateReconciliationRequiredActionIds };
}

export async function reconcileStartupMaterializationLifecycleState(input: {
  journal: StartupTransactionJournal;
  discovered: DiscoveredService[];
  testHooks?: {
    afterPersist?: (service: DiscoveredService, journal: StartupTransactionJournal) => Promise<void>;
  };
}): Promise<StartupMaterializationStateReconciliationResult> {
  if (input.testHooks && process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS !== "1") {
    throw new Error("Startup materialization test hooks require SERVICE_LASSO_ENABLE_TEST_HOOKS=1.");
  }
  let journal = input.journal;
  const pending = journal.pendingCompensations
    .filter((action) => action.startsWith("reconcile_materialization_state:"))
    .map((action) => action.slice("reconcile_materialization_state:".length));
  if (pending.length === 0) return { journal, reconciledActionIds: [], blockedActionIds: [] };

  let sidecar: MaterializationSidecar;
  try {
    sidecar = await readSidecar(journal);
  } catch {
    return { journal, reconciledActionIds: [], blockedActionIds: pending };
  }
  const discoveredById = new Map(input.discovered.map((service) => [service.manifest.id, service]));
  const grouped = new Map<string, {
    service: DiscoveredService;
    actionIds: string[];
    kinds: Set<StartupMaterializationKind>;
    setupStepIds: Set<string>;
  }>();
  const blockedActionIds: string[] = [];
  for (const actionId of pending) {
    const entry = sidecar.entries.find((candidate) => candidate.actionId === actionId);
    const service = entry ? discoveredById.get(entry.serviceId) : undefined;
    if (!entry || !service ||
      normalize(service.serviceRoot) !== normalize(path.resolve(journal.servicesRoot, entry.serviceRelativeRoot))) {
      blockedActionIds.push(actionId);
      continue;
    }
    const setupStepIds = setupStepIdsForEntry(service, entry);
    if (entry.kind === "setup" && setupStepIds.length !== 1) {
      blockedActionIds.push(actionId);
      continue;
    }
    const record = grouped.get(service.manifest.id) ?? {
      service,
      actionIds: [],
      kinds: new Set<StartupMaterializationKind>(),
      setupStepIds: new Set<string>(),
    };
    record.actionIds.push(actionId);
    record.kinds.add(entry.kind);
    for (const stepId of setupStepIds) record.setupStepIds.add(stepId);
    grouped.set(service.manifest.id, record);
  }

  const reconciledActionIds: string[] = [];
  for (const serviceId of [...grouped.keys()].sort((left, right) => left.localeCompare(right))) {
    const record = grouped.get(serviceId)!;
    const intentActions = record.actionIds.map((actionId) => `materialization_state_reconcile_intended:${actionId}`);
    const missingIntentActions = intentActions.filter((action) => !journal.completedActions.includes(action));
    if (missingIntentActions.length > 0) {
      journal = await advanceStartupTransaction(journal, journal.phase, { completedActions: missingIntentActions });
    }
    try {
      const nextState = reconcileLifecycleState(
        getLifecycleState(serviceId),
        record.kinds,
        record.setupStepIds,
      );
      // Persist first. A crash before the journal completion is safe: the
      // pending compensation causes recovery to repeat the idempotent write.
      await writeServiceState(record.service, nextState);
      setLifecycleState(serviceId, nextState);
      await input.testHooks?.afterPersist?.(record.service, journal);
      journal = await advanceStartupTransaction(journal, journal.phase, {
        completedActions: record.actionIds.map((actionId) => `materialization_state_reconciled:${actionId}`),
        removeCompensations: record.actionIds.map((actionId) => `reconcile_materialization_state:${actionId}`),
      });
      reconciledActionIds.push(...record.actionIds);
    } catch {
      blockedActionIds.push(...record.actionIds);
    }
  }
  return { journal, reconciledActionIds, blockedActionIds: [...new Set(blockedActionIds)] };
}

export async function inspectStartupMaterializations(
  journal: StartupTransactionJournal,
): Promise<StartupMaterializationInspection> {
  if (
    journal.phase === "generation_committed" &&
    journal.completedActions.includes("generation_committed")
  ) {
    return {
      status: "commit_cleanup",
      reason: "generation_committed_materialization_cleanup_only",
      actionIds: journal.pendingCompensations
        .filter((action) => action.startsWith("restore_materialization:"))
        .map((action) => action.slice("restore_materialization:".length)),
    };
  }
  const reconciliationActionIds = journal.pendingCompensations
    .filter((action) => action.startsWith("reconcile_materialization_state:"))
    .map((action) => action.slice("reconcile_materialization_state:".length));
  if (reconciliationActionIds.length > 0) {
    try {
      const sidecar = await readSidecar(journal);
      if (reconciliationActionIds.some((actionId) => !sidecar.entries.some((entry) => entry.actionId === actionId))) {
        return {
          status: "blocked",
          reason: "materialization_state_reconciliation_entry_missing",
          actionIds: reconciliationActionIds,
        };
      }
    } catch {
      return {
        status: "blocked",
        reason: "materialization_state_reconciliation_sidecar_invalid",
        actionIds: reconciliationActionIds,
      };
    }
    return {
      status: "rollback",
      reason: "materialization_state_reconciliation_pending",
      actionIds: reconciliationActionIds,
    };
  }
  const artifactActionIds = journal.pendingCompensations
    .filter((action) => action.startsWith("rollback_artifact:"))
    .map((action) => action.slice("rollback_artifact:".length));
  if (artifactActionIds.length > 0) {
    let sidecar: MaterializationSidecar;
    try {
      sidecar = await readSidecar(journal);
    } catch {
      return { status: "blocked", reason: "artifact_sidecar_missing_or_invalid", actionIds: artifactActionIds };
    }
    for (const actionId of artifactActionIds) {
      const entry = sidecar.artifactEntries?.find((candidate) => candidate.actionId === actionId);
      if (!entry) return { status: "blocked", reason: "artifact_entry_missing", actionIds: artifactActionIds };
      try {
        const serviceRoot = path.resolve(journal.servicesRoot, entry.serviceRelativeRoot);
        const extractionPath = path.resolve(serviceRoot, entry.extractionRelativePath);
        const stagingPath = path.resolve(serviceRoot, entry.extractionStagingRelativePath);
        const archiveTempPath = path.resolve(serviceRoot, entry.archiveTempRelativePath);
        const archivePath = path.resolve(serviceRoot, entry.archiveRelativePath);
        const extractionTree = await readArtifactTreeEvidence(serviceRoot, extractionPath);
        const stagingTree = await readArtifactTreeEvidence(serviceRoot, stagingPath);
        const archiveTemp = await readArtifactFileEvidence(serviceRoot, archiveTempPath);
        const archive = await readArtifactFileEvidence(serviceRoot, archivePath);
        if (archiveTemp && entry.expectedArchive && (!artifactFileMatches(archiveTemp, entry.expectedArchive) ||
          (archive && !artifactFileMatches(archive, entry.expectedArchive)))) {
          return { status: "blocked", reason: "artifact_cache_publish_changed", actionIds: artifactActionIds };
        }
        if (extractionTree && (!entry.expectedTree || !artifactTreeMatches(extractionTree, entry.expectedTree))) {
          return { status: "blocked", reason: "artifact_extraction_changed", actionIds: artifactActionIds };
        }
        if (stagingTree && entry.expectedTree && !artifactTreeMatches(stagingTree, entry.expectedTree)) {
          return { status: "blocked", reason: "artifact_staging_changed", actionIds: artifactActionIds };
        }
        if (archiveTemp || stagingTree || !entry.extractionPublished || !entry.expectedArtifact || !extractionTree) {
          return { status: "rollback", reason: "artifact_acquisition_incomplete", actionIds: artifactActionIds };
        }
        const expectedTree = entry.expectedTree;
        if (!expectedTree || journal.materializationDigests[actionId] !== expectedTree.digest) {
          return { status: "blocked", reason: "artifact_journal_digest_mismatch", actionIds: artifactActionIds };
        }
      } catch {
        return { status: "blocked", reason: "artifact_evidence_unverifiable", actionIds: artifactActionIds };
      }
    }
  }
  const actionIds = journal.pendingCompensations
    .filter((action) => action.startsWith("restore_materialization:"))
    .map((action) => action.slice("restore_materialization:".length));
  if (actionIds.length === 0) {
    if (artifactActionIds.length > 0) {
      return { status: "agree", reason: "artifact_evidence_agrees", actionIds: artifactActionIds };
    }
    return journal.pendingCompensations.includes("discard_materialization_sidecar")
      ? { status: "rollback", reason: "materialization_cleanup_pending", actionIds }
      : { status: "agree", reason: "no_materialization_compensations", actionIds };
  }
  let sidecar: MaterializationSidecar;
  try {
    sidecar = await readSidecar(journal);
  } catch {
    return { status: "blocked", reason: "materialization_sidecar_missing_or_invalid", actionIds };
  }
  let incomplete = false;
  for (const actionId of actionIds) {
    const entry = sidecar.entries.find((candidate) => candidate.actionId === actionId);
    if (!entry) return { status: "blocked", reason: "materialization_entry_missing", actionIds };
    try {
      const serviceRoot = path.resolve(journal.servicesRoot, entry.serviceRelativeRoot);
      const target = path.resolve(serviceRoot, entry.targetRelativePath);
      await assertSafePath(serviceRoot, target, true);
      const current = await readImage(serviceRoot, target);
      const entryIndex = sidecar.entries.indexOf(entry);
      const alreadyRestored = sidecar.entries
        .slice(0, entryIndex + 1)
        .filter((candidate) => sameEntryTarget(candidate, entry))
        .some((candidate) => imageMatches(current, candidate.preimage));
      if (alreadyRestored) {
        incomplete = true;
        continue;
      }
      if (!entry.postimageRecorded) {
        return { status: "blocked", reason: "materialization_postimage_unverifiable", actionIds };
      }
      const expectedDigest = entry.expectedPostimage?.digest ?? "missing";
      if (journal.materializationDigests[actionId] !== expectedDigest) {
        return { status: "blocked", reason: "materialization_journal_digest_mismatch", actionIds };
      }
      const agrees = entry.expectedPostimage === null
        ? current === null
        : current?.digest === entry.expectedPostimage.digest && current.size === entry.expectedPostimage.size;
      if (!agrees) return { status: "blocked", reason: "materialization_output_changed", actionIds };
    } catch {
      return { status: "blocked", reason: "materialization_evidence_unverifiable", actionIds };
    }
  }
  return incomplete
    ? { status: "rollback", reason: "materialization_write_incomplete", actionIds }
    : { status: "agree", reason: "materialization_evidence_agrees", actionIds };
}

export async function completeCommittedStartupMaterializationCleanup(
  journal: StartupTransactionJournal,
): Promise<StartupTransactionJournal> {
  if (
    journal.phase !== "generation_committed" ||
    !journal.completedActions.includes("generation_committed")
  ) {
    throw new Error("Cannot perform commit-only materialization cleanup before generation commit.");
  }
  const hasMaterializationEvidence = journal.pendingCompensations.some((compensation) =>
    compensation === "discard_materialization_sidecar" ||
    compensation.startsWith("restore_materialization:") ||
    compensation.startsWith("rollback_artifact:") ||
    compensation.startsWith("verify_setup_output:"),
  ) || journal.completedActions.some((action) =>
    action === "materialization_sidecar_intended" ||
    action === "materialization_commit_cleanup_intended" ||
    action.startsWith("materialization_preimage:") ||
    action.startsWith("artifact_acquisition_intended:"),
  );
  if (!hasMaterializationEvidence) return journal;
  const rollbackCompensations = journal.pendingCompensations.filter((compensation) =>
    compensation.startsWith("restore_materialization:") || compensation.startsWith("verify_setup_output:"),
  );
  if (
    rollbackCompensations.length > 0 ||
    !journal.completedActions.includes("materialization_commit_cleanup_intended")
  ) {
    journal = await advanceStartupTransaction(journal, journal.phase, {
      completedActions: ["materialization_commit_cleanup_intended"],
      removeCompensations: rollbackCompensations,
    });
  }
  const artifactActionIds = journal.pendingCompensations
    .filter((compensation) => compensation.startsWith("rollback_artifact:"))
    .map((compensation) => compensation.slice("rollback_artifact:".length));
  if (artifactActionIds.length > 0) {
    const sidecar = await readSidecar(journal);
    for (const actionId of artifactActionIds) {
      const entry = sidecar.artifactEntries?.find((candidate) => candidate.actionId === actionId);
      if (!entry) throw new Error("Committed startup artifact evidence is missing.");
      const serviceRoot = path.resolve(journal.servicesRoot, entry.serviceRelativeRoot);
      const extractionPath = path.resolve(serviceRoot, entry.extractionRelativePath);
      const stagingPath = path.resolve(serviceRoot, entry.extractionStagingRelativePath);
      const archiveTempPath = path.resolve(serviceRoot, entry.archiveTempRelativePath);
      const archivePath = path.resolve(serviceRoot, entry.archiveRelativePath);
      const stored = await readStoredState(serviceRoot);
      if (!isRecord(stored.install) || typeof stored.install.installed !== "boolean") {
        throw new Error("Committed startup artifact persisted lifecycle evidence is missing.");
      }
      const persistedArtifact = parseInstalledArtifactEvidence(stored.install.artifact ?? null);
      const committedExtraction = stored.install.installed && entry.expectedArtifact !== null &&
        artifactEvidenceAgrees(persistedArtifact, entry.expectedArtifact);
      const persistedArtifactIsKnown = artifactEvidenceAgrees(persistedArtifact, entry.priorArtifact) ||
        (sidecar.artifactEntries ?? []).some((candidate) =>
          candidate.expectedArtifact !== null && artifactEvidenceAgrees(persistedArtifact, candidate.expectedArtifact));
      if (!persistedArtifactIsKnown) {
        throw new Error("Committed startup artifact persisted lifecycle evidence is contradictory.");
      }
      const extractionTree = await readArtifactTreeEvidence(serviceRoot, extractionPath);
      if (extractionTree && (!entry.expectedTree || !artifactTreeMatches(extractionTree, entry.expectedTree))) {
        throw new Error("Committed startup artifact extraction changed before cleanup.");
      }
      if (committedExtraction) {
        if (!entry.extractionPublished || !entry.expectedTree || !extractionTree) {
          throw new Error("Committed startup artifact lifecycle state references incomplete extraction evidence.");
        }
      } else if (extractionTree) {
        await removeTransactionArtifactTree(serviceRoot, extractionPath, entry.expectedTree ?? undefined);
      }
      const stagingTree = await readArtifactTreeEvidence(serviceRoot, stagingPath);
      if (stagingTree) await removeTransactionArtifactTree(serviceRoot, stagingPath, entry.expectedTree ?? undefined);
      const archiveTemp = await readArtifactFileEvidence(serviceRoot, archiveTempPath);
      const archive = await readArtifactFileEvidence(serviceRoot, archivePath);
      if (archiveTemp && entry.expectedArchive && (!artifactFileMatches(archiveTemp, entry.expectedArchive) ||
        (archive && !artifactFileMatches(archive, entry.expectedArchive)))) {
        throw new Error("Committed startup artifact cache hard-link evidence changed.");
      }
      if (archiveTemp) await unlink(archiveTempPath);
      journal = await advanceStartupTransaction(journal, journal.phase, {
        completedActions: [`artifact_committed:${actionId}`],
        removeCompensations: [`rollback_artifact:${actionId}`],
      });
    }
  }
  if (journal.pendingCompensations.includes("discard_materialization_sidecar")) {
    await discardStartupMaterializationSidecar(journal);
    journal = await advanceStartupTransaction(journal, journal.phase, {
      completedActions: ["materialization_sidecar_discarded"],
      removeCompensations: ["discard_materialization_sidecar"],
    });
  }
  return journal;
}

export async function discardStartupMaterializationSidecar(journal: StartupTransactionJournal): Promise<void> {
  const filePath = sidecarPath(journal);
  await assertSafePath(journal.workspaceRoot, filePath, true);
  try {
    await unlink(filePath);
    await syncDirectoryOnPosix(path.dirname(filePath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  } finally {
    const protectedKey = windowsSidecarKeys.get(journal.transactionId);
    protectedKey?.key.fill(0);
    windowsSidecarKeys.delete(journal.transactionId);
  }
}
