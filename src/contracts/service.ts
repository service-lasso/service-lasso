export interface ServiceManifest {
  id: string;
  name: string;
  description: string;
  version?: string;
  enabled?: boolean;
}

export interface DiscoveredService {
  manifest: ServiceManifest;
  manifestPath: string;
  serviceRoot: string;
}
