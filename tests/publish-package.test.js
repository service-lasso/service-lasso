import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rm } from "node:fs/promises";
import {
  createTemporaryOutputRoot,
  stagePublishedPackage,
  verifyPublishedPackage,
} from "../scripts/publish-package-lib.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("publishable core package can be staged and consumed by a temp project", async () => {
  const outputRoot = await createTemporaryOutputRoot("service-lasso-package-");

  try {
    const staged = await stagePublishedPackage({
      repoRoot,
      outputRoot,
    });

    assert.match(staged.artifactName, /^service-lasso-package-\d+\.\d+\.\d+$/);
    assert.equal(staged.manifest.packageName, "@service-lasso/service-lasso");
    assert.equal(staged.manifest.artifactKind, "bounded-npm-publish-payload");

    const verified = await verifyPublishedPackage({
      repoRoot,
      artifactRoot: staged.artifactRoot,
      packageArchivePath: staged.packageArchivePath,
      bootPort: 18192,
    });

    assert.equal(verified.artifactName, staged.artifactName);
    assert.equal(verified.summary.ok, true);
    assert.match(verified.summary.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});
