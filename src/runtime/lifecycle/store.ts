import type { ServiceLifecycleState } from "./types.js";

const lifecycleState = new Map<string, ServiceLifecycleState>();

function createInitialState(): ServiceLifecycleState {
  return {
    installed: false,
    configured: false,
    running: false,
    lastAction: null,
    actionHistory: [],
    runtime: {
      pid: null,
      startedAt: null,
      exitCode: null,
      command: null,
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
    runtime: {
      pid: current.runtime.pid,
      startedAt: current.runtime.startedAt,
      exitCode: current.runtime.exitCode,
      command: current.runtime.command,
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
    runtime: {
      pid: nextState.runtime.pid,
      startedAt: nextState.runtime.startedAt,
      exitCode: nextState.runtime.exitCode,
      command: nextState.runtime.command,
    },
  };

  lifecycleState.set(serviceId, cloned);
  return getLifecycleState(serviceId);
}

export function resetLifecycleState(): void {
  lifecycleState.clear();
}
