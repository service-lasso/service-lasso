import { getServiceStatePaths } from "../state/paths.js";
import type { DiscoveredService } from "../../contracts/service.js";
import { getLifecycleState } from "../lifecycle/store.js";
import path from "node:path";

export interface ServiceVariableEntry {
  key: string;
  value: string;
  scope: "manifest" | "derived" | "global" | "broker";
}

export type ServiceSelectorKind = "local" | "broker";

export interface ServiceSelectorRef {
  selector: string;
  kind: ServiceSelectorKind;
  namespace?: string;
  key: string;
}

export interface ServiceSelectorPlan {
  selectors: ServiceSelectorRef[];
  localRefs: string[];
  brokerRefs: string[];
}

export type ServiceSelectorDiagnosticReason = "unresolved-local" | "missing-broker" | "denied-broker" | "source-auth-required";

export interface ServiceSelectorDiagnostic {
  selector: string;
  kind: ServiceSelectorKind;
  reason: ServiceSelectorDiagnosticReason;
}

export interface ServiceTextResolutionOptions {
  brokerValues?: Record<string, string>;
  diagnostics?: ServiceSelectorDiagnostic[];
  allowedBrokerRefs?: Set<string> | string[];
  deniedBrokerRefs?: Set<string> | string[];
  sourceAuthRequiredBrokerRefs?: Set<string> | string[];
}

export interface ServiceVariableResolutionOptions extends ServiceTextResolutionOptions {}

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

function normalizeVariableSelector(selector: string): string {
  const trimmed = selector.trim();
  const match = trimmed.match(/^\$\{(.+)\}$/);
  return (match?.[1] ?? trimmed).trim();
}

function isBrokerSelector(selector: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_-]*\.[A-Za-z0-9_.-]+$/.test(selector.trim());
}

function createSelectorRef(selector: string): ServiceSelectorRef {
  const normalizedSelector = normalizeVariableSelector(selector);
  if (isBrokerSelector(normalizedSelector)) {
    const dotIndex = normalizedSelector.indexOf(".");
    return {
      selector: normalizedSelector,
      kind: "broker",
      namespace: normalizedSelector.slice(0, dotIndex),
      key: normalizedSelector.slice(dotIndex + 1),
    };
  }

  return {
    selector: normalizedSelector,
    kind: "local",
    key: normalizedSelector,
  };
}

export function compileServiceSelectorPlan(values: string[] | Record<string, string>): ServiceSelectorPlan {
  const texts = Array.isArray(values) ? values : Object.values(values);
  const selectors = new Map<string, ServiceSelectorRef>();

  for (const text of texts) {
    for (const match of text.matchAll(/\$\{([^}]+)\}/g)) {
      const ref = createSelectorRef(match[1]);
      selectors.set(ref.selector, ref);
    }
  }

  const orderedSelectors = [...selectors.values()];
  return {
    selectors: orderedSelectors,
    localRefs: orderedSelectors.filter((selector) => selector.kind === "local").map((selector) => selector.key),
    brokerRefs: orderedSelectors.filter((selector) => selector.kind === "broker").map((selector) => selector.selector),
  };
}

function mergeSelectorPlans(plans: ServiceSelectorPlan[]): ServiceSelectorPlan {
  const selectors = new Map<string, ServiceSelectorRef>();
  for (const plan of plans) {
    for (const selector of plan.selectors) {
      selectors.set(selector.selector, selector);
    }
  }

  const orderedSelectors = [...selectors.values()];
  return {
    selectors: orderedSelectors,
    localRefs: orderedSelectors.filter((selector) => selector.kind === "local").map((selector) => selector.key),
    brokerRefs: orderedSelectors.filter((selector) => selector.kind === "broker").map((selector) => selector.selector),
  };
}

function hasRef(refs: Set<string> | string[] | undefined, ref: string): boolean {
  if (!refs) {
    return false;
  }
  return Array.isArray(refs) ? refs.includes(ref) : refs.has(ref);
}

function replaceVariableSelectors(
  value: string,
  variables: ServiceVariableEntry[],
  options: ServiceTextResolutionOptions = {},
): string {
  return value.replace(/\$\{([^}]+)\}/g, (match, key) => {
    const ref = createSelectorRef(key);
    if (ref.kind === "broker") {
      if (options.allowedBrokerRefs && !hasRef(options.allowedBrokerRefs, ref.selector)) {
        options.diagnostics?.push({ selector: ref.selector, kind: "broker", reason: "denied-broker" });
        return match;
      }
      if (hasRef(options.deniedBrokerRefs, ref.selector)) {
        options.diagnostics?.push({ selector: ref.selector, kind: "broker", reason: "denied-broker" });
        return match;
      }
      if (hasRef(options.sourceAuthRequiredBrokerRefs, ref.selector)) {
        options.diagnostics?.push({ selector: ref.selector, kind: "broker", reason: "source-auth-required" });
        return match;
      }
      const brokerValue = options.brokerValues?.[ref.selector];
      if (brokerValue !== undefined) {
        return brokerValue;
      }
      options.diagnostics?.push({ selector: ref.selector, kind: "broker", reason: "missing-broker" });
      return match;
    }

    const entry = variables.find((candidate) => candidate.key === ref.key);
    if (!entry) {
      options.diagnostics?.push({ selector: ref.selector, kind: "local", reason: "unresolved-local" });
    }
    return entry ? entry.value : match;
  });
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

  const manifestDiagnostics: ServiceSelectorDiagnostic[] = [];
  const declaredBrokerRefs = (service.manifest.broker?.imports ?? []).map((entry) => entry.ref);
  const allowedBrokerRefs = declaredBrokerRefs.length > 0 ? declaredBrokerRefs : undefined;
  const brokerResolutionOptions: ServiceTextResolutionOptions = {
    ...options,
    allowedBrokerRefs,
    diagnostics: manifestDiagnostics,
  };
  const manifestVariables = rawManifestVariables.map((entry) => ({
    ...entry,
    value: replaceVariableSelectors(entry.value, [...rawManifestVariables, ...globalVariables, ...derivedVariables], brokerResolutionOptions),
  }));

  const manifestVariableKeys = new Set(manifestVariables.map((entry) => entry.key));
  const brokerImportVariables = (service.manifest.broker?.imports ?? [])
    .filter((entry) => entry.as && !manifestVariableKeys.has(entry.as))
    .flatMap((entry): ServiceVariableEntry[] => {
      if (hasRef(options.deniedBrokerRefs, entry.ref)) {
        manifestDiagnostics.push({ selector: entry.ref, kind: "broker", reason: "denied-broker" });
        return [];
      }
      if (hasRef(options.sourceAuthRequiredBrokerRefs, entry.ref)) {
        manifestDiagnostics.push({ selector: entry.ref, kind: "broker", reason: "source-auth-required" });
        return [];
      }
      const brokerValue = options.brokerValues?.[entry.ref];
      if (brokerValue === undefined) {
        manifestDiagnostics.push({ selector: entry.ref, kind: "broker", reason: "missing-broker" });
        return [];
      }
      return [{ key: entry.as as string, value: brokerValue, scope: "broker" }];
    });

  return {
    serviceId: service.manifest.id,
    variables: [...manifestVariables, ...brokerImportVariables, ...globalVariables, ...derivedVariables],
    selectorPlan: compileServiceSelectorPlan(service.manifest.env ?? {}),
    diagnostics: manifestDiagnostics,
  };
}

export function collectServiceGlobalEnv(
  service: DiscoveredService,
  sharedGlobalEnv: Record<string, string> = {},
  resolvedPorts: Record<string, number> = service.manifest.ports ?? {},
): Record<string, string> {
  const variablesPayload = buildServiceVariables(service, sharedGlobalEnv, resolvedPorts);
  const variables = variablesPayload.variables;
  const configuredGlobalEnv = service.manifest.globalenv ?? {};

  return Object.fromEntries(
    Object.entries(configuredGlobalEnv).map(([key, value]) => [key, replaceVariableSelectors(value, variables)]),
  );
}

export function compileServiceMaterializationSelectorPlan(service: DiscoveredService): ServiceSelectorPlan {
  const installFiles = service.manifest.install?.files ?? [];
  const configFiles = service.manifest.config?.files ?? [];

  return mergeSelectorPlans([
    compileServiceSelectorPlan(service.manifest.env ?? {}),
    compileServiceSelectorPlan(service.manifest.globalenv ?? {}),
    compileServiceSelectorPlan((service.manifest.broker?.imports ?? []).map((entry) => `\${${entry.ref}}`)),
    compileServiceSelectorPlan((service.manifest.broker?.exports ?? []).flatMap((entry) => [`\${${entry.ref}}`, entry.source])),
    compileServiceSelectorPlan(installFiles.flatMap((file) => [file.path, file.content])),
    compileServiceSelectorPlan(configFiles.flatMap((file) => [file.path, file.content])),
  ]);
}

export function resolveServiceText(
  value: string,
  service: DiscoveredService,
  sharedGlobalEnv: Record<string, string> = {},
  resolvedPorts: Record<string, number> = {},
  options: ServiceTextResolutionOptions = {},
): string {
  const variablesPayload = buildServiceVariables(service, sharedGlobalEnv, resolvedPorts, options);
  const declaredBrokerRefs = (service.manifest.broker?.imports ?? []).map((entry) => entry.ref);
  return replaceVariableSelectors(value, variablesPayload.variables, {
    ...options,
    allowedBrokerRefs: declaredBrokerRefs.length > 0 ? declaredBrokerRefs : undefined,
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
  const ref = createSelectorRef(selector);
  if (ref.kind === "broker") {
    return undefined;
  }
  return buildServiceVariables(service, sharedGlobalEnv, resolvedPorts).variables.find((entry) => entry.key === ref.key);
}
