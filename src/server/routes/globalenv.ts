import type { GlobalEnvResponse } from "../../contracts/api.js";

export function createGlobalEnvResponse(globalenv: Record<string, string>): GlobalEnvResponse {
  return { globalenv };
}
