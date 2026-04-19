import { getLifecycleState, setLifecycleState } from "./store.js";
import type { LifecycleAction, LifecycleActionResult, ServiceLifecycleState } from "./types.js";

function applyState(
  serviceId: string,
  action: LifecycleAction,
  recipe: (current: ServiceLifecycleState) => { nextState: ServiceLifecycleState; message: string },
): LifecycleActionResult {
  const current = getLifecycleState(serviceId);
  const { nextState, message } = recipe(current);
  const state = setLifecycleState(serviceId, {
    ...nextState,
    lastAction: action,
    actionHistory: [...nextState.actionHistory, action],
  });

  return {
    ok: true,
    action,
    serviceId,
    state,
    message,
  };
}

export function installService(serviceId: string): LifecycleActionResult {
  return applyState(serviceId, "install", (current) => ({
    nextState: {
      ...current,
      installed: true,
      running: false,
    },
    message: "Install completed.",
  }));
}

export function configService(serviceId: string): LifecycleActionResult {
  const current = getLifecycleState(serviceId);
  if (!current.installed) {
    throw new Error(`Cannot config service \"${serviceId}\" before install.`);
  }

  return applyState(serviceId, "config", (state) => ({
    nextState: {
      ...state,
      configured: true,
    },
    message: "Config completed.",
  }));
}

export function startService(serviceId: string): LifecycleActionResult {
  const current = getLifecycleState(serviceId);
  if (!current.installed) {
    throw new Error(`Cannot start service \"${serviceId}\" before install.`);
  }
  if (!current.configured) {
    throw new Error(`Cannot start service \"${serviceId}\" before config.`);
  }

  return applyState(serviceId, "start", (state) => ({
    nextState: {
      ...state,
      running: true,
    },
    message: "Start completed.",
  }));
}

export function stopService(serviceId: string): LifecycleActionResult {
  const current = getLifecycleState(serviceId);
  if (!current.running) {
    throw new Error(`Cannot stop service \"${serviceId}\" because it is not running.`);
  }

  return applyState(serviceId, "stop", (state) => ({
    nextState: {
      ...state,
      running: false,
    },
    message: "Stop completed.",
  }));
}

export function restartService(serviceId: string): LifecycleActionResult {
  const current = getLifecycleState(serviceId);
  if (!current.installed) {
    throw new Error(`Cannot restart service \"${serviceId}\" before install.`);
  }
  if (!current.configured) {
    throw new Error(`Cannot restart service \"${serviceId}\" before config.`);
  }

  return applyState(serviceId, "restart", (state) => ({
    nextState: {
      ...state,
      running: true,
    },
    message: "Restart completed.",
  }));
}
