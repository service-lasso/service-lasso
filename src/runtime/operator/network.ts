import type { DiscoveredService, ServiceEndpoint } from "../../contracts/service.js";

export interface ServiceNetworkEntry {
  label: string;
  url: string;
  kind: string;
}

export interface ServiceNetworkPayload {
  serviceId: string;
  endpoints: ServiceNetworkEntry[];
}

function normalizeEndpoint(entry: ServiceEndpoint): ServiceNetworkEntry {
  return {
    label: entry.label,
    url: entry.url,
    kind: entry.kind ?? "service",
  };
}

export function buildServiceNetwork(service: DiscoveredService): ServiceNetworkPayload {
  const manifestEndpoints = (service.manifest.urls ?? []).map(normalizeEndpoint);
  const healthEndpoint =
    service.manifest.healthcheck?.type === "http"
      ? [
          {
            label: "health",
            url: service.manifest.healthcheck.url,
            kind: "health",
          },
        ]
      : [];

  return {
    serviceId: service.manifest.id,
    endpoints: [...manifestEndpoints, ...healthEndpoint],
  };
}
