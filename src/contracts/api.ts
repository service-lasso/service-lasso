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
}

export interface ServicesResponse {
  services: ServiceSummary[];
}
