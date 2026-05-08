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

export interface ServiceSelectorPlanCacheStats {
  planHits: number;
  planMisses: number;
  planInvalidations: number;
  templateHits: number;
  templateMisses: number;
  planEntries: number;
  templateEntries: number;
}

interface CompiledServiceSelectorTemplate {
  tokens: Array<string | { raw: string; ref: ServiceSelectorRef }>;
  selectors: ServiceSelectorRef[];
}

interface CachedSelectorPlan {
  fingerprint: string;
  plan: ServiceSelectorPlan;
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

const compiledTemplateCache = new Map<string, CompiledServiceSelectorTemplate>();
const selectorPlanCache = new Map<string, CachedSelectorPlan>();
const selectorPlanCacheStats = {
  planHits: 0,
  planMisses: 0,
  planInvalidations: 0,
  templateHits: 0,
  templateMisses: 0,
};

export function resetServiceSelectorPlanCache(): void {
  compiledTemplateCache.clear();
  selectorPlanCache.clear();
  selectorPlanCacheStats.planHits = 0;
  selectorPlanCacheStats.planMisses = 0;
  selectorPlanCacheStats.planInvalidations = 0;
  selectorPlanCacheStats.templateHits = 0;
  selectorPlanCacheStats.templateMisses = 0;
}

export function getServiceSelectorPlanCacheStats(): ServiceSelectorPlanCacheStats {
  return {
    ...selectorPlanCacheStats,
    planEntries: selectorPlanCache.size,
    templateEntries: compiledTemplateCache.size,
  };
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

function compileServiceSelectorTemplate(value: string): CompiledServiceSelectorTemplate {
  const cached = compiledTemplateCache.get(value);
  if (cached) {
    selectorPlanCacheStats.templateHits += 1;
    return cached;
  }

  selectorPlanCacheStats.templateMisses += 1;
  const tokens: CompiledServiceSelectorTemplate["tokens"] = [];
  const selectors = new Map<string, ServiceSelectorRef>();
  const selectorPattern = /\$\{([^}]+)\}/g;
  let cursor = 0;

  for (const match of value.matchAll(selectorPattern)) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > cursor) {
      tokens.push(value.slice(cursor, matchIndex));
    }

    const raw = match[0];
    const ref = createSelectorRef(match[1]);
    tokens.push({ raw, ref });
    selectors.set(ref.selector, ref);
    cursor = matchIndex + raw.length;
  }

  if (cursor < value.length) {
    tokens.push(value.slice(cursor));
  }

  const compiled = { tokens, selectors: [...selectors.values()] };
  compiledTemplateCache.set(value, compiled);
  return compiled;
}

function fingerprintSelectorValues(values: string[] | Record<string, string>): string {
  if (Array.isArray(values)) {
    return JSON.stringify({ kind: "array", values });
  }

  return JSON.stringify({
    kind: "record",
    values: Object.keys(values)
      .sort()
      .map((key) => [key, values[key]]),
  });
}

export function compileCachedServiceSelectorPlan(
  cacheKey: string,
  values: string[] | Record<string, string>,
): ServiceSelectorPlan {
  const fingerprint = fingerprintSelectorValues(values);
  const cached = selectorPlanCache.get(cacheKey);

  if (cached?.fingerprint === fingerprint) {
    selectorPlanCacheStats.planHits += 1;
    return cached.plan;
  }

  if (cached) {
    selectorPlanCacheStats.planInvalidations += 1;
  }

  selectorPlanCacheStats.planMisses += 1;
  const plan = compileServiceSelectorPlan(values);
  selectorPlanCache.set(cacheKey, { fingerprint, plan });
  return plan;
}

export function compileServiceSelectorPlan(values: string[] | Record<string, string>): ServiceSelectorPlan {
  const texts = Array.isArray(values) ? values : Object.values(values);
  const selectors = new Map<string, ServiceSelectorRef>();

  for (const text of texts) {
    for (const ref of compileServiceSelectorTemplate(text).selectors) {
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
  const compiled = compileServiceSelectorTemplate(value);
  return compiled.tokens
    .map((token) => {
      if (typeof token === "string") {
        return token;
      }

      const { raw, ref } = token;
      if (ref.kind === "broker") {
        if (options.allowedBrokerRefs && !hasRef(options.allowedBrokerRefs, ref.selector)) {
          options.diagnostics?.push({ selector: ref.selector, kind: "broker", reason: "denied-broker" });
          return raw;
        }
        if (hasRef(options.deniedBrokerRefs, ref.selector)) {
          options.diagnostics?.push({ selector: ref.selector, kind: "broker", reason: "denied-broker" });
          return raw;
        }
        if (hasRef(options.sourceAuthRequiredBrokerRefs, ref.selector)) {
          options.diagnostics?.push({ selector: ref.selector, kind: "broker", reason: "source-auth-required" });
          return raw;
        }
        const brokerValue = options.brokerValues?.[ref.selector];
        if (brokerValue !== undefined) {
          return brokerValue;
        }
        options.diagnostics?.push({ selector: ref.selector, kind: "broker", reason: "missing-broker" });
        return raw;
      }

      const entry = variables.find((candidate) => candidate.key === ref.key);
      if (!entry) {
        options.diagnostics?.push({ selector: ref.selector, kind: "local", reason: "unresolved-local" });
      }
      return entry ? entry.value : raw;
    })
    .join("");
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
    selectorPlan: compileCachedServiceSelectorPlan(
      `service:${service.manifestPath}:${service.manifest.id}:env`,
      service.manifest.env ?? {},
    ),
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
  const cacheKey = `service:${service.manifestPath}:${service.manifest.id}:materialization`;
  const fingerprintValues = {
    env: JSON.stringify(service.manifest.env ?? {}),
    globalenv: JSON.stringify(service.manifest.globalenv ?? {}),
    imports: JSON.stringify(service.manifest.broker?.imports ?? []),
    exports: JSON.stringify(service.manifest.broker?.exports ?? []),
    install: JSON.stringify(installFiles),
    config: JSON.stringify(configFiles),
  };
  const fingerprint = fingerprintSelectorValues(fingerprintValues);
  const cached = selectorPlanCache.get(cacheKey);

  if (cached?.fingerprint === fingerprint) {
    selectorPlanCacheStats.planHits += 1;
    return cached.plan;
  }

  if (cached) {
    selectorPlanCacheStats.planInvalidations += 1;
  }

  selectorPlanCacheStats.planMisses += 1;
  const plan = mergeSelectorPlans([
    compileCachedServiceSelectorPlan(`${cacheKey}:env`, service.manifest.env ?? {}),
    compileCachedServiceSelectorPlan(`${cacheKey}:globalenv`, service.manifest.globalenv ?? {}),
    compileCachedServiceSelectorPlan(
      `${cacheKey}:broker-imports`,
      (service.manifest.broker?.imports ?? []).map((entry) => `\${${entry.ref}}`),
    ),
    compileCachedServiceSelectorPlan(
      `${cacheKey}:broker-exports`,
      (service.manifest.broker?.exports ?? []).flatMap((entry) => [`\${${entry.ref}}`, entry.source]),
    ),
    compileCachedServiceSelectorPlan(
      `${cacheKey}:install`,
      installFiles.flatMap((file) => [file.path, file.content]),
    ),
    compileCachedServiceSelectorPlan(
      `${cacheKey}:config`,
      configFiles.flatMap((file) => [file.path, file.content]),
    ),
  ]);

  selectorPlanCache.set(cacheKey, { fingerprint, plan });
  return plan;
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
