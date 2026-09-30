import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";


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

// These records are checksum-bound GitHub candidate releases. Staging re-reads the
// release API and every retained byte before they can enter a Core artifact.
export const CURRENT_TUI_RELEASE = {
  repository: "service-lasso/service-lasso-tui",
  tag: "candidate-2026.9.30-97fafb0",
  targetCommit: "97fafb04c69fce8efdd245eb186e6dfb9915485d",
  checksumManifest: { name: "SHA256SUMS.txt", sha256: "638ad5e54e06dcb894a4579872e788ddc4521cd3ffca46fb06574c8b78de1cf5" },
  candidateManifest: { name: "candidate-manifest.json", sha256: "efaa8ed7d433ef6aee4f800efc9b0880a4ae7fa989012bd90191d6afc2cfea04" },
  assets: [
    { platform: "win32-amd64", name: "service-lasso-tui-2026.9.30-97fafb0-win32-amd64.zip", sha256: "b8838f245d4b1d39cac0b51ed2ad14ffd0237779f1a5e9d3e61358066370e479" },
    { platform: "linux-amd64", name: "service-lasso-tui-2026.9.30-97fafb0-linux-amd64.tar.gz", sha256: "238a8e3f92ae5f9cf28c5cd29af91b698addb9bfa546a7b31c7f7a71b7c33e70" },
    { platform: "darwin-amd64", name: "service-lasso-tui-2026.9.30-97fafb0-darwin-amd64.tar.gz", sha256: "5d6df8cfa18771e159b7af34c1c5c00d70ae5eef1ddf727896ae2afb30b63638" },
    { platform: "darwin-arm64", name: "service-lasso-tui-2026.9.30-97fafb0-darwin-arm64.tar.gz", sha256: "a9523555416a1b332107a9a92cfecc2aa3b7cdd23caab1063540496e4e20b33c" },
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
  if (release?.repository !== "service-lasso/service-lasso-tui" || !/^candidate-[0-9.]+-[a-f0-9]{7,}$/u.test(release.tag) || !/^[a-f0-9]{40}$/u.test(release.targetCommit)) throw new Error("operator tool release identity is incomplete");
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
    const parsed = JSON.parse(bytes.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed;
  } catch {
    throw new Error(`${name} candidate manifest is not valid JSON`);
  }
}

function assertTuiCandidateManifest(bytes, release) {
  const candidate = parseCandidateManifest(bytes, "TUI");
  if (candidate.schemaVersion !== 1 || candidate.kind !== "develop-prerelease-candidate" || candidate.source?.repository !== release.repository || candidate.source?.commit !== release.targetCommit || candidate.release?.tag !== release.tag || candidate.release?.prerelease !== true || candidate.checksumManifest?.name !== release.checksumManifest.name || candidate.checksumManifest?.sha256 !== release.checksumManifest.sha256 || !Array.isArray(candidate.assets) || candidate.assets.length !== release.assets.length) throw new Error("TUI candidate manifest does not match the pinned release identity");
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
  // This request is always the fixed GitHub REST release endpoint. Asset fetches
  // intentionally receive no headers, including after their allowed redirects.
  const response = await fetchImpl(`https://api.github.com/repos/${release.repository}/releases/tags/${release.tag}`, {
    redirect: "error",
    headers: token ? { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" } : { accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw releaseMetadataFailure(response.status);
  const metadata = await response.json();
  if (metadata.tag_name !== release.tag || metadata.target_commitish !== release.targetCommit || metadata.prerelease !== true || metadata.draft !== false) throw new Error("operator tool release metadata does not match the pinned candidate identity");
  if (!Array.isArray(metadata.assets) || metadata.assets.length !== expectedAssets.length) throw new Error("operator tool release metadata asset inventory does not match the pinned manifest");
  const actual = new Map();
  for (const asset of metadata.assets) {
    if (!/^[A-Za-z0-9._-]+$/u.test(asset?.name) || !/^sha256:[a-f0-9]{64}$/u.test(asset?.digest) || !/^https:\/\/api\.github\.com\/repos\/service-lasso\/[A-Za-z0-9._-]+\/releases\/assets\/\d+$/u.test(asset?.url ?? "") || actual.has(asset.name)) throw new Error("operator tool release metadata asset inventory is malformed or contains duplicates");
    actual.set(asset.name, asset);
  }
  if (expectedAssets.some((asset) => actual.get(asset.name)?.digest !== `sha256:${asset.sha256}`)) throw new Error("operator tool release metadata asset inventory does not match the pinned manifest");
  return actual;
}

export async function stageOperatorTools({ artifactRoot, fetchImpl = fetch, release = CURRENT_TUI_RELEASE, cliRelease = CURRENT_CLI_RELEASE, releaseMetadataToken } = {}) {
	await mkdir(path.join(artifactRoot, "operator-tools"), { recursive: true });
  const assets = [];
  let tuiTool = { command: "service-lasso-tui", status: "unavailable", reason: "No current reviewed immutable TUI release is pinned." };
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
    tuiTool = { command: "service-lasso-tui", status: "available", mode: "caller-attached-terminal", repository: release.repository, tag: release.tag, targetCommit: release.targetCommit, checksumManifest: { ...release.checksumManifest, relativePath: "operator-tools/service-lasso-tui/SHA256SUMS.txt" }, candidateManifest: { ...release.candidateManifest, relativePath: "operator-tools/service-lasso-tui/candidate-manifest.json" }, assets };
  }
  let cliTool = { command: "service-lassoctl", status: "unavailable", reason: "No current reviewed checksum-bound CLI release is pinned." };
  if (cliRelease) {
  const cliRoot = path.join(artifactRoot, "operator-tools", "service-lassoctl");
  assertExactCliRelease(cliRelease);
  const cliAssets = await assertGitHubRelease(fetchImpl, cliRelease, [cliRelease.asset, cliRelease.checksumManifest, cliRelease.candidateManifest], releaseMetadataToken);
  await mkdir(cliRoot, { recursive: true });
  const cliSums = await downloadExact(fetchImpl, browserAssetUrl(cliRelease, cliRelease.checksumManifest.name), cliRelease.checksumManifest.sha256);
  assertChecksumManifest(cliSums, [cliRelease.asset, cliRelease.candidateManifest]);
  await writeFile(path.join(cliRoot, cliRelease.checksumManifest.name), cliSums);
  const cliCandidateManifest = await downloadExact(fetchImpl, browserAssetUrl(cliRelease, cliRelease.candidateManifest.name), cliRelease.candidateManifest.sha256);
  assertCliCandidateManifest(cliCandidateManifest, cliRelease);
  await writeFile(path.join(cliRoot, cliRelease.candidateManifest.name), cliCandidateManifest);
  const cliBytes = await downloadExact(fetchImpl, browserAssetUrl(cliRelease, cliRelease.asset.name), cliRelease.asset.sha256);
  const cliRelativePath = path.posix.join("operator-tools", "service-lassoctl", cliRelease.asset.name);
  await writeFile(path.join(artifactRoot, cliRelativePath), cliBytes);
  cliTool = { command: "service-lassoctl", status: "available", mode: "caller-invoked", repository: cliRelease.repository, tag: cliRelease.tag, targetCommit: cliRelease.targetCommit, checksumManifest: { ...cliRelease.checksumManifest, relativePath: "operator-tools/service-lassoctl/SHA256SUMS.txt" }, candidateManifest: { ...cliRelease.candidateManifest, relativePath: "operator-tools/service-lassoctl/candidate.json" }, supportedPlatforms: [...cliRelease.supportedPlatforms], assets: [{ ...cliRelease.asset, relativePath: cliRelativePath }] };
  }
  const manifest = {
    schemaVersion: "service-lasso.operator-tools.v1",
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
  const retainedStat = await lstat(retainedPath);
  if (!retainedStat.isFile() || retainedStat.isSymbolicLink()) throw new Error("operator tool retained asset is not a regular file");
  return readFile(retainedPath);
}

export async function verifyRetainedOperatorTools({ artifactRoot } = {}) {
  const manifestBytes = await readRetainedBytes(artifactRoot, "operator-tools/manifest.json");
  const manifest = parseCandidateManifest(manifestBytes, "operator tools");
  if (manifest.schemaVersion !== "service-lasso.operator-tools.v1" || !Array.isArray(manifest.tools) || manifest.tools.length !== 2) throw new Error("operator tools manifest is invalid");
  const tools = new Map(manifest.tools.map((tool) => [tool?.command, tool]));
  if (tools.size !== 2 || tools.get("service-lassoctl")?.status !== "available" || tools.get("service-lasso-tui")?.status !== "available") throw new Error("operator tools manifest availability is invalid");
  const tui = tools.get("service-lasso-tui");
  const cli = tools.get("service-lassoctl");
  assertExactToolRelease({ repository: tui.repository, tag: tui.tag, targetCommit: tui.targetCommit, checksumManifest: tui.checksumManifest, candidateManifest: tui.candidateManifest, assets: tui.assets });
  const cliCandidateBytes = await readRetainedBytes(artifactRoot, cli.candidateManifest.relativePath);
  const cliCandidate = parseCandidateManifest(cliCandidateBytes, "CLI");
  assertExactCliRelease({ repository: cli.repository, tag: cli.tag, version: cliCandidate.version, targetCommit: cli.targetCommit, checksumManifest: cli.checksumManifest, candidateManifest: cli.candidateManifest, supportedPlatforms: cli.supportedPlatforms, asset: cli.assets?.[0] });
  const tuiSums = await readRetainedBytes(artifactRoot, tui.checksumManifest.relativePath);
  const tuiCandidate = await readRetainedBytes(artifactRoot, tui.candidateManifest.relativePath);
  assertChecksumManifest(tuiSums, tui.assets);
  assertTuiCandidateManifest(tuiCandidate, tui);
  const cliSums = await readRetainedBytes(artifactRoot, cli.checksumManifest.relativePath);
  assertChecksumManifest(cliSums, [...cli.assets, cli.candidateManifest]);
  assertCliCandidateManifest(cliCandidateBytes, { ...cli, version: cliCandidate.version, asset: cli.assets[0] });
  for (const asset of [...tui.assets, ...cli.assets]) {
    const bytes = await readRetainedBytes(artifactRoot, asset.relativePath);
    if (digest(bytes) !== asset.sha256) throw new Error("operator tool retained asset checksum mismatch");
  }
  return { manifest, tuiAssets: tui.assets.map((asset) => asset.relativePath), cliAssets: cli.assets.map((asset) => asset.relativePath) };
}
