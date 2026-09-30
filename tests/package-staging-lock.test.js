import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import * as tar from "tar";
import { stagePublishedPackage } from "../scripts/publish-package-lib.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hash = (value) => createHash("sha256").update(value).digest("hex");

function createOperatorToolFixture() {
  const tuiAssets = ["win32-amd64", "linux-amd64", "darwin-amd64", "darwin-arm64"].map((platform) => ({
    platform,
    name: `service-lasso-tui-test-${platform}.tar.gz`,
    sha256: hash(`tui-${platform}`),
  }));
  const tuiSums = Buffer.from(tuiAssets.map((asset) => `${asset.sha256}  ${asset.name}`).join("\n") + "\n");
  const release = {
    repository: "service-lasso/service-lasso-tui",
    tag: "candidate-2026.9.30-a1b2c3d",
    targetCommit: "a1b2c3d4e5f6789012345678901234567890abcd",
    checksumManifest: { name: "SHA256SUMS.txt", sha256: hash(tuiSums) },
    candidateManifest: {},
    assets: tuiAssets,
  };
  const tuiCandidate = Buffer.from(JSON.stringify({
    schemaVersion: 1,
    kind: "develop-prerelease-candidate",
    source: { repository: release.repository, commit: release.targetCommit },
    release: { tag: release.tag, prerelease: true },
    checksumManifest: release.checksumManifest,
    assets: tuiAssets,
  }));
  release.candidateManifest = { name: "candidate-manifest.json", sha256: hash(tuiCandidate) };

  const cliBytes = Buffer.from("service-lassoctl retained fixture\n");
  const cliRelease = {
    repository: "service-lasso/service-lasso-cli",
    tag: "cli-v0.1.0-dev.a1b2c3d-candidate-a1b2c3d",
    targetCommit: "a1b2c3d4e5f6789012345678901234567890abcd",
    asset: { name: "service-lassoctl-0.1.0-dev.a1b2c3d.tgz", sha256: hash(cliBytes) },
    checksumManifest: {},
    candidateManifest: {},
    supportedPlatforms: ["win32", "linux", "darwin"],
  };
  const cliCandidate = Buffer.from(JSON.stringify({
    schemaVersion: 1,
    candidateTag: cliRelease.tag,
    source: { repository: cliRelease.repository, commit: cliRelease.targetCommit },
    package: { command: "service-lassoctl", node: ">=22.12.0" },
    platforms: cliRelease.supportedPlatforms,
    assets: [cliRelease.asset],
  }));
  const cliSums = Buffer.from(`${cliRelease.asset.sha256}  ${cliRelease.asset.name}\n${hash(cliCandidate)}  candidate.json\n`);
  cliRelease.checksumManifest = { name: "SHA256SUMS.txt", sha256: hash(cliSums) };
  cliRelease.candidateManifest = { name: "candidate.json", sha256: hash(cliCandidate) };

  const bodyFor = (asset) => {
    if (asset.name === "candidate-manifest.json") return tuiCandidate;
    if (asset.name === "candidate.json") return cliCandidate;
    if (asset.name === "SHA256SUMS.txt") return asset === release.checksumManifest ? tuiSums : cliSums;
    if (asset.name === cliRelease.asset.name) return cliBytes;
    return Buffer.from(`tui-${asset.platform}`);
  };
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    const isCli = parsed.pathname.includes("service-lasso-cli");
    const selectedRelease = isCli ? cliRelease : release;
    const selectedAssets = isCli
      ? [cliRelease.asset, cliRelease.checksumManifest, cliRelease.candidateManifest]
      : [...tuiAssets, release.checksumManifest, release.candidateManifest];
    if (parsed.hostname === "api.github.com") {
      return Response.json({
        tag_name: selectedRelease.tag,
        target_commitish: selectedRelease.targetCommit,
        prerelease: true,
        draft: false,
        assets: selectedAssets.map((asset, index) => ({
          name: asset.name,
          digest: `sha256:${asset.sha256}`,
          url: `https://api.github.com/repos/${selectedRelease.repository}/releases/assets/${index + 1}`,
        })),
      });
    }
    const asset = selectedAssets.find((candidate) => candidate.name === parsed.pathname.split("/").at(-1));
    assert.ok(asset, `fixture must recognize ${parsed}`);
    await delay(20);
    return new Response(bodyFor(asset), { status: 200 });
  };
  return { fetchImpl, release, cliRelease };
}

async function assertPackedOperatorTools(result, fixture, snapshotRoot) {
  const archive = await stat(result.packageArchivePath);
  assert.equal(archive.isFile(), true);
  await mkdir(snapshotRoot, { recursive: true });
  await tar.extract({ file: result.packageArchivePath, cwd: snapshotRoot });
  const extractedRoot = path.join(snapshotRoot, "package", "operator-tools");
  const manifest = JSON.parse(await readFile(path.join(extractedRoot, "manifest.json"), "utf8"));
  assert.equal(manifest.schemaVersion, "service-lasso.operator-tools.v1");
  assert.equal(manifest.tools.length, 2);
  const cli = manifest.tools.find((tool) => tool.command === "service-lassoctl");
  const tui = manifest.tools.find((tool) => tool.command === "service-lasso-tui");
  assert.equal(await readFile(path.join(snapshotRoot, "package", cli.assets[0].relativePath), "utf8"), "service-lassoctl retained fixture\n");
  for (const asset of tui.assets) {
    const retained = await readFile(path.join(snapshotRoot, "package", asset.relativePath));
    assert.equal(hash(retained), asset.sha256);
  }
  assert.equal(await readFile(path.join(snapshotRoot, "package", tui.checksumManifest.relativePath), "utf8"), fixture.release.assets.map((asset) => `${asset.sha256}  ${asset.name}`).join("\n") + "\n");
}

test("package staging serializes concurrent production staging calls that share an output root", async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-package-stage-lock-"));
  const snapshotsRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-package-stage-snapshots-"));
  const version = `0.1.0-stage.${process.pid}.${Date.now()}`;
  const fixture = createOperatorToolFixture();
  let activeTransactions = 0;
  let maximumActiveTransactions = 0;
  const testOnlyStageObserver = async ({ phase }) => {
    if (phase === "entered") {
      activeTransactions += 1;
      maximumActiveTransactions = Math.max(maximumActiveTransactions, activeTransactions);
      await delay(50);
    } else {
      activeTransactions -= 1;
    }
  };

  try {
    const results = await Promise.all([
      stagePublishedPackage({ repoRoot, outputRoot, version, releaseMetadataToken: "test-release-metadata-token", testOnlyOperatorToolFixture: fixture, testOnlyStageObserver }),
      stagePublishedPackage({ repoRoot, outputRoot, version, releaseMetadataToken: "test-release-metadata-token", testOnlyOperatorToolFixture: fixture, testOnlyStageObserver }),
    ]);

    assert.equal(maximumActiveTransactions, 1);
    assert.equal(activeTransactions, 0);
    assert.equal(results[0].artifactName, `service-lasso-package-${version}`);
    assert.equal(results[1].artifactName, `service-lasso-package-${version}`);
    await Promise.all(results.map((result, index) => assertPackedOperatorTools(result, fixture, path.join(snapshotsRoot, String(index)))));
  } finally {
    await Promise.all([
      rm(outputRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
      rm(snapshotsRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
    ]);
  }
});
