import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  ServiceCatalogPackageReleasesResponse,
  ServiceCatalogPackageResponse,
  ServiceCatalogPackagesResponse,
  ServiceCatalogReleaseAssetResponse,
  ServiceCatalogReleaseVersionResponse,
  ServiceCatalogVersionPolicyResponse,
} from "../../contracts/api.js";

export const DEFAULT_SERVICE_CATALOG_URL =
  "https://raw.githubusercontent.com/service-lasso/service-catalog/develop/catalog.json";

const DEFAULT_GITHUB_API_BASE_URL = "https://api.github.com";

interface ServiceCatalogDocument {
  schemaVersion?: string;
  catalogId?: string;
  updatedAt?: string;
  defaults?: {
    publisher?: string;
    trustStatus?: ServiceCatalogPackageResponse["trustStatus"];
    versionPolicy?: ServiceCatalogVersionPolicyResponse;
    releaseAsset?: { namePattern?: string; required?: boolean };
    manifestPath?: string;
  };
  entries?: CatalogEntry[];
}

interface CatalogEntry {
  packageId?: string;
  displayName?: string;
  summary?: string;
  repository?: {
    owner?: string;
    name?: string;
    url?: string;
  };
  category?: string;
  tags?: string[];
  publisher?: string;
  trustStatus?: ServiceCatalogPackageResponse["trustStatus"];
  defaultVersionPolicy?: ServiceCatalogVersionPolicyResponse;
  releaseAsset?: { namePattern?: string; required?: boolean };
  manifestPath?: string;
}

interface GitHubReleaseAsset {
  name?: string;
  size?: number;
  content_type?: string | null;
  browser_download_url?: string | null;
}

interface GitHubRelease {
  tag_name?: string;
  name?: string | null;
  html_url?: string | null;
  created_at?: string | null;
  published_at?: string | null;
  prerelease?: boolean;
  draft?: boolean;
  body?: string | null;
  assets?: GitHubReleaseAsset[];
}

export interface ServiceCatalogOptions {
  catalogUrl?: string;
  githubApiBaseUrl?: string;
}

export interface ServiceCatalogPackageQuery extends ServiceCatalogOptions {
  query?: string | null;
  category?: string | null;
  tag?: string | null;
}

function normalizedCatalogSource(catalogUrl?: string): string {
  return (catalogUrl?.trim() || process.env.SERVICE_LASSO_CATALOG_URL?.trim() || DEFAULT_SERVICE_CATALOG_URL);
}

function normalizedGithubApiBaseUrl(githubApiBaseUrl?: string): string {
  return (githubApiBaseUrl?.trim() || process.env.SERVICE_LASSO_GITHUB_API_BASE_URL?.trim() || DEFAULT_GITHUB_API_BASE_URL)
    .replace(/\/+$/, "");
}

function githubHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
  return {
    accept: "application/vnd.github+json",
    "user-agent": "service-lasso-core-runtime",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

function isHttpSource(source: string): boolean {
  return /^https?:\/\//i.test(source);
}

async function readJsonSource(source: string): Promise<unknown> {
  if (isHttpSource(source)) {
    const response = await fetch(source, { headers: githubHeaders() });
    if (!response.ok) {
      throw new Error(`Catalog source returned ${response.status} ${response.statusText}`.trim());
    }
    return await response.json();
  }

  const filePath = source.startsWith("file:")
    ? new URL(source)
    : path.resolve(source);
  return JSON.parse(await readFile(filePath, "utf8"));
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Catalog field "${field}" must be a non-empty string.`);
  }
  return value;
}

function normalizePolicy(value: unknown, fallback?: ServiceCatalogVersionPolicyResponse): ServiceCatalogVersionPolicyResponse {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const channel = record.channel === "preview" ? "preview" : fallback?.channel ?? "stable";
  const selector = record.selector === "latest-release" ? "latest-release" : fallback?.selector ?? "latest-semver";
  const allowPrerelease = typeof record.allowPrerelease === "boolean"
    ? record.allowPrerelease
    : fallback?.allowPrerelease ?? false;
  return { channel, selector, allowPrerelease };
}

function normalizeEntry(entry: CatalogEntry, defaults: ServiceCatalogDocument["defaults"] = {}): ServiceCatalogPackageResponse {
  const repository = entry.repository ?? {};
  const publisher = entry.publisher ?? defaults.publisher;
  const trustStatus = entry.trustStatus ?? defaults.trustStatus ?? "approved";
  const releaseAsset = entry.releaseAsset ?? defaults.releaseAsset ?? { namePattern: "^.+\\.zip$", required: true };

  return {
    packageId: requireString(entry.packageId, "entries[].packageId"),
    displayName: requireString(entry.displayName, "entries[].displayName"),
    summary: requireString(entry.summary, "entries[].summary"),
    repository: {
      owner: requireString(repository.owner, "entries[].repository.owner"),
      name: requireString(repository.name, "entries[].repository.name"),
      url: requireString(repository.url, "entries[].repository.url"),
    },
    category: requireString(entry.category, "entries[].category"),
    tags: Array.isArray(entry.tags) ? entry.tags.filter((tag): tag is string => typeof tag === "string") : [],
    publisher: requireString(publisher, "entries[].publisher"),
    trustStatus,
    approved: trustStatus === "approved",
    defaultVersionPolicy: normalizePolicy(entry.defaultVersionPolicy, normalizePolicy(defaults.versionPolicy)),
    releaseAsset: {
      namePattern: requireString(releaseAsset.namePattern, "entries[].releaseAsset.namePattern"),
      required: releaseAsset.required !== false,
    },
    manifestPath: requireString(entry.manifestPath ?? defaults.manifestPath, "entries[].manifestPath"),
  };
}

async function loadCatalogDocument(options: ServiceCatalogOptions = {}): Promise<{
  source: string;
  document: ServiceCatalogDocument;
  packages: ServiceCatalogPackageResponse[];
}> {
  const source = normalizedCatalogSource(options.catalogUrl);
  const payload = await readJsonSource(source);
  if (!payload || typeof payload !== "object") {
    throw new Error("Catalog source did not return a JSON object.");
  }

  const document = payload as ServiceCatalogDocument;
  const entries = Array.isArray(document.entries) ? document.entries : [];
  if (entries.length === 0) {
    throw new Error("Catalog source contains no entries.");
  }

  return {
    source,
    document,
    packages: entries.map((entry) => normalizeEntry(entry, document.defaults)),
  };
}

function matchesPackage(pack: ServiceCatalogPackageResponse, input: ServiceCatalogPackageQuery): boolean {
  const query = input.query?.trim().toLowerCase();
  const category = input.category?.trim().toLowerCase();
  const tag = input.tag?.trim().toLowerCase();
  const haystack = [
    pack.packageId,
    pack.displayName,
    pack.summary,
    pack.repository.owner,
    pack.repository.name,
    pack.category,
    ...pack.tags,
  ].join(" ").toLowerCase();

  return (!query || haystack.includes(query))
    && (!category || pack.category.toLowerCase() === category)
    && (!tag || pack.tags.some((candidate) => candidate.toLowerCase() === tag));
}

export async function listServiceCatalogPackages(
  input: ServiceCatalogPackageQuery = {},
): Promise<ServiceCatalogPackagesResponse> {
  const { source, document, packages } = await loadCatalogDocument(input);
  const filtered = packages.filter((pack) => matchesPackage(pack, input));

  return {
    catalog: {
      catalogId: requireString(document.catalogId, "catalogId"),
      schemaVersion: requireString(document.schemaVersion, "schemaVersion"),
      updatedAt: requireString(document.updatedAt, "updatedAt"),
      source,
      packages: filtered,
      summary: {
        total: packages.length,
        approved: packages.filter((pack) => pack.approved).length,
        categories: [...new Set(packages.map((pack) => pack.category))].sort(),
        filtered: filtered.length,
      },
    },
  };
}

export async function getServiceCatalogPackage(
  packageId: string,
  options: ServiceCatalogOptions = {},
): Promise<ServiceCatalogPackageResponse | null> {
  const { packages } = await loadCatalogDocument(options);
  return packages.find((pack) => pack.packageId === packageId) ?? null;
}

function compareVersionLikeTags(left: string, right: string): number {
  const tokenize = (tag: string): Array<number | string> =>
    tag.replace(/^v/i, "").split(/[.-]/g).map((part) => (/^\d+$/.test(part) ? Number(part) : part.toLowerCase()));
  const leftParts = tokenize(left);
  const rightParts = tokenize(right);
  const max = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < max; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;
    if (typeof leftPart === "number" && typeof rightPart === "number" && leftPart !== rightPart) {
      return leftPart - rightPart;
    }
    const comparison = String(leftPart).localeCompare(String(rightPart));
    if (comparison !== 0) return comparison;
  }
  return 0;
}

function selectDefaultRelease(
  versions: ServiceCatalogReleaseVersionResponse[],
  policy: ServiceCatalogVersionPolicyResponse,
): ServiceCatalogReleaseVersionResponse | null {
  const candidates = policy.allowPrerelease ? versions : versions.filter((release) => !release.prerelease && !release.draft);
  const selectable = candidates.length > 0 ? candidates : versions.filter((release) => !release.draft);
  if (selectable.length === 0) return null;

  return [...selectable].sort((left, right) => {
    if (policy.selector === "latest-semver") {
      const versionComparison = compareVersionLikeTags(right.tag, left.tag);
      if (versionComparison !== 0) return versionComparison;
    }

    return Date.parse(right.publishedAt ?? right.createdAt ?? "") - Date.parse(left.publishedAt ?? left.createdAt ?? "");
  })[0] ?? null;
}

function summarizeNotes(body: string | null | undefined): string | null {
  const normalized = body?.replace(/`[^`]*`/g, "`[redacted]`")
    .replace(/(token|secret|password|cookie|credential)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find((line) => line.length > 0);

  return normalized ? normalized.slice(0, 400) : null;
}

function buildAssetRule(pattern: string): RegExp {
  try {
    return new RegExp(pattern);
  } catch {
    return /^$/;
  }
}

function toReleaseVersion(
  release: GitHubRelease,
  selectedAssetPattern: RegExp,
  isDefault = false,
): ServiceCatalogReleaseVersionResponse | null {
  const tag = release.tag_name;
  if (typeof tag !== "string" || tag.trim() === "") {
    return null;
  }

  const selectedAssetName = (release.assets ?? []).find((asset) =>
    typeof asset.name === "string" && selectedAssetPattern.test(asset.name),
  )?.name ?? null;
  const assets: ServiceCatalogReleaseAssetResponse[] = (release.assets ?? [])
    .filter((asset): asset is GitHubReleaseAsset & { name: string } => typeof asset.name === "string")
    .map((asset) => ({
      name: asset.name,
      size: typeof asset.size === "number" ? asset.size : null,
      contentType: typeof asset.content_type === "string" ? asset.content_type : null,
      downloadUrl: typeof asset.browser_download_url === "string" ? asset.browser_download_url : null,
      selected: asset.name === selectedAssetName,
    }));

  return {
    tag,
    version: tag,
    name: typeof release.name === "string" ? release.name : null,
    releaseUrl: typeof release.html_url === "string" ? release.html_url : null,
    createdAt: typeof release.created_at === "string" ? release.created_at : null,
    publishedAt: typeof release.published_at === "string" ? release.published_at : null,
    prerelease: release.prerelease === true,
    draft: release.draft === true,
    notesSummary: summarizeNotes(release.body),
    assets,
    selectedAsset: assets.find((asset) => asset.selected) ?? null,
    default: isDefault,
  };
}

async function fetchPackageReleases(pack: ServiceCatalogPackageResponse, apiBaseUrl: string): Promise<GitHubRelease[]> {
  const repo = `${pack.repository.owner}/${pack.repository.name}`;
  const response = await fetch(`${apiBaseUrl}/repos/${repo}/releases?per_page=30`, {
    headers: githubHeaders(),
  });

  if (!response.ok) {
    throw new Error(`GitHub releases returned ${response.status} ${response.statusText}`.trim());
  }

  const payload = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error("GitHub releases response was not a JSON array.");
  }

  return payload as GitHubRelease[];
}

export async function listServiceCatalogPackageReleases(
  packageId: string,
  options: ServiceCatalogOptions = {},
): Promise<ServiceCatalogPackageReleasesResponse> {
  const pack = await getServiceCatalogPackage(packageId, options);
  if (!pack) {
    throw new Error(`Unknown catalog package: ${packageId}.`);
  }

  const apiBaseUrl = normalizedGithubApiBaseUrl(options.githubApiBaseUrl);
  const releases = await fetchPackageReleases(pack, apiBaseUrl);
  const assetRule = buildAssetRule(pack.releaseAsset.namePattern);
  const versionsWithoutDefault = releases
    .map((release) => toReleaseVersion(release, assetRule))
    .filter((release): release is ServiceCatalogReleaseVersionResponse => release !== null);
  const defaultVersion = selectDefaultRelease(versionsWithoutDefault, pack.defaultVersionPolicy);
  const versions = versionsWithoutDefault.map((version) => ({
    ...version,
    default: defaultVersion?.tag === version.tag,
  }));

  return {
    package: pack,
    versions,
    defaultVersion: versions.find((version) => version.default) ?? null,
    source: {
      type: "github-releases",
      apiBaseUrl,
      repository: `${pack.repository.owner}/${pack.repository.name}`,
    },
    summary: {
      total: versions.length,
      stable: versions.filter((release) => !release.prerelease && !release.draft).length,
      prerelease: versions.filter((release) => release.prerelease).length,
      drafts: versions.filter((release) => release.draft).length,
    },
  };
}
