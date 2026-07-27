import path from "node:path";
import type { DiscoveredService, ServiceFilesRootDeclaration } from "../../contracts/service.js";

export interface ServiceWorkspaceRegistryEntry {
  id: string;
  source: "service-lasso-workspaces";
  serviceId: string;
  serviceName: string;
  rootId: string;
  label: string;
  mode: ServiceFilesRootDeclaration["mode"];
  relativePath: string;
  resolvedPath: string;
  hidden: boolean;
  protected: boolean;
  access: {
    read: true;
    write: boolean;
  };
  safety: {
    scope: "service-root";
    withinServiceRoot: true;
    pathPolicy: "service-root-relative-only";
    serviceRoot: string;
    manifestPath: string;
  };
}

export interface ServiceWorkspaceRegistry {
  source: "service-lasso-workspaces";
  registryVersion: 1;
  generatedAt: string;
  workspaces: ServiceWorkspaceRegistryEntry[];
}

function toPortablePath(value: string): string {
  return value.split(path.sep).join("/");
}

function toRegistryRoot(service: DiscoveredService, root: ServiceFilesRootDeclaration): ServiceWorkspaceRegistryEntry {
  const resolvedServiceRoot = path.resolve(service.serviceRoot);
  const resolvedPath = path.resolve(resolvedServiceRoot, root.path);
  const relativePath = toPortablePath(path.relative(resolvedServiceRoot, resolvedPath)) || ".";

  return {
    id: `${service.manifest.id}:${root.id}`,
    source: "service-lasso-workspaces",
    serviceId: service.manifest.id,
    serviceName: service.manifest.name,
    rootId: root.id,
    label: root.label,
    mode: root.mode,
    relativePath,
    resolvedPath,
    hidden: root.hidden === true,
    protected: root.protected === true,
    access: {
      read: true,
      write: root.mode === "read-write" && root.protected !== true,
    },
    safety: {
      scope: "service-root",
      withinServiceRoot: true,
      pathPolicy: "service-root-relative-only",
      serviceRoot: resolvedServiceRoot,
      manifestPath: service.manifestPath,
    },
  };
}

export function buildServiceWorkspaceRegistry(services: DiscoveredService[]): ServiceWorkspaceRegistry {
  return {
    source: "service-lasso-workspaces",
    registryVersion: 1,
    generatedAt: new Date().toISOString(),
    workspaces: services
      .filter((service) => service.manifest.enabled !== false && service.manifest.files?.enabled === true)
      .flatMap((service) => (service.manifest.files?.roots ?? []).map((root) => toRegistryRoot(service, root)))
      .sort((left, right) => left.serviceId.localeCompare(right.serviceId) || left.rootId.localeCompare(right.rootId)),
  };
}
