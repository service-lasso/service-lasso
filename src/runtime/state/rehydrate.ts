import type { DiscoveredService } from "../../contracts/service.js";
import { hasManagedProcess } from "../execution/supervisor.js";
import { getLifecycleState, setLifecycleState } from "../lifecycle/store.js";
import type { LifecycleAction, ServiceLifecycleState } from "../lifecycle/types.js";
import type { ProviderKind } from "../providers/types.js";
import { readStoredState } from "./readState.js";
import { resolveServiceRootPath } from "./paths.js";

interface StoredInstallState {
  installed?: boolean;
  files?: string[];
  updatedAt?: string | null;
  artifact?: {
    sourceType?: "github-release" | null;
    repo?: string | null;
    channel?: string | null;
    tag?: string | null;
    assetName?: string | null;
    assetUrl?: string | null;
    archiveType?: "zip" | "tar.gz" | "tgz" | null;
    archivePath?: string | null;
    extractedPath?: string | null;
    command?: string | null;
    args?: string[];
  };
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
  finishedAt?: string | null;
  exitCode?: number | null;
  command?: string | null;
  provider?: ProviderKind | null;
  providerServiceId?: string | null;
  lastTermination?: "stopped" | "exited" | "crashed" | null;
  ports?: Record<string, number>;
  logs?: {
    logPath?: string | null;
    stdoutPath?: string | null;
    stderrPath?: string | null;
  };
  metrics?: {
    launchCount?: number;
    stopCount?: number;
    exitCount?: number;
    crashCount?: number;
    restartCount?: number;
    totalRunDurationMs?: number;
    lastRunDurationMs?: number | null;
  };
  lastAction?: LifecycleAction | null;
  actionHistory?: LifecycleAction[];
}

function isLifecycleAction(value: unknown): value is LifecycleAction {
  return value === "install" || value === "config" || value === "start" || value === "stop" || value === "restart";
}

function isProviderKind(value: unknown): value is ProviderKind {
  return value === "direct" || value === "node" || value === "python" || value === "java";
}

function parseLifecycleState(service: DiscoveredService, snapshot: {
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
      artifact: {
        sourceType: install?.artifact?.sourceType === "github-release" ? install.artifact.sourceType : null,
        repo: typeof install?.artifact?.repo === "string" ? install.artifact.repo : null,
        channel: typeof install?.artifact?.channel === "string" ? install.artifact.channel : null,
        tag: typeof install?.artifact?.tag === "string" ? install.artifact.tag : null,
        assetName: typeof install?.artifact?.assetName === "string" ? install.artifact.assetName : null,
        assetUrl: typeof install?.artifact?.assetUrl === "string" ? install.artifact.assetUrl : null,
        archiveType:
          install?.artifact?.archiveType === "zip" ||
          install?.artifact?.archiveType === "tar.gz" ||
          install?.artifact?.archiveType === "tgz"
            ? install.artifact.archiveType
            : null,
        archivePath:
          typeof install?.artifact?.archivePath === "string"
            ? resolveServiceRootPath(service.serviceRoot, install.artifact.archivePath)
            : null,
        extractedPath:
          typeof install?.artifact?.extractedPath === "string"
            ? resolveServiceRootPath(service.serviceRoot, install.artifact.extractedPath)
            : null,
        command: typeof install?.artifact?.command === "string" ? install.artifact.command : null,
        args: Array.isArray(install?.artifact?.args)
          ? install.artifact.args.filter((entry): entry is string => typeof entry === "string")
          : [],
      },
    },
    configArtifacts: {
      files: Array.isArray(config?.files) ? config.files.filter((file): file is string => typeof file === "string") : [],
      updatedAt: typeof config?.updatedAt === "string" ? config.updatedAt : null,
    },
    runtime: {
      pid: null,
      startedAt: typeof runtime?.startedAt === "string" ? runtime.startedAt : null,
      finishedAt: typeof runtime?.finishedAt === "string" ? runtime.finishedAt : null,
      exitCode: typeof runtime?.exitCode === "number" ? runtime.exitCode : null,
      command: typeof runtime?.command === "string" ? runtime.command : null,
      provider: isProviderKind(runtime?.provider) ? runtime.provider : null,
      providerServiceId: typeof runtime?.providerServiceId === "string" ? runtime.providerServiceId : null,
      lastTermination:
        runtime?.lastTermination === "stopped" || runtime?.lastTermination === "exited" || runtime?.lastTermination === "crashed"
          ? runtime.lastTermination
          : null,
      ports:
        runtime?.ports && typeof runtime.ports === "object" && !Array.isArray(runtime.ports)
          ? Object.fromEntries(
              Object.entries(runtime.ports).filter(
                ([, value]) => typeof value === "number" && Number.isInteger(value) && value > 0,
              ),
            )
          : {},
      logs: {
        logPath: typeof runtime?.logs?.logPath === "string" ? runtime.logs.logPath : null,
        stdoutPath: typeof runtime?.logs?.stdoutPath === "string" ? runtime.logs.stdoutPath : null,
        stderrPath: typeof runtime?.logs?.stderrPath === "string" ? runtime.logs.stderrPath : null,
      },
      metrics: {
        launchCount: typeof runtime?.metrics?.launchCount === "number" ? runtime.metrics.launchCount : 0,
        stopCount: typeof runtime?.metrics?.stopCount === "number" ? runtime.metrics.stopCount : 0,
        exitCount: typeof runtime?.metrics?.exitCount === "number" ? runtime.metrics.exitCount : 0,
        crashCount: typeof runtime?.metrics?.crashCount === "number" ? runtime.metrics.crashCount : 0,
        restartCount: typeof runtime?.metrics?.restartCount === "number" ? runtime.metrics.restartCount : 0,
        totalRunDurationMs: typeof runtime?.metrics?.totalRunDurationMs === "number" ? runtime.metrics.totalRunDurationMs : 0,
        lastRunDurationMs:
          typeof runtime?.metrics?.lastRunDurationMs === "number" ? runtime.metrics.lastRunDurationMs : null,
      },
    },
  };
}

export async function rehydrateLifecycleState(service: DiscoveredService): Promise<ServiceLifecycleState | null> {
  const snapshot = await readStoredState(service.serviceRoot);
  const state = parseLifecycleState(service, snapshot);

  if (state) {
    const serviceId = service.manifest.id;
    const current = getLifecycleState(serviceId);
    const nextState =
      hasManagedProcess(serviceId) && current.running
        ? {
            ...state,
            running: true,
            lastAction: current.lastAction ?? state.lastAction,
            actionHistory: current.actionHistory.length > state.actionHistory.length ? current.actionHistory : state.actionHistory,
            runtime: current.runtime,
          }
        : state;

    setLifecycleState(serviceId, nextState);
  }

  return state;
}

export async function rehydrateDiscoveredServices(services: DiscoveredService[]): Promise<void> {
  await Promise.all(services.map((service) => rehydrateLifecycleState(service)));
}
