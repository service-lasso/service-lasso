import { getServiceStatePaths } from "../state/paths.js";
import type { DiscoveredService } from "../../contracts/service.js";
import { getLifecycleState } from "../lifecycle/store.js";
import path from "node:path";

export interface ServiceVariableEntry {
  key: string;
  value: string;
  scope: "manifest" | "derived" | "global";
}

export interface ServiceVariablesPayload {
  serviceId: string;
  variables: ServiceVariableEntry[];
}

function buildPortVariables(resolvedPorts: Record<string, number>): ServiceVariableEntry[] {
  const entries: ServiceVariableEntry[] = [];

  for (const [name, value] of Object.entries(resolvedPorts)) {
    const normalizedName = name.trim().replace(/[^A-Za-z0-9]+/g, "_").toUpperCase();
    entries.push({
      key: `${normalizedName}_PORT`,
      value: String(value),
      scope: "derived",
    });

    if (normalizedName === "SERVICE") {
      entries.push({
        key: "SERVICE_PORT",
        value: String(value),
        scope: "derived",
      });
    }
  }

  return entries;
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
  resolvedPorts: Record<string, number> = service.manifest.ports ?? {},
): ServiceVariablesPayload {
  const statePaths = getServiceStatePaths(service.serviceRoot);
  const installArtifact = getLifecycleState(service.manifest.id).installArtifacts.artifact;
  const rawManifestVariables = Object.entries(service.manifest.env ?? {}).map(([key, value]) => ({
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
    ...(installArtifact?.extractedPath
      ? [
          {
            key: "SERVICE_ARTIFACT_ROOT",
            value: installArtifact.extractedPath,
            scope: "derived" as const,
          },
        ]
      : []),
    ...(installArtifact?.command && installArtifact.extractedPath
      ? [
          {
            key: "SERVICE_ARTIFACT_COMMAND",
            value: path.resolve(installArtifact.extractedPath, installArtifact.command),
            scope: "derived" as const,
          },
        ]
      : []),
    ...buildPortVariables(resolvedPorts),
  ];

  const manifestVariables = rawManifestVariables.map((entry) => ({
    ...entry,
    value: replaceVariableSelectors(entry.value, [...rawManifestVariables, ...globalVariables, ...derivedVariables]),
  }));

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
  resolvedPorts: Record<string, number> = service.manifest.ports ?? {},
): Record<string, string> {
  const variables = buildServiceVariables(service, sharedGlobalEnv, resolvedPorts).variables;
  const configuredGlobalEnv = service.manifest.globalenv ?? {};

  return Object.fromEntries(
    Object.entries(configuredGlobalEnv).map(([key, value]) => [key, replaceVariableSelectors(value, variables)]),
  );
}

export function collectRuntimeGlobalEnv(services: DiscoveredService[]): Record<string, string> {
  const sharedGlobalEnv: Record<string, string> = {};

  for (const service of services) {
    const state = getLifecycleState(service.manifest.id);
    const resolvedPorts = Object.keys(state.runtime.ports).length > 0 ? state.runtime.ports : service.manifest.ports ?? {};
    Object.assign(sharedGlobalEnv, collectServiceGlobalEnv(service, sharedGlobalEnv, resolvedPorts));
  }

  return sharedGlobalEnv;
}

export function resolveServiceVariable(
  service: DiscoveredService,
  selector: string,
  sharedGlobalEnv: Record<string, string> = {},
  resolvedPorts: Record<string, number> = service.manifest.ports ?? {},
): ServiceVariableEntry | undefined {
  const key = normalizeVariableSelector(selector);
  return buildServiceVariables(service, sharedGlobalEnv, resolvedPorts).variables.find((entry) => entry.key === key);
}
