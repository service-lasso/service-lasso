export interface ServiceNetworkResponse {
  network: {
    serviceId: string;
    ports: Record<string, number>;
    portmapping: Record<string, string>;
    endpoints: { label: string; url: string; kind: string }[];
  };
}

export function createServiceNetworkResponse(network: ServiceNetworkResponse["network"]): ServiceNetworkResponse {
  return { network };
}
