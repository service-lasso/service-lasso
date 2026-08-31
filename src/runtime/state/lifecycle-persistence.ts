import { randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { chmod, lstat, mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";

/**
 * Hardened persistence boundary for process, generation, allocation, and
 * startup-transaction state (`SPEC-002` `AC-4BL`).
 *
 * Service lifecycle document identifiers such as `service-lasso.service-state.v1`
 * stay unchanged; this module versions workspace lifecycle-state files only.
 */

export const LIFECYCLE_MIGRATION_SCHEMA_VERSION = "service-lasso.lifecycle-migration.v1";
export const PROCESS_OWNERSHIP_SCHEMA_V1 = "service-lasso.process-ownership.v1";
export const PROCESS_OWNERSHIP_SCHEMA_V2 = "service-lasso.process-ownership.v2";
export const RUNTIME_GENERATION_SCHEMA_V1 = "service-lasso.runtime-generation.v1";
export const RUNTIME_GENERATION_SCHEMA_V2 = "service-lasso.runtime-generation.v2";
export const RUNTIME_INSTANCE_SCHEMA_V2 = "service-lasso.runtime-instance.v2";
export const STARTUP_TRANSACTION_SCHEMA_V1 = "service-lasso.startup-transaction.v1";
export const STARTUP_TRANSACTION_SCHEMA_V2 = "service-lasso.startup-transaction.v2";
export const ENDPOINT_ALLOCATION_SCHEMA_V1 = "service-lasso.endpoint-allocation.v1";
export const ENDPOINT_ALLOCATION_SCHEMA_V2 = "service-lasso.endpoint-allocation.v2";

export const MAX_LIFECYCLE_DOCUMENT_BYTES = 256 * 1024;
export const MAX_LIFECYCLE_LOCK_BYTES = 16 * 1024;
export const MAX_LIFECYCLE_JSON_DEPTH = 8;
export const MAX_LIFECYCLE_OBJECT_KEYS = 256;
export const MAX_LIFECYCLE_ARRAY_LENGTH = 256;
export const MAX_LIFECYCLE_STRING_CHARS = 4096;

export type LifecycleDocumentKind =
  | "process-ownership"
  | "runtime-generation"
  | "runtime-instance"
  | "startup-transaction"
  | "endpoint-allocation";

export type LifecycleArtifactRole = "registry" | "backup" | "lock" | "journal" | "temp";

export type LifecycleStateClassification =
  | "missing"
  | "current"
  | "legacy"
  | "corrupt"
  | "unsupported-old"
  | "unsupported-new"
  | "redirected"
  | "oversized"
  | "migration-interrupted";

export interface LifecycleDocumentPolicy {
  readonly kind: LifecycleDocumentKind;
  readonly currentSchemaVersion: string;
  readonly currentVersion: number;
  readonly legacyVersion: number;
  readonly relativePath: string;
  readonly legacyUnversioned?: boolean;
}

export interface LifecycleDocumentInspection {
  readonly kind: LifecycleDocumentKind;
  readonly classification: LifecycleStateClassification;
  readonly schemaVersion: string | null;
  readonly numericVersion: number | null;
  readonly safePath: string;
  readonly recoveredFromBackup: boolean;
}

export interface LifecycleReadResult<T> {
  readonly inspection: LifecycleDocumentInspection;
  readonly document: T | null;
}

interface LifecycleMigrationJournal {
  readonly schemaVersion: typeof LIFECYCLE_MIGRATION_SCHEMA_VERSION;
  readonly kind: LifecycleDocumentKind;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly phase: "backup_written" | "candidate_validated";
  readonly startedAt: string;
  readonly backupFileName: string;
  readonly candidateFileName: string;
}

/**
 * Fail-closed error for redirected, oversized, unsupported, or untrusted
 * lifecycle-state documents. Messages never include secrets or command lines.
 */
export class LifecycleStateError extends Error {
  readonly code: LifecycleStateClassification;
  readonly kind: LifecycleDocumentKind;
  readonly safePath: string;

  constructor(
    code: LifecycleStateClassification,
    kind: LifecycleDocumentKind,
    safePath: string,
    message: string,
  ) {
    super(message);
    this.name = "LifecycleStateError";
    this.code = code;
    this.kind = kind;
    this.safePath = safePath;
  }
}

export const PROCESS_OWNERSHIP_POLICY: LifecycleDocumentPolicy = {
  kind: "process-ownership",
  currentSchemaVersion: PROCESS_OWNERSHIP_SCHEMA_V2,
  currentVersion: 2,
  legacyVersion: 1,
  relativePath: path.join(".service-lasso", "processes.json"),
};

export const RUNTIME_GENERATION_POLICY: LifecycleDocumentPolicy = {
  kind: "runtime-generation",
  currentSchemaVersion: RUNTIME_GENERATION_SCHEMA_V2,
  currentVersion: 2,
  legacyVersion: 1,
  relativePath: path.join(".service-lasso", "runtime-generations.json"),
};

export const RUNTIME_INSTANCE_POLICY: LifecycleDocumentPolicy = {
  kind: "runtime-instance",
  currentSchemaVersion: RUNTIME_INSTANCE_SCHEMA_V2,
  currentVersion: 2,
  legacyVersion: 1,
  relativePath: path.join(".service-lasso", "runtime-instance.json"),
  legacyUnversioned: true,
};

export const STARTUP_TRANSACTION_POLICY: LifecycleDocumentPolicy = {
  kind: "startup-transaction",
  currentSchemaVersion: STARTUP_TRANSACTION_SCHEMA_V2,
  currentVersion: 2,
  legacyVersion: 1,
  relativePath: path.join(".service-lasso", "startup-transaction.json"),
};

export const ENDPOINT_ALLOCATION_POLICY: LifecycleDocumentPolicy = {
  kind: "endpoint-allocation",
  currentSchemaVersion: ENDPOINT_ALLOCATION_SCHEMA_V2,
  currentVersion: 2,
  legacyVersion: 1,
  relativePath: path.join("runtime", "endpoint-allocation.json"),
};

const WORKSPACE_LIFECYCLE_POLICIES: readonly LifecycleDocumentPolicy[] = [
  PROCESS_OWNERSHIP_POLICY,
  RUNTIME_GENERATION_POLICY,
  RUNTIME_INSTANCE_POLICY,
  STARTUP_TRANSACTION_POLICY,
  ENDPOINT_ALLOCATION_POLICY,
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return isRecord(error) && typeof error.code === "string";
}

function isLifecycleClassification(value: unknown): value is LifecycleStateClassification {
  return value === "missing"
    || value === "current"
    || value === "legacy"
    || value === "corrupt"
    || value === "unsupported-old"
    || value === "unsupported-new"
    || value === "redirected"
    || value === "oversized"
    || value === "migration-interrupted";
}

/**
 * Returns true when lstat evidence is a symlink, junction, or other special
 * file that must not carry lifecycle state.
 */
export function isRedirectedOrSpecialFile(stats: Stats): boolean {
  return stats.isSymbolicLink()
    || stats.isFIFO()
    || stats.isSocket()
    || stats.isCharacterDevice()
    || stats.isBlockDevice();
}

function exclusiveWriteFlags(): number {
  const noFollow = constants.O_NOFOLLOW ?? 0;
  return constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollow;
}

function exclusiveReadFlags(): number {
  const noFollow = constants.O_NOFOLLOW ?? 0;
  return constants.O_RDONLY | noFollow;
}

function fail(
  code: LifecycleStateClassification,
  kind: LifecycleDocumentKind,
  safePath: string,
  message: string,
): never {
  throw new LifecycleStateError(code, kind, safePath, message);
}

function documentFileName(policy: LifecycleDocumentPolicy): string {
  return path.basename(policy.relativePath);
}

function backupFileName(policy: LifecycleDocumentPolicy): string {
  return `${documentFileName(policy)}.bak`;
}

function migrationBackupFileName(policy: LifecycleDocumentPolicy): string {
  return `${documentFileName(policy)}.v${policy.legacyVersion}.bak`;
}

function migrationJournalFileName(policy: LifecycleDocumentPolicy): string {
  return `${documentFileName(policy)}.migrate.json`;
}

function siblingPath(documentPath: string, fileName: string): string {
  return path.join(path.dirname(documentPath), fileName);
}

/**
 * Resolves a workspace-relative path and refuses traversal outside the
 * resolved workspace root.
 */
export function resolveInsideWorkspace(workspaceRoot: string, relativePath: string): string {
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(root, relativePath);
  const relative = path.relative(root, target);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Lifecycle state path must stay inside the workspace root.");
  }
  return target;
}

export function getLifecycleDocumentPath(workspaceRoot: string, policy: LifecycleDocumentPolicy): string {
  return resolveInsideWorkspace(workspaceRoot, policy.relativePath);
}

/**
 * Creates and verifies the document's parent directory without following
 * unexpected symlinks, junctions, or reparse points under the workspace root.
 */
export async function resolveVerifiedStateDirectory(
  workspaceRoot: string,
  policy: LifecycleDocumentPolicy,
): Promise<string> {
  const documentPath = getLifecycleDocumentPath(workspaceRoot, policy);
  const stateDirectory = path.dirname(documentPath);
  const root = path.resolve(workspaceRoot);
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  const relative = path.relative(root, stateDirectory);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let info: Stats;
    try {
      info = await lstat(current);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        fail("missing", policy.kind, current, "Lifecycle state directory disappeared during verification.");
      }
      throw error;
    }
    if (!info.isDirectory() || isRedirectedOrSpecialFile(info)) {
      fail(
        "redirected",
        policy.kind,
        current,
        "Lifecycle state directory is redirected or an unsupported filesystem object.",
      );
    }
  }
  try {
    await chmod(stateDirectory, 0o700);
  } catch {
    // Windows may not honor POSIX mode bits; owner-only Unix mode is best-effort.
  }
  return stateDirectory;
}

async function lstatIfPresent(targetPath: string): Promise<Stats | null> {
  try {
    return await lstat(targetPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/**
 * Refuses registry, backup, lock, journal, and temp paths that are links or
 * unsupported special files. Missing paths are allowed so exclusive creates
 * can proceed.
 */
export async function assertSafeLifecycleArtifact(
  workspaceRoot: string,
  targetPath: string,
  role: LifecycleArtifactRole,
  kind: LifecycleDocumentKind,
  maxBytes: number = MAX_LIFECYCLE_DOCUMENT_BYTES,
): Promise<Stats | null> {
  const resolvedTarget = path.resolve(targetPath);
  const root = path.resolve(workspaceRoot);
  const relative = path.relative(root, resolvedTarget);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    fail("redirected", kind, resolvedTarget, "Lifecycle state artifact must stay inside the workspace root.");
  }
  const info = await lstatIfPresent(resolvedTarget);
  if (!info) {
    return null;
  }
  if (isRedirectedOrSpecialFile(info) || !info.isFile()) {
    fail(
      "redirected",
      kind,
      resolvedTarget,
      `Lifecycle ${role} file is redirected or an unsupported filesystem object.`,
    );
  }
  if (info.size < 0 || info.size > maxBytes) {
    fail("oversized", kind, resolvedTarget, `Lifecycle ${role} file exceeds the bounded size.`);
  }
  return info;
}

function countBoundedJson(value: unknown, depth: number): void {
  if (depth > MAX_LIFECYCLE_JSON_DEPTH) {
    throw new Error("Lifecycle state document exceeds the bounded JSON depth.");
  }
  if (typeof value === "string") {
    if (value.length > MAX_LIFECYCLE_STRING_CHARS) {
      throw new Error("Lifecycle state document contains an oversized string.");
    }
    return;
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_LIFECYCLE_ARRAY_LENGTH) {
      throw new Error("Lifecycle state document exceeds the bounded entry count.");
    }
    for (const entry of value) {
      countBoundedJson(entry, depth + 1);
    }
    return;
  }
  if (!isRecord(value)) {
    throw new Error("Lifecycle state document contains an unsupported JSON value.");
  }
  const keys = Object.keys(value);
  if (keys.length > MAX_LIFECYCLE_OBJECT_KEYS) {
    throw new Error("Lifecycle state document exceeds the bounded key count.");
  }
  for (const key of keys) {
    if (key.length > MAX_LIFECYCLE_STRING_CHARS) {
      throw new Error("Lifecycle state document contains an oversized key.");
    }
    countBoundedJson(value[key], depth + 1);
  }
}

function parseSchemaNumericVersion(schemaVersion: string): number | null {
  const match = /\.v(\d+)$/u.exec(schemaVersion);
  if (!match) {
    return null;
  }
  const numeric = Number(match[1]);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : null;
}

function classifyParsedDocument(
  value: unknown,
  policy: LifecycleDocumentPolicy,
): Pick<LifecycleDocumentInspection, "classification" | "schemaVersion" | "numericVersion"> {
  if (!isRecord(value)) {
    return { classification: "corrupt", schemaVersion: null, numericVersion: null };
  }
  const schemaVersion = typeof value.schemaVersion === "string" ? value.schemaVersion : null;
  const numericVersion = typeof value.version === "number" && Number.isInteger(value.version) ? value.version : null;
  if (schemaVersion === policy.currentSchemaVersion && numericVersion === policy.currentVersion) {
    return { classification: "current", schemaVersion, numericVersion };
  }
  if (schemaVersion) {
    const schemaNumeric = parseSchemaNumericVersion(schemaVersion);
    if (schemaNumeric !== null && schemaNumeric > policy.currentVersion) {
      return { classification: "unsupported-new", schemaVersion, numericVersion: schemaNumeric };
    }
    if (schemaNumeric !== null && schemaNumeric < policy.legacyVersion) {
      return { classification: "unsupported-old", schemaVersion, numericVersion: schemaNumeric };
    }
    if (schemaNumeric === policy.legacyVersion || schemaVersion.endsWith(`.v${policy.legacyVersion}`)) {
      return { classification: "legacy", schemaVersion, numericVersion: schemaNumeric ?? policy.legacyVersion };
    }
    if (schemaNumeric === policy.currentVersion && schemaVersion !== policy.currentSchemaVersion) {
      return { classification: "corrupt", schemaVersion, numericVersion: schemaNumeric };
    }
  }
  if (numericVersion !== null && numericVersion > policy.currentVersion) {
    return { classification: "unsupported-new", schemaVersion, numericVersion };
  }
  if (numericVersion !== null && numericVersion < policy.legacyVersion) {
    return { classification: "unsupported-old", schemaVersion, numericVersion };
  }
  if (numericVersion === policy.legacyVersion) {
    return { classification: "legacy", schemaVersion, numericVersion };
  }
  if (policy.legacyUnversioned && numericVersion === null && schemaVersion === null) {
    return { classification: "legacy", schemaVersion: null, numericVersion: policy.legacyVersion };
  }
  return { classification: "corrupt", schemaVersion, numericVersion };
}

async function readExactRegularFile(
  workspaceRoot: string,
  filePath: string,
  role: LifecycleArtifactRole,
  kind: LifecycleDocumentKind,
  maxBytes: number,
): Promise<{ classification: "missing" } | { classification: "current-bytes"; bytes: Buffer }> {
  const before = await assertSafeLifecycleArtifact(workspaceRoot, filePath, role, kind, maxBytes);
  if (!before) {
    return { classification: "missing" };
  }
  let handle;
  try {
    handle = await open(filePath, exclusiveReadFlags());
  } catch (error) {
    if (isNodeError(error) && (error.code === "ELOOP" || error.code === "EMLINK")) {
      fail("redirected", kind, filePath, `Lifecycle ${role} file is redirected.`);
    }
    throw error;
  }
  try {
    const afterOpen = await handle.stat();
    if (!afterOpen.isFile() || afterOpen.size !== before.size) {
      fail("redirected", kind, filePath, `Lifecycle ${role} file identity changed while opening.`);
    }
    if (afterOpen.size > maxBytes) {
      fail("oversized", kind, filePath, `Lifecycle ${role} file exceeds the bounded size.`);
    }
    const bytes = await handle.readFile();
    if (bytes.length !== before.size) {
      fail("corrupt", kind, filePath, `Lifecycle ${role} file length changed while reading.`);
    }
    return { classification: "current-bytes", bytes };
  } finally {
    await handle.close();
  }
}

function parseBoundedJson(bytes: Buffer, safePath: string, kind: LifecycleDocumentKind): unknown {
  if (bytes.length === 0 || bytes.length > MAX_LIFECYCLE_DOCUMENT_BYTES) {
    fail("oversized", kind, safePath, "Lifecycle state document is empty or oversized.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    fail("corrupt", kind, safePath, "Lifecycle state document is not valid JSON.");
  }
  try {
    countBoundedJson(parsed, 0);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lifecycle state document is structurally abusive.";
    if (message.includes("oversized") || message.includes("bounded")) {
      fail("oversized", kind, safePath, message);
    }
    fail("corrupt", kind, safePath, message);
  }
  return parsed;
}

const WINDOWS_REPLACE_RETRY_MS = 20;
const WINDOWS_REPLACE_TIMEOUT_MS = 1_000;

function isRetryableReplaceError(error: unknown): boolean {
  return isNodeError(error)
    && (error.code === "EPERM" || error.code === "EACCES" || error.code === "EEXIST");
}

/**
 * Commits a verified temp file onto the destination. Windows cannot always
 * rename over a destination that is briefly in use, so the replace retries
 * after removing the destination when POSIX atomic replace is unavailable.
 */
async function commitRenamedFile(tempPath: string, destinationPath: string): Promise<void> {
  if (process.platform !== "win32") {
    await rename(tempPath, destinationPath);
    return;
  }
  const deadline = Date.now() + WINDOWS_REPLACE_TIMEOUT_MS;
  let lastError: unknown;
  while (Date.now() <= deadline) {
    try {
      await rename(tempPath, destinationPath);
      return;
    } catch (error) {
      if (!isRetryableReplaceError(error)) {
        throw error;
      }
      lastError = error;
      await rm(destinationPath, { force: true }).catch(() => undefined);
      await new Promise((resolve) => {
        setTimeout(resolve, WINDOWS_REPLACE_RETRY_MS);
      });
    }
  }
  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error("Lifecycle state file could not be replaced.");
}

async function writeExclusiveRegularFile(
  workspaceRoot: string,
  filePath: string,
  contents: Buffer,
  role: LifecycleArtifactRole,
  kind: LifecycleDocumentKind,
): Promise<void> {
  await assertSafeLifecycleArtifact(workspaceRoot, filePath, role, kind);
  let handle;
  try {
    handle = await open(filePath, exclusiveWriteFlags(), 0o600);
  } catch (error) {
    if (isNodeError(error) && (error.code === "ELOOP" || error.code === "EMLINK")) {
      fail("redirected", kind, filePath, `Lifecycle ${role} file is redirected.`);
    }
    throw error;
  }
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await chmod(filePath, 0o600);
  } catch {
    // Windows ACLs remain inherited; POSIX 0600 is enforced where the OS honors it.
  }
}

async function replaceRegularFile(
  workspaceRoot: string,
  destinationPath: string,
  contents: Buffer,
  kind: LifecycleDocumentKind,
  role: LifecycleArtifactRole,
): Promise<void> {
  const existing = await assertSafeLifecycleArtifact(workspaceRoot, destinationPath, role, kind);
  const tempPath = `${destinationPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeExclusiveRegularFile(workspaceRoot, tempPath, contents, "temp", kind);
    const tempInfo = await lstat(tempPath);
    if (!tempInfo.isFile() || isRedirectedOrSpecialFile(tempInfo)) {
      fail("redirected", kind, tempPath, "Lifecycle temp file became redirected before replace.");
    }
    if (existing) {
      await assertSafeLifecycleArtifact(workspaceRoot, destinationPath, role, kind);
    }
    await commitRenamedFile(tempPath, destinationPath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
  if (process.platform !== "win32") {
    const directory = await open(path.dirname(destinationPath), constants.O_RDONLY);
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
  try {
    await chmod(destinationPath, 0o600);
  } catch {
    // Best-effort owner-only mode; see Windows ACL note in process-ownership docs.
  }
}

async function readParsedCandidate(
  workspaceRoot: string,
  filePath: string,
  role: LifecycleArtifactRole,
  policy: LifecycleDocumentPolicy,
): Promise<{ classification: LifecycleStateClassification; value: unknown | null; schemaVersion: string | null; numericVersion: number | null }> {
  try {
    const read = await readExactRegularFile(
      workspaceRoot,
      filePath,
      role,
      policy.kind,
      MAX_LIFECYCLE_DOCUMENT_BYTES,
    );
    if (read.classification === "missing") {
      return { classification: "missing", value: null, schemaVersion: null, numericVersion: null };
    }
    const parsed = parseBoundedJson(read.bytes, filePath, policy.kind);
    const classified = classifyParsedDocument(parsed, policy);
    return { ...classified, value: parsed };
  } catch (error) {
    if (error instanceof LifecycleStateError) {
      return {
        classification: error.code,
        value: null,
        schemaVersion: null,
        numericVersion: null,
      };
    }
    return { classification: "corrupt", value: null, schemaVersion: null, numericVersion: null };
  }
}

function inspectionFrom(
  policy: LifecycleDocumentPolicy,
  classification: LifecycleStateClassification,
  schemaVersion: string | null,
  numericVersion: number | null,
  safePath: string,
  recoveredFromBackup: boolean,
): LifecycleDocumentInspection {
  return {
    kind: policy.kind,
    classification,
    schemaVersion,
    numericVersion,
    safePath,
    recoveredFromBackup,
  };
}

async function readMigrationJournal(
  workspaceRoot: string,
  policy: LifecycleDocumentPolicy,
  documentPath: string,
): Promise<LifecycleMigrationJournal | null> {
  const journalPath = siblingPath(documentPath, migrationJournalFileName(policy));
  const read = await readParsedCandidate(workspaceRoot, journalPath, "journal", policy);
  if (read.classification === "missing" || !isRecord(read.value)) {
    return null;
  }
  const value = read.value;
  if (
    value.schemaVersion !== LIFECYCLE_MIGRATION_SCHEMA_VERSION
    || value.kind !== policy.kind
    || value.fromVersion !== policy.legacyVersion
    || value.toVersion !== policy.currentVersion
    || (value.phase !== "backup_written" && value.phase !== "candidate_validated")
    || typeof value.startedAt !== "string"
    || typeof value.backupFileName !== "string"
    || typeof value.candidateFileName !== "string"
  ) {
    return null;
  }
  if (
    value.backupFileName !== migrationBackupFileName(policy)
    || value.candidateFileName !== `${documentFileName(policy)}.migrate.tmp`
  ) {
    return null;
  }
  return {
    schemaVersion: LIFECYCLE_MIGRATION_SCHEMA_VERSION,
    kind: policy.kind,
    fromVersion: policy.legacyVersion,
    toVersion: policy.currentVersion,
    phase: value.phase,
    startedAt: value.startedAt,
    backupFileName: value.backupFileName,
    candidateFileName: value.candidateFileName,
  };
}

async function writeMigrationJournal(
  workspaceRoot: string,
  policy: LifecycleDocumentPolicy,
  documentPath: string,
  journal: LifecycleMigrationJournal,
): Promise<void> {
  const journalPath = siblingPath(documentPath, migrationJournalFileName(policy));
  await rm(journalPath, { force: true }).catch(() => undefined);
  await replaceRegularFile(
    workspaceRoot,
    journalPath,
    Buffer.from(`${JSON.stringify(journal, null, 2)}\n`, "utf8"),
    policy.kind,
    "journal",
  );
}

async function removeMigrationResidue(
  workspaceRoot: string,
  policy: LifecycleDocumentPolicy,
  documentPath: string,
): Promise<void> {
  const journalPath = siblingPath(documentPath, migrationJournalFileName(policy));
  const candidatePath = siblingPath(documentPath, `${documentFileName(policy)}.migrate.tmp`);
  await assertSafeLifecycleArtifact(workspaceRoot, journalPath, "journal", policy.kind).catch(() => undefined);
  await assertSafeLifecycleArtifact(workspaceRoot, candidatePath, "temp", policy.kind).catch(() => undefined);
  await rm(journalPath, { force: true }).catch(() => undefined);
  await rm(candidatePath, { force: true }).catch(() => undefined);
}

async function copyVerifiedPrimaryToMigrationBackup(
  workspaceRoot: string,
  policy: LifecycleDocumentPolicy,
  documentPath: string,
): Promise<void> {
  const read = await readExactRegularFile(
    workspaceRoot,
    documentPath,
    "registry",
    policy.kind,
    MAX_LIFECYCLE_DOCUMENT_BYTES,
  );
  if (read.classification === "missing") {
    fail("missing", policy.kind, documentPath, "Cannot backup a missing lifecycle document.");
  }
  const backupPath = siblingPath(documentPath, migrationBackupFileName(policy));
  await assertSafeLifecycleArtifact(workspaceRoot, backupPath, "backup", policy.kind);
  await replaceRegularFile(workspaceRoot, backupPath, read.bytes, policy.kind, "backup");
}

/**
 * Completes or rolls forward an interrupted vN→vN+1 replacement without
 * silently downgrading a newer primary document.
 */
export async function recoverInterruptedLifecycleMigration<T>(
  workspaceRoot: string,
  policy: LifecycleDocumentPolicy,
  parsers: {
    parseCurrent: (value: unknown) => T | null;
    parseLegacy: (value: unknown) => T | null;
    serialize: (document: T) => unknown;
  },
): Promise<LifecycleDocumentInspection | null> {
  await resolveVerifiedStateDirectory(workspaceRoot, policy);
  const documentPath = getLifecycleDocumentPath(workspaceRoot, policy);
  const journal = await readMigrationJournal(workspaceRoot, policy, documentPath);
  if (!journal) {
    return null;
  }
  const primary = await readParsedCandidate(workspaceRoot, documentPath, "registry", policy);
  if (primary.classification === "unsupported-new") {
    fail(
      "unsupported-new",
      policy.kind,
      documentPath,
      "Interrupted migration cannot replace unsupported newer lifecycle state.",
    );
  }
  if (primary.classification === "current" && primary.value && parsers.parseCurrent(primary.value)) {
    await removeMigrationResidue(workspaceRoot, policy, documentPath);
    return inspectionFrom(policy, "current", policy.currentSchemaVersion, policy.currentVersion, documentPath, false);
  }
  const backupPath = siblingPath(documentPath, journal.backupFileName);
  const backup = await readParsedCandidate(workspaceRoot, backupPath, "backup", policy);
  const legacySource = backup.classification === "legacy" && backup.value
    ? backup.value
    : primary.classification === "legacy" && primary.value
      ? primary.value
      : null;
  if (!legacySource) {
    fail(
      "migration-interrupted",
      policy.kind,
      documentPath,
      "Interrupted lifecycle migration cannot recover a verified legacy document.",
    );
  }
  const migrated = parsers.parseLegacy(legacySource);
  if (!migrated) {
    fail("corrupt", policy.kind, backupPath, "Pre-migration lifecycle backup is not a verified legacy document.");
  }
  const serialized = Buffer.from(`${JSON.stringify(parsers.serialize(migrated), null, 2)}\n`, "utf8");
  const parsedCandidate = parseBoundedJson(serialized, documentPath, policy.kind);
  if (!parsers.parseCurrent(parsedCandidate)) {
    fail("corrupt", policy.kind, documentPath, "Migrated lifecycle document failed validation before replace.");
  }
  const candidatePath = siblingPath(documentPath, journal.candidateFileName);
  await rm(candidatePath, { force: true }).catch(() => undefined);
  await replaceRegularFile(workspaceRoot, candidatePath, serialized, policy.kind, "temp");
  await writeMigrationJournal(workspaceRoot, policy, documentPath, {
    ...journal,
    phase: "candidate_validated",
  });
  await commitRenamedFile(candidatePath, documentPath);
  await removeMigrationResidue(workspaceRoot, policy, documentPath);
  return inspectionFrom(policy, "current", policy.currentSchemaVersion, policy.currentVersion, documentPath, true);
}

async function migrateLegacyDocument<T>(
  workspaceRoot: string,
  policy: LifecycleDocumentPolicy,
  legacyValue: unknown,
  parsers: {
    parseCurrent: (value: unknown) => T | null;
    parseLegacy: (value: unknown) => T | null;
    serialize: (document: T) => unknown;
  },
): Promise<T> {
  const documentPath = getLifecycleDocumentPath(workspaceRoot, policy);
  const migrated = parsers.parseLegacy(legacyValue);
  if (!migrated) {
    fail("corrupt", policy.kind, documentPath, "Legacy lifecycle document failed migration validation.");
  }
  const serialized = Buffer.from(`${JSON.stringify(parsers.serialize(migrated), null, 2)}\n`, "utf8");
  const parsedCandidate = parseBoundedJson(serialized, documentPath, policy.kind);
  if (!parsers.parseCurrent(parsedCandidate)) {
    fail("corrupt", policy.kind, documentPath, "Migrated lifecycle document failed validation before replace.");
  }
  const startedAt = new Date().toISOString();
  await copyVerifiedPrimaryToMigrationBackup(workspaceRoot, policy, documentPath);
  await writeMigrationJournal(workspaceRoot, policy, documentPath, {
    schemaVersion: LIFECYCLE_MIGRATION_SCHEMA_VERSION,
    kind: policy.kind,
    fromVersion: policy.legacyVersion,
    toVersion: policy.currentVersion,
    phase: "backup_written",
    startedAt,
    backupFileName: migrationBackupFileName(policy),
    candidateFileName: `${documentFileName(policy)}.migrate.tmp`,
  });
  const candidatePath = siblingPath(documentPath, `${documentFileName(policy)}.migrate.tmp`);
  await replaceRegularFile(workspaceRoot, candidatePath, serialized, policy.kind, "temp");
  await writeMigrationJournal(workspaceRoot, policy, documentPath, {
    schemaVersion: LIFECYCLE_MIGRATION_SCHEMA_VERSION,
    kind: policy.kind,
    fromVersion: policy.legacyVersion,
    toVersion: policy.currentVersion,
    phase: "candidate_validated",
    startedAt,
    backupFileName: migrationBackupFileName(policy),
    candidateFileName: `${documentFileName(policy)}.migrate.tmp`,
  });
  await commitRenamedFile(candidatePath, documentPath);
  await removeMigrationResidue(workspaceRoot, policy, documentPath);
  return migrated;
}

/**
 * Verifies existing ancestors of the document without creating directories.
 * Returns `missing` when the parent does not exist yet.
 */
async function inspectStateDirectory(
  workspaceRoot: string,
  policy: LifecycleDocumentPolicy,
): Promise<"ok" | "missing" | "redirected"> {
  const documentPath = getLifecycleDocumentPath(workspaceRoot, policy);
  const stateDirectory = path.dirname(documentPath);
  const root = path.resolve(workspaceRoot);
  const relative = path.relative(root, stateDirectory);
  let current = root;
  const rootInfo = await lstatIfPresent(root);
  if (!rootInfo) {
    return "missing";
  }
  if (!rootInfo.isDirectory()) {
    return "redirected";
  }
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const info = await lstatIfPresent(current);
    if (!info) {
      return "missing";
    }
    if (!info.isDirectory() || isRedirectedOrSpecialFile(info)) {
      return "redirected";
    }
  }
  return "ok";
}

export async function inspectLifecycleDocument(
  workspaceRoot: string,
  policy: LifecycleDocumentPolicy,
): Promise<LifecycleDocumentInspection> {
  const documentPath = getLifecycleDocumentPath(workspaceRoot, policy);
  const directoryStatus = await inspectStateDirectory(workspaceRoot, policy);
  if (directoryStatus === "missing") {
    return inspectionFrom(policy, "missing", null, null, documentPath, false);
  }
  if (directoryStatus === "redirected") {
    return inspectionFrom(policy, "redirected", null, null, documentPath, false);
  }
  const journal = await readMigrationJournal(workspaceRoot, policy, documentPath);
  if (journal) {
    const primary = await readParsedCandidate(workspaceRoot, documentPath, "registry", policy);
    if (primary.classification === "current") {
      return inspectionFrom(policy, "current", primary.schemaVersion, primary.numericVersion, documentPath, false);
    }
    if (primary.classification === "unsupported-new") {
      return inspectionFrom(
        policy,
        "unsupported-new",
        primary.schemaVersion,
        primary.numericVersion,
        documentPath,
        false,
      );
    }
    return inspectionFrom(policy, "migration-interrupted", primary.schemaVersion, primary.numericVersion, documentPath, false);
  }
  const primary = await readParsedCandidate(workspaceRoot, documentPath, "registry", policy);
  if (primary.classification !== "missing" && primary.classification !== "corrupt") {
    return inspectionFrom(
      policy,
      primary.classification,
      primary.schemaVersion,
      primary.numericVersion,
      documentPath,
      false,
    );
  }
  const crashBackup = await readParsedCandidate(
    workspaceRoot,
    siblingPath(documentPath, backupFileName(policy)),
    "backup",
    policy,
  );
  if (crashBackup.classification === "current" || crashBackup.classification === "legacy") {
    return inspectionFrom(
      policy,
      crashBackup.classification,
      crashBackup.schemaVersion,
      crashBackup.numericVersion,
      documentPath,
      true,
    );
  }
  const migrationBackup = await readParsedCandidate(
    workspaceRoot,
    siblingPath(documentPath, migrationBackupFileName(policy)),
    "backup",
    policy,
  );
  if (migrationBackup.classification === "legacy" || migrationBackup.classification === "current") {
    return inspectionFrom(
      policy,
      migrationBackup.classification,
      migrationBackup.schemaVersion,
      migrationBackup.numericVersion,
      documentPath,
      true,
    );
  }
  return inspectionFrom(policy, primary.classification, primary.schemaVersion, primary.numericVersion, documentPath, false);
}

export async function inspectWorkspaceLifecycleDocuments(
  workspaceRoot: string,
): Promise<readonly LifecycleDocumentInspection[]> {
  const inspections: LifecycleDocumentInspection[] = [];
  for (const policy of WORKSPACE_LIFECYCLE_POLICIES) {
    inspections.push(await inspectLifecycleDocument(workspaceRoot, policy));
  }
  return inspections;
}

export async function readLifecycleDocument<T>(
  workspaceRoot: string,
  policy: LifecycleDocumentPolicy,
  parsers: {
    parseCurrent: (value: unknown) => T | null;
    parseLegacy: (value: unknown) => T | null;
    serialize?: (document: T) => unknown;
  },
): Promise<LifecycleReadResult<T>> {
  await resolveVerifiedStateDirectory(workspaceRoot, policy);
  const documentPath = getLifecycleDocumentPath(workspaceRoot, policy);
  const serialize = parsers.serialize ?? ((document: T) => document);
  const recovered = await recoverInterruptedLifecycleMigration(workspaceRoot, policy, {
    parseCurrent: parsers.parseCurrent,
    parseLegacy: parsers.parseLegacy,
    serialize,
  }).catch((error: unknown) => {
    if (error instanceof LifecycleStateError) {
      throw error;
    }
    return null;
  });
  if (recovered && recovered.classification === "unsupported-new") {
    fail("unsupported-new", policy.kind, documentPath, "Newer lifecycle state is preserved and cannot be read as current.");
  }

  const tryParse = (
    candidate: { classification: LifecycleStateClassification; value: unknown | null; schemaVersion: string | null; numericVersion: number | null },
    recoveredFromBackup: boolean,
  ): LifecycleReadResult<T> | null => {
    if (candidate.classification === "unsupported-new") {
      fail(
        "unsupported-new",
        policy.kind,
        documentPath,
        "Unsupported newer lifecycle state is preserved and blocks unsafe mutation.",
      );
    }
    if (candidate.classification === "unsupported-old") {
      fail(
        "unsupported-old",
        policy.kind,
        documentPath,
        "Unsupported older lifecycle state is preserved and blocks unsafe mutation.",
      );
    }
    if (candidate.classification === "redirected" || candidate.classification === "oversized") {
      fail(candidate.classification, policy.kind, documentPath, "Lifecycle state file is redirected, special, or oversized.");
    }
    if (!candidate.value) {
      return null;
    }
    if (candidate.classification === "current") {
      const document = parsers.parseCurrent(candidate.value);
      if (!document) {
        return null;
      }
      return {
        inspection: inspectionFrom(
          policy,
          "current",
          candidate.schemaVersion,
          candidate.numericVersion,
          documentPath,
          recoveredFromBackup,
        ),
        document,
      };
    }
    if (candidate.classification === "legacy") {
      const document = parsers.parseLegacy(candidate.value);
      if (!document) {
        return null;
      }
      return {
        inspection: inspectionFrom(
          policy,
          "legacy",
          candidate.schemaVersion,
          candidate.numericVersion,
          documentPath,
          recoveredFromBackup,
        ),
        document,
      };
    }
    return null;
  };

  const primary = await readParsedCandidate(workspaceRoot, documentPath, "registry", policy);
  const parsedPrimary = tryParse(primary, false);
  if (parsedPrimary) {
    return parsedPrimary;
  }
  if (primary.classification === "missing") {
    return {
      inspection: inspectionFrom(policy, "missing", null, null, documentPath, false),
      document: null,
    };
  }
  const crashBackup = await readParsedCandidate(
    workspaceRoot,
    siblingPath(documentPath, backupFileName(policy)),
    "backup",
    policy,
  );
  const parsedCrash = tryParse(crashBackup, true);
  if (parsedCrash) {
    return parsedCrash;
  }
  const migrationBackup = await readParsedCandidate(
    workspaceRoot,
    siblingPath(documentPath, migrationBackupFileName(policy)),
    "backup",
    policy,
  );
  const parsedMigration = tryParse(migrationBackup, true);
  if (parsedMigration) {
    return parsedMigration;
  }
  return {
    inspection: inspectionFrom(
      policy,
      "corrupt",
      primary.schemaVersion,
      primary.numericVersion,
      documentPath,
      false,
    ),
    document: null,
  };
}

export async function writeLifecycleDocument<T>(
  workspaceRoot: string,
  policy: LifecycleDocumentPolicy,
  document: T,
  parsers: {
    parseCurrent: (value: unknown) => T | null;
    parseLegacy: (value: unknown) => T | null;
    serialize: (document: T) => unknown;
  },
): Promise<void> {
  await resolveVerifiedStateDirectory(workspaceRoot, policy);
  const documentPath = getLifecycleDocumentPath(workspaceRoot, policy);
  await recoverInterruptedLifecycleMigration(workspaceRoot, policy, parsers);
  const primary = await readParsedCandidate(workspaceRoot, documentPath, "registry", policy);
  if (primary.classification === "unsupported-new") {
    fail(
      "unsupported-new",
      policy.kind,
      documentPath,
      "Refusing to downgrade or replace unsupported newer lifecycle state.",
    );
  }
  if (primary.classification === "unsupported-old") {
    fail(
      "unsupported-old",
      policy.kind,
      documentPath,
      "Refusing to mutate unsupported older lifecycle state.",
    );
  }
  if (primary.classification === "redirected") {
    fail("redirected", policy.kind, documentPath, "Refusing to write through a redirected lifecycle document.");
  }
  const serialized = Buffer.from(`${JSON.stringify(parsers.serialize(document), null, 2)}\n`, "utf8");
  if (serialized.length === 0 || serialized.length > MAX_LIFECYCLE_DOCUMENT_BYTES) {
    fail("oversized", policy.kind, documentPath, "Lifecycle state payload exceeds the bounded size.");
  }
  const parsedCandidate = parseBoundedJson(serialized, documentPath, policy.kind);
  if (!parsers.parseCurrent(parsedCandidate)) {
    fail("corrupt", policy.kind, documentPath, "Lifecycle state failed validation before replace.");
  }
  if (primary.classification === "legacy" && primary.value) {
    const startedAt = new Date().toISOString();
    await copyVerifiedPrimaryToMigrationBackup(workspaceRoot, policy, documentPath);
    await writeMigrationJournal(workspaceRoot, policy, documentPath, {
      schemaVersion: LIFECYCLE_MIGRATION_SCHEMA_VERSION,
      kind: policy.kind,
      fromVersion: policy.legacyVersion,
      toVersion: policy.currentVersion,
      phase: "backup_written",
      startedAt,
      backupFileName: migrationBackupFileName(policy),
      candidateFileName: `${documentFileName(policy)}.migrate.tmp`,
    });
    const candidatePath = siblingPath(documentPath, `${documentFileName(policy)}.migrate.tmp`);
    await replaceRegularFile(workspaceRoot, candidatePath, serialized, policy.kind, "temp");
    await writeMigrationJournal(workspaceRoot, policy, documentPath, {
      schemaVersion: LIFECYCLE_MIGRATION_SCHEMA_VERSION,
      kind: policy.kind,
      fromVersion: policy.legacyVersion,
      toVersion: policy.currentVersion,
      phase: "candidate_validated",
      startedAt,
      backupFileName: migrationBackupFileName(policy),
      candidateFileName: `${documentFileName(policy)}.migrate.tmp`,
    });
    await commitRenamedFile(candidatePath, documentPath);
    await removeMigrationResidue(workspaceRoot, policy, documentPath);
    return;
  }
  if (primary.classification === "current") {
    const crashBackupPath = siblingPath(documentPath, backupFileName(policy));
    const currentBytes = await readExactRegularFile(
      workspaceRoot,
      documentPath,
      "registry",
      policy.kind,
      MAX_LIFECYCLE_DOCUMENT_BYTES,
    );
    if (currentBytes.classification === "current-bytes") {
      await replaceRegularFile(workspaceRoot, crashBackupPath, currentBytes.bytes, policy.kind, "backup");
    }
  }
  await replaceRegularFile(workspaceRoot, documentPath, serialized, policy.kind, "registry");
}

export function isLifecycleStateError(error: unknown): error is LifecycleStateError {
  return error instanceof LifecycleStateError && isLifecycleClassification(error.code);
}

/**
 * Maps persistence classifications onto doctor-safe outcomes. Malformed,
 * redirected, and forward-version state never become ownership evidence.
 */
export function doctorClassificationForPersistence(
  inspections: readonly LifecycleDocumentInspection[],
): "state_corrupt" | "migration_required" | null {
  if (inspections.some((entry) =>
    entry.classification === "corrupt"
    || entry.classification === "redirected"
    || entry.classification === "oversized"
    || entry.classification === "unsupported-new"
    || entry.classification === "unsupported-old"
    || entry.classification === "migration-interrupted"
  )) {
    return "state_corrupt";
  }
  if (inspections.some((entry) => entry.classification === "legacy")) {
    return "migration_required";
  }
  return null;
}
