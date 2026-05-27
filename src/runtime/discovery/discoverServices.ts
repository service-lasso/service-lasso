import { readdir } from "node:fs/promises";
import path from "node:path";
import type { DiscoveredService, ServiceCatalogProvenance, ServiceManifest } from "../../contracts/service.js";
import { loadServiceManifest } from "./loadManifest.js";

function toPortableRelativePath(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join("/");
}

export function buildServiceCatalogProvenance(
  manifest: ServiceManifest,
  manifestPath: string,
  servicesRoot: string,
): ServiceCatalogProvenance {
  const platforms = Object.values(manifest.artifact?.platforms ?? {});
  const assetNames = Array.from(
    new Set(platforms.flatMap((platform) => (platform.assetName ? [platform.assetName] : []))),
  ).sort((left, right) => left.localeCompare(right));

  return {
    sourcePath: toPortableRelativePath(servicesRoot, manifestPath),
    sourceType: manifest.artifact?.source.type ?? null,
    repo: manifest.artifact?.source.repo ?? null,
    releaseTag: manifest.artifact?.source.tag ?? null,
    assetNames,
    checksumPresent: platforms.some((platform) => Boolean(platform.sha256 || platform.checksum)),
    packagedRuntimeVersion: manifest.version ?? null,
  };
}

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
      catalogProvenance: buildServiceCatalogProvenance(manifest, manifestPath, servicesRoot),
    });
  }

  discovered.sort((left, right) => left.manifest.id.localeCompare(right.manifest.id));

  return discovered;
}
