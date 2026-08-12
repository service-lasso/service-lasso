import path from "node:path";
import type { DiscoveredService, ServiceManifest } from "../../contracts/service.js";
import { compareTimestampedReleaseTags } from "../updates/check.js";

export type TemplateUpgradeFindingKind =
  | "missing-optional-provider"
  | "missing-required-provider"
  | "provider-role-mismatch"
  | "provider-source-mismatch"
  | "provider-release-stale"
  | "provider-release-drift"
  | "provider-version-drift"
  | "provider-platform-gap"
  | "provider-artifact-missing"
  | "unknown-provider-reference";

export type TemplateUpgradeFindingSeverity = "info" | "warning" | "error";

export interface TemplateUpgradeFinding {
  kind: TemplateUpgradeFindingKind;
  severity: TemplateUpgradeFindingSeverity;
  serviceId: string;
  message: string;
  current?: {
    sourceRepo?: string;
    releaseTag?: string;
    version?: string;
    platforms?: string[];
  };
  target?: {
    sourceRepo?: string;
    releaseTag?: string;
    version?: string;
    platforms?: string[];
  };
  hint: string;
}

export interface TemplateUpgradeProviderSummary {
  serviceId: string;
  currentReleaseTag: string | null;
  targetReleaseTag: string | null;
  status: "current" | "missing" | "stale" | "drifted" | "incompatible";
}

export interface TemplateUpgradeCompatibilityReport {
  ok: boolean;
  status: "compatible" | "upgrade-advised" | "blocked";
  currentCoreRoot: string;
  targetServicesRoot: string;
  checkedProviders: number;
  targetServices: number;
  providers: TemplateUpgradeProviderSummary[];
  findings: TemplateUpgradeFinding[];
  summary: {
    errors: number;
    warnings: number;
    info: number;
    missingOptionalProviders: number;
    stalePins: number;
    incompatibleProviders: number;
  };
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set([...values].filter((value) => value.trim().length > 0))].sort((left, right) =>
    left.localeCompare(right),
  );
}

function releaseTag(manifest: ServiceManifest): string | undefined {
  return manifest.artifact?.source.tag?.trim() || manifest.artifact?.source.channel?.trim() || undefined;
}

function sourceRepo(manifest: ServiceManifest): string | undefined {
  return manifest.artifact?.source.repo?.trim() || undefined;
}

function platforms(manifest: ServiceManifest): string[] {
  return uniqueSorted(Object.keys(manifest.artifact?.platforms ?? {}));
}

function collectSetupProviders(manifest: ServiceManifest): string[] {
  return Object.values(manifest.setup?.steps ?? {}).flatMap((step) => (step.execservice ? [step.execservice] : []));
}

function collectProviderReferences(services: DiscoveredService[]): Set<string> {
  const refs = new Set<string>();
  for (const service of services) {
    for (const providerId of [service.manifest.execservice, ...collectSetupProviders(service.manifest)]) {
      if (providerId) {
        refs.add(providerId);
      }
    }
  }
  return refs;
}

function describeCurrent(manifest: ServiceManifest): TemplateUpgradeFinding["current"] {
  return {
    sourceRepo: sourceRepo(manifest),
    releaseTag: releaseTag(manifest),
    version: manifest.version,
    platforms: platforms(manifest),
  };
}

function describeTarget(manifest: ServiceManifest): TemplateUpgradeFinding["target"] {
  return {
    sourceRepo: sourceRepo(manifest),
    releaseTag: releaseTag(manifest),
    version: manifest.version,
    platforms: platforms(manifest),
  };
}

function makeFinding(
  finding: Omit<TemplateUpgradeFinding, "message"> & { message?: string },
): TemplateUpgradeFinding {
  return {
    ...finding,
    message: finding.message ?? finding.hint,
  };
}

function severityRank(severity: TemplateUpgradeFindingSeverity): number {
  if (severity === "error") return 3;
  if (severity === "warning") return 2;
  return 1;
}

function providerStatus(
  serviceId: string,
  findings: TemplateUpgradeFinding[],
): TemplateUpgradeProviderSummary["status"] {
  const providerFindings = findings.filter((finding) => finding.serviceId === serviceId);
  if (providerFindings.some((finding) => finding.kind === "missing-optional-provider" || finding.kind === "missing-required-provider")) {
    return "missing";
  }
  if (providerFindings.some((finding) => finding.severity === "error")) {
    return "incompatible";
  }
  if (providerFindings.some((finding) => finding.kind === "provider-release-stale")) {
    return "stale";
  }
  if (providerFindings.length > 0) {
    return "drifted";
  }
  return "current";
}

function compareProviderPins(
  current: DiscoveredService,
  target: DiscoveredService,
): TemplateUpgradeFinding[] {
  const findings: TemplateUpgradeFinding[] = [];
  const serviceId = current.manifest.id;
  const currentDescription = describeCurrent(current.manifest);
  const targetDescription = describeTarget(target.manifest);
  const currentRepo = sourceRepo(current.manifest);
  const targetRepo = sourceRepo(target.manifest);
  const currentTag = releaseTag(current.manifest);
  const targetTag = releaseTag(target.manifest);

  if (target.manifest.role !== "provider") {
    findings.push(makeFinding({
      kind: "provider-role-mismatch",
      severity: "error",
      serviceId,
      current: currentDescription,
      target: targetDescription,
      hint: `Keep ${serviceId} as a provider-role manifest when adopting current core provider expectations.`,
    }));
  }

  if (current.manifest.artifact && !target.manifest.artifact) {
    findings.push(makeFinding({
      kind: "provider-artifact-missing",
      severity: "error",
      serviceId,
      current: currentDescription,
      target: targetDescription,
      hint: `Copy the current ${serviceId} release artifact block before relying on this inventory for upgrades.`,
    }));
  }

  if (currentRepo && targetRepo && currentRepo !== targetRepo) {
    findings.push(makeFinding({
      kind: "provider-source-mismatch",
      severity: "error",
      serviceId,
      current: currentDescription,
      target: targetDescription,
      hint: `Review ${serviceId}; the target manifest points at ${targetRepo} instead of ${currentRepo}.`,
    }));
  }

  if (currentTag && targetTag && currentTag !== targetTag) {
    const comparison = compareTimestampedReleaseTags(targetTag, currentTag);
    findings.push(makeFinding({
      kind: comparison === 1 ? "provider-release-stale" : "provider-release-drift",
      severity: "warning",
      serviceId,
      current: currentDescription,
      target: targetDescription,
      hint: comparison === 1
        ? `Update ${serviceId} from ${targetTag} to the current core pin ${currentTag}.`
        : `Review ${serviceId}; the target pin ${targetTag} differs from the current core pin ${currentTag}.`,
    }));
  }

  if (current.manifest.version && target.manifest.version && current.manifest.version !== target.manifest.version) {
    findings.push(makeFinding({
      kind: "provider-version-drift",
      severity: "warning",
      serviceId,
      current: currentDescription,
      target: targetDescription,
      hint: `Review ${serviceId} runtime version drift: target ${target.manifest.version}, current ${current.manifest.version}.`,
    }));
  }

  const targetPlatforms = new Set(platforms(target.manifest));
  const missingPlatforms = platforms(current.manifest).filter((platform) => !targetPlatforms.has(platform));
  if (missingPlatforms.length > 0) {
    findings.push(makeFinding({
      kind: "provider-platform-gap",
      severity: "warning",
      serviceId,
      current: currentDescription,
      target: targetDescription,
      hint: `Add ${serviceId} platform entries missing from the target inventory: ${missingPlatforms.join(", ")}.`,
    }));
  }

  return findings;
}

export function buildTemplateUpgradeCompatibilityReport(options: {
  currentCoreRoot: string;
  targetServicesRoot: string;
  currentServices: DiscoveredService[];
  targetServices: DiscoveredService[];
}): TemplateUpgradeCompatibilityReport {
  const currentProviders = options.currentServices
    .filter((service) => service.manifest.role === "provider")
    .sort((left, right) => left.manifest.id.localeCompare(right.manifest.id));
  const targetById = new Map(options.targetServices.map((service) => [service.manifest.id, service]));
  const expectedProviderIds = new Set(currentProviders.map((service) => service.manifest.id));
  const targetProviderRefs = collectProviderReferences(options.targetServices);
  const findings: TemplateUpgradeFinding[] = [];

  for (const provider of currentProviders) {
    const target = targetById.get(provider.manifest.id);
    if (!target) {
      const required = targetProviderRefs.has(provider.manifest.id);
      findings.push(makeFinding({
        kind: required ? "missing-required-provider" : "missing-optional-provider",
        severity: required ? "error" : "warning",
        serviceId: provider.manifest.id,
        current: describeCurrent(provider.manifest),
        hint: required
          ? `Add ${provider.manifest.id}; at least one target service references it as an execution provider.`
          : `Consider adding current optional provider ${provider.manifest.id} so the inventory can adopt newer Service Lasso provider capabilities.`,
      }));
      continue;
    }

    findings.push(...compareProviderPins(provider, target));
  }

  for (const providerId of targetProviderRefs) {
    if (!targetById.has(providerId) && !expectedProviderIds.has(providerId)) {
      findings.push(makeFinding({
        kind: "unknown-provider-reference",
        severity: "warning",
        serviceId: providerId,
        hint: `Target inventory references provider ${providerId}, but no matching provider manifest was discovered in the target or current core inventory.`,
      }));
    }
  }

  findings.sort((left, right) => {
    const severity = severityRank(right.severity) - severityRank(left.severity);
    if (severity !== 0) return severity;
    const service = left.serviceId.localeCompare(right.serviceId);
    if (service !== 0) return service;
    return left.kind.localeCompare(right.kind);
  });

  const providers = currentProviders.map((provider) => {
    const target = targetById.get(provider.manifest.id);
    return {
      serviceId: provider.manifest.id,
      currentReleaseTag: releaseTag(provider.manifest) ?? null,
      targetReleaseTag: target ? releaseTag(target.manifest) ?? null : null,
      status: providerStatus(provider.manifest.id, findings),
    };
  });

  const errors = findings.filter((finding) => finding.severity === "error").length;
  const warnings = findings.filter((finding) => finding.severity === "warning").length;
  const info = findings.filter((finding) => finding.severity === "info").length;
  const status = errors > 0 ? "blocked" : warnings > 0 ? "upgrade-advised" : "compatible";

  return {
    ok: errors === 0,
    status,
    currentCoreRoot: path.resolve(options.currentCoreRoot),
    targetServicesRoot: path.resolve(options.targetServicesRoot),
    checkedProviders: currentProviders.length,
    targetServices: options.targetServices.length,
    providers,
    findings,
    summary: {
      errors,
      warnings,
      info,
      missingOptionalProviders: findings.filter((finding) => finding.kind === "missing-optional-provider").length,
      stalePins: findings.filter((finding) => finding.kind === "provider-release-stale").length,
      incompatibleProviders: findings.filter((finding) => finding.severity === "error").length,
    },
  };
}
