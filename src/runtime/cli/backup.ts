import path from "node:path";
import { mkdir, readdir, stat } from "node:fs/promises";
import AdmZip from "adm-zip";
import type { ServiceManifest } from "../../contracts/service.js";
import { discoverServices } from "../discovery/discoverServices.js";
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
  reasons: string[];
  currentVersion: string | null;
  backupVersion: string | null;
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

async function readArchiveManifest(archivePath: string): Promise<WorkspaceBackupManifest | null> {
  const zip = new AdmZip(archivePath);
  const manifestEntry = zip.getEntry("backup-manifest.json");
  if (!manifestEntry) {
    return null;
  }

  return JSON.parse(manifestEntry.getData().toString("utf8")) as WorkspaceBackupManifest;
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

function buildServicePlan(backup: WorkspaceBackupManifest, current: Awaited<ReturnType<typeof discoverServices>>): RestorePlanServiceChange[] {
  const currentById = new Map(current.map((service) => [service.manifest.id, service]));

  return backup.services.map((backupService) => {
    const currentService = currentById.get(backupService.serviceId);
    const reasons: string[] = [];

    if (!currentService) {
      reasons.push("service_missing_currently");
      return {
        serviceId: backupService.serviceId,
        action: "create",
        reasons,
        currentVersion: null,
        backupVersion: backupService.version,
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
      reasons,
      currentVersion,
      backupVersion: backupService.version,
    };
  });
}

export async function planWorkspaceRestore(options: Omit<BackupCliOptions, "action"> & { archivePath: string }): Promise<BackupRestorePlanResult> {
  const config = await ensureRuntimeConfig(resolveRuntimeConfig(options));
  const backup = await readArchiveManifest(options.archivePath);
  const currentServices = await discoverServices(config.servicesRoot);
  const blocked: string[] = [];

  if (!backup) {
    blocked.push("backup_manifest_missing");
  } else if (backup.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    blocked.push("unsupported_backup_schema");
  }

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
    services: backup ? buildServicePlan(backup, currentServices) : [],
    blocked,
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
