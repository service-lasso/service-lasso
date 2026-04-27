import type { DiscoveredService, ServiceEndpoint } from "../../contracts/service.js";
import { buildServiceVariables, resolveServiceText } from "./variables.js";

export interface ServiceNetworkEntry {
  label: string;
  url: string;
  kind: string;
}

export interface ServiceNetworkPayload {
  serviceId: string;
  ports: Record<string, number>;
  portmapping: Record<string, string>;
  endpoints: ServiceNetworkEntry[];
}

function renderEndpointUrl(
  entry: ServiceEndpoint,
  service: DiscoveredService,
  sharedGlobalEnv: Record<string, string>,
  resolvedPorts: Record<string, number>,
): ServiceNetworkEntry {
  const variables = buildServiceVariables(service, sharedGlobalEnv, resolvedPorts).variables;
  const url = entry.url.replace(/\$\{([^}]+)\}/g, (match, key) => {
    const resolved = variables.find((candidate) => candidate.key === key.trim());
    return resolved ? resolved.value : match;
  });

  return {
    label: entry.label,
    url,
    kind: entry.kind ?? "service",
  };
}

export function buildServiceNetwork(
  service: DiscoveredService,
  sharedGlobalEnv: Record<string, string> = {},
  resolvedPorts: Record<string, number> = service.manifest.ports ?? {},
): ServiceNetworkPayload {
  const manifestEndpoints = (service.manifest.urls ?? []).map((entry) =>
    renderEndpointUrl(entry, service, sharedGlobalEnv, resolvedPorts),
  );
  const healthEndpoint =
    service.manifest.healthcheck?.type === "http"
      ? [
          {
            label: "health",
            url: renderEndpointUrl(
              { label: "health", url: service.manifest.healthcheck.url, kind: "health" },
              service,
              sharedGlobalEnv,
              resolvedPorts,
            ).url,
            kind: "health",
          },
        ]
      : [];
  const portmapping = Object.fromEntries(
    Object.entries(service.manifest.portmapping ?? {}).map(([key, value]) => [
      key,
      resolveServiceText(value, service, sharedGlobalEnv, resolvedPorts),
    ]),
  );

  return {
    serviceId: service.manifest.id,
    ports: { ...resolvedPorts },
    portmapping,
    endpoints: [...manifestEndpoints, ...healthEndpoint],
  };
}
