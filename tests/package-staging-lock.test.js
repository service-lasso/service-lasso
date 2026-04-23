import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { stagePublishedPackage } from "../scripts/publish-package-lib.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("package staging serializes concurrent writers that share an output root", async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-package-stage-lock-"));
  const version = `0.1.0-stage.${process.pid}.${Date.now()}`;

  try {
    const results = await Promise.all([
      stagePublishedPackage({ repoRoot, outputRoot, version }),
      stagePublishedPackage({ repoRoot, outputRoot, version }),
    ]);

    assert.equal(results.length, 2);
    assert.equal(results[0].artifactName, `service-lasso-package-${version}`);
    assert.equal(results[1].artifactName, `service-lasso-package-${version}`);

    const archive = await stat(results[1].packageArchivePath);
    assert.equal(archive.isFile(), true);
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});
