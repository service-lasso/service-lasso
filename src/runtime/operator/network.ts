import type { DiscoveredService, ServiceEndpointKind } from "../../contracts/service.js";
import { endpointUrlFromNetwork, resolveServiceEndpoints } from "./endpoints.js";
import { resolveServiceText } from "./variables.js";

export interface ServiceNetworkEntry {
  id: string;
  label: string;
  kind: ServiceEndpointKind | "health";
  url?: string;
  bind?: string;
  port?: number;
  protocol?: string;
  transport?: string;
  exposure?: string;
  target?: string;
  source: string;
}

export interface ServiceNetworkPayload {
  serviceId: string;
  ports: Record<string, number>;
  portmapping: Record<string, string>;
  endpoints: ServiceNetworkEntry[];
}

export function buildServiceNetwork(
  service: DiscoveredService,
  sharedGlobalEnv: Record<string, string> = {},
  resolvedPorts: Record<string, number> = service.manifest.ports ?? {},
): ServiceNetworkPayload {
  const resolvedEndpoints = resolveServiceEndpoints(service, resolvedPorts);
  const endpointUrls = new Map(
    resolvedEndpoints
      .map((endpoint) => [
        endpoint.id,
        endpoint.url
          ? resolveServiceText(endpoint.url, service, sharedGlobalEnv, resolvedPorts)
          : endpointUrlFromNetwork(endpoint.protocol, endpoint.bind, endpoint.port),
      ] as const)
      .filter((entry): entry is [string, string] => entry[1] !== undefined),
  );

  const manifestEndpoints = resolvedEndpoints.map((endpoint): ServiceNetworkEntry => ({
    id: endpoint.id,
    label: endpoint.label,
    kind: endpoint.kind,
    url: endpointUrls.get(endpoint.id) ?? (endpoint.target ? endpointUrls.get(endpoint.target) : undefined),
    bind: endpoint.bind,
    port: endpoint.port,
    protocol: endpoint.protocol,
    transport: endpoint.transport,
    exposure: endpoint.exposure,
    target: endpoint.target,
    source: endpoint.source,
  }));
  const healthEndpoint =
    service.manifest.healthcheck?.type === "http"
      ? [
          {
            id: "health",
            label: "health",
            url: resolveServiceText(service.manifest.healthcheck.url, service, sharedGlobalEnv, resolvedPorts),
            kind: "health" as const,
            source: "healthcheck",
          },
        ]
      : [];
  const portmapping = Object.fromEntries(
    Object.entries(service.manifest.portmapping ?? {}).map(([key, value]) => [
      key,
      resolveServiceText(String(value), service, sharedGlobalEnv, resolvedPorts),
    ]),
  );

  return {
    serviceId: service.manifest.id,
    ports: { ...resolvedPorts },
    portmapping,
    endpoints: [...manifestEndpoints, ...healthEndpoint],
  };
}
