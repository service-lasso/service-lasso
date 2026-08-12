import type { ServiceLogChunkResponse, ServiceLogInfoResponse, ServiceLogSearchResponse } from "../../contracts/api.js";
import type { ServiceLogChunkPayload, ServiceLogInfoPayload, ServiceLogSearchPayload } from "../../runtime/operator/logs.js";

export function createServiceLogInfoResponse(info: ServiceLogInfoPayload): ServiceLogInfoResponse {
  return info;
}

export function createServiceLogChunkResponse(chunk: ServiceLogChunkPayload): ServiceLogChunkResponse {
  return chunk;
}

export function createServiceLogSearchResponse(search: ServiceLogSearchPayload): ServiceLogSearchResponse {
  return search;
}
