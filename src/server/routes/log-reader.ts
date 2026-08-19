import type { ServiceLogChunkResponse, ServiceLogInfoResponse, ServiceLogSearchResponse } from "../../contracts/api.js";
import type { ServiceLogChunkPayload, ServiceLogInfoPayload, ServiceLogSearchPayload } from "../../runtime/operator/logs.js";

export function createServiceLogInfoResponse(info: ServiceLogInfoPayload): ServiceLogInfoResponse {
  const stdin = info.stdin ?? {
    available: false,
    reason: "The runtime has not advertised a safe stdin channel for this service.",
    policy: "unavailable",
  };

  return {
    ...info,
    stdin,
    capabilities: {
      stdin: info.capabilities?.stdin ?? stdin,
    },
  };
}

export function createServiceLogChunkResponse(chunk: ServiceLogChunkPayload): ServiceLogChunkResponse {
  return chunk;
}

export function createServiceLogSearchResponse(search: ServiceLogSearchPayload): ServiceLogSearchResponse {
  return search;
}
