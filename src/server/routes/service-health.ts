import type { ServiceHealthResponse } from "../../contracts/api.js";
import type { ServiceHealthResult } from "../../runtime/health/types.js";

export function createServiceHealthResponse(
  serviceId: string,
  health: ServiceHealthResult,
): ServiceHealthResponse {
  return {
    serviceId,
    health,
  };
}
