import type { HttpHealthcheck, ServiceHealthResult } from "./types.js";

export async function checkHttpHealth(healthcheck: HttpHealthcheck): Promise<ServiceHealthResult> {
  const response = await fetch(healthcheck.url);
  const expectedStatus = healthcheck.expected_status ?? 200;

  return {
    type: "http",
    healthy: response.status === expectedStatus,
    detail:
      response.status === expectedStatus
        ? `HTTP healthcheck returned expected status ${expectedStatus}.`
        : `HTTP healthcheck returned ${response.status}, expected ${expectedStatus}.`,
  };
}
