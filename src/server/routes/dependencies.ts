import type { DependenciesResponse } from "../../contracts/api.js";

export function createDependenciesResponse(
  input: DependenciesResponse["dependencies"],
): DependenciesResponse {
  return {
    dependencies: input,
  };
}
