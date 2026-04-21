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
