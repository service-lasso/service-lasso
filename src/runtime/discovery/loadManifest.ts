import { readFile } from "node:fs/promises";
import type { ServiceManifest } from "../../contracts/service.js";
import { validateServiceManifest } from "./validateManifest.js";

export async function loadServiceManifest(manifestPath: string): Promise<ServiceManifest> {
  const raw = await readFile(manifestPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;

  return validateServiceManifest(parsed, manifestPath);
}
