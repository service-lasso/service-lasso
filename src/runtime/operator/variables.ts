import { getServiceStatePaths } from "../state/paths.js";
import type { DiscoveredService } from "../../contracts/service.js";

export interface ServiceVariableEntry {
  key: string;
  value: string;
  scope: "manifest" | "derived" | "global";
}

export interface ServiceVariablesPayload {
  serviceId: string;
  variables: ServiceVariableEntry[];
}

function replaceVariableSelectors(value: string, variables: ServiceVariableEntry[]): string {
  return value.replace(/\$\{([^}]+)\}/g, (match, key) => {
    const normalizedKey = normalizeVariableSelector(key);
    const entry = variables.find((candidate) => candidate.key === normalizedKey);
    return entry ? entry.value : match;
  });
}

export function buildServiceVariables(
  service: DiscoveredService,
  sharedGlobalEnv: Record<string, string> = {},
): ServiceVariablesPayload {
  const statePaths = getServiceStatePaths(service.serviceRoot);
  const manifestVariables = Object.entries(service.manifest.env ?? {}).map(([key, value]) => ({
    key,
    value,
    scope: "manifest" as const,
  }));

  const globalVariables = Object.entries(sharedGlobalEnv).map(([key, value]) => ({
    key,
    value,
    scope: "global" as const,
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
    variables: [...manifestVariables, ...globalVariables, ...derivedVariables],
  };
}

function normalizeVariableSelector(selector: string): string {
  const trimmed = selector.trim();
  const match = trimmed.match(/^\$\{(.+)\}$/);
  return (match?.[1] ?? trimmed).trim();
}

export function collectServiceGlobalEnv(
  service: DiscoveredService,
  sharedGlobalEnv: Record<string, string> = {},
): Record<string, string> {
  const variables = buildServiceVariables(service, sharedGlobalEnv).variables;
  const configuredGlobalEnv = service.manifest.globalenv ?? {};

  return Object.fromEntries(
    Object.entries(configuredGlobalEnv).map(([key, value]) => [key, replaceVariableSelectors(value, variables)]),
  );
}

export function collectRuntimeGlobalEnv(services: DiscoveredService[]): Record<string, string> {
  const sharedGlobalEnv: Record<string, string> = {};

  for (const service of services) {
    Object.assign(sharedGlobalEnv, collectServiceGlobalEnv(service, sharedGlobalEnv));
  }

  return sharedGlobalEnv;
}

export function resolveServiceVariable(
  service: DiscoveredService,
  selector: string,
  sharedGlobalEnv: Record<string, string> = {},
): ServiceVariableEntry | undefined {
  const key = normalizeVariableSelector(selector);
  return buildServiceVariables(service, sharedGlobalEnv).variables.find((entry) => entry.key === key);
}
