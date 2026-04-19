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
  status: "fixture";
  source: "fixture";
}

export interface ServicesResponse {
  services: ServiceSummary[];
}
