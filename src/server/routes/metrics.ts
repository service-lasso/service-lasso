import type { ServiceMetricsPayload } from "../../runtime/operator/metrics.js";

export interface ServiceMetricsResponse {
  metrics: ServiceMetricsPayload;
}

export function createServiceMetricsResponse(metrics: ServiceMetricsPayload): ServiceMetricsResponse {
  return { metrics };
}
