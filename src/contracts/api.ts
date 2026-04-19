export interface HealthResponse {
  service: "service-lasso";
  status: "ok";
  mode: "development";
  api: {
    status: "up";
    version: string;
  };
}

export interface ServiceSummary {
  id: string;
  name: string;
  description: string;
  status: "discovered" | "fixture";
  source: "manifest" | "fixture";
  manifestPath?: string;
  serviceRoot?: string;
  enabled?: boolean;
  version?: string;
  dependencies?: string[];
  dependents?: string[];
}

export interface ServicesResponse {
  services: ServiceSummary[];
}

export interface ServiceDetailResponse {
  service: ServiceSummary;
}

export interface RuntimeSummaryResponse {
  runtime: {
    servicesRoot: string;
    totalServices: number;
    enabledServices: number;
    dependencyEdges: number;
  };
}

export interface DependenciesResponse {
  dependencies: {
    nodes: { id: string; name: string }[];
    edges: { from: string; to: string }[];
  };
}
