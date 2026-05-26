import type { ServiceHealthHistoryResponse, ServiceHealthResponse } from "../../contracts/api.js";
import type { ServiceHealthHistoryState } from "../../runtime/health/history.js";
import type { ServiceHealthResult } from "../../runtime/health/types.js";

export function createServiceHealthResponse(
  serviceId: string,
  health: ServiceHealthResult,
  history: ServiceHealthHistoryState,
): ServiceHealthResponse {
  return {
    serviceId,
    health,
    history,
  };
}

export function createServiceHealthHistoryResponse(
  serviceId: string,
  history: ServiceHealthHistoryState,
): ServiceHealthHistoryResponse {
  return {
    serviceId,
    history,
  };
}
