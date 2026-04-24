import path from "node:path";
import { fileURLToPath } from "node:url";
import { stagePublishedPackage } from "./publish-package-lib.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = process.env.SERVICE_LASSO_PACKAGE_OUTPUT_ROOT?.trim();

const staged = await stagePublishedPackage({
  repoRoot,
  ...(outputRoot ? { outputRoot: path.resolve(outputRoot) } : {}),
});

console.log(`[service-lasso] staged publishable package at ${staged.artifactRoot}`);
console.log(`[service-lasso] packed archive at ${staged.packageArchivePath}`);
