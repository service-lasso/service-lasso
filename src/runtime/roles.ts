import type { ServiceManifest } from "../contracts/service.js";

export function isProviderRole(manifest: ServiceManifest): boolean {
  return manifest.role === "provider";
}
