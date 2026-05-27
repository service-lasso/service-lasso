import type {
  ServiceCompatibilityReport,
  ServiceCompatibilityRequirementStatus,
  ServiceCompatibilityWarning,
} from "../../contracts/api.js";
import type { DiscoveredService, ServiceManifest } from "../../contracts/service.js";
import type { ServiceRegistry } from "../manager/ServiceRegistry.js";
import { compareTimestampedReleaseTags } from "../updates/check.js";
import type { ServiceUpdateState } from "../updates/state.js";

export interface ServiceCompatibilityOptions {
  hostPlatform?: NodeJS.Platform | string;
  updateState?: ServiceUpdateState | null;
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set([...values].filter((value) => value.trim().length > 0))].sort((left, right) =>
    left.localeCompare(right),
  );
}

function collectSetupProviders(manifest: ServiceManifest): string[] {
  return Object.values(manifest.setup?.steps ?? {}).flatMap((step) => (step.execservice ? [step.execservice] : []));
}

function collectRequiredProviders(manifest: ServiceManifest): string[] {
  return uniqueSorted([...(manifest.execservice ? [manifest.execservice] : []), ...collectSetupProviders(manifest)]);
}

function collectSupportedPlatforms(manifest: ServiceManifest): string[] {
  return uniqueSorted(Object.keys(manifest.artifact?.platforms ?? {}));
}

function collectRequiredPorts(manifest: ServiceManifest): ServiceCompatibilityReport["requiredPorts"] {
  return Object.entries(manifest.ports ?? {})
    .map(([name, port]) => ({ name, port }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function platformIsSupported(supportedPlatforms: string[], hostPlatform: string): boolean {
  return supportedPlatforms.length === 0 || supportedPlatforms.includes(hostPlatform) || supportedPlatforms.includes("default");
}

function buildReleaseWarnings(
  manifest: ServiceManifest,
  updateState: ServiceUpdateState | null | undefined,
): ServiceCompatibilityWarning[] {
  const source = manifest.artifact?.source;
  const lastCheck = updateState?.lastCheck;
  if (!source?.repo || !source.tag || !lastCheck) {
    return [];
  }

  const sourceRepo = lastCheck.sourceRepo ?? source.repo;
  const manifestTag = lastCheck.manifestTag ?? source.tag;
  const latestTag = lastCheck.latestTag;

  if (lastCheck.status === "check_failed" || lastCheck.status === "unavailable") {
    return [{
      kind: "release-metadata-unavailable",
      severity: "warning",
      id: "release-metadata-unavailable",
      detail: `Latest release metadata for "${sourceRepo}" is unavailable: ${lastCheck.reason}`,
      sourceRepo,
      manifestTag,
      latestTag,
    }];
  }

  if (!latestTag || manifestTag === latestTag) {
    return [];
  }

  const timestampComparison = compareTimestampedReleaseTags(manifestTag, latestTag);
  if (timestampComparison === 1 || (lastCheck.status === "update_available" && timestampComparison !== -1)) {
    return [{
      kind: "release-stale",
      severity: "warning",
      id: "release-stale",
      detail: `Manifest release tag "${manifestTag}" is older than tracked release "${latestTag}".`,
      sourceRepo,
      manifestTag,
      latestTag,
    }];
  }

  return [];
}

export function buildServiceCompatibilityReport(
  service: DiscoveredService,
  registry: ServiceRegistry,
  options: ServiceCompatibilityOptions = {},
): ServiceCompatibilityReport {
  const hostPlatform = options.hostPlatform ?? process.platform;
  const supportedPlatforms = collectSupportedPlatforms(service.manifest);
  const requiredProviders = collectRequiredProviders(service.manifest);
  const requiredPorts = collectRequiredPorts(service.manifest);
  const warnings = buildReleaseWarnings(service.manifest, options.updateState);
  const requirements: ServiceCompatibilityRequirementStatus[] = [
    ...(service.manifest.depend_on ?? []).map((dependencyId) => ({
      kind: "dependency" as const,
      id: dependencyId,
      status: registry.getById(dependencyId) ? ("satisfied" as const) : ("missing" as const),
    })),
    ...requiredProviders.map((providerId) => ({
      kind: "provider" as const,
      id: providerId,
      status: registry.getById(providerId) ? ("satisfied" as const) : ("missing" as const),
    })),
    ...requiredPorts.map((port) => ({
      kind: "port" as const,
      id: port.name,
      status: "declared" as const,
      detail: String(port.port),
    })),
  ];
  const blockers = [
    ...(!platformIsSupported(supportedPlatforms, hostPlatform)
      ? [`Host platform "${hostPlatform}" is not declared in artifact platforms: ${supportedPlatforms.join(", ")}.`]
      : []),
    ...requirements
      .filter((requirement) => requirement.status === "missing")
      .map((requirement) => `Required ${requirement.kind} "${requirement.id}" is not discovered.`),
  ];

  return {
    hostPlatform,
    status: blockers.some((blocker) => blocker.startsWith("Host platform"))
      ? "unsupported"
      : blockers.length > 0
        ? "missing-requirements"
        : "compatible",
    supportedPlatforms,
    requiredProviders,
    requiredPorts,
    requirements,
    blockers,
    warnings,
  };
}
