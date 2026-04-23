import type { HttpHealthcheck, ServiceHealthResult } from "./types.js";

export async function checkHttpHealth(healthcheck: HttpHealthcheck): Promise<ServiceHealthResult> {
  const expectedStatus = healthcheck.expected_status ?? 200;
  try {
    const response = await fetch(healthcheck.url);

    return {
      type: "http",
      healthy: response.status === expectedStatus,
      detail:
        response.status === expectedStatus
          ? `HTTP healthcheck returned expected status ${expectedStatus}.`
          : `HTTP healthcheck returned ${response.status}, expected ${expectedStatus}.`,
    };
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : "HTTP healthcheck request failed.";

    return {
      type: "http",
      healthy: false,
      detail: `HTTP healthcheck failed: ${detail}`,
    };
  }
}
