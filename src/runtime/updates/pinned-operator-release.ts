import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { DiscoveredService } from "../../contracts/service.js";
import { loadServiceManifest } from "../discovery/loadManifest.js";
import { validateServiceManifest } from "../discovery/validateManifest.js";
import { readPrivateJson, writePrivateJson } from "../security/private-json.js";
import { extractUpdateArchive } from "./actions.js";
import { selectArtifactPlatform } from "../setup/artifact-platform.js";
import { readStoredState } from "../state/readState.js";

const producers = {
  "@cli": { repo: "service-lasso/service-lasso-cli", binary: "service-lassoctl", tag: /^cli-v\d+\.\d+\.\d+-dev\.([a-f0-9]{7})-candidate-\1$/ },
  "@tui": { repo: "service-lasso/service-lasso-tui", binary: "service-lasso-tui", tag: /^candidate-\d{4}\.\d{1,2}\.\d{1,2}-[a-f0-9]{7}$/ },
} as const;
const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const manifestFingerprint = (manifest: DiscoveredService["manifest"]) => sha256(JSON.stringify(manifest));
const shaPattern = /^[a-f0-9]{64}$/;
const allowedDownloads = new Set(["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"]);

export class PinnedOperatorReleaseError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) { super(message); }
}
function unsupported(): never {
  throw new PinnedOperatorReleaseError("pinned_release_unsupported", 404, "Pinned release updates are unavailable for this service.");
}
function unavailable(): never {
  throw new PinnedOperatorReleaseError("pinned_release_unavailable", 502, "Could not verify the published release. Try again later.");
}

interface PublicAsset { name?: string; size?: number; digest?: string; browser_download_url?: string }
interface PublicRelease {
  tag_name?: string;
  draft?: boolean;
  immutable?: boolean;
  published_at?: string;
  assets?: PublicAsset[];
}
interface ActivatedRelease {
  base: string;
  tag: string;
  executable: string;
  executableSha256: string;
}

function eligibleProvider(service: DiscoveredService) {
  const id = service.manifest.id;
  const selected = id === "@cli" || id === "@tui" ? producers[id] : undefined;
  const source = service.manifest.artifact?.source;
  if (!selected || service.manifest.role !== "provider" || service.manifest.enabled === false ||
      source?.repo !== selected.repo || source?.type !== "github-release" || source.channel ||
      source.api_base_url || !source.tag || !selected.tag.test(source.tag)) return null;
  return { ...selected, sourceTag: source.tag };
}

function provider(service: DiscoveredService) {
  return eligibleProvider(service) ?? unsupported();
}

function stateLocation(service: DiscoveredService) {
  const root = path.join(service.serviceRoot, ".state", "pinned-operator-release");
  return { root, receipt: path.join(root, "active.json") };
}

async function readActivation(service: DiscoveredService): Promise<ActivatedRelease | null> {
  const selected = provider(service);
  const { receipt } = stateLocation(service);
  const saved = await readPrivateJson(service.serviceRoot, receipt) as Partial<ActivatedRelease> | null;
  if (!saved || saved.base !== manifestFingerprint(service.manifest)) return null;
  const { base, tag, executable, executableSha256 } = saved;
  if (!base || typeof tag !== "string" || !selected.tag.test(tag) ||
      typeof executable !== "string" || !path.isAbsolute(executable) || typeof executableSha256 !== "string" ||
      !shaPattern.test(executableSha256)) unavailable();
  return { base, tag, executable, executableSha256 };
}

export async function resolveActivatedOperatorExecutable(service: DiscoveredService): Promise<string | null> {
  const selected = eligibleProvider(service);
  if (!selected) return null;
  const saved = await readActivation(service);
  if (!saved) return null;
  const { root } = stateLocation(service);
  const expectedName = selected.binary + (process.platform === "win32" ? ".exe" : "");
  const relative = path.relative(root, saved.executable).split(path.sep);
  if (relative.length !== 3 || !/^release-[a-zA-Z0-9]{6}$/.test(relative[0]) ||
      relative[1] !== "archive" || relative[2] !== expectedName ||
      await realpath(saved.executable) !== path.join(await realpath(service.serviceRoot), ".state", "pinned-operator-release", ...relative) ||
      !(await stat(saved.executable)).isFile() ||
      sha256(await readFile(saved.executable)) !== saved.executableSha256) unavailable();
  return saved.executable;
}

async function readBounded(response: Response, limit: number): Promise<Buffer> {
  if (!response.ok || !response.body) unavailable();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return Buffer.concat(chunks, size);
      size += value.length;
      if (size > limit) unavailable();
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

async function metadata<T>(route: string, deadline: AbortSignal): Promise<T> {
  const response = await fetch("https://api.github.com/repos/" + route, {
    redirect: "error", signal: AbortSignal.any([deadline, AbortSignal.timeout(12_000)]),
    headers: { accept: "application/vnd.github+json", "user-agent": "service-lasso" },
  });
  return JSON.parse((await readBounded(response, 2 * 1024 * 1024)).toString("utf8")) as T;
}

function asset(release: PublicRelease, name: string, repo: string, limit: number): Required<PublicAsset> {
  const entries = release.assets?.filter(row => row.name === name);
  const row = entries?.length === 1 ? entries[0] : undefined;
  const url = `https://github.com/${repo}/releases/download/${release.tag_name}/${name}`;
  if (!row || typeof row.size !== "number" || !Number.isSafeInteger(row.size) || row.size < 1 ||
      row.size > limit || !/^sha256:[a-f0-9]{64}$/.test(row.digest ?? "") || row.browser_download_url !== url) unavailable();
  return { name, size: row.size, digest: row.digest!, browser_download_url: url };
}

async function download(row: Required<PublicAsset>, deadline: AbortSignal): Promise<Buffer> {
  let url = new URL(row.browser_download_url);
  const signal = AbortSignal.any([deadline, AbortSignal.timeout(45_000)]);
  for (let redirects = 0; redirects < 4; redirects++) {
    if (url.protocol !== "https:" || !allowedDownloads.has(url.hostname) || url.port || url.username || url.password) unavailable();
    const response = await fetch(url, { redirect: "manual", signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) unavailable();
      url = new URL(location, url);
      continue;
    }
    const bytes = await readBounded(response, row.size);
    if (row.size !== bytes.length || row.digest !== "sha256:" + sha256(bytes)) unavailable();
    return bytes;
  }
  return unavailable();
}

async function candidateFor(service: DiscoveredService, deadline: AbortSignal) {
  const selected = provider(service);
  if (!selectArtifactPlatform(service.manifest.artifact!.platforms)) unsupported();
  const active = await readActivation(service);
  const activeExecutable = active && await resolveActivatedOperatorExecutable(service).catch(() => null);
  const currentTag = activeExecutable ? active.tag : selected.sourceTag;
  const base = manifestFingerprint(service.manifest);
  // These producer tags are prereleases, so GitHub's /latest endpoint omits them.
  const current = await metadata<PublicRelease>(selected.repo + "/releases/tags/" + currentTag, deadline);
  const publishedAt = Date.parse(current.published_at ?? "");
  if (current.tag_name !== currentTag || current.draft !== false || current.immutable !== true || !Number.isFinite(publishedAt)) unavailable();
  const releases = await metadata<PublicRelease[]>(selected.repo + "/releases?per_page=30", deadline);
  const newer = releases.filter(row => row.immutable === true && row.draft === false &&
    typeof row.tag_name === "string" && selected.tag.test(row.tag_name) && Date.parse(row.published_at ?? "") > publishedAt);
  newer.sort((a, b) => Date.parse(b.published_at!) - Date.parse(a.published_at!));
  for (const release of newer) {
    const tag = release.tag_name!;
    const manifestBytes = await download(asset(release, "service.json", selected.repo, 128 * 1024), deadline);
    const manifest = validateServiceManifest(JSON.parse(manifestBytes.toString("utf8")), "published service.json");
    const artifact = manifest.artifact;
    if (manifest.id !== service.manifest.id || manifest.role !== "provider" || manifest.enabled === false || manifest.autostart === true ||
        artifact?.source.type !== "github-release" || artifact.source.repo !== selected.repo || artifact.source.tag !== tag ||
        artifact.source.channel || artifact.source.api_base_url) unavailable();
    const platform = selectArtifactPlatform(artifact.platforms);
    if (!platform) continue;
    const command = selected.binary + (process.platform === "win32" ? ".exe" : "");
    const definition = platform.definition;
    if (definition.command !== "./" + command || definition.args?.length ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(definition.assetName ?? "") ||
        !shaPattern.test(definition.sha256 ?? "") ||
        (process.platform === "win32" ? definition.archiveType !== (service.manifest.id === "@tui" ? "zip" : "tar.gz") :
          definition.archiveType !== "tar.gz")) unavailable();
    const binaryAsset = asset(release, definition.assetName!, selected.repo, 128 * 1024 * 1024);
    if (binaryAsset.digest !== "sha256:" + definition.sha256) unavailable();
    return { currentTag, base, candidate: { tag, command, binaryAsset, archiveType: definition.archiveType } };
  }
  return { currentTag, base, candidate: null };
}

async function withSafeProviderError<T>(action: () => Promise<T>): Promise<T> {
  try { return await action(); }
  catch (error) {
    if (error instanceof PinnedOperatorReleaseError) throw error;
    return unavailable();
  }
}

export async function checkPinnedOperatorRelease(service: DiscoveredService) {
  return await withSafeProviderError(async () => {
    const { currentTag, candidate } = await candidateFor(service, AbortSignal.timeout(45_000));
    return { serviceId: service.manifest.id, currentTag, status: candidate ? "update_available" : "current",
      candidateTag: candidate?.tag ?? null };
  });
}

export async function installPinnedOperatorRelease(service: DiscoveredService, tag: string) {
  return await withSafeProviderError(async () => {
    const deadline = AbortSignal.timeout(90_000);
    const { currentTag, base, candidate } = await candidateFor(service, deadline);
    // Two tabs can confirm the same release. Selection already committed once is an idempotent success.
    if (currentTag === tag && (await readActivation(service))?.tag === tag) {
      return { serviceId: service.manifest.id, installedTag: tag };
    }
    if (candidate?.tag !== tag) {
      throw new PinnedOperatorReleaseError("pinned_release_changed", 409, "The candidate changed. Check for releases again.");
    }
    const original = await readStoredState(service.serviceRoot);
    if ((original.install as { installed?: boolean } | null)?.installed !== true ||
        (original.config as { configured?: boolean } | null)?.configured !== true) {
      throw new PinnedOperatorReleaseError("pinned_release_not_ready", 409, "Prepare the provider before updating it.");
    }
    const archive = await download(candidate.binaryAsset, deadline);
    const { root, receipt } = stateLocation(service);
    await mkdir(root, { recursive: true, mode: 0o700 });
    if (await realpath(root) !== path.join(await realpath(service.serviceRoot), ".state", "pinned-operator-release")) unavailable();
    const staging = await mkdtemp(path.join(root, "release-"));
    let committed = false;
    try {
      const extraction = path.join(staging, "archive");
      await extractUpdateArchive(archive, candidate.archiveType, extraction);
      const executable = path.join(extraction, candidate.command);
      if (await realpath(executable) !== executable || !(await stat(executable)).isFile()) unavailable();
      if (process.platform !== "win32") await chmod(executable, 0o700);
      if (manifestFingerprint(await loadServiceManifest(service.manifestPath)) !== base) {
        throw new PinnedOperatorReleaseError("pinned_release_changed", 409, "The service pin changed. Check for releases again.");
      }
      const activation = { base, tag, executable, executableSha256: sha256(await readFile(executable)) };
      await writePrivateJson(service.serviceRoot, receipt, activation);
      committed = true;
      return { serviceId: service.manifest.id, installedTag: tag };
    } finally {
      if (!committed && (await readActivation(service).catch(() => null))?.executable !== path.join(staging, "archive", candidate.command)) {
        await rm(staging, { recursive: true, force: true });
      }
    }
  });
}
