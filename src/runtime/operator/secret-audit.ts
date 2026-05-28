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

export type SecretRotationReadinessStatus = "ready" | "needs_policy" | "needs_capability" | "needs_auth_check" | "blocked";
export type SecretRotationPolicyStatus = "declared" | "missing" | "malformed";
export type SecretRotationCapabilityStatus = "supported" | "unsupported" | "unknown" | "blocked";
export type SecretRotationAuthRequirementStatus = "not_required" | "required" | "unknown" | "blocked";

export interface SecretRotationReadinessRef {
  serviceId: string;
  ref: string;
  namespace?: string;
  key?: string;
  status: SecretRotationReadinessStatus;
  policy: {
    status: SecretRotationPolicyStatus;
    reason: string;
  };
  providerCapability: {
    operation: "rotate";
    status: SecretRotationCapabilityStatus;
    reason: string;
  };
  authRequirement: {
    status: SecretRotationAuthRequirementStatus;
    reason: string;
  };
  lastUsed: {
    observedInManifest: boolean;
    referenceCount: number;
    sources: SecretReferenceAuditSource[];
    locations: string[];
    required: boolean;
  };
  blockers: string[];
}

export interface ServiceSecretRotationReadinessReport {
  serviceId: string;
  manifestPath: string;
  refs: SecretRotationReadinessRef[];
  summary: {
    ready: number;
    needsPolicy: number;
    needsCapability: number;
    needsAuthCheck: number;
    blocked: number;
  };
}

export interface SecretRotationReadinessReport {
  services: ServiceSecretRotationReadinessReport[];
  summary: ServiceSecretRotationReadinessReport["summary"] & {
    services: number;
    references: number;
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

function uniqueSorted<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort();
}

function mostSeverePolicyStatus(findings: SecretReferenceAuditFinding[]): SecretRotationPolicyStatus {
  if (findings.some((finding) => finding.status === "malformed")) {
    return "malformed";
  }
  if (findings.some((finding) => finding.status === "missing")) {
    return "missing";
  }
  return "declared";
}

function hasRotationWritebackPolicy(service: DiscoveredService, ref: string, namespace?: string): boolean {
  const writeback = service.manifest.broker?.writeback;
  if (!writeback) {
    return false;
  }

  if ((writeback.generatedSecrets ?? []).some((entry) => entry.ref === ref && entry.operation === "rotate")) {
    return true;
  }

  const allowedOperations = writeback.allowedOperations ?? [];
  if (!allowedOperations.includes("rotate")) {
    return false;
  }

  const allowedRefs = writeback.allowedRefs ?? [];
  if (allowedRefs.length > 0 && !allowedRefs.includes(ref)) {
    return false;
  }

  const allowedNamespaces = writeback.allowedNamespaces ?? [];
  if (namespace && allowedNamespaces.length > 0 && !allowedNamespaces.includes(namespace)) {
    return false;
  }

  return true;
}

function classifyCapability(
  service: DiscoveredService,
  ref: string,
  policyStatus: SecretRotationPolicyStatus,
  namespace?: string,
): SecretRotationReadinessRef["providerCapability"] {
  if (policyStatus !== "declared") {
    return {
      operation: "rotate",
      status: "blocked",
      reason: "Rotation capability cannot be evaluated until the reference policy is valid.",
    };
  }

  if (hasRotationWritebackPolicy(service, ref, namespace)) {
    return {
      operation: "rotate",
      status: "supported",
      reason: "The service manifest declares rotate writeback capability for this reference.",
    };
  }

  if (service.manifest.broker?.writeback) {
    return {
      operation: "rotate",
      status: "unsupported",
      reason: "The service manifest has broker writeback policy but does not allow rotate for this reference.",
    };
  }

  return {
    operation: "rotate",
    status: "unknown",
    reason: "No provider rotation capability is declared in the service manifest.",
  };
}

function classifyAuthRequirement(
  policyStatus: SecretRotationPolicyStatus,
  capabilityStatus: SecretRotationCapabilityStatus,
): SecretRotationReadinessRef["authRequirement"] {
  if (policyStatus !== "declared" || capabilityStatus === "blocked") {
    return {
      status: "blocked",
      reason: "Provider auth requirement cannot be evaluated until policy and capability blockers are cleared.",
    };
  }

  if (capabilityStatus === "supported") {
    return {
      status: "unknown",
      reason: "Core manifests do not carry live provider auth state; the Secrets Broker must confirm reconnect requirements before rotation.",
    };
  }

  return {
    status: "unknown",
    reason: "Provider auth requirement is unknown because rotation capability is not declared.",
  };
}

function toRotationReadinessRef(
  service: DiscoveredService,
  ref: string,
  findings: SecretReferenceAuditFinding[],
): SecretRotationReadinessRef {
  const parsed = parseBrokerRef(ref);
  const policyStatus = mostSeverePolicyStatus(findings);
  const capability = classifyCapability(service, ref, policyStatus, parsed?.namespace);
  const authRequirement = classifyAuthRequirement(policyStatus, capability.status);
  const blockers: string[] = [];

  if (policyStatus === "malformed") {
    blockers.push("malformed_ref");
  }
  if (policyStatus === "missing") {
    blockers.push("missing_broker_policy");
  }
  if (capability.status === "unsupported") {
    blockers.push("rotation_capability_not_declared");
  }
  if (capability.status === "unknown") {
    blockers.push("rotation_capability_unknown");
  }
  if (capability.status === "supported" && authRequirement.status === "unknown") {
    blockers.push("provider_auth_requirement_unknown");
  }

  const status: SecretRotationReadinessStatus =
    policyStatus === "malformed"
      ? "blocked"
      : policyStatus === "missing"
        ? "needs_policy"
        : capability.status === "supported" && authRequirement.status === "not_required"
          ? "ready"
          : capability.status === "supported"
            ? "needs_auth_check"
            : "needs_capability";

  return {
    serviceId: service.manifest.id,
    ref,
    namespace: parsed?.namespace,
    key: parsed?.key,
    status,
    policy: {
      status: policyStatus,
      reason:
        policyStatus === "declared"
          ? "Reference is declared in broker policy."
          : policyStatus === "missing"
            ? "Reference is used but not declared in broker policy."
            : "Reference is not in supported namespace.key form.",
    },
    providerCapability: capability,
    authRequirement,
    lastUsed: {
      observedInManifest: findings.length > 0,
      referenceCount: findings.length,
      sources: uniqueSorted(findings.map((finding) => finding.source)),
      locations: uniqueSorted(findings.map((finding) => finding.location)),
      required: findings.some((finding) => finding.required !== false),
    },
    blockers,
  };
}

function summarizeRotationReadiness(refs: SecretRotationReadinessRef[]): ServiceSecretRotationReadinessReport["summary"] {
  return {
    ready: refs.filter((ref) => ref.status === "ready").length,
    needsPolicy: refs.filter((ref) => ref.status === "needs_policy").length,
    needsCapability: refs.filter((ref) => ref.status === "needs_capability").length,
    needsAuthCheck: refs.filter((ref) => ref.status === "needs_auth_check").length,
    blocked: refs.filter((ref) => ref.status === "blocked").length,
  };
}

export function buildServiceSecretRotationReadinessReport(service: DiscoveredService): ServiceSecretRotationReadinessReport {
  const audit = buildServiceSecretReferenceAudit(service);
  const findingsByRef = new Map<string, SecretReferenceAuditFinding[]>();

  for (const finding of audit.findings) {
    findingsByRef.set(finding.ref, [...(findingsByRef.get(finding.ref) ?? []), finding]);
  }

  const refs = [...findingsByRef.entries()]
    .map(([ref, findings]) => toRotationReadinessRef(service, ref, findings))
    .sort((left, right) =>
      left.status.localeCompare(right.status) ||
      left.ref.localeCompare(right.ref),
    );

  return {
    serviceId: service.manifest.id,
    manifestPath: service.manifestPath,
    refs,
    summary: summarizeRotationReadiness(refs),
  };
}

export function buildSecretRotationReadinessReport(services: DiscoveredService[]): SecretRotationReadinessReport {
  const serviceReports = services.map((service) => buildServiceSecretRotationReadinessReport(service));
  const summaries = serviceReports.map((service) => service.summary);

  return {
    services: serviceReports,
    summary: {
      services: serviceReports.length,
      references: serviceReports.reduce((total, service) => total + service.refs.length, 0),
      ready: summaries.reduce((total, summary) => total + summary.ready, 0),
      needsPolicy: summaries.reduce((total, summary) => total + summary.needsPolicy, 0),
      needsCapability: summaries.reduce((total, summary) => total + summary.needsCapability, 0),
      needsAuthCheck: summaries.reduce((total, summary) => total + summary.needsAuthCheck, 0),
      blocked: summaries.reduce((total, summary) => total + summary.blocked, 0),
    },
  };
}
