import type { HttpHealthcheck, ServiceHealthResult } from "./types.js";

const DEFAULT_HTTP_HEALTHCHECK_TIMEOUT_MS = 2_000;

export async function checkHttpHealth(healthcheck: HttpHealthcheck): Promise<ServiceHealthResult> {
  const expectedStatus = healthcheck.expected_status ?? 200;
  const timeoutMs = healthcheck.timeout ?? DEFAULT_HTTP_HEALTHCHECK_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(healthcheck.url, { signal: controller.signal });

    return {
      type: "http",
      healthy: response.status === expectedStatus,
      detail:
        response.status === expectedStatus
          ? `HTTP healthcheck returned expected status ${expectedStatus}.`
          : `HTTP healthcheck returned ${response.status}, expected ${expectedStatus}.`,
    };
  } catch (error: unknown) {
    if (controller.signal.aborted) {
      return {
        type: "http",
        healthy: false,
        detail: `HTTP healthcheck timed out after ${timeoutMs}ms: ${healthcheck.url}`,
      };
    }

    const detail = error instanceof Error ? error.message : "HTTP healthcheck request failed.";

    return {
      type: "http",
      healthy: false,
      detail: `HTTP healthcheck failed: ${detail}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}
