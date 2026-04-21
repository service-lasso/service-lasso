import type { DiscoveredService } from "../../contracts/service.js";
import { setLifecycleState } from "../lifecycle/store.js";
import type { LifecycleAction, ServiceLifecycleState } from "../lifecycle/types.js";
import { readStoredState } from "./readState.js";

interface StoredInstallState {
  installed?: boolean;
  files?: string[];
  updatedAt?: string | null;
}

interface StoredConfigState {
  configured?: boolean;
  files?: string[];
  updatedAt?: string | null;
}

interface StoredRuntimeState {
  running?: boolean;
  pid?: number | null;
  startedAt?: string | null;
  exitCode?: number | null;
  command?: string | null;
  ports?: Record<string, number>;
  lastAction?: LifecycleAction | null;
  actionHistory?: LifecycleAction[];
}

function isLifecycleAction(value: unknown): value is LifecycleAction {
  return value === "install" || value === "config" || value === "start" || value === "stop" || value === "restart";
}

function parseLifecycleState(snapshot: {
  install: unknown | null;
  config: unknown | null;
  runtime: unknown | null;
}): ServiceLifecycleState | null {
  const install = snapshot.install as StoredInstallState | null;
  const config = snapshot.config as StoredConfigState | null;
  const runtime = snapshot.runtime as StoredRuntimeState | null;

  const installed = install?.installed === true;
  const configured = config?.configured === true;
  const running = false;
  const actionHistory = Array.isArray(runtime?.actionHistory)
    ? runtime.actionHistory.filter((action): action is LifecycleAction => isLifecycleAction(action))
    : [];
  const lastAction = isLifecycleAction(runtime?.lastAction) ? runtime.lastAction : null;

  if (!installed && !configured && runtime?.running !== true && actionHistory.length === 0 && lastAction === null) {
    return null;
  }

  return {
    installed,
    configured,
    running,
    lastAction,
    actionHistory,
    installArtifacts: {
      files: Array.isArray(install?.files) ? install.files.filter((file): file is string => typeof file === "string") : [],
      updatedAt: typeof install?.updatedAt === "string" ? install.updatedAt : null,
    },
    configArtifacts: {
      files: Array.isArray(config?.files) ? config.files.filter((file): file is string => typeof file === "string") : [],
      updatedAt: typeof config?.updatedAt === "string" ? config.updatedAt : null,
    },
    runtime: {
      pid: null,
      startedAt: typeof runtime?.startedAt === "string" ? runtime.startedAt : null,
      exitCode: typeof runtime?.exitCode === "number" ? runtime.exitCode : null,
      command: typeof runtime?.command === "string" ? runtime.command : null,
      ports:
        runtime?.ports && typeof runtime.ports === "object" && !Array.isArray(runtime.ports)
          ? Object.fromEntries(
              Object.entries(runtime.ports).filter(
                ([, value]) => typeof value === "number" && Number.isInteger(value) && value > 0,
              ),
            )
          : {},
    },
  };
}

export async function rehydrateLifecycleState(service: DiscoveredService): Promise<ServiceLifecycleState | null> {
  const snapshot = await readStoredState(service.serviceRoot);
  const state = parseLifecycleState(snapshot);

  if (state) {
    setLifecycleState(service.manifest.id, state);
  }

  return state;
}

export async function rehydrateDiscoveredServices(services: DiscoveredService[]): Promise<void> {
  await Promise.all(services.map((service) => rehydrateLifecycleState(service)));
}
