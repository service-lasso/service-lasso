import { access, cp, lstat, mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import type {
  ServiceCatalogInstallRequest,
  ServiceCatalogInstallResponse,
  ServiceCatalogInstallResult,
  ServiceCatalogInstallSelection,
} from "../../contracts/api.js";
import type { ServiceManifest } from "../../contracts/service.js";
import { appendAuditEvent } from "../audit/store.js";
import { discoverServices } from "../discovery/discoverServices.js";
import { validateServiceManifest } from "../discovery/validateManifest.js";
import { upsertOperatorInboxItem } from "../operator/inbox.js";
import { listServiceCatalogPackageReleases } from "./service-catalog.js";

export interface InstallServiceCatalogSelectionsOptions {
  servicesRoot: string;
  workspaceRoot: string;
  catalogUrl?: string;
  githubApiBaseUrl?: string;
  actor?: string;
  request: ServiceCatalogInstallRequest;
}

interface ArchiveManifest {
  manifest: ServiceManifest;
  manifestPath: string;
  contentRoot: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function githubHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
  return {
    accept: "application/octet-stream, application/vnd.github+json",
    "user-agent": "service-lasso-core-runtime",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function lstatIfPresent(targetPath: string) {
  try {
    return await lstat(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function normalizeSelection(value: unknown): ServiceCatalogInstallSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Catalog install selections must be JSON objects.");
  }
  const record = value as Record<string, unknown>;
  const packageId = typeof record.packageId === "string" ? record.packageId.trim() : "";
  if (!packageId) {
    throw new Error("Catalog install selections require packageId.");
  }
  return {
    packageId,
    version: typeof record.version === "string" && record.version.trim() ? record.version.trim() : undefined,
    assetName: typeof record.assetName === "string" && record.assetName.trim() ? record.assetName.trim() : undefined,
  };
}

function normalizeSelections(request: ServiceCatalogInstallRequest): ServiceCatalogInstallSelection[] {
  const rawSelections = Array.isArray(request.selections)
    ? request.selections
    : request.packageId
      ? [request]
      : [];
  const selections = rawSelections.map(normalizeSelection);
  if (selections.length === 0) {
    throw new Error("Catalog install request requires at least one selection.");
  }
  return selections;
}

function resolveDirectServiceRoot(servicesRoot: string, serviceId: string): string {
  const resolvedRoot = path.resolve(servicesRoot);
  const serviceRoot = path.resolve(resolvedRoot, serviceId);
  if (path.dirname(serviceRoot) !== resolvedRoot || path.basename(serviceRoot) !== serviceId) {
    throw new Error(`Service id "${serviceId}" must be a portable direct-child service identifier.`);
  }
  return serviceRoot;
}

async function assertSafeInstallDestination(servicesRoot: string, serviceRoot: string): Promise<void> {
  const rootStat = await lstatIfPresent(servicesRoot);
  if (!rootStat) return;
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("Configured services root must be a real directory for catalog install.");
  }
  const serviceStat = await lstatIfPresent(serviceRoot);
  if (!serviceStat) return;
  if (!serviceStat.isDirectory() || serviceStat.isSymbolicLink()) {
    throw new Error("Catalog install destination must be a real direct-child directory.");
  }
  if (path.dirname(await realpath(serviceRoot)) !== await realpath(servicesRoot)) {
    throw new Error("Catalog install destination escapes the configured services root.");
  }
}

function assertSafeArchiveEntry(entryName: string, archivePath: string): string[] {
  const rawSegments = entryName.replaceAll("\\", "/").split("/");
  if (rawSegments.some((segment) => segment === "." || segment === "..")) {
    throw new Error(`Unsafe archive entry "${entryName}" in ${archivePath}.`);
  }

  const normalized = path.posix.normalize(rawSegments.join("/"));
  if (
    normalized.length === 0 ||
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    path.posix.isAbsolute(normalized) ||
    /^[A-Za-z]:/.test(normalized)
  ) {
    throw new Error(`Unsafe archive entry "${entryName}" in ${archivePath}.`);
  }

  return normalized.split("/").filter(Boolean);
}

async function extractZipSafely(archivePath: string, destinationPath: string): Promise<void> {
  await rm(destinationPath, { recursive: true, force: true });
  await mkdir(destinationPath, { recursive: true });

  const zip = new AdmZip(archivePath);
  const destinationRoot = path.resolve(destinationPath);
  for (const entry of zip.getEntries()) {
    const segments = assertSafeArchiveEntry(entry.entryName, archivePath);
    const targetPath = path.resolve(destinationRoot, ...segments);
    if (targetPath !== destinationRoot && !targetPath.startsWith(destinationRoot + path.sep)) {
      throw new Error(`Unsafe archive entry "${entry.entryName}" in ${archivePath}.`);
    }

    if (entry.isDirectory) {
      await mkdir(targetPath, { recursive: true });
      continue;
    }

    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, entry.getData());
  }
}

async function findServiceManifestPaths(root: string): Promise<string[]> {
  const discovered: string[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile() && entry.name === "service.json") {
        discovered.push(entryPath);
      }
    }
  }

  await visit(root);
  return discovered;
}

async function readArchiveManifest(stagingRoot: string, archivePath: string): Promise<ArchiveManifest> {
  const manifestPaths = await findServiceManifestPaths(stagingRoot);
  if (manifestPaths.length === 0) {
    throw new Error(`Service archive ${archivePath} does not contain service.json.`);
  }
  if (manifestPaths.length > 1) {
    throw new Error(`Service archive ${archivePath} contains multiple service.json files.`);
  }

  const manifestPath = manifestPaths[0];
  const parsed = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  return {
    manifest: validateServiceManifest(parsed, manifestPath),
    manifestPath,
    contentRoot: path.dirname(manifestPath),
  };
}

async function downloadArchive(downloadUrl: string, archivePath: string): Promise<void> {
  const response = await fetch(downloadUrl, { headers: githubHeaders() });
  if (!response.ok) {
    throw new Error(`Catalog archive download returned ${response.status} ${response.statusText}`.trim());
  }
  await writeFile(archivePath, Buffer.from(await response.arrayBuffer()));
}

async function recordCatalogInstallEvent(input: {
  workspaceRoot: string;
  actor: string;
  result: ServiceCatalogInstallResult;
}): Promise<void> {
  const serviceId = input.result.serviceId ?? input.result.packageId;
  const audit = await appendAuditEvent({
    workspaceRoot: input.workspaceRoot,
    source: "runtime-api",
    action: "catalog.service.install",
    actor: input.actor,
    subject: serviceId,
    serviceId: input.result.serviceId ?? undefined,
    outcome: input.result.ok ? "success" : "failure",
    statusCode: input.result.ok ? 200 : 409,
    summary: `Catalog install ${input.result.state} for ${serviceId}.`,
    reason: input.result.reason ?? null,
    metadata: {
      packageId: input.result.packageId,
      version: input.result.version ?? null,
      assetName: input.result.assetName ?? null,
      state: input.result.state,
    },
  });
  input.result.auditId = audit.id;

  await upsertOperatorInboxItem(input.workspaceRoot, {
    dedupeKey: `catalog-install:${input.result.packageId}:${input.result.version ?? "default"}`,
    title: input.result.ok ? "Catalog service installed" : "Catalog service install needs attention",
    summary: input.result.ok
      ? `Installed ${serviceId} from catalog package ${input.result.packageId}.`
      : `Catalog package ${input.result.packageId} ended as ${input.result.state}.`,
    details: input.result.reason,
    type: input.result.ok ? "service" : "error",
    severity: input.result.ok ? "success" : input.result.state === "skipped/conflict" ? "warning" : "error",
    source: "runtime",
    relatedTarget: {
      serviceId,
      auditId: input.result.auditId ?? undefined,
      route: "/api/catalog/install",
    },
    observedAt: nowIso(),
  });
}

async function installOneSelection(
  options: InstallServiceCatalogSelectionsOptions,
  selection: ServiceCatalogInstallSelection,
): Promise<ServiceCatalogInstallResult> {
  const progress: ServiceCatalogInstallResult["progress"] = ["pending"];
  let tempRoot: string | null = null;

  try {
    const releases = await listServiceCatalogPackageReleases(selection.packageId, {
      catalogUrl: options.catalogUrl,
      githubApiBaseUrl: options.githubApiBaseUrl,
    });
    const selectedVersion = selection.version
      ? releases.versions.find((version) => version.tag === selection.version || version.version === selection.version)
      : releases.defaultVersion;
    if (!selectedVersion) {
      throw new Error(`No matching release version found for catalog package ${selection.packageId}.`);
    }

    const selectedAsset = selection.assetName
      ? selectedVersion.assets.find((asset) => asset.name === selection.assetName)
      : selectedVersion.selectedAsset;
    if (!selectedAsset?.downloadUrl) {
      throw new Error(`No downloadable archive asset found for catalog package ${selection.packageId}.`);
    }

    tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-catalog-install-"));
    const archivePath = path.join(tempRoot, selectedAsset.name);
    const stagingRoot = path.join(tempRoot, "staging");
    progress.push("downloading");
    await downloadArchive(selectedAsset.downloadUrl, archivePath);

    progress.push("validating");
    await extractZipSafely(archivePath, stagingRoot);
    const archive = await readArchiveManifest(stagingRoot, archivePath);
    if (typeof archive.manifest.version !== "string" || archive.manifest.version.trim() === "") {
      throw new Error(`Catalog archive for ${selection.packageId} must include a non-empty service version.`);
    }

    const serviceRoot = resolveDirectServiceRoot(options.servicesRoot, archive.manifest.id);
    await assertSafeInstallDestination(options.servicesRoot, serviceRoot);
    const conflictPath = await pathExists(path.join(serviceRoot, "service.json"))
      ? path.join(serviceRoot, "service.json")
      : await pathExists(serviceRoot)
        ? serviceRoot
        : null;
    if (conflictPath) {
      progress.push("skipped/conflict");
      return {
        packageId: selection.packageId,
        version: selectedVersion.version,
        assetName: selectedAsset.name,
        serviceId: archive.manifest.id,
        serviceVersion: archive.manifest.version,
        state: "skipped/conflict",
        ok: false,
        progress,
        targetPath: serviceRoot,
        conflict: { kind: conflictPath.endsWith("service.json") ? "target_manifest_exists" : "target_directory_exists", path: conflictPath },
        reason: "A service with this id already exists and was not overwritten.",
      };
    }

    progress.push("copying");
    await mkdir(options.servicesRoot, { recursive: true });
    await cp(archive.contentRoot, serviceRoot, { recursive: true, errorOnExist: true, force: false });

    progress.push("registered");
    const discovered = await discoverServices(options.servicesRoot);
    if (!discovered.some((service) => service.manifest.id === archive.manifest.id)) {
      throw new Error(`Installed catalog service "${archive.manifest.id}" could not be rediscovered.`);
    }

    return {
      packageId: selection.packageId,
      version: selectedVersion.version,
      assetName: selectedAsset.name,
      serviceId: archive.manifest.id,
      serviceVersion: archive.manifest.version,
      state: "registered",
      ok: true,
      progress,
      targetPath: serviceRoot,
      conflict: null,
      reason: null,
    };
  } catch (error) {
    progress.push("failed");
    return {
      packageId: selection.packageId,
      version: selection.version ?? null,
      assetName: selection.assetName ?? null,
      serviceId: null,
      serviceVersion: null,
      state: "failed",
      ok: false,
      progress,
      targetPath: null,
      conflict: null,
      reason: error instanceof Error ? error.message : "Catalog service install failed.",
    };
  } finally {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }
}

export async function installServiceCatalogSelections(
  options: InstallServiceCatalogSelectionsOptions,
): Promise<ServiceCatalogInstallResponse> {
  const selections = normalizeSelections(options.request);
  const actor = options.actor?.trim() || "service-admin";
  const results: ServiceCatalogInstallResult[] = [];

  for (const selection of selections) {
    const result = await installOneSelection(options, selection);
    await recordCatalogInstallEvent({ workspaceRoot: options.workspaceRoot, actor, result });
    results.push(result);
  }

  return {
    install: {
      ok: results.every((result) => result.ok),
      state: results.every((result) => result.ok)
        ? "completed"
        : results.some((result) => result.ok)
          ? "partial"
          : "failed",
      results,
      summary: {
        total: results.length,
        registered: results.filter((result) => result.state === "registered").length,
        failed: results.filter((result) => result.state === "failed").length,
        conflicts: results.filter((result) => result.state === "skipped/conflict").length,
      },
    },
  };
}
