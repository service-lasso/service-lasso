import type { RuntimeSummaryResponse } from "../../contracts/api.js";

export function createRuntimeSummaryResponse(input: RuntimeSummaryResponse["runtime"]): RuntimeSummaryResponse {
  return {
    runtime: input,
  };
}
