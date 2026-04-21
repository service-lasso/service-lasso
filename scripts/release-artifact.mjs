import path from "node:path";
import { fileURLToPath } from "node:url";
import { stageReleaseArtifact } from "./release-artifact-lib.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const result = await stageReleaseArtifact({ repoRoot });

console.log("[service-lasso] staged bounded release artifact");
console.log(`- artifact: ${result.artifactName}`);
console.log(`- folder: ${result.artifactRoot}`);
console.log(`- archive: ${result.archivePath}`);
