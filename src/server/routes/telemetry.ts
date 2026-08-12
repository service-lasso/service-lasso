import type { RuntimeTelemetryPreview, ServiceTelemetryPreview } from "../../runtime/operator/telemetry.js";

export interface RuntimeTelemetryPreviewResponse {
  telemetry: RuntimeTelemetryPreview;
}

export interface ServiceTelemetryPreviewResponse {
  telemetry: ServiceTelemetryPreview;
}

export function createRuntimeTelemetryPreviewResponse(
  telemetry: RuntimeTelemetryPreview,
): RuntimeTelemetryPreviewResponse {
  return { telemetry };
}

export function createServiceTelemetryPreviewResponse(
  telemetry: ServiceTelemetryPreview,
): ServiceTelemetryPreviewResponse {
  return { telemetry };
}
