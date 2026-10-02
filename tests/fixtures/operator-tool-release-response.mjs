import { createProtectedCliFixture } from "./protected-operator-cli.mjs";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import * as tar from "tar";

const hash = (value) => createHash("sha256").update(value).digest("hex");

// This fixture supplies only GitHub release and asset responses. The production
// stager continues to validate identity, inventory, manifests, checksums, and
// retained bytes before packaging them.
export async function createOperatorToolReleaseResponseFixture() {
  const tuiAssets = [
    ["win32-amd64", "service-lasso-tui-2026.9.30-97fafb0-win32-amd64.zip"],
    ["linux-amd64", "service-lasso-tui-2026.9.30-97fafb0-linux-amd64.tar.gz"],
    ["darwin-amd64", "service-lasso-tui-2026.9.30-97fafb0-darwin-amd64.tar.gz"],
    ["darwin-arm64", "service-lasso-tui-2026.9.30-97fafb0-darwin-arm64.tar.gz"],
  ].map(([platform, name]) => ({ platform, name, sha256: hash(`tui-${platform}`) }));
  const tuiSums = Buffer.from(tuiAssets.map((asset) => `${asset.sha256}  ${asset.name}`).join("\n") + "\n");
  const release = {
    repository: "service-lasso/service-lasso-tui",
    tag: "candidate-2026.9.30-97fafb0",
    targetCommit: "97fafb04c69fce8efdd245eb186e6dfb9915485d",
    checksumManifest: { name: "SHA256SUMS.txt", sha256: hash(tuiSums) },
    candidateManifest: {},
    assets: tuiAssets.map(asset => ({ ...asset, executable: asset.platform === "win32-amd64" ? "service-lasso-tui.exe" : "service-lasso-tui" })),
  };
  const tuiCandidate = Buffer.from(JSON.stringify({
    schemaVersion: 2,
    kind: "develop-prerelease-candidate",
    version: release.tag.slice("candidate-".length), corePackagingIssue: "service-lasso/service-lasso#1461", source: { repository: release.repository, ref: "refs/heads/develop", commit: release.targetCommit },
    release: { tag: release.tag, prerelease: true, draft: false, immutable: true },
    checksumManifest: release.checksumManifest,
    assets: tuiAssets.map(asset => ({ ...asset, executable: asset.platform === "win32-amd64" ? "service-lasso-tui.exe" : "service-lasso-tui" })),
  }));
  release.candidateManifest = { name: "candidate-manifest.json", sha256: hash(tuiCandidate) };

  const { cliRelease, held } = createProtectedCliFixture({ version: "0.1.0-dev.d3a3814", sourceSha: "d3a381402c26686aa0b618055a45d525605bdbea", entrypoint: [
    'const args = process.argv.slice(2);',
    'const coreUrl = args[args.indexOf("--core-url") + 1];',
    'if (args.includes("service") && args.includes("start")) { console.error("confirmation_required"); process.exitCode = 1; }',
    'else if (args.includes("instance") && args.includes("status")) {',
    '  try { const response = await fetch(`${coreUrl}/api/health`); if (!response.ok) throw new Error("unavailable"); console.log(JSON.stringify(await response.json())); }',
    '  catch { console.error("core_unreachable"); process.exitCode = 1; }', '}', '',
  ].join("\n") });
  const bodyFor = (asset) => {
    if (asset.name === "candidate-manifest.json") return tuiCandidate;
    if (held.has(asset.name) && asset !== release.checksumManifest) return held.get(asset.name);
    if (asset.name === "SHA256SUMS.txt") return asset === release.checksumManifest ? tuiSums : held.get("SHA256SUMS.txt");

    return Buffer.from(`tui-${asset.platform}`);
  };
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    const isCli = parsed.pathname.includes("service-lasso-cli");
    const selectedRelease = isCli ? cliRelease : release;
    const selectedAssets = isCli
      ? [...cliRelease.assets, cliRelease.developmentManifest, cliRelease.checksumManifest]
      : [...tuiAssets, release.checksumManifest, release.candidateManifest];
    if (parsed.hostname === "api.github.com") {
      return Response.json({
        tag_name: selectedRelease.tag,
        target_commitish: selectedRelease.targetCommit,
        prerelease: true,
        draft: false,
        immutable: true,
        assets: selectedAssets.map((asset, index) => ({
          name: asset.name,
          digest: `sha256:${asset.sha256}`,
          url: `https://api.github.com/repos/${selectedRelease.repository}/releases/assets/${index + 1}`,
        })),
      });
    }
    const asset = selectedAssets.find((candidate) => candidate.name === parsed.pathname.split("/").at(-1));
    if (!asset) throw new Error(`fixture must recognize ${parsed}`);
    await delay(20);
    return new Response(bodyFor(asset), { status: 200 });
  };
  return { fetchImpl, release, cliRelease };
}
