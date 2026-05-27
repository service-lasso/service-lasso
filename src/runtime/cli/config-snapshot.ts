import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { ServiceManifest } from "../../contracts/service.js";
import { discoverServices } from "../discovery/discoverServices.js";
import { ensureRuntimeConfig, resolveRuntimeConfig, type RuntimeConfigOptions } from "../config.js";

const CONFIG_SNAPSHOT_SCHEMA_VERSION = "service-lasso.config-snapshot.v1";
const REDACTED = "[redacted]";

export type ConfigSnapshotCliAction = "export" | "import";

export interface ConfigSnapshotCliOptions extends RuntimeConfigOptions {
  action: ConfigSnapshotCliAction;
  serviceId?: string;
  snapshotPath?: string;
}

export interface ConfigSnapshotServiceEntry {
  serviceId: string;
  name: string;
  version: string | null;
  serviceRoot: string;
  manifestPath: string;
  manifest: unknown;
}

export interface ConfigSnapshotDocument {
  schemaVersion: typeof CONFIG_SNAPSHOT_SCHEMA_VERSION;
  createdAt: string;
  runtimeVersion: string;
  policy: {
    runtimeState: "excluded";
    logs: "excluded";
    rawSecrets: "redacted";
    machineLocalPaths: "excluded";
    importDefault: "dry-run";
  };
  serviceCount: number;
  services: ConfigSnapshotServiceEntry[];
}

export interface ConfigSnapshotExportResult {
  action: "export";
  ok: true;
  snapshotPath: string;
  snapshot: ConfigSnapshotDocument;
}

export interface ConfigSnapshotImportServicePlan {
  serviceId: string;
  action: "unchanged" | "would_create" | "would_update";
  reasons: string[];
  currentVersion: string | null;
  snapshotVersion: string | null;
}

export interface ConfigSnapshotImportResult {
  action: "import";
  ok: boolean;
  dryRun: true;
  mutated: false;
  snapshotPath: string;
  schemaVersion: string;
  serviceCount: {
    current: number;
    snapshot: number;
  };
  services: ConfigSnapshotImportServicePlan[];
  blocked: string[];
}

export type ConfigSnapshotCliResult = ConfigSnapshotExportResult | ConfigSnapshotImportResult;

function nowIso(): string {
  return new Date().toISOString();
}

function safeSnapshotTimestamp(value: string): string {
  return value.replace(/[:.]/g, "-");
}

function relativePortable(root: string, candidate: string): string {
  const relativePath = path.relative(root, candidate);
  return relativePath.split(path.sep).join("/");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSensitiveKey(key: string): boolean {
  return /secret|password|passwd|token|credential|private[_-]?key|api[_-]?key|cookie|dsn|content|stdout|stderr/i.test(key);
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

function redactEnvMap(value: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!value) {
    return undefined;
  }

  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, REDACTED]));
}

function redactManifest(manifest: ServiceManifest): unknown {
  const redacted = redactValue(manifest) as Record<string, unknown>;
  return {
    ...redacted,
    env: redactEnvMap(manifest.env),
    globalenv: redactEnvMap(manifest.globalenv),
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return "[" + value.map((entry) => stableStringify(entry)).join(",") + "]";
  }

  if (isPlainRecord(value)) {
    return "{" + Object.keys(value)
      .sort()
      .map((key) => JSON.stringify(key) + ":" + stableStringify(value[key]))
      .join(",") + "}";
  }

  return JSON.stringify(value);
}

function isConfigSnapshotDocument(value: unknown): value is ConfigSnapshotDocument {
  return (
    isPlainRecord(value) &&
    value.schemaVersion === CONFIG_SNAPSHOT_SCHEMA_VERSION &&
    Array.isArray(value.services)
  );
}

export async function exportConfigSnapshot(
  options: Omit<ConfigSnapshotCliOptions, "action" | "snapshotPath">,
): Promise<ConfigSnapshotExportResult> {
  const config = await ensureRuntimeConfig(resolveRuntimeConfig(options));
  const services = await discoverServices(config.servicesRoot);
  const selectedServices = options.serviceId
    ? services.filter((service) => service.manifest.id === options.serviceId)
    : services;

  if (options.serviceId && selectedServices.length === 0) {
    throw new Error("Unknown service id: " + options.serviceId + ".");
  }

  const createdAt = nowIso();
  const snapshotRoot = path.join(config.workspaceRoot, "config-snapshots");
  const snapshotPath = path.join(snapshotRoot, "service-lasso-config-snapshot-" + safeSnapshotTimestamp(createdAt) + ".json");
  await mkdir(snapshotRoot, { recursive: true });

  const snapshot: ConfigSnapshotDocument = {
    schemaVersion: CONFIG_SNAPSHOT_SCHEMA_VERSION,
    createdAt,
    runtimeVersion: config.version,
    policy: {
      runtimeState: "excluded",
      logs: "excluded",
      rawSecrets: "redacted",
      machineLocalPaths: "excluded",
      importDefault: "dry-run",
    },
    serviceCount: selectedServices.length,
    services: selectedServices
      .map((service) => ({
        serviceId: service.manifest.id,
        name: service.manifest.name,
        version: service.manifest.version ?? null,
        serviceRoot: relativePortable(config.servicesRoot, service.serviceRoot),
        manifestPath: relativePortable(config.servicesRoot, service.manifestPath),
        manifest: redactManifest(service.manifest),
      }))
      .sort((left, right) => left.serviceId.localeCompare(right.serviceId)),
  };

  await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2) + "\n", "utf8");

  return {
    action: "export",
    ok: true,
    snapshotPath,
    snapshot,
  };
}

function buildImportPlan(snapshot: ConfigSnapshotDocument, current: Awaited<ReturnType<typeof discoverServices>>): ConfigSnapshotImportServicePlan[] {
  const currentById = new Map(current.map((service) => [service.manifest.id, service]));

  return snapshot.services.map((snapshotService) => {
    const currentService = currentById.get(snapshotService.serviceId);
    if (!currentService) {
      return {
        serviceId: snapshotService.serviceId,
        action: "would_create",
        reasons: ["service_missing_currently", "dry_run_only"],
        currentVersion: null,
        snapshotVersion: snapshotService.version,
      };
    }

    const currentManifest = redactManifest(currentService.manifest);
    const reasons: string[] = [];
    if ((currentService.manifest.version ?? null) !== snapshotService.version) {
      reasons.push("version_mismatch");
    }
    if (stableStringify(currentManifest) !== stableStringify(snapshotService.manifest)) {
      reasons.push("manifest_diff");
    }

    return {
      serviceId: snapshotService.serviceId,
      action: reasons.length === 0 ? "unchanged" : "would_update",
      reasons: reasons.length === 0 ? ["matches_snapshot"] : [...reasons, "dry_run_only"],
      currentVersion: currentService.manifest.version ?? null,
      snapshotVersion: snapshotService.version,
    };
  });
}

export async function importConfigSnapshotPlan(
  options: Omit<ConfigSnapshotCliOptions, "action"> & { snapshotPath: string },
): Promise<ConfigSnapshotImportResult> {
  const config = await ensureRuntimeConfig(resolveRuntimeConfig(options));
  const snapshotPath = path.resolve(options.snapshotPath);
  const rawSnapshot = JSON.parse(await readFile(snapshotPath, "utf8")) as unknown;
  const currentServices = await discoverServices(config.servicesRoot);
  const blocked: string[] = [];

  if (!isConfigSnapshotDocument(rawSnapshot)) {
    blocked.push("unsupported_config_snapshot_schema");
  }

  const snapshot = isConfigSnapshotDocument(rawSnapshot) ? rawSnapshot : null;

  return {
    action: "import",
    ok: blocked.length === 0,
    dryRun: true,
    mutated: false,
    snapshotPath,
    schemaVersion: isPlainRecord(rawSnapshot) && typeof rawSnapshot.schemaVersion === "string" ? rawSnapshot.schemaVersion : "unknown",
    serviceCount: {
      current: currentServices.length,
      snapshot: snapshot?.serviceCount ?? 0,
    },
    services: snapshot ? buildImportPlan(snapshot, currentServices) : [],
    blocked,
  };
}

export async function runConfigSnapshotCliAction(options: ConfigSnapshotCliOptions): Promise<ConfigSnapshotCliResult> {
  if (options.action === "export") {
    return await exportConfigSnapshot(options);
  }

  if (!options.snapshotPath) {
    throw new Error("The config-snapshot import command requires a <snapshotPath> argument.");
  }

  return await importConfigSnapshotPlan({
    ...options,
    snapshotPath: options.snapshotPath,
  });
}
