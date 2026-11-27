import type { ServiceArtifactPlatform } from "../../contracts/service.js";

/** Exact process architecture, then legacy OS/default; never substitute another architecture. */
export function selectArtifactPlatform(
  platforms: Record<string, ServiceArtifactPlatform> | undefined,
  platform: string = process.platform,
  arch: string = process.arch,
): { platformKey: string; definition: ServiceArtifactPlatform } | null {
  if (!platforms) return null;
  for (const platformKey of [`${platform}-${arch}`, platform, "default"]) {
    if (Object.prototype.hasOwnProperty.call(platforms, platformKey)) {
      const definition = platforms[platformKey];
      return definition ? { platformKey, definition } : null;
    }
  }
  return null;
}
