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
  const entries = new Map(bytes.toString("utf8").split(/\r?\n/u).map((line) => line.match(/^([a-f0-9]{64})\s+\*?(.+)$/u)).filter(Boolean).map(([, hash, name]) => [name, hash]));
  for (const asset of assets) if (entries.get(asset.name) !== asset.sha256) throw new Error("operator tool checksum manifest does not match the pinned asset inventory");
}

// External tools are retained as verified release archives. Core does not run,
// extract, supervise, catalogue, or otherwise manage them. The caller extracts
// the selected platform archive and starts the TUI in its own terminal.
export async function stageOperatorTools({ artifactRoot, fetchImpl = fetch, release = TUI_RELEASE } = {}) {
  assertExactToolRelease(release);
  const root = path.join(artifactRoot, "operator-tools", "service-lasso-tui");
  await mkdir(root, { recursive: true });
  const checksum = await downloadExact(fetchImpl, assetUrl(release, release.checksumManifest.name), release.checksumManifest.sha256);
  assertChecksumManifest(checksum, release.assets);
  await writeFile(path.join(root, release.checksumManifest.name), checksum);
  const assets = [];
  for (const asset of release.assets) {
    const bytes = await downloadExact(fetchImpl, assetUrl(release, asset.name), asset.sha256);
    const relativePath = path.posix.join("operator-tools", "service-lasso-tui", asset.name);
    await writeFile(path.join(artifactRoot, relativePath), bytes);
    assets.push({ ...asset, relativePath });
  }
  const manifest = {
    schemaVersion: "service-lasso.operator-tools.v1",
    tools: [
      { command: "service-lassoctl", status: "unavailable", reason: "No verified immutable CLI release is pinned." },
      { command: "service-lasso-tui", status: "available", mode: "caller-attached-terminal", repository: release.repository, tag: release.tag, targetCommit: release.targetCommit, checksumManifest: { ...release.checksumManifest, relativePath: "operator-tools/service-lasso-tui/SHA256SUMS.txt" }, assets },
    ],
  };
  await writeFile(path.join(artifactRoot, "operator-tools", "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
