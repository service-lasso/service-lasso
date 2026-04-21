import path from "node:path";
import { fileURLToPath } from "node:url";
import { stagePublishedPackage } from "./publish-package-lib.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const staged = await stagePublishedPackage({ repoRoot });

console.log(`[service-lasso] staged publishable package at ${staged.artifactRoot}`);
console.log(`[service-lasso] packed archive at ${staged.packageArchivePath}`);
