import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { assertClosedObject, expectedAssets, parseStrictJson, verifyProtectedCliBytes } from "./operator-tool-cli-contract.mjs";


function digest(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
const ASSET_DOWNLOAD_ATTEMPTS = 3;
const safeFailureDiagnostics = new WeakMap();

function releaseMetadataFailure(status) {
  const error = new Error(`operator tool release metadata failed with HTTP ${status}`);
  safeFailureDiagnostics.set(error, { boundary: "github_release_metadata", httpStatus: status });
  return error;
}

export function operatorToolFailureDiagnostic(error) {
  if ((typeof error !== "object" && typeof error !== "function") || error === null) return undefined;
  return safeFailureDiagnostics.get(error);
}

export function consumeReleaseMetadataToken(environment = process.env) {
  const token = typeof environment.SERVICE_LASSO_RELEASE_METADATA_TOKEN === "string"
    ? environment.SERVICE_LASSO_RELEASE_METADATA_TOKEN.trim()
    : "";
  delete environment.SERVICE_LASSO_RELEASE_METADATA_TOKEN;
  return token || undefined;
}

let bootstrappedReleaseMetadataToken;
export function bootstrapReleaseMetadataToken(environment = process.env) {
  bootstrappedReleaseMetadataToken = consumeReleaseMetadataToken(environment);
}
export function takeBootstrappedReleaseMetadataToken() {
  const token = bootstrappedReleaseMetadataToken;
  bootstrappedReleaseMetadataToken = undefined;
  return token;
}

function browserAssetUrl(release, name) {
  return `https://github.com/${release.repository}/releases/download/${release.tag}/${name}`;
}

// Historical mutable distribution records. They remain unchanged for custody;
// only exact historical-catalog distribution admission is allowed; protected qualification rejects them.
export const CURRENT_TUI_RELEASE = {
  repository: "service-lasso/service-lasso-tui",
  tag: "candidate-2026.9.30-0fa84ce",
  targetCommit: "0fa84ce38630e7f5b0066d2aaa103c55b0485c06",
  checksumManifest: { name: "SHA256SUMS.txt", sha256: "9b755ee6eb1929ccc5aeeb8ef0cffa3fac00c55d4c8c264baec28ffe5de58a04" },
  candidateManifest: { name: "candidate-manifest.json", sha256: "912cc766c470acd6198cb937dd8362b46608888963170d6f6123bc8152ade63b" },
  assets: [
    { platform: "win32-amd64", name: "service-lasso-tui-2026.9.30-0fa84ce-win32-amd64.zip", sha256: "ca8028e98658e7b3caddcf2bebaa4008cbe99cf43973b03d5f8086950c680f55" },
    { platform: "linux-amd64", name: "service-lasso-tui-2026.9.30-0fa84ce-linux-amd64.tar.gz", sha256: "ac915703ca0cd541073cf606bffd0f90947119032d4a6feae368bf603ff8bad7" },
    { platform: "darwin-amd64", name: "service-lasso-tui-2026.9.30-0fa84ce-darwin-amd64.tar.gz", sha256: "281dcc8e854ecf96ae1e0b0cdc54a7f6882722627e8b68338bb182cb4445bc78" },
    { platform: "darwin-arm64", name: "service-lasso-tui-2026.9.30-0fa84ce-darwin-arm64.tar.gz", sha256: "7bbda2d3b29961d6cc9726d290b21219fa4dde392db0b01b75e71939811c7af1" },
  ],
};

export const CURRENT_CLI_RELEASE = {
  repository: "service-lasso/service-lasso-cli",
  tag: "cli-v0.1.0-dev.24d756e-candidate-24d756e",
  version: "0.1.0-dev.24d756e",
  targetCommit: "24d756e3706ae06cb4858562ddd6824b1e21d886",
  asset: { name: "service-lassoctl-0.1.0-dev.24d756e.tgz", sha256: "2e9f675b1399e5f97c284ca61d508b2f70304de7aa211afcf588e9420dc47e26" },
  checksumManifest: { name: "SHA256SUMS.txt", sha256: "d8f79fa36307e5369bb452026d2b555de72c4b4121d98a0f5ff1a56d2e74f261" },
  candidateManifest: { name: "candidate.json", sha256: "6bfd8c776fb936b0bee3921fbbbe7ea7c820a3201f9361d8f64957f3f5ba1530" },
  supportedPlatforms: ["win32", "linux", "darwin"],
};

export function assertExactToolRelease(release) {
  if (release?.repository !== "service-lasso/service-lasso-tui" || !/^candidate-[0-9]{4}\.[0-9]{1,2}\.[0-9]{1,2}-[a-f0-9]{7}$/u.test(release.tag) || !/^[a-f0-9]{40}$/u.test(release.targetCommit) || !release.tag.endsWith(`-${release.targetCommit.slice(0, 7)}`)) throw new Error("operator tool release identity is incomplete");
  if (release.checksumManifest?.name !== "SHA256SUMS.txt" || !/^[a-f0-9]{64}$/u.test(release.checksumManifest.sha256) || release.candidateManifest?.name !== "candidate-manifest.json" || !/^[a-f0-9]{64}$/u.test(release.candidateManifest.sha256)) throw new Error("operator tool checksum manifest is invalid");
  const names = new Set();
  for (const asset of release.assets ?? []) {
    if (!/^(win32|linux|darwin)-(amd64|arm64)$/u.test(asset.platform) || !/^[A-Za-z0-9._-]+\.(zip|tar\.gz)$/u.test(asset.name) || !/^[a-f0-9]{64}$/u.test(asset.sha256) || names.has(asset.name)) throw new Error("operator tool asset inventory is invalid");
    names.add(asset.name);
  }
  if (names.size !== 4 || !["win32-amd64", "linux-amd64", "darwin-amd64", "darwin-arm64"].every((platform) => release.assets.some((asset) => asset.platform === platform))) throw new Error("operator tool asset inventory is incomplete");
}

export function assertExactCliRelease(release) {
  if (!Array.isArray(release?.supportedPlatforms) || release.supportedPlatforms.length !== 3 || !["win32", "linux", "darwin"].every((platform) => release.supportedPlatforms.includes(platform)) || new Set(release.supportedPlatforms).size !== release.supportedPlatforms.length) throw new Error("CLI supported platform inventory is invalid");
  if (release?.repository !== "service-lasso/service-lasso-cli" || !/^cli-v[0-9A-Za-z.-]+-candidate-[a-f0-9]{7,}$/u.test(release.tag) || !/^[0-9A-Za-z.-]+$/u.test(release.version) || !/^[a-f0-9]{40}$/u.test(release.targetCommit) || release.asset?.name !== `service-lassoctl-${release.version}.tgz` || !/^[a-f0-9]{64}$/u.test(release.asset?.sha256) || release.checksumManifest?.name !== "SHA256SUMS.txt" || !/^[a-f0-9]{64}$/u.test(release.checksumManifest?.sha256) || release.candidateManifest?.name !== "candidate.json" || !/^[a-f0-9]{64}$/u.test(release.candidateManifest?.sha256)) throw new Error("CLI release identity is invalid");
}

const HISTORICAL_TUI_RELEASE = {
  repository: "service-lasso/service-lasso-tui",
  tag: "candidate-2026.9.30-0fa84ce",
  targetCommit: "0fa84ce38630e7f5b0066d2aaa103c55b0485c06",
  checksumManifest: { name: "SHA256SUMS.txt", sha256: "9b755ee6eb1929ccc5aeeb8ef0cffa3fac00c55d4c8c264baec28ffe5de58a04" },
  candidateManifest: { name: "candidate-manifest.json", sha256: "912cc766c470acd6198cb937dd8362b46608888963170d6f6123bc8152ade63b" },
  assets: [
    { platform: "win32-amd64", name: "service-lasso-tui-2026.9.30-0fa84ce-win32-amd64.zip", sha256: "ca8028e98658e7b3caddcf2bebaa4008cbe99cf43973b03d5f8086950c680f55" },
    { platform: "linux-amd64", name: "service-lasso-tui-2026.9.30-0fa84ce-linux-amd64.tar.gz", sha256: "ac915703ca0cd541073cf606bffd0f90947119032d4a6feae368bf603ff8bad7" },
    { platform: "darwin-amd64", name: "service-lasso-tui-2026.9.30-0fa84ce-darwin-amd64.tar.gz", sha256: "281dcc8e854ecf96ae1e0b0cdc54a7f6882722627e8b68338bb182cb4445bc78" },
    { platform: "darwin-arm64", name: "service-lasso-tui-2026.9.30-0fa84ce-darwin-arm64.tar.gz", sha256: "7bbda2d3b29961d6cc9726d290b21219fa4dde392db0b01b75e71939811c7af1" },
  ],
};

const HISTORICAL_CLI_RELEASE = {
  repository: "service-lasso/service-lasso-cli",
  tag: "cli-v0.1.0-dev.24d756e-candidate-24d756e",
  version: "0.1.0-dev.24d756e",
  targetCommit: "24d756e3706ae06cb4858562ddd6824b1e21d886",
  asset: { name: "service-lassoctl-0.1.0-dev.24d756e.tgz", sha256: "2e9f675b1399e5f97c284ca61d508b2f70304de7aa211afcf588e9420dc47e26" },
  checksumManifest: { name: "SHA256SUMS.txt", sha256: "d8f79fa36307e5369bb452026d2b555de72c4b4121d98a0f5ff1a56d2e74f261" },
  candidateManifest: { name: "candidate.json", sha256: "6bfd8c776fb936b0bee3921fbbbe7ea7c820a3201f9361d8f64957f3f5ba1530" },
  supportedPlatforms: ["win32", "linux", "darwin"],
};

// Capture the original closed catalog independently of caller/retained objects.
// Historical admission cannot be requested with a flag or a new mutable tuple.
function catalogIdentity(release, cli) {
  return JSON.stringify({ repository: release?.repository, tag: release?.tag, targetCommit: release?.targetCommit,
    version: cli ? release?.version : undefined,
    checksumManifest: { name: release?.checksumManifest?.name, sha256: release?.checksumManifest?.sha256 },
    candidateManifest: { name: release?.candidateManifest?.name, sha256: release?.candidateManifest?.sha256 },
    assets: cli ? [{ name: release?.asset?.name, sha256: release?.asset?.sha256 }] : release?.assets?.map(asset => ({ platform: asset?.platform, name: asset?.name, sha256: asset?.sha256 })),
    supportedPlatforms: cli ? release?.supportedPlatforms : undefined });
}
const HISTORICAL_TUI_IDENTITY = catalogIdentity(HISTORICAL_TUI_RELEASE, false);
const HISTORICAL_CLI_IDENTITY = catalogIdentity(HISTORICAL_CLI_RELEASE, true);
function isHistoricalRelease(release, cli = false) {
  return !release?.developmentManifest && (!cli || !release?.assets || (release.assets.length === 1 && release.assets[0]?.name === release.asset?.name && release.assets[0]?.sha256 === release.asset?.sha256)) && catalogIdentity(release, cli) === (cli ? HISTORICAL_CLI_IDENTITY : HISTORICAL_TUI_IDENTITY);
}

function assertProtectedCliRelease(release) {
  assertExactCliRelease(release);
  if (!/^\d+\.\d+\.\d+-dev\.[a-f0-9]{7}$/u.test(release.version) || release.version.split("dev.")[1] !== release.targetCommit.slice(0, 7) || release.tag !== `cli-v${release.version}-candidate-${release.targetCommit.slice(0, 7)}` || release.developmentManifest?.name !== "development-candidate.json" || !/^[a-f0-9]{64}$/u.test(release.developmentManifest.sha256)) throw new Error("CLI protected release identity is invalid; historical portable pins are ineligible");
  const expected = expectedAssets(release.version);
  if (!Array.isArray(release.assets) || release.assets.length !== expected.length || new Set(release.assets.map(asset => asset?.name)).size !== expected.length) throw new Error("CLI protected release inventory is incomplete");
  for (const wanted of expected) {
    const asset = release.assets.find(item => item?.name === wanted.name);
    if (!asset || asset.kind !== wanted.kind || asset.target !== wanted.target || !/^[a-f0-9]{64}$/u.test(asset.sha256) || !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > 256 * 1024 * 1024) throw new Error("CLI protected release inventory is invalid");
  }
  if (release.assets.find(asset => asset.name === release.asset.name)?.sha256 !== release.asset.sha256 || release.assets.find(asset => asset.name === release.candidateManifest.name)?.sha256 !== release.candidateManifest.sha256) throw new Error("CLI portable pin differs from protected inventory");
}

function cliPublishedAssets(release) { return [...release.assets, release.developmentManifest, release.checksumManifest]; }

// Publication authority is owned by reviewed source, never by retained bytes,
// callers, ENV or fixtures. Populate only in a separately reviewed pins-only
// change after real qualified immutable publication and same-public-byte proof.
const APPROVED_PROTECTED_IDENTITIES = Object.freeze({
  "service-lassoctl": Object.freeze([]),
  "service-lasso-tui": Object.freeze([]),
});
function protectedCatalogIdentity(tool) {
  const cli = tool.command === "service-lassoctl";
  return JSON.stringify({ catalog: catalogIdentity(tool, cli),
    developmentManifest: cli ? { name: tool.developmentManifest?.name, sha256: tool.developmentManifest?.sha256 } : undefined,
    inventory: cli ? tool.assets?.map(asset => ({ name: asset?.name, kind: asset?.kind, target: asset?.target, sha256: asset?.sha256, size: asset?.size })) : undefined });
}

async function readGitHubToolMetadata(fetchImpl, release, route, token) {
  // Only closed fixed repositories and source-derived read-only routes receive
  // this credential; never trust a provider object's URL or follow redirects.
  if (!["service-lasso/service-lasso-cli", "service-lasso/service-lasso-tui"].includes(release.repository) ||
      (![ `/releases/tags/${release.tag}`, `/git/ref/tags/${release.tag}` ].includes(route) && !/^\/git\/tags\/[a-f0-9]{40}$/u.test(route))) throw new Error("operator tool metadata route is invalid");
  const response = await fetchImpl(`https://api.github.com/repos/${release.repository}${route}`, {
    redirect: "error",
    headers: token ? { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" } : { accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw releaseMetadataFailure(response.status);
  return parseStrictJson(Buffer.from(await response.arrayBuffer()), "operator tool release metadata");
}

async function assertGitHubToolTag(fetchImpl, release, token) {
  const ref = await readGitHubToolMetadata(fetchImpl, release, `/git/ref/tags/${release.tag}`, token);
  if (ref?.ref !== `refs/tags/${release.tag}`) throw new Error("operator tool tag ref identity is malformed");
  let object = ref.object;
  const visited = new Set();
  for (let depth = 0; depth <= 16; depth += 1) {
    if (!object || !/^[a-f0-9]{40}$/u.test(object.sha) || !["commit", "tag"].includes(object.type) || visited.has(object.sha)) throw new Error("operator tool tag object identity is malformed or cyclic");
    visited.add(object.sha);
    if (object.type === "commit") {
      if (object.sha !== release.targetCommit) throw new Error("operator tool tag source identity mismatch");
      return;
    }
    if (depth === 16) throw new Error("operator tool tag identity depth exceeded");
    const tag = await readGitHubToolMetadata(fetchImpl, release, `/git/tags/${object.sha}`, token);
    if (tag?.sha !== object.sha) throw new Error("operator tool annotated tag object identity mismatch");
    object = tag.object;
  }
  throw new Error("operator tool tag identity unresolved");
}

async function downloadExact(fetchImpl, url, expected) {
  const initial = new URL(url);
  if (initial.protocol !== "https:" || initial.hostname !== "github.com" || !/^\/service-lasso\/[A-Za-z0-9._-]+\/releases\/download\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/u.test(initial.pathname)) throw new Error("operator tool download URL is not an exact GitHub release asset URL");
  for (let attempt = 0; attempt < ASSET_DOWNLOAD_ATTEMPTS; attempt += 1) {
    let current = new URL(initial);
    let response;
    for (let redirects = 0; redirects < 4; redirects++) {
      response = await fetchImpl(current, { redirect: "manual" });
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get("location");
      if (!location) throw new Error("operator tool redirect is missing a location");
      const next = new URL(location, current);
      if (next.protocol !== "https:" || !(next.hostname === "github.com" || next.hostname.endsWith(".githubusercontent.com"))) throw new Error("operator tool redirect target is not an allowed GitHub asset host");
      current = next;
    }
    if (response.ok) {
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length || digest(bytes) !== expected) throw new Error("operator tool checksum mismatch");
      return bytes;
    }
    if (response.status < 500 || response.status > 599 || attempt === ASSET_DOWNLOAD_ATTEMPTS - 1) throw new Error(`operator tool download failed with HTTP ${response.status}`);
    await delay(100 * (attempt + 1));
  }
  throw new Error("operator tool download exhausted retries");
}

function parseCandidateManifest(bytes, name) {
  try {
    const parsed = parseStrictJson(bytes, name);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed;
  } catch {
    throw new Error(`${name} candidate manifest is not valid JSON`);
  }
}

function assertTuiCandidateManifest(bytes, release) {
  const candidate = parseCandidateManifest(bytes, "TUI");
  if (isHistoricalRelease(release)) {
    if (candidate.schemaVersion !== 1 || candidate.kind !== "develop-prerelease-candidate" || candidate.source?.repository !== release.repository || candidate.source?.commit !== release.targetCommit || candidate.release?.tag !== release.tag || candidate.release?.prerelease !== true || candidate.checksumManifest?.name !== release.checksumManifest.name || candidate.checksumManifest?.sha256 !== release.checksumManifest.sha256 || !Array.isArray(candidate.assets) || candidate.assets.length !== release.assets.length) throw new Error("historical TUI candidate manifest does not match the catalog");
    const listed = new Map(candidate.assets.map(asset => [asset?.name, asset]));
    if (listed.size !== release.assets.length || release.assets.some(asset => listed.get(asset.name)?.platform !== asset.platform || listed.get(asset.name)?.sha256 !== asset.sha256)) throw new Error("historical TUI candidate inventory does not match the catalog");
    return;
  }
  assertClosedObject(candidate, ["assets", "checksumManifest", "corePackagingIssue", "kind", "release", "schemaVersion", "source", "version"], "TUI candidate manifest");
  assertClosedObject(candidate.source, ["commit", "ref", "repository"], "TUI source");
  assertClosedObject(candidate.release, ["draft", "immutable", "prerelease", "tag"], "TUI release");
  assertClosedObject(candidate.checksumManifest, ["name", "sha256"], "TUI checksum manifest");
  if (candidate.schemaVersion !== 2 || candidate.kind !== "develop-prerelease-candidate" || candidate.corePackagingIssue !== "service-lasso/service-lasso#1461" || candidate.version !== release.tag.slice("candidate-".length) || candidate.source?.ref !== "refs/heads/develop" || candidate.source?.repository !== release.repository || candidate.source?.commit !== release.targetCommit || candidate.release?.tag !== release.tag || candidate.release?.prerelease !== true || candidate.release?.draft !== false || candidate.release?.immutable !== true || candidate.checksumManifest?.name !== release.checksumManifest.name || candidate.checksumManifest?.sha256 !== release.checksumManifest.sha256 || !Array.isArray(candidate.assets) || candidate.assets.length !== release.assets.length) throw new Error("TUI candidate manifest does not match the pinned release identity");
  for (const asset of candidate.assets) {
    assertClosedObject(asset, ["executable", "name", "platform", "sha256"], "TUI asset");
    const extension = asset.platform === "win32-amd64" ? "zip" : "tar.gz";
    if (asset.name !== `service-lasso-tui-${candidate.version}-${asset.platform}.${extension}` || asset.executable !== (asset.platform === "win32-amd64" ? "service-lasso-tui.exe" : "service-lasso-tui")) throw new Error("TUI candidate manifest platform identity is invalid");
  }
  const candidateAssets = new Map(candidate.assets.map((asset) => [asset?.name, asset]));
  if (candidateAssets.size !== candidate.assets.length || release.assets.some((asset) => candidateAssets.get(asset.name)?.platform !== asset.platform || candidateAssets.get(asset.name)?.sha256 !== asset.sha256)) throw new Error("TUI candidate manifest asset inventory does not match the pinned release");
}

function assertCliCandidateManifest(bytes, release) {
  const candidate = parseCandidateManifest(bytes, "CLI");
  if (candidate.schemaVersion !== 1 || candidate.candidateTag !== release.tag || candidate.version !== release.version || candidate.source?.repository !== release.repository || candidate.source?.commit !== release.targetCommit || candidate.package?.command !== "service-lassoctl" || candidate.package?.node !== ">=22.12.0" || !Array.isArray(candidate.platforms) || candidate.platforms.length !== release.supportedPlatforms.length || !release.supportedPlatforms.every((platform) => candidate.platforms.includes(platform)) || !Array.isArray(candidate.assets) || candidate.assets.length !== 1 || candidate.assets[0]?.name !== release.asset.name || candidate.assets[0]?.sha256 !== release.asset.sha256) throw new Error("CLI candidate manifest does not match the pinned release identity");
}

function assertChecksumManifest(bytes, assets) {
  const entries = new Map();
  for (const line of bytes.toString("utf8").split(/\r?\n/u).filter(Boolean)) {
    const match = line.match(/^([a-f0-9]{64})\s+\*?([A-Za-z0-9._-]+)$/u);
    if (!match || entries.has(match[2])) throw new Error("operator tool checksum manifest is malformed or contains duplicate assets");
    entries.set(match[2], match[1]);
  }
  if (entries.size !== assets.length || assets.some((asset) => entries.get(asset.name) !== asset.sha256)) throw new Error("operator tool checksum manifest does not match the pinned asset inventory");
}

// External tools are retained as verified release archives. Core does not run,
// extract, supervise, catalogue, or otherwise manage them. The caller extracts
// the selected platform archive and starts the TUI in its own terminal.
async function assertGitHubRelease(fetchImpl, release, expectedAssets, releaseMetadataToken) {
  const token = typeof releaseMetadataToken === "string" ? releaseMetadataToken.trim() : "";
  const metadata = await readGitHubToolMetadata(fetchImpl, release, `/releases/tags/${release.tag}`, token);
  const historical = isHistoricalRelease(release, release.repository === "service-lasso/service-lasso-cli");
  if (metadata.tag_name !== release.tag || metadata.target_commitish !== release.targetCommit || metadata.prerelease !== true || metadata.draft !== false || metadata.immutable !== !historical) throw new Error("operator tool release metadata does not match the pinned immutable candidate identity or exact historical catalog");
  if (!Array.isArray(metadata.assets) || metadata.assets.length !== expectedAssets.length) throw new Error("operator tool release metadata asset inventory does not match the pinned manifest");
  const actual = new Map();
  for (const asset of metadata.assets) {
    if (!/^[A-Za-z0-9._-]+$/u.test(asset?.name) || !/^sha256:[a-f0-9]{64}$/u.test(asset?.digest) || !new RegExp(`^https://api\\.github\\.com/repos/${release.repository}/releases/assets/[1-9][0-9]*$`, "u").test(asset?.url ?? "") || actual.has(asset.name)) throw new Error("operator tool release metadata asset inventory is malformed or contains duplicates");
    actual.set(asset.name, asset);
  }
  if (expectedAssets.some((asset) => actual.get(asset.name)?.digest !== `sha256:${asset.sha256}`)) throw new Error("operator tool release metadata asset inventory does not match the pinned manifest");
  await assertGitHubToolTag(fetchImpl, release, token);
  return actual;
}

export async function stageOperatorTools({ artifactRoot, fetchImpl = fetch, release = CURRENT_TUI_RELEASE, cliRelease = CURRENT_CLI_RELEASE, releaseMetadataToken } = {}) {
	await mkdir(path.join(artifactRoot, "operator-tools"), { recursive: true });
  const assets = [];
  let tuiTool = { command: "service-lasso-tui", status: "unavailable", reason: "No current reviewed checksum-bound TUI release is pinned." };
  if (release) {
    assertExactToolRelease(release);
    const releaseAssets = await assertGitHubRelease(fetchImpl, release, [...release.assets, release.checksumManifest, release.candidateManifest], releaseMetadataToken);
    const root = path.join(artifactRoot, "operator-tools", "service-lasso-tui");
    await mkdir(root, { recursive: true });
    const checksum = await downloadExact(fetchImpl, browserAssetUrl(release, release.checksumManifest.name), release.checksumManifest.sha256);
    assertChecksumManifest(checksum, release.assets);
    await writeFile(path.join(root, release.checksumManifest.name), checksum);
    const candidateManifest = await downloadExact(fetchImpl, browserAssetUrl(release, release.candidateManifest.name), release.candidateManifest.sha256);
    assertTuiCandidateManifest(candidateManifest, release);
    await writeFile(path.join(root, release.candidateManifest.name), candidateManifest);
    for (const asset of release.assets) {
      const bytes = await downloadExact(fetchImpl, browserAssetUrl(release, asset.name), asset.sha256);
      const relativePath = path.posix.join("operator-tools", "service-lasso-tui", asset.name);
      await writeFile(path.join(artifactRoot, relativePath), bytes);
      assets.push({ ...asset, relativePath });
    }
    tuiTool = { command: "service-lasso-tui", status: "available", receiptKind: isHistoricalRelease(release) ? "historical-mutable" : "protected-immutable", mode: "caller-attached-terminal", repository: release.repository, tag: release.tag, targetCommit: release.targetCommit, checksumManifest: { ...release.checksumManifest, relativePath: "operator-tools/service-lasso-tui/SHA256SUMS.txt" }, candidateManifest: { ...release.candidateManifest, relativePath: "operator-tools/service-lasso-tui/candidate-manifest.json" }, assets };
  }
  let cliTool = { command: "service-lassoctl", status: "unavailable", reason: "No current reviewed checksum-bound CLI release is pinned." };
  if (cliRelease) {
    if (isHistoricalRelease(cliRelease, true)) {
      assertExactCliRelease(cliRelease);
      const inventory = [cliRelease.asset, cliRelease.candidateManifest, cliRelease.checksumManifest];
      await assertGitHubRelease(fetchImpl, cliRelease, inventory, releaseMetadataToken);
      const held = new Map();
      for (const asset of inventory) held.set(asset.name, await downloadExact(fetchImpl, browserAssetUrl(cliRelease, asset.name), asset.sha256));
      assertChecksumManifest(held.get("SHA256SUMS.txt"), [cliRelease.asset, cliRelease.candidateManifest]);
      assertCliCandidateManifest(held.get("candidate.json"), cliRelease);
      const root = path.join(artifactRoot, "operator-tools", "service-lassoctl");
      await mkdir(root, { recursive: true });
      for (const [name, bytes] of held) await writeFile(path.join(root, name), bytes);
      const retained = asset => ({ ...asset, relativePath: path.posix.join("operator-tools", "service-lassoctl", asset.name) });
      cliTool = { command: "service-lassoctl", status: "available", receiptKind: "historical-mutable", mode: "caller-invoked", repository: cliRelease.repository, tag: cliRelease.tag, targetCommit: cliRelease.targetCommit, version: cliRelease.version, asset: cliRelease.asset, candidateManifest: retained(cliRelease.candidateManifest), checksumManifest: retained(cliRelease.checksumManifest), supportedPlatforms: [...cliRelease.supportedPlatforms], assets: [retained(cliRelease.asset)] };
    } else {
      assertProtectedCliRelease(cliRelease);
      const cliRoot = path.join(artifactRoot, "operator-tools", "service-lassoctl");
      const inventory = cliPublishedAssets(cliRelease);
      await assertGitHubRelease(fetchImpl, cliRelease, inventory, releaseMetadataToken);
      const held = new Map();
      for (const asset of inventory) held.set(asset.name, await downloadExact(fetchImpl, browserAssetUrl(cliRelease, asset.name), asset.sha256));
      const protectedManifest = verifyProtectedCliBytes(held, cliRelease.version, cliRelease.targetCommit);
      if (protectedManifest.assets.some(asset => cliRelease.assets.find(pin => pin.name === asset.name)?.size !== asset.size || cliRelease.assets.find(pin => pin.name === asset.name)?.sha256 !== asset.sha256)) throw new Error("CLI protected manifest differs from pinned inventory");
      await mkdir(cliRoot, { recursive: true });
      for (const [name, bytes] of held) await writeFile(path.join(cliRoot, name), bytes);
      const retained = asset => ({ ...asset, relativePath: path.posix.join("operator-tools", "service-lassoctl", asset.name) });
      cliTool = { command: "service-lassoctl", status: "available", receiptKind: "protected-immutable", mode: "caller-invoked", repository: cliRelease.repository, tag: cliRelease.tag, targetCommit: cliRelease.targetCommit, version: cliRelease.version, asset: cliRelease.asset, checksumManifest: retained(cliRelease.checksumManifest), candidateManifest: retained(cliRelease.candidateManifest), developmentManifest: retained(cliRelease.developmentManifest), supportedPlatforms: [...cliRelease.supportedPlatforms], assets: cliRelease.assets.map(retained) };
    }
  }
  const manifest = {
    schemaVersion: "service-lasso.operator-tools.v2",
    tools: [
      cliTool,
      tuiTool,
    ],
  };
  await writeFile(path.join(artifactRoot, "operator-tools", "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function resolveRetainedPath(artifactRoot, relativePath) {
  if (typeof relativePath !== "string" || !relativePath) throw new Error("operator tool retained path is invalid");
  const resolved = path.resolve(artifactRoot, relativePath);
  const relative = path.relative(artifactRoot, resolved);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("operator tool retained path escapes the artifact root");
  return resolved;
}

async function readRetainedBytes(artifactRoot, relativePath) {
  const retainedPath = resolveRetainedPath(artifactRoot, relativePath);
  let ancestor = path.dirname(retainedPath);
  while (ancestor !== path.resolve(artifactRoot)) {
    const directory = await lstat(ancestor);
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error("operator tool retained parent is not a regular directory");
    ancestor = path.dirname(ancestor);
  }
  const retainedStat = await lstat(retainedPath);
  if (!retainedStat.isFile() || retainedStat.isSymbolicLink()) throw new Error("operator tool retained asset is not a regular file");
  return readFile(retainedPath);
}

export function assertProtectedOperatorTools(manifest) {
  if (!Array.isArray(manifest?.tools) || manifest.tools.length !== 2 || new Set(manifest.tools.map(tool => tool.command)).size !== 2 || !manifest.tools.every(tool => ["service-lassoctl", "service-lasso-tui"].includes(tool.command) && tool.status === "available" && tool.receiptKind === "protected-immutable")) throw new Error("protected operator-tool qualification requires actual immutable candidate pins; historical distribution is ineligible");
  if (!manifest.tools.every(tool => !isHistoricalRelease(tool, tool.command === "service-lassoctl") && APPROVED_PROTECTED_IDENTITIES[tool.command].includes(protectedCatalogIdentity(tool)))) throw new Error("protected operator-tool qualification requires source-approved immutable publication catalog identities; catalog is empty until real qualification and public same-byte admission");
}

export async function verifyRetainedOperatorTools({ artifactRoot, requireProtected = false } = {}) {
  const result = await validateRetainedOperatorToolBytes({ artifactRoot });
  if (requireProtected) assertProtectedOperatorTools(result.manifest);
  return result;
}

// Observational consistency only. This entrypoint never grants protected
// eligibility, even when producer-shaped records declare immutable publication.
export async function validateRetainedOperatorToolBytes({ artifactRoot } = {}) {
  const manifestBytes = await readRetainedBytes(artifactRoot, "operator-tools/manifest.json");
  const manifest = parseCandidateManifest(manifestBytes, "operator tools");
  if (manifest.schemaVersion !== "service-lasso.operator-tools.v2" || !Array.isArray(manifest.tools) || manifest.tools.length !== 2) throw new Error("operator tools manifest is invalid");
  const tools = new Map(manifest.tools.map((tool) => [tool?.command, tool]));
  if (tools.size !== 2 || tools.get("service-lassoctl")?.status !== "available" || tools.get("service-lasso-tui")?.status !== "available") throw new Error("operator tools manifest availability is invalid");
  const tui = tools.get("service-lasso-tui");
  const cli = tools.get("service-lassoctl");
  for (const [tool, isCli] of [[tui, false], [cli, true]]) {
    const historical = isHistoricalRelease(tool, isCli);
    if (tool.receiptKind !== (historical ? "historical-mutable" : "protected-immutable")) throw new Error("operator tool retained receipt kind does not match catalog authority");
  }
  assertExactToolRelease({ repository: tui.repository, tag: tui.tag, targetCommit: tui.targetCommit, checksumManifest: tui.checksumManifest, candidateManifest: tui.candidateManifest, assets: tui.assets });
  const historicalCli = isHistoricalRelease(cli, true);
  if (historicalCli) assertExactCliRelease(cli); else assertProtectedCliRelease(cli);
  if (cli.candidateManifest.relativePath !== "operator-tools/service-lassoctl/candidate.json") throw new Error("CLI portable record path is noncanonical");
  for (const [, directory, inventory] of [[tui, "service-lasso-tui", [...tui.assets, tui.checksumManifest, tui.candidateManifest]], [cli, "service-lassoctl", historicalCli ? [...cli.assets, cli.candidateManifest, cli.checksumManifest] : cliPublishedAssets(cli)]]) {
    const directoryStat = await lstat(path.join(artifactRoot, "operator-tools", directory));
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error("operator tool retained directory is not regular");
    const names = new Set(inventory.map(asset => asset.name));
    const entries = await readdir(path.join(artifactRoot, "operator-tools", directory), { withFileTypes: true });
    if (entries.length !== names.size || entries.some(entry => !entry.isFile() || !names.has(entry.name))) throw new Error("operator tool retained file inventory is not closed");
  }
  const tuiSums = await readRetainedBytes(artifactRoot, tui.checksumManifest.relativePath);
  const tuiCandidate = await readRetainedBytes(artifactRoot, tui.candidateManifest.relativePath);
  assertChecksumManifest(tuiSums, tui.assets);
  assertTuiCandidateManifest(tuiCandidate, tui);
  const cliHeld = new Map();
  for (const asset of historicalCli ? [...cli.assets, cli.candidateManifest, cli.checksumManifest] : cliPublishedAssets(cli)) {
    if (asset.relativePath !== path.posix.join("operator-tools", "service-lassoctl", asset.name)) throw new Error("CLI retained path is noncanonical");
    const bytes = await readRetainedBytes(artifactRoot, asset.relativePath);
    if (digest(bytes) !== asset.sha256) throw new Error("operator tool retained asset checksum mismatch");
    cliHeld.set(asset.name, bytes);
  }
  if (historicalCli) {
    assertChecksumManifest(cliHeld.get("SHA256SUMS.txt"), [...cli.assets, cli.candidateManifest]);
    assertCliCandidateManifest(cliHeld.get("candidate.json"), { ...cli, asset: cli.assets[0] });
  } else {
    const candidate = verifyProtectedCliBytes(cliHeld, cli.version, cli.targetCommit);
    if (candidate.assets.some(asset => cli.assets.find(pin => pin.name === asset.name)?.size !== asset.size || cli.assets.find(pin => pin.name === asset.name)?.sha256 !== asset.sha256)) throw new Error("CLI retained protected inventory differs from manifest");
  }
  for (const asset of [...tui.assets, tui.checksumManifest, tui.candidateManifest]) {
    if (asset.relativePath !== path.posix.join("operator-tools", "service-lasso-tui", asset.name)) throw new Error("TUI retained path is noncanonical");
    const bytes = await readRetainedBytes(artifactRoot, asset.relativePath);
    if (digest(bytes) !== asset.sha256) throw new Error("operator tool retained asset checksum mismatch");
  }
  return { manifest, tuiAssets: tui.assets.map((asset) => asset.relativePath), cliAssets: cli.assets.map((asset) => asset.relativePath) };
}
