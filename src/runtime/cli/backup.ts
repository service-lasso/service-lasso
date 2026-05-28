import path from "node:path";
import { lstat, mkdir, readdir, stat } from "node:fs/promises";
import AdmZip from "adm-zip";
import type { ServiceManifest } from "../../contracts/service.js";
import { discoverServices } from "../discovery/discoverServices.js";
import { validateServiceManifest } from "../discovery/validateManifest.js";
import { ensureRuntimeConfig, resolveRuntimeConfig } from "../config.js";
import { readStoredState, type StoredStateSnapshot } from "../state/readState.js";

const BACKUP_SCHEMA_VERSION = "service-lasso.workspace-backup.v1";
const REDACTED = "[redacted]";

export type BackupCliAction = "create" | "restore-plan";

export interface BackupCliOptions {
  action: BackupCliAction;
  archivePath?: string;
  servicesRoot?: string;
  workspaceRoot?: string;
  version?: string;
}

export interface BackupServiceLogMetadata {
  paths: string[];
  files: Array<{
    path: string;
    sizeBytes: number;
  }>;
}

export interface BackupServiceEntry {
  serviceId: string;
  name: string;
  version: string | null;
  serviceRoot: string;
  manifestPath: string;
  stateFiles: string[];
  logMetadata: BackupServiceLogMetadata;
}

export interface WorkspaceBackupManifest {
  schemaVersion: typeof BACKUP_SCHEMA_VERSION;
  createdAt: string;
  runtimeVersion: string;
  servicesRoot: string;
  workspaceRoot: string;
  policy: {
    manifests: "redacted";
    state: "redacted";
    logContents: "excluded";
    restore: "plan-only";
  };
  serviceCount: number;
  services: BackupServiceEntry[];
}

export interface BackupCreateResult {
  action: "create";
  ok: true;
  archivePath: string;
  manifest: WorkspaceBackupManifest;
}

export interface RestorePlanServiceChange {
  serviceId: string;
  action: "restore" | "create";
  operation: "overwrite" | "create";
  reasons: string[];
  blocked: string[];
  currentVersion: string | null;
  backupVersion: string | null;
  targetPath: string;
  targetExists: boolean;
  targetKind: "directory" | "file" | "other" | "missing";
  archiveEntries: {
    redactedManifest: boolean;
    logsMetadata: boolean;
    stateFilesExpected: number;
    stateFilesPresent: number;
    missingStateFiles: string[];
  };
  manifestCompatibility: {
    compatible: boolean;
    issues: string[];
  };
}

export interface BackupRestorePlanResult {
  action: "restore-plan";
  ok: boolean;
  archivePath: string;
  schemaVersion: string;
  runtimeVersion: {
    current: string;
    backup: string | null;
    matches: boolean;
  };
  roots: {
    currentServicesRoot: string;
    backupServicesRoot: string | null;
    currentWorkspaceRoot: string;
    backupWorkspaceRoot: string | null;
    servicesRootMatches: boolean;
    workspaceRootMatches: boolean;
  };
  serviceCount: {
    current: number;
    backup: number;
  };
  services: RestorePlanServiceChange[];
  blocked: string[];
  archive: {
    manifestEntry: boolean;
    structureOk: boolean;
    issues: string[];
  };
  mutated: false;
}

export type BackupCliResult = BackupCreateResult | BackupRestorePlanResult;

function nowIso(): string {
  return new Date().toISOString();
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9@._-]/g, "_");
}

function toArchivePath(...segments: string[]): string {
  return segments.join("/");
}

function relativePortable(root: string, candidate: string): string {
  const relativePath = path.relative(root, candidate);
  return relativePath.split(path.sep).join("/");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSensitiveKey(key: string): boolean {
  return /secret|password|token|credential|private[_-]?key|cookie|content|stdout|stderr/i.test(key);
}

function redactValue(value: unknown, parentKey = ""): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (isSensitiveKey(parentKey)) {
    return REDACTED;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry));
  }

  if (isPlainRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, redactValue(entry, key)]),
    );
  }

  return value;
}

function redactManifest(manifest: ServiceManifest): unknown {
  return {
    ...redactValue(manifest) as Record<string, unknown>,
    env: manifest.env ? Object.fromEntries(Object.keys(manifest.env).map((key) => [key, REDACTED])) : undefined,
    globalenv: manifest.globalenv
      ? Object.fromEntries(Object.keys(manifest.globalenv).map((key) => [key, REDACTED]))
      : undefined,
  };
}

function collectRuntimeLogPaths(state: StoredStateSnapshot): string[] {
  const runtime = state.runtime;
  if (!isPlainRecord(runtime) || !isPlainRecord(runtime.logs)) {
    return [];
  }

  return Object.values(runtime.logs).flatMap((value) => typeof value === "string" ? [value] : []);
}

async function listLogFiles(serviceRoot: string, state: StoredStateSnapshot): Promise<BackupServiceLogMetadata> {
  const runtimeLogPaths = collectRuntimeLogPaths(state);
  const logRoots = [path.join(serviceRoot, "logs"), path.join(serviceRoot, ".state", "logs")];
  const files: BackupServiceLogMetadata["files"] = [];

  for (const logRoot of logRoots) {
    let entries;
    try {
      entries = await readdir(logRoot, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }

      const entryPath = path.join(logRoot, entry.name);
      const entryStat = await stat(entryPath);
      files.push({
        path: relativePortable(serviceRoot, entryPath),
        sizeBytes: entryStat.size,
      });
    }
  }

  return {
    paths: runtimeLogPaths,
    files: files.sort((left, right) => left.path.localeCompare(right.path)),
  };
}

function addJson(zip: AdmZip, entryPath: string, value: unknown): void {
  zip.addFile(entryPath, Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8"));
}

function readArchive(archivePath: string): { zip: AdmZip; manifest: WorkspaceBackupManifest | null; issues: string[] } {
  const zip = new AdmZip(archivePath);
  const issues: string[] = [];
  const manifestEntry = zip.getEntry("backup-manifest.json");

  if (!manifestEntry) {
    return { zip, manifest: null, issues };
  }

  try {
    return {
      zip,
      manifest: JSON.parse(manifestEntry.getData().toString("utf8")) as WorkspaceBackupManifest,
      issues,
    };
  } catch {
    issues.push("backup_manifest_invalid_json");
    return { zip, manifest: null, issues };
  }
}

export async function createWorkspaceBackup(options: Omit<BackupCliOptions, "action" | "archivePath">): Promise<BackupCreateResult> {
  const config = await ensureRuntimeConfig(resolveRuntimeConfig(options));
  const createdAt = nowIso();
  const backupRoot = path.join(config.workspaceRoot, "backups");
  await mkdir(backupRoot, { recursive: true });

  const archiveName = "service-lasso-backup-" + createdAt.replace(/[:.]/g, "-") + ".zip";
  const archivePath = path.join(backupRoot, archiveName);
  const services = await discoverServices(config.servicesRoot);
  const zip = new AdmZip();
  const manifestServices: BackupServiceEntry[] = [];

  for (const service of services) {
    const serviceSegment = safeSegment(service.manifest.id);
    const state = await readStoredState(service.serviceRoot);
    const stateEntries = Object.entries(state).filter(([, value]) => value !== null);
    const stateFiles = stateEntries.map(([name]) => name + ".json").sort();
    const logMetadata = await listLogFiles(service.serviceRoot, state);

    manifestServices.push({
      serviceId: service.manifest.id,
      name: service.manifest.name,
      version: service.manifest.version ?? null,
      serviceRoot: relativePortable(config.servicesRoot, service.serviceRoot),
      manifestPath: relativePortable(config.servicesRoot, service.manifestPath),
      stateFiles,
      logMetadata,
    });

    addJson(zip, toArchivePath("services", serviceSegment, "manifest.redacted.json"), redactManifest(service.manifest));
    for (const [name, value] of stateEntries) {
      addJson(zip, toArchivePath("services", serviceSegment, "state", name + ".json"), redactValue(value));
    }
    addJson(zip, toArchivePath("services", serviceSegment, "logs.metadata.json"), logMetadata);
  }

  const manifest: WorkspaceBackupManifest = {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    createdAt,
    runtimeVersion: config.version,
    servicesRoot: config.servicesRoot,
    workspaceRoot: config.workspaceRoot,
    policy: {
      manifests: "redacted",
      state: "redacted",
      logContents: "excluded",
      restore: "plan-only",
    },
    serviceCount: manifestServices.length,
    services: manifestServices.sort((left, right) => left.serviceId.localeCompare(right.serviceId)),
  };

  addJson(zip, "backup-manifest.json", manifest);
  zip.writeZip(archivePath);

  return {
    action: "create",
    ok: true,
    archivePath,
    manifest,
  };
}

function parseArchiveJson(zip: AdmZip, entryPath: string): { ok: true; value: unknown } | { ok: false; issue: string } {
  const entry = zip.getEntry(entryPath);
  if (!entry) {
    return { ok: false, issue: "missing" };
  }

  try {
    return { ok: true, value: JSON.parse(entry.getData().toString("utf8")) as unknown };
  } catch {
    return { ok: false, issue: "invalid_json" };
  }
}

function pathIsInside(root: string, candidate: string): boolean {
  const relativePath = path.relative(root, candidate);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function resolveServiceTargetPath(servicesRoot: string, backupService: BackupServiceEntry): { targetPath: string; escapesRoot: boolean } {
  const serviceRootSegment = backupService.serviceRoot || safeSegment(backupService.serviceId);
  const targetPath = path.resolve(servicesRoot, serviceRootSegment);

  return {
    targetPath,
    escapesRoot: !pathIsInside(path.resolve(servicesRoot), targetPath),
  };
}

async function inspectTargetPath(targetPath: string): Promise<{ exists: boolean; kind: "directory" | "file" | "other" | "missing" }> {
  try {
    const stats = await lstat(targetPath);
    return {
      exists: true,
      kind: stats.isDirectory() ? "directory" : stats.isFile() ? "file" : "other",
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { exists: false, kind: "missing" };
    }
    throw error;
  }
}

function validateBackupServiceManifest(zip: AdmZip, backupService: BackupServiceEntry): RestorePlanServiceChange["manifestCompatibility"] {
  const serviceArchiveRoot = toArchivePath("services", safeSegment(backupService.serviceId));
  const manifestEntryPath = toArchivePath(serviceArchiveRoot, "manifest.redacted.json");
  const parsed = parseArchiveJson(zip, manifestEntryPath);
  const issues: string[] = [];

  if (!parsed.ok) {
    issues.push(parsed.issue === "missing" ? "redacted_manifest_missing" : "redacted_manifest_invalid_json");
    return { compatible: false, issues };
  }

  try {
    const manifest = validateServiceManifest(parsed.value, manifestEntryPath);
    if (manifest.id !== backupService.serviceId) {
      issues.push("manifest_service_id_mismatch");
    }
    if ((manifest.version ?? null) !== backupService.version) {
      issues.push("manifest_version_mismatch");
    }
  } catch {
    issues.push("redacted_manifest_incompatible");
  }

  return {
    compatible: issues.length === 0,
    issues,
  };
}

async function buildServicePlan(
  backup: WorkspaceBackupManifest,
  current: Awaited<ReturnType<typeof discoverServices>>,
  zip: AdmZip,
  servicesRoot: string,
): Promise<RestorePlanServiceChange[]> {
  const currentById = new Map(current.map((service) => [service.manifest.id, service]));
  const seenServiceIds = new Set<string>();

  return await Promise.all(backup.services.map(async (backupService) => {
    const currentService = currentById.get(backupService.serviceId);
    const reasons: string[] = [];
    const blocked: string[] = [];
    const serviceArchiveRoot = toArchivePath("services", safeSegment(backupService.serviceId));
    const manifestEntryPath = toArchivePath(serviceArchiveRoot, "manifest.redacted.json");
    const logsEntryPath = toArchivePath(serviceArchiveRoot, "logs.metadata.json");
    const missingStateFiles = backupService.stateFiles.filter((stateFile) => !zip.getEntry(toArchivePath(serviceArchiveRoot, "state", stateFile)));
    const manifestCompatibility = validateBackupServiceManifest(zip, backupService);
    const target = resolveServiceTargetPath(servicesRoot, backupService);
    const targetState = await inspectTargetPath(target.targetPath);

    if (!backupService.serviceId || backupService.serviceId.trim().length === 0) {
      blocked.push("service_id_missing");
    }
    if (seenServiceIds.has(backupService.serviceId)) {
      blocked.push("duplicate_service_id");
    }
    seenServiceIds.add(backupService.serviceId);

    if (target.escapesRoot) {
      blocked.push("target_path_escapes_services_root");
    }
    if (targetState.exists && targetState.kind !== "directory") {
      blocked.push("target_path_conflict");
    }
    if (!zip.getEntry(manifestEntryPath)) {
      blocked.push("redacted_manifest_missing");
    }
    if (!zip.getEntry(logsEntryPath)) {
      blocked.push("logs_metadata_missing");
    }
    if (missingStateFiles.length > 0) {
      blocked.push("state_file_missing");
    }
    blocked.push(...manifestCompatibility.issues);

    if (!currentService) {
      reasons.push("service_missing_currently");
      return {
        serviceId: backupService.serviceId,
        action: "create",
        operation: "create",
        reasons,
        blocked: Array.from(new Set(blocked)).sort(),
        currentVersion: null,
        backupVersion: backupService.version,
        targetPath: target.targetPath,
        targetExists: targetState.exists,
        targetKind: targetState.kind,
        archiveEntries: {
          redactedManifest: Boolean(zip.getEntry(manifestEntryPath)),
          logsMetadata: Boolean(zip.getEntry(logsEntryPath)),
          stateFilesExpected: backupService.stateFiles.length,
          stateFilesPresent: backupService.stateFiles.length - missingStateFiles.length,
          missingStateFiles,
        },
        manifestCompatibility,
      };
    }

    const currentVersion = currentService.manifest.version ?? null;
    if (currentVersion !== backupService.version) {
      reasons.push("version_mismatch");
    }

    if (relativePortable(path.dirname(currentService.manifestPath), currentService.manifestPath) !== "service.json") {
      reasons.push("manifest_path_unexpected");
    }

    if (reasons.length === 0) {
      reasons.push("would_overwrite_runtime_state");
    }

    return {
      serviceId: backupService.serviceId,
      action: "restore",
      operation: "overwrite",
      reasons,
      blocked: Array.from(new Set(blocked)).sort(),
      currentVersion,
      backupVersion: backupService.version,
      targetPath: target.targetPath,
      targetExists: targetState.exists,
      targetKind: targetState.kind,
      archiveEntries: {
        redactedManifest: Boolean(zip.getEntry(manifestEntryPath)),
        logsMetadata: Boolean(zip.getEntry(logsEntryPath)),
        stateFilesExpected: backupService.stateFiles.length,
        stateFilesPresent: backupService.stateFiles.length - missingStateFiles.length,
        missingStateFiles,
      },
      manifestCompatibility,
    };
  }));
}

export async function planWorkspaceRestore(options: Omit<BackupCliOptions, "action"> & { archivePath: string }): Promise<BackupRestorePlanResult> {
  const config = await ensureRuntimeConfig(resolveRuntimeConfig(options));
  const archive = readArchive(options.archivePath);
  const backup = archive.manifest;
  const currentServices = await discoverServices(config.servicesRoot);
  const blocked: string[] = [...archive.issues];

  if (!backup) {
    blocked.push("backup_manifest_missing");
  } else if (backup.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    blocked.push("unsupported_backup_schema");
  }

  const servicePlans = backup
    ? await buildServicePlan(backup, currentServices, archive.zip, config.servicesRoot)
    : [];
  const serviceBlocked = servicePlans.flatMap((service) => service.blocked.map((entry) => `${service.serviceId}:${entry}`));
  const archiveIssues = Array.from(new Set([...blocked, ...serviceBlocked])).sort();
  blocked.push(...serviceBlocked);

  return {
    action: "restore-plan",
    ok: blocked.length === 0,
    archivePath: path.resolve(options.archivePath),
    schemaVersion: backup?.schemaVersion ?? "unknown",
    runtimeVersion: {
      current: config.version,
      backup: backup?.runtimeVersion ?? null,
      matches: backup?.runtimeVersion === config.version,
    },
    roots: {
      currentServicesRoot: config.servicesRoot,
      backupServicesRoot: backup?.servicesRoot ?? null,
      currentWorkspaceRoot: config.workspaceRoot,
      backupWorkspaceRoot: backup?.workspaceRoot ?? null,
      servicesRootMatches: backup?.servicesRoot === config.servicesRoot,
      workspaceRootMatches: backup?.workspaceRoot === config.workspaceRoot,
    },
    serviceCount: {
      current: currentServices.length,
      backup: backup?.serviceCount ?? 0,
    },
    services: servicePlans,
    blocked: Array.from(new Set(blocked)).sort(),
    archive: {
      manifestEntry: Boolean(archive.zip.getEntry("backup-manifest.json")),
      structureOk: archiveIssues.length === 0,
      issues: archiveIssues,
    },
    mutated: false,
  };
}

export async function runBackupCliAction(options: BackupCliOptions): Promise<BackupCliResult> {
  if (options.action === "create") {
    return await createWorkspaceBackup(options);
  }

  if (!options.archivePath) {
    throw new Error("The backup restore-plan command requires an <archivePath> argument.");
  }

  return await planWorkspaceRestore({
    ...options,
    archivePath: options.archivePath,
  });
}
