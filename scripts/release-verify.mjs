import path from "node:path";
import { fileURLToPath } from "node:url";
import { stageReleaseArtifact, verifyStagedArtifact } from "./release-artifact-lib.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const staged = await stageReleaseArtifact({ repoRoot });
const verified = await verifyStagedArtifact({
  repoRoot,
  artifactRoot: staged.artifactRoot,
  archivePath: staged.archivePath,
});

console.log("[service-lasso] verified bounded release artifact");
console.log(`- artifact: ${verified.artifactName}`);
console.log(`- folder: ${verified.stagedRoot}`);
console.log(`- archive: ${verified.stagedArchivePath}`);
