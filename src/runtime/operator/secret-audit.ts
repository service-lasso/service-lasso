import type { DiscoveredService, ServiceBrokerImport } from "../../contracts/service.js";

export type SecretReferenceAuditStatus = "present" | "missing" | "malformed";
export type SecretReferenceAuditSource =
  | "env"
  | "globalenv"
  | "install"
  | "config"
  | "broker.import"
  | "broker.export"
  | "broker.writeback";

export interface SecretReferenceAuditFinding {
  serviceId: string;
  ref: string;
  namespace?: string;
  key?: string;
  status: SecretReferenceAuditStatus;
  source: SecretReferenceAuditSource;
  location: string;
  required?: boolean;
  reason: string;
}

export interface ServiceSecretReferenceAudit {
  serviceId: string;
  manifestPath: string;
  findings: SecretReferenceAuditFinding[];
  summary: {
    present: number;
    missing: number;
    malformed: number;
  };
}

export interface SecretReferenceAudit {
  services: ServiceSecretReferenceAudit[];
  summary: {
    services: number;
    references: number;
    present: number;
    missing: number;
    malformed: number;
  };
}

interface CandidateRef {
  ref: string;
  source: SecretReferenceAuditSource;
  location: string;
  required?: boolean;
  declared: boolean;
}

const brokerRefPattern = /^[A-Za-z][A-Za-z0-9_-]*\.[A-Za-z0-9_.-]+$/;
const selectorPattern = /\$\{([^}]+)\}/g;

function parseBrokerRef(ref: string): { namespace: string; key: string } | null {
  const trimmed = ref.trim();
  if (!brokerRefPattern.test(trimmed)) {
    return null;
  }

  const dotIndex = trimmed.indexOf(".");
  return {
    namespace: trimmed.slice(0, dotIndex),
    key: trimmed.slice(dotIndex + 1),
  };
}

function isSecretLikeLocalSelector(selector: string): boolean {
  return /(^|[_\-.])(SECRET|TOKEN|PASSWORD|PASS|KEY|CREDENTIAL|CREDENTIALS)([_\-.]|$)/i.test(selector);
}

function addSelectorCandidates(
  candidates: CandidateRef[],
  declaredRefs: Set<string>,
  value: string | undefined,
  source: SecretReferenceAuditSource,
  location: string,
): void {
  if (!value) {
    return;
  }

  selectorPattern.lastIndex = 0;
  for (const match of value.matchAll(selectorPattern)) {
    const selector = match[1]?.trim() ?? "";
    if (parseBrokerRef(selector)) {
      candidates.push({
        ref: selector,
        source,
        location,
        declared: declaredRefs.has(selector),
      });
      continue;
    }

    if (isSecretLikeLocalSelector(selector)) {
      candidates.push({
        ref: selector,
        source,
        location,
        declared: false,
      });
    }
  }
}

function addRecordSelectorCandidates(
  candidates: CandidateRef[],
  declaredRefs: Set<string>,
  values: Record<string, string> | undefined,
  source: SecretReferenceAuditSource,
  parentPath: string,
): void {
  for (const [key, value] of Object.entries(values ?? {})) {
    addSelectorCandidates(candidates, declaredRefs, value, source, parentPath + "." + key);
  }
}

function addBrokerImport(
  candidates: CandidateRef[],
  declaredRefs: Set<string>,
  entry: ServiceBrokerImport,
  index: number,
): void {
  if (entry.ref) {
    declaredRefs.add(entry.ref);
  }
  candidates.push({
    ref: entry.ref,
    source: "broker.import",
    location: "broker.imports[" + index + "].ref",
    required: entry.required !== false,
    declared: true,
  });
}

function collectCandidates(service: DiscoveredService): CandidateRef[] {
  const candidates: CandidateRef[] = [];
  const declaredRefs = new Set<string>();

  for (const [index, entry] of (service.manifest.broker?.imports ?? []).entries()) {
    addBrokerImport(candidates, declaredRefs, entry, index);
  }

  for (const [index, entry] of (service.manifest.broker?.exports ?? []).entries()) {
    declaredRefs.add(entry.ref);
    candidates.push({
      ref: entry.ref,
      source: "broker.export",
      location: "broker.exports[" + index + "].ref",
      required: entry.required !== false,
      declared: true,
    });
    addSelectorCandidates(candidates, declaredRefs, entry.source, "broker.export", "broker.exports[" + index + "].source");
  }

  for (const [index, entry] of (service.manifest.broker?.writeback?.generatedSecrets ?? []).entries()) {
    declaredRefs.add(entry.ref);
    candidates.push({
      ref: entry.ref,
      source: "broker.writeback",
      location: "broker.writeback.generatedSecrets[" + index + "].ref",
      required: entry.required !== false,
      declared: true,
    });
    addSelectorCandidates(
      candidates,
      declaredRefs,
      entry.source,
      "broker.writeback",
      "broker.writeback.generatedSecrets[" + index + "].source",
    );
  }

  addRecordSelectorCandidates(candidates, declaredRefs, service.manifest.env, "env", "env");
  addRecordSelectorCandidates(candidates, declaredRefs, service.manifest.globalenv, "globalenv", "globalenv");

  for (const [index, file] of (service.manifest.install?.files ?? []).entries()) {
    addSelectorCandidates(candidates, declaredRefs, file.content, "install", "install.files[" + index + "].content");
  }

  for (const [index, file] of (service.manifest.config?.files ?? []).entries()) {
    addSelectorCandidates(candidates, declaredRefs, file.content, "config", "config.files[" + index + "].content");
  }

  return candidates;
}

function toFinding(serviceId: string, candidate: CandidateRef): SecretReferenceAuditFinding {
  const parsed = parseBrokerRef(candidate.ref);
  if (!parsed) {
    return {
      serviceId,
      ref: candidate.ref,
      status: "malformed",
      source: candidate.source,
      location: candidate.location,
      required: candidate.required,
      reason: "Reference is secret-shaped but is not a supported broker ref in namespace.key form.",
    };
  }

  return {
    serviceId,
    ref: candidate.ref,
    namespace: parsed.namespace,
    key: parsed.key,
    status: candidate.declared ? "present" : "missing",
    source: candidate.source,
    location: candidate.location,
    required: candidate.required,
    reason: candidate.declared
      ? "Broker reference is declared in the service manifest."
      : "Broker selector is used but not declared in broker imports, exports, or writeback policy.",
  };
}

function summarize(findings: SecretReferenceAuditFinding[]): ServiceSecretReferenceAudit["summary"] {
  return {
    present: findings.filter((finding) => finding.status === "present").length,
    missing: findings.filter((finding) => finding.status === "missing").length,
    malformed: findings.filter((finding) => finding.status === "malformed").length,
  };
}

export function buildServiceSecretReferenceAudit(service: DiscoveredService): ServiceSecretReferenceAudit {
  const findings = collectCandidates(service)
    .map((candidate) => toFinding(service.manifest.id, candidate))
    .sort((left, right) =>
      left.status.localeCompare(right.status) ||
      left.ref.localeCompare(right.ref) ||
      left.location.localeCompare(right.location),
    );

  return {
    serviceId: service.manifest.id,
    manifestPath: service.manifestPath,
    findings,
    summary: summarize(findings),
  };
}

export function buildSecretReferenceAudit(services: DiscoveredService[]): SecretReferenceAudit {
  const serviceAudits = services.map((service) => buildServiceSecretReferenceAudit(service));
  const serviceSummaries = serviceAudits.map((service) => service.summary);

  return {
    services: serviceAudits,
    summary: {
      services: serviceAudits.length,
      references: serviceAudits.reduce((total, service) => total + service.findings.length, 0),
      present: serviceSummaries.reduce((total, summary) => total + summary.present, 0),
      missing: serviceSummaries.reduce((total, summary) => total + summary.missing, 0),
      malformed: serviceSummaries.reduce((total, summary) => total + summary.malformed, 0),
    },
  };
}
