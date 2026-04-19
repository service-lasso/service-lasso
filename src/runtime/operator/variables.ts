import { getServiceStatePaths } from "../state/paths.js";
import type { DiscoveredService } from "../../contracts/service.js";

export interface ServiceVariableEntry {
  key: string;
  value: string;
  scope: "manifest" | "derived";
}

export interface ServiceVariablesPayload {
  serviceId: string;
  variables: ServiceVariableEntry[];
}

export function buildServiceVariables(service: DiscoveredService): ServiceVariablesPayload {
  const statePaths = getServiceStatePaths(service.serviceRoot);
  const manifestVariables = Object.entries(service.manifest.env ?? {}).map(([key, value]) => ({
    key,
    value,
    scope: "manifest" as const,
  }));

  const derivedVariables: ServiceVariableEntry[] = [
    {
      key: "SERVICE_ID",
      value: service.manifest.id,
      scope: "derived",
    },
    {
      key: "SERVICE_ROOT",
      value: service.serviceRoot,
      scope: "derived",
    },
    {
      key: "SERVICE_STATE_ROOT",
      value: statePaths.stateRoot,
      scope: "derived",
    },
  ];

  return {
    serviceId: service.manifest.id,
    variables: [...manifestVariables, ...derivedVariables],
  };
}
