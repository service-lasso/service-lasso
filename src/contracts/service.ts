export interface ServiceManifest {
  id: string;
  name: string;
  description: string;
  version?: string;
  enabled?: boolean;
  depend_on?: string[];
}

export interface DiscoveredService {
  manifest: ServiceManifest;
  manifestPath: string;
  serviceRoot: string;
}
