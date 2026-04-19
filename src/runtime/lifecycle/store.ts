import type { ServiceLifecycleState } from "./types.js";

const lifecycleState = new Map<string, ServiceLifecycleState>();

function createInitialState(): ServiceLifecycleState {
  return {
    installed: false,
    configured: false,
    running: false,
    lastAction: null,
    actionHistory: [],
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
  };
}

export function setLifecycleState(serviceId: string, nextState: ServiceLifecycleState): ServiceLifecycleState {
  const cloned = {
    installed: nextState.installed,
    configured: nextState.configured,
    running: nextState.running,
    lastAction: nextState.lastAction,
    actionHistory: [...nextState.actionHistory],
  };

  lifecycleState.set(serviceId, cloned);
  return getLifecycleState(serviceId);
}

export function resetLifecycleState(): void {
  lifecycleState.clear();
}
