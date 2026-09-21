import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { installedArtifactEvidence } from "../scripts/newcomer-artifact-evidence.mjs";

test("artifact receipt hashes owned bytes, excludes private fields and detects drift", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "newcomer-artifacts-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "echo/.state"), { recursive: true });
  const archivePath = path.join(root, "archive.zip");
  await writeFile(archivePath, "fixture");
  const sha256 = createHash("sha256").update("fixture").digest("hex");
  const artifact = { archivePath, sourceType: "github-release", repo: "owner/repo", tag: "v1", assetName: "archive.zip", assetUrl: "https://private.invalid/?token=secret", args: ["secret"], checksum: { algorithm: "sha256", expected: sha256, actual: sha256 } };
  const save = () => writeFile(path.join(root, "echo/.state/install.json"), JSON.stringify({ installed: true, artifact }));
  await save();
  assert.deepEqual(await installedArtifactEvidence(root, ["echo"]), [{ serviceId: "echo", sourceType: "github-release", repository: "owner/repo", tag: "v1", assetName: "archive.zip", sha256, releaseChecksumVerified: true }]);
  await writeFile(archivePath, "changed");
  await assert.rejects(installedArtifactEvidence(root, ["echo"]), /checksum mismatched/);
  artifact.checksum = null;
  await save();
  assert.equal((await installedArtifactEvidence(root, ["echo"]))[0].releaseChecksumVerified, false);
  artifact.archivePath = process.execPath;
  await save();
  await assert.rejects(installedArtifactEvidence(root, ["echo"]), /outside the owned/);
  await assert.rejects(installedArtifactEvidence(root, ["../escape"]), /Invalid evidence service/);
});
