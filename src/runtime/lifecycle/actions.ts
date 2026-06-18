import type { DiscoveredService } from "../../contracts/service.js";
import { LifecycleStateError } from "../../server/errors.js";
import {
  startManagedProcess,
  stopManagedProcess,
} from "../execution/supervisor.js";
import {
  mintScopedBrokerIdentity,
  revokeServiceScopedBrokerIdentities,
} from "../broker/identity.js";
import {
  mergeServiceVariableResolutionOptions,
  resolveServiceStartupBrokerResolution,
  summarizeRequiredStartupBrokerFailures,
  type BrokerLaunchLookup,
} from "../broker/launch-resolution.js";
import { waitForServiceReadiness } from "../health/waitForReadiness.js";
import { DependencyGraph } from "../manager/DependencyGraph.js";
import type { ServiceRegistry } from "../manager/ServiceRegistry.js";
import {
  compileServiceSelectorPlan,
  collectRuntimeGlobalEnv,
  type ServiceVariableResolutionOptions,
} from "../operator/variables.js";
import { negotiateServicePorts } from "../ports/negotiate.js";
import { reservePorts, type PortReservationInput } from "../ports/reservations.js";
import { createDirectExecutionPlan } from "../providers/direct.js";
import { resolveProviderExecution } from "../providers/resolveProvider.js";
import { assertDoctorPreflightAllowsRestart } from "../recovery/doctor.js";
import { appendServiceRecoveryHistoryEvents } from "../recovery/history.js";
import { acquireInstallArtifact } from "../setup/acquire.js";
import {
  materializeConfigArtifacts,
  materializeInstallArtifacts,
} from "../setup/materialize.js";
import { writeServiceState } from "../state/writeState.js";
import { isProviderRole } from "../roles.js";
import { getLifecycleState, setLifecycleState } from "./store.js";
import type {
  LifecycleAction,
  LifecycleActionResult,
  ServiceLifecycleState,
  ServiceStartTraceAttempt,
  ServiceStartTraceEventStatus,
  ServiceStartTracePhase,
} from "./types.js";

const START_TRACE_HISTORY_LIMIT = 5;
const SECRET_LIKE_VALUE_PATTERN =
  /(BEGIN PRIVATE KEY|access_token\s*[:=]\s*[^\s,;}]+|refresh_token\s*[:=]\s*[^\s,;}]+|id_token\s*[:=]\s*[^\s,;}]+|session_cookie\s*[:=]\s*[^\s,;}]+|client_secret\s*[:=]\s*[^\s,;}]+|provider_credential\s*[:=]\s*[^\s,;}]+|raw_secret\s*[:=]\s*[^\s,;}]+|password\s*[:=]\s*[^\s,;}]+|token\s*[:=]\s*[^\s,;}]+|Bearer\s+[A-Za-z0-9._~+/-]{12,})/gi;
const SECRET_LIKE_KEY_PATTERN = /(secret|token|password|credential|private|cookie|key)/i;

function calculateRunDurationMs(
  startedAt: string | null,
  finishedAt: string,
): number | null {
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
  const runDurationMs = calculateRunDurationMs(
    current.runtime.startedAt,
    finishedAt,
  );

  return {
    ...current.runtime.metrics,
    stopCount:
      current.runtime.metrics.stopCount + (termination === "stopped" ? 1 : 0),
    exitCount:
      current.runtime.metrics.exitCount + (termination === "exited" ? 1 : 0),
    crashCount:
      current.runtime.metrics.crashCount + (termination === "crashed" ? 1 : 0),
    totalRunDurationMs:
      current.runtime.metrics.totalRunDurationMs + (runDurationMs ?? 0),
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
    const previousRunDurationMs = calculateRunDurationMs(
      current.runtime.startedAt,
      startedAt,
    );
    totalRunDurationMs += previousRunDurationMs ?? 0;
    lastRunDurationMs = previousRunDurationMs;
  }

  return {
    ...current.runtime.metrics,
    launchCount: current.runtime.metrics.launchCount + 1,
    restartCount:
      current.runtime.metrics.restartCount + (action === "restart" ? 1 : 0),
    totalRunDurationMs,
    lastRunDurationMs,
  };
}

export interface ServiceLifecycleActionOptions {
  variableResolution?: ServiceVariableResolutionOptions;
  brokerLookup?: BrokerLaunchLookup;
  workspaceRoot?: string;
}

function isUsablePort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 65535;
}

function toServicePortReservations(service: DiscoveredService, ports: Record<string, number>): PortReservationInput[] {
  return Object.entries(ports)
    .filter(([, port]) => isUsablePort(port))
    .map(([portName, port]) => {
      const desiredPort = service.manifest.ports?.[portName];
      return {
        kind: desiredPort === port && desiredPort !== 0 ? "service-fixed" : "service-negotiated",
        ownerId: service.manifest.id,
        portName,
        port,
      };
    });
}

async function reserveServicePorts(
  workspaceRoot: string | undefined,
  service: DiscoveredService,
  ports: Record<string, number>,
): Promise<void> {
  if (!workspaceRoot) {
    return;
  }

  const reservations = toServicePortReservations(service, ports);
  if (reservations.length > 0) {
    await reservePorts(workspaceRoot, reservations);
  }
}

function applyState(
  serviceId: string,
  action: LifecycleAction,
  recipe: (current: ServiceLifecycleState) => {
    nextState: ServiceLifecycleState;
    message: string;
  },
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

function redactTraceString(value: string): string {
  return value.replace(SECRET_LIKE_VALUE_PATTERN, (match) => {
    const separator = match.match(/[:=]/)?.[0];
    if (!separator) {
      return "[redacted]";
    }
    return match.slice(0, match.indexOf(separator) + 1) + "[redacted]";
  });
}

function sanitizeTraceMetadata(
  metadata: Record<string, string | number | boolean | null | string[]>,
): Record<string, string | number | boolean | null | string[]> {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => {
      if (SECRET_LIKE_KEY_PATTERN.test(key) && !Array.isArray(value)) {
        return [key, "[redacted]"];
      }
      if (typeof value === "string") {
        return [key, redactTraceString(value)];
      }
      if (Array.isArray(value)) {
        return [key, value.map((entry) => redactTraceString(entry))];
      }
      return [key, value];
    }),
  );
}

function createStartTraceAttempt(serviceId: string, action: "start" | "restart"): ServiceStartTraceAttempt {
  const startedAt = new Date().toISOString();
  return {
    attemptId: `${action}-${serviceId}-${startedAt.replace(/[:.]/g, "-")}`,
    serviceId,
    action,
    startedAt,
    finishedAt: null,
    status: "running",
    events: [],
  };
}

function cloneTraceAttempt(attempt: ServiceStartTraceAttempt): ServiceStartTraceAttempt {
  return {
    ...attempt,
    events: attempt.events.map((event) => ({
      ...event,
      metadata: { ...event.metadata },
    })),
  };
}

function beginStartTrace(serviceId: string, action: "start" | "restart"): ServiceStartTraceAttempt {
  const attempt = createStartTraceAttempt(serviceId, action);
  updateRuntimeState(serviceId, (state) => ({
    ...state,
    runtime: {
      ...state.runtime,
      startTrace: {
        ...state.runtime.startTrace,
        current: cloneTraceAttempt(attempt),
      },
    },
  }));
  return attempt;
}

function recordStartTraceEvent(
  serviceId: string,
  attempt: ServiceStartTraceAttempt,
  phase: ServiceStartTracePhase,
  status: ServiceStartTraceEventStatus,
  message: string,
  metadata: Record<string, string | number | boolean | null | string[]> = {},
): void {
  const now = new Date().toISOString();
  attempt.events.push({
    order: attempt.events.length + 1,
    phase,
    status,
    serviceId,
    startedAt: now,
    finishedAt: now,
    message: redactTraceString(message),
    metadata: sanitizeTraceMetadata(metadata),
  });
  updateRuntimeState(serviceId, (state) => ({
    ...state,
    runtime: {
      ...state.runtime,
      startTrace: {
        ...state.runtime.startTrace,
        current: cloneTraceAttempt(attempt),
      },
    },
  }));
}

function finishStartTrace(
  serviceId: string,
  attempt: ServiceStartTraceAttempt,
  status: "succeeded" | "failed" | "blocked",
  message: string,
): void {
  recordStartTraceEvent(
    serviceId,
    attempt,
    "terminal_outcome",
    status === "succeeded" ? "completed" : status,
    message,
  );
  attempt.status = status;
  attempt.finishedAt = new Date().toISOString();
  const completedAttempt = cloneTraceAttempt(attempt);
  updateRuntimeState(serviceId, (state) => ({
    ...state,
    runtime: {
      ...state.runtime,
      startTrace: {
        current: completedAttempt,
        history: [
          completedAttempt,
          ...state.runtime.startTrace.history.filter((entry) => entry.attemptId !== completedAttempt.attemptId),
        ].slice(0, START_TRACE_HISTORY_LIMIT),
      },
    },
  }));
}

function failStartTraceAndThrow(
  serviceId: string,
  attempt: ServiceStartTraceAttempt,
  phase: ServiceStartTracePhase,
  message: string,
): never {
  if (phase !== "terminal_outcome") {
    recordStartTraceEvent(serviceId, attempt, phase, "blocked", message);
  }
  finishStartTrace(serviceId, attempt, "blocked", message);
  throw new LifecycleStateError(message);
}

function formatStartupBrokerFailureMessage(
  serviceId: string,
  failures: ReturnType<typeof summarizeRequiredStartupBrokerFailures>,
): string {
  const refs = failures
    .map((failure) => `${failure.ref}:${failure.status}`)
    .join(", ");
  return `Cannot start service "${serviceId}" because required broker refs are unresolved (${refs}).`;
}

async function resolveLaunchVariableResolution(
  service: DiscoveredService,
  options: ServiceLifecycleActionOptions,
): Promise<ServiceVariableResolutionOptions | undefined> {
  if (!options.brokerLookup) {
    return options.variableResolution;
  }

  const resolution = await resolveServiceStartupBrokerResolution(
    service,
    options.brokerLookup,
    options.variableResolution,
  );
  const requiredFailures = summarizeRequiredStartupBrokerFailures(resolution);
  if (requiredFailures.length > 0) {
    throw new LifecycleStateError(
      formatStartupBrokerFailureMessage(service.manifest.id, requiredFailures),
    );
  }

  return mergeServiceVariableResolutionOptions(
    options.variableResolution,
    resolution.variableResolution,
  );
}

async function persistProcessExit(
  service: DiscoveredService,
  exitCode: number | null,
): Promise<void> {
  const finishedAt = new Date().toISOString();
  const revokedIdentities = revokeServiceScopedBrokerIdentities(
    service.manifest.id,
    { now: new Date(finishedAt) },
  );
  const revokedIdentity =
    revokedIdentities.at(-1) ??
    getLifecycleState(service.manifest.id).runtime.brokerIdentity;
  const termination =
    (exitCode ??
      getLifecycleState(service.manifest.id).runtime.exitCode ??
      0) === 0
      ? "exited"
      : "crashed";
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
      brokerIdentity: revokedIdentity,
    },
  }));

  await writeServiceState(service, state);
}

function resolveExecutionPlanForLifecycle(
  service: DiscoveredService,
  current: ServiceLifecycleState,
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

  return createDirectExecutionPlan(
    service.manifest,
    current.installArtifacts.artifact,
  );
}

export async function installService(
  service: DiscoveredService,
  registry?: ServiceRegistry,
): Promise<LifecycleActionResult> {
  const serviceId = service.manifest.id;
  const sharedGlobalEnv = registry
    ? collectRuntimeGlobalEnv(registry.list())
    : {};
  const acquiredArtifact = await acquireInstallArtifact(service);
  const artifacts = await materializeInstallArtifacts(service, sharedGlobalEnv);

  return applyState(serviceId, "install", (current) => ({
    nextState: {
      ...current,
      installed: true,
      running: false,
      installArtifacts: {
        ...artifacts,
        artifact: acquiredArtifact ?? current.installArtifacts.artifact,
      },
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
  options: ServiceLifecycleActionOptions = {},
): Promise<LifecycleActionResult> {
  const serviceId = service.manifest.id;
  const current = getLifecycleState(serviceId);
  if (!current.installed) {
    throw new LifecycleStateError(
      `Cannot config service "${serviceId}" before install.`,
    );
  }

  const resolvedPorts = registry
    ? await negotiateServicePorts(service, registry.list(), { workspaceRoot: options.workspaceRoot })
    : current.runtime.ports;
  await reserveServicePorts(options.workspaceRoot, service, resolvedPorts);
  const sharedGlobalEnv = registry
    ? collectRuntimeGlobalEnv(registry.list())
    : {};
  const artifacts = await materializeConfigArtifacts(
    service,
    sharedGlobalEnv,
    resolvedPorts,
  );

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
  options: ServiceLifecycleActionOptions = {},
): Promise<LifecycleActionResult> {
  const serviceId = service.manifest.id;
  const trace = beginStartTrace(serviceId, "start");
  const current = getLifecycleState(serviceId);
  if (!current.installed) {
    failStartTraceAndThrow(
      serviceId,
      trace,
      "artifact_acquisition",
      `Cannot start service "${serviceId}" before install.`,
    );
  }
  if (!current.configured) {
    failStartTraceAndThrow(
      serviceId,
      trace,
      "artifact_acquisition",
      `Cannot start service "${serviceId}" before config.`,
    );
  }
  if (current.running) {
    failStartTraceAndThrow(
      serviceId,
      trace,
      "terminal_outcome",
      `Cannot start service "${serviceId}" because it is already running.`,
    );
  }
  const executionPlan = resolveExecutionPlanForLifecycle(
    service,
    current,
    registry,
  );
  if (
    executionPlan.provider === "direct" &&
    !service.manifest.executable &&
    !current.installArtifacts.artifact?.command
  ) {
    failStartTraceAndThrow(
      serviceId,
      trace,
      "artifact_acquisition",
      `Cannot start service "${serviceId}" because no executable is configured.`,
    );
  }

  if (registry) {
    const dependencyGraph = new DependencyGraph(registry);
    const dependencyOrder = dependencyGraph.getStartupOrder(serviceId);
    recordStartTraceEvent(
      serviceId,
      trace,
      "dependency_resolution",
      "completed",
      "Dependency startup order resolved.",
      {
        dependencyOrder,
        dependencyCount: dependencyOrder.length,
      },
    );

    for (const dependencyId of dependencyOrder) {
      const dependency = registry.getById(dependencyId);
      if (!dependency) {
        failStartTraceAndThrow(
          serviceId,
          trace,
          "dependency_resolution",
          `Cannot start service "${serviceId}" because dependency "${dependencyId}" was not found.`,
        );
      }

      const dependencyState = getLifecycleState(dependencyId);
      if (!dependencyState.installed) {
        failStartTraceAndThrow(
          serviceId,
          trace,
          "dependency_resolution",
          `Cannot start service "${serviceId}" because dependency "${dependencyId}" is not installed.`,
        );
      }
      if (!dependencyState.configured) {
        failStartTraceAndThrow(
          serviceId,
          trace,
          "dependency_resolution",
          `Cannot start service "${serviceId}" because dependency "${dependencyId}" is not configured.`,
        );
      }

      if (!dependencyState.running && isProviderRole(dependency.manifest)) {
        continue;
      }

      if (!dependencyState.running) {
        const dependencyResult = await startService(
          dependency,
          registry,
          options,
        );
        await writeServiceState(dependency, dependencyResult.state);
      }
    }
  } else {
    recordStartTraceEvent(
      serviceId,
      trace,
      "dependency_resolution",
      "skipped",
      "No registry context was supplied for dependency resolution.",
    );
  }

  const sharedGlobalEnv = registry
    ? collectRuntimeGlobalEnv(registry.list())
    : {};
  revokeServiceScopedBrokerIdentities(serviceId);
  const scopedBrokerIdentity = mintScopedBrokerIdentity(service);
  const resolvedPorts =
    Object.keys(current.runtime.ports).length > 0
      ? current.runtime.ports
      : registry
        ? await negotiateServicePorts(service, registry.list(), { workspaceRoot: options.workspaceRoot })
        : {};
  await reserveServicePorts(options.workspaceRoot, service, resolvedPorts);
  recordStartTraceEvent(
    serviceId,
    trace,
    "port_selection",
    "completed",
    "Runtime ports selected and reserved where a workspace ledger is available.",
    {
      portNames: Object.keys(resolvedPorts).sort(),
      portCount: Object.keys(resolvedPorts).length,
    },
  );
  recordStartTraceEvent(
    serviceId,
    trace,
    "artifact_acquisition",
    "completed",
    "Startable artifact metadata is available.",
    {
      provider: executionPlan.provider,
      providerServiceId: executionPlan.providerServiceId,
      artifactSource: current.installArtifacts.artifact?.sourceType ?? "manifest",
      assetName: current.installArtifacts.artifact?.assetName ?? null,
    },
  );
  const variableResolution = await resolveLaunchVariableResolution(
    service,
    options,
  );
  const selectorPlan = compileServiceSelectorPlan({
    ...(service.manifest.globalenv ?? {}),
    ...(service.manifest.env ?? {}),
  });
  recordStartTraceEvent(
    serviceId,
    trace,
    "env_merge",
    "completed",
    "Global and service environment inputs were merged without exposing values.",
    {
      globalEnvKeys: Object.keys(sharedGlobalEnv).sort(),
      serviceEnvKeys: Object.keys(service.manifest.env ?? {}).sort(),
      brokerRefCount: selectorPlan.brokerRefs.length,
    },
  );
  let handle: Awaited<ReturnType<typeof startManagedProcess>>;
  try {
    handle = await startManagedProcess({
      service,
      executionPlan,
      sharedGlobalEnv,
      resolvedPorts,
      secureEnv: scopedBrokerIdentity?.env,
      variableResolution,
      onExit: async ({ exitCode, wasStopping }) => {
        if (wasStopping) {
          return;
        }
        await persistProcessExit(service, exitCode);
      },
    });
  } catch (error) {
    const message = `Cannot start service "${serviceId}" because process spawn failed: ${
      error instanceof Error ? error.message : String(error)
    }`;
    revokeServiceScopedBrokerIdentities(serviceId);
    recordStartTraceEvent(serviceId, trace, "process_spawn", "failed", message, {
      provider: executionPlan.provider,
      providerServiceId: executionPlan.providerServiceId,
    });
    finishStartTrace(serviceId, trace, "failed", message);
    throw new LifecycleStateError(message);
  }
  recordStartTraceEvent(
    serviceId,
    trace,
    "process_spawn",
    "completed",
    "Managed process was spawned.",
    {
      pid: handle.pid,
      provider: executionPlan.provider,
      providerServiceId: executionPlan.providerServiceId,
      logPath: handle.logs.logPath,
      stdoutPath: handle.logs.stdoutPath,
      stderrPath: handle.logs.stderrPath,
    },
  );

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
      brokerIdentity: scopedBrokerIdentity?.metadata ?? null,
    },
  }));

  const readiness = await waitForServiceReadiness(service, sharedGlobalEnv);
  recordStartTraceEvent(
    serviceId,
    trace,
    "health_check",
    readiness.ready ? "completed" : "failed",
    readiness.message,
  );
  if (!readiness.ready) {
    const stopped = await stopManagedProcess(serviceId);
    const revokedIdentities = revokeServiceScopedBrokerIdentities(serviceId);
    const revokedIdentity =
      revokedIdentities.at(-1) ?? scopedBrokerIdentity?.metadata ?? null;
    const result = applyState(
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
            metrics: applyRunCompletionMetrics(
              state,
              new Date().toISOString(),
              "stopped",
            ),
            brokerIdentity: revokedIdentity,
          },
        },
        message: readiness.message,
      }),
      false,
    );
    finishStartTrace(serviceId, trace, "failed", readiness.message);
    return { ...result, state: getLifecycleState(serviceId) };
  }

  const result = applyState(serviceId, "start", (state) => ({
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
        brokerIdentity: scopedBrokerIdentity?.metadata ?? null,
      },
    },
    message: readiness.message,
  }));
  finishStartTrace(serviceId, trace, "succeeded", readiness.message);
  return { ...result, state: getLifecycleState(serviceId) };
}

export async function stopService(
  service: DiscoveredService,
): Promise<LifecycleActionResult> {
  const serviceId = service.manifest.id;
  const current = getLifecycleState(serviceId);
  if (!current.running) {
    throw new LifecycleStateError(
      `Cannot stop service "${serviceId}" because it is not running.`,
    );
  }

  const stopped = await stopManagedProcess(serviceId);
  const finishedAt = new Date().toISOString();
  const revokedIdentities = revokeServiceScopedBrokerIdentities(serviceId, {
    now: new Date(finishedAt),
  });
  const revokedIdentity =
    revokedIdentities.at(-1) ?? current.runtime.brokerIdentity;

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
        brokerIdentity: revokedIdentity,
      },
    },
    message: "Stop completed.",
  }));
}

export async function restartService(
  service: DiscoveredService,
  registry?: ServiceRegistry,
  options: ServiceLifecycleActionOptions = {},
): Promise<LifecycleActionResult> {
  const serviceId = service.manifest.id;
  const current = getLifecycleState(serviceId);
  if (!current.installed) {
    throw new LifecycleStateError(
      `Cannot restart service "${serviceId}" before install.`,
    );
  }
  if (!current.configured) {
    throw new LifecycleStateError(
      `Cannot restart service "${serviceId}" before config.`,
    );
  }
  const executionPlan = resolveExecutionPlanForLifecycle(
    service,
    current,
    registry,
  );
  if (
    executionPlan.provider === "direct" &&
    !service.manifest.executable &&
    !current.installArtifacts.artifact?.command
  ) {
    throw new LifecycleStateError(
      `Cannot restart service "${serviceId}" because no executable is configured.`,
    );
  }
  await assertDoctorPreflightAllowsRestart(service);

  if (current.running) {
    await stopManagedProcess(serviceId);
  }
  revokeServiceScopedBrokerIdentities(serviceId);

  const sharedGlobalEnv = registry
    ? collectRuntimeGlobalEnv(registry.list())
    : {};
  const scopedBrokerIdentity = mintScopedBrokerIdentity(service);
  const resolvedPorts =
    Object.keys(current.runtime.ports).length > 0
      ? current.runtime.ports
      : registry
        ? await negotiateServicePorts(service, registry.list(), { workspaceRoot: options.workspaceRoot })
        : {};
  await reserveServicePorts(options.workspaceRoot, service, resolvedPorts);
  const variableResolution = await resolveLaunchVariableResolution(
    service,
    options,
  );
  const handle = await startManagedProcess({
    service,
    executionPlan,
    sharedGlobalEnv,
    resolvedPorts,
    secureEnv: scopedBrokerIdentity?.env,
    variableResolution,
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
      brokerIdentity: scopedBrokerIdentity?.metadata ?? null,
    },
  }));

  const readiness = await waitForServiceReadiness(service, sharedGlobalEnv);
  if (!readiness.ready) {
    const stopped = await stopManagedProcess(serviceId);
    const revokedIdentities = revokeServiceScopedBrokerIdentities(serviceId);
    const revokedIdentity =
      revokedIdentities.at(-1) ?? scopedBrokerIdentity?.metadata ?? null;
    const failedResult = applyState(
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
            metrics: applyRunCompletionMetrics(
              state,
              new Date().toISOString(),
              "stopped",
            ),
            brokerIdentity: revokedIdentity,
          },
        },
        message: readiness.message,
      }),
      false,
    );
    await appendServiceRecoveryHistoryEvents(service, [
      {
        kind: "restart",
        serviceId,
        ok: false,
        message: failedResult.message,
        at: new Date().toISOString(),
      },
    ]);
    return failedResult;
  }

  const result = applyState(serviceId, "restart", (state) => ({
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
        brokerIdentity: scopedBrokerIdentity?.metadata ?? null,
      },
    },
    message: readiness.message.replace(/^Start/, "Restart"),
  }));
  await appendServiceRecoveryHistoryEvents(service, [
    {
      kind: "restart",
      serviceId,
      ok: result.ok,
      message: result.message,
      at: new Date().toISOString(),
    },
  ]);
  return result;
}
