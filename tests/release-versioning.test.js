import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, rm } from "node:fs/promises";
import {
  formatTimestampReleaseVersion,
  RELEASE_VERSION_ENV,
} from "../scripts/release-version-lib.mjs";
import {
  createTemporaryOutputRoot,
  stageReleaseArtifact,
} from "../scripts/release-artifact-lib.mjs";
import { stagePublishedPackage } from "../scripts/publish-package-lib.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("timestamp release versions follow yyyy.m.d-shortsha", () => {
  const version = formatTimestampReleaseVersion({
    date: new Date("2026-04-22T08:15:00.000Z"),
    sha: "abcdef1234567890",
  });

  assert.equal(version, "2026.4.22-abcdef1");
});

test("staged artifact and package honor SERVICE_LASSO_RELEASE_VERSION overrides", async () => {
  const releaseOutputRoot = await createTemporaryOutputRoot("service-lasso-release-version-");
  const packageOutputRoot = await createTemporaryOutputRoot("service-lasso-package-version-");
  const originalVersion = process.env[RELEASE_VERSION_ENV];
  const releaseVersion = "2026.4.22-deadbee";

  process.env[RELEASE_VERSION_ENV] = releaseVersion;

  try {
    const stagedArtifact = await stageReleaseArtifact({
      repoRoot,
      outputRoot: releaseOutputRoot,
    });
    const stagedPackage = await stagePublishedPackage({
      repoRoot,
      outputRoot: packageOutputRoot,
    });
    const stagedPackageJson = JSON.parse(
      await readFile(path.join(stagedPackage.artifactRoot, "package.json"), "utf8"),
    );

    assert.equal(stagedArtifact.artifactName, `service-lasso-${releaseVersion}`);
    assert.equal(stagedArtifact.manifest.version, releaseVersion);
    assert.equal(stagedArtifact.manifest.versionSource, RELEASE_VERSION_ENV);

    assert.equal(stagedPackage.artifactName, `service-lasso-package-${releaseVersion}`);
    assert.equal(stagedPackage.manifest.version, releaseVersion);
    assert.equal(stagedPackage.manifest.versionSource, RELEASE_VERSION_ENV);
    assert.equal(stagedPackageJson.version, releaseVersion);
  } finally {
    if (originalVersion === undefined) {
      delete process.env[RELEASE_VERSION_ENV];
    } else {
      process.env[RELEASE_VERSION_ENV] = originalVersion;
    }

    await rm(releaseOutputRoot, { recursive: true, force: true });
    await rm(packageOutputRoot, { recursive: true, force: true });
  }
});
