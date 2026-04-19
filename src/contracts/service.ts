import type { ServiceHealthcheck } from "../runtime/health/types.js";

export interface ServiceManifest {
  id: string;
  name: string;
  description: string;
  version?: string;
  enabled?: boolean;
  depend_on?: string[];
  healthcheck?: ServiceHealthcheck;
}

export interface DiscoveredService {
  manifest: ServiceManifest;
  manifestPath: string;
  serviceRoot: string;
}
