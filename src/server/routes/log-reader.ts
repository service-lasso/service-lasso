import type { ServiceLogChunkResponse, ServiceLogInfoResponse } from "../../contracts/api.js";
import type { ServiceLogChunkPayload, ServiceLogInfoPayload } from "../../runtime/operator/logs.js";

export function createServiceLogInfoResponse(info: ServiceLogInfoPayload): ServiceLogInfoResponse {
  return info;
}

export function createServiceLogChunkResponse(chunk: ServiceLogChunkPayload): ServiceLogChunkResponse {
  return chunk;
}
