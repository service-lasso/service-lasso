import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { consumeReleaseMetadataToken } from "./operator-tool-packaging-lib.mjs";
import { stageBundledReleaseArtifact, stageReleaseArtifact } from "./release-artifact-lib.mjs";

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
  unbundled = await stageReleaseArtifact({ repoRoot, outputRoot: stagingRoot, version, releaseMetadataToken });
  bundled = await stageBundledReleaseArtifact({ repoRoot, outputRoot: stagingRoot, version, releaseMetadataToken });

  const archives = [
    ...unbundled.platformArchives.map((archive) => ({ artifact: "unbundled", platform: archive.platform, name: archive.archiveName, path: archive.archivePath })),
    ...bundled.platformArchives.map((archive) => ({ artifact: "bundled", platform: archive.platform, name: archive.archiveName, path: archive.archivePath })),
  ];

  const requiredPairs = new Set(["unbundled:win32", "unbundled:linux", "unbundled:darwin", "bundled:win32", "bundled:linux", "bundled:darwin"]);
  const archiveNames = new Set(archives.map((archive) => archive.name));
  const archivePairs = new Set(archives.map((archive) => `${archive.artifact}:${archive.platform}`));
  if (archives.length !== requiredPairs.size || archiveNames.size !== archives.length || archivePairs.size !== requiredPairs.size || [...requiredPairs].some((pair) => !archivePairs.has(pair))) {
    throw new Error("Development candidate must contain exactly six unique bundled and unbundled platform archives.");
  }
  for (const archive of archives) await copyFile(archive.path, path.join(outputRoot, archive.name));

  const digest = async (filePath) => createHash("sha256").update(await readFile(filePath)).digest("hex");
  const manifestArchives = await Promise.all(archives.map(async ({ path: archivePath, ...archive }) => ({
    ...archive,
    sha256: await digest(path.join(outputRoot, archive.name)),
  })));

  const manifest = {
    schemaVersion: 1,
    kind: "core-development-candidate",
    source: { repository: process.env.GITHUB_REPOSITORY ?? "service-lasso/service-lasso", commit: candidateSha, ref: "develop" },
    nonGoals: ["github-release", "npm-publication", "deployment", "promotion", "release-environment", "ga"],
    archives: manifestArchives.map(({ path: archivePath, ...archive }) => archive).sort((left, right) => left.name.localeCompare(right.name)),
  };

  const manifestPath = path.join(outputRoot, "candidate-manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const checksums = [
    ...manifest.archives.map((archive) => `${archive.sha256}  ${archive.name}`),
    `${await digest(manifestPath)}  candidate-manifest.json`,
  ].join("\n");
  await writeFile(path.join(outputRoot, "SHA256SUMS.txt"), `${checksums}\n`, "utf8");

  for (const archive of manifest.archives) await stat(path.join(outputRoot, archive.name));
  process.stdout.write(`${JSON.stringify({ candidateSha, archiveCount: manifest.archives.length, outputRoot })}\n`);
} finally {
  await rm(stagingRoot, { recursive: true, force: true });
}
