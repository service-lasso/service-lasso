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
import { createOperatorToolReleaseResponseFixture } from "./fixtures/operator-tool-release-response.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
  assert.equal(createHash("sha256").update(await readFile(path.join(snapshotRoot, "package", cli.assets[0].relativePath))).digest("hex"), cli.assets[0].sha256);
  for (const asset of tui.assets) {
    const retained = await readFile(path.join(snapshotRoot, "package", asset.relativePath));
    assert.equal(createHash("sha256").update(retained).digest("hex"), asset.sha256);
  }
  assert.equal(await readFile(path.join(snapshotRoot, "package", tui.checksumManifest.relativePath), "utf8"), fixture.release.assets.map((asset) => `${asset.sha256}  ${asset.name}`).join("\n") + "\n");
}

test("package staging serializes concurrent production staging calls that share an output root", async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-package-stage-lock-"));
  const snapshotsRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-package-stage-snapshots-"));
  const version = `0.1.0-stage.${process.pid}.${Date.now()}`;
  const fixture = await createOperatorToolReleaseResponseFixture();
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
