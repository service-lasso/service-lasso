import { createHash } from "node:crypto";
import type {
  DiscoveredService,
  ServiceBrokerImport,
  ServiceManifest,
} from "../../contracts/service.js";

export type LegacyEnvSource = "env" | "globalenv";
export type LegacyEnvClassification = "secret" | "non-secret" | "ambiguous";
export type LegacyMigrationCandidateState =
  | "planned"
  | "needs-confirmation"
  | "denied"
  | "unsupported";

export interface LegacySecretMetadata {
  present: boolean;
  length: number;
  fingerprint: string | null;
  valueKind: "empty" | "literal" | "selector";
}

export interface LegacyGlobalEnvMigrationCandidate {
  serviceId: string;
  source: LegacyEnvSource;
  key: string;
  classification: LegacyEnvClassification;
  state: LegacyMigrationCandidateState;
  reasons: string[];
  metadata: LegacySecretMetadata;
  proposed?: {
    namespace: string;
    ref: string;
    as: string;
    provider: string;
    backend: string;
    required: boolean;
  };
}

export interface LegacyGlobalEnvServiceMigrationPlan {
  serviceId: string;
  manifestPath: string;
  candidates: LegacyGlobalEnvMigrationCandidate[];
  proposedChanges: Array<{
    source: LegacyEnvSource;
    key: string;
    action: "replace-env-with-broker-ref" | "manual-globalenv-writeback";
    ref: string | null;
    required: boolean;
  }>;
}

export interface LegacyGlobalEnvMigrationPlan {
  mode: "dry-run";
  services: LegacyGlobalEnvServiceMigrationPlan[];
  summary: {
    servicesScanned: number;
    candidates: number;
    planned: number;
    needsConfirmation: number;
    denied: number;
    unsupported: number;
  };
  rollbackGuidance: string[];
}

export interface LegacyGlobalEnvMigrationOptions {
  provider?: string;
  backend?: string;
  namespaceForService?: (service: DiscoveredService) => string;
  denyKeys?: string[] | Set<string>;
  includeAmbiguous?: boolean;
}

export interface LegacyGlobalEnvMigrationApplyOptions {
  confirmation?: string;
  auditReason?: string;
  allowAmbiguous?: boolean;
}

export interface LegacyGlobalEnvMigrationApplyResult {
  ok: boolean;
  auditReason: string;
  updatedManifests: Record<string, ServiceManifest>;
  applied: Array<{ serviceId: string; key: string; ref: string }>;
  skipped: Array<{
    serviceId: string;
    key: string;
    state: LegacyMigrationCandidateState;
    reason: string;
  }>;
  rollbackGuidance: string[];
}

const APPLY_CONFIRMATION = "APPLY_LEGACY_GLOBALENV_MIGRATION";

function normalizeKeyRef(key: string): string {
  return key
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/g, "_")
    .replace(/^[^A-Za-z]+/, "")
    .toUpperCase();
}

function normalizeServiceRefPrefix(serviceId: string): string {
  const normalized = serviceId
    .trim()
    .replace(/^@+/, "")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^[^A-Za-z]+/, "service");
  return normalized || "service";
}

function metadataForValue(value: string): LegacySecretMetadata {
  const fingerprint = value
    ? createHash("sha256").update(value).digest("hex").slice(0, 16)
    : null;
  return {
    present: value.length > 0,
    length: value.length,
    fingerprint,
    valueKind:
      value.length === 0
        ? "empty"
        : /^\$\{[^}]+\}$/.test(value.trim())
          ? "selector"
          : "literal",
  };
}

function hasDeniedKey(
  key: string,
  denied: string[] | Set<string> | undefined,
): boolean {
  if (!denied) return false;
  return Array.isArray(denied) ? denied.includes(key) : denied.has(key);
}

export function classifyLegacyEnvKey(key: string): {
  classification: LegacyEnvClassification;
  reasons: string[];
} {
  const normalized = key.toUpperCase();
  const secretPatterns = [
    "SECRET",
    "TOKEN",
    "PASSWORD",
    "PASSWD",
    "PRIVATE_KEY",
    "API_KEY",
    "CLIENT_SECRET",
    "WEBHOOK_SECRET",
    "SIGNING_KEY",
  ];
  const nonSecretPatterns = [
    "PUBLIC_URL",
    "BASE_URL",
    "HOST",
    "PORT",
    "LOG_LEVEL",
    "NODE_ENV",
  ];
  const ambiguousPatterns = [
    "AUTH",
    "CREDENTIAL",
    "DSN",
    "CONNECTION",
    "CONN_STRING",
    "KEY",
  ];

  const secretMatch = secretPatterns.find((pattern) =>
    normalized.includes(pattern),
  );
  if (secretMatch) {
    return { classification: "secret", reasons: [`key-match:${secretMatch}`] };
  }

  const nonSecretMatch = nonSecretPatterns.find(
    (pattern) => normalized === pattern || normalized.endsWith(`_${pattern}`),
  );
  if (nonSecretMatch) {
    return {
      classification: "non-secret",
      reasons: [`key-match:${nonSecretMatch}`],
    };
  }

  const ambiguousMatch = ambiguousPatterns.find((pattern) =>
    normalized.includes(pattern),
  );
  if (ambiguousMatch) {
    return {
      classification: "ambiguous",
      reasons: [`key-match:${ambiguousMatch}`],
    };
  }

  return { classification: "non-secret", reasons: ["no-secret-pattern"] };
}

function proposedForCandidate(
  service: DiscoveredService,
  key: string,
  options: LegacyGlobalEnvMigrationOptions,
): LegacyGlobalEnvMigrationCandidate["proposed"] {
  const namespace =
    options.namespaceForService?.(service) ?? `services/${service.manifest.id}`;
  return {
    namespace,
    ref: `${normalizeServiceRefPrefix(service.manifest.id)}.${normalizeKeyRef(key)}`,
    as: key,
    provider: options.provider ?? "@secretsbroker",
    backend: options.backend ?? "local",
    required: true,
  };
}

function candidateForEntry(
  service: DiscoveredService,
  source: LegacyEnvSource,
  key: string,
  value: string,
  options: LegacyGlobalEnvMigrationOptions,
): LegacyGlobalEnvMigrationCandidate {
  const { classification, reasons } = classifyLegacyEnvKey(key);
  const denied = hasDeniedKey(key, options.denyKeys);
  const unsupported = source === "globalenv";
  const includeAmbiguous = options.includeAmbiguous === true;
  const state: LegacyMigrationCandidateState = denied
    ? "denied"
    : unsupported
      ? "unsupported"
      : classification === "secret"
        ? "planned"
        : classification === "ambiguous" && includeAmbiguous
          ? "needs-confirmation"
          : classification === "ambiguous"
            ? "needs-confirmation"
            : "unsupported";

  return {
    serviceId: service.manifest.id,
    source,
    key,
    classification,
    state,
    reasons: [
      ...reasons,
      ...(denied ? ["policy-denied"] : []),
      ...(unsupported ? ["globalenv-manual-writeback-required"] : []),
    ],
    metadata: metadataForValue(value),
    proposed:
      state === "planned" || state === "needs-confirmation"
        ? proposedForCandidate(service, key, options)
        : undefined,
  };
}

function scanService(
  service: DiscoveredService,
  options: LegacyGlobalEnvMigrationOptions,
): LegacyGlobalEnvServiceMigrationPlan {
  const candidates: LegacyGlobalEnvMigrationCandidate[] = [];

  for (const [key, value] of Object.entries(service.manifest.env ?? {})) {
    candidates.push(candidateForEntry(service, "env", key, value, options));
  }

  for (const [key, value] of Object.entries(service.manifest.globalenv ?? {})) {
    candidates.push(
      candidateForEntry(service, "globalenv", key, value, options),
    );
  }

  const proposedChanges = candidates
    .filter(
      (candidate) =>
        candidate.state === "planned" ||
        candidate.state === "needs-confirmation",
    )
    .map((candidate) => ({
      source: candidate.source,
      key: candidate.key,
      action:
        candidate.source === "env"
          ? ("replace-env-with-broker-ref" as const)
          : ("manual-globalenv-writeback" as const),
      ref: candidate.proposed?.ref ?? null,
      required: candidate.proposed?.required === true,
    }));

  return {
    serviceId: service.manifest.id,
    manifestPath: service.manifestPath,
    candidates,
    proposedChanges,
  };
}

export function createLegacyGlobalEnvMigrationPlan(
  services: DiscoveredService[],
  options: LegacyGlobalEnvMigrationOptions = {},
): LegacyGlobalEnvMigrationPlan {
  const servicePlans = services.map((service) => scanService(service, options));
  const candidates = servicePlans.flatMap((service) => service.candidates);

  return {
    mode: "dry-run",
    services: servicePlans,
    summary: {
      servicesScanned: services.length,
      candidates: candidates.length,
      planned: candidates.filter((candidate) => candidate.state === "planned")
        .length,
      needsConfirmation: candidates.filter(
        (candidate) => candidate.state === "needs-confirmation",
      ).length,
      denied: candidates.filter((candidate) => candidate.state === "denied")
        .length,
      unsupported: candidates.filter(
        (candidate) => candidate.state === "unsupported",
      ).length,
    },
    rollbackGuidance: [
      "Keep a copy of each original service.json before applying migration changes.",
      "Rollback by restoring the original env/globalenv entries and removing generated broker.imports for affected refs.",
      "If broker writeback/import partially fails, keep services stopped until missing required refs are restored or the manifest is rolled back.",
    ],
  };
}

function cloneManifest(manifest: ServiceManifest): ServiceManifest {
  return JSON.parse(JSON.stringify(manifest)) as ServiceManifest;
}

function hasImport(
  imports: ServiceBrokerImport[],
  ref: string,
  as: string,
): boolean {
  return imports.some((entry) => entry.ref === ref || entry.as === as);
}

function redactedValue(candidate: LegacyGlobalEnvMigrationCandidate): string {
  return candidate.metadata.fingerprint
    ? `[redacted:${candidate.metadata.fingerprint}]`
    : "[redacted]";
}

function shouldRedactSkippedCandidate(
  candidate: LegacyGlobalEnvMigrationCandidate,
): boolean {
  return (
    candidate.classification === "secret" ||
    candidate.classification === "ambiguous"
  );
}

export function applyLegacyGlobalEnvMigrationPlan(
  plan: LegacyGlobalEnvMigrationPlan,
  services: DiscoveredService[],
  options: LegacyGlobalEnvMigrationApplyOptions,
): LegacyGlobalEnvMigrationApplyResult {
  if (options.confirmation !== APPLY_CONFIRMATION) {
    throw new Error(
      `Migration apply requires confirmation token ${APPLY_CONFIRMATION}.`,
    );
  }
  const auditReason = options.auditReason?.trim();
  if (!auditReason) {
    throw new Error("Migration apply requires a non-empty audit reason.");
  }

  const servicesById = new Map(
    services.map((service) => [service.manifest.id, service]),
  );
  const updatedManifests: Record<string, ServiceManifest> = {};
  const applied: LegacyGlobalEnvMigrationApplyResult["applied"] = [];
  const skipped: LegacyGlobalEnvMigrationApplyResult["skipped"] = [];

  for (const servicePlan of plan.services) {
    const service = servicesById.get(servicePlan.serviceId);
    if (!service) continue;
    const manifest = cloneManifest(service.manifest);
    manifest.env = { ...(manifest.env ?? {}) };
    manifest.broker = { ...(manifest.broker ?? {}), enabled: true };
    manifest.broker.imports = [...(manifest.broker.imports ?? [])];

    for (const candidate of servicePlan.candidates) {
      if (candidate.source !== "env") {
        manifest.globalenv = { ...(manifest.globalenv ?? {}) };
        if (shouldRedactSkippedCandidate(candidate)) {
          manifest.globalenv[candidate.key] = redactedValue(candidate);
        }
        skipped.push({
          serviceId: candidate.serviceId,
          key: candidate.key,
          state: candidate.state,
          reason:
            "globalenv requires manual broker writeback planning before manifest apply",
        });
        continue;
      }
      if (
        candidate.state === "needs-confirmation" &&
        options.allowAmbiguous !== true
      ) {
        if (shouldRedactSkippedCandidate(candidate)) {
          manifest.env[candidate.key] = redactedValue(candidate);
        }
        skipped.push({
          serviceId: candidate.serviceId,
          key: candidate.key,
          state: candidate.state,
          reason: "ambiguous candidate requires allowAmbiguous",
        });
        continue;
      }
      if (
        candidate.state !== "planned" &&
        candidate.state !== "needs-confirmation"
      ) {
        if (shouldRedactSkippedCandidate(candidate)) {
          manifest.env[candidate.key] = redactedValue(candidate);
        }
        skipped.push({
          serviceId: candidate.serviceId,
          key: candidate.key,
          state: candidate.state,
          reason: candidate.reasons.join(", "),
        });
        continue;
      }
      if (!candidate.proposed) continue;

      manifest.env[candidate.key] = `\${${candidate.proposed.ref}}`;
      if (
        !hasImport(
          manifest.broker.imports,
          candidate.proposed.ref,
          candidate.proposed.as,
        )
      ) {
        manifest.broker.imports.push({
          namespace: candidate.proposed.namespace,
          ref: candidate.proposed.ref,
          as: candidate.proposed.as,
          required: candidate.proposed.required,
        });
      }
      applied.push({
        serviceId: candidate.serviceId,
        key: candidate.key,
        ref: candidate.proposed.ref,
      });
    }

    updatedManifests[service.manifest.id] = manifest;
  }

  return {
    ok: skipped.length === 0,
    auditReason,
    updatedManifests,
    applied,
    skipped,
    rollbackGuidance: plan.rollbackGuidance,
  };
}
