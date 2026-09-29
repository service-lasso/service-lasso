import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const TUI_RELEASE = {
  repository: "service-lasso/service-lasso-tui",
  tag: "candidate-2026.9.29-f33ba22",
  targetCommit: "f33ba22be3ccf97cec03b3ad5254abbe80c6cfa0",
  checksumManifest: { name: "SHA256SUMS.txt", sha256: "57a5d0f28f9f0e08244cb05caaee61324ae842f8c43057d55a9e017c71d303b5" },
  assets: [
    ["darwin-amd64", "service-lasso-tui-2026.9.29-f33ba22-darwin-amd64.tar.gz", "27d9edd816e1a36d78dee45fc4236bf070674bca63806727a70708858f96555a"],
    ["darwin-arm64", "service-lasso-tui-2026.9.29-f33ba22-darwin-arm64.tar.gz", "298364f907bffc802107fecfa6986808a9e07807950e7b758353b2c695c13057"],
    ["linux-amd64", "service-lasso-tui-2026.9.29-f33ba22-linux-amd64.tar.gz", "f63cc728e05c7c62f29e522a6d5da8b3ddd568053de4b99c8229a4e424635eee"],
    ["win32-amd64", "service-lasso-tui-2026.9.29-f33ba22-win32-amd64.zip", "e07bdb774e329aa1cf47c010574de9a6a7ecb7d1f3f1a1f1b21a8ac1540dd463"],
  ].map(([platform, name, sha256]) => ({ platform, name, sha256 })),
};

export const CLI_RELEASE = {
  repository: "service-lasso/service-lasso-cli",
  tag: "cli-v0.1.0-dev.0f199b7-candidate-0f199b7",
  targetCommit: "0f199b7a4a343f0392b60863d82c176e54fba3cf",
  checksumManifest: { name: "SHA256SUMS.txt", sha256: "ff91128867e2be6ef98e8258080408a2d4e367a21b5e288aae21962214eb3e47" },
  asset: { name: "service-lassoctl-0.1.0-dev.0f199b7.tgz", sha256: "c5f5c0f0cb282717df37de37e85594dd043dd247b650bde2139d21ec09fffe40" },
};

function assetUrl(release, name) {
  return `https://github.com/${release.repository}/releases/download/${release.tag}/${name}`;
}

function digest(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

export function assertExactToolRelease(release) {
  if (!release?.repository || !/^candidate-[0-9.]+-[a-f0-9]{7,}$/u.test(release.tag) || !/^[a-f0-9]{40}$/u.test(release.targetCommit)) throw new Error("operator tool release identity is incomplete");
  if (!release.checksumManifest?.name || !/^[a-f0-9]{64}$/u.test(release.checksumManifest.sha256)) throw new Error("operator tool checksum manifest is invalid");
  const names = new Set();
  for (const asset of release.assets ?? []) {
    if (!/^(win32|linux|darwin)-(amd64|arm64)$/u.test(asset.platform) || !/^[A-Za-z0-9._-]+\.(zip|tar\.gz)$/u.test(asset.name) || !/^[a-f0-9]{64}$/u.test(asset.sha256) || names.has(asset.name)) throw new Error("operator tool asset inventory is invalid");
    names.add(asset.name);
  }
  if (names.size !== 4 || !["win32-amd64", "linux-amd64", "darwin-amd64", "darwin-arm64"].every((platform) => release.assets.some((asset) => asset.platform === platform))) throw new Error("operator tool asset inventory is incomplete");
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
  const actual = new Map((metadata.assets ?? []).map((asset) => [asset.name, asset.digest]));
  if (actual.size !== expectedAssets.length || expectedAssets.some((asset) => actual.get(asset.name) !== `sha256:${asset.sha256}`)) throw new Error("operator tool release metadata asset inventory does not match the pinned manifest");
}

export async function stageOperatorTools({ artifactRoot, fetchImpl = fetch, release = null, cliRelease = null } = {}) {
	await mkdir(path.join(artifactRoot, "operator-tools"), { recursive: true });
  const assets = [];
  let tuiTool = { command: "service-lasso-tui", status: "unavailable", reason: "No current reviewed immutable TUI release is pinned." };
  if (release) {
    assertExactToolRelease(release);
    await assertGitHubRelease(fetchImpl, release, [...release.assets, release.checksumManifest]);
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
  if (!/^[a-f0-9]{40}$/u.test(cliRelease.targetCommit) || !/^[a-f0-9]{64}$/u.test(cliRelease.asset.sha256)) throw new Error("CLI release identity is invalid");
  await assertGitHubRelease(fetchImpl, cliRelease, [cliRelease.asset, cliRelease.checksumManifest, { name: "candidate.json", sha256: "c28b7627030c37e0f32eb67496d65fa6197c873b1206d602d5c897b1d0b5270f" }]);
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
