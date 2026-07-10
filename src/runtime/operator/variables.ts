import { getServiceStatePaths } from "../state/paths.js";
import type { DiscoveredService } from "../../contracts/service.js";
import { getLifecycleState } from "../lifecycle/store.js";
import path from "node:path";

export interface ServiceVariableEntry {
  key: string;
  value: string;
  scope: "manifest" | "derived" | "global";
}

export interface ServiceSelectorRef {
  selector: string;
  kind: "local" | "broker";
  key: string;
}

export interface ServiceSelectorPlan {
  selectors: ServiceSelectorRef[];
  localRefs: string[];
  brokerRefs: string[];
}

export interface ServiceSelectorDiagnostic {
  selector: string;
  kind: "local" | "broker";
  reason:
    | "unresolved-local"
    | "missing-broker"
    | "locked-broker"
    | "denied-broker"
    | "source-auth-required"
    | "source-unavailable"
    | "degraded-broker";
}

export interface ServiceVariableResolutionOptions {
  brokerValues?: Record<string, string>;
  diagnostics?: ServiceSelectorDiagnostic[];
  allowedBrokerRefs?: Set<string> | string[];
  deniedBrokerRefs?: Set<string> | string[];
  lockedBrokerRefs?: Set<string> | string[];
  sourceAuthRequiredBrokerRefs?: Set<string> | string[];
  sourceUnavailableBrokerRefs?: Set<string> | string[];
  degradedBrokerRefs?: Set<string> | string[];
}

export interface ServiceVariablesPayload {
  serviceId: string;
  variables: ServiceVariableEntry[];
  selectorPlan: ServiceSelectorPlan;
  diagnostics: ServiceSelectorDiagnostic[];
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

function hasRef(refs: Set<string> | string[] | undefined, ref: string): boolean {
  return Array.isArray(refs) ? refs.includes(ref) : refs?.has(ref) === true;
}

function replaceVariableSelectors(
  value: string,
  variables: ServiceVariableEntry[],
  options: ServiceVariableResolutionOptions = {},
): string {
  return value.replace(/\$\{([^}]+)\}/g, (match, key) => {
    const normalizedKey = normalizeVariableSelector(key);
    const entry = variables.find((candidate) => candidate.key === normalizedKey);
    if (entry) {
      return entry.value;
    }
    if (options.deniedBrokerRefs && hasRef(options.deniedBrokerRefs, normalizedKey)) {
      options.diagnostics?.push({ selector: normalizedKey, kind: "broker", reason: "denied-broker" });
      return match;
    }
    if (options.lockedBrokerRefs && hasRef(options.lockedBrokerRefs, normalizedKey)) {
      options.diagnostics?.push({ selector: normalizedKey, kind: "broker", reason: "locked-broker" });
      return match;
    }
    if (options.sourceAuthRequiredBrokerRefs && hasRef(options.sourceAuthRequiredBrokerRefs, normalizedKey)) {
      options.diagnostics?.push({ selector: normalizedKey, kind: "broker", reason: "source-auth-required" });
      return match;
    }
    if (options.sourceUnavailableBrokerRefs && hasRef(options.sourceUnavailableBrokerRefs, normalizedKey)) {
      options.diagnostics?.push({ selector: normalizedKey, kind: "broker", reason: "source-unavailable" });
      return match;
    }
    if (options.degradedBrokerRefs && hasRef(options.degradedBrokerRefs, normalizedKey)) {
      options.diagnostics?.push({ selector: normalizedKey, kind: "broker", reason: "degraded-broker" });
      return match;
    }
    if (Object.hasOwn(options.brokerValues ?? {}, normalizedKey)) {
      return options.brokerValues?.[normalizedKey] ?? match;
    }
    if (options.allowedBrokerRefs && hasRef(options.allowedBrokerRefs, normalizedKey)) {
      options.diagnostics?.push({ selector: normalizedKey, kind: "broker", reason: "missing-broker" });
    }
    return match;
  });
}

const selectorPlanCache = new Map<string, { fingerprint: string; plan: ServiceSelectorPlan }>();

function fingerprintSelectorValues(values: string[] | Record<string, string>): string {
  return JSON.stringify(Array.isArray(values) ? values : Object.entries(values).sort());
}

export function compileCachedServiceSelectorPlan(
  cacheKey: string,
  values: string[] | Record<string, string>,
): ServiceSelectorPlan {
  const fingerprint = fingerprintSelectorValues(values);
  const cached = selectorPlanCache.get(cacheKey);
  if (cached?.fingerprint === fingerprint) {
    return cached.plan;
  }
  const plan = compileServiceSelectorPlan(values);
  selectorPlanCache.set(cacheKey, { fingerprint, plan });
  return plan;
}

export function compileServiceSelectorPlan(values: string[] | Record<string, string>): ServiceSelectorPlan {
  const texts = Array.isArray(values) ? values : Object.values(values);
  const selectors = new Map<string, ServiceSelectorRef>();

  for (const text of texts) {
    for (const match of String(text).matchAll(/\$\{([^}]+)\}/g)) {
      const selector = normalizeVariableSelector(match[1] ?? "");
      if (!selector) continue;
      selectors.set(selector, {
        selector,
        kind: "local",
        key: selector,
      });
    }
  }

  const orderedSelectors = [...selectors.values()];
  return {
    selectors: orderedSelectors,
    localRefs: orderedSelectors.filter((selector) => selector.kind === "local").map((selector) => selector.key),
    brokerRefs: orderedSelectors.filter((selector) => selector.kind === "broker").map((selector) => selector.selector),
  };
}

export function buildServiceVariables(
  service: DiscoveredService,
  sharedGlobalEnv: Record<string, string> = {},
  resolvedPorts: Record<string, number> = service.manifest.ports ?? {},
  options: ServiceVariableResolutionOptions = {},
): ServiceVariablesPayload {
  const statePaths = getServiceStatePaths(service.serviceRoot);
  const installArtifact = getLifecycleState(service.manifest.id).installArtifacts.artifact;
  const executableHome = installArtifact?.extractedPath ?? service.serviceRoot;
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
    {
      key: "SERVICE_DATA_PATH",
      value: path.join(service.serviceRoot, "data"),
      scope: "derived",
    },
    {
      key: "SERVICE_EXECUTABLE_HOME",
      value: executableHome,
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

  const diagnostics: ServiceSelectorDiagnostic[] = [];
  const declaredBrokerRefs = (service.manifest.broker?.imports ?? []).map((entry) => entry.ref);
  const resolutionOptions: ServiceVariableResolutionOptions = {
    ...options,
    allowedBrokerRefs: options.allowedBrokerRefs ?? declaredBrokerRefs,
    diagnostics,
  };
  const manifestVariables = rawManifestVariables.map((entry) => ({
    ...entry,
    value: replaceVariableSelectors(
      entry.value,
      [...rawManifestVariables, ...globalVariables, ...derivedVariables],
      resolutionOptions,
    ),
  }));

  return {
    serviceId: service.manifest.id,
    variables: [...manifestVariables, ...globalVariables, ...derivedVariables],
    selectorPlan: compileCachedServiceSelectorPlan(
      `service:${service.manifestPath}:${service.manifest.id}:env`,
      service.manifest.env ?? {},
    ),
    diagnostics,
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

export function resolveServiceText(
  value: string,
  service: DiscoveredService,
  sharedGlobalEnv: Record<string, string> = {},
  resolvedPorts: Record<string, number> = service.manifest.ports ?? {},
  options: ServiceVariableResolutionOptions = {},
): string {
  const variablesPayload = buildServiceVariables(service, sharedGlobalEnv, resolvedPorts, options);
  const declaredBrokerRefs = (service.manifest.broker?.imports ?? []).map((entry) => entry.ref);
  return replaceVariableSelectors(value, variablesPayload.variables, {
    ...options,
    allowedBrokerRefs: options.allowedBrokerRefs ?? declaredBrokerRefs,
  });
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
