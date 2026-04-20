import type { DiscoveredService } from "../../contracts/service.js";
import { LifecycleStateError } from "../../server/errors.js";
import { startManagedProcess, stopManagedProcess } from "../execution/supervisor.js";
import { writeServiceState } from "../state/writeState.js";
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

function updateRuntimeState(
  serviceId: string,
  recipe: (current: ServiceLifecycleState) => ServiceLifecycleState,
): ServiceLifecycleState {
  const current = getLifecycleState(serviceId);
  return setLifecycleState(serviceId, recipe(current));
}

async function persistProcessExit(
  service: DiscoveredService,
  exitCode: number | null,
): Promise<void> {
  const state = updateRuntimeState(service.manifest.id, (current) => ({
    ...current,
    running: false,
    runtime: {
      ...current.runtime,
      pid: null,
      exitCode: exitCode ?? current.runtime.exitCode,
    },
  }));

  await writeServiceState(service, state);
}

export function installService(serviceId: string): LifecycleActionResult {
  return applyState(serviceId, "install", (current) => ({
    nextState: {
      ...current,
      installed: true,
      running: false,
      runtime: {
        ...current.runtime,
        pid: null,
      },
    },
    message: "Install completed.",
  }));
}

export function configService(serviceId: string): LifecycleActionResult {
  const current = getLifecycleState(serviceId);
  if (!current.installed) {
    throw new LifecycleStateError(`Cannot config service "${serviceId}" before install.`);
  }

  return applyState(serviceId, "config", (state) => ({
    nextState: {
      ...state,
      configured: true,
    },
    message: "Config completed.",
  }));
}

export async function startService(service: DiscoveredService): Promise<LifecycleActionResult> {
  const serviceId = service.manifest.id;
  const current = getLifecycleState(serviceId);
  if (!current.installed) {
    throw new LifecycleStateError(`Cannot start service "${serviceId}" before install.`);
  }
  if (!current.configured) {
    throw new LifecycleStateError(`Cannot start service "${serviceId}" before config.`);
  }
  if (current.running) {
    throw new LifecycleStateError(`Cannot start service "${serviceId}" because it is already running.`);
  }
  if (!service.manifest.executable) {
    throw new LifecycleStateError(`Cannot start service "${serviceId}" because no executable is configured.`);
  }

  const handle = await startManagedProcess({
    service,
    onExit: async ({ exitCode, wasStopping }) => {
      if (wasStopping) {
        return;
      }
      await persistProcessExit(service, exitCode);
    },
  });

  return applyState(serviceId, "start", (state) => ({
    nextState: {
      ...state,
      running: true,
      runtime: {
        pid: handle.pid,
        startedAt: handle.startedAt,
        exitCode: null,
        command: handle.command,
      },
    },
    message: "Start completed.",
  }));
}

export async function stopService(service: DiscoveredService): Promise<LifecycleActionResult> {
  const serviceId = service.manifest.id;
  const current = getLifecycleState(serviceId);
  if (!current.running) {
    throw new LifecycleStateError(`Cannot stop service "${serviceId}" because it is not running.`);
  }

  const stopped = await stopManagedProcess(serviceId);

  return applyState(serviceId, "stop", (state) => ({
    nextState: {
      ...state,
      running: false,
      runtime: {
        ...state.runtime,
        pid: null,
        exitCode: stopped?.exitCode ?? state.runtime.exitCode ?? 0,
      },
    },
    message: "Stop completed.",
  }));
}

export async function restartService(service: DiscoveredService): Promise<LifecycleActionResult> {
  const serviceId = service.manifest.id;
  const current = getLifecycleState(serviceId);
  if (!current.installed) {
    throw new LifecycleStateError(`Cannot restart service "${serviceId}" before install.`);
  }
  if (!current.configured) {
    throw new LifecycleStateError(`Cannot restart service "${serviceId}" before config.`);
  }
  if (!service.manifest.executable) {
    throw new LifecycleStateError(`Cannot restart service "${serviceId}" because no executable is configured.`);
  }

  if (current.running) {
    await stopManagedProcess(serviceId);
  }

  const handle = await startManagedProcess({
    service,
    onExit: async ({ exitCode, wasStopping }) => {
      if (wasStopping) {
        return;
      }
      await persistProcessExit(service, exitCode);
    },
  });

  return applyState(serviceId, "restart", (state) => ({
    nextState: {
      ...state,
      running: true,
      runtime: {
        pid: handle.pid,
        startedAt: handle.startedAt,
        exitCode: null,
        command: handle.command,
      },
    },
    message: "Restart completed.",
  }));
}
