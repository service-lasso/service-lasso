import type { DependenciesResponse, DependencyReverseLookupResponse } from "../../contracts/api.js";
import type { ReverseDependencyLookup } from "../../runtime/manager/DependencyGraph.js";

export function createDependenciesResponse(
  input: DependenciesResponse["dependencies"],
): DependenciesResponse {
  return {
    dependencies: input,
  };
}

export function createDependencyReverseLookupResponse(
  input: ReverseDependencyLookup,
): DependencyReverseLookupResponse {
  return {
    dependencies: input,
  };
}
