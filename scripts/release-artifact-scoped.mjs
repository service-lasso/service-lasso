import { assertDevelopIdentity, assertPolicyEnvironment, readSourceScope } from "./ga-platform-scope-lib.mjs";
assertDevelopIdentity();
assertPolicyEnvironment();
const scope = await readSourceScope();
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stageBundledReleaseArtifact, stageReleaseArtifact } from "./release-artifact-lib.mjs";
import { consumeReleaseMetadataToken } from "./operator-tool-packaging-lib.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Consume the step-scoped credential before either child stager runs. The same
// bounded local is deliberately shared by the sequential normal and bundled
// stagers; neither stager may reacquire it from process-wide environment state.
const releaseMetadataToken = consumeReleaseMetadataToken();

const result = await stageReleaseArtifact({ repoRoot, releaseMetadataToken, scope });
const bundled = await stageBundledReleaseArtifact({ repoRoot, releaseMetadataToken, scope });

console.log("[service-lasso] staged bounded release artifact");
console.log(`- artifact: ${result.artifactName}`);
console.log(`- folder: ${result.artifactRoot}`);
console.log(`- archive: ${result.archivePath}`);
for (const platformArchive of result.platformArchives) {
  console.log(`- ${platformArchive.platform} archive: ${platformArchive.archivePath}`);
}
console.log("[service-lasso] staged bundled release artifact");
console.log(`- artifact: ${bundled.artifactName}`);
console.log(`- folder: ${bundled.artifactRoot}`);
console.log(`- archive: ${bundled.archivePath}`);
for (const platformArchive of bundled.platformArchives) {
  console.log(`- ${platformArchive.platform} archive: ${platformArchive.archivePath}`);
}
