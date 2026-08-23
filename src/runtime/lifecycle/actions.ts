import type {
  DiscoveredService,
  ServiceActionDefinition,
  ServiceRestartPolicy,
} from "../../contracts/service.js";
import path from "node:path";
import { spawn } from "node:child_process";
import { LifecycleStateError } from "../../server/errors.js";
import {
  beginManagedProcessStop,
  hasManagedProcess,
  registerManagedProcessShutdownQuiescer,
  startManagedProcess,
  stopManagedProcess,
  waitForManagedProcessExit,
} from "../execution/supervisor.js";
import {
  parseCommandlineArgs,
  selectPlatformCommandline,
} from "../execution/commandline.js";
import {
  issueScopedBrokerIdentity,
  revokeServiceScopedBrokerIdentities,
} from "../broker/identity.js";
import { resolveSecretsBrokerLaunchEnv } from "../broker/bootstrap.js";
import {
  loadSecretsBrokerRuntimeContext,
  type SecretsBrokerRuntimeContext,
} from "../broker/runtime.js";
import {
  createSecretsBrokerLaunchLookup,
  resolveSecretsBrokerLaunchLeaseIssuer,
} from "../broker/launch-lookup.js";
import { SECRETSBROKER_SERVICE_ID } from "../broker/operator-config.js";
import { onboardMissingProducerSecrets } from "../broker/onboard.js";
import {
  mergeServiceVariableResolutionOptions,
  resolveServiceStartupBrokerResolution,
  summarizeRequiredStartupBrokerFailures,
  type BrokerLaunchLookup,
} from "../broker/launch-resolution.js";
import { resolveBrokerMaterializationVariables } from "../broker/materialization-resolution.js";
import { waitForServiceReadiness } from "../health/waitForReadiness.js";
import { DependencyGraph } from "../manager/DependencyGraph.js";
import type { ServiceRegistry } from "../manager/ServiceRegistry.js";
import {
  buildServiceVariables,
  compileServiceSelectorPlan,
  collectRuntimeGlobalEnv,
  resolveServiceEnvValue,
  resolveServiceText,
  type ServiceSelectorDiagnostic,
  type ServiceVariableResolutionOptions,
} from "../operator/variables.js";
import { resolveServiceEndpoints } from "../operator/endpoints.js";
import { negotiateServicePorts } from "../ports/negotiate.js";
import { reservePorts, type PortReservationInput } from "../ports/reservations.js";
import { transitionProcessOwnership } from "../process/registry.js";
import { createDirectExecutionPlan } from "../providers/direct.js";
import { resolveProviderExecution } from "../providers/resolveProvider.js";
import { assertDoctorPreflightAllowsRestart } from "../recovery/doctor.js";
import { appendServiceRecoveryHistoryEvents } from "../recovery/history.js";
import { acquireInstallArtifact } from "../setup/acquire.js";
import {
  materializeConfigArtifacts,
  materializeInstallArtifacts,
} from "../setup/materialize.js";
import type { MaterializationWriteHooks, StartupArtifactAcquisitionHooks } from "../startup/materialization.js";
import { writeServiceState } from "../state/writeState.js";
import { isProviderRole } from "../roles.js";
import { getLifecycleState, setLifecycleState } from "./store.js";
import type {
  LifecycleAction,
  LifecycleActionResult,
  ServiceLifecycleState,
  ServiceRuntimeSupervisionRestartReason,
  ServiceStartTraceAttempt,
  ServiceStartTraceEventStatus,
  ServiceStartTracePhase,
} from "./types.js";

const START_TRACE_HISTORY_LIMIT = 5;
const DEFAULT_RESTART_MAX_ATTEMPTS = 3;
const DEFAULT_RESTART_BACKOFF_SECONDS = 5;
const DEFAULT_STOP_ACTION_TIMEOUT_SECONDS = 30;
const SECRET_LIKE_VALUE_PATTERN =
  /(BEGIN PRIVATE KEY|access_token\s*[:=]\s*[^\s,;}]+|refresh_token\s*[:=]\s*[^\s,;}]+|id_token\s*[:=]\s*[^\s,;}]+|session_cookie\s*[:=]\s*[^\s,;}]+|client_secret\s*[:=]\s*[^\s,;}]+|provider_credential\s*[:=]\s*[^\s,;}]+|raw_secret\s*[:=]\s*[^\s,;}]+|password\s*[:=]\s*[^\s,;}]+|token\s*[:=]\s*[^\s,;}]+|Bearer\s+[A-Za-z0-9._~+/-]{12,})/gi;
const SECRET_LIKE_KEY_PATTERN = /(secret|token|password|credential|private|cookie|key)/i;
const scheduledSupervisionRestarts = new Map<string, ReturnType<typeof setTimeout>>();
const activeSupervisionRestarts = new Map<string, Promise<void>>();
const supervisionRestartClaims = new Set<string>();
const shutdownRequestedServiceIds = new Set<string>();

registerManagedProcessShutdownQuiescer(async (managedServiceIds) => {
  const serviceIds = new Set([
    ...managedServiceIds,
    ...scheduledSupervisionRestarts.keys(),
    ...activeSupervisionRestarts.keys(),
  ]);
  for (const serviceId of serviceIds) {
    shutdownRequestedServiceIds.add(serviceId);
    cancelScheduledSupervisionRestart(serviceId);
  }
  await Promise.allSettled([...activeSupervisionRestarts.values()]);
});

function createEmptySupervisionState(): ServiceLifecycleState["runtime"]["supervision"] {
  return {
    restartAttempts: 0,
    lastRestartAttemptAt: null,
    lastRestartReason: null,
    lastRestartResult: null,
    nextRestartAt: null,
  };
}

export function cancelScheduledSupervisionRestart(serviceId: string): void {
  const timer = scheduledSupervisionRestarts.get(serviceId);
  if (!timer) {
    return;
  }
  clearTimeout(timer);
  scheduledSupervisionRestarts.delete(serviceId);
}

export function hasPendingSupervisionRestart(serviceId: string): boolean {
  return supervisionRestartClaims.has(serviceId)
    || scheduledSupervisionRestarts.has(serviceId)
    || activeSupervisionRestarts.has(serviceId);
}

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
  brokerRuntime?: SecretsBrokerRuntimeContext | null;
  workspaceRoot?: string;
  runtimeGenerationId?: string | null;
  runtimeInstanceId?: string | null;
  plannedPorts?: Record<string, number>;
  allocationRevision?: string | null;
  materializationHooks?: MaterializationWriteHooks;
  artifactAcquisitionHooks?: StartupArtifactAcquisitionHooks;
  supervisionRestart?: {
    reason: ServiceRuntimeSupervisionRestartReason;
    attemptNumber: number;
  };
}

function isUsablePort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 65535;
}

function toServicePortReservations(service: DiscoveredService, ports: Record<string, number>): PortReservationInput[] {
  return Object.entries(ports)
    .filter(([, port]) => isUsablePort(port))
    .map(([portName, port]) => {
      const desiredPort = resolveServiceEndpoints(service, ports).find((endpoint) => endpoint.id === portName)?.portDefault;
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
): Promise<string | null> {
  if (!workspaceRoot) {
    return null;
  }

  const reservations = toServicePortReservations(service, ports);
  if (reservations.length > 0) {
    return (await reservePorts(workspaceRoot, reservations)).updatedAt;
  }
  return null;
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
  metadata: Record<string, string | number | boolean | null | string[]> = {},
): never {
  if (phase !== "terminal_outcome") {
    recordStartTraceEvent(serviceId, attempt, phase, "blocked", message, metadata);
  }
  finishStartTrace(serviceId, attempt, "blocked", message);
  throw new LifecycleStateError(message);
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
}

function formatUnresolvedLocalSelectorMessage(
  serviceId: string,
  diagnostics: ServiceSelectorDiagnostic[],
): string {
  const refs = diagnostics
    .map((diagnostic) =>
      diagnostic.key
        ? `${diagnostic.key}:${diagnostic.selector}`
        : diagnostic.selector,
    )
    .join(", ");
  return `Cannot start service "${serviceId}" because required local env selectors are unresolved (${refs}).`;
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
  options: ServiceLifecycleActionOptions & {
    brokerService?: DiscoveredService;
    launchLeaseIssuer?: Awaited<ReturnType<typeof resolveSecretsBrokerLaunchLeaseIssuer>>;
  },
): Promise<ServiceVariableResolutionOptions | undefined> {
  if (!options.brokerLookup) {
    return options.variableResolution;
  }

  let resolution = await resolveServiceStartupBrokerResolution(
    service,
    options.brokerLookup,
    options.variableResolution,
  );

  if (options.brokerService) {
    const onboard = await onboardMissingProducerSecrets({
      service,
      resolution,
      brokerService: options.brokerService,
      launchLeaseIssuer: options.launchLeaseIssuer,
    });
    if (onboard.appliedRefs.length > 0) {
      resolution = await resolveServiceStartupBrokerResolution(
        service,
        options.brokerLookup,
        options.variableResolution,
      );
    }
  }

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

async function resolveBrokerLaunchContext(
  service: DiscoveredService,
  registry: ServiceRegistry | undefined,
  options: ServiceLifecycleActionOptions,
): Promise<{
  scopedBrokerIdentity: Awaited<ReturnType<typeof issueScopedBrokerIdentity>>;
  variableResolution: ServiceVariableResolutionOptions | undefined;
}> {
  const brokerService = registry?.getById(SECRETSBROKER_SERVICE_ID);
  const launchLeaseIssuer = await resolveSecretsBrokerLaunchLeaseIssuer(brokerService);
  const scopedBrokerIdentity = await issueScopedBrokerIdentity(service, {
    launchLeaseIssuer,
  });
  const brokerLookup =
    options.brokerLookup ??
    createSecretsBrokerLaunchLookup({
      brokerService,
      launchLeaseIssuer,
      workspaceId: launchLeaseIssuer?.workspaceId,
    });

  return {
    scopedBrokerIdentity,
    variableResolution: await resolveLaunchVariableResolution(service, {
      ...options,
      brokerLookup,
      brokerService,
      launchLeaseIssuer,
    }),
  };
}

async function resolveBrokerServerEnvironment(
  service: DiscoveredService,
  registry: ServiceRegistry | undefined,
  options: ServiceLifecycleActionOptions,
): Promise<Record<string, string> | undefined> {
  if (service.manifest.id !== SECRETSBROKER_SERVICE_ID) return undefined;

  const brokerRuntime = options.brokerRuntime !== undefined
    ? options.brokerRuntime
    : registry && options.workspaceRoot
      ? await loadSecretsBrokerRuntimeContext(options.workspaceRoot, registry)
      : null;
  return brokerRuntime?.serverEnv ?? await resolveSecretsBrokerLaunchEnv(service);
}

function classifyUnexpectedTermination(
  exitCode: number | null,
  signal: NodeJS.Signals | null,
): "exited" | "crashed" {
  if (signal) {
    return "crashed";
  }

  return (exitCode ?? 0) === 0 ? "exited" : "crashed";
}

async function persistProcessExit(
  service: DiscoveredService,
  exitCode: number | null,
  signal: NodeJS.Signals | null = null,
): Promise<void> {
  const finishedAt = new Date().toISOString();
  const revokedIdentities = revokeServiceScopedBrokerIdentities(
    service.manifest.id,
    { now: new Date(finishedAt) },
  );
  const revokedIdentity =
    revokedIdentities.at(-1) ??
    getLifecycleState(service.manifest.id).runtime.brokerIdentity;
  const termination = classifyUnexpectedTermination(
    exitCode ?? getLifecycleState(service.manifest.id).runtime.exitCode,
    signal,
  );
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

function resolveRestartMaxAttempts(policy: ServiceRestartPolicy): number {
  return policy.maxAttempts ?? DEFAULT_RESTART_MAX_ATTEMPTS;
}

function resolveRestartBackoffSeconds(policy: ServiceRestartPolicy): number {
  return policy.backoffSeconds ?? DEFAULT_RESTART_BACKOFF_SECONDS;
}

function restartPolicyAllowsCrash(policy: ServiceRestartPolicy): boolean {
  return policy.enabled === true && policy.onCrash !== false;
}

async function recordSupervisionDecision(
  service: DiscoveredService,
  nextSupervision: ServiceLifecycleState["runtime"]["supervision"],
  message: string,
  ok: boolean,
): Promise<void> {
  const state = updateRuntimeState(service.manifest.id, (current) => ({
    ...current,
    runtime: {
      ...current.runtime,
      supervision: nextSupervision,
    },
  }));
  await writeServiceState(service, state);
  await appendServiceRecoveryHistoryEvents(service, [
    {
      kind: "restart",
      serviceId: service.manifest.id,
      ok,
      message,
      at: new Date().toISOString(),
    },
  ]);
}

async function blockSupervisionRestart(
  service: DiscoveredService,
  reason: ServiceRuntimeSupervisionRestartReason,
  message: string,
): Promise<void> {
  const current = getLifecycleState(service.manifest.id);
  await recordSupervisionDecision(
    service,
    {
      ...current.runtime.supervision,
      lastRestartReason: reason,
      lastRestartResult: "blocked",
      nextRestartAt: null,
    },
    message,
    false,
  );
}

async function runScheduledSupervisionRestart(
  service: DiscoveredService,
  registry: ServiceRegistry | undefined,
  options: ServiceLifecycleActionOptions,
  reason: ServiceRuntimeSupervisionRestartReason,
  attemptNumber: number,
): Promise<void> {
  const serviceId = service.manifest.id;
  scheduledSupervisionRestarts.delete(serviceId);
  const targetService = registry?.getById(serviceId) ?? service;
  const current = getLifecycleState(serviceId);

  if (shutdownRequestedServiceIds.has(serviceId)) {
    await blockSupervisionRestart(service, reason, `Automatic restart blocked for "${serviceId}" because runtime shutdown was requested.`);
    return;
  }

  if (registry && !registry.getById(serviceId)) {
    await blockSupervisionRestart(service, reason, `Automatic restart blocked for "${serviceId}" because it is no longer present in the registry.`);
    return;
  }
  if (targetService.manifest.enabled === false) {
    await blockSupervisionRestart(targetService, reason, `Automatic restart blocked for "${serviceId}" because the service is disabled.`);
    return;
  }
  if (!current.installed || !current.configured) {
    await blockSupervisionRestart(targetService, reason, `Automatic restart blocked for "${serviceId}" because it is not installed and configured.`);
    return;
  }
  if (current.running) {
    await blockSupervisionRestart(targetService, reason, `Automatic restart blocked for "${serviceId}" because it is already running.`);
    return;
  }

  try {
    const result = await startService(targetService, registry, {
      ...options,
      supervisionRestart: { reason, attemptNumber },
    });
    await writeServiceState(targetService, result.state);
    await recordSupervisionDecision(
      targetService,
      {
        ...result.state.runtime.supervision,
        restartAttempts: result.ok ? 0 : attemptNumber,
        lastRestartAttemptAt: new Date().toISOString(),
        lastRestartReason: reason,
        lastRestartResult: result.ok ? "started" : "failed",
        nextRestartAt: null,
      },
      result.ok
        ? `Automatic restart started "${serviceId}" after ${reason}.`
        : `Automatic restart failed for "${serviceId}": ${result.message}`,
      result.ok,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failedState = getLifecycleState(serviceId);
    await recordSupervisionDecision(
      targetService,
      {
        ...failedState.runtime.supervision,
        restartAttempts: attemptNumber,
        lastRestartAttemptAt: new Date().toISOString(),
        lastRestartReason: reason,
        lastRestartResult: "failed",
        nextRestartAt: null,
      },
      `Automatic restart failed for "${serviceId}": ${message}`,
      false,
    );
  }
}

async function superviseUnexpectedProcessExit(
  service: DiscoveredService,
  exitCode: number | null,
  signal: NodeJS.Signals | null,
  registry: ServiceRegistry | undefined,
  options: ServiceLifecycleActionOptions,
): Promise<void> {
  await persistProcessExit(service, exitCode, signal);

  const serviceId = service.manifest.id;
  const termination = classifyUnexpectedTermination(exitCode, signal);
  const reason: ServiceRuntimeSupervisionRestartReason = "crash";
  const policy = service.manifest.restartPolicy;
  supervisionRestartClaims.add(serviceId);

  try {

    if (shutdownRequestedServiceIds.has(serviceId)) {
    await blockSupervisionRestart(service, reason, `Automatic restart blocked for "${serviceId}" because runtime shutdown was requested.`);
    return;
  }

  if (!policy || policy.enabled !== true) {
    await blockSupervisionRestart(service, reason, `Automatic restart skipped for "${serviceId}" because restartPolicy is not enabled.`);
    return;
  }
  if (service.manifest.enabled === false) {
    await blockSupervisionRestart(service, reason, `Automatic restart blocked for "${serviceId}" because the service is disabled.`);
    return;
  }
  if (termination !== "crashed") {
    await blockSupervisionRestart(service, reason, `Automatic restart skipped for "${serviceId}" because the unexpected exit was clean.`);
    return;
  }
  if (!restartPolicyAllowsCrash(policy)) {
    await blockSupervisionRestart(service, reason, `Automatic restart skipped for "${serviceId}" because restartPolicy.onCrash is disabled.`);
    return;
  }

  const current = getLifecycleState(serviceId);
  if (!current.installed || !current.configured) {
    await blockSupervisionRestart(service, reason, `Automatic restart blocked for "${serviceId}" because it is not installed and configured.`);
    return;
  }

  const maxAttempts = resolveRestartMaxAttempts(policy);
  const attemptNumber = current.runtime.supervision.restartAttempts + 1;
  if (attemptNumber > maxAttempts) {
    await blockSupervisionRestart(service, reason, `Automatic restart blocked for "${serviceId}" because maxAttempts was reached.`);
    return;
  }

  const now = new Date();
  const backoffSeconds = resolveRestartBackoffSeconds(policy);
  const nextRestartAt = new Date(now.getTime() + backoffSeconds * 1000).toISOString();
  cancelScheduledSupervisionRestart(serviceId);
  await recordSupervisionDecision(
    service,
    {
      ...current.runtime.supervision,
      restartAttempts: attemptNumber,
      lastRestartAttemptAt: now.toISOString(),
      lastRestartReason: reason,
      lastRestartResult: "scheduled",
      nextRestartAt,
    },
    `Automatic restart scheduled for "${serviceId}" after ${reason} (attempt ${attemptNumber} of ${maxAttempts}).`,
    true,
  );

  const timer = setTimeout(() => {
    const restart = runScheduledSupervisionRestart(service, registry, options, reason, attemptNumber);
    activeSupervisionRestarts.set(serviceId, restart);
    void restart.then(() => {
      if (activeSupervisionRestarts.get(serviceId) === restart) {
        activeSupervisionRestarts.delete(serviceId);
      }
    }, () => {
      if (activeSupervisionRestarts.get(serviceId) === restart) {
        activeSupervisionRestarts.delete(serviceId);
      }
    });
  }, backoffSeconds * 1000);
  timer.unref?.();
    scheduledSupervisionRestarts.set(serviceId, timer);
  } finally {
    supervisionRestartClaims.delete(serviceId);
  }
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

function getLifecycleStopOverride(service: DiscoveredService): ServiceActionDefinition | null {
  const action = service.manifest.actions?.stop;
  if (!action) {
    return null;
  }

  if (selectPlatformCommandline(action.commandline) || action.command) {
    return action;
  }

  return null;
}

function resolveStopOverrideCommand(
  service: DiscoveredService,
  action: ServiceActionDefinition,
  resolvedPorts: Record<string, number>,
): { executable: string; args: string[] } | null {
  const commandline = selectPlatformCommandline(action.commandline);
  if (commandline) {
    const [executable, ...args] = parseCommandlineArgs(resolveServiceText(commandline, service, {}, resolvedPorts));
    if (!executable) {
      throw new LifecycleStateError(
        `Cannot stop service "${service.manifest.id}" because actions.stop.commandline did not resolve to an executable.`,
      );
    }
    return { executable, args };
  }

  if (!action.command) {
    return null;
  }

  return {
    executable: resolveServiceText(action.command, service, {}, resolvedPorts),
    args: (action.args ?? []).map((arg) => resolveServiceText(arg, service, {}, resolvedPorts)),
  };
}

function resolveStopOverrideCwd(
  service: DiscoveredService,
  action: ServiceActionDefinition,
  resolvedPorts: Record<string, number>,
): string {
  if (!action.cwd) {
    return service.serviceRoot;
  }

  const cwd = resolveServiceText(action.cwd, service, {}, resolvedPorts);
  return path.isAbsolute(cwd) ? cwd : path.resolve(service.serviceRoot, cwd);
}

function buildStopOverrideEnvironment(
  service: DiscoveredService,
  action: ServiceActionDefinition,
  resolvedPorts: Record<string, number>,
): NodeJS.ProcessEnv {
  const serviceVariables = Object.fromEntries(
    buildServiceVariables(service, {}, resolvedPorts).variables.map((entry) => [entry.key, entry.value]),
  );
  const actionEnv = Object.fromEntries(
    Object.entries(action.env ?? {}).map(([key, value]) => [
      key,
      resolveServiceEnvValue(value, service, {}, resolvedPorts),
    ]),
  );

  return {
    ...process.env,
    ...serviceVariables,
    ...actionEnv,
    SERVICE_LASSO_ACTION_ID: "stop",
    SERVICE_LASSO_TARGET_ACTION_ID: "stop",
    SERVICE_LASSO_RUN_SOURCE: "lifecycle",
  };
}

async function runStopOverrideCommand(
  service: DiscoveredService,
  action: ServiceActionDefinition,
  resolvedPorts: Record<string, number>,
): Promise<{ ok: boolean; timedOut: boolean; exitCode: number | null; signal: NodeJS.Signals | null }> {
  const command = resolveStopOverrideCommand(service, action, resolvedPorts);
  if (!command) {
    return { ok: false, timedOut: false, exitCode: null, signal: null };
  }

  const timeoutMs = (action.timeoutSeconds ?? DEFAULT_STOP_ACTION_TIMEOUT_SECONDS) * 1000;
  await beginManagedProcessStop(service.manifest.id);

  const child = spawn(command.executable, command.args, {
    cwd: resolveStopOverrideCwd(service, action, resolvedPorts),
    env: buildStopOverrideEnvironment(service, action, resolvedPorts),
    stdio: "ignore",
    windowsHide: true,
  });

  let timedOut = false;
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<{ exitCode: null; signal: "SIGKILL" }>((resolve) => {
    timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
      resolve({ exitCode: null, signal: "SIGKILL" });
    }, timeoutMs);
    timeout.unref?.();
  });

  const exitPromise = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal }));
  });

  try {
    const exit = await Promise.race([exitPromise, timeoutPromise]);
    if (timeout) {
      clearTimeout(timeout);
    }
    return {
      ok: !timedOut && exit.exitCode === 0,
      timedOut,
      exitCode: exit.exitCode,
      signal: exit.signal,
    };
  } catch {
    if (timeout) {
      clearTimeout(timeout);
    }
    return {
      ok: false,
      timedOut: false,
      exitCode: null,
      signal: null,
    };
  }
}

async function stopManagedProcessWithOverride(
  service: DiscoveredService,
  current: ServiceLifecycleState,
): Promise<{ exitCode: number | null; message: string }> {
  const serviceId = service.manifest.id;
  const override = getLifecycleStopOverride(service);
  if (!override) {
    const stopped = await stopManagedProcess(serviceId);
    return {
      exitCode: stopped?.exitCode ?? current.runtime.exitCode ?? 0,
      message: "Stop completed.",
    };
  }

  const overrideResult = await runStopOverrideCommand(service, override, current.runtime.ports);
  if (overrideResult.ok) {
    const settled = await waitForManagedProcessExit(serviceId, 5_000);
    if (settled || !hasManagedProcess(serviceId)) {
      return {
        exitCode: settled?.exitCode ?? overrideResult.exitCode ?? current.runtime.exitCode ?? 0,
        message: "Stop completed with actions.stop override.",
      };
    }
  }

  const stopped = await stopManagedProcess(serviceId);
  const reason = overrideResult.timedOut
    ? "timed out"
    : `failed with exit code ${overrideResult.exitCode ?? "unknown"}`;
  return {
    exitCode: stopped?.exitCode ?? current.runtime.exitCode ?? 0,
    message: `Stop override ${reason}; fallback stop completed.`,
  };
}

export async function installService(
  service: DiscoveredService,
  registry?: ServiceRegistry,
  options: ServiceLifecycleActionOptions = {},
): Promise<LifecycleActionResult> {
  const serviceId = service.manifest.id;
  const sharedGlobalEnv = registry
    ? collectRuntimeGlobalEnv(registry.list())
    : {};
  const acquiredArtifact = await acquireInstallArtifact(service, options.artifactAcquisitionHooks);
  const artifacts = await materializeInstallArtifacts(service, sharedGlobalEnv, {}, {}, options.materializationHooks);

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

  const resolvedPorts = options.plannedPorts ?? (registry
    ? await negotiateServicePorts(service, registry.list(), { workspaceRoot: options.workspaceRoot })
    : current.runtime.ports);
  const allocationRevision = options.allocationRevision ?? await reserveServicePorts(options.workspaceRoot, service, resolvedPorts);
  const sharedGlobalEnv = registry
    ? collectRuntimeGlobalEnv(registry.list())
    : {};
  const variableResolution = registry
    ? await resolveBrokerMaterializationVariables(service, registry, options)
    : options.variableResolution;
  const artifacts = await materializeConfigArtifacts(
    service,
    sharedGlobalEnv,
    resolvedPorts,
    variableResolution,
    options.materializationHooks,
  );

  return applyState(serviceId, "config", (state) => ({
    nextState: {
      ...state,
      configured: true,
      configArtifacts: artifacts,
      runtime: {
        ...state.runtime,
        allocationRevision,
        ports: resolvedPorts,
        endpoints: resolveServiceEndpoints(service, resolvedPorts),
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
  if (!options.supervisionRestart) {
    shutdownRequestedServiceIds.delete(serviceId);
    cancelScheduledSupervisionRestart(serviceId);
  }
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
  const { scopedBrokerIdentity, variableResolution } = await resolveBrokerLaunchContext(
    service,
    registry,
    options,
  );
  const brokerLaunchEnv = await resolveBrokerServerEnvironment(service, registry, options);
  const resolvedPorts = options.plannedPorts ?? (
    Object.keys(current.runtime.ports).length > 0
      ? current.runtime.ports
      : registry
        ? await negotiateServicePorts(service, registry.list(), { workspaceRoot: options.workspaceRoot })
        : {}
  );
  const allocationRevision = options.allocationRevision ?? await reserveServicePorts(options.workspaceRoot, service, resolvedPorts);
  recordStartTraceEvent(
    serviceId,
    trace,
    "port_selection",
    "completed",
    "Runtime ports selected and reserved where a workspace ledger is available.",
    {
      allocationRevision,
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
  const variablePayload = buildServiceVariables(
    service,
    sharedGlobalEnv,
    resolvedPorts,
    variableResolution,
  );
  const unresolvedLocalDiagnostics = variablePayload.diagnostics.filter(
    (diagnostic) =>
      diagnostic.kind === "local" &&
      diagnostic.reason === "unresolved-local",
  );
  const selectorPlan = compileServiceSelectorPlan({
    ...(service.manifest.globalenv ?? {}),
    ...(service.manifest.env ?? {}),
  });
  if (unresolvedLocalDiagnostics.length > 0) {
    failStartTraceAndThrow(
      serviceId,
      trace,
      "env_merge",
      formatUnresolvedLocalSelectorMessage(serviceId, unresolvedLocalDiagnostics),
      {
        unresolvedSelectors: uniqueStrings(
          unresolvedLocalDiagnostics.map((diagnostic) => diagnostic.selector),
        ),
        unresolvedEnvKeys: uniqueStrings(
          unresolvedLocalDiagnostics.map((diagnostic) => diagnostic.key),
        ),
        unresolvedRawSelectors: uniqueStrings(
          unresolvedLocalDiagnostics.map((diagnostic) => diagnostic.raw),
        ),
        brokerRefCount: selectorPlan.brokerRefs.length,
      },
    );
  }
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
  updateRuntimeState(serviceId, (state) => ({
    ...state,
    runtime: {
      ...state.runtime,
      variables: {},
    },
  }));
  let handle: Awaited<ReturnType<typeof startManagedProcess>>;
  try {
    handle = await startManagedProcess({
      service,
      executionPlan,
      sharedGlobalEnv,
      resolvedPorts,
      secureEnv: {
        ...(brokerLaunchEnv ?? {}),
        ...(scopedBrokerIdentity?.env ?? {}),
      },
      variableResolution,
      workspaceRoot: options.workspaceRoot,
      runtimeGenerationId: options.runtimeGenerationId,
      runtimeInstanceId: options.runtimeInstanceId,
      allocationRevision,
      onExit: async ({ exitCode, signal, wasStopping }) => {
        if (wasStopping) {
          return;
        }
        await superviseUnexpectedProcessExit(service, exitCode, signal, registry, options);
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
      runId: handle.logs.runId,
      stdoutPath: handle.logs.stdoutPath,
      stderrPath: handle.logs.stderrPath,
    },
  );

  updateRuntimeState(serviceId, (state) => ({
    ...state,
    running: true,
    runtime: {
      ...state.runtime,
      generationId: options.runtimeGenerationId ?? null,
      pid: handle.pid,
      startedAt: handle.startedAt,
      finishedAt: null,
      exitCode: null,
      command: handle.command,
      provider: executionPlan.provider,
      providerServiceId: executionPlan.providerServiceId,
      lastTermination: null,
      allocationRevision,
      ports: resolvedPorts,
      endpoints: resolveServiceEndpoints(service, resolvedPorts),
      logs: {
        runId: handle.logs.runId,
        logPath: handle.logs.logPath,
        stdoutPath: handle.logs.stdoutPath,
        stderrPath: handle.logs.stderrPath,
      },
      metrics: applyProcessLaunchMetrics(state, "start", handle.startedAt),
      brokerIdentity: scopedBrokerIdentity?.metadata ?? null,
    },
  }));

  const readiness = await waitForServiceReadiness(service, sharedGlobalEnv, {
    workspaceRoot: options.workspaceRoot,
    generationId: options.runtimeGenerationId,
    allocationRevision,
    expectedPorts: resolvedPorts,
  });
  recordStartTraceEvent(
    serviceId,
    trace,
    "health_check",
    readiness.ready ? "completed" : "failed",
    readiness.message,
    {
      readinessAttribution: readiness.attribution.classification,
      attributedEndpointCount: readiness.attribution.checkedEndpointCount,
    },
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

  if (options.workspaceRoot) {
    await transitionProcessOwnership(options.workspaceRoot, "service", serviceId, "running", "owned", handle.pid);
  }

  const processStillManaged = hasManagedProcess(serviceId);
  const result = applyState(serviceId, "start", (state) => ({
    nextState: {
      ...state,
      running: processStillManaged,
      runtime: {
        ...state.runtime,
        pid: processStillManaged ? handle.pid : null,
        startedAt: handle.startedAt,
        finishedAt: processStillManaged ? null : state.runtime.finishedAt,
        exitCode: processStillManaged ? null : state.runtime.exitCode,
        command: handle.command,
        provider: executionPlan.provider,
        providerServiceId: executionPlan.providerServiceId,
        lastTermination: processStillManaged ? null : state.runtime.lastTermination,
        allocationRevision,
        brokerIdentity: scopedBrokerIdentity?.metadata ?? null,
        supervision: options.supervisionRestart
          ? state.runtime.supervision
          : createEmptySupervisionState(),
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
  cancelScheduledSupervisionRestart(serviceId);
  const current = getLifecycleState(serviceId);
  if (!current.running) {
    throw new LifecycleStateError(
      `Cannot stop service "${serviceId}" because it is not running.`,
    );
  }

  const stopped = await stopManagedProcessWithOverride(service, current);
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
        exitCode: stopped.exitCode,
        lastTermination: "stopped",
        metrics: applyRunCompletionMetrics(state, finishedAt, "stopped"),
        brokerIdentity: revokedIdentity,
      },
    },
    message: stopped.message,
  }));
}

export async function restartService(
  service: DiscoveredService,
  registry?: ServiceRegistry,
  options: ServiceLifecycleActionOptions = {},
): Promise<LifecycleActionResult> {
  const serviceId = service.manifest.id;
  shutdownRequestedServiceIds.delete(serviceId);
  cancelScheduledSupervisionRestart(serviceId);
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
  const { scopedBrokerIdentity, variableResolution } = await resolveBrokerLaunchContext(
    service,
    registry,
    options,
  );
  const brokerLaunchEnv = await resolveBrokerServerEnvironment(service, registry, options);
  const resolvedPorts = options.plannedPorts ?? (
    Object.keys(current.runtime.ports).length > 0
      ? current.runtime.ports
      : registry
        ? await negotiateServicePorts(service, registry.list(), { workspaceRoot: options.workspaceRoot })
        : {}
  );
  const allocationRevision = options.allocationRevision ?? await reserveServicePorts(options.workspaceRoot, service, resolvedPorts);
  updateRuntimeState(serviceId, (state) => ({
    ...state,
    runtime: {
      ...state.runtime,
      variables: {},
    },
  }));
  const handle = await startManagedProcess({
    service,
    executionPlan,
    sharedGlobalEnv,
    resolvedPorts,
    secureEnv: {
      ...(brokerLaunchEnv ?? {}),
      ...(scopedBrokerIdentity?.env ?? {}),
    },
    variableResolution,
    workspaceRoot: options.workspaceRoot,
    runtimeInstanceId: options.runtimeInstanceId,
    runtimeGenerationId: options.runtimeGenerationId,
    allocationRevision,
    onExit: async ({ exitCode, signal, wasStopping }) => {
      if (wasStopping) {
        return;
      }
      await superviseUnexpectedProcessExit(service, exitCode, signal, registry, options);
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
      allocationRevision,
      ports: resolvedPorts,
      endpoints: resolveServiceEndpoints(service, resolvedPorts),
      logs: {
        runId: handle.logs.runId,
        logPath: handle.logs.logPath,
        stdoutPath: handle.logs.stdoutPath,
        stderrPath: handle.logs.stderrPath,
      },
      metrics: applyProcessLaunchMetrics(state, "restart", handle.startedAt),
      brokerIdentity: scopedBrokerIdentity?.metadata ?? null,
    },
  }));

  const readiness = await waitForServiceReadiness(service, sharedGlobalEnv, {
    workspaceRoot: options.workspaceRoot,
    generationId: options.runtimeGenerationId,
    allocationRevision,
    expectedPorts: resolvedPorts,
  });
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

  if (options.workspaceRoot) {
    await transitionProcessOwnership(options.workspaceRoot, "service", serviceId, "running", "owned", handle.pid);
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
        allocationRevision,
        brokerIdentity: scopedBrokerIdentity?.metadata ?? null,
        supervision: createEmptySupervisionState(),
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
