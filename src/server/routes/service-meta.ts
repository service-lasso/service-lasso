import type { ServiceMetaResponse, ServicesMetaResponse } from "../../contracts/api.js";
import type { PersistedServiceMeta } from "../../runtime/state/meta.js";

export function createServicesMetaResponse(services: PersistedServiceMeta[]): ServicesMetaResponse {
  return { services };
}

export function createServiceMetaResponse(serviceId: string, meta: PersistedServiceMeta): ServiceMetaResponse {
  return {
    serviceId,
    meta: {
      favorite: meta.favorite,
      dependencyGraphPosition: meta.dependencyGraphPosition,
    },
  };
}
