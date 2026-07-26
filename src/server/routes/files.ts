import type { ServiceWorkspaceRegistryResponse } from "../../contracts/api.js";
import type { ServiceWorkspaceRegistry } from "../../runtime/files/workspace-registry.js";

export function createServiceWorkspaceRegistryResponse(registry: ServiceWorkspaceRegistry): ServiceWorkspaceRegistryResponse {
  return {
    registry,
  };
}
