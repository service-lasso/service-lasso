import { access, cp, lstat, mkdtemp, mkdir, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import type { ServiceManifest } from "../../contracts/service.js";
import { DEFAULT_SERVICES_ROOT } from "../../contracts/service-root.js";
import { resolveRuntimeConfig } from "../config.js";
import { discoverServices } from "../discovery/discoverServices.js";
import { validateServiceManifest } from "../discovery/validateManifest.js";
import { enforceLeftoverCliMutation } from "../permissions/leftover-cli.js";
import type { PermissionActor } from "../permissions/enforcement.js";

interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface GitHubReleaseResponse {
  tag_name?: string;
  assets?: GitHubReleaseAsset[];
}

export interface ImportServiceManifestCliOptions {
  repo?: string;
  tag?: string;
  servicesRoot?: string;
  workspaceRoot?: string;
  apiBaseUrl?: string;
  archivePath?: string;
  force?: boolean;
  dryRun?: boolean;
  /** Test override. Production leftover CLI mutations use `cli-local-root`. */
  permissionActor?: PermissionActor;
}

export interface ImportServiceManifestCliResult {
  action: "importService";
  ok: boolean;
  source: "github-release" | "archive";
  repo: string | null;
  requestedTag: string | null;
  resolvedTag: string | null;
  serviceId: string;
  serviceName: string;
  version: string | null;
  servicesRoot: string;
  targetPath: string | null;
  targetServiceRoot: string;
  manifestAssetUrl: string | null;
  archivePath: string | null;
  archiveType: "zip" | null;
  state: "validated" | "imported" | "conflict";
  conflict: { kind: "target_manifest_exists" | "target_directory_exists"; path: string } | null;
  dryRun: boolean;
  wrote: boolean;
  overwritten: boolean;
}

function normalizeRepo(repo: string): string {
  const normalized = repo.trim().replace(/^\/+|\/+$/g, "");
  if (!/^[^\s/]+\/[^\s/]+$/.test(normalized)) {
    throw new Error('The "services import" command requires a GitHub repo in owner/name form.');
  }
  return normalized;
}

function normalizeApiBaseUrl(candidate: string | undefined): string {
  return (candidate?.trim() || "https://api.github.com").replace(/\/+$/, "");
}

function githubHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
  return {
    accept: "application/vnd.github+json",
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

function resolveDirectServiceRoot(servicesRoot: string, serviceId: string): string {
  const resolvedRoot = path.resolve(servicesRoot);
  const serviceRoot = path.resolve(resolvedRoot, serviceId);
  if (path.dirname(serviceRoot) !== resolvedRoot || path.basename(serviceRoot) !== serviceId) {
    throw new Error(`Service id "${serviceId}" does not resolve to a direct child of the configured services root.`);
  }
  return serviceRoot;
}

async function lstatIfPresent(targetPath: string) {
  try {
    return await lstat(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function assertSafeImportDestination(servicesRoot: string, serviceRoot: string): Promise<void> {
  const rootStat = await lstatIfPresent(servicesRoot);
  if (!rootStat) return;
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("Configured services root must be a real directory for service import.");
  }
  const canonicalRoot = await realpath(servicesRoot);
  const serviceStat = await lstatIfPresent(serviceRoot);
  if (!serviceStat) return;
  if (!serviceStat.isDirectory() || serviceStat.isSymbolicLink()) {
    throw new Error("Service import destination must be a real direct-child directory.");
  }
  if (path.dirname(await realpath(serviceRoot)) !== canonicalRoot) {
    throw new Error("Service import destination escapes the configured services root.");
  }

  const manifestPath = path.join(serviceRoot, "service.json");
  const manifestStat = await lstatIfPresent(manifestPath);
  if (manifestStat && (manifestStat.isSymbolicLink() || !manifestStat.isFile())) {
    throw new Error("Service import destination manifest must be a regular file.");
  }
}

function detectArchiveType(archivePath: string): "zip" {
  if (archivePath.toLowerCase().endsWith(".zip")) {
    return "zip";
  }

  throw new Error('The "services import --archive" command currently supports .zip Service Archives.');
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

async function readArchiveManifest(stagingRoot: string, archivePath: string): Promise<{
  manifest: ServiceManifest;
  manifestPath: string;
  contentRoot: string;
}> {
  const manifestPaths = await findServiceManifestPaths(stagingRoot);
  if (manifestPaths.length === 0) {
    throw new Error(`Service Archive ${archivePath} does not contain service.json.`);
  }
  if (manifestPaths.length > 1) {
    throw new Error(`Service Archive ${archivePath} contains multiple service.json files.`);
  }

  const manifestPath = manifestPaths[0];
  const parsed = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  return {
    manifest: validateServiceManifest(parsed, manifestPath),
    manifestPath,
    contentRoot: path.dirname(manifestPath),
  };
}

async function fetchReleasedServiceManifest(options: {
  repo: string;
  tag?: string;
  apiBaseUrl?: string;
}): Promise<{ manifest: ServiceManifest; resolvedTag: string | null; assetUrl: string }> {
  const repo = normalizeRepo(options.repo);
  const apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl);
  const releasePath = options.tag?.trim()
    ? `/repos/${repo}/releases/tags/${encodeURIComponent(options.tag.trim())}`
    : `/repos/${repo}/releases/latest`;
  const releaseResponse = await fetch(`${apiBaseUrl}${releasePath}`, {
    headers: githubHeaders(),
  });

  if (!releaseResponse.ok) {
    throw new Error(
      `Failed to resolve release metadata for "${repo}": ${releaseResponse.status} ${releaseResponse.statusText}`,
    );
  }

  const release = (await releaseResponse.json()) as GitHubReleaseResponse;
  const manifestAsset = release.assets?.find((asset) => asset.name === "service.json");
  if (!manifestAsset) {
    throw new Error(`Release metadata for "${repo}" did not contain a service.json asset.`);
  }

  const manifestResponse = await fetch(manifestAsset.browser_download_url, {
    headers: githubHeaders(),
  });
  if (!manifestResponse.ok) {
    throw new Error(
      `Failed to download service.json for "${repo}": ${manifestResponse.status} ${manifestResponse.statusText}`,
    );
  }

  const parsed = (await manifestResponse.json()) as unknown;
  const manifest = validateServiceManifest(parsed, manifestAsset.browser_download_url);

  return {
    manifest,
    resolvedTag: typeof release.tag_name === "string" ? release.tag_name : options.tag ?? null,
    assetUrl: manifestAsset.browser_download_url,
  };
}

export async function importServiceManifestFromCli(
  options: ImportServiceManifestCliOptions,
): Promise<ImportServiceManifestCliResult> {
  const servicesRoot = path.resolve(
    options.servicesRoot?.trim() || process.env.SERVICE_LASSO_SERVICES_ROOT || DEFAULT_SERVICES_ROOT,
  );
  if (options.dryRun !== true) {
    const runtimeConfig = resolveRuntimeConfig({
      servicesRoot,
      workspaceRoot: options.workspaceRoot,
    });
    await enforceLeftoverCliMutation({
      workspaceRoot: runtimeConfig.workspaceRoot,
      kind: "services-import",
      permissionActor: options.permissionActor,
      subject: options.repo ?? options.archivePath ?? "import",
    });
  }
  if (options.archivePath) {
    const sourceArchivePath = path.resolve(options.archivePath);
    const archiveType = detectArchiveType(sourceArchivePath);
    const stagingRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-archive-import-"));
    try {
      await extractZipSafely(sourceArchivePath, stagingRoot);
      const { manifest, contentRoot } = await readArchiveManifest(stagingRoot, sourceArchivePath);
      const serviceRoot = resolveDirectServiceRoot(servicesRoot, manifest.id);
      const targetPath = path.join(serviceRoot, "service.json");
      await assertSafeImportDestination(servicesRoot, serviceRoot);
      const targetManifestExists = await pathExists(targetPath);
      const targetRootExists = await pathExists(serviceRoot);
      const conflict = targetManifestExists
        ? { kind: "target_manifest_exists" as const, path: targetPath }
        : targetRootExists
          ? { kind: "target_directory_exists" as const, path: serviceRoot }
          : null;

      if (conflict) {
        return {
          action: "importService",
          ok: false,
          source: "archive",
          repo: null,
          requestedTag: null,
          resolvedTag: null,
          serviceId: manifest.id,
          serviceName: manifest.name,
          version: manifest.version ?? null,
          servicesRoot,
          targetPath,
          targetServiceRoot: serviceRoot,
          manifestAssetUrl: null,
          archivePath: sourceArchivePath,
          archiveType,
          state: "conflict",
          conflict,
          dryRun: options.dryRun === true,
          wrote: false,
          overwritten: false,
        };
      }

      if (!options.dryRun) {
        await mkdir(path.dirname(serviceRoot), { recursive: true });
        await assertSafeImportDestination(servicesRoot, serviceRoot);
        await cp(contentRoot, serviceRoot, { recursive: true, errorOnExist: true, force: false });
        const discovered = await discoverServices(servicesRoot);
        if (!discovered.some((service) => service.manifest.id === manifest.id && service.manifestPath === targetPath)) {
          throw new Error(`Imported archive service "${manifest.id}" could not be rediscovered from ${servicesRoot}.`);
        }
      }

      return {
        action: "importService",
        ok: true,
        source: "archive",
        repo: null,
        requestedTag: null,
        resolvedTag: null,
        serviceId: manifest.id,
        serviceName: manifest.name,
        version: manifest.version ?? null,
        servicesRoot,
        targetPath,
        targetServiceRoot: serviceRoot,
        manifestAssetUrl: null,
        archivePath: sourceArchivePath,
        archiveType,
        state: options.dryRun === true ? "validated" : "imported",
        conflict: null,
        dryRun: options.dryRun === true,
        wrote: options.dryRun !== true,
        overwritten: false,
      };
    } finally {
      await rm(stagingRoot, { recursive: true, force: true });
    }
  }

  if (!options.repo) {
    throw new Error('The "services import" command requires either an <owner/repo> argument or --archive <path>.');
  }

  const repo = normalizeRepo(options.repo);
  const { manifest, resolvedTag, assetUrl } = await fetchReleasedServiceManifest({
    repo,
    tag: options.tag,
    apiBaseUrl: options.apiBaseUrl,
  });
  const serviceRoot = resolveDirectServiceRoot(servicesRoot, manifest.id);
  const targetPath = path.join(serviceRoot, "service.json");
  await assertSafeImportDestination(servicesRoot, serviceRoot);
  const exists = await pathExists(targetPath);

  if (exists && !options.force) {
    throw new Error(
      `Refusing to overwrite existing manifest for "${manifest.id}" at ${targetPath}. Re-run with --force to replace it.`,
    );
  }

  if (!options.dryRun) {
    await mkdir(serviceRoot, { recursive: true });
    await assertSafeImportDestination(servicesRoot, serviceRoot);
    await writeFile(targetPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const discovered = await discoverServices(servicesRoot);
    if (!discovered.some((service) => service.manifest.id === manifest.id && service.manifestPath === targetPath)) {
      throw new Error(`Imported manifest for "${manifest.id}" could not be rediscovered from ${servicesRoot}.`);
    }
  }

  return {
    action: "importService",
    ok: true,
    source: "github-release",
    repo,
    requestedTag: options.tag ?? null,
    resolvedTag,
    serviceId: manifest.id,
    serviceName: manifest.name,
    version: manifest.version ?? null,
    servicesRoot,
    targetPath,
    targetServiceRoot: serviceRoot,
    manifestAssetUrl: assetUrl,
    archivePath: null,
    archiveType: null,
    state: options.dryRun === true ? "validated" : "imported",
    conflict: null,
    dryRun: options.dryRun === true,
    wrote: options.dryRun !== true,
    overwritten: exists && options.dryRun !== true,
  };
}
