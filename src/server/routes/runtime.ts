import type { RuntimeInstanceResponse, RuntimeSummaryResponse } from "../../contracts/api.js";

export function createRuntimeSummaryResponse(input: RuntimeSummaryResponse["runtime"]): RuntimeSummaryResponse {
  return {
    runtime: input,
  };
}

export function createRuntimeInstanceResponse(input: RuntimeInstanceResponse): RuntimeInstanceResponse {
  return input;
}
