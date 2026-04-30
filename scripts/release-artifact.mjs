import path from "node:path";
import { fileURLToPath } from "node:url";
import { stageBundledReleaseArtifact, stageReleaseArtifact } from "./release-artifact-lib.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const result = await stageReleaseArtifact({ repoRoot });
const bundled = await stageBundledReleaseArtifact({ repoRoot });

console.log("[service-lasso] staged bounded release artifact");
console.log(`- artifact: ${result.artifactName}`);
console.log(`- folder: ${result.artifactRoot}`);
console.log(`- archive: ${result.archivePath}`);
console.log("[service-lasso] staged bundled release artifact");
console.log(`- artifact: ${bundled.artifactName}`);
console.log(`- folder: ${bundled.artifactRoot}`);
console.log(`- archive: ${bundled.archivePath}`);
