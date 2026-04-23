export interface ServiceVariablesResponse {
  variables: {
    serviceId: string;
    variables: { key: string; value: string; scope: "manifest" | "derived" | "global" }[];
  };
}

export function createServiceVariablesResponse(
  variables: ServiceVariablesResponse["variables"],
): ServiceVariablesResponse {
  return { variables };
}
