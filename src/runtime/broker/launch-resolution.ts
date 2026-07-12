import type {
  DiscoveredService,
  ServiceBrokerBucket,
  ServiceBrokerImport,
  ServiceBrokerWritebackOperation,
} from "../../contracts/service.js";
import {
  compileCachedServiceSelectorPlan,
  type ServiceSelectorPlan,
  type ServiceVariableResolutionOptions,
} from "../operator/variables.js";

export type BrokerLaunchLookupStatus =
  | "resolved"
  | "missing"
  | "locked"
  | "auth-required"
  | "policy-denied"
  | "source-unavailable"
  | "degraded";

export interface BrokerLaunchLookupDecision {
  ref: string;
  status: BrokerLaunchLookupStatus;
  value?: string;
}

export interface BrokerLaunchLookupRequest {
  service: DiscoveredService;
  refs: string[];
}

export type BrokerLaunchLookup = (
  request: BrokerLaunchLookupRequest,
) => Promise<BrokerLaunchLookupDecision[]> | BrokerLaunchLookupDecision[];

export interface ServiceStartupBrokerPlan {
  serviceId: string;
  selectorPlan: ServiceSelectorPlan;
  brokerRefs: string[];
  buckets: Array<{
    namespace: string;
    kind: ServiceBrokerBucket["kind"] | null;
  }>;
  imports: Array<{
    namespace: string;
    ref: string;
    as: string | null;
    required: boolean;
  }>;
  writeback: {
    allowedNamespaces: string[];
    allowedOperations: ServiceBrokerWritebackOperation[];
    allowedRefs: string[];
    allowOverwrite: boolean;
    auditReason: string | null;
    generatedSecrets: ServiceStartupBrokerGeneratedSecretPlan[];
  };
}

export type ServiceStartupBrokerGeneratedSecretKind =
  | "password"
  | "api-token"
  | "session-secret"
  | "token"
  | "secret";

export interface ServiceStartupBrokerGeneratedSecretPlan {
  namespace: string | null;
  ref: string;
  operation: ServiceBrokerWritebackOperation;
  required: boolean;
  sourceRefs: string[];
  valuePolicy: {
    kind: ServiceStartupBrokerGeneratedSecretKind;
    bytes: number;
    encoding: "base64url";
    minEntropyBits: number;
  };
  overwrite: "allow" | "deny";
  auditReason: string | null;
}

export interface ServiceStartupBrokerFailure {
  ref: string;
  status: Exclude<BrokerLaunchLookupStatus, "resolved">;
  required: boolean;
  as: string | null;
}

export interface ServiceStartupBrokerResolution {
  serviceId: string;
  plan: ServiceStartupBrokerPlan;
  variableResolution: ServiceVariableResolutionOptions;
  decisions: Array<Omit<BrokerLaunchLookupDecision, "value">>;
  failures: ServiceStartupBrokerFailure[];
}

function normalizeImport(entry: ServiceBrokerImport) {
  return {
    namespace: entry.namespace,
    ref: entry.ref,
    as: entry.as ?? null,
    required: entry.required === true,
  };
}

function normalizeBucket(entry: ServiceBrokerBucket) {
  return {
    namespace: entry.namespace,
    kind: entry.kind ?? null,
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function inferGeneratedSecretKind(
  ref: string,
  source: string,
): ServiceStartupBrokerGeneratedSecretKind {
  const subject = `${ref} ${source}`.toLowerCase();
  if (subject.includes("password") || /\bpass\b/.test(subject)) return "password";
  if (subject.includes("session")) return "session-secret";
  if (subject.includes("api") && subject.includes("token")) return "api-token";
  if (subject.includes("token")) return "token";
  return "secret";
}

function generatedSecretPolicy(
  ref: string,
  source: string,
): ServiceStartupBrokerGeneratedSecretPlan["valuePolicy"] {
  const bytes = 32;
  return {
    kind: inferGeneratedSecretKind(ref, source),
    bytes,
    encoding: "base64url",
    minEntropyBits: bytes * 8,
  };
}

function setToArray(values: Set<string>): string[] | undefined {
  return values.size > 0 ? [...values] : undefined;
}

function mergeRecords(
  left: Record<string, string> | undefined,
  right: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!left && !right) {
    return undefined;
  }
  return { ...(left ?? {}), ...(right ?? {}) };
}

function mergeLists(
  left: Set<string> | string[] | undefined,
  right: string[] | undefined,
): string[] | undefined {
  const merged = new Set<string>();
  if (Array.isArray(left)) {
    for (const value of left) merged.add(value);
  } else if (left) {
    for (const value of left) merged.add(value);
  }
  for (const value of right ?? []) merged.add(value);
  return merged.size > 0 ? [...merged] : undefined;
}

export function mergeServiceVariableResolutionOptions(
  base: ServiceVariableResolutionOptions = {},
  launch: ServiceVariableResolutionOptions = {},
): ServiceVariableResolutionOptions {
  return {
    ...base,
    ...launch,
    brokerValues: mergeRecords(base.brokerValues, launch.brokerValues),
    deniedBrokerRefs: mergeLists(
      base.deniedBrokerRefs,
      launch.deniedBrokerRefs as string[] | undefined,
    ),
    lockedBrokerRefs: mergeLists(
      base.lockedBrokerRefs,
      launch.lockedBrokerRefs as string[] | undefined,
    ),
    sourceAuthRequiredBrokerRefs: mergeLists(
      base.sourceAuthRequiredBrokerRefs,
      launch.sourceAuthRequiredBrokerRefs as string[] | undefined,
    ),
    sourceUnavailableBrokerRefs: mergeLists(
      base.sourceUnavailableBrokerRefs,
      launch.sourceUnavailableBrokerRefs as string[] | undefined,
    ),
    degradedBrokerRefs: mergeLists(
      base.degradedBrokerRefs,
      launch.degradedBrokerRefs as string[] | undefined,
    ),
    diagnostics: base.diagnostics ?? launch.diagnostics,
  };
}

export function compileServiceStartupBrokerPlan(
  service: DiscoveredService,
): ServiceStartupBrokerPlan {
  const broker = service.manifest.broker;
  const imports = (service.manifest.broker?.imports ?? []).map(normalizeImport);
  const importTemplates = imports.map((entry) => `\${${entry.ref}}`);
  const exportsByRef = new Map((broker?.exports ?? []).map((entry) => [entry.ref, entry]));
  const writeback = broker?.writeback;
  const generatedSecrets: ServiceStartupBrokerGeneratedSecretPlan[] = (writeback?.generatedSecrets ?? []).map((entry) => {
    const exportEntry = exportsByRef.get(entry.ref);
    const sourcePlan = compileCachedServiceSelectorPlan(
      `service:${service.manifestPath}:${service.manifest.id}:startup-broker:writeback:${entry.ref}`,
      [entry.source],
    );
    return {
      namespace: exportEntry?.namespace ?? null,
      ref: entry.ref,
      operation: entry.operation ?? "create",
      required: entry.required === true || exportEntry?.required === true,
      sourceRefs: unique(sourcePlan.selectors.map((selector) => selector.selector)),
      valuePolicy: generatedSecretPolicy(entry.ref, entry.source),
      overwrite: writeback?.allowOverwrite === true ? "allow" : "deny",
      auditReason: writeback?.auditReason ?? null,
    };
  });
  const selectorPlan = compileCachedServiceSelectorPlan(
    `service:${service.manifestPath}:${service.manifest.id}:startup-broker`,
    {
      env: JSON.stringify(service.manifest.env ?? {}),
      imports: JSON.stringify(imports),
      importTemplates: importTemplates.join("\n"),
      generatedSecrets: JSON.stringify(
        generatedSecrets.map((entry) => ({
          namespace: entry.namespace,
          ref: entry.ref,
          operation: entry.operation,
          required: entry.required,
          sourceRefs: entry.sourceRefs,
        })),
      ),
    },
  );

  return {
    serviceId: service.manifest.id,
    selectorPlan,
    brokerRefs: unique([
      ...selectorPlan.brokerRefs,
      ...imports.map((entry) => entry.ref),
    ]),
    buckets: (broker?.buckets ?? []).map(normalizeBucket),
    imports,
    writeback: {
      allowedNamespaces: [...(writeback?.allowedNamespaces ?? [])],
      allowedOperations: [...(writeback?.allowedOperations ?? ["create", "update", "rotate", "delete"])],
      allowedRefs: [...(writeback?.allowedRefs ?? [])],
      allowOverwrite: writeback?.allowOverwrite === true,
      auditReason: writeback?.auditReason ?? null,
      generatedSecrets,
    },
  };
}

function importByRef(
  imports: ServiceStartupBrokerPlan["imports"],
): Map<string, ServiceStartupBrokerPlan["imports"][number]> {
  const result = new Map<string, ServiceStartupBrokerPlan["imports"][number]>();
  for (const entry of imports) {
    result.set(entry.ref, entry);
  }
  return result;
}

export async function resolveServiceStartupBrokerResolution(
  service: DiscoveredService,
  lookup: BrokerLaunchLookup,
  baseResolution: ServiceVariableResolutionOptions = {},
): Promise<ServiceStartupBrokerResolution> {
  const plan = compileServiceStartupBrokerPlan(service);
  const decisions = await lookup({ service, refs: plan.brokerRefs });
  const expectedRefs = new Set(plan.brokerRefs);
  const importMap = importByRef(plan.imports);
  const brokerValues: Record<string, string> = {};
  const denied = new Set<string>();
  const locked = new Set<string>();
  const authRequired = new Set<string>();
  const sourceUnavailable = new Set<string>();
  const degraded = new Set<string>();
  const seen = new Set<string>();
  const failures: ServiceStartupBrokerFailure[] = [];

  const addFailure = (
    ref: string,
    status: ServiceStartupBrokerFailure["status"],
  ) => {
    const imported = importMap.get(ref);
    failures.push({
      ref,
      status,
      required: imported?.required === true,
      as: imported?.as ?? null,
    });
  };

  for (const decision of decisions) {
    if (!expectedRefs.has(decision.ref) || seen.has(decision.ref)) {
      continue;
    }
    seen.add(decision.ref);

    if (decision.status === "resolved" && decision.value !== undefined) {
      brokerValues[decision.ref] = decision.value;
      continue;
    }

    if (decision.status === "policy-denied") denied.add(decision.ref);
    if (decision.status === "locked") locked.add(decision.ref);
    if (decision.status === "auth-required") authRequired.add(decision.ref);
    if (decision.status === "source-unavailable")
      sourceUnavailable.add(decision.ref);
    if (decision.status === "degraded") degraded.add(decision.ref);
    addFailure(
      decision.ref,
      decision.status === "resolved" ? "missing" : decision.status,
    );
  }

  for (const ref of plan.brokerRefs) {
    if (!seen.has(ref)) {
      addFailure(ref, "missing");
    }
  }

  return {
    serviceId: service.manifest.id,
    plan,
    variableResolution: mergeServiceVariableResolutionOptions(baseResolution, {
      brokerValues,
      deniedBrokerRefs: setToArray(denied),
      lockedBrokerRefs: setToArray(locked),
      sourceAuthRequiredBrokerRefs: setToArray(authRequired),
      sourceUnavailableBrokerRefs: setToArray(sourceUnavailable),
      degradedBrokerRefs: setToArray(degraded),
    }),
    decisions: decisions
      .filter((decision) => expectedRefs.has(decision.ref))
      .map((decision) => ({ ref: decision.ref, status: decision.status })),
    failures,
  };
}

export function summarizeRequiredStartupBrokerFailures(
  resolution: ServiceStartupBrokerResolution,
): ServiceStartupBrokerFailure[] {
  return resolution.failures.filter((failure) => failure.required);
}
