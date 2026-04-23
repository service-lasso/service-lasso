import type { HealthResponse } from "../../contracts/api.js";

export function createHealthResponse(version: string): HealthResponse {
  return {
    service: "service-lasso",
    status: "ok",
    mode: "development",
    api: {
      status: "up",
      version,
    },
  };
}
