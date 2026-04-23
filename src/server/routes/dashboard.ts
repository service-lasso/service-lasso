import type {
  DashboardServiceDetailResponse,
  DashboardServiceResponse,
  DashboardServicesResponse,
  DashboardSummaryResponse,
} from "../../contracts/api.js";

export function createDashboardSummaryResponse(
  summary: DashboardSummaryResponse["summary"],
): DashboardSummaryResponse {
  return {
    summary,
  };
}

export function createDashboardServicesResponse(
  services: DashboardServiceResponse[],
): DashboardServicesResponse {
  return {
    services,
  };
}

export function createDashboardServiceDetailResponse(
  service: DashboardServiceResponse,
): DashboardServiceDetailResponse {
  return {
    service,
  };
}
