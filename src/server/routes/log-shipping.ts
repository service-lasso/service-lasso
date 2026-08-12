import type { RuntimeLogShippingPreview } from "../../runtime/operator/log-shipping.js";

export interface RuntimeLogShippingPreviewResponse {
  logShipping: RuntimeLogShippingPreview;
}

export function createRuntimeLogShippingPreviewResponse(
  logShipping: RuntimeLogShippingPreview,
): RuntimeLogShippingPreviewResponse {
  return { logShipping };
}
