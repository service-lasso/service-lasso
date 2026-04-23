import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FALLBACK_VERSION = "0.1.0";

let cachedPackageVersion: string | undefined;

function readPackageVersion(packageJsonPath: string): string | undefined {
  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
    return typeof packageJson.version === "string" && packageJson.version.trim() ? packageJson.version : undefined;
  } catch {
    return undefined;
  }
}

export function resolveRuntimeVersion(fromUrl: string = import.meta.url): string {
  if (cachedPackageVersion) {
    return cachedPackageVersion;
  }

  let current = path.dirname(fileURLToPath(fromUrl));
  while (true) {
    const found = readPackageVersion(path.join(current, "package.json"));
    if (found) {
      cachedPackageVersion = found;
      return found;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      cachedPackageVersion = process.env.npm_package_version?.trim() || FALLBACK_VERSION;
      return cachedPackageVersion;
    }

    current = parent;
  }
}
