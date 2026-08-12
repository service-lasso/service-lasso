import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { runReleaseCliAction } from "../dist/runtime/cli/release.js";

const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(".");
const releaseVersion = "2026.5.29-abcdef1";

async function makeReleaseFixture(prefix = "service-lasso-release-manifest-") {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  await mkdir(root, { recursive: true });

  const archiveName = "lasso-fixture-linux.tar.gz";
  const archiveContent = "fixture archive payload\n";
  const archiveSha256 = createHash("sha256").update(archiveContent).digest("hex");
  const manifest = {
    id: "fixture-service",
    name: "Fixture Service",
    description: "Release verification fixture.",
    version: releaseVersion,
    artifact: {
      kind: "archive",
      source: {
        type: "github-release",
        repo: "service-lasso/lasso-fixture",
        tag: releaseVersion,
      },
      platforms: {
        linux: {
          assetName: archiveName,
          archiveType: "tar.gz",
          checksum: {
            algorithm: "sha256",
            assetName: "SHA256SUMS.txt",
          },
        },
      },
    },
  };

  await writeFile(path.join(root, archiveName), archiveContent);
  await writeFile(path.join(root, "SHA256SUMS.txt"), `${archiveSha256}  ${archiveName}\n`);
  await writeFile(path.join(root, "service.json"), JSON.stringify(manifest, null, 2));

  return { root, archiveName, manifestPath: path.join(root, "service.json"), manifest, archiveSha256 };
}

async function writeManifest(root, manifest) {
  await writeFile(path.join(root, "service.json"), JSON.stringify(manifest, null, 2));
}

async function runCli(args) {
  const cliPath = path.join(repoRoot, "dist", "cli.js");
  const result = await execFile(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      npm_package_version: "0.1.0-test",
    },
  });

  return result.stdout.trim();
}

test("release verify-manifest accepts a complete manifest and asset set", async () => {
  const { root, manifestPath } = await makeReleaseFixture("service-lasso-release-manifest-ok-");

  try {
    const output = await runCli(["release", "verify-manifest", manifestPath, "--assets-root", root, "--json"]);
    const report = JSON.parse(output);

    assert.equal(report.action, "verify-manifest");
    assert.equal(report.ok, true);
    assert.equal(report.status, "verified");
    assert.equal(report.summary.errors, 0);
    assert.equal(report.summary.platforms, 1);
    assert.equal(report.summary.presentAssets, 1);
    assert.equal(report.summary.checksumsVerified, 1);
    assert.deepEqual(report.findings, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release verify-manifest reports a missing platform asset", async () => {
  const { root, archiveName, manifestPath } = await makeReleaseFixture("service-lasso-release-manifest-missing-");

  try {
    await rm(path.join(root, archiveName), { force: true });

    const report = await runReleaseCliAction({
      action: "verify-manifest",
      manifestPath,
      assetsRoot: root,
    });

    assert.equal(report.ok, false);
    assert.equal(report.status, "blocked");
    assert.equal(report.summary.errors, 1);
    assert.equal(report.assets[0].status, "missing");
    assert.ok(report.findings.some((finding) =>
      finding.code === "missing-release-asset" &&
      finding.platform === "linux" &&
      finding.assetName === archiveName
    ));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release verify-manifest blocks bad release version labels", async () => {
  const { root, manifestPath, manifest } = await makeReleaseFixture("service-lasso-release-manifest-version-");

  try {
    const badVersionManifest = {
      ...manifest,
      version: "latest",
      artifact: {
        ...manifest.artifact,
        source: {
          ...manifest.artifact.source,
          tag: "latest",
        },
      },
    };
    await writeManifest(root, badVersionManifest);

    const report = await runReleaseCliAction({
      action: "verify-manifest",
      manifestPath,
      assetsRoot: root,
    });

    assert.equal(report.ok, false);
    assert.equal(report.status, "blocked");
    assert.ok(report.findings.some((finding) => finding.code === "invalid-release-version"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release verify-manifest blocks checksum mismatches", async () => {
  const { root, archiveName, manifestPath, manifest } = await makeReleaseFixture("service-lasso-release-manifest-checksum-");

  try {
    const mismatchManifest = {
      ...manifest,
      artifact: {
        ...manifest.artifact,
        platforms: {
          linux: {
            ...manifest.artifact.platforms.linux,
            checksum: {
              algorithm: "sha256",
              value: "0".repeat(64),
            },
          },
        },
      },
    };
    await writeManifest(root, mismatchManifest);

    const report = await runReleaseCliAction({
      action: "verify-manifest",
      manifestPath,
      assetsRoot: root,
    });

    assert.equal(report.ok, false);
    assert.equal(report.status, "blocked");
    assert.equal(report.assets[0].checksum.status, "mismatch");
    assert.ok(report.findings.some((finding) =>
      finding.code === "checksum-mismatch" &&
      finding.platform === "linux" &&
      finding.assetName === archiveName
    ));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
