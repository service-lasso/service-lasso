import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { validateServiceManifest } from "../discovery/validateManifest.js";
import type { ReleaseIdentity, StageResolver } from "./staged-service-transfer.js";

interface ReleaseAsset { id: number; name: string; size: number; browser_download_url: string; }
interface Release { id: number; tag_name: string; draft: boolean; prerelease: boolean; assets: ReleaseAsset[]; }
interface PolicyPlatform { assetName: string; archiveType: "zip" | "tar.gz" | "tgz"; sha256: string; checksum: { assetName: string; sha256: string }; }
interface Policy { schema: string; serviceId: string; release: { tag: string; targetSha: string }; manifest: { assetName: string; sha256: string }; platforms: Partial<Record<"win32" | "linux" | "darwin", PolicyPlatform>>; }
interface CatalogPin { repo: string; serviceId: string; policySha256: string; manifestSha256: string; }
interface Catalog { version: 1; pins: CatalogPin[]; }

const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const ASSET = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/;
const POLICY_ASSET = "service-lasso-release-policy.json";

function digest(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function exactAsset(release: Release, name: string): ReleaseAsset {
  const matches = release.assets.filter((asset) => asset.name === name);
  if (matches.length !== 1 || !Number.isSafeInteger(matches[0]?.id) || !Number.isSafeInteger(matches[0]?.size) || matches[0]!.size < 1) throw new Error("release asset is unavailable");
  return matches[0]!;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: "application/vnd.github+json", "user-agent": "service-lasso-core" } });
  if (!response.ok) throw new Error("release provenance is unavailable");
  return await response.json();
}
async function fetchAsset(asset: ReleaseAsset): Promise<Buffer> {
  const response = await fetch(asset.browser_download_url, { headers: { accept: "application/octet-stream", "user-agent": "service-lasso-core" }, redirect: "error" });
  if (!response.ok) throw new Error("release asset is unavailable");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== asset.size) throw new Error("release asset size mismatch");
  return bytes;
}
function parsePolicy(bytes: Buffer): Policy {
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { throw new Error("release policy is invalid"); }
  if (!isRecord(value) || value.schema !== "service-lasso.service-producer-release-policy/v1" || typeof value.serviceId !== "string" || !isRecord(value.release) || !isRecord(value.manifest) || !isRecord(value.platforms)) throw new Error("release policy is invalid");
  const policy = value as unknown as Policy;
  if (!COMMIT.test(policy.release.targetSha) || !SHA256.test(policy.manifest.sha256)) throw new Error("release policy is invalid");
  return policy;
}

/** Resolves only a persisted, independently approved producer catalog pin. */
export class ServiceProducerReleaseResolver implements StageResolver {
  constructor(private readonly catalogPath?: string, private readonly apiBaseUrl = "https://api.github.com") {}

  async resolve(input: { repo: string; releaseTag: string; commitSha: string; targetServiceId: string; platform: string }): Promise<ReleaseIdentity> {
    if (!this.catalogPath) throw new Error("owner catalog pin unavailable");
    const catalog = JSON.parse(await readFile(this.catalogPath, "utf8")) as Catalog;
    if (catalog.version !== 1 || !Array.isArray(catalog.pins)) throw new Error("owner catalog pin unavailable");
    const pin = catalog.pins.find((candidate) => candidate.repo === input.repo && candidate.serviceId === input.targetServiceId);
    if (!pin || !SHA256.test(pin.policySha256) || !SHA256.test(pin.manifestSha256)) throw new Error("owner catalog pin unavailable");
    const rawRelease = await fetchJson(`${this.apiBaseUrl}/repos/${encodeURIComponent(input.repo.split("/")[0]! )}/${encodeURIComponent(input.repo.split("/")[1]! )}/releases/tags/${encodeURIComponent(input.releaseTag)}`);
    if (!isRecord(rawRelease) || rawRelease.draft !== false || rawRelease.prerelease === true || rawRelease.tag_name !== input.releaseTag || !Array.isArray(rawRelease.assets) || typeof rawRelease.id !== "number") throw new Error("release provenance is unavailable");
    const release = rawRelease as unknown as Release;
    const tag = await fetchJson(`${this.apiBaseUrl}/repos/${encodeURIComponent(input.repo.split("/")[0]! )}/${encodeURIComponent(input.repo.split("/")[1]! )}/git/ref/tags/${encodeURIComponent(input.releaseTag)}`);
    const targetSha = isRecord(tag) && isRecord(tag.object) && tag.object.type === "commit" && typeof tag.object.sha === "string" ? tag.object.sha : "";
    if (!COMMIT.test(targetSha) || targetSha !== input.commitSha) throw new Error("release provenance is unavailable");
    const policyAsset = exactAsset(release, POLICY_ASSET);
    const manifestAsset = exactAsset(release, "service.json");
    const policyBytes = await fetchAsset(policyAsset);
    const manifestBytes = await fetchAsset(manifestAsset);
    if (digest(policyBytes) !== pin.policySha256 || digest(manifestBytes) !== pin.manifestSha256) throw new Error("owner catalog pin mismatch");
    const policy = parsePolicy(policyBytes);
    if (policy.serviceId !== input.targetServiceId || policy.release.tag !== input.releaseTag || policy.release.targetSha !== targetSha || policy.manifest.assetName !== "service.json" || policy.manifest.sha256 !== digest(manifestBytes)) throw new Error("release policy binding mismatch");
    const manifest = validateServiceManifest(JSON.parse(manifestBytes.toString("utf8")), "service.json");
    if (manifest.id !== input.targetServiceId || manifest.artifact?.source.type !== "github-release" || manifest.artifact.source.repo !== input.repo || manifest.artifact.source.tag !== input.releaseTag) throw new Error("manifest binding mismatch");
    const platform = input.platform as "win32" | "linux" | "darwin";
    const selected = policy.platforms[platform];
    if (!selected || !ASSET.test(selected.assetName) || !SHA256.test(selected.sha256) || !ASSET.test(selected.checksum.assetName) || !SHA256.test(selected.checksum.sha256)) throw new Error("platform is not approved");
    if ((platform === "win32" && selected.archiveType !== "zip") || ((platform === "linux" || platform === "darwin") && !["tar.gz", "tgz"].includes(selected.archiveType))) throw new Error("platform archive type is not approved");
    const archive = exactAsset(release, selected.assetName);
    const checksum = exactAsset(release, selected.checksum.assetName);
    if (archive.id === policyAsset.id || archive.id === manifestAsset.id || checksum.id === policyAsset.id || checksum.id === manifestAsset.id) throw new Error("release asset identity overlaps");
    return { repo: input.repo, releaseTag: input.releaseTag, commitSha: targetSha, targetServiceId: input.targetServiceId, platform, archiveType: selected.archiveType, assetName: archive.name, assetId: String(archive.id), archiveBytes: archive.size, archiveSha256: selected.sha256, manifestSha256: digest(manifestBytes), releaseId: String(release.id), manifestAssetId: String(manifestAsset.id), checksumAssetId: String(checksum.id) };
  }
}
