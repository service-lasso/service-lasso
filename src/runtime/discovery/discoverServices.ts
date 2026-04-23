import { readdir } from "node:fs/promises";
import path from "node:path";
import type { DiscoveredService } from "../../contracts/service.js";
import { loadServiceManifest } from "./loadManifest.js";

export async function discoverServices(servicesRoot: string): Promise<DiscoveredService[]> {
  const entries = await readdir(servicesRoot, { withFileTypes: true });
  const discovered: DiscoveredService[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const serviceRoot = path.join(servicesRoot, entry.name);
    const manifestPath = path.join(serviceRoot, "service.json");
    const manifest = await loadServiceManifest(manifestPath);

    discovered.push({
      manifest,
      manifestPath,
      serviceRoot,
    });
  }

  discovered.sort((left, right) => left.manifest.id.localeCompare(right.manifest.id));

  return discovered;
}
