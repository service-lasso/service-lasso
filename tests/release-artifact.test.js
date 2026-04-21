import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rm } from "node:fs/promises";
import {
  createTemporaryOutputRoot,
  stageReleaseArtifact,
  verifyStagedArtifact,
} from "../scripts/release-artifact-lib.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("bounded release artifact can be staged and verified", async () => {
  const outputRoot = await createTemporaryOutputRoot();

  try {
    const staged = await stageReleaseArtifact({
      repoRoot,
      outputRoot,
    });

    assert.match(staged.artifactName, /^service-lasso-\d+\.\d+\.\d+$/);
    assert.equal(staged.manifest.entrypoints.runtime, "dist/index.js");
    assert.equal(staged.manifest.entrypoints.corePackage, "packages/core/index.js");

    const verified = await verifyStagedArtifact({
      repoRoot,
      artifactRoot: staged.artifactRoot,
      archivePath: staged.archivePath,
      bootPort: 18182,
    });

    assert.equal(verified.artifactName, staged.artifactName);
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});
