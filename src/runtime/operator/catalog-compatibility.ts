import type { ServiceCompatibilityReport, ServiceCompatibilityRequirementStatus } from "../../contracts/api.js";
import type { DiscoveredService, ServiceManifest } from "../../contracts/service.js";
import type { ServiceRegistry } from "../manager/ServiceRegistry.js";

export interface ServiceCompatibilityOptions {
  hostPlatform?: NodeJS.Platform | string;
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

export function buildServiceCompatibilityReport(
  service: DiscoveredService,
  registry: ServiceRegistry,
  options: ServiceCompatibilityOptions = {},
): ServiceCompatibilityReport {
  const hostPlatform = options.hostPlatform ?? process.platform;
  const supportedPlatforms = collectSupportedPlatforms(service.manifest);
  const requiredProviders = collectRequiredProviders(service.manifest);
  const requiredPorts = collectRequiredPorts(service.manifest);
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
  };
}
