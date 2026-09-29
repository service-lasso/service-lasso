import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";


function assetUrl(release, name) {
  return `https://github.com/${release.repository}/releases/download/${release.tag}/${name}`;
}

function digest(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

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
  if (release?.repository !== "service-lasso/service-lasso-cli" || !/^cli-v[0-9A-Za-z.-]+-candidate-[a-f0-9]{7,}$/u.test(release.tag) || !/^[a-f0-9]{40}$/u.test(release.targetCommit) || !/^service-lassoctl-[A-Za-z0-9.-]+\.tgz$/u.test(release.asset?.name) || !/^[a-f0-9]{64}$/u.test(release.asset?.sha256) || release.checksumManifest?.name !== "SHA256SUMS.txt" || !/^[a-f0-9]{64}$/u.test(release.checksumManifest?.sha256) || release.candidateManifest?.name !== "candidate.json" || !/^[a-f0-9]{64}$/u.test(release.candidateManifest?.sha256)) throw new Error("CLI release identity is invalid");
}

async function downloadExact(fetchImpl, url, expected) {
  let current = new URL(url);
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
  if (!response.ok) throw new Error(`operator tool download failed with HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || digest(bytes) !== expected) throw new Error("operator tool checksum mismatch");
  return bytes;
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
async function assertGitHubRelease(fetchImpl, release, expectedAssets) {
  const response = await fetchImpl(`https://api.github.com/repos/${release.repository}/releases/tags/${release.tag}`, { redirect: "error" });
  if (!response.ok) throw new Error(`operator tool release metadata failed with HTTP ${response.status}`);
  const metadata = await response.json();
  if (metadata.tag_name !== release.tag || metadata.target_commitish !== release.targetCommit || metadata.prerelease !== true || metadata.draft !== false) throw new Error("operator tool release metadata does not match the pinned candidate identity");
  if (!Array.isArray(metadata.assets) || metadata.assets.length !== expectedAssets.length) throw new Error("operator tool release metadata asset inventory does not match the pinned manifest");
  const actual = new Map();
  for (const asset of metadata.assets) {
    if (!/^[A-Za-z0-9._-]+$/u.test(asset?.name) || !/^sha256:[a-f0-9]{64}$/u.test(asset?.digest) || actual.has(asset.name)) throw new Error("operator tool release metadata asset inventory is malformed or contains duplicates");
    actual.set(asset.name, asset.digest);
  }
  if (expectedAssets.some((asset) => actual.get(asset.name) !== `sha256:${asset.sha256}`)) throw new Error("operator tool release metadata asset inventory does not match the pinned manifest");
}

export async function stageOperatorTools({ artifactRoot, fetchImpl = fetch, release = null, cliRelease = null } = {}) {
	await mkdir(path.join(artifactRoot, "operator-tools"), { recursive: true });
  const assets = [];
  let tuiTool = { command: "service-lasso-tui", status: "unavailable", reason: "No current reviewed immutable TUI release is pinned." };
  if (release) {
    assertExactToolRelease(release);
    await assertGitHubRelease(fetchImpl, release, [...release.assets, release.checksumManifest, release.candidateManifest]);
    const root = path.join(artifactRoot, "operator-tools", "service-lasso-tui");
    await mkdir(root, { recursive: true });
    const checksum = await downloadExact(fetchImpl, assetUrl(release, release.checksumManifest.name), release.checksumManifest.sha256);
    assertChecksumManifest(checksum, release.assets);
    await writeFile(path.join(root, release.checksumManifest.name), checksum);
    for (const asset of release.assets) {
      const bytes = await downloadExact(fetchImpl, assetUrl(release, asset.name), asset.sha256);
      const relativePath = path.posix.join("operator-tools", "service-lasso-tui", asset.name);
      await writeFile(path.join(artifactRoot, relativePath), bytes);
      assets.push({ ...asset, relativePath });
    }
    tuiTool = { command: "service-lasso-tui", status: "available", mode: "caller-attached-terminal", repository: release.repository, tag: release.tag, targetCommit: release.targetCommit, checksumManifest: { ...release.checksumManifest, relativePath: "operator-tools/service-lasso-tui/SHA256SUMS.txt" }, assets };
  }
  let cliTool = { command: "service-lassoctl", status: "unavailable", reason: "No current reviewed immutable CLI release is pinned." };
  if (cliRelease) {
  const cliRoot = path.join(artifactRoot, "operator-tools", "service-lassoctl");
  assertExactCliRelease(cliRelease);
  await assertGitHubRelease(fetchImpl, cliRelease, [cliRelease.asset, cliRelease.checksumManifest, cliRelease.candidateManifest]);
  await mkdir(cliRoot, { recursive: true });
  const cliSums = await downloadExact(fetchImpl, assetUrl(cliRelease, cliRelease.checksumManifest.name), cliRelease.checksumManifest.sha256);
  assertChecksumManifest(cliSums, [cliRelease.asset]);
  await writeFile(path.join(cliRoot, cliRelease.checksumManifest.name), cliSums);
  const cliBytes = await downloadExact(fetchImpl, assetUrl(cliRelease, cliRelease.asset.name), cliRelease.asset.sha256);
  const cliRelativePath = path.posix.join("operator-tools", "service-lassoctl", cliRelease.asset.name);
  await writeFile(path.join(artifactRoot, cliRelativePath), cliBytes);
  cliTool = { command: "service-lassoctl", status: "available", mode: "caller-invoked", repository: cliRelease.repository, tag: cliRelease.tag, targetCommit: cliRelease.targetCommit, checksumManifest: { ...cliRelease.checksumManifest, relativePath: "operator-tools/service-lassoctl/SHA256SUMS.txt" }, assets: [{ ...cliRelease.asset, relativePath: cliRelativePath }] };
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
