import type { ServiceLifecycleState } from "./types.js";

const lifecycleState = new Map<string, ServiceLifecycleState>();

function createInitialState(): ServiceLifecycleState {
  return {
    installed: false,
    configured: false,
    running: false,
    lastAction: null,
    actionHistory: [],
    installArtifacts: {
      files: [],
      updatedAt: null,
    },
    configArtifacts: {
      files: [],
      updatedAt: null,
    },
    runtime: {
      pid: null,
      startedAt: null,
      finishedAt: null,
      exitCode: null,
      command: null,
      provider: null,
      providerServiceId: null,
      lastTermination: null,
      ports: {},
    },
  };
}

export function getLifecycleState(serviceId: string): ServiceLifecycleState {
  const current = lifecycleState.get(serviceId) ?? createInitialState();

  if (!lifecycleState.has(serviceId)) {
    lifecycleState.set(serviceId, current);
  }

  return {
    installed: current.installed,
    configured: current.configured,
    running: current.running,
    lastAction: current.lastAction,
    actionHistory: [...current.actionHistory],
    installArtifacts: {
      files: [...current.installArtifacts.files],
      updatedAt: current.installArtifacts.updatedAt,
    },
    configArtifacts: {
      files: [...current.configArtifacts.files],
      updatedAt: current.configArtifacts.updatedAt,
    },
    runtime: {
      pid: current.runtime.pid,
      startedAt: current.runtime.startedAt,
      finishedAt: current.runtime.finishedAt,
      exitCode: current.runtime.exitCode,
      command: current.runtime.command,
      provider: current.runtime.provider,
      providerServiceId: current.runtime.providerServiceId,
      lastTermination: current.runtime.lastTermination,
      ports: { ...current.runtime.ports },
    },
  };
}

export function setLifecycleState(serviceId: string, nextState: ServiceLifecycleState): ServiceLifecycleState {
  const cloned = {
    installed: nextState.installed,
    configured: nextState.configured,
    running: nextState.running,
    lastAction: nextState.lastAction,
    actionHistory: [...nextState.actionHistory],
    installArtifacts: {
      files: [...nextState.installArtifacts.files],
      updatedAt: nextState.installArtifacts.updatedAt,
    },
    configArtifacts: {
      files: [...nextState.configArtifacts.files],
      updatedAt: nextState.configArtifacts.updatedAt,
    },
    runtime: {
      pid: nextState.runtime.pid,
      startedAt: nextState.runtime.startedAt,
      finishedAt: nextState.runtime.finishedAt,
      exitCode: nextState.runtime.exitCode,
      command: nextState.runtime.command,
      provider: nextState.runtime.provider,
      providerServiceId: nextState.runtime.providerServiceId,
      lastTermination: nextState.runtime.lastTermination,
      ports: { ...nextState.runtime.ports },
    },
  };

  lifecycleState.set(serviceId, cloned);
  return getLifecycleState(serviceId);
}

export function resetLifecycleState(): void {
  lifecycleState.clear();
}
