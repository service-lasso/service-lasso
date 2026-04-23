export interface ServiceNetworkResponse {
  network: {
    serviceId: string;
    ports: Record<string, number>;
    endpoints: { label: string; url: string; kind: string }[];
  };
}

export function createServiceNetworkResponse(network: ServiceNetworkResponse["network"]): ServiceNetworkResponse {
  return { network };
}
