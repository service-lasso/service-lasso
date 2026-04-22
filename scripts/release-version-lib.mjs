import { readFile } from "node:fs/promises";
import path from "node:path";

export const RELEASE_VERSION_ENV = "SERVICE_LASSO_RELEASE_VERSION";

export async function readRootPackageJson(repoRoot) {
  const packageJsonPath = path.join(repoRoot, "package.json");
  return JSON.parse(await readFile(packageJsonPath, "utf8"));
}

export function formatTimestampReleaseVersion({ date = new Date(), sha }) {
  if (!sha) {
    throw new Error("formatTimestampReleaseVersion requires a git sha");
  }

  const shortSha = sha.slice(0, 7);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();

  return `${year}.${month}.${day}-${shortSha}`;
}

export async function getReleaseVersion(repoRoot) {
  const configuredVersion = process.env[RELEASE_VERSION_ENV]?.trim();
  if (configuredVersion) {
    return configuredVersion;
  }

  const packageJson = await readRootPackageJson(repoRoot);
  return packageJson.version;
}

