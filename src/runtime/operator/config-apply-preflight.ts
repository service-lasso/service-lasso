import { readFile } from "node:fs/promises";
import type { DiscoveredService } from "../../contracts/service.js";
import { getLifecycleState } from "../lifecycle/store.js";
import type { ServiceRegistry } from "../manager/ServiceRegistry.js";
import { buildServiceConfigDriftReport, type ConfigDriftReport } from "./config-drift.js";
import { buildServiceSecretReferenceAudit, type SecretReferenceAuditFinding } from "./secret-audit.js";

export type ConfigApplyPreflightStatus = "allowed" | "warning" | "blocked";

export interface ConfigApplyPreflightGate {
  gate: string;
  status: ConfigApplyPreflightStatus;
  reason: string;
}

export interface ConfigApplyPreflightSecretRef {
  ref: string;
  source: SecretReferenceAuditFinding["source"];
  location: string;
  status: SecretReferenceAuditFinding["status"];
  required?: boolean;
}

export interface ConfigApplyPreflightUnsupportedField {
  location: string;
  reason: string;
}

export interface ConfigApplyPreflightServiceReport {
  serviceId: string;
  status: ConfigApplyPreflightStatus;
  dryRun: true;
  mutated: false;
  generatedAt: string;
  configured: boolean;
  running: boolean;
  policyGates: ConfigApplyPreflightGate[];
  restartRequirement: {
    required: boolean;
    reason: string;
  };
  unsupportedFields: ConfigApplyPreflightUnsupportedField[];
  secretRefChanges: {
    count: number;
    refs: ConfigApplyPreflightSecretRef[];
  };
  expectedOperatorImpact: string[];
  configDrift?: ConfigDriftReport;
}

export interface ConfigApplyPreflightReport {
  action: "preflight";
  ok: boolean;
  dryRun: true;
  mutated: false;
  generatedAt: string;
  summary: {
    services: number;
    allowed: number;
    warning: number;
    blocked: number;
  };
  services: ConfigApplyPreflightServiceReport[];
}

const CONFIG_APPLY_SUPPORTED_FIELDS = new Set(["files"]);

function worstStatus(statuses: ConfigApplyPreflightStatus[]): ConfigApplyPreflightStatus {
  if (statuses.includes("blocked")) {
    return "blocked";
  }
  if (statuses.includes("warning")) {
    return "warning";
  }
  return "allowed";
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function collectUnsupportedConfigFields(service: DiscoveredService): Promise<ConfigApplyPreflightUnsupportedField[]> {
  let config: unknown = service.manifest.config;
  try {
    const rawManifest = JSON.parse(await readFile(service.manifestPath, "utf8")) as unknown;
    if (isPlainRecord(rawManifest) && rawManifest.config !== undefined) {
      config = rawManifest.config;
    }
  } catch {
    config = service.manifest.config;
  }

  if (!isPlainRecord(config)) {
    return [];
  }

  return Object.keys(config)
    .filter((field) => !CONFIG_APPLY_SUPPORTED_FIELDS.has(field))
    .sort()
    .map((field) => ({
      location: "config." + field,
      reason: "The config apply preflight only supports config.files in this slice.",
    }));
}

function collectConfigSecretRefs(service: DiscoveredService): ConfigApplyPreflightSecretRef[] {
  const configRelevantSources = new Set<SecretReferenceAuditFinding["source"]>([
    "env",
    "globalenv",
    "config",
    "broker.import",
    "broker.export",
    "broker.writeback",
  ]);

  return buildServiceSecretReferenceAudit(service).findings
    .filter((finding) => configRelevantSources.has(finding.source))
    .map((finding) => ({
      ref: finding.ref,
      source: finding.source,
      location: finding.location,
      status: finding.status,
      required: finding.required,
    }));
}

function configChangesRequireRestart(drift: ConfigDriftReport | undefined): boolean {
  return Boolean(drift && drift.summary.drifted > 0);
}

function buildImpact(drift: ConfigDriftReport | undefined, restartRequired: boolean): string[] {
  if (!drift) {
    return ["Config apply is blocked before file impact can be calculated."];
  }

  const impact: string[] = [];
  if (drift.summary.missing > 0) {
    impact.push(`${drift.summary.missing} config file(s) would be created.`);
  }
  if (drift.summary.changed > 0) {
    impact.push(`${drift.summary.changed} config file(s) would be updated.`);
  }
  if (drift.summary.unmanaged > 0) {
    impact.push(`${drift.summary.unmanaged} previously materialized file(s) are no longer declared.`);
  }
  if (drift.summary.drifted === 0) {
    impact.push("No materialized config file changes are expected.");
  }
  if (restartRequired) {
    impact.push("Running service may need restart after config apply.");
  }
  impact.push("No raw secret values are included in this dry-run report.");
  return impact;
}

export async function buildServiceConfigApplyPreflightReport(
  service: DiscoveredService,
  services: DiscoveredService[],
): Promise<ConfigApplyPreflightServiceReport> {
  const lifecycle = getLifecycleState(service.manifest.id);
  const unsupportedFields = await collectUnsupportedConfigFields(service);
  const secretRefs = collectConfigSecretRefs(service);
  const policyGates: ConfigApplyPreflightGate[] = [];
  let drift: ConfigDriftReport | undefined;

  if (!lifecycle.installed) {
    policyGates.push({
      gate: "lifecycle.installed",
      status: "blocked",
      reason: "Config apply requires the service to be installed first.",
    });
  } else {
    policyGates.push({
      gate: "lifecycle.installed",
      status: "allowed",
      reason: "Service is installed.",
    });
  }

  if (service.manifest.enabled === false) {
    policyGates.push({
      gate: "service.enabled",
      status: "warning",
      reason: "Service is disabled; config can be planned but operators should confirm intent before applying.",
    });
  }

  if (unsupportedFields.length > 0) {
    policyGates.push({
      gate: "config.supported_fields",
      status: "warning",
      reason: "Unsupported config fields are present and will not be applied by this preflight slice.",
    });
  } else {
    policyGates.push({
      gate: "config.supported_fields",
      status: "allowed",
      reason: "Only supported config fields are present.",
    });
  }

  const secretBlockers = secretRefs.filter((ref) => ref.status !== "present" && ref.required !== false);
  if (secretBlockers.length > 0) {
    policyGates.push({
      gate: "secret_refs",
      status: "blocked",
      reason: "Required secret references used by config materialization are missing or malformed.",
    });
  } else if (secretRefs.length > 0) {
    policyGates.push({
      gate: "secret_refs",
      status: "allowed",
      reason: "Secret references are declared without exposing values.",
    });
  } else {
    policyGates.push({
      gate: "secret_refs",
      status: "allowed",
      reason: "No secret references are used by config materialization.",
    });
  }

  try {
    drift = await buildServiceConfigDriftReport(service, services);
    policyGates.push({
      gate: "materialization_paths",
      status: "allowed",
      reason: "Config file paths stay inside the service root.",
    });
  } catch (error) {
    policyGates.push({
      gate: "materialization_paths",
      status: "blocked",
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  const restartRequired = lifecycle.running && configChangesRequireRestart(drift);
  if (restartRequired) {
    policyGates.push({
      gate: "restart",
      status: "warning",
      reason: "The service is running and materialized config would change.",
    });
  }

  const status = worstStatus(policyGates.map((gate) => gate.status));

  return {
    serviceId: service.manifest.id,
    status,
    dryRun: true,
    mutated: false,
    generatedAt: new Date().toISOString(),
    configured: lifecycle.configured,
    running: lifecycle.running,
    policyGates,
    restartRequirement: {
      required: restartRequired,
      reason: restartRequired
        ? "Apply would change materialized config for a running service."
        : "No restart requirement detected by this dry-run preflight.",
    },
    unsupportedFields,
    secretRefChanges: {
      count: secretRefs.length,
      refs: secretRefs,
    },
    expectedOperatorImpact: buildImpact(drift, restartRequired),
    configDrift: drift,
  };
}

export async function buildConfigApplyPreflightReport(
  registry: ServiceRegistry,
  serviceId?: string,
): Promise<ConfigApplyPreflightReport> {
  const services = serviceId
    ? [registry.getById(serviceId)].filter((service) => service !== undefined)
    : registry.list();

  if (serviceId && services.length === 0) {
    const available = registry.list().map((entry) => entry.manifest.id).sort();
    const hint = available.length > 0 ? ` Available services: ${available.join(", ")}.` : "";
    throw new Error(`Unknown service id: ${serviceId}.${hint}`);
  }

  const reports = await Promise.all(
    services.map((service) => buildServiceConfigApplyPreflightReport(service, registry.list())),
  );
  const summary = {
    services: reports.length,
    allowed: reports.filter((service) => service.status === "allowed").length,
    warning: reports.filter((service) => service.status === "warning").length,
    blocked: reports.filter((service) => service.status === "blocked").length,
  };

  return {
    action: "preflight",
    ok: summary.blocked === 0,
    dryRun: true,
    mutated: false,
    generatedAt: new Date().toISOString(),
    summary,
    services: reports,
  };
}
