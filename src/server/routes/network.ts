export interface ServiceNetworkResponse {
  network: {
    serviceId: string;
    ports: Record<string, number>;
    portmapping: Record<string, string>;
    endpoints: {
      id: string;
      label: string;
      kind: string;
      url?: string;
      bind?: string;
      port?: number;
      protocol?: string;
      transport?: string;
      exposure?: string;
      target?: string;
      source: string;
    }[];
  };
}

export function createServiceNetworkResponse(network: ServiceNetworkResponse["network"]): ServiceNetworkResponse {
  return { network };
}
