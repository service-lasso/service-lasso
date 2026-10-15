import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, rm } from "node:fs/promises";
import {
  createTemporaryOutputRoot,
  stagePublishedPackage,
  verifyPublishedPackage,
} from "../scripts/publish-package-lib.mjs";
import { createOperatorToolReleaseResponseFixture } from "./fixtures/operator-tool-release-response.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

test("publishable core package can be staged and consumed by a temp project", async () => {
  const outputRoot = await createTemporaryOutputRoot("service-lasso-package-");
  const operatorToolFixture = await createOperatorToolReleaseResponseFixture();

  try {
    const staged = await stagePublishedPackage({
      repoRoot,
      outputRoot,
      releaseMetadataToken: "test-release-metadata-token",
      testOnlyOperatorToolFixture: operatorToolFixture,
    });

    assert.match(staged.artifactName, /^service-lasso-package-[0-9A-Za-z.-]+$/);
    assert.equal(staged.manifest.packageName, "@service-lasso/service-lasso");
    assert.equal(staged.manifest.artifactKind, "bounded-npm-publish-payload");
    assert.equal(staged.manifest.registry, "https://registry.npmjs.org");

    const stagedPackageJson = JSON.parse(
      await readFile(path.join(staged.artifactRoot, "package.json"), "utf8"),
    );
    assert.equal(
      stagedPackageJson.publishConfig.registry,
      "https://registry.npmjs.org",
    );
    assert.equal(stagedPackageJson.publishConfig.access, "public");
    assert.ok(stagedPackageJson.files.includes("sbom.cdx.json"));
    assert.ok(stagedPackageJson.files.includes("operator-tools"));
    assert.equal(staged.manifest.operatorToolsManifest, "operator-tools/manifest.json");

    const sbom = JSON.parse(
      await readFile(path.join(staged.artifactRoot, "sbom.cdx.json"), "utf8"),
    );
    assert.equal(sbom.bomFormat, "CycloneDX");
    assert.equal(sbom.specVersion, "1.6");
    assert.equal(sbom.metadata.component.name, "@service-lasso/service-lasso");
    assert.equal(sbom.metadata.component.version, stagedPackageJson.version);
    assert.ok(sbom.components.length > 0);

    const verified = await verifyPublishedPackage({
      repoRoot,
      artifactRoot: staged.artifactRoot,
      packageArchivePath: staged.packageArchivePath,
      bootPort: 18192,
    });

    assert.equal(verified.artifactName, staged.artifactName);
    assert.equal(verified.summary.ok, true);
    assert.deepEqual(verified.summary.operatorTools, [
      { command: "service-lassoctl", status: "available", receiptKind: "protected-immutable" },
      { command: "service-lasso-tui", status: "available", receiptKind: "protected-immutable" },
    ]);
    assert.match(verified.summary.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});
