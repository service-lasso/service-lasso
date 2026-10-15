import { assertDevelopIdentity, assertPolicyEnvironment, readSourceScope } from "./ga-platform-scope-lib.mjs";
assertDevelopIdentity();
assertPolicyEnvironment();
const scope = await readSourceScope();
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { consumeReleaseMetadataToken } from "./operator-tool-packaging-lib.mjs";
import { stageBundledReleaseArtifact, stageReleaseArtifact } from "./release-artifact-lib.mjs";
import { createCandidate2Evidence } from "./scoped-release-evidence-lib.mjs";
import { sourceIdentity } from "./ga-platform-scope-lib.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidateSha = process.env.CANDIDATE_SHA?.trim().toLowerCase();

if (!/^[a-f0-9]{40}$/u.test(candidateSha ?? "")) {
  throw new Error("CANDIDATE_SHA must be one full lowercase Git commit SHA.");
}

const outputRoot = path.join(repoRoot, "artifacts", "development-candidate");
const stagingRoot = path.join(repoRoot, "artifacts", "development-candidate-stage");
await rm(outputRoot, { recursive: true, force: true });
await rm(stagingRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

const version = `develop-${candidateSha.slice(0, 12)}`;
// Keep the read-only release-metadata token in memory only.  The staging
// helpers receive it explicitly, while their npm and archive child processes
// run after it has been removed from the inherited environment.
const releaseMetadataToken = consumeReleaseMetadataToken();
let unbundled;
let bundled;
try {
  unbundled = await stageReleaseArtifact({ repoRoot, outputRoot: stagingRoot, version, releaseMetadataToken, scope });
  bundled = await stageBundledReleaseArtifact({ repoRoot, outputRoot: stagingRoot, version, releaseMetadataToken, scope });

  const archives = [
    ...unbundled.platformArchives.map((archive) => ({ artifact: "unbundled", platform: archive.platform, name: archive.archiveName, path: archive.archivePath })),
    ...bundled.platformArchives.map((archive) => ({ artifact: "bundled", platform: archive.platform, name: archive.archiveName, path: archive.archivePath })),
  ];

  const requiredPairs = new Set(["unbundled:win32", "unbundled:linux", "bundled:win32", "bundled:linux"]);
  const archiveNames = new Set(archives.map((archive) => archive.name));
  const archivePairs = new Set(archives.map((archive) => `${archive.artifact}:${archive.platform}`));
  if (archives.length !== requiredPairs.size || archiveNames.size !== archives.length || archivePairs.size !== requiredPairs.size || [...requiredPairs].some((pair) => !archivePairs.has(pair))) {
    throw new Error("Development candidate must contain exactly four unique bundled and unbundled platform archives.");
  }
  for (const archive of archives) await copyFile(archive.path, path.join(outputRoot, archive.name));

  const originalArchives = new Map();
  for (const archive of archives) originalArchives.set(archive.name, await readFile(path.join(outputRoot, archive.name)));
  const { manifest, held } = createCandidate2Evidence(sourceIdentity(candidateSha), scope, originalArchives);
  for (const name of ["candidate-manifest.json", "SHA256SUMS.txt"]) await writeFile(path.join(outputRoot, name), held.get(name), { flag: "wx" });
  for (const archive of manifest.archives) await stat(path.join(outputRoot, archive.name));
  process.stdout.write(`${JSON.stringify({ candidateSha, archiveCount: manifest.archives.length, outputRoot })}\n`);
} finally {
  await rm(stagingRoot, { recursive: true, force: true });
}
