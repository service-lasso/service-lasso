import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  stageBundledReleaseArtifact,
  stageReleaseArtifact,
  verifyBundledStagedArtifact,
  verifyStagedArtifact,
} from "./release-artifact-lib.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const staged = await stageReleaseArtifact({ repoRoot });
const verified = await verifyStagedArtifact({
  repoRoot,
  artifactRoot: staged.artifactRoot,
  archivePath: staged.archivePath,
});
const bundled = await stageBundledReleaseArtifact({ repoRoot });
const bundledVerified = await verifyBundledStagedArtifact({
  repoRoot,
  artifactRoot: bundled.artifactRoot,
  archivePath: bundled.archivePath,
});

console.log("[service-lasso] verified bounded release artifact");
console.log(`- artifact: ${verified.artifactName}`);
console.log(`- folder: ${verified.stagedRoot}`);
console.log(`- archive: ${verified.stagedArchivePath}`);
console.log("[service-lasso] verified bundled release artifact");
console.log(`- artifact: ${bundledVerified.artifactName}`);
console.log(`- folder: ${bundledVerified.stagedRoot}`);
console.log(`- archive: ${bundledVerified.stagedArchivePath}`);
