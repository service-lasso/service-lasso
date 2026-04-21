import type { DiscoveredService } from "../../contracts/service.js";
import { LifecycleStateError } from "../../server/errors.js";
import { startManagedProcess, stopManagedProcess } from "../execution/supervisor.js";
import { waitForServiceReadiness } from "../health/waitForReadiness.js";
import { DependencyGraph } from "../manager/DependencyGraph.js";
import type { ServiceRegistry } from "../manager/ServiceRegistry.js";
import { collectRuntimeGlobalEnv } from "../operator/variables.js";
import { negotiateServicePorts } from "../ports/negotiate.js";
import { createDirectExecutionPlan } from "../providers/direct.js";
import { resolveProviderExecution } from "../providers/resolveProvider.js";
import { materializeConfigArtifacts, materializeInstallArtifacts } from "../setup/materialize.js";
import { writeServiceState } from "../state/writeState.js";
import { getLifecycleState, setLifecycleState } from "./store.js";
import type { LifecycleAction, LifecycleActionResult, ServiceLifecycleState } from "./types.js";

function calculateRunDurationMs(startedAt: string | null, finishedAt: string): number | null {
  if (!startedAt) {
    return null;
  }

  const startedMs = Date.parse(startedAt);
  const finishedMs = Date.parse(finishedAt);

  if (!Number.isFinite(startedMs) || !Number.isFinite(finishedMs)) {
    return null;
  }

  return Math.max(0, finishedMs - startedMs);
}

function applyRunCompletionMetrics(
  current: ServiceLifecycleState,
  finishedAt: string,
  termination: "stopped" | "exited" | "crashed",
): ServiceLifecycleState["runtime"]["metrics"] {
  const runDurationMs = calculateRunDurationMs(current.runtime.startedAt, finishedAt);

  return {
    ...current.runtime.metrics,
    stopCount: current.runtime.metrics.stopCount + (termination === "stopped" ? 1 : 0),
    exitCount: current.runtime.metrics.exitCount + (termination === "exited" ? 1 : 0),
    crashCount: current.runtime.metrics.crashCount + (termination === "crashed" ? 1 : 0),
    totalRunDurationMs: current.runtime.metrics.totalRunDurationMs + (runDurationMs ?? 0),
    lastRunDurationMs: runDurationMs,
  };
}

function applyProcessLaunchMetrics(
  current: ServiceLifecycleState,
  action: "start" | "restart",
  startedAt: string,
): ServiceLifecycleState["runtime"]["metrics"] {
  let totalRunDurationMs = current.runtime.metrics.totalRunDurationMs;
  let lastRunDurationMs = current.runtime.metrics.lastRunDurationMs;

  if (action === "restart" && current.running) {
    const previousRunDurationMs = calculateRunDurationMs(current.runtime.startedAt, startedAt);
    totalRunDurationMs += previousRunDurationMs ?? 0;
    lastRunDurationMs = previousRunDurationMs;
  }

  return {
    ...current.runtime.metrics,
    launchCount: current.runtime.metrics.launchCount + 1,
    restartCount: current.runtime.metrics.restartCount + (action === "restart" ? 1 : 0),
    totalRunDurationMs,
    lastRunDurationMs,
  };
}

function applyState(
  serviceId: string,
  action: LifecycleAction,
  recipe: (current: ServiceLifecycleState) => { nextState: ServiceLifecycleState; message: string },
  ok = true,
): LifecycleActionResult {
  const current = getLifecycleState(serviceId);
  const { nextState, message } = recipe(current);
  const state = setLifecycleState(serviceId, {
    ...nextState,
    lastAction: action,
    actionHistory: [...nextState.actionHistory, action],
  });

  return {
    ok,
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
  const finishedAt = new Date().toISOString();
  const termination = (exitCode ?? getLifecycleState(service.manifest.id).runtime.exitCode ?? 0) === 0 ? "exited" : "crashed";
  const state = updateRuntimeState(service.manifest.id, (current) => ({
    ...current,
    running: false,
    runtime: {
      ...current.runtime,
      pid: null,
      finishedAt,
      exitCode: exitCode ?? current.runtime.exitCode,
      lastTermination: termination,
      metrics: applyRunCompletionMetrics(current, finishedAt, termination),
    },
  }));

  await writeServiceState(service, state);
}

function resolveExecutionPlanForLifecycle(
  service: DiscoveredService,
  registry?: ServiceRegistry,
) {
  if (service.manifest.execservice) {
    if (!registry) {
      throw new LifecycleStateError(
        `Cannot start service "${service.manifest.id}" because provider resolution requires a registry context.`,
      );
    }

    return resolveProviderExecution(service, registry);
  }

  return createDirectExecutionPlan(service.manifest);
}

export async function installService(
  service: DiscoveredService,
  registry?: ServiceRegistry,
): Promise<LifecycleActionResult> {
  const serviceId = service.manifest.id;
  const sharedGlobalEnv = registry ? collectRuntimeGlobalEnv(registry.list()) : {};
  const artifacts = await materializeInstallArtifacts(service, sharedGlobalEnv);

  return applyState(serviceId, "install", (current) => ({
    nextState: {
      ...current,
      installed: true,
      running: false,
      installArtifacts: artifacts,
      runtime: {
        ...current.runtime,
        pid: null,
        finishedAt: null,
        lastTermination: null,
      },
    },
    message: "Install completed.",
  }));
}

export async function configService(
  service: DiscoveredService,
  registry?: ServiceRegistry,
): Promise<LifecycleActionResult> {
  const serviceId = service.manifest.id;
  const current = getLifecycleState(serviceId);
  if (!current.installed) {
    throw new LifecycleStateError(`Cannot config service "${serviceId}" before install.`);
  }

  const resolvedPorts = registry ? await negotiateServicePorts(service, registry.list()) : current.runtime.ports;
  const sharedGlobalEnv = registry ? collectRuntimeGlobalEnv(registry.list()) : {};
  const artifacts = await materializeConfigArtifacts(service, sharedGlobalEnv, resolvedPorts);

  return applyState(serviceId, "config", (state) => ({
    nextState: {
      ...state,
      configured: true,
      configArtifacts: artifacts,
      runtime: {
        ...state.runtime,
        ports: resolvedPorts,
      },
    },
    message: "Config completed.",
  }));
}

export async function startService(
  service: DiscoveredService,
  registry?: ServiceRegistry,
): Promise<LifecycleActionResult> {
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
  const executionPlan = resolveExecutionPlanForLifecycle(service, registry);
  if (executionPlan.provider === "direct" && !service.manifest.executable) {
    throw new LifecycleStateError(`Cannot start service "${serviceId}" because no executable is configured.`);
  }

  if (registry) {
    const dependencyGraph = new DependencyGraph(registry);
    const dependencyOrder = dependencyGraph.getStartupOrder(serviceId);

    for (const dependencyId of dependencyOrder) {
      const dependency = registry.getById(dependencyId);
      if (!dependency) {
        throw new LifecycleStateError(`Cannot start service "${serviceId}" because dependency "${dependencyId}" was not found.`);
      }

      const dependencyState = getLifecycleState(dependencyId);
      if (!dependencyState.installed) {
        throw new LifecycleStateError(
          `Cannot start service "${serviceId}" because dependency "${dependencyId}" is not installed.`,
        );
      }
      if (!dependencyState.configured) {
        throw new LifecycleStateError(
          `Cannot start service "${serviceId}" because dependency "${dependencyId}" is not configured.`,
        );
      }

      if (!dependencyState.running) {
        const dependencyResult = await startService(dependency, registry);
        await writeServiceState(dependency, dependencyResult.state);
      }
    }
  }

  const sharedGlobalEnv = registry ? collectRuntimeGlobalEnv(registry.list()) : {};
  const resolvedPorts = Object.keys(current.runtime.ports).length > 0
    ? current.runtime.ports
    : registry
      ? await negotiateServicePorts(service, registry.list())
      : {};
  const handle = await startManagedProcess({
    service,
    executionPlan,
    sharedGlobalEnv,
    resolvedPorts,
    onExit: async ({ exitCode, wasStopping }) => {
      if (wasStopping) {
        return;
      }
      await persistProcessExit(service, exitCode);
    },
  });

  updateRuntimeState(serviceId, (state) => ({
    ...state,
    running: true,
    runtime: {
      ...state.runtime,
      pid: handle.pid,
      startedAt: handle.startedAt,
      finishedAt: null,
      exitCode: null,
      command: handle.command,
      provider: executionPlan.provider,
      providerServiceId: executionPlan.providerServiceId,
      lastTermination: null,
      ports: resolvedPorts,
      logs: {
        logPath: handle.logs.logPath,
        stdoutPath: handle.logs.stdoutPath,
        stderrPath: handle.logs.stderrPath,
      },
      metrics: applyProcessLaunchMetrics(state, "start", handle.startedAt),
    },
  }));

  const readiness = await waitForServiceReadiness(service, sharedGlobalEnv);
  if (!readiness.ready) {
    const stopped = await stopManagedProcess(serviceId);
    return applyState(
      serviceId,
      "start",
      (state) => ({
        nextState: {
          ...state,
          running: false,
          runtime: {
            ...state.runtime,
            pid: null,
            finishedAt: new Date().toISOString(),
            exitCode: stopped?.exitCode ?? state.runtime.exitCode ?? 0,
            lastTermination: "stopped",
            metrics: applyRunCompletionMetrics(state, new Date().toISOString(), "stopped"),
          },
        },
        message: readiness.message,
      }),
      false,
    );
  }

  return applyState(serviceId, "start", (state) => ({
    nextState: {
      ...state,
      running: true,
      runtime: {
        ...state.runtime,
        pid: handle.pid,
        startedAt: handle.startedAt,
        finishedAt: null,
        exitCode: null,
        command: handle.command,
        provider: executionPlan.provider,
        providerServiceId: executionPlan.providerServiceId,
        lastTermination: null,
      },
    },
    message: readiness.message,
  }));
}

export async function stopService(service: DiscoveredService): Promise<LifecycleActionResult> {
  const serviceId = service.manifest.id;
  const current = getLifecycleState(serviceId);
  if (!current.running) {
    throw new LifecycleStateError(`Cannot stop service "${serviceId}" because it is not running.`);
  }

  const stopped = await stopManagedProcess(serviceId);
  const finishedAt = new Date().toISOString();

  return applyState(serviceId, "stop", (state) => ({
    nextState: {
      ...state,
      running: false,
      runtime: {
        ...state.runtime,
        pid: null,
        finishedAt,
        exitCode: stopped?.exitCode ?? state.runtime.exitCode ?? 0,
        lastTermination: "stopped",
        metrics: applyRunCompletionMetrics(state, finishedAt, "stopped"),
      },
    },
    message: "Stop completed.",
  }));
}

export async function restartService(
  service: DiscoveredService,
  registry?: ServiceRegistry,
): Promise<LifecycleActionResult> {
  const serviceId = service.manifest.id;
  const current = getLifecycleState(serviceId);
  if (!current.installed) {
    throw new LifecycleStateError(`Cannot restart service "${serviceId}" before install.`);
  }
  if (!current.configured) {
    throw new LifecycleStateError(`Cannot restart service "${serviceId}" before config.`);
  }
  const executionPlan = resolveExecutionPlanForLifecycle(service, registry);
  if (executionPlan.provider === "direct" && !service.manifest.executable) {
    throw new LifecycleStateError(`Cannot restart service "${serviceId}" because no executable is configured.`);
  }

  if (current.running) {
    await stopManagedProcess(serviceId);
  }

  const sharedGlobalEnv = registry ? collectRuntimeGlobalEnv(registry.list()) : {};
  const resolvedPorts = Object.keys(current.runtime.ports).length > 0
    ? current.runtime.ports
    : registry
      ? await negotiateServicePorts(service, registry.list())
      : {};
  const handle = await startManagedProcess({
    service,
    executionPlan,
    sharedGlobalEnv,
    resolvedPorts,
    onExit: async ({ exitCode, wasStopping }) => {
      if (wasStopping) {
        return;
      }
      await persistProcessExit(service, exitCode);
    },
  });

  updateRuntimeState(serviceId, (state) => ({
    ...state,
    running: true,
    runtime: {
      ...state.runtime,
      pid: handle.pid,
      startedAt: handle.startedAt,
      finishedAt: null,
      exitCode: null,
      command: handle.command,
      provider: executionPlan.provider,
      providerServiceId: executionPlan.providerServiceId,
      lastTermination: null,
      ports: resolvedPorts,
      logs: {
        logPath: handle.logs.logPath,
        stdoutPath: handle.logs.stdoutPath,
        stderrPath: handle.logs.stderrPath,
      },
      metrics: applyProcessLaunchMetrics(state, "restart", handle.startedAt),
    },
  }));

  const readiness = await waitForServiceReadiness(service, sharedGlobalEnv);
  if (!readiness.ready) {
    const stopped = await stopManagedProcess(serviceId);
    return applyState(
      serviceId,
      "restart",
      (state) => ({
        nextState: {
          ...state,
          running: false,
          runtime: {
            ...state.runtime,
            pid: null,
            finishedAt: new Date().toISOString(),
            exitCode: stopped?.exitCode ?? state.runtime.exitCode ?? 0,
            lastTermination: "stopped",
            metrics: applyRunCompletionMetrics(state, new Date().toISOString(), "stopped"),
          },
        },
        message: readiness.message,
      }),
      false,
    );
  }

  return applyState(serviceId, "restart", (state) => ({
    nextState: {
      ...state,
      running: true,
      runtime: {
        ...state.runtime,
        pid: handle.pid,
        startedAt: handle.startedAt,
        finishedAt: null,
        exitCode: null,
        command: handle.command,
        provider: executionPlan.provider,
        providerServiceId: executionPlan.providerServiceId,
        lastTermination: null,
      },
    },
    message: readiness.message.replace(/^Start/, "Restart"),
  }));
}
