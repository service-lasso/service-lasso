import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ServiceManifest } from "../../contracts/service.js";
import { DEFAULT_SERVICES_ROOT } from "../../contracts/service-root.js";
import { discoverServices } from "../discovery/discoverServices.js";
import { validateServiceManifest } from "../discovery/validateManifest.js";

interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface GitHubReleaseResponse {
  tag_name?: string;
  assets?: GitHubReleaseAsset[];
}

export interface ImportServiceManifestCliOptions {
  repo: string;
  tag?: string;
  servicesRoot?: string;
  apiBaseUrl?: string;
  force?: boolean;
  dryRun?: boolean;
}

export interface ImportServiceManifestCliResult {
  action: "importService";
  ok: true;
  repo: string;
  requestedTag: string | null;
  resolvedTag: string | null;
  serviceId: string;
  serviceName: string;
  servicesRoot: string;
  targetPath: string;
  manifestAssetUrl: string;
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
  const repo = normalizeRepo(options.repo);
  const servicesRoot = path.resolve(
    options.servicesRoot?.trim() || process.env.SERVICE_LASSO_SERVICES_ROOT || DEFAULT_SERVICES_ROOT,
  );
  const { manifest, resolvedTag, assetUrl } = await fetchReleasedServiceManifest({
    repo,
    tag: options.tag,
    apiBaseUrl: options.apiBaseUrl,
  });
  const serviceRoot = path.join(servicesRoot, manifest.id);
  const targetPath = path.join(serviceRoot, "service.json");
  const exists = await pathExists(targetPath);

  if (exists && !options.force) {
    throw new Error(
      `Refusing to overwrite existing manifest for "${manifest.id}" at ${targetPath}. Re-run with --force to replace it.`,
    );
  }

  if (!options.dryRun) {
    await mkdir(serviceRoot, { recursive: true });
    await writeFile(targetPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const discovered = await discoverServices(servicesRoot);
    if (!discovered.some((service) => service.manifest.id === manifest.id && service.manifestPath === targetPath)) {
      throw new Error(`Imported manifest for "${manifest.id}" could not be rediscovered from ${servicesRoot}.`);
    }
  }

  return {
    action: "importService",
    ok: true,
    repo,
    requestedTag: options.tag ?? null,
    resolvedTag,
    serviceId: manifest.id,
    serviceName: manifest.name,
    servicesRoot,
    targetPath,
    manifestAssetUrl: assetUrl,
    dryRun: options.dryRun === true,
    wrote: options.dryRun !== true,
    overwritten: exists && options.dryRun !== true,
  };
}
