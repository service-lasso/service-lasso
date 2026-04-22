import type { ServiceHealthcheck } from "../runtime/health/types.js";

export interface ServiceEndpoint {
  label: string;
  url: string;
  kind?: string;
}

export interface ServicePortDeclaration {
  [name: string]: number;
}

export interface ServiceMaterializedFile {
  path: string;
  content: string;
}

export interface ServiceActionMaterialization {
  files?: ServiceMaterializedFile[];
}

export type ServiceArtifactArchiveType = "zip" | "tar.gz" | "tgz";

export interface ServiceArtifactSource {
  type: "github-release";
  repo: string;
  channel?: string;
  tag?: string;
  serviceManifestAssetUrl?: string;
  api_base_url?: string;
}

export interface ServiceArtifactPlatform {
  assetName?: string;
  assetUrl?: string;
  archiveType: ServiceArtifactArchiveType;
  command?: string;
  args?: string[];
}

export interface ServiceArchiveArtifact {
  kind: "archive";
  source: ServiceArtifactSource;
  platforms: Record<string, ServiceArtifactPlatform>;
}

export interface ServiceManifest {
  id: string;
  name: string;
  description: string;
  version?: string;
  enabled?: boolean;
  autostart?: boolean;
  depend_on?: string[];
  healthcheck?: ServiceHealthcheck;
  env?: Record<string, string>;
  globalenv?: Record<string, string>;
  ports?: ServicePortDeclaration;
  urls?: ServiceEndpoint[];
  artifact?: ServiceArchiveArtifact;
  install?: ServiceActionMaterialization;
  config?: ServiceActionMaterialization;
  execservice?: string;
  executable?: string;
  args?: string[];
}

export interface DiscoveredService {
  manifest: ServiceManifest;
  manifestPath: string;
  serviceRoot: string;
}
