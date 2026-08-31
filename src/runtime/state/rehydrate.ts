import type { DiscoveredService } from "../../contracts/service.js";
import { adoptManagedProcess, hasManagedProcess } from "../execution/supervisor.js";
import { getLifecycleState, setLifecycleState } from "../lifecycle/store.js";
import type {
  LifecycleAction,
  ServiceLifecycleState,
  ServiceSetupStepRunState,
  ServiceStartTraceAttempt,
  ServiceStartTraceEvent,
  ServiceStartTraceEventStatus,
  ServiceStartTracePhase,
  SetupOutputGuardKind,
  SetupOutputGuardSnapshot,
  SetupStepStatus,
} from "../lifecycle/types.js";
import type { BrokerTransportBinding } from "../broker/identity.js";
import type { ProviderKind } from "../providers/types.js";
import type { ServiceBrokerWritebackOperation } from "../../contracts/service.js";
import path from "node:path";
import { resolveServiceEndpoints } from "../operator/endpoints.js";
import { buildServiceNetwork } from "../operator/network.js";
import { migrateLegacyProcessOwnership } from "../process/registry.js";
import type { ProcessInspectorDependencies, ProcessIdentityClassification } from "../process/identity.js";
import { readStoredState } from "./readState.js";
import { resolveServiceRootPath } from "./paths.js";
import { SERVICE_STATE_SCHEMA_VERSIONS, writeServiceState } from "./writeState.js";

export interface RehydrateProcessOwnershipOptions {
  workspaceRoot?: string;
  runtimeGenerationId?: string | null;
  runtimeInstanceId?: string | null;
  allocationRevision?: string | null;
  adoptServiceIds?: ReadonlySet<string>;
  excludeAdoptServiceIds?: ReadonlySet<string>;
  processInspectorDependencies?: ProcessInspectorDependencies;
}

interface StoredInstallState {
  schemaVersion?: unknown;
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
    checksum?: {
      algorithm?: "sha256" | null;
      source?: "manifest" | "release-asset" | null;
      expected?: string | null;
      actual?: string | null;
      assetName?: string | null;
      checksumAssetName?: string | null;
      verifiedAt?: string | null;
    } | null;
  };
}

interface StoredConfigState {
  schemaVersion?: unknown;
  configured?: boolean;
  files?: string[];
  updatedAt?: string | null;
}

interface StoredRuntimeState {
  generationId?: string | null;
  schemaVersion?: unknown;
  running?: boolean;
  pid?: number | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  exitCode?: number | null;
  command?: string | null;
  provider?: ProviderKind | null;
  providerServiceId?: string | null;
  lastTermination?: "stopped" | "exited" | "crashed" | null;
  allocationRevision?: string | null;
  ports?: Record<string, number>;
  logs?: {
    runId?: string | null;
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
  variables?: unknown;
  brokerIdentity?: ServiceLifecycleState["runtime"]["brokerIdentity"];
  startTrace?: unknown;
  supervision?: unknown;
  lastAction?: LifecycleAction | null;
  actionHistory?: LifecycleAction[];
}

interface StoredSetupState {
  schemaVersion?: unknown;
  updatedAt?: string | null;
  steps?: Record<string, {
    status?: SetupStepStatus;
    lastRun?: ServiceSetupStepRunState | null;
    history?: ServiceSetupStepRunState[];
    outputGuards?: unknown;
  }>;
}

function isLifecycleAction(value: unknown): value is LifecycleAction {
  return value === "install" || value === "config" || value === "setup" || value === "start" || value === "stop" || value === "restart";
}

function hasSupportedSchemaVersion(
  state: { schemaVersion?: unknown } | null,
  expectedSchemaVersion: string,
): boolean {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return false;
  }

  return state.schemaVersion === undefined || state.schemaVersion === expectedSchemaVersion;
}

function isWritebackOperation(value: unknown): value is ServiceBrokerWritebackOperation {
  return value === "create" || value === "update" || value === "rotate" || value === "delete";
}

function parseBrokerTransportBinding(value: unknown): BrokerTransportBinding | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as { kind?: unknown; subject?: unknown };
  if (
    (record.kind !== "unix-uid" && record.kind !== "windows-sid") ||
    typeof record.subject !== "string" ||
    record.subject.trim() === ""
  ) {
    return null;
  }

  return {
    kind: record.kind,
    subject: record.subject.trim(),
  };
}

function parseBrokerIdentity(value: unknown): ServiceLifecycleState["runtime"]["brokerIdentity"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as ServiceLifecycleState["runtime"]["brokerIdentity"];
  if (
    !record ||
    typeof record.id !== "string" ||
    typeof record.serviceId !== "string" ||
    typeof record.issuedAt !== "string" ||
    typeof record.expiresAt !== "string" ||
    !record.scope ||
    !Array.isArray(record.scope.namespaces) ||
    !Array.isArray(record.scope.operations) ||
    !Array.isArray(record.scope.refs) ||
    !record.audit ||
    typeof record.audit.serviceId !== "string" ||
    typeof record.audit.identityId !== "string" ||
    typeof record.audit.issuedAt !== "string" ||
    typeof record.audit.expiresAt !== "string"
  ) {
    return null;
  }

  return {
    id: record.id,
    serviceId: record.serviceId,
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
    revokedAt: typeof record.revokedAt === "string" ? record.revokedAt : null,
    transportBinding: parseBrokerTransportBinding(record.transportBinding),
    scope: {
      namespaces: record.scope.namespaces.filter((entry): entry is string => typeof entry === "string"),
      operations: record.scope.operations.filter(isWritebackOperation),
      refs: record.scope.refs.filter((entry): entry is string => typeof entry === "string"),
    },
    audit: {
      serviceId: record.audit.serviceId,
      identityId: record.audit.identityId,
      issuedAt: record.audit.issuedAt,
      expiresAt: record.audit.expiresAt,
      reason: typeof record.audit.reason === "string" ? record.audit.reason : null,
    },
  };
}

function isProviderKind(value: unknown): value is ProviderKind {
  return value === "direct" || value === "node" || value === "python" || value === "java";
}

function isSetupStepStatus(value: unknown): value is SetupStepStatus {
  return value === "succeeded" || value === "failed" || value === "timeout" || value === "skipped";
}

function isStartTracePhase(value: unknown): value is ServiceStartTracePhase {
  return (
    value === "dependency_resolution" ||
    value === "port_selection" ||
    value === "artifact_acquisition" ||
    value === "env_merge" ||
    value === "process_spawn" ||
    value === "health_check" ||
    value === "terminal_outcome"
  );
}

function isStartTraceEventStatus(value: unknown): value is ServiceStartTraceEventStatus {
  return value === "completed" || value === "blocked" || value === "failed" || value === "skipped";
}

function parseStartTraceMetadata(value: unknown): Record<string, string | number | boolean | null | string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) =>
      typeof entry === "string" ||
      typeof entry === "number" ||
      typeof entry === "boolean" ||
      entry === null ||
      (Array.isArray(entry) && entry.every((item) => typeof item === "string")),
    ),
  ) as Record<string, string | number | boolean | null | string[]>;
}

function parseStartTraceEvent(value: unknown): ServiceStartTraceEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Partial<ServiceStartTraceEvent>;
  if (
    typeof record.order !== "number" ||
    !isStartTracePhase(record.phase) ||
    !isStartTraceEventStatus(record.status) ||
    typeof record.serviceId !== "string" ||
    typeof record.startedAt !== "string" ||
    typeof record.finishedAt !== "string" ||
    typeof record.message !== "string"
  ) {
    return null;
  }

  return {
    order: record.order,
    phase: record.phase,
    status: record.status,
    serviceId: record.serviceId,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    message: record.message,
    metadata: parseStartTraceMetadata(record.metadata),
  };
}

function parseStartTraceAttempt(value: unknown): ServiceStartTraceAttempt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Partial<ServiceStartTraceAttempt>;
  if (
    typeof record.attemptId !== "string" ||
    typeof record.serviceId !== "string" ||
    (record.action !== "start" && record.action !== "restart") ||
    typeof record.startedAt !== "string" ||
    (typeof record.finishedAt !== "string" && record.finishedAt !== null) ||
    (record.status !== "running" && record.status !== "succeeded" && record.status !== "failed" && record.status !== "blocked") ||
    !Array.isArray(record.events)
  ) {
    return null;
  }

  return {
    attemptId: record.attemptId,
    serviceId: record.serviceId,
    action: record.action,
    startedAt: record.startedAt,
    finishedAt: typeof record.finishedAt === "string" ? record.finishedAt : null,
    status: record.status,
    events: record.events.map(parseStartTraceEvent).filter((event): event is ServiceStartTraceEvent => event !== null),
  };
}

function parseStartTraceState(value: unknown): ServiceLifecycleState["runtime"]["startTrace"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { current: null, history: [] };
  }

  const record = value as { current?: unknown; history?: unknown };
  return {
    current: parseStartTraceAttempt(record.current),
    history: Array.isArray(record.history)
      ? record.history.map(parseStartTraceAttempt).filter((attempt): attempt is ServiceStartTraceAttempt => attempt !== null)
      : [],
  };
}

function parseRuntimeVariables(value: unknown): ServiceLifecycleState["runtime"]["variables"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          return false;
        }
        const variable = entry as { value?: unknown; source?: unknown; matchedAt?: unknown };
        return (
          typeof variable.value === "string" &&
          (variable.source === "stdout" || variable.source === "stderr") &&
          typeof variable.matchedAt === "string"
        );
      })
      .map(([key, entry]) => [
        key,
        { ...(entry as ServiceLifecycleState["runtime"]["variables"][string]) },
      ]),
  );
}

function parseSupervisionState(value: unknown): ServiceLifecycleState["runtime"]["supervision"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      restartAttempts: 0,
      lastRestartAttemptAt: null,
      lastRestartReason: null,
      lastRestartResult: null,
      nextRestartAt: null,
    };
  }

  const record = value as Partial<ServiceLifecycleState["runtime"]["supervision"]>;
  return {
    restartAttempts:
      typeof record.restartAttempts === "number" && Number.isInteger(record.restartAttempts) && record.restartAttempts > 0
        ? record.restartAttempts
        : 0,
    lastRestartAttemptAt: typeof record.lastRestartAttemptAt === "string" ? record.lastRestartAttemptAt : null,
    lastRestartReason:
      record.lastRestartReason === "crash" || record.lastRestartReason === "unhealthy"
        ? record.lastRestartReason
        : null,
    lastRestartResult:
      record.lastRestartResult === "scheduled" ||
      record.lastRestartResult === "started" ||
      record.lastRestartResult === "failed" ||
      record.lastRestartResult === "blocked"
        ? record.lastRestartResult
        : null,
    nextRestartAt: typeof record.nextRestartAt === "string" ? record.nextRestartAt : null,
  };
}

function parseSetupRun(value: unknown): ServiceSetupStepRunState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Partial<ServiceSetupStepRunState>;
  if (
    typeof record.runId !== "string" ||
    typeof record.serviceId !== "string" ||
    typeof record.stepId !== "string" ||
    !isSetupStepStatus(record.status) ||
    typeof record.startedAt !== "string" ||
    typeof record.finishedAt !== "string" ||
    typeof record.durationMs !== "number" ||
    typeof record.command !== "string" ||
    typeof record.message !== "string" ||
    !record.logs ||
    typeof record.logs.logPath !== "string" ||
    typeof record.logs.stdoutPath !== "string" ||
    typeof record.logs.stderrPath !== "string"
  ) {
    return null;
  }

  return {
    runId: record.runId,
    serviceId: record.serviceId,
    stepId: record.stepId,
    status: record.status,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    durationMs: record.durationMs,
    command: record.command,
    cwd: typeof record.cwd === "string" ? record.cwd : undefined,
    exitCode: typeof record.exitCode === "number" ? record.exitCode : null,
    signal: typeof record.signal === "string" ? record.signal : null,
    message: record.message,
    logs: record.logs,
  };
}

function parseSetupOutputGuards(value: unknown): SetupOutputGuardSnapshot | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const record = value as { evaluatedAt?: unknown; satisfied?: unknown; results?: unknown };
  if (typeof record.evaluatedAt !== "string" || typeof record.satisfied !== "boolean" || !Array.isArray(record.results)) {
    return undefined;
  }

  const results: SetupOutputGuardSnapshot["results"] = [];
  for (const entry of record.results) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return undefined;
    }
    const result = entry as { declared?: unknown; relativePath?: unknown; present?: unknown; kind?: unknown };
    const kind = result.kind === "file" || result.kind === "directory" || result.kind === null ? result.kind : undefined;
    if (
      typeof result.declared !== "string" ||
      typeof result.relativePath !== "string" ||
      typeof result.present !== "boolean" ||
      kind === undefined
    ) {
      return undefined;
    }
    results.push({
      declared: result.declared,
      relativePath: result.relativePath,
      present: result.present,
      kind,
    });
  }

  return {
    evaluatedAt: record.evaluatedAt,
    satisfied: record.satisfied,
    results,
  };
}

function parseSetupState(setup: StoredSetupState | null): ServiceLifecycleState["setup"] {
  if (!setup?.steps || typeof setup.steps !== "object") {
    return { updatedAt: null, steps: {} };
  }

  return {
    updatedAt: typeof setup.updatedAt === "string" ? setup.updatedAt : null,
    steps: Object.fromEntries(
      Object.entries(setup.steps)
        .filter(([, step]) => step && typeof step === "object")
        .map(([stepId, step]) => {
          const history = Array.isArray(step.history)
            ? step.history.map(parseSetupRun).filter((run): run is ServiceSetupStepRunState => run !== null)
            : [];
          const lastRun = parseSetupRun(step.lastRun) ?? history.at(-1) ?? null;
          const outputGuards = parseSetupOutputGuards(step.outputGuards);
          return [
            stepId,
            {
              status: isSetupStepStatus(step.status) ? step.status : lastRun?.status ?? "skipped",
              lastRun,
              history,
              ...(outputGuards ? { outputGuards } : {}),
            },
          ];
        }),
    ),
  };
}

function parseLifecycleState(service: DiscoveredService, snapshot: {
  install: unknown | null;
  config: unknown | null;
  runtime: unknown | null;
  setup: unknown | null;
}): ServiceLifecycleState | null {
  const rawInstall = snapshot.install as StoredInstallState | null;
  const rawConfig = snapshot.config as StoredConfigState | null;
  const rawRuntime = snapshot.runtime as StoredRuntimeState | null;
  const rawSetup = snapshot.setup as StoredSetupState | null;
  const install = hasSupportedSchemaVersion(rawInstall, SERVICE_STATE_SCHEMA_VERSIONS.install) ? rawInstall : null;
  const config = hasSupportedSchemaVersion(rawConfig, SERVICE_STATE_SCHEMA_VERSIONS.config) ? rawConfig : null;
  const runtime = hasSupportedSchemaVersion(rawRuntime, SERVICE_STATE_SCHEMA_VERSIONS.runtime) ? rawRuntime : null;
  const setup = hasSupportedSchemaVersion(rawSetup, SERVICE_STATE_SCHEMA_VERSIONS.setup) ? rawSetup : null;

  const installed = install?.installed === true;
  const configured = config?.configured === true;
  const running = false;
  const actionHistory = Array.isArray(runtime?.actionHistory)
    ? runtime.actionHistory.filter((action): action is LifecycleAction => isLifecycleAction(action))
    : [];
  const lastAction = isLifecycleAction(runtime?.lastAction) ? runtime.lastAction : null;

  const setupState = parseSetupState(setup);
  const ports =
    runtime?.ports && typeof runtime.ports === "object" && !Array.isArray(runtime.ports)
      ? Object.fromEntries(
          Object.entries(runtime.ports).filter(
            ([, value]) => typeof value === "number" && Number.isInteger(value) && value > 0,
          ),
        )
      : {};

  if (
    !installed &&
    !configured &&
    runtime?.running !== true &&
    actionHistory.length === 0 &&
    lastAction === null &&
    Object.keys(setupState.steps).length === 0
  ) {
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
        checksum:
          install?.artifact?.checksum?.algorithm === "sha256" &&
          (install.artifact.checksum.source === "manifest" || install.artifact.checksum.source === "release-asset") &&
          typeof install.artifact.checksum.expected === "string" &&
          typeof install.artifact.checksum.actual === "string" &&
          typeof install.artifact.checksum.assetName === "string" &&
          typeof install.artifact.checksum.verifiedAt === "string"
            ? {
                algorithm: "sha256",
                source: install.artifact.checksum.source,
                expected: install.artifact.checksum.expected,
                actual: install.artifact.checksum.actual,
                assetName: install.artifact.checksum.assetName,
                checksumAssetName:
                  typeof install.artifact.checksum.checksumAssetName === "string"
                    ? install.artifact.checksum.checksumAssetName
                    : null,
                verifiedAt: install.artifact.checksum.verifiedAt,
              }
            : null,
      },
    },
    configArtifacts: {
      files: Array.isArray(config?.files) ? config.files.filter((file): file is string => typeof file === "string") : [],
      updatedAt: typeof config?.updatedAt === "string" ? config.updatedAt : null,
    },
    setup: setupState,
    runtime: {
      generationId: typeof runtime?.generationId === "string" ? runtime.generationId : null,
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
      allocationRevision: typeof runtime?.allocationRevision === "string" ? runtime.allocationRevision : null,
      ports,
      endpoints: resolveServiceEndpoints(service, ports),
      logs: {
        runId: typeof runtime?.logs?.runId === "string" ? runtime.logs.runId : null,
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
      variables: parseRuntimeVariables(runtime?.variables),
      brokerIdentity: parseBrokerIdentity(runtime?.brokerIdentity),
      startTrace: parseStartTraceState(runtime?.startTrace),
      supervision: parseSupervisionState(runtime?.supervision),
    },
  };
}

function buildBlockedRehydrateState(
  service: DiscoveredService,
  state: ServiceLifecycleState,
  status: ProcessIdentityClassification,
  pid: number,
  reason: string,
): ServiceLifecycleState {
  const now = new Date().toISOString();
  const serviceId = service.manifest.id;
  const message =
    status === "unknown_owner"
      ? `Persisted process owner for service "${serviceId}" could not be verified; inspect PID ${pid} and stop the external process before restarting this service.`
      : `Persisted process owner for service "${serviceId}" was not adopted because ownership verification returned ${status}.`;
  const attempt: ServiceStartTraceAttempt = {
    attemptId: `rehydrate-${serviceId}-${now.replace(/[:.]/g, "-")}`,
    serviceId,
    action: "start",
    startedAt: now,
    finishedAt: now,
    status: "blocked",
    events: [{
      order: 1,
      phase: "process_spawn",
      status: "blocked",
      serviceId,
      startedAt: now,
      finishedAt: now,
      message,
      metadata: {
        processOwnerStatus: status,
        previousPid: pid,
        reason,
        nextSafeAction: "Inspect the persisted PID owner and stop the external process before starting a replacement.",
      },
    }],
  };

  return {
    ...state,
    running: false,
    runtime: {
      ...state.runtime,
      pid: null,
      finishedAt: now,
      exitCode: null,
      lastTermination: status === "not_running" ? "exited" : state.runtime.lastTermination,
      startTrace: {
        current: attempt,
        history: [...state.runtime.startTrace.history, attempt],
      },
    },
  };
}

export async function rehydrateLifecycleState(
  service: DiscoveredService,
  options: RehydrateProcessOwnershipOptions = {},
): Promise<ServiceLifecycleState | null> {
  const snapshot = await readStoredState(service.serviceRoot);
  const state = parseLifecycleState(service, snapshot);
  let rehydratedState = state;

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

    const legacyRuntime = snapshot.runtime as StoredRuntimeState | null;
    if (
      options.workspaceRoot &&
      (!options.adoptServiceIds || options.adoptServiceIds.has(serviceId)) &&
      !options.excludeAdoptServiceIds?.has(serviceId) &&
      !hasManagedProcess(serviceId) &&
      legacyRuntime?.running === true &&
      typeof legacyRuntime.pid === "number" &&
      Number.isInteger(legacyRuntime.pid) &&
      legacyRuntime.pid > 0 &&
      typeof legacyRuntime.startedAt === "string" &&
      typeof legacyRuntime.command === "string" &&
      legacyRuntime.command.trim()
    ) {
      const manifestExecutable = service.manifest.executable
        ? path.isAbsolute(service.manifest.executable)
          ? service.manifest.executable
          : path.resolve(service.serviceRoot, service.manifest.executable)
        : null;
      const installedExecutable = state.installArtifacts.artifact?.command && state.installArtifacts.artifact.extractedPath
        ? path.resolve(state.installArtifacts.artifact.extractedPath, state.installArtifacts.artifact.command)
        : null;
      const network = buildServiceNetwork(service, {}, state.runtime.ports);
      const migration = await migrateLegacyProcessOwnership(options.workspaceRoot, {
        ownerId: serviceId,
        serviceId,
        generationId: options.runtimeGenerationId,
        runtimeInstanceId: options.runtimeInstanceId,
        allocationRevision: options.allocationRevision,
        pid: legacyRuntime.pid,
        startedAt: legacyRuntime.startedAt,
        command: legacyRuntime.command,
        expectedExecutablePath: manifestExecutable ?? installedExecutable,
        ownerRoot: service.serviceRoot,
        ports: state.runtime.ports,
        endpoints: network.endpoints
          .filter((endpoint): endpoint is typeof endpoint & { url: string } => typeof endpoint.url === "string")
          .map((endpoint) => ({ name: endpoint.label, url: endpoint.url })),
        inspectorDependencies: options.processInspectorDependencies,
      });

      if (migration.status === "owned") {
        await adoptManagedProcess({
          service,
          pid: legacyRuntime.pid,
          startedAt: legacyRuntime.startedAt,
          command: legacyRuntime.command,
          workspaceRoot: options.workspaceRoot,
        });
        const adoptedState = setLifecycleState(serviceId, {
          ...nextState,
          running: true,
          runtime: {
            ...nextState.runtime,
            pid: legacyRuntime.pid,
            startedAt: legacyRuntime.startedAt,
            finishedAt: null,
            exitCode: null,
            command: legacyRuntime.command,
            lastTermination: null,
            ports: state.runtime.ports,
            endpoints: resolveServiceEndpoints(service, state.runtime.ports),
          },
        });
        rehydratedState = adoptedState;
        await writeServiceState(service, adoptedState);
      }

      if (migration.status === "not_running" || migration.status === "identity_mismatch") {
        await writeServiceState(service, nextState);
      }

      if (migration.status === "unknown_owner") {
        const blockedState = setLifecycleState(
          serviceId,
          buildBlockedRehydrateState(service, nextState, migration.status, legacyRuntime.pid, migration.reason),
        );
        rehydratedState = blockedState;
        await writeServiceState(service, blockedState);
      }
    }
  }

  return rehydratedState;
}

export async function rehydrateDiscoveredServices(
  services: DiscoveredService[],
  options: RehydrateProcessOwnershipOptions = {},
): Promise<void> {
  for (const service of services) {
    await rehydrateLifecycleState(service, options);
  }
}
