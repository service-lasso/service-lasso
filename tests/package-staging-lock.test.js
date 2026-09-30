import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { stagePublishedPackage } from "../scripts/publish-package-lib.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("package staging serializes concurrent production staging calls that share an output root", async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-package-stage-lock-"));
  const version = `0.1.0-stage.${process.pid}.${Date.now()}`;
  let activeStagers = 0;
  let maximumActiveStagers = 0;
  let stagerCalls = 0;

  // Keep the actual package staging, archive and release-identity paths. Only
  // the network-bound operator-tool acquisition is replaced by this local,
  // deterministic retained-artifact fixture.
  const stageOperatorToolsImpl = async ({ artifactRoot, releaseMetadataToken }) => {
    assert.equal(releaseMetadataToken, "test-release-metadata-token");
    activeStagers += 1;
    maximumActiveStagers = Math.max(maximumActiveStagers, activeStagers);
    stagerCalls += 1;
    try {
      await delay(50);
      await mkdir(path.join(artifactRoot, "operator-tools"), { recursive: true });
      await writeFile(
        path.join(artifactRoot, "operator-tools", "manifest.json"),
        `${JSON.stringify({ schemaVersion: "test.operator-tools.v1", call: stagerCalls })}\n`,
        "utf8",
      );
      return { tools: [] };
    } finally {
      activeStagers -= 1;
    }
  };

  try {
    const results = await Promise.all([
      stagePublishedPackage({ repoRoot, outputRoot, version, releaseMetadataToken: "test-release-metadata-token", stageOperatorToolsImpl }),
      stagePublishedPackage({ repoRoot, outputRoot, version, releaseMetadataToken: "test-release-metadata-token", stageOperatorToolsImpl }),
    ]);

    assert.equal(maximumActiveStagers, 1);
    assert.equal(activeStagers, 0);
    assert.equal(stagerCalls, 2);
    assert.equal(results[0].artifactName, `service-lasso-package-${version}`);
    assert.equal(results[1].artifactName, `service-lasso-package-${version}`);

    const archive = await stat(results[1].packageArchivePath);
    assert.equal(archive.isFile(), true);
    const manifest = JSON.parse(
      await readFile(path.join(results[1].artifactRoot, "publish-artifact.json"), "utf8"),
    );
    assert.equal(manifest.packageName, "@service-lasso/service-lasso");
    assert.equal(manifest.version, version);
    assert.equal(
      JSON.parse(
        await readFile(path.join(results[1].artifactRoot, "operator-tools", "manifest.json"), "utf8"),
      ).schemaVersion,
      "test.operator-tools.v1",
    );
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});
