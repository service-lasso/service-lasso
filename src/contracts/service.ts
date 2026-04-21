import type { ServiceHealthcheck } from "../runtime/health/types.js";

export interface ServiceEndpoint {
  label: string;
  url: string;
  kind?: string;
}

export interface ServiceManifest {
  id: string;
  name: string;
  description: string;
  version?: string;
  enabled?: boolean;
  depend_on?: string[];
  healthcheck?: ServiceHealthcheck;
  env?: Record<string, string>;
  globalenv?: Record<string, string>;
  urls?: ServiceEndpoint[];
  execservice?: string;
  executable?: string;
  args?: string[];
}

export interface DiscoveredService {
  manifest: ServiceManifest;
  manifestPath: string;
  serviceRoot: string;
}
