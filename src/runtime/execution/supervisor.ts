import path from "node:path";
import { inspectKnownWindowsTreeMembers } from "../process/windows-tree-control-snapshot.js";
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants, createWriteStream, type WriteStream } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { DiscoveredService } from "../../contracts/service.js";
import { observeNativeAcknowledgementContainment } from "./native-ack-containment.js";
import {
  resolveExecutionArgs,
  selectPlatformCommandline,
} from "./commandline.js";
import {
  buildServiceVariables,
  type ServiceVariableResolutionOptions,
} from "../operator/variables.js";
import { buildServiceNetwork } from "../operator/network.js";
import {
  archiveRuntimeLogs,
  buildServiceRuntimeLogRunId,
  getServiceRuntimeLogPaths,
  type ServiceRuntimeLogPaths,
} from "../operator/logs.js";
import { getLifecycleState, getLifecycleWorkspaceRoot, setLifecycleState } from "../lifecycle/store.js";
import { writeServiceState } from "../state/writeState.js";
import {
  classifyRegisteredProcess,
  findProcessOwnership,
  recordProcessOwnership,
  reconcileRegisteredProcess,
  transitionProcessOwnership,
  type ProcessOwnershipEntry,
} from "../process/registry.js";
import {
  classifyProcessIdentity,
  inspectProcess,
  inspectWindowsProcessTree,
  type ProcessFingerprint,
  type ProcessInspection,
} from "../process/identity.js";
import {
  isProcessControlDeadlineError,
  processControlDeadline,
  remainingProcessControlMs,
  withProcessControlDeadline,
} from "../process/deadline.js";
import {
  captureOwnedProcessTreeMembers,
  createSpawnProcessGroup,
  terminateOwnedProcessTree,
  type OwnedProcessTreeTarget,
  type ProcessTreeTerminationResult,
} from "../process/tree.js";
import type { ProviderExecutionPlan } from "../providers/types.js";

export interface ManagedProcessHandle {
  pid: number;
  startedAt: string;
  command: string;
  logs: ServiceRuntimeLogPaths;
}

export type ManagedProcessStartFailurePhase =
  | "prelaunch_verification"
  | "launch_state_creation"
  | "wrapper_spawn"
  | "ownership_enrollment"
  | "ownership_recording"
  | "initial_tree_inspection"
  | "launch_file_binding"
  | "binding_revalidation"
  | "target_acknowledgement"
  | "post_release_hook"
  | "stabilization_delay"
  | "stabilized_tree_inspection"
  | "launch_state_cleanup"
  | "launcher_initialization"
  | "launcher_native_asset_validation"
  | "launcher_payload_validation"
  | "launcher_gate_observation"
  | "launcher_file_open"
  | "launcher_file_hash"
  | "launcher_file_final_path"
  | "launcher_binding_publication"
  | "launcher_job_creation"
  | "launcher_target_creation"
  | "launcher_job_assignment"
  | "launcher_target_resume"
  | "launcher_target_thread_close"
  | "launcher_acknowledgement_write";

export type LauncherPayloadFailureBoundary =
  | "launch_evidence"
  | "canonical_encoding"
  | "strict_utf8"
  | "json_or_schema"
  | "semantic_payload"
  | "unknown";

export class ManagedProcessStartError extends Error {
  readonly failurePhase: ManagedProcessStartFailurePhase;
  readonly launcherPayloadFailureBoundary: LauncherPayloadFailureBoundary | null;

  constructor(
    failurePhase: ManagedProcessStartFailurePhase,
    cause: unknown,
    launcherPayloadFailureBoundary: LauncherPayloadFailureBoundary | null = null,
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "ManagedProcessStartError";
    this.failurePhase = failurePhase;
    this.launcherPayloadFailureBoundary = launcherPayloadFailureBoundary;
  }
}

export class ManagedProcessEnrollmentContainmentError extends AggregateError {
  readonly handle: ManagedProcessHandle;
  readonly failurePhase: ManagedProcessStartFailurePhase;

  constructor(
    errors: readonly unknown[],
    message: string,
    handle: ManagedProcessHandle,
    failurePhase: ManagedProcessStartFailurePhase,
  ) {
    super(errors, message);
    this.name = "ManagedProcessEnrollmentContainmentError";
    this.handle = handle;
    this.failurePhase = failurePhase;
  }
}

export function managedProcessStartFailurePhase(
  error: unknown,
): ManagedProcessStartFailurePhase | null {
  return error instanceof ManagedProcessStartError ||
    error instanceof ManagedProcessEnrollmentContainmentError
    ? error.failurePhase
    : null;
}

export function managedProcessLauncherPayloadFailureBoundary(
  error: unknown,
): LauncherPayloadFailureBoundary | null {
  return error instanceof ManagedProcessStartError &&
    error.failurePhase === "launcher_payload_validation"
    ? (error.launcherPayloadFailureBoundary ?? "unknown")
    : null;
}

function managedLauncherPayloadDiagnostic(
  record: Pick<
    ManagedProcessRecord,
    | "launcherProgressPhase"
    | "launcherPayloadDiagnosticInvalid"
    | "launcherPayloadDiagnosticCount"
    | "launcherPayloadFailureBoundary"
  >,
): LauncherPayloadFailureBoundary | null {
  if (record.launcherProgressPhase !== "launcher_payload_validation")
    return null;
  return record.launcherPayloadDiagnosticInvalid ||
    record.launcherPayloadDiagnosticCount !== 1
    ? "unknown"
    : (record.launcherPayloadFailureBoundary ?? "unknown");
}

interface ManagedProcessRecord {
  child: ChildProcess;
  service: DiscoveredService;
  startedAt: string;
  command: string;
  stopping: boolean;
  stoppingPersisted: boolean;
  exitCode: number | null;
  exitSignal: NodeJS.Signals | null;
  logs: ServiceRuntimeLogPaths;
  logStreams: {
    combined: WriteStream;
    stdout: WriteStream;
    stderr: WriteStream;
  };
  stdoutBuffer: string;
  stderrBuffer: string;
  launcherProgressToken: string | null;
  launcherProgressPhase: ManagedProcessStartFailurePhase | null;
  launcherPayloadFailureBoundary: Exclude<
    LauncherPayloadFailureBoundary,
    "unknown"
  > | null;
  launcherPayloadDiagnosticCount: number;
  launcherPayloadDiagnosticInvalid: boolean;
  variableCapturePromise: Promise<void>;
  workspaceRoot: string | null;
  rootIdentity: ProcessFingerprint | null;
  processGroup: ProcessOwnershipEntry["processGroup"];
  knownTreeMembers: ProcessFingerprint[];
  verifiedMembersOnly?: boolean;
  excludedTreeMemberPids: Set<number>;
  treeMonitorPromise: Promise<void>;
  treeMonitorAbortController: AbortController;
  treeTerminationPromise: Promise<ProcessTreeTerminationResult> | null;
  stopDeadlineMs: number | null;
  exitPromise: Promise<{
    exitCode: number | null;
    signal: NodeJS.Signals | null;
  }>;
  logCapturePromise: Promise<void>;
  finalizePromise: Promise<void>;
}

interface AdoptedProcessRecord {
  service: DiscoveredService;
  pid: number;
  startedAt: string;
  command: string;
  stopping: boolean;
  stoppingPersisted: boolean;
  workspaceRoot: string;
  rootIdentity: ProcessFingerprint;
  processGroup: ProcessOwnershipEntry["processGroup"];
  knownTreeMembers: ProcessFingerprint[];
  verifiedMembersOnly?: boolean;
  excludedTreeMemberPids: Set<number>;
  monitorAbortController: AbortController;
}

export type ManagedProcessFinalizationPhase = "stop" | "finalize";

export interface ManagedProcessFinalizationFailure {
  serviceId: string;
  pid: number | null;
  phase: ManagedProcessFinalizationPhase;
  code: string;
}

export class ManagedProcessFinalizationError extends Error {
  readonly failures: ManagedProcessFinalizationFailure[];

  constructor(failures: ManagedProcessFinalizationFailure[]) {
    super(
      `Managed process finalization failed: ${failures
        .map(
          (failure) =>
            `service "${failure.serviceId}" (pid ${failure.pid ?? "unknown"}, phase ${failure.phase}, code ${failure.code})`,
        )
        .join("; ")}.`,
    );
    this.name = "ManagedProcessFinalizationError";
    this.failures = failures;
  }
}

interface StartProcessOptions {
  service: DiscoveredService;
  executionPlan: ProviderExecutionPlan;
  sharedGlobalEnv?: Record<string, string>;
  resolvedPorts?: Record<string, number>;
  secureEnv?: Record<string, string>;
  variableResolution?: ServiceVariableResolutionOptions;
  workspaceRoot?: string;
  runtimeGenerationId?: string | null;
  runtimeInstanceId?: string | null;
  allocationRevision?: string | null;
  verifyBeforeSpawn?: () => Promise<readonly ManagedLaunchFileBinding[] | void>;
  guardedExecutableLaunch?: boolean;
  onExit?: (payload: {
    service: DiscoveredService;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    wasStopping: boolean;
  }) => Promise<void> | void;
}

interface ManagedLaunchFileBinding {
  file: string;
  sha256: string;
  size: number;
}

function sameManagedLaunchFileBindings(
  left: readonly ManagedLaunchFileBinding[],
  right: readonly ManagedLaunchFileBinding[],
): boolean {
  return (
    left.length === right.length &&
    left.every((binding, index) => {
      const candidate = right[index];
      return (
        candidate !== undefined &&
        normalizeWindowsLaunchPath(binding.file) ===
          normalizeWindowsLaunchPath(candidate.file) &&
        binding.sha256 === candidate.sha256 &&
        binding.size === candidate.size
      );
    })
  );
}

interface AdoptManagedProcessOptions {
  service: DiscoveredService;
  pid: number;
  startedAt: string;
  command: string;
  workspaceRoot: string;
}

const managedProcesses = new Map<string, ManagedProcessRecord>();
const managedProcessFinalizers = new Map<
  string,
  { pid: number | null; promise: Promise<void>; workspaceRoot: string | null }
>();
const adoptedProcesses = new Map<string, AdoptedProcessRecord>();

type WorkspaceServiceKey = string;

function workspaceServiceKey(
  serviceId: string,
  workspaceRoot?: string | null,
): WorkspaceServiceKey {
  const root = workspaceRoot === undefined ? getLifecycleWorkspaceRoot() : workspaceRoot;
  if (!root) return `<unscoped>\u0000${serviceId}`;
  const resolved = path.resolve(root);
  const normalized = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  return `${normalized}\u0000${serviceId}`;
}

/**
 * A service id alone has no termination authority once separate workspaces
 * manage that id.  Preserve legacy unscoped callers only while unambiguous.
 */
function resolveWorkspaceServiceKey(
  serviceId: string,
  workspaceRoot?: string | null,
): WorkspaceServiceKey | null {
  // Shutdown convergence carries an already-authorized composite key internally.
  if (
    managedProcesses.has(serviceId) ||
    adoptedProcesses.has(serviceId) ||
    managedProcessFinalizers.has(serviceId)
  ) {
    return serviceId;
  }
  if (workspaceRoot !== undefined || getLifecycleWorkspaceRoot()) {
    return workspaceServiceKey(serviceId, workspaceRoot);
  }
  const suffix = `\u0000${serviceId}`;
  const candidates = new Set(
    [...managedProcesses.keys(), ...adoptedProcesses.keys(), ...managedProcessFinalizers.keys()]
      .filter((key) => key.endsWith(suffix)),
  );
  if (candidates.size > 1) {
    throw new Error(`Workspace authority is required for service "${serviceId}".`);
  }
  return candidates.values().next().value ?? workspaceServiceKey(serviceId, null);
}
const workspaceFinalizationTails = new Map<string, Promise<void>>();
const managedProcessShutdownQuiescers = new Set<
  (serviceIds: ReadonlySet<string>) => Promise<void> | void
>();
const ADOPTED_PROCESS_POLL_INTERVAL_MS = 250;
const WINDOWS_TREE_MONITOR_INSPECTION_TIMEOUT_MS = 15_000;
const WINDOWS_TREE_MONITOR_REFRESH_DELAY_MS = 5_000;
const WINDOWS_TREE_MONITOR_RETRY_DELAY_MS = 5_000;
const UNEXPECTED_PROCESS_FINALIZATION_TIMEOUT_MS = 5_000;
const DEFAULT_MANAGED_PROCESS_STOP_TIMEOUT_MS = process.platform === "win32" ? 15_000 : 5_000;
const WINDOWS_MANAGED_LAUNCHER_PATH = fileURLToPath(new URL("./windows-managed-launcher-native.exe", import.meta.url));
const WINDOWS_MANAGED_LAUNCHER_BYTES = 141_824;
const WINDOWS_MANAGED_LAUNCHER_SHA256 = "401699f683f56e081236e550ab59c06f888929ec5e30588f4e27cce972d4364c";
const WINDOWS_MANAGED_LAUNCH_TIMEOUT_MS = 15_000;
const MANAGED_PROCESS_SPAWN_TIMEOUT_MS = 15_000;
const WINDOWS_MANAGED_LAUNCH_MAX_PAYLOAD_CHARACTERS = 32_768;
const WINDOWS_MANAGED_LAUNCH_MAX_TARGET_ENVIRONMENT_OVERRIDES = 128;
let windowsManagedLauncherPath = WINDOWS_MANAGED_LAUNCHER_PATH;
let managedProcessTreeTerminator = terminateOwnedProcessTree;
let managedProcessTreeMonitor = monitorManagedProcessTree;
let managedProcessRootInspector: (
  pid: number,
  options?: { deadlineMs?: number; signal?: AbortSignal },
) => Promise<ProcessInspection> = inspectProcess;
let managedWindowsTreeInspector = inspectWindowsProcessTree;
let managedProcessEnrollmentHook:
  ((child: ChildProcess) => Promise<void> | void) | null = null;
let managedProcessFilesBoundHook: (() => Promise<void> | void) | null = null;
let managedProcessAfterReleaseHook: (() => Promise<void> | void) | null = null;
let managedProcessLaunchStateRemover = removeWindowsManagedLaunchStateDirectory;
let managedProcessLaunchStateCreatedHook: (() => Promise<void> | void) | null =
  null;
let managedProcessPostResumeDelayMs = 0;
let managedProcessSpawner: typeof spawn = spawn;
let managedProcessSpawnTimeoutMs = MANAGED_PROCESS_SPAWN_TIMEOUT_MS;

export function setManagedProcessTreeTerminatorForTests(
  terminator: typeof terminateOwnedProcessTree | null,
): void {
  if (process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS !== "1") {
    throw new Error(
      "Managed process-tree test hooks require SERVICE_LASSO_ENABLE_TEST_HOOKS=1.",
    );
  }
  managedProcessTreeTerminator = terminator ?? terminateOwnedProcessTree;
}

export function setManagedProcessTreeMonitorForTests(
  monitor: typeof monitorManagedProcessTree | null,
): void {
  if (process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS !== "1") {
    throw new Error(
      "Managed process-tree test hooks require SERVICE_LASSO_ENABLE_TEST_HOOKS=1.",
    );
  }
  managedProcessTreeMonitor = monitor ?? monitorManagedProcessTree;
}

export function setManagedWindowsTreeInspectorForTests(
  inspector: typeof inspectWindowsProcessTree | null,
): void {
  if (process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS !== "1") {
    throw new Error(
      "Managed process-tree test hooks require SERVICE_LASSO_ENABLE_TEST_HOOKS=1.",
    );
  }
  managedWindowsTreeInspector = inspector ?? inspectWindowsProcessTree;
}

export function setManagedProcessRootInspectorForTests(
  inspector:
    | ((
        pid: number,
        options?: { deadlineMs?: number; signal?: AbortSignal },
      ) => Promise<ProcessInspection>)
    | null,
): void {
  if (process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS !== "1") {
    throw new Error(
      "Managed process-root test hooks require SERVICE_LASSO_ENABLE_TEST_HOOKS=1.",
    );
  }
  managedProcessRootInspector = inspector ?? inspectProcess;
}

export function setManagedProcessEnrollmentHookForTests(
  hook: ((child: ChildProcess) => Promise<void> | void) | null,
): void {
  if (process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS !== "1") {
    throw new Error(
      "Managed process-enrollment test hooks require SERVICE_LASSO_ENABLE_TEST_HOOKS=1.",
    );
  }
  managedProcessEnrollmentHook = hook;
}

export function setManagedProcessFilesBoundHookForTests(
  hook: (() => Promise<void> | void) | null,
): void {
  if (process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS !== "1") {
    throw new Error(
      "Managed file-binding test hooks require SERVICE_LASSO_ENABLE_TEST_HOOKS=1.",
    );
  }
  managedProcessFilesBoundHook = hook;
}

export function setManagedProcessAfterReleaseHookForTests(
  hook: (() => Promise<void> | void) | null,
): void {
  if (process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS !== "1") {
    throw new Error(
      "Managed post-release test hooks require SERVICE_LASSO_ENABLE_TEST_HOOKS=1.",
    );
  }
  managedProcessAfterReleaseHook = hook;
}

export function setManagedProcessLaunchStateRemoverForTests(
  remover: ((state: WindowsManagedLaunchState) => Promise<void>) | null,
): void {
  if (process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS !== "1") {
    throw new Error(
      "Managed launch-state removal test hooks require SERVICE_LASSO_ENABLE_TEST_HOOKS=1.",
    );
  }
  managedProcessLaunchStateRemover =
    remover ?? removeWindowsManagedLaunchStateDirectory;
}

export function setWindowsManagedLauncherPathForTests(
  launcherPath: string | null,
): void {
  if (process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS !== "1") {
    throw new Error(
      "Windows managed-launcher path hooks require SERVICE_LASSO_ENABLE_TEST_HOOKS=1.",
    );
  }
  windowsManagedLauncherPath = launcherPath ?? WINDOWS_MANAGED_LAUNCHER_PATH;
}

export function setManagedProcessLaunchStateCreatedHookForTests(
  hook: (() => Promise<void> | void) | null,
): void {
  if (process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS !== "1") {
    throw new Error(
      "Managed launch-state creation hooks require SERVICE_LASSO_ENABLE_TEST_HOOKS=1.",
    );
  }
  managedProcessLaunchStateCreatedHook = hook;
}

export function setManagedProcessPostResumeDelayForTests(
  delayMs: number | null,
): void {
  if (process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS !== "1") {
    throw new Error(
      "Managed post-resume delay hooks require SERVICE_LASSO_ENABLE_TEST_HOOKS=1.",
    );
  }
  const effectiveDelayMs = delayMs ?? 0;
  if (
    !Number.isInteger(effectiveDelayMs) ||
    effectiveDelayMs < 0 ||
    effectiveDelayMs > 1_000
  ) {
    throw new Error(
      "Managed post-resume delay hooks require an integer from 0 through 1000 milliseconds.",
    );
  }
  managedProcessPostResumeDelayMs = effectiveDelayMs;
}

export function setManagedProcessSpawnerForTests(
  spawner: typeof spawn | null,
): void {
  if (process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS !== "1") {
    throw new Error(
      "Managed process spawn test hooks require SERVICE_LASSO_ENABLE_TEST_HOOKS=1.",
    );
  }
  managedProcessSpawner = spawner ?? spawn;
}

export function setManagedProcessSpawnTimeoutForTests(
  timeoutMs: number | null,
): void {
  if (process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS !== "1") {
    throw new Error(
      "Managed process spawn-timeout test hooks require SERVICE_LASSO_ENABLE_TEST_HOOKS=1.",
    );
  }
  const effectiveTimeoutMs = timeoutMs ?? MANAGED_PROCESS_SPAWN_TIMEOUT_MS;
  if (
    !Number.isInteger(effectiveTimeoutMs) ||
    effectiveTimeoutMs < 1 ||
    effectiveTimeoutMs > MANAGED_PROCESS_SPAWN_TIMEOUT_MS
  ) {
    throw new Error(
      `Managed process spawn-timeout hooks require an integer from 1 through ${MANAGED_PROCESS_SPAWN_TIMEOUT_MS} milliseconds.`,
    );
  }
  managedProcessSpawnTimeoutMs = effectiveTimeoutMs;
}

export function registerManagedProcessShutdownQuiescer(
  quiescer: (serviceIds: ReadonlySet<string>) => Promise<void> | void,
): () => void {
  managedProcessShutdownQuiescers.add(quiescer);
  return () => managedProcessShutdownQuiescers.delete(quiescer);
}

function safeFinalizationErrorCode(error: unknown, fallback: string): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    const normalized = error.code.trim().toUpperCase();
    if (/^[A-Z0-9_]{1,64}$/.test(normalized)) {
      return normalized;
    }
  }
  if (
    error instanceof Error &&
    error.message.startsWith("Timed out waiting for workspace lifecycle lock:")
  ) {
    return "WORKSPACE_LOCK_TIMEOUT";
  }
  // Tree control deliberately keeps process identity details out of public
  // finalization errors. Retain the causal class when that fail-closed path
  // is responsible, without carrying a PID, command, path, or inspector text.
  if (error instanceof Error && error.message.startsWith("Cannot verify process ")) {
    return "PROCESS_IDENTITY_UNVERIFIABLE";
  }
  if (error instanceof Error && error.message.startsWith("Cannot control lifetime-filtered process tree ")) {
    return "FILTERED_TREE_ROOT_UNVERIFIABLE";
  }
  return fallback;
}

async function withSerializedWorkspaceFinalization<T>(
  workspaceRoot: string,
  action: () => Promise<T>,
): Promise<T> {
  const resolvedRoot = path.resolve(workspaceRoot);
  const key =
    process.platform === "win32" ? resolvedRoot.toLowerCase() : resolvedRoot;
  const prior = workspaceFinalizationTails.get(key) ?? Promise.resolve();
  let releaseTurn!: () => void;
  const turn = new Promise<void>((resolve) => {
    releaseTurn = resolve;
  });
  const tail = prior.catch(() => undefined).then(() => turn);
  workspaceFinalizationTails.set(key, tail);

  await prior.catch(() => undefined);
  try {
    return await action();
  } finally {
    releaseTurn();
    if (workspaceFinalizationTails.get(key) === tail) {
      workspaceFinalizationTails.delete(key);
    }
  }
}

function trackManagedProcessFinalizer(
  serviceId: string,
  pid: number | null,
  promise: Promise<void>,
  workspaceRoot: string | null,
): void {
  const key = workspaceServiceKey(serviceId, workspaceRoot);
  const tracked = { pid, promise, workspaceRoot };
  managedProcessFinalizers.set(key, tracked);
  const clearFinalizer = () => {
    if (managedProcessFinalizers.get(key) === tracked) {
      managedProcessFinalizers.delete(key);
    }
  };
  // Successful finalizers need no further observation. Failed finalizers stay
  // registered until a shutdown/start boundary consumes their safe failure.
  void promise.then(clearFinalizer, () => undefined);
}

export async function waitForManagedProcessFinalization(
  serviceId: string,
  deadlineMs?: number,
  workspaceRoot?: string | null,
): Promise<void> {
  const key = resolveWorkspaceServiceKey(serviceId, workspaceRoot);
  const finalizer = key ? managedProcessFinalizers.get(key) : undefined;
  if (!finalizer) {
    return;
  }

  try {
    await withProcessControlDeadline(async () => await finalizer.promise, {
      deadlineMs,
    });
  } catch (error) {
    // A deadline stops this waiter, not the finalizer itself. Keep the finalizer
    // registered so a later shutdown convergence pass still observes it.
    const reconciledStatus =
      isProcessControlDeadlineError(error) && finalizer.workspaceRoot
        ? await reconcileRegisteredProcess(
            finalizer.workspaceRoot,
            "service",
            serviceId,
          ).catch(() => "unknown_owner" as const)
        : null;
    if (
      (!isProcessControlDeadlineError(error) ||
        reconciledStatus === "not_running" ||
        reconciledStatus === "identity_mismatch") &&
      managedProcessFinalizers.get(key!) === finalizer
    ) {
      managedProcessFinalizers.delete(key!);
    }
    throw new ManagedProcessFinalizationError([
      {
        serviceId,
        pid: finalizer.pid,
        phase: "finalize",
        code: safeFinalizationErrorCode(error, "FINALIZER_FAILED"),
      },
    ]);
  }
}

async function prepareRuntimeLogStreams(
  serviceRoot: string,
  startedAt: string,
): Promise<{
  paths: ServiceRuntimeLogPaths;
  streams: ManagedProcessRecord["logStreams"];
}> {
  await archiveRuntimeLogs(serviceRoot);
  const paths = getServiceRuntimeLogPaths(
    serviceRoot,
    buildServiceRuntimeLogRunId(startedAt),
  );
  await mkdir(path.dirname(paths.logPath), { recursive: true });

  return {
    paths,
    streams: {
      combined: createWriteStream(paths.logPath, { flags: "w" }),
      stdout: createWriteStream(paths.stdoutPath, { flags: "w" }),
      stderr: createWriteStream(paths.stderrPath, { flags: "w" }),
    },
  };
}

async function closeWriteStream(stream: WriteStream): Promise<void> {
  if (stream.closed) {
    return;
  }

  await new Promise<void>((resolve) => {
    stream.end(() => resolve());
  });
}

async function closeRuntimeLogStreams(
  streams: ManagedProcessRecord["logStreams"],
): Promise<void> {
  await Promise.all([
    closeWriteStream(streams.combined),
    closeWriteStream(streams.stdout),
    closeWriteStream(streams.stderr),
  ]);
}

function writeCombinedLogEntry(
  stream: WriteStream,
  level: "stdout" | "stderr",
  message: string,
): void {
  stream.write(`${JSON.stringify({ level, message })}\n`);
}

function matchOutputVariable(pattern: string, line: string): string | null {
  const match = new RegExp(pattern).exec(line);
  return typeof match?.[1] === "string" ? match[1] : null;
}

async function persistOutputVariableMatches(
  record: ManagedProcessRecord,
  source: "stdout" | "stderr",
  line: string,
): Promise<void> {
  const outputVarRegex = record.service.manifest.outputvarregex;
  if (!outputVarRegex || Object.keys(outputVarRegex).length === 0) {
    return;
  }

  const matches = Object.entries(outputVarRegex)
    .map(
      ([name, pattern]) => [name, matchOutputVariable(pattern, line)] as const,
    )
    .filter((entry): entry is readonly [string, string] => entry[1] !== null);
  if (matches.length === 0) {
    return;
  }

  const matchedAt = new Date().toISOString();
  const current = getLifecycleState(record.service.manifest.id);
  const state = setLifecycleState(record.service.manifest.id, {
    ...current,
    runtime: {
      ...current.runtime,
      variables: {
        ...current.runtime.variables,
        ...Object.fromEntries(
          matches.map(([name, value]) => [
            name,
            {
              value,
              source,
              matchedAt,
            },
          ]),
        ),
      },
    },
  });

  await writeServiceState(record.service, state);
}

function captureOutputVariableMatches(
  record: ManagedProcessRecord,
  source: "stdout" | "stderr",
  line: string,
): void {
  record.variableCapturePromise = record.variableCapturePromise
    .then(() => persistOutputVariableMatches(record, source, line))
    .catch(() => undefined);
}

const WINDOWS_MANAGED_LAUNCHER_PROGRESS_PREFIX =
  "__SERVICE_LASSO_LAUNCHER_PROGRESS__:";

function filterWindowsManagedLauncherProgressLine(
  token: string | null,
  line: string,
  flushRemainder: boolean,
): {
  suppressed: boolean;
  phase: ManagedProcessStartFailurePhase | null;
  payloadFailureBoundary: Exclude<
    LauncherPayloadFailureBoundary,
    "unknown"
  > | null;
  invalidPayloadDiagnostic: boolean;
} {
  if (!line.startsWith(WINDOWS_MANAGED_LAUNCHER_PROGRESS_PREFIX)) {
    return {
      suppressed:
        flushRemainder &&
        line.length > 0 &&
        WINDOWS_MANAGED_LAUNCHER_PROGRESS_PREFIX.startsWith(line),
      phase: null,
      payloadFailureBoundary: null,
      invalidPayloadDiagnostic: false,
    };
  }
  const fields = line
    .slice(WINDOWS_MANAGED_LAUNCHER_PROGRESS_PREFIX.length)
    .split(":");
  const payloadRecord =
    fields[0] === "launcher_payload_validation" && fields.length !== 2;
  if (token === null || !/^[0-9a-f]{64}$/u.test(token)) {
    return {
      suppressed: true,
      phase: null,
      payloadFailureBoundary: null,
      invalidPayloadDiagnostic: payloadRecord,
    };
  }
  const phase = fields[0] as ManagedProcessStartFailurePhase;
  if (!WINDOWS_MANAGED_LAUNCHER_PROGRESS_PHASES.has(phase)) {
    return {
      suppressed: true,
      phase: null,
      payloadFailureBoundary: null,
      invalidPayloadDiagnostic: false,
    };
  }
  const boundary =
    fields.length === 3 && phase === "launcher_payload_validation"
      ? fields[1]
      : null;
  const validShape =
    fields.length === 2 ||
    (boundary !== null &&
      WINDOWS_MANAGED_LAUNCHER_PAYLOAD_FAILURE_BOUNDARIES.has(
        boundary as Exclude<LauncherPayloadFailureBoundary, "unknown">,
      ));
  const digest = fields.at(-1) ?? "";
  if (!validShape || !/^[0-9a-f]{64}$/u.test(digest)) {
    return {
      suppressed: true,
      phase: null,
      payloadFailureBoundary: null,
      invalidPayloadDiagnostic: phase === "launcher_payload_validation",
    };
  }
  const authenticatedRecord =
    boundary === null ? phase : `${phase}:${boundary}`;
  const expected = createHmac("sha256", token)
    .update(authenticatedRecord, "utf8")
    .digest();
  const actual = Buffer.from(digest, "hex");
  const authenticated =
    actual.length === expected.length && timingSafeEqual(actual, expected);
  return {
    suppressed: true,
    phase: authenticated ? phase : null,
    payloadFailureBoundary: authenticated
      ? (boundary as Exclude<LauncherPayloadFailureBoundary, "unknown"> | null)
      : null,
    invalidPayloadDiagnostic:
      phase === "launcher_payload_validation" && !authenticated,
  };
}

export function filterWindowsManagedLauncherProgressLineForTests(
  token: string | null,
  line: string,
  flushRemainder = false,
): {
  suppressed: boolean;
  phase: ManagedProcessStartFailurePhase | null;
  payloadFailureBoundary: Exclude<
    LauncherPayloadFailureBoundary,
    "unknown"
  > | null;
  invalidPayloadDiagnostic: boolean;
} {
  if (process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS !== "1") {
    throw new Error(
      "Managed launcher-progress test hooks require SERVICE_LASSO_ENABLE_TEST_HOOKS=1.",
    );
  }
  return filterWindowsManagedLauncherProgressLine(token, line, flushRemainder);
}

function attachRuntimeLogCapture(record: ManagedProcessRecord): void {
  const waitForOutputEnd = (
    stream: NonNullable<ChildProcess["stdout"]>,
  ): Promise<void> =>
    new Promise((resolve) => {
      // Subscribe before inspecting terminal state. A launcher can exit before
      // its final authenticated stderr record reaches Node, so a check followed
      // by subscription would lose the only safe diagnostic receipt.
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        stream.removeListener("end", settle);
        stream.removeListener("close", settle);
        stream.removeListener("error", settle);
        resolve();
      };
      stream.once("end", settle);
      stream.once("close", settle);
      stream.once("error", settle);
      if (stream.readableEnded || stream.destroyed) settle();
    });
  const outputEnded = Promise.all([
    record.child.stdout
      ? waitForOutputEnd(record.child.stdout)
      : Promise.resolve(),
    record.child.stderr
      ? waitForOutputEnd(record.child.stderr)
      : Promise.resolve(),
  ]);
  const flushBufferedLines = (
    level: "stdout" | "stderr",
    flushRemainder = false,
  ) => {
    const bufferKey = level === "stdout" ? "stdoutBuffer" : "stderrBuffer";
    const outputStream =
      level === "stdout" ? record.logStreams.stdout : record.logStreams.stderr;
    const normalized = record[bufferKey].replace(/\r\n/g, "\n");
    const parts = normalized.split("\n");
    const remainder = flushRemainder ? "" : (parts.pop() ?? "");

    for (const line of parts) {
      const launcherProgress =
        level === "stderr"
          ? filterWindowsManagedLauncherProgressLine(
              record.launcherProgressToken,
              line,
              flushRemainder,
            )
          : {
              suppressed: false,
              phase: null,
              payloadFailureBoundary: null,
              invalidPayloadDiagnostic: false,
            };
      if (launcherProgress.phase !== null) {
        record.launcherProgressPhase = launcherProgress.phase;
      }
      if (launcherProgress.payloadFailureBoundary !== null) {
        record.launcherPayloadDiagnosticCount += 1;
        if (record.launcherPayloadDiagnosticCount === 1)
          record.launcherPayloadFailureBoundary =
            launcherProgress.payloadFailureBoundary;
        else record.launcherPayloadDiagnosticInvalid = true;
      }
      if (launcherProgress.invalidPayloadDiagnostic)
        record.launcherPayloadDiagnosticInvalid = true;
      if (launcherProgress.suppressed) {
        continue;
      }
      outputStream.write(`${line}\n`);
      writeCombinedLogEntry(record.logStreams.combined, level, line);
      captureOutputVariableMatches(record, level, line);
    }

    record[bufferKey] = remainder;
  };

  record.child.stdout?.setEncoding("utf8");
  record.child.stderr?.setEncoding("utf8");

  record.child.stdout?.on("data", (chunk: string) => {
    record.stdoutBuffer += chunk;
    flushBufferedLines("stdout");
  });

  record.child.stderr?.on("data", (chunk: string) => {
    record.stderrBuffer += chunk;
    flushBufferedLines("stderr");
  });

  record.logCapturePromise = record.exitPromise.then(async () => {
    await outputEnded;
    flushBufferedLines("stdout", true);
    flushBufferedLines("stderr", true);
    await record.variableCapturePromise;
    await closeRuntimeLogStreams(record.logStreams);
  });
  record.finalizePromise = record.logCapturePromise;
}

function resolveExecutable(
  service: DiscoveredService,
  executionPlan: ProviderExecutionPlan,
): string {
  const executable = executionPlan.executable;
  const commandRoot = executionPlan.commandRoot ?? service.serviceRoot;

  if (
    executionPlan.commandRoot &&
    (path.isAbsolute(executable) ||
      executable.startsWith(".") ||
      executable.includes("/") ||
      executable.includes("\\"))
  ) {
    return path.resolve(commandRoot, executable);
  }

  return executable;
}

function resolveWorkingDirectory(
  service: DiscoveredService,
  _executionPlan: ProviderExecutionPlan,
  _executable: string,
): string {
  return service.serviceRoot;
}

function isRelativePathLikeArgument(candidate: string): boolean {
  return (
    candidate.length > 0 &&
    !candidate.startsWith("-") &&
    !/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate) &&
    (candidate.startsWith(".") ||
      candidate.includes("/") ||
      candidate.includes("\\"))
  );
}

function resolveCommandRootArgument(commandRoot: string, arg: string): string {
  if (path.isAbsolute(arg)) {
    return arg;
  }

  if (isRelativePathLikeArgument(arg)) {
    return path.resolve(commandRoot, arg);
  }

  const equalsIndex = arg.indexOf("=");
  if (equalsIndex > 0) {
    const option = arg.slice(0, equalsIndex + 1);
    const value = arg.slice(equalsIndex + 1);
    if (value.startsWith(".") && !path.isAbsolute(value)) {
      return `${option}${path.resolve(commandRoot, value)}`;
    }
  }

  return arg;
}

function resolveCommandRootArgs(
  service: DiscoveredService,
  executionPlan: ProviderExecutionPlan,
  args: string[],
): string[] {
  const commandRoot = executionPlan.commandRoot;
  if (!commandRoot || selectPlatformCommandline(service.manifest.commandline)) {
    return args;
  }

  return args.map((arg) => resolveCommandRootArgument(commandRoot, arg));
}

function buildCommandString(executable: string, args: string[]): string {
  return [executable, ...args].join(" ");
}

interface WindowsManagedLaunchState {
  rootPath: string;
  gatePath: string;
  filesBoundPath: string;
  continuePath: string;
  ackPath: string;
  releaseToken: string;
  filesBoundToken: string;
  continueToken: string;
  ackToken: string;
  progressToken: string;
  launcherExecutable: string;
  environment: NodeJS.ProcessEnv;
}

async function assertWindowsManagedLauncherIntegrity(
  launcherExecutable: string,
  signal: AbortSignal,
): Promise<void> {
  let launcherBytes: Buffer | null = null;
  signal.throwIfAborted();
  const [beforeOpen, canonicalPath] = await Promise.all([
    lstat(launcherExecutable),
    realpath(launcherExecutable),
  ]);
  signal.throwIfAborted();
  if (
    !beforeOpen.isFile() ||
    beforeOpen.isSymbolicLink() ||
    beforeOpen.size !== WINDOWS_MANAGED_LAUNCHER_BYTES ||
    normalizeWindowsLaunchPath(canonicalPath) !==
      normalizeWindowsLaunchPath(path.resolve(launcherExecutable))
  ) {
    throw new Error("Windows managed launcher asset identity was invalid.");
  }
  const handle = await open(launcherExecutable, constants.O_RDONLY);
  try {
    signal.throwIfAborted();
    const afterOpen = await handle.stat();
    signal.throwIfAborted();
    if (
      !afterOpen.isFile() ||
      afterOpen.size !== WINDOWS_MANAGED_LAUNCHER_BYTES
    ) {
      throw new Error(
        "Windows managed launcher asset identity changed while opening.",
      );
    }
    launcherBytes = await handle.readFile({ signal });
    signal.throwIfAborted();
    const afterRead = await handle.stat();
    signal.throwIfAborted();
    if (
      !afterRead.isFile() ||
      afterRead.size !== WINDOWS_MANAGED_LAUNCHER_BYTES ||
      launcherBytes.byteLength !== WINDOWS_MANAGED_LAUNCHER_BYTES ||
      createHash("sha256").update(launcherBytes).digest("hex") !==
        WINDOWS_MANAGED_LAUNCHER_SHA256
    ) {
      throw new Error(
        "Windows managed launcher asset integrity verification failed.",
      );
    }
  } finally {
    launcherBytes?.fill(0);
    await handle.close().catch(() => undefined);
  }
}

async function verifyWindowsManagedLauncherIntegrity(
  launcherExecutable: string,
): Promise<void> {
  const deadlineMs = processControlDeadline(WINDOWS_MANAGED_LAUNCH_TIMEOUT_MS);
  await withProcessControlDeadline(
    async (signal) =>
      await assertWindowsManagedLauncherIntegrity(launcherExecutable, signal),
    { deadlineMs },
  );
}

function normalizeWindowsLaunchPath(value: string): string {
  return path.win32.normalize(value.replaceAll("/", "\\")).toLowerCase();
}

function isWindowsLoaderSensitiveEnvironmentName(name: string): boolean {
  const normalized = name.toUpperCase();
  return (
    normalized.startsWith("COR_") ||
    normalized.startsWith("CORECLR_") ||
    normalized.startsWith("COMPLUS_") ||
    normalized.startsWith("APPDOMAIN_MANAGER")
  );
}

function splitWindowsManagedLaunchEnvironment(environment: NodeJS.ProcessEnv): {
  bootstrapEnvironment: NodeJS.ProcessEnv;
  targetEnvironmentOverrides: Array<{ name: string; value: string }>;
} {
  const bootstrapEnvironment = { ...environment };
  const targetEnvironmentOverrides: Array<{ name: string; value: string }> = [];
  const overrideNames = new Set<string>();
  for (const [name, value] of Object.entries(environment)) {
    if (!isWindowsLoaderSensitiveEnvironmentName(name)) continue;
    delete bootstrapEnvironment[name];
    if (typeof value !== "string") continue;
    const normalizedName = name.toUpperCase();
    if (overrideNames.has(normalizedName)) {
      throw new Error(
        "Windows target environment contains ambiguous loader-sensitive names.",
      );
    }
    overrideNames.add(normalizedName);
    targetEnvironmentOverrides.push({ name, value });
  }
  if (
    targetEnvironmentOverrides.length >
    WINDOWS_MANAGED_LAUNCH_MAX_TARGET_ENVIRONMENT_OVERRIDES
  ) {
    throw new Error(
      "Windows target environment contains too many loader-sensitive entries.",
    );
  }
  return { bootstrapEnvironment, targetEnvironmentOverrides };
}

function windowsPathEnvironmentValue(environment: NodeJS.ProcessEnv): string {
  return (
    Object.entries(environment).find(
      ([key]) => key.toLowerCase() === "path",
    )?.[1] ?? ""
  );
}

async function resolveWindowsExecutableCandidate(
  executable: string,
  workingDirectory: string,
  environment: NodeJS.ProcessEnv,
): Promise<string | null> {
  const pathExt =
    Object.entries(environment).find(
      ([key]) => key.toLowerCase() === "pathext",
    )?.[1] ??
    process.env.PATHEXT ??
    ".COM;.EXE;.BAT;.CMD";
  const extensions = path.win32.extname(executable)
    ? [""]
    : ["", ...pathExt.split(";").filter(Boolean)];
  const pathLike =
    path.win32.isAbsolute(executable) ||
    executable.startsWith(".") ||
    executable.includes("/") ||
    executable.includes("\\");
  const roots = pathLike
    ? [workingDirectory]
    : [
        workingDirectory,
        ...windowsPathEnvironmentValue(environment)
          .split(";")
          .map((entry) => entry.replace(/^"|"$/gu, ""))
          .filter(Boolean),
      ];
  for (const root of roots) {
    for (const extension of extensions) {
      const candidate = path.win32.isAbsolute(executable)
        ? path.win32.normalize(`${executable}${extension}`)
        : path.win32.resolve(root, `${executable}${extension}`);
      try {
        if ((await stat(candidate)).isFile()) {
          return candidate;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
    }
  }
  return null;
}

function windowsArgumentFileCandidate(
  argument: string,
  workingDirectory: string,
): {
  candidate: string;
  prefix: string;
} | null {
  const equalsIndex = argument.indexOf("=");
  const value = equalsIndex > 0 ? argument.slice(equalsIndex + 1) : argument;
  if (
    !value ||
    (equalsIndex < 0 && value.startsWith("-")) ||
    /^[a-z][a-z0-9+.-]*:\/\//iu.test(value)
  ) {
    return null;
  }
  return {
    candidate: path.win32.isAbsolute(value)
      ? path.win32.normalize(value)
      : path.win32.resolve(workingDirectory, value),
    prefix: equalsIndex > 0 ? argument.slice(0, equalsIndex + 1) : "",
  };
}

async function createWindowsManagedLaunchState(
  executable: string,
  args: string[],
  workingDirectory: string,
  environment: NodeJS.ProcessEnv,
  approvedFiles: readonly ManagedLaunchFileBinding[],
  workspaceRoot: string,
  requireExecutableBinding: boolean,
): Promise<WindowsManagedLaunchState> {
  const launcherExecutable = windowsManagedLauncherPath;
  await verifyWindowsManagedLauncherIntegrity(launcherExecutable);
  const { bootstrapEnvironment, targetEnvironmentOverrides } =
    splitWindowsManagedLaunchEnvironment(environment);
  const launchStateRoot = path.join(
    workspaceRoot,
    ".service-lasso",
    "runtime",
    "managed-launch",
  );
  await mkdir(launchStateRoot, { recursive: true });
  const rootPath = await mkdtemp(
    path.join(launchStateRoot, "service-lasso-managed-launch-"),
  );
  const gatePath = path.join(rootPath, "release.gate");
  const filesBoundPath = path.join(rootPath, "files-bound.gate");
  const continuePath = path.join(rootPath, "continue.gate");
  const ackPath = path.join(rootPath, "launched.pid");
  const releaseToken = randomBytes(32).toString("hex");
  const filesBoundToken = randomBytes(32).toString("hex");
  const continueToken = randomBytes(32).toString("hex");
  const ackToken = randomBytes(32).toString("hex");
  const progressToken = randomBytes(32).toString("hex");
  const bindingIndexByPath = new Map(
    approvedFiles.map((binding, index) => [
      normalizeWindowsLaunchPath(binding.file),
      index,
    ]),
  );
  const executableCandidate = await resolveWindowsExecutableCandidate(
    executable,
    workingDirectory,
    environment,
  );
  const executableBindingIndex =
    executableCandidate === null
      ? -1
      : (bindingIndexByPath.get(
          normalizeWindowsLaunchPath(executableCandidate),
        ) ?? -1);
  const argumentBindings = args.flatMap((argument, index) => {
    const file = windowsArgumentFileCandidate(argument, workingDirectory);
    if (!file) {
      return [];
    }
    const bindingIndex = bindingIndexByPath.get(
      normalizeWindowsLaunchPath(file.candidate),
    );
    return bindingIndex === undefined
      ? []
      : [{ index, prefix: file.prefix, bindingIndex }];
  });
  const payload = Buffer.from(
    JSON.stringify({
      executable: executableCandidate ?? executable,
      args,
      workingDirectory,
      ackPath,
      filesBoundPath,
      continuePath,
      releaseToken,
      filesBoundToken,
      continueToken,
      ackToken,
      approvedFiles,
      executableBindingIndex,
      requireExecutableBinding,
      argumentBindings,
      targetEnvironmentOverrides,
      postResumeDelayMilliseconds: managedProcessPostResumeDelayMs,
    }),
    "utf8",
  ).toString("base64");
  if (payload.length > WINDOWS_MANAGED_LAUNCH_MAX_PAYLOAD_CHARACTERS) {
    throw new Error("Windows managed launcher payload was oversized.");
  }
  return {
    rootPath,
    gatePath,
    filesBoundPath,
    continuePath,
    ackPath,
    releaseToken,
    filesBoundToken,
    continueToken,
    ackToken,
    progressToken,
    launcherExecutable,
    environment: {
      ...bootstrapEnvironment,
      SERVICE_LASSO_MANAGED_LAUNCH_PAYLOAD: payload,
      SERVICE_LASSO_MANAGED_LAUNCH_GATE: gatePath,
      SERVICE_LASSO_MANAGED_LAUNCH_PROGRESS_TOKEN: progressToken,
    },
  };
}

async function removeWindowsManagedLaunchStateDirectory(
  state: WindowsManagedLaunchState,
): Promise<void> {
  await rm(state.rootPath, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 50,
  });
}

async function removeWindowsManagedLaunchState(
  state: WindowsManagedLaunchState | null,
): Promise<void> {
  if (state) {
    await managedProcessLaunchStateRemover(state);
  }
}

const WINDOWS_MANAGED_LAUNCHER_PROGRESS_PHASES =
  new Set<ManagedProcessStartFailurePhase>([
    "launcher_initialization",
    "launcher_native_asset_validation",
    "launcher_payload_validation",
    "launcher_gate_observation",
    "launcher_file_open",
    "launcher_file_hash",
    "launcher_file_final_path",
    "launcher_binding_publication",
  ]);
const WINDOWS_MANAGED_LAUNCHER_PAYLOAD_FAILURE_BOUNDARIES = new Set<
  Exclude<LauncherPayloadFailureBoundary, "unknown">
>([
  "launch_evidence",
  "canonical_encoding",
  "strict_utf8",
  "json_or_schema",
  "semantic_payload",
]);

async function bindWindowsManagedLauncherFiles(
  child: ChildProcess,
  state: WindowsManagedLaunchState,
  launcherProgressPhase: (deadlineMs: number) =>
    | {
        phase: ManagedProcessStartFailurePhase | null;
        payloadFailureBoundary: LauncherPayloadFailureBoundary;
      }
    | Promise<{
        phase: ManagedProcessStartFailurePhase | null;
        payloadFailureBoundary: LauncherPayloadFailureBoundary;
      }>,
): Promise<void> {
  const deadlineMs = processControlDeadline(WINDOWS_MANAGED_LAUNCH_TIMEOUT_MS);
  try {
    await withProcessControlDeadline(
      async (signal) => {
        await writeFile(state.gatePath, state.releaseToken, "utf8");
        while (!signal.aborted) {
          if (probeManagedChildHandle(child) !== "owned") {
            throw new Error(
              "Windows managed launcher exited before executable files were bound.",
            );
          }
          try {
            const token = (await readFile(state.filesBoundPath, "utf8")).trim();
            if (token === state.filesBoundToken) {
              break;
            }
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
              throw error;
            }
          }
          await adoptedProcessPollDelay(signal, 25);
        }
      },
      { deadlineMs },
    );
  } catch (error) {
    const progress = await launcherProgressPhase(deadlineMs);
    throw progress.phase
      ? new ManagedProcessStartError(
          progress.phase,
          error,
          progress.payloadFailureBoundary,
        )
      : error;
  }
}

async function settleWindowsManagedLauncherStderr(
  child: ChildProcess,
  deadlineMs: number,
): Promise<void> {
  const stderr = child.stderr;
  if (!stderr || remainingProcessControlMs(deadlineMs) <= 0) return;
  await withProcessControlDeadline(
    async (signal) => {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const complete = () => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve();
        };
        const abort = () => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(signal.reason);
        };
        const cleanup = () => {
          stderr.removeListener("end", complete);
          stderr.removeListener("close", complete);
          stderr.removeListener("error", complete);
          signal.removeEventListener("abort", abort);
        };
        stderr.once("end", complete);
        stderr.once("close", complete);
        stderr.once("error", complete);
        signal.addEventListener("abort", abort, { once: true });
        // This terminal observation must follow listener installation so an
        // exit between the original check and subscription cannot strand the
        // authenticated parser behind a closed log stream.
        if (stderr.readableEnded || stderr.destroyed) complete();
      });
    },
    { deadlineMs },
  );
}

async function continueWindowsManagedLauncher(
  child: ChildProcess,
  state: WindowsManagedLaunchState,
): Promise<void> {
  const deadlineMs = processControlDeadline(WINDOWS_MANAGED_LAUNCH_TIMEOUT_MS);
  await withProcessControlDeadline(
    async (signal) => {
      await managedProcessFilesBoundHook?.();
      await writeFile(state.continuePath, state.continueToken, "utf8");
      while (!signal.aborted) {
        const wrapperStatus = probeManagedChildHandle(child);
        if (wrapperStatus !== "owned") {
          const exitCode = await observeManagedLauncherExitCode(child, signal);
          const failurePhase =
            windowsManagedLauncherTargetFailurePhase(exitCode);
          throw new ManagedProcessStartError(
            failurePhase ?? "target_acknowledgement",
            new Error(
              failurePhase
                ? `Windows managed launcher failed closed during ${failurePhase} (exit ${exitCode}).`
                : `Windows managed launcher exited before the service launch was acknowledged (exit ${exitCode ?? "unavailable"}).`,
            ),
          );
        }
        try {
          const acknowledgmentText = await readFile(state.ackPath, "utf8");
          try {
            const acknowledgment = JSON.parse(acknowledgmentText) as {
              token?: unknown;
              pid?: unknown;
            };
            if (
              acknowledgment.token === state.ackToken &&
              Number.isInteger(acknowledgment.pid) &&
              Number(acknowledgment.pid) > 0
            ) {
              return;
            }
          } catch {
            // A pre-created or partially written acknowledgement is not authority.
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw error;
          }
        }
        await adoptedProcessPollDelay(signal, 25);
      }
    },
    { deadlineMs },
  );
}

async function observeManagedLauncherExitCode(
  child: ChildProcess,
  signal: AbortSignal,
): Promise<number | null> {
  if (child.exitCode !== null) return child.exitCode;
  return await new Promise<number | null>((resolve) => {
    const exited = (exitCode: number | null) => {
      cleanup();
      resolve(exitCode);
    };
    const aborted = () => {
      cleanup();
      resolve(child.exitCode);
    };
    const cleanup = () => {
      child.removeListener("exit", exited);
      signal.removeEventListener("abort", aborted);
    };
    child.once("exit", exited);
    signal.addEventListener("abort", aborted, { once: true });
    if (child.exitCode !== null || signal.aborted) aborted();
  });
}

function windowsManagedLauncherTargetFailurePhase(
  exitCode: number | null,
): ManagedProcessStartFailurePhase | null {
  switch (exitCode) {
    case 101:
      return "launcher_job_creation";
    case 102:
    case 107:
    case 108:
    case 109:
    case 110:
    case 111:
    case 112:
    case 113:
    case 114:
      return "launcher_target_creation";
    case 103:
      return "launcher_job_assignment";
    case 104:
      return "launcher_target_resume";
    case 105:
      return "launcher_target_thread_close";
    case 106:
      return "launcher_acknowledgement_write";
    default:
      return null;
  }
}

function buildProcessEnvironment(
  service: DiscoveredService,
  executionPlan: ProviderExecutionPlan,
  sharedGlobalEnv: Record<string, string> = {},
  resolvedPorts: Record<string, number> = {},
  secureEnv: Record<string, string> = {},
  variableResolution: ServiceVariableResolutionOptions = {},
): NodeJS.ProcessEnv {
  const serviceVariables = Object.fromEntries(
    buildServiceVariables(
      service,
      sharedGlobalEnv,
      resolvedPorts,
      variableResolution,
    ).variables.map((entry) => [entry.key, entry.value]),
  );

  return {
    ...process.env,
    ...executionPlan.providerEnv,
    ...serviceVariables,
    ...secureEnv,
  };
}

export interface ResolvedManagedProcessLaunch {
  executable: string;
  args: string[];
  workingDirectory: string;
  environment: NodeJS.ProcessEnv;
}

/**
 * Resolve the exact launch tuple consumed by spawn. Guarded-action executable
 * evidence uses this same resolver so confirmation cannot describe a
 * different command-root interpretation than the process supervisor.
 */
export function resolveManagedProcessLaunch(
  service: DiscoveredService,
  executionPlan: ProviderExecutionPlan,
  sharedGlobalEnv: Record<string, string> = {},
  resolvedPorts: Record<string, number> = {},
  secureEnv: Record<string, string> = {},
  variableResolution: ServiceVariableResolutionOptions = {},
): ResolvedManagedProcessLaunch {
  const executable = resolveExecutable(service, executionPlan);
  const workingDirectory = resolveWorkingDirectory(
    service,
    executionPlan,
    executable,
  );
  const args = resolveCommandRootArgs(
    service,
    executionPlan,
    resolveExecutionArgs(
      service,
      executionPlan,
      sharedGlobalEnv,
      resolvedPorts,
      variableResolution,
    ),
  );
  return {
    executable,
    args,
    workingDirectory,
    environment: buildProcessEnvironment(
      service,
      executionPlan,
      sharedGlobalEnv,
      resolvedPorts,
      secureEnv,
      variableResolution,
    ),
  };
}

export function hasManagedProcess(serviceId: string, workspaceRoot?: string | null): boolean {
  const key = resolveWorkspaceServiceKey(serviceId, workspaceRoot);
  return Boolean(key && (managedProcesses.has(key) || adoptedProcesses.has(key)));
}

export interface ManagedStdinInspection {
  writable: boolean;
}

export type ManagedStdinWriteResult =
  | { ok: true; byteLength: number; newlineAppended: boolean }
  | {
      ok: false;
      code: "not_running" | "no_pipe" | "write_failed";
      message: string;
    };

/**
 * Inspect whether the live managed process still has a writable stdin pipe.
 * Adopted processes never expose a pipe.
 */
export function inspectManagedStdin(serviceId: string, workspaceRoot?: string | null): ManagedStdinInspection {
  const key = resolveWorkspaceServiceKey(serviceId, workspaceRoot);
  const record = key ? managedProcesses.get(key) : undefined;
  const authorityServiceId = record?.service.manifest.id ?? serviceId;
  const stdin = record?.child.stdin;
  return {
    writable: Boolean(
      record && !record.stopping && stdin && !stdin.destroyed && stdin.writable,
    ),
  };
}

/**
 * Write a bounded UTF-8 line to the managed process stdin pipe.
 * Does not spawn a shell or PTY; the service owns command interpretation.
 */
export async function writeManagedProcessStdin(
  serviceId: string,
  input: string,
  workspaceRoot?: string | null,
): Promise<ManagedStdinWriteResult> {
  const key = resolveWorkspaceServiceKey(serviceId, workspaceRoot);
  const record = key ? managedProcesses.get(key) : undefined;
  if (!record || record.stopping) {
    return {
      ok: false,
      code: "not_running",
      message: "The managed process is not running.",
    };
  }

  const stdin = record.child.stdin;
  if (!stdin || stdin.destroyed || !stdin.writable) {
    return {
      ok: false,
      code: "no_pipe",
      message: "No live stdin pipe is attached to this service.",
    };
  }

  const newlineAppended = !input.endsWith("\n");
  const payload = newlineAppended ? `${input}\n` : input;
  const byteLength = Buffer.byteLength(payload, "utf8");

  try {
    await new Promise<void>((resolve, reject) => {
      stdin.write(payload, "utf8", (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  } catch {
    return {
      ok: false,
      code: "write_failed",
      message: "Runtime stdin write failed.",
    };
  }

  return {
    ok: true,
    byteLength,
    newlineAppended,
  };
}

function serviceEnablesStdin(service: DiscoveredService): boolean {
  return service.manifest.stdin?.enabled === true;
}

async function waitForManagedProcessSpawn(child: ChildProcess): Promise<void> {
  const deadlineMs = processControlDeadline(managedProcessSpawnTimeoutMs);
  await withProcessControlDeadline(
    async (signal) =>
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          child.removeListener("spawn", spawned);
          child.removeListener("error", failed);
          signal.removeEventListener("abort", aborted);
        };
        const spawned = () => {
          cleanup();
          resolve();
        };
        const failed = (error: Error) => {
          cleanup();
          reject(error);
        };
        const aborted = () => {
          cleanup();
          reject(
            new Error(
              "Managed process wrapper did not emit spawn or error before its deadline.",
            ),
          );
        };
        child.once("spawn", spawned);
        child.once("error", failed);
        signal.addEventListener("abort", aborted, { once: true });
        if (signal.aborted) aborted();
      }),
    { deadlineMs },
  );
}

async function containUnenrolledManagedProcessWrapper(
  child: ChildProcess | null,
  exitPromise: Promise<{
    exitCode: number | null;
    signal: NodeJS.Signals | null;
  }> | null,
): Promise<void> {
  if (
    !child ||
    !exitPromise ||
    child.exitCode !== null ||
    child.signalCode !== null ||
    !Number.isInteger(child.pid) ||
    Number(child.pid) <= 0
  ) {
    return;
  }
  if (!child.kill("SIGKILL")) {
    throw new Error(
      "Managed process wrapper could not be terminated after spawn failed or timed out.",
    );
  }
  const deadlineMs = processControlDeadline(5_000);
  await withProcessControlDeadline(async () => await exitPromise, {
    deadlineMs,
  });
}

function probeManagedChildHandle(
  child: ChildProcess,
): "owned" | "exited" | "unverifiable" {
  if (child.exitCode !== null || child.signalCode !== null) {
    return "exited";
  }
  let probeError = false;
  const captureProbeError = () => {
    probeError = true;
  };
  child.prependOnceListener("error", captureProbeError);
  try {
    // ChildProcess.kill(0) probes the exact native process handle retained by
    // Node, so a reused numeric PID cannot authorize ownership or taskkill.
    const alive = child.kill(0);
    return probeError ? "unverifiable" : alive ? "owned" : "exited";
  } catch {
    return "unverifiable";
  } finally {
    child.removeListener("error", captureProbeError);
  }
}

function mergeProcessFingerprints(
  ...groups: ProcessFingerprint[][]
): ProcessFingerprint[] {
  const byPid = new Map<number, ProcessFingerprint>();
  for (const identity of groups.flat()) {
    byPid.set(identity.pid, identity);
  }
  return [...byPid.values()];
}

function unionProcessFingerprints(
  ...groups: readonly ProcessFingerprint[][]
): ProcessFingerprint[] {
  const members = new Map<string, ProcessFingerprint>();
  for (const identity of groups.flat()) {
    // Preserve conflicting lifetimes for one PID.  The fresh identity probe
    // below must classify the prior identity as mismatched instead of allowing
    // a later tree row to replace it.
    members.set(
      [
        identity.pid,
        identity.createdAt,
        identity.executablePath,
        identity.commandHash,
      ].join("\u0000"),
      identity,
    );
  }
  return [...members.values()];
}

async function verifyNativeAcknowledgementFinalContainment(
  record: ManagedProcessRecord,
  rootIdentity: ProcessFingerprint,
  deadlineMs: number,
  signal: AbortSignal,
): Promise<void> {
  // The final tree is a receipt for this acknowledgement, not a refresh of an
  // earlier snapshot.  Its root result and the retained ChildProcess handle
  // must independently agree that the managed wrapper exited.
  const finalTree = await managedWindowsTreeInspector(rootIdentity, {
    deadlineMs,
    signal,
  });
  if (finalTree.rootStatus !== "exited") {
    throw new Error("Native acknowledgement containment root has not exited.");
  }
  if (probeManagedChildHandle(record.child) !== "exited") {
    throw new Error(
      "Native acknowledgement containment wrapper has not exited.",
    );
  }

  const members = unionProcessFingerprints(
    record.knownTreeMembers,
    finalTree.members,
  );
  record.knownTreeMembers = members;
  for (const member of members) {
    const inspection = await managedProcessRootInspector(member.pid, {
      deadlineMs,
      signal,
    });
    if (inspection.status !== "not_running") {
      throw new Error("Native acknowledgement containment has not converged.");
    }
  }
}

function managedProcessTreeTarget(
  record: ManagedProcessRecord,
  rootExitObserved = false,
): OwnedProcessTreeTarget {
  return {
    rootPid: record.child.pid ?? 0,
    rootIdentity: record.rootIdentity,
    processGroup: record.processGroup,
    knownMembers: record.knownTreeMembers,
    verifiedMembersOnly: record.verifiedMembersOnly,
    rootExitObserved,
    rootOwnershipProbe: () => probeManagedChildHandle(record.child),
    forceImmediately: process.platform === "win32" && rootExitObserved,
  };
}

async function terminateManagedProcessTree(
  record: ManagedProcessRecord,
  timeoutMs: number,
  rootExitObserved = false,
  retryAfterSharedFailure = false,
  deadlineMs = record.stopDeadlineMs ?? processControlDeadline(timeoutMs),
): Promise<ProcessTreeTerminationResult> {
  let retryAvailable = retryAfterSharedFailure;
  while (true) {
    const existing = record.treeTerminationPromise;
    if (existing) {
      try {
        return await withProcessControlDeadline(async () => await existing, {
          deadlineMs,
        });
      } catch (error) {
        if (record.treeTerminationPromise === existing) {
          record.treeTerminationPromise = null;
        }
        if (!retryAvailable) {
          throw error;
        }
        retryAvailable = false;
        continue;
      }
    }

    const attempt = (async () => {
      // The aborted monitor may still be returning from a native inspection.
      // It only reads and refreshes a snapshot; termination must retain the
      // full caller-owned deadline rather than wait for that work to unwind.
      return await withProcessControlDeadline(
        async (signal) => {
          const dependencies: Parameters<
            typeof managedProcessTreeTerminator
          >[2] = { deadlineMs, signal };
          if (
            process.platform === "win32" &&
            (rootExitObserved || record.verifiedMembersOnly) &&
            record.rootIdentity &&
            record.knownTreeMembers.length > 0
          ) {
            const snapshot = await inspectKnownWindowsTreeMembers(
              record.rootIdentity,
              record.knownTreeMembers,
              deadlineMs,
              signal,
              record.verifiedMembersOnly,
              {
                inspectTree: managedWindowsTreeInspector,
                excludedMemberPids: record.excludedTreeMemberPids,
              },
            );
            record.verifiedMembersOnly ||= snapshot.verifiedMembersOnly;
            record.knownTreeMembers = snapshot.members;
            dependencies.inspectProcess = snapshot.inspectProcess;
          }
          return await managedProcessTreeTerminator(
            managedProcessTreeTarget(record, rootExitObserved),
            remainingProcessControlMs(deadlineMs),
            dependencies,
          );
        },
        { deadlineMs },
      );
    })();
    record.treeTerminationPromise = attempt;
    try {
      return await attempt;
    } catch (error) {
      if (record.treeTerminationPromise === attempt) {
        record.treeTerminationPromise = null;
      }
      if (!retryAvailable) {
        throw error;
      }
      retryAvailable = false;
    }
  }
}

function adoptedProcessTreeTarget(
  record: AdoptedProcessRecord,
): OwnedProcessTreeTarget {
  return {
    rootPid: record.pid,
    rootIdentity: record.rootIdentity,
    processGroup: record.processGroup,
    knownMembers: record.knownTreeMembers,
    verifiedMembersOnly: record.verifiedMembersOnly,
    forceImmediately: process.platform === "win32",
    preferFastWindowsRootIdentity: process.platform === "win32",
  };
}

async function adoptedProcessPollDelay(
  signal?: AbortSignal,
  delayMs = ADOPTED_PROCESS_POLL_INTERVAL_MS,
): Promise<void> {
  // Keep this bounded timer referenced: shutdown explicitly awaits the adopted
  // monitor finalizer, and an unref'ed timer can otherwise leave that promise
  // pending after the owned process tree becomes the last active handle.
  if (signal?.aborted) {
    return;
  }
  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    signal?.addEventListener("abort", finish, { once: true });
    if (signal?.aborted) {
      finish();
    }
  });
}

async function refreshAdoptedProcessTreeMembers(
  record: AdoptedProcessRecord,
  options: { deadlineMs?: number; signal?: AbortSignal } = {},
): Promise<void> {
  if (process.platform === "win32") {
    const inspection = await managedWindowsTreeInspector(
      record.rootIdentity,
      options,
    );
    if (inspection.rootStatus !== "owned") {
      throw new Error(
        `Cannot refresh exited adopted process "${record.service.manifest.id}".`,
      );
    }
    record.verifiedMembersOnly ||= inspection.verifiedMembersOnly;
    for (const pid of inspection.excludedMemberPids ?? []) {
      record.excludedTreeMemberPids.add(pid);
    }
    record.knownTreeMembers = inspection.members.filter((member) => !record.excludedTreeMemberPids.has(member.pid));
    return;
  }
  const members = await captureOwnedProcessTreeMembers(
    {
      rootPid: record.pid,
      rootIdentity: record.rootIdentity,
      processGroup: record.processGroup,
    },
    options,
  );
  if (members.length > 0) {
    record.knownTreeMembers = members;
  }
}

async function monitorManagedProcessTree(
  record: ManagedProcessRecord,
): Promise<void> {
  if (process.platform !== "win32") {
    return;
  }

  const serviceId = record.service.manifest.id;
  const key = workspaceServiceKey(serviceId, record.workspaceRoot);
  let refreshDelayMs = WINDOWS_TREE_MONITOR_REFRESH_DELAY_MS;
  while (
    managedProcesses.get(key) === record &&
    !record.stopping &&
    !record.treeTerminationPromise
  ) {
    await adoptedProcessPollDelay(
      record.treeMonitorAbortController.signal,
      refreshDelayMs,
    );
    if (
      managedProcesses.get(key) !== record ||
      record.stopping ||
      record.treeTerminationPromise ||
      record.treeMonitorAbortController.signal.aborted
    ) {
      return;
    }
    let inspectionFailed = false;
    try {
      if (!record.rootIdentity) {
        throw new Error(
          `Managed process "${serviceId}" has no verified root identity.`,
        );
      }
      const inspection = await managedWindowsTreeInspector(
        record.rootIdentity,
        {
          deadlineMs: Date.now() + WINDOWS_TREE_MONITOR_INSPECTION_TIMEOUT_MS,
          signal: record.treeMonitorAbortController.signal,
        },
      );
      record.verifiedMembersOnly ||= inspection.verifiedMembersOnly;
      for (const pid of inspection.excludedMemberPids ?? []) {
        record.excludedTreeMemberPids.add(pid);
      }
      if (inspection.members.length > 0) {
        record.knownTreeMembers = inspection.members.filter((member) => !record.excludedTreeMemberPids.has(member.pid));
      }
    } catch {
      // Process inspection can fail transiently; retain the last verified snapshot.
      inspectionFailed = true;
    }
    refreshDelayMs = inspectionFailed
      ? WINDOWS_TREE_MONITOR_RETRY_DELAY_MS
      : WINDOWS_TREE_MONITOR_REFRESH_DELAY_MS;
  }
}

async function finalizeAdoptedProcessExit(
  record: AdoptedProcessRecord,
): Promise<void> {
  const serviceId = record.service.manifest.id;
  const key = workspaceServiceKey(serviceId, record.workspaceRoot);
  if (adoptedProcesses.get(key) !== record || record.stopping) {
    return;
  }

  record.stopping = true;
  try {
    const deadlineMs = processControlDeadline(5_000);
    await withProcessControlDeadline(
      async (signal) => {
        const dependencies: Parameters<typeof terminateOwnedProcessTree>[2] = {
          deadlineMs,
          signal,
        };
        if (
          process.platform === "win32" &&
          record.knownTreeMembers.length > 0
        ) {
          const snapshot = await inspectKnownWindowsTreeMembers(
            record.rootIdentity,
            record.knownTreeMembers,
            deadlineMs,
            signal,
            record.verifiedMembersOnly,
            { inspectTree: managedWindowsTreeInspector },
          );
          record.verifiedMembersOnly ||= snapshot.verifiedMembersOnly;
          record.knownTreeMembers = snapshot.members;
          dependencies.inspectProcess = snapshot.inspectProcess;
        }
        return await managedProcessTreeTerminator(
          {
            ...adoptedProcessTreeTarget(record),
            processGroup: { kind: "none", id: null },
            rootExitObserved: process.platform === "win32",
          },
          remainingProcessControlMs(deadlineMs),
          dependencies,
        );
      },
      { deadlineMs },
    );
  } catch (error) {
    record.stopping = false;
    throw error;
  }
  await withSerializedWorkspaceFinalization(record.workspaceRoot, async () => {
    await transitionProcessOwnership(
      record.workspaceRoot,
      "service",
      serviceId,
      "stopped",
      "not_running",
      record.pid,
    );

    const current = getLifecycleState(serviceId);
    if (current.running && current.runtime.pid === record.pid) {
      const finishedAt = new Date().toISOString();
      const startedAtMs = current.runtime.startedAt
        ? Date.parse(current.runtime.startedAt)
        : Number.NaN;
      const durationMs = Number.isFinite(startedAtMs)
        ? Math.max(0, Date.parse(finishedAt) - startedAtMs)
        : 0;
      const next = setLifecycleState(serviceId, {
        ...current,
        running: false,
        runtime: {
          ...current.runtime,
          pid: null,
          finishedAt,
          exitCode: null,
          lastTermination: "exited",
          metrics: {
            ...current.runtime.metrics,
            exitCount: current.runtime.metrics.exitCount + 1,
            totalRunDurationMs:
              current.runtime.metrics.totalRunDurationMs + durationMs,
            lastRunDurationMs: durationMs,
          },
        },
      });
      await writeServiceState(record.service, next);
    }
    adoptedProcesses.delete(key);
  });
}

async function monitorAdoptedProcess(
  record: AdoptedProcessRecord,
): Promise<void> {
  const serviceId = record.service.manifest.id;
  const key = workspaceServiceKey(serviceId, record.workspaceRoot);
  while (adoptedProcesses.get(key) === record && !record.stopping) {
    await adoptedProcessPollDelay(
      record.monitorAbortController.signal,
      process.platform === "win32"
        ? WINDOWS_TREE_MONITOR_REFRESH_DELAY_MS
        : ADOPTED_PROCESS_POLL_INTERVAL_MS,
    );
    if (adoptedProcesses.get(key) !== record || record.stopping) {
      return;
    }

    let status: Awaited<ReturnType<typeof classifyRegisteredProcess>>;
    try {
      const ownership = await findProcessOwnership(
        record.workspaceRoot,
        "service",
        serviceId,
      );
      if (!ownership) {
        throw new Error(
          `Process ownership is missing for adopted service "${serviceId}".`,
        );
      }
      status = await classifyRegisteredProcess(ownership, {
        deadlineMs: Date.now() + WINDOWS_TREE_MONITOR_INSPECTION_TIMEOUT_MS,
        signal: record.monitorAbortController.signal,
      });
    } catch {
      // Process inspection can fail transiently; retain durable ownership and retry.
      continue;
    }

    if (status === "owned") {
      try {
        await refreshAdoptedProcessTreeMembers(record, {
          deadlineMs: Date.now() + WINDOWS_TREE_MONITOR_INSPECTION_TIMEOUT_MS,
          signal: record.monitorAbortController.signal,
        });
      } catch {
        // Retain the last verified tree snapshot and retry process inspection.
      }
      continue;
    }
    if (status === "not_running" || status === "identity_mismatch") {
      await finalizeAdoptedProcessExit(record);
      return;
    }
  }
}

export async function beginManagedProcessStop(
  serviceId: string,
  deadlineMs?: number,
  workspaceRoot?: string | null,
): Promise<boolean> {
  const key = resolveWorkspaceServiceKey(serviceId, workspaceRoot);
  const record = key ? managedProcesses.get(key) : undefined;
  if (record) {
    if (deadlineMs !== undefined) {
      const priorDeadlineExpired =
        record.stopDeadlineMs !== null &&
        remainingProcessControlMs(record.stopDeadlineMs) <= 0;
      record.stopDeadlineMs =
        priorDeadlineExpired && record.treeTerminationPromise === null
          ? deadlineMs
          : Math.min(record.stopDeadlineMs ?? deadlineMs, deadlineMs);
    }
    record.stopping = true;
    record.treeMonitorAbortController.abort();
    // This monitor only maintains a best-effort tree snapshot. Its in-flight
    // native inspection has its own timeout, so waiting for it here could
    // consume the caller-owned deadline before authoritative termination starts.
    if (record.workspaceRoot && !record.stoppingPersisted) {
      await withProcessControlDeadline(
        async () =>
          await transitionProcessOwnership(
            record.workspaceRoot as string,
            "service",
            authorityServiceId,
            "stopping",
            undefined,
            record.child.pid,
          ),
        { deadlineMs: record.stopDeadlineMs ?? deadlineMs },
      );
      record.stoppingPersisted = true;
    }
    return true;
  }

  const adopted = key ? adoptedProcesses.get(key) : undefined;
  if (adopted) {
    adopted.stopping = true;
    adopted.monitorAbortController.abort();
    // As above, cancellation requests monitor quiescence without allowing a
    // best-effort inspection to spend the stop operation's deadline.
    if (!adopted.stoppingPersisted) {
      await withProcessControlDeadline(
        async () =>
          await transitionProcessOwnership(
            adopted.workspaceRoot,
            "service",
            adopted.service.manifest.id,
            "stopping",
            undefined,
            adopted.pid,
          ),
        { deadlineMs },
      );
      adopted.stoppingPersisted = true;
    }
    return true;
  }

  return false;
}

export async function adoptManagedProcess(
  options: AdoptManagedProcessOptions,
): Promise<ManagedProcessHandle> {
  const { service, pid, startedAt, command, workspaceRoot } = options;
  const serviceId = service.manifest.id;
  const key = workspaceServiceKey(serviceId, workspaceRoot);

  const priorFinalizer = managedProcessFinalizers.get(key);
  if (priorFinalizer) {
    await waitForManagedProcessFinalization(serviceId, undefined, workspaceRoot);
  }

  if (managedProcesses.has(key) || adoptedProcesses.has(key)) {
    throw new Error(`Service "${serviceId}" already has a managed process.`);
  }

  const status = await reconcileRegisteredProcess(
    workspaceRoot,
    "service",
    serviceId,
  );
  if (status !== "owned") {
    throw new Error(
      `Cannot adopt service "${serviceId}" process ${pid}: persisted owner status is ${status}.`,
    );
  }
  const ownership = await findProcessOwnership(
    workspaceRoot,
    "service",
    serviceId,
  );
  if (!ownership?.identity || ownership.pid !== pid) {
    throw new Error(
      `Cannot adopt service "${serviceId}" process ${pid}: verified ownership evidence is missing.`,
    );
  }

  const record: AdoptedProcessRecord = {
    service,
    pid,
    startedAt,
    command,
    stopping: false,
    stoppingPersisted: false,
    workspaceRoot,
    rootIdentity: ownership.identity,
    processGroup: ownership.processGroup,
    knownTreeMembers: [],
    excludedTreeMemberPids: new Set<number>(),
    monitorAbortController: new AbortController(),
  };
  await refreshAdoptedProcessTreeMembers(record);
  adoptedProcesses.set(key, record);
  trackManagedProcessFinalizer(
    serviceId,
    pid,
    monitorAdoptedProcess(record),
    workspaceRoot,
  );

  return {
    pid,
    startedAt,
    command,
    logs: getServiceRuntimeLogPaths(
      service.serviceRoot,
      buildServiceRuntimeLogRunId(startedAt),
    ),
  };
}

export async function startManagedProcess(
  options: StartProcessOptions,
): Promise<ManagedProcessHandle> {
  const {
    service,
    executionPlan,
    sharedGlobalEnv,
    resolvedPorts,
    secureEnv,
    variableResolution,
    workspaceRoot,
    runtimeGenerationId,
    runtimeInstanceId,
    allocationRevision,
    onExit,
  } = options;
  const serviceId = service.manifest.id;
  const key = workspaceServiceKey(serviceId, workspaceRoot);

  const priorFinalizer = managedProcessFinalizers.get(key);
  if (priorFinalizer) {
    await waitForManagedProcessFinalization(serviceId, undefined, workspaceRoot);
  }

  if (managedProcesses.has(key) || adoptedProcesses.has(key)) {
    throw new Error(`Service "${serviceId}" already has a managed process.`);
  }
  if (workspaceRoot) {
    const persistedStatus = await reconcileRegisteredProcess(
      workspaceRoot,
      "service",
      serviceId,
    );
    if (persistedStatus === "owned") {
      throw new Error(
        `Service "${serviceId}" already has a verified process in the workspace ownership registry.`,
      );
    }
    if (persistedStatus === "unknown_owner") {
      throw new Error(
        `Service "${serviceId}" has an unverifiable persisted process owner; refusing to launch a replacement.`,
      );
    }
  }

  const { executable, args, workingDirectory, environment } =
    resolveManagedProcessLaunch(
      service,
      executionPlan,
      sharedGlobalEnv,
      resolvedPorts,
      secureEnv,
      variableResolution,
    );
  const command = buildCommandString(executable, args);
  const startedAt = new Date().toISOString();
  const { paths: logPaths, streams: logStreams } =
    await prepareRuntimeLogStreams(service.serviceRoot, startedAt);
  const stdinEnabled = serviceEnablesStdin(service);

  let approvedLaunchFiles: readonly ManagedLaunchFileBinding[] = [];
  try {
    approvedLaunchFiles = (await options.verifyBeforeSpawn?.()) ?? [];
  } catch (error) {
    await closeRuntimeLogStreams(logStreams);
    throw new ManagedProcessStartError("prelaunch_verification", error);
  }
  const useWindowsManagedLauncher =
    process.platform === "win32" && Boolean(workspaceRoot);
  let windowsManagedLaunchState: WindowsManagedLaunchState | null = null;
  try {
    windowsManagedLaunchState = useWindowsManagedLauncher
      ? await createWindowsManagedLaunchState(
          executable,
          args,
          workingDirectory,
          environment,
          approvedLaunchFiles,
          workspaceRoot as string,
          options.guardedExecutableLaunch === true ||
            options.verifyBeforeSpawn !== undefined,
        )
      : null;
    await managedProcessLaunchStateCreatedHook?.();
  } catch (error) {
    await closeRuntimeLogStreams(logStreams);
    throw new ManagedProcessStartError("launch_state_creation", error);
  }
  let child: ChildProcess | null = null;
  let exitPromise: Promise<{
    exitCode: number | null;
    signal: NodeJS.Signals | null;
  }> | null = null;
  try {
    if (windowsManagedLaunchState) {
      await verifyWindowsManagedLauncherIntegrity(
        windowsManagedLaunchState.launcherExecutable,
      );
      child = managedProcessSpawner(
        windowsManagedLaunchState.launcherExecutable,
        [],
        {
          cwd: workingDirectory,
          env: windowsManagedLaunchState.environment,
          stdio: [stdinEnabled ? "pipe" : "ignore", "pipe", "pipe"],
          detached: false,
          windowsHide: true,
        },
      );
    } else {
      child = managedProcessSpawner(executable, args, {
        cwd: workingDirectory,
        env: environment,
        stdio: [stdinEnabled ? "pipe" : "ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
        windowsHide: true,
      });
    }

    const spawnedChild = child;
    exitPromise = new Promise<{
      exitCode: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve) => {
      // `close` reports that stdio streams have closed, which is not a
      // process-ownership boundary for detached POSIX services.  A managed
      // service may close or replace its inherited streams while its verified
      // root PID remains live.  Only the child `exit` event can authorize
      // lifecycle finalization and process-tree cleanup.
      spawnedChild.once("exit", (exitCode, signal) => {
        resolve({
          exitCode: typeof exitCode === "number" ? exitCode : null,
          signal,
        });
      });
    });

    await waitForManagedProcessSpawn(spawnedChild);
  } catch (error) {
    const cleanupErrors: unknown[] = [];
    await containUnenrolledManagedProcessWrapper(child, exitPromise).catch(
      (cleanupError) => cleanupErrors.push(cleanupError),
    );
    await closeRuntimeLogStreams(logStreams).catch((cleanupError) =>
      cleanupErrors.push(cleanupError),
    );
    await removeWindowsManagedLaunchState(windowsManagedLaunchState).catch(
      (cleanupError) => cleanupErrors.push(cleanupError),
    );
    throw new ManagedProcessStartError(
      "wrapper_spawn",
      cleanupErrors.length > 0
        ? new AggregateError(
            [error, ...cleanupErrors],
            "Managed process wrapper spawn and cleanup failed.",
          )
        : error,
    );
  }

  if (!child || !exitPromise) {
    throw new Error(
      "Managed process wrapper spawn completed without a child handle.",
    );
  }

  const rootPid = child.pid ?? 0;
  const processGroup = windowsManagedLaunchState
    ? { kind: "windows-job" as const, id: String(rootPid) }
    : createSpawnProcessGroup(rootPid);
  const rootInspection =
    rootPid > 0 && !workspaceRoot
      ? await managedProcessRootInspector(rootPid)
      : null;
  let rootIdentity =
    rootInspection?.status === "running" ? rootInspection.identity : null;

  const record: ManagedProcessRecord = {
    child,
    service,
    startedAt,
    command,
    stopping: false,
    stoppingPersisted: false,
    exitCode: null,
    exitSignal: null,
    logs: logPaths,
    logStreams,
    stdoutBuffer: "",
    stderrBuffer: "",
    launcherProgressToken: windowsManagedLaunchState?.progressToken ?? null,
    launcherProgressPhase: null,
    launcherPayloadFailureBoundary: null,
    launcherPayloadDiagnosticCount: 0,
    launcherPayloadDiagnosticInvalid: false,
    variableCapturePromise: Promise.resolve(),
    workspaceRoot: workspaceRoot ?? null,
    rootIdentity,
    processGroup,
    knownTreeMembers: [],
    excludedTreeMemberPids: new Set<number>(),
    treeMonitorPromise: Promise.resolve(),
    treeMonitorAbortController: new AbortController(),
    treeTerminationPromise: null,
    stopDeadlineMs: null,
    exitPromise,
    logCapturePromise: Promise.resolve(),
    finalizePromise: Promise.resolve(),
  };
  attachRuntimeLogCapture(record);

  let managedRecordActivated = false;
  const activateManagedRecord = () => {
    if (managedRecordActivated) {
      return;
    }
    managedRecordActivated = true;
    managedProcesses.set(key, record);
    record.treeMonitorPromise = managedProcessTreeMonitor(record).catch(
      () => undefined,
    );
    const logFinalizePromise = record.logCapturePromise;
    const lifecycleFinalizePromise = exitPromise.then(
      async ({ exitCode, signal }) => {
        const finalizationDeadlineMs =
          record.stopDeadlineMs !== null &&
          remainingProcessControlMs(record.stopDeadlineMs) > 0
            ? record.stopDeadlineMs
            : processControlDeadline(
                UNEXPECTED_PROCESS_FINALIZATION_TIMEOUT_MS,
              );
        await terminateManagedProcessTree(
          record,
          UNEXPECTED_PROCESS_FINALIZATION_TIMEOUT_MS,
          true,
          true,
          finalizationDeadlineMs,
        );
        await new Promise<void>((resolve) => setImmediate(resolve));
        record.exitCode = exitCode;
        record.exitSignal = signal;

        const finalizeLifecycle = async () => {
          if (record.workspaceRoot) {
            await transitionProcessOwnership(
              record.workspaceRoot,
              "service",
              serviceId,
              "stopped",
              "not_running",
              child.pid,
            );
          }

          const current = managedProcesses.get(key);
          if (current?.child === child) {
            managedProcesses.delete(key);
          }

          if (onExit) {
            await onExit({
              service,
              exitCode,
              signal,
              wasStopping: record.stopping,
            });
          }
        };
        if (record.workspaceRoot) {
          await withSerializedWorkspaceFinalization(
            record.workspaceRoot,
            finalizeLifecycle,
          );
        } else {
          await finalizeLifecycle();
        }
      },
    );
    record.finalizePromise = Promise.all([
      logFinalizePromise,
      lifecycleFinalizePromise,
    ]).then(() => undefined);
    trackManagedProcessFinalizer(
      serviceId,
      child.pid ?? null,
      record.finalizePromise,
      workspaceRoot ?? null,
    );
  };

  if (workspaceRoot) {
    let startFailurePhase: ManagedProcessStartFailurePhase =
      "ownership_enrollment";
    try {
      startFailurePhase = "ownership_enrollment";
      await managedProcessEnrollmentHook?.(child);
      const network = buildServiceNetwork(
        service,
        sharedGlobalEnv,
        resolvedPorts,
      );
      startFailurePhase = "ownership_recording";
      const ownership = await recordProcessOwnership(workspaceRoot, {
        ownerType: "service",
        ownerId: serviceId,
        serviceId,
        generationId: runtimeGenerationId,
        runtimeInstanceId,
        pid: child.pid ?? 0,
        ownerRoot: service.serviceRoot,
        allocationRevision,
        ports: resolvedPorts,
        endpoints: network.endpoints
          .filter(
            (endpoint): endpoint is typeof endpoint & { url: string } =>
              typeof endpoint.url === "string",
          )
          .map((endpoint) => ({ name: endpoint.label, url: endpoint.url })),
        lifecycleState: "launching",
        source: "spawn",
        processGroup,
        verifyInspectedProcess: (identity) => {
          if (probeManagedChildHandle(child) !== "owned") {
            return false;
          }
          rootIdentity = identity;
          record.rootIdentity = identity;
          return true;
        },
      });
      if (!ownership.identity) {
        throw new Error(
          `Cannot start managed process "${serviceId}": verified ownership identity is missing.`,
        );
      }
      rootIdentity = ownership.identity;
      record.rootIdentity = ownership.identity;
      if (process.platform === "win32") {
        startFailurePhase = "initial_tree_inspection";
        const initialTree = await managedWindowsTreeInspector(
          ownership.identity,
          {
            deadlineMs: Date.now() + WINDOWS_TREE_MONITOR_INSPECTION_TIMEOUT_MS,
          },
        );
        record.verifiedMembersOnly ||= initialTree.verifiedMembersOnly;
        record.knownTreeMembers = initialTree.members;
        if (
          initialTree.rootStatus !== "owned" ||
          probeManagedChildHandle(child) !== "owned"
        ) {
          throw new Error(
            `Cannot start managed process "${serviceId}": root exited during ownership enrollment.`,
          );
        }
        if (windowsManagedLaunchState) {
          startFailurePhase = "launch_file_binding";
          try {
            await bindWindowsManagedLauncherFiles(
              child,
              windowsManagedLaunchState,
              async (deadlineMs) => {
                if (probeManagedChildHandle(child) !== "owned") {
                  // This is deliberately only the log/parser receipt. The
                  // lifecycle finalizer can include registry and containment
                  // work, so awaiting it here would turn a bounded launcher
                  // diagnostic into an unbounded lifecycle wait.
                  await settleWindowsManagedLauncherStderr(child, deadlineMs);
                  await withProcessControlDeadline(
                    async () => await record.logCapturePromise,
                    { deadlineMs },
                  );
                }
                return {
                  phase: record.launcherProgressPhase,
                  payloadFailureBoundary:
                    managedLauncherPayloadDiagnostic(record) ?? "unknown",
                };
              },
            );
          } finally {
            // A native payload rejection can publish its one authenticated
            // terminal record after the launcher handle has transitioned out
            // of the owned state. Keep the in-memory authentication token
            // until the already-attached stderr capture has reached its
            // terminal boundary, otherwise a delayed final chunk is reduced
            // to an indistinguishable untrusted record. A live launcher does
            // not retain the token past file binding.
            if (probeManagedChildHandle(child) === "owned") {
              record.launcherProgressToken = null;
            } else {
              void record.logCapturePromise.finally(() => {
                record.launcherProgressToken = null;
              });
            }
            windowsManagedLaunchState.progressToken = "";
            delete windowsManagedLaunchState.environment
              .SERVICE_LASSO_MANAGED_LAUNCH_PROGRESS_TOKEN;
          }
          startFailurePhase = "binding_revalidation";
          const confirmedLaunchFiles =
            (await options.verifyBeforeSpawn?.()) ?? [];
          if (
            !sameManagedLaunchFileBindings(
              approvedLaunchFiles,
              confirmedLaunchFiles,
            )
          ) {
            throw new Error(
              `Cannot start managed process "${serviceId}": executable bindings changed during enrollment.`,
            );
          }
          startFailurePhase = "target_acknowledgement";
          await continueWindowsManagedLauncher(
            child,
            windowsManagedLaunchState,
          );
          startFailurePhase = "post_release_hook";
          await managedProcessAfterReleaseHook?.();
        }
        startFailurePhase = "stabilization_delay";
        await adoptedProcessPollDelay(undefined);
        startFailurePhase = "stabilized_tree_inspection";
        const stabilizedTree = await managedWindowsTreeInspector(
          ownership.identity,
          {
            deadlineMs: Date.now() + WINDOWS_TREE_MONITOR_INSPECTION_TIMEOUT_MS,
          },
        );
        record.verifiedMembersOnly ||= stabilizedTree.verifiedMembersOnly;
        const excluded = new Set(stabilizedTree.excludedMemberPids ?? []);
        record.knownTreeMembers = mergeProcessFingerprints(
          initialTree.members,
          stabilizedTree.members,
        ).filter((member) => !excluded.has(member.pid));
        if (
          stabilizedTree.rootStatus !== "owned" ||
          probeManagedChildHandle(child) !== "owned"
        ) {
          throw new Error(
            `Cannot start managed process "${serviceId}": root exited during ownership enrollment.`,
          );
        }
        startFailurePhase = "launch_state_cleanup";
        await removeWindowsManagedLaunchState(windowsManagedLaunchState);
        windowsManagedLaunchState = null;
      }
    } catch (error) {
      const earlyPayloadFailureBoundary =
        managedLauncherPayloadDiagnostic(record);
      const startError =
        error instanceof ManagedProcessStartError
          ? error
          : new ManagedProcessStartError(
              earlyPayloadFailureBoundary
                ? "launcher_payload_validation"
                : startFailurePhase,
              error,
              earlyPayloadFailureBoundary,
            );
      const classifiedStartFailurePhase =
        managedProcessStartFailurePhase(startError) ?? startFailurePhase;
      let containmentError: unknown = null;
      if (rootIdentity) {
        const verifiedRootIdentity = rootIdentity;
        if (
          process.platform === "win32" &&
          record.knownTreeMembers.length === 0
        ) {
          const emergencyTree = await managedWindowsTreeInspector(
            verifiedRootIdentity,
            {
              deadlineMs:
                Date.now() + WINDOWS_TREE_MONITOR_INSPECTION_TIMEOUT_MS,
            },
          ).catch(() => null);
          if (emergencyTree) {
            record.verifiedMembersOnly ||= emergencyTree.verifiedMembersOnly;
            record.knownTreeMembers = emergencyTree.members;
          }
        }
        const rootStatus = probeManagedChildHandle(child);
        try {
          const containmentDeadlineMs = processControlDeadline(5_000);
          await withProcessControlDeadline(
            async (signal) => {
              const dependencies: Parameters<
                typeof terminateOwnedProcessTree
              >[2] = {
                deadlineMs: containmentDeadlineMs,
                signal,
              };
              if (
                process.platform === "win32" &&
                record.knownTreeMembers.length > 0
              ) {
                const snapshot = await inspectKnownWindowsTreeMembers(
                  verifiedRootIdentity,
                  record.knownTreeMembers,
                  containmentDeadlineMs,
                  signal,
                  record.verifiedMembersOnly,
                  { inspectTree: managedWindowsTreeInspector },
                );
                record.verifiedMembersOnly ||= snapshot.verifiedMembersOnly;
                record.knownTreeMembers = snapshot.members;
                dependencies.inspectProcess = snapshot.inspectProcess;
              }
              const target: Parameters<typeof managedProcessTreeTerminator>[0] =
                {
                  rootPid,
                  rootIdentity: verifiedRootIdentity,
                  processGroup,
                  knownMembers: record.knownTreeMembers,
                  verifiedMembersOnly: record.verifiedMembersOnly,
                  rootExitObserved: rootStatus === "exited",
                  rootOwnershipProbe: () => probeManagedChildHandle(child),
                  forceImmediately: process.platform === "win32",
                  preferFastWindowsRootIdentity: process.platform === "win32",
                };
              if (
                process.platform !== "win32" ||
                !windowsManagedLaunchState ||
                classifiedStartFailurePhase !== "target_acknowledgement"
              ) {
                return await managedProcessTreeTerminator(
                  target,
                  remainingProcessControlMs(containmentDeadlineMs),
                  dependencies,
                );
              }

              // This verified launcher exits through job containment before releasing
              // approved files. A slow taskkill must not obscure that completion.
              await observeNativeAcknowledgementContainment({
                signal,
                nativeObservationMs: Math.floor(
                  remainingProcessControlMs(containmentDeadlineMs) / 2,
                ),
                exit: exitPromise,
                terminate: (helperSignal) =>
                  managedProcessTreeTerminator(
                    target,
                    remainingProcessControlMs(containmentDeadlineMs),
                    { ...dependencies, signal: helperSignal },
                  ),
                verifyStopped: async () =>
                  await verifyNativeAcknowledgementFinalContainment(
                    record,
                    verifiedRootIdentity,
                    containmentDeadlineMs,
                    signal,
                  ),
              });
            },
            { deadlineMs: containmentDeadlineMs },
          );
        } catch (cleanupError) {
          containmentError = cleanupError;
        }
      } else if (child.exitCode === null && child.signalCode === null) {
        if (!child.kill("SIGKILL")) {
          containmentError = new Error(
            "Managed launch wrapper could not be terminated after ownership enrollment failed.",
          );
        }
      }
      const launchStateCleanupErrors: unknown[] = [];
      await removeWindowsManagedLaunchState(windowsManagedLaunchState).catch(
        (cleanupError) => {
          launchStateCleanupErrors.push(cleanupError);
        },
      );
      windowsManagedLaunchState = null;
      if (!containmentError) {
        try {
          const exitDeadlineMs = processControlDeadline(5_000);
          await withProcessControlDeadline(async () => await exitPromise, {
            deadlineMs: exitDeadlineMs,
          });
          await withProcessControlDeadline(
            async () => await record.finalizePromise,
            { deadlineMs: exitDeadlineMs },
          );
        } catch (exitError) {
          containmentError = exitError;
        }
      }
      if (containmentError) {
        activateManagedRecord();
        throw new ManagedProcessEnrollmentContainmentError(
          [startError, containmentError, ...launchStateCleanupErrors],
          `Cannot start managed process "${serviceId}": ownership enrollment and containment both failed.`,
          {
            pid: child.pid ?? 0,
            startedAt,
            command,
            logs: logPaths,
          },
          classifiedStartFailurePhase,
        );
      }
      await transitionProcessOwnership(
        workspaceRoot,
        "service",
        serviceId,
        "stopped",
        "not_running",
        rootPid,
      );
      if (launchStateCleanupErrors.length > 0) {
        throw new ManagedProcessStartError(
          classifiedStartFailurePhase,
          new AggregateError(
            [startError, ...launchStateCleanupErrors],
            `Cannot start managed process "${serviceId}": launch-state cleanup also failed.`,
          ),
        );
      }
      throw startError;
    }
  }

  activateManagedRecord();

  return {
    pid: child.pid ?? 0,
    startedAt,
    command,
    logs: logPaths,
  };
}

export async function stopManagedProcess(
  serviceId: string,
  timeoutMs = DEFAULT_MANAGED_PROCESS_STOP_TIMEOUT_MS,
  options: { newWindowsInspectionEpisode?: boolean; workspaceRoot?: string | null } = {},
): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null } | null> {
  const key = resolveWorkspaceServiceKey(serviceId, options.workspaceRoot);
  const record = key ? managedProcesses.get(key) : undefined;
  if (!record) {
    return await stopAdoptedProcess(serviceId, timeoutMs, options);
  }

  const deadlineMs = processControlDeadline(timeoutMs);
  await beginManagedProcessStop(serviceId, deadlineMs, record.workspaceRoot);
  await terminateManagedProcessTree(
    record,
    timeoutMs,
    false,
    false,
    deadlineMs,
  );
  const result = await withProcessControlDeadline(
    async () => await record.exitPromise,
    { deadlineMs },
  );
  await waitForManagedProcessFinalization(serviceId, deadlineMs, record.workspaceRoot);

  return result;
}

async function waitForAdoptedProcessExit(
  record: AdoptedProcessRecord,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ownership = await findProcessOwnership(
      record.workspaceRoot,
      "service",
      record.service.manifest.id,
    );
    if (!ownership) {
      return true;
    }
    const status = await classifyRegisteredProcess(ownership);
    if (status === "not_running" || status === "identity_mismatch") {
      return true;
    }
    if (status === "unknown_owner") {
      throw new Error(
        `Cannot verify adopted service "${record.service.manifest.id}" process owner during stop.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

async function stopAdoptedProcess(
  serviceId: string,
  timeoutMs: number,
  options: { newWindowsInspectionEpisode?: boolean; workspaceRoot?: string | null } = {},
): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null } | null> {
  const key = resolveWorkspaceServiceKey(serviceId, options.workspaceRoot);
  const record = key ? adoptedProcesses.get(key) : undefined;
  if (!record) {
    return null;
  }

  const deadlineMs = processControlDeadline(timeoutMs);
  const finalizer = key ? managedProcessFinalizers.get(key) : undefined;
  await beginManagedProcessStop(serviceId, deadlineMs, record.workspaceRoot);
  let terminationTarget = adoptedProcessTreeTarget(record);
  const terminationDependencies: Parameters<
    typeof terminateOwnedProcessTree
  >[2] = { deadlineMs };
  if (process.platform !== "win32") {
    // POSIX process-group signaling needs this fresh registry check before it
    // targets a numeric group. Windows uses one native full-tree snapshot below
    // as the immediate pre-taskkill root and member classification.
    const ownership = await withProcessControlDeadline(
      async () =>
        await findProcessOwnership(record.workspaceRoot, "service", serviceId),
      { deadlineMs },
    );
    const status = ownership
      ? await withProcessControlDeadline(
          async (signal) =>
            await classifyRegisteredProcess(ownership, { deadlineMs, signal }),
          { deadlineMs },
        )
      : "not_running";
    if (status === "unknown_owner") {
      throw new Error(
        `Cannot stop service "${serviceId}" because its adopted process owner is unverifiable.`,
      );
    }
    if (status !== "owned") {
      terminationTarget = {
        ...terminationTarget,
        processGroup: { kind: "none" as const, id: null },
      };
    }
  } else if (record.knownTreeMembers.length > 0 || options.newWindowsInspectionEpisode) {
    await withProcessControlDeadline(
      async (signal) => {
        const snapshot = await inspectKnownWindowsTreeMembers(
          record.rootIdentity,
          record.knownTreeMembers,
          deadlineMs,
          signal,
          record.verifiedMembersOnly,
          { inspectTree: managedWindowsTreeInspector },
        );
        record.verifiedMembersOnly ||= snapshot.verifiedMembersOnly;
        record.knownTreeMembers = snapshot.members;
        terminationTarget = adoptedProcessTreeTarget(record);
        terminationDependencies.signal = signal;
        terminationDependencies.inspectProcess = snapshot.inspectProcess;
        terminationDependencies.classifyWindowsProcessIdentityFast = async (
          identity,
        ) =>
          classifyProcessIdentity(
            identity,
            await snapshot.inspectProcess(identity.pid),
            "win32",
          );
      },
      { deadlineMs },
    );
  }
  const termination = await managedProcessTreeTerminator(
    terminationTarget,
    remainingProcessControlMs(deadlineMs),
    terminationDependencies,
  );

  // Tree-control success proves only that the exact control operation
  // returned.  Retained ownership may become stopped only after a new
  // inspection classifies every root/member lifetime absent; a live, reused,
  // unknown, or uninspectable member keeps the durable record for recovery.
  if (!await adoptedProcessTreeIsFreshlyAbsent(record, deadlineMs)) {
    throw new Error(
      `Cannot mark adopted service "${serviceId}" stopped until its retained process tree is absent.`,
    );
  }

  await withProcessControlDeadline(
    async () =>
      await withSerializedWorkspaceFinalization(
        record.workspaceRoot,
        async () => {
          await transitionProcessOwnership(
            record.workspaceRoot,
            "service",
            serviceId,
            "stopped",
            "not_running",
            record.pid,
          );
          adoptedProcesses.delete(key!);
        },
      ),
    { deadlineMs },
  );
  if (finalizer) {
    await waitForManagedProcessFinalization(serviceId, deadlineMs, record.workspaceRoot);
  }
  return termination.forced
    ? { exitCode: null, signal: "SIGKILL" }
    : { exitCode: 0, signal: null };
}

async function adoptedProcessTreeIsFreshlyAbsent(
  record: AdoptedProcessRecord,
  deadlineMs: number,
): Promise<boolean> {
  const finalMembers = unionProcessFingerprints(
    record.rootIdentity ? [record.rootIdentity] : [],
    record.knownTreeMembers,
  );
  for (const member of finalMembers) {
    const inspection = await withProcessControlDeadline(
      async (signal) =>
        await managedProcessRootInspector(member.pid, { deadlineMs, signal }),
      { deadlineMs },
    );
    if (inspection.status !== "not_running") return false;
  }
  return true;
}

export async function waitForManagedProcessExit(
  serviceId: string,
  timeoutMs = 5_000,
  workspaceRoot?: string | null,
): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null } | null> {
  const key = resolveWorkspaceServiceKey(serviceId, workspaceRoot);
  const record = key ? managedProcesses.get(key) : undefined;
  if (!record) {
    const adopted = key ? adoptedProcesses.get(key) : undefined;
    if (!adopted) {
      return null;
    }
    const finalizer = key ? managedProcessFinalizers.get(key) : undefined;
    await beginManagedProcessStop(serviceId, undefined, adopted.workspaceRoot);
    const exited = await waitForAdoptedProcessExit(adopted, timeoutMs);
    if (!exited) {
      return null;
    }
    const termination = await managedProcessTreeTerminator(
      {
        ...adoptedProcessTreeTarget(adopted),
        processGroup: { kind: "none", id: null },
      },
      timeoutMs,
    );
    await withSerializedWorkspaceFinalization(
      adopted.workspaceRoot,
      async () => {
        await transitionProcessOwnership(
          adopted.workspaceRoot,
          "service",
          serviceId,
          "stopped",
          "not_running",
          adopted.pid,
        );
        adoptedProcesses.delete(key!);
      },
    );
    if (finalizer) {
      await waitForManagedProcessFinalization(serviceId, undefined, adopted.workspaceRoot);
    }
    return termination.forced
      ? { exitCode: null, signal: "SIGKILL" }
      : { exitCode: 0, signal: null };
  }

  await beginManagedProcessStop(serviceId, undefined, record.workspaceRoot);

  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<null>((resolve) => {
    timeout = setTimeout(() => resolve(null), timeoutMs);
    timeout.unref?.();
  });

  const result = await Promise.race([record.exitPromise, timeoutPromise]);
  if (timeout) {
    clearTimeout(timeout);
  }
  if (!result) {
    return null;
  }

  await waitForManagedProcessFinalization(serviceId, undefined, record.workspaceRoot);
  if (record.workspaceRoot) {
    await transitionProcessOwnership(
      record.workspaceRoot,
      "service",
      serviceId,
      "stopped",
      "not_running",
      record.child.pid,
    );
  }

  return result;
}

export async function stopAllManagedProcesses(): Promise<void> {
  const MAX_FINALIZATION_PASSES = 8;
  // Quiesce every monitor synchronously before any tree termination starts.
  // Persist the shared ownership-registry transitions serially so concurrent
  // atomic writes cannot race each other on Windows. Tree termination and each
  // service's independent finalizer remain parallel below.
  const stopOne = async (
    serviceId: string,
  ): Promise<ManagedProcessFinalizationFailure[]> => {
    const pid =
      managedProcesses.get(serviceId)?.child.pid ??
      adoptedProcesses.get(serviceId)?.pid ??
      managedProcessFinalizers.get(serviceId)?.pid ??
      null;
    try {
      await stopManagedProcess(serviceId);
      await waitForManagedProcessFinalization(serviceId);
      return [];
    } catch (error) {
      if (error instanceof ManagedProcessFinalizationError) {
        if (error.failures.length > 0) {
          return error.failures;
        }
        return [
          {
            serviceId,
            pid,
            phase: "finalize",
            code: "FINALIZER_FAILED",
          },
        ];
      }
      return [
        {
          serviceId,
          pid,
          phase: "stop",
          code: safeFinalizationErrorCode(error, "STOP_FAILED"),
        },
      ];
    }
  };

  const unresolvedFailures = new Map<
    string,
    ManagedProcessFinalizationFailure[]
  >();
  for (let pass = 1; pass <= MAX_FINALIZATION_PASSES; pass += 1) {
    const activeServiceIds = [
      ...new Set([...managedProcesses.keys(), ...adoptedProcesses.keys()]),
    ].reverse();
    const serviceIds = [
      ...activeServiceIds,
      ...[...managedProcessFinalizers.keys()].filter(
        (serviceId) => !activeServiceIds.includes(serviceId),
      ),
    ];
    await Promise.all(
      [...managedProcessShutdownQuiescers].map((quiescer) =>
        quiescer(new Set(serviceIds)),
      ),
    );
    if (serviceIds.length === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (
        managedProcesses.size === 0 &&
        adoptedProcesses.size === 0 &&
        managedProcessFinalizers.size === 0
      ) {
        for (const [serviceId, failures] of unresolvedFailures) {
          if (failures.every((failure) => failure.phase === "stop")) {
            unresolvedFailures.delete(serviceId);
          }
        }
        break;
      }
      continue;
    }

    for (const serviceId of activeServiceIds) {
      const record =
        managedProcesses.get(serviceId) ?? adoptedProcesses.get(serviceId);
      if (record) record.stopping = true;
    }
    for (const serviceId of activeServiceIds) {
      try {
        await beginManagedProcessStop(serviceId);
      } catch {
        // The stop phase retries and reports this service with safe diagnostics.
      }
    }

    // Windows process-tree ownership inspection uses CIM/WMI. Running one
    // pipeline per service concurrently can exhaust that provider, so keep
    // each bounded convergence pass serialized on Windows.
    const passResults: Array<{
      serviceId: string;
      failures: ManagedProcessFinalizationFailure[];
    }> = [];
    if (process.platform === "win32") {
      for (const serviceId of serviceIds) {
        passResults.push({ serviceId, failures: await stopOne(serviceId) });
      }
    } else {
      const failures = await Promise.all(serviceIds.map(stopOne));
      passResults.push(
        ...serviceIds.map((serviceId, index) => ({
          serviceId,
          failures: failures[index] ?? [],
        })),
      );
    }
    for (const { serviceId, failures } of passResults) {
      if (failures.length === 0) {
        unresolvedFailures.delete(serviceId);
      } else {
        unresolvedFailures.set(serviceId, failures);
      }
    }

    await new Promise<void>((resolve) => setImmediate(resolve));
    const stillTracked = new Set([
      ...managedProcesses.keys(),
      ...adoptedProcesses.keys(),
      ...managedProcessFinalizers.keys(),
    ]);
    for (const [serviceId, failures] of unresolvedFailures) {
      if (
        !stillTracked.has(serviceId) &&
        failures.every((failure) => failure.phase === "stop")
      ) {
        unresolvedFailures.delete(serviceId);
      }
    }
    if (
      pass === MAX_FINALIZATION_PASSES &&
      (managedProcesses.size > 0 ||
        adoptedProcesses.size > 0 ||
        managedProcessFinalizers.size > 0)
    ) {
      for (const serviceId of new Set([
        ...managedProcesses.keys(),
        ...adoptedProcesses.keys(),
        ...managedProcessFinalizers.keys(),
      ])) {
        const priorFailures = unresolvedFailures.get(serviceId) ?? [];
        unresolvedFailures.set(serviceId, [
          ...priorFailures,
          {
            serviceId,
            pid:
              managedProcesses.get(serviceId)?.child.pid ??
              adoptedProcesses.get(serviceId)?.pid ??
              managedProcessFinalizers.get(serviceId)?.pid ??
              null,
            phase: "finalize",
            code: "FINALIZATION_DID_NOT_CONVERGE",
          },
        ]);
      }
    }
  }
  const failures = [...unresolvedFailures.values()].flat();

  if (failures.length > 0) {
    throw new ManagedProcessFinalizationError(failures);
  }
}
