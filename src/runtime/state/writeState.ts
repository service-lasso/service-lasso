import { mkdir, writeFile } from "node:fs/promises";
import type { DiscoveredService } from "../../contracts/service.js";
import type { ServiceLifecycleState } from "../lifecycle/types.js";
import { getServiceStatePaths, type ServiceStatePaths } from "./paths.js";

export interface PersistedServiceState {
  paths: ServiceStatePaths;
}

export async function writeServiceState(
  service: DiscoveredService,
  lifecycle: ServiceLifecycleState,
): Promise<PersistedServiceState> {
  const paths = getServiceStatePaths(service.serviceRoot);
  await mkdir(paths.stateRoot, { recursive: true });
  await mkdir(paths.backups, { recursive: true });

  await Promise.all([
    writeFile(
      paths.service,
      JSON.stringify(
        {
          id: service.manifest.id,
          name: service.manifest.name,
          description: service.manifest.description,
          enabled: service.manifest.enabled !== false,
          version: service.manifest.version ?? null,
        },
        null,
        2,
      ),
    ),
    writeFile(
      paths.install,
      JSON.stringify(
        {
          installed: lifecycle.installed,
          lastAction: lifecycle.lastAction,
          files: lifecycle.installArtifacts.files,
          updatedAt: lifecycle.installArtifacts.updatedAt,
        },
        null,
        2,
      ),
    ),
    writeFile(
      paths.config,
      JSON.stringify(
        {
          configured: lifecycle.configured,
          lastAction: lifecycle.lastAction,
          files: lifecycle.configArtifacts.files,
          updatedAt: lifecycle.configArtifacts.updatedAt,
        },
        null,
        2,
      ),
    ),
    writeFile(
      paths.runtime,
      JSON.stringify(
        {
          running: lifecycle.running,
          pid: lifecycle.runtime.pid,
          startedAt: lifecycle.runtime.startedAt,
          finishedAt: lifecycle.runtime.finishedAt,
          exitCode: lifecycle.runtime.exitCode,
          command: lifecycle.runtime.command,
          provider: lifecycle.runtime.provider,
          providerServiceId: lifecycle.runtime.providerServiceId,
          lastTermination: lifecycle.runtime.lastTermination,
          ports: lifecycle.runtime.ports,
          lastAction: lifecycle.lastAction,
          actionHistory: lifecycle.actionHistory,
        },
        null,
        2,
      ),
    ),
  ]);

  return { paths };
}
