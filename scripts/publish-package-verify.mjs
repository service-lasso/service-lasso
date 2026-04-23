import path from "node:path";
import { fileURLToPath } from "node:url";
import { stagePublishedPackage, verifyPublishedPackage } from "./publish-package-lib.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const staged = await stagePublishedPackage({ repoRoot });
const verified = await verifyPublishedPackage({
  repoRoot,
  artifactRoot: staged.artifactRoot,
  packageArchivePath: staged.packageArchivePath,
});

console.log(`[service-lasso] verified publishable package at ${verified.stagedRoot}`);
console.log(`[service-lasso] verified consumer boot URL ${verified.summary.url}`);
