import type { ServicesResponse, ServiceSummary } from "../../contracts/api.js";

export function createServicesResponse(services: ServiceSummary[]): ServicesResponse {
  return {
    services,
  };
}
