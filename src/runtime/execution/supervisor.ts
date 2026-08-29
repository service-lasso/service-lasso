import path from "node:path";
import { mkdir } from "node:fs/promises";
import { createWriteStream, type WriteStream } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import type { DiscoveredService } from "../../contracts/service.js";
import { resolveExecutionArgs, selectPlatformCommandline } from "./commandline.js";
import { buildServiceVariables, type ServiceVariableResolutionOptions } from "../operator/variables.js";
import { buildServiceNetwork } from "../operator/network.js";
import { archiveRuntimeLogs, buildServiceRuntimeLogRunId, getServiceRuntimeLogPaths, type ServiceRuntimeLogPaths } from "../operator/logs.js";
import { getLifecycleState, setLifecycleState } from "../lifecycle/store.js";
import { writeServiceState } from "../state/writeState.js";
import {
  classifyRegisteredProcess,
  findProcessOwnership,
  recordProcessOwnership,
  reconcileRegisteredProcess,
  transitionProcessOwnership,
  type ProcessOwnershipEntry,
} from "../process/registry.js";
import { inspectProcess, type ProcessFingerprint, type ProcessInspection } from "../process/identity.js";
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
  variableCapturePromise: Promise<void>;
  workspaceRoot: string | null;
  rootIdentity: ProcessFingerprint | null;
  processGroup: ProcessOwnershipEntry["processGroup"];
  knownTreeMembers: ProcessFingerprint[];
  treeMonitorPromise: Promise<void>;
  treeMonitorAbortController: AbortController;
  treeTerminationPromise: Promise<ProcessTreeTerminationResult> | null;
  stopDeadlineMs: number | null;
  exitPromise: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>;
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
    super(`Managed process finalization failed: ${failures.map((failure) => (
      `service "${failure.serviceId}" (pid ${failure.pid ?? "unknown"}, phase ${failure.phase}, code ${failure.code})`
    )).join("; ")}.`);
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
  verifyBeforeSpawn?: () => Promise<void>;
  onExit?: (payload: {
    service: DiscoveredService;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    wasStopping: boolean;
  }) => Promise<void> | void;
}

interface AdoptManagedProcessOptions {
  service: DiscoveredService;
  pid: number;
  startedAt: string;
  command: string;
  workspaceRoot: string;
}

const managedProcesses = new Map<string, ManagedProcessRecord>();
const managedProcessFinalizers = new Map<string, { pid: number | null; promise: Promise<void> }>();
const adoptedProcesses = new Map<string, AdoptedProcessRecord>();
const workspaceFinalizationTails = new Map<string, Promise<void>>();
const managedProcessShutdownQuiescers = new Set<(
  serviceIds: ReadonlySet<string>,
) => Promise<void> | void>();
const ADOPTED_PROCESS_POLL_INTERVAL_MS = 250;
const WINDOWS_TREE_MONITOR_INSPECTION_TIMEOUT_MS = 1_000;
let managedProcessTreeTerminator = terminateOwnedProcessTree;
let managedProcessRootInspector = inspectProcess;

export function setManagedProcessTreeTerminatorForTests(
  terminator: typeof terminateOwnedProcessTree | null,
): void {
  if (process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS !== "1") {
    throw new Error("Managed process-tree test hooks require SERVICE_LASSO_ENABLE_TEST_HOOKS=1.");
  }
  managedProcessTreeTerminator = terminator ?? terminateOwnedProcessTree;
}

export function setManagedProcessRootInspectorForTests(
  inspector: ((pid: number) => Promise<ProcessInspection>) | null,
): void {
  if (process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS !== "1") {
    throw new Error("Managed process-root test hooks require SERVICE_LASSO_ENABLE_TEST_HOOKS=1.");
  }
  managedProcessRootInspector = inspector ?? inspectProcess;
}

export function registerManagedProcessShutdownQuiescer(
  quiescer: (serviceIds: ReadonlySet<string>) => Promise<void> | void,
): () => void {
  managedProcessShutdownQuiescers.add(quiescer);
  return () => managedProcessShutdownQuiescers.delete(quiescer);
}

function safeFinalizationErrorCode(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    const normalized = error.code.trim().toUpperCase();
    if (/^[A-Z0-9_]{1,64}$/.test(normalized)) {
      return normalized;
    }
  }
  if (error instanceof Error && error.message.startsWith("Timed out waiting for workspace lifecycle lock:")) {
    return "WORKSPACE_LOCK_TIMEOUT";
  }
  return fallback;
}

async function withSerializedWorkspaceFinalization<T>(workspaceRoot: string, action: () => Promise<T>): Promise<T> {
  const resolvedRoot = path.resolve(workspaceRoot);
  const key = process.platform === "win32" ? resolvedRoot.toLowerCase() : resolvedRoot;
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

function trackManagedProcessFinalizer(serviceId: string, pid: number | null, promise: Promise<void>): void {
  const tracked = { pid, promise };
  managedProcessFinalizers.set(serviceId, tracked);
  const clearFinalizer = () => {
    if (managedProcessFinalizers.get(serviceId) === tracked) {
      managedProcessFinalizers.delete(serviceId);
    }
  };
  // Successful finalizers need no further observation. Failed finalizers stay
  // registered until a shutdown/start boundary consumes their safe failure.
  void promise.then(clearFinalizer, () => undefined);
}

export async function waitForManagedProcessFinalization(
  serviceId: string,
  deadlineMs?: number,
): Promise<void> {
  const finalizer = managedProcessFinalizers.get(serviceId);
  if (!finalizer) {
    return;
  }

  try {
    await withProcessControlDeadline(
      async () => await finalizer.promise,
      { deadlineMs },
    );
  } catch (error) {
    // A deadline stops this waiter, not the finalizer itself. Keep the finalizer
    // registered so a later shutdown convergence pass still observes it.
    if (!isProcessControlDeadlineError(error) && managedProcessFinalizers.get(serviceId) === finalizer) {
      managedProcessFinalizers.delete(serviceId);
    }
    throw new ManagedProcessFinalizationError([{
      serviceId,
      pid: finalizer.pid,
      phase: "finalize",
      code: safeFinalizationErrorCode(error, "FINALIZER_FAILED"),
    }]);
  }
}

async function prepareRuntimeLogStreams(serviceRoot: string, startedAt: string): Promise<{
  paths: ServiceRuntimeLogPaths;
  streams: ManagedProcessRecord["logStreams"];
}> {
  await archiveRuntimeLogs(serviceRoot);
  const paths = getServiceRuntimeLogPaths(serviceRoot, buildServiceRuntimeLogRunId(startedAt));
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

async function closeRuntimeLogStreams(streams: ManagedProcessRecord["logStreams"]): Promise<void> {
  await Promise.all([closeWriteStream(streams.combined), closeWriteStream(streams.stdout), closeWriteStream(streams.stderr)]);
}

function writeCombinedLogEntry(stream: WriteStream, level: "stdout" | "stderr", message: string): void {
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
    .map(([name, pattern]) => [name, matchOutputVariable(pattern, line)] as const)
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

function attachRuntimeLogCapture(record: ManagedProcessRecord): void {
  const flushBufferedLines = (level: "stdout" | "stderr", flushRemainder = false) => {
    const bufferKey = level === "stdout" ? "stdoutBuffer" : "stderrBuffer";
    const outputStream = level === "stdout" ? record.logStreams.stdout : record.logStreams.stderr;
    const normalized = record[bufferKey].replace(/\r\n/g, "\n");
    const parts = normalized.split("\n");
    const remainder = flushRemainder ? "" : (parts.pop() ?? "");

    for (const line of parts) {
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

  record.finalizePromise = record.exitPromise.then(async () => {
    flushBufferedLines("stdout", true);
    flushBufferedLines("stderr", true);
    await record.variableCapturePromise;
    await closeRuntimeLogStreams(record.logStreams);
  });
}

function resolveExecutable(service: DiscoveredService, executionPlan: ProviderExecutionPlan): string {
  const executable = executionPlan.executable;
  const commandRoot = executionPlan.commandRoot ?? service.serviceRoot;

  if (
    executionPlan.commandRoot &&
    (path.isAbsolute(executable) || executable.startsWith(".") || executable.includes("/") || executable.includes("\\"))
  ) {
    return path.resolve(commandRoot, executable);
  }

  return executable;
}

function resolveWorkingDirectory(service: DiscoveredService, _executionPlan: ProviderExecutionPlan, _executable: string): string {
  return service.serviceRoot;
}

function isRelativePathLikeArgument(candidate: string): boolean {
  return (
    candidate.length > 0 &&
    !candidate.startsWith("-") &&
    !/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate) &&
    (candidate.startsWith(".") || candidate.includes("/") || candidate.includes("\\"))
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

function resolveCommandRootArgs(service: DiscoveredService, executionPlan: ProviderExecutionPlan, args: string[]): string[] {
  const commandRoot = executionPlan.commandRoot;
  if (!commandRoot || selectPlatformCommandline(service.manifest.commandline)) {
    return args;
  }

  return args.map((arg) => resolveCommandRootArgument(commandRoot, arg));
}

function buildCommandString(executable: string, args: string[]): string {
  return [executable, ...args].join(" ");
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
    buildServiceVariables(service, sharedGlobalEnv, resolvedPorts, variableResolution).variables.map((entry) => [entry.key, entry.value]),
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
  const workingDirectory = resolveWorkingDirectory(service, executionPlan, executable);
  const args = resolveCommandRootArgs(
    service,
    executionPlan,
    resolveExecutionArgs(service, executionPlan, sharedGlobalEnv, resolvedPorts, variableResolution),
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

export function hasManagedProcess(serviceId: string): boolean {
  return managedProcesses.has(serviceId) || adoptedProcesses.has(serviceId);
}

export interface ManagedStdinInspection {
  writable: boolean;
}

export type ManagedStdinWriteResult =
  | { ok: true; byteLength: number; newlineAppended: boolean }
  | { ok: false; code: "not_running" | "no_pipe" | "write_failed"; message: string };

/**
 * Inspect whether the live managed process still has a writable stdin pipe.
 * Adopted processes never expose a pipe.
 */
export function inspectManagedStdin(serviceId: string): ManagedStdinInspection {
  const record = managedProcesses.get(serviceId);
  const stdin = record?.child.stdin;
  return {
    writable: Boolean(record && !record.stopping && stdin && !stdin.destroyed && stdin.writable),
  };
}

/**
 * Write a bounded UTF-8 line to the managed process stdin pipe.
 * Does not spawn a shell or PTY; the service owns command interpretation.
 */
export async function writeManagedProcessStdin(
  serviceId: string,
  input: string,
): Promise<ManagedStdinWriteResult> {
  const record = managedProcesses.get(serviceId);
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

function managedProcessTreeTarget(record: ManagedProcessRecord, rootExitObserved = false): OwnedProcessTreeTarget {
  return {
    rootPid: record.child.pid ?? 0,
    rootIdentity: record.rootIdentity,
    processGroup: record.processGroup,
    knownMembers: record.knownTreeMembers,
    rootExitObserved,
    rootOwnershipProbe: () => {
      if (record.child.exitCode !== null || record.child.signalCode !== null) {
        return "exited";
      }
      let probeError = false;
      const captureProbeError = () => {
        probeError = true;
      };
      record.child.prependOnceListener("error", captureProbeError);
      try {
        // ChildProcess.kill(0) probes the exact native process handle retained
        // by Node, so a reused numeric PID cannot authorize taskkill.
        const alive = record.child.kill(0);
        return probeError ? "unverifiable" : alive ? "owned" : "exited";
      } catch {
        return "unverifiable";
      } finally {
        record.child.removeListener("error", captureProbeError);
      }
    },
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
        return await withProcessControlDeadline(
          async () => await existing,
          { deadlineMs },
        );
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
      if (record.stopping) {
        await withProcessControlDeadline(
          async () => await record.treeMonitorPromise,
          { deadlineMs },
        );
      }
      return await withProcessControlDeadline(
        async (signal) => await managedProcessTreeTerminator(
          managedProcessTreeTarget(record, rootExitObserved),
          remainingProcessControlMs(deadlineMs),
          { deadlineMs, signal },
        ),
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

function adoptedProcessTreeTarget(record: AdoptedProcessRecord): OwnedProcessTreeTarget {
  return {
    rootPid: record.pid,
    rootIdentity: record.rootIdentity,
    processGroup: record.processGroup,
    knownMembers: record.knownTreeMembers,
    forceImmediately: process.platform === "win32",
    preferFastWindowsRootIdentity: process.platform === "win32",
  };
}

async function adoptedProcessPollDelay(signal?: AbortSignal): Promise<void> {
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
    const timer = setTimeout(finish, ADOPTED_PROCESS_POLL_INTERVAL_MS);
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
  const members = await captureOwnedProcessTreeMembers({
    rootPid: record.pid,
    rootIdentity: record.rootIdentity,
    processGroup: record.processGroup,
  }, options);
  if (members.length > 0) {
    record.knownTreeMembers = members;
  }
}

async function monitorManagedProcessTree(record: ManagedProcessRecord): Promise<void> {
  if (process.platform !== "win32") {
    return;
  }

  const serviceId = record.service.manifest.id;
  while (managedProcesses.get(serviceId) === record && !record.stopping && !record.treeTerminationPromise) {
    try {
      const members = await captureOwnedProcessTreeMembers(managedProcessTreeTarget(record), {
        deadlineMs: Date.now() + WINDOWS_TREE_MONITOR_INSPECTION_TIMEOUT_MS,
        signal: record.treeMonitorAbortController.signal,
      });
      if (members.length > 0) {
        record.knownTreeMembers = members;
      }
    } catch {
      // Process inspection can fail transiently; retain the last verified snapshot.
    }
    if (!record.stopping && !record.treeMonitorAbortController.signal.aborted) {
      await adoptedProcessPollDelay(record.treeMonitorAbortController.signal);
    }
  }
}

async function finalizeAdoptedProcessExit(record: AdoptedProcessRecord): Promise<void> {
  const serviceId = record.service.manifest.id;
  if (adoptedProcesses.get(serviceId) !== record || record.stopping) {
    return;
  }

  record.stopping = true;
  try {
    await terminateOwnedProcessTree({
      ...adoptedProcessTreeTarget(record),
      processGroup: { kind: "none", id: null },
    }, 5_000);
  } catch (error) {
    record.stopping = false;
    throw error;
  }
  await withSerializedWorkspaceFinalization(record.workspaceRoot, async () => {
    await transitionProcessOwnership(record.workspaceRoot, "service", serviceId, "stopped", "not_running", record.pid);

    const current = getLifecycleState(serviceId);
    if (current.running && current.runtime.pid === record.pid) {
      const finishedAt = new Date().toISOString();
      const startedAtMs = current.runtime.startedAt ? Date.parse(current.runtime.startedAt) : Number.NaN;
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
            totalRunDurationMs: current.runtime.metrics.totalRunDurationMs + durationMs,
            lastRunDurationMs: durationMs,
          },
        },
      });
      await writeServiceState(record.service, next);
    }
    adoptedProcesses.delete(serviceId);
  });
}

async function monitorAdoptedProcess(record: AdoptedProcessRecord): Promise<void> {
  const serviceId = record.service.manifest.id;
  while (adoptedProcesses.get(serviceId) === record && !record.stopping) {
    await adoptedProcessPollDelay(record.monitorAbortController.signal);
    if (adoptedProcesses.get(serviceId) !== record || record.stopping) {
      return;
    }

    let status: Awaited<ReturnType<typeof classifyRegisteredProcess>>;
    try {
      const ownership = await findProcessOwnership(record.workspaceRoot, "service", serviceId);
      if (!ownership) {
        throw new Error(`Process ownership is missing for adopted service "${serviceId}".`);
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
): Promise<boolean> {
  const record = managedProcesses.get(serviceId);
  if (record) {
    if (deadlineMs !== undefined) {
      const priorDeadlineExpired = record.stopDeadlineMs !== null && remainingProcessControlMs(record.stopDeadlineMs) <= 0;
      record.stopDeadlineMs = priorDeadlineExpired && record.treeTerminationPromise === null
        ? deadlineMs
        : Math.min(record.stopDeadlineMs ?? deadlineMs, deadlineMs);
    }
    record.stopping = true;
    record.treeMonitorAbortController.abort();
    await withProcessControlDeadline(
      async () => await record.treeMonitorPromise,
      { deadlineMs: record.stopDeadlineMs ?? deadlineMs },
    );
    if (record.workspaceRoot && !record.stoppingPersisted) {
      await withProcessControlDeadline(
        async () => await transitionProcessOwnership(
          record.workspaceRoot as string,
          "service",
          serviceId,
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

  const adopted = adoptedProcesses.get(serviceId);
  if (adopted) {
    adopted.stopping = true;
    adopted.monitorAbortController.abort();
    const monitor = managedProcessFinalizers.get(serviceId);
    if (monitor) {
      await withProcessControlDeadline(
        async () => await monitor.promise,
        { deadlineMs },
      );
    }
    if (!adopted.stoppingPersisted) {
      await withProcessControlDeadline(
        async () => await transitionProcessOwnership(
          adopted.workspaceRoot,
          "service",
          serviceId,
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

export async function adoptManagedProcess(options: AdoptManagedProcessOptions): Promise<ManagedProcessHandle> {
  const { service, pid, startedAt, command, workspaceRoot } = options;
  const serviceId = service.manifest.id;

  const priorFinalizer = managedProcessFinalizers.get(serviceId);
  if (priorFinalizer) {
    await waitForManagedProcessFinalization(serviceId);
  }

  if (managedProcesses.has(serviceId) || adoptedProcesses.has(serviceId)) {
    throw new Error(`Service "${serviceId}" already has a managed process.`);
  }

  const status = await reconcileRegisteredProcess(workspaceRoot, "service", serviceId);
  if (status !== "owned") {
    throw new Error(`Cannot adopt service "${serviceId}" process ${pid}: persisted owner status is ${status}.`);
  }
  const ownership = await findProcessOwnership(workspaceRoot, "service", serviceId);
  if (!ownership?.identity || ownership.pid !== pid) {
    throw new Error(`Cannot adopt service "${serviceId}" process ${pid}: verified ownership evidence is missing.`);
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
    monitorAbortController: new AbortController(),
  };
  await refreshAdoptedProcessTreeMembers(record);
  adoptedProcesses.set(serviceId, record);
  trackManagedProcessFinalizer(serviceId, pid, monitorAdoptedProcess(record));

  return {
    pid,
    startedAt,
    command,
    logs: getServiceRuntimeLogPaths(service.serviceRoot, buildServiceRuntimeLogRunId(startedAt)),
  };
}

export async function startManagedProcess(options: StartProcessOptions): Promise<ManagedProcessHandle> {
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

  const priorFinalizer = managedProcessFinalizers.get(serviceId);
  if (priorFinalizer) {
    await waitForManagedProcessFinalization(serviceId);
  }

  if (managedProcesses.has(serviceId) || adoptedProcesses.has(serviceId)) {
    throw new Error(`Service "${serviceId}" already has a managed process.`);
  }
  if (workspaceRoot) {
    const persistedStatus = await reconcileRegisteredProcess(workspaceRoot, "service", serviceId);
    if (persistedStatus === "owned") {
      throw new Error(`Service "${serviceId}" already has a verified process in the workspace ownership registry.`);
    }
    if (persistedStatus === "unknown_owner") {
      throw new Error(`Service "${serviceId}" has an unverifiable persisted process owner; refusing to launch a replacement.`);
    }
  }

  const {
    executable,
    args,
    workingDirectory,
    environment,
  } = resolveManagedProcessLaunch(
    service,
    executionPlan,
    sharedGlobalEnv,
    resolvedPorts,
    secureEnv,
    variableResolution,
  );
  const command = buildCommandString(executable, args);
  const startedAt = new Date().toISOString();
  const { paths: logPaths, streams: logStreams } = await prepareRuntimeLogStreams(service.serviceRoot, startedAt);
  const stdinEnabled = serviceEnablesStdin(service);

  try {
    await options.verifyBeforeSpawn?.();
  } catch (error) {
    await closeRuntimeLogStreams(logStreams);
    throw error;
  }
  const child = spawn(executable, args, {
    cwd: workingDirectory,
    env: environment,
    stdio: [stdinEnabled ? "pipe" : "ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
    windowsHide: true,
  });

  const exitPromise = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once("close", (exitCode, signal) => {
      resolve({
        exitCode: typeof exitCode === "number" ? exitCode : null,
        signal,
      });
    });
  });

  const spawnPromise = new Promise<void>((resolve, reject) => {
    child.once("spawn", () => resolve());
    child.once("error", reject);
  });

  try {
    await spawnPromise;
  } catch (error) {
    await closeRuntimeLogStreams(logStreams);
    throw error;
  }

  const rootPid = child.pid ?? 0;
  const processGroup = createSpawnProcessGroup(rootPid);
  const rootInspection = rootPid > 0 ? await managedProcessRootInspector(rootPid) : null;
  let rootIdentity = rootInspection?.status === "running" ? rootInspection.identity : null;

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
    variableCapturePromise: Promise.resolve(),
    workspaceRoot: workspaceRoot ?? null,
    rootIdentity,
    processGroup,
    knownTreeMembers: [],
    treeMonitorPromise: Promise.resolve(),
    treeMonitorAbortController: new AbortController(),
    treeTerminationPromise: null,
    stopDeadlineMs: null,
    exitPromise,
    finalizePromise: Promise.resolve(),
  };
  attachRuntimeLogCapture(record);

  if (workspaceRoot) {
    try {
      const network = buildServiceNetwork(service, sharedGlobalEnv, resolvedPorts);
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
          .filter((endpoint): endpoint is typeof endpoint & { url: string } => typeof endpoint.url === "string")
          .map((endpoint) => ({ name: endpoint.label, url: endpoint.url })),
        lifecycleState: "launching",
        source: "spawn",
        processGroup,
      });
      rootIdentity = ownership.identity;
      record.rootIdentity = ownership.identity;
    } catch (error) {
      await terminateOwnedProcessTree({ rootPid, rootIdentity, processGroup }, 250).catch(() => undefined);
      await exitPromise;
      await record.finalizePromise;
      throw error;
    }
  }

  managedProcesses.set(serviceId, record);
  record.treeMonitorPromise = monitorManagedProcessTree(record).catch(() => undefined);
  const logFinalizePromise = record.finalizePromise;
  const lifecycleFinalizePromise = exitPromise.then(async ({ exitCode, signal }) => {
    const finalizationDeadlineMs = record.stopDeadlineMs !== null && remainingProcessControlMs(record.stopDeadlineMs) > 0
      ? record.stopDeadlineMs
      : processControlDeadline(5_000);
    await terminateManagedProcessTree(record, 5_000, true, true, finalizationDeadlineMs);
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

      const current = managedProcesses.get(serviceId);
      if (current?.child === child) {
        managedProcesses.delete(serviceId);
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
      await withSerializedWorkspaceFinalization(record.workspaceRoot, finalizeLifecycle);
    } else {
      await finalizeLifecycle();
    }
  });
  record.finalizePromise = Promise.all([
    logFinalizePromise,
    lifecycleFinalizePromise,
  ]).then(() => undefined);
  trackManagedProcessFinalizer(serviceId, child.pid ?? null, record.finalizePromise);

  return {
    pid: child.pid ?? 0,
    startedAt,
    command,
    logs: logPaths,
  };
}

export async function stopManagedProcess(
  serviceId: string,
  timeoutMs = 5_000,
): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null } | null> {
  const record = managedProcesses.get(serviceId);
  if (!record) {
    return await stopAdoptedProcess(serviceId, timeoutMs);
  }

  const deadlineMs = processControlDeadline(timeoutMs);
  await beginManagedProcessStop(serviceId, deadlineMs);
  await terminateManagedProcessTree(record, timeoutMs, false, false, deadlineMs);
  const result = await withProcessControlDeadline(
    async () => await record.exitPromise,
    { deadlineMs },
  );
  await waitForManagedProcessFinalization(serviceId, deadlineMs);

  return result;
}

async function waitForAdoptedProcessExit(
  record: AdoptedProcessRecord,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ownership = await findProcessOwnership(record.workspaceRoot, "service", record.service.manifest.id);
    if (!ownership) {
      return true;
    }
    const status = await classifyRegisteredProcess(ownership);
    if (status === "not_running" || status === "identity_mismatch") {
      return true;
    }
    if (status === "unknown_owner") {
      throw new Error(`Cannot verify adopted service "${record.service.manifest.id}" process owner during stop.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

async function stopAdoptedProcess(
  serviceId: string,
  timeoutMs: number,
): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null } | null> {
  const record = adoptedProcesses.get(serviceId);
  if (!record) {
    return null;
  }

  const deadlineMs = processControlDeadline(timeoutMs);
  const finalizer = managedProcessFinalizers.get(serviceId);
  await beginManagedProcessStop(serviceId, deadlineMs);
  let terminationTarget = adoptedProcessTreeTarget(record);
  if (process.platform !== "win32") {
    // POSIX process-group signaling needs this fresh registry check before it
    // targets a numeric group. On Windows, terminateOwnedProcessTree performs
    // the same fail-closed fingerprint check immediately before taskkill;
    // repeating CIM here can consume the caller's entire absolute deadline.
    const ownership = await withProcessControlDeadline(
      async () => await findProcessOwnership(record.workspaceRoot, "service", serviceId),
      { deadlineMs },
    );
    const status = ownership
      ? await withProcessControlDeadline(
          async (signal) => await classifyRegisteredProcess(ownership, { deadlineMs, signal }),
          { deadlineMs },
        )
      : "not_running";
    if (status === "unknown_owner") {
      throw new Error(`Cannot stop service "${serviceId}" because its adopted process owner is unverifiable.`);
    }
    if (status !== "owned") {
      terminationTarget = {
        ...terminationTarget,
        processGroup: { kind: "none" as const, id: null },
      };
    }
  }
  const termination = await terminateOwnedProcessTree(
    terminationTarget,
    remainingProcessControlMs(deadlineMs),
    { deadlineMs },
  );

  await withProcessControlDeadline(
    async () => await withSerializedWorkspaceFinalization(record.workspaceRoot, async () => {
      await transitionProcessOwnership(record.workspaceRoot, "service", serviceId, "stopped", "not_running", record.pid);
      adoptedProcesses.delete(serviceId);
    }),
    { deadlineMs },
  );
  if (finalizer) {
    await waitForManagedProcessFinalization(serviceId, deadlineMs);
  }
  return termination.forced
    ? { exitCode: null, signal: "SIGKILL" }
    : { exitCode: 0, signal: null };
}

export async function waitForManagedProcessExit(
  serviceId: string,
  timeoutMs = 5_000,
): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null } | null> {
  const record = managedProcesses.get(serviceId);
  if (!record) {
    const adopted = adoptedProcesses.get(serviceId);
    if (!adopted) {
      return null;
    }
    const finalizer = managedProcessFinalizers.get(serviceId);
    await beginManagedProcessStop(serviceId);
    const exited = await waitForAdoptedProcessExit(adopted, timeoutMs);
    if (!exited) {
      return null;
    }
    const termination = await terminateOwnedProcessTree({
      ...adoptedProcessTreeTarget(adopted),
      processGroup: { kind: "none", id: null },
    }, timeoutMs);
    await withSerializedWorkspaceFinalization(adopted.workspaceRoot, async () => {
      await transitionProcessOwnership(adopted.workspaceRoot, "service", serviceId, "stopped", "not_running", adopted.pid);
      adoptedProcesses.delete(serviceId);
    });
    if (finalizer) {
      await waitForManagedProcessFinalization(serviceId);
    }
    return termination.forced
      ? { exitCode: null, signal: "SIGKILL" }
      : { exitCode: 0, signal: null };
  }

  await beginManagedProcessStop(serviceId);

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

  await waitForManagedProcessFinalization(serviceId);
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
  const stopOne = async (serviceId: string): Promise<ManagedProcessFinalizationFailure[]> => {
    const pid = managedProcesses.get(serviceId)?.child.pid
      ?? adoptedProcesses.get(serviceId)?.pid
      ?? managedProcessFinalizers.get(serviceId)?.pid
      ?? null;
    try {
      await stopManagedProcess(serviceId);
      await waitForManagedProcessFinalization(serviceId);
      return [];
    } catch (error) {
      if (error instanceof ManagedProcessFinalizationError) {
        if (error.failures.length > 0) {
          return error.failures;
        }
        return [{
          serviceId,
          pid,
          phase: "finalize",
          code: "FINALIZER_FAILED",
        }];
      }
      return [{
        serviceId,
        pid,
        phase: "stop",
        code: safeFinalizationErrorCode(error, "STOP_FAILED"),
      }];
    }
  };

  const unresolvedFailures = new Map<string, ManagedProcessFinalizationFailure[]>();
  for (let pass = 1; pass <= MAX_FINALIZATION_PASSES; pass += 1) {
    const activeServiceIds = [...new Set([...managedProcesses.keys(), ...adoptedProcesses.keys()])].reverse();
    const serviceIds = [
      ...activeServiceIds,
      ...[...managedProcessFinalizers.keys()].filter((serviceId) => !activeServiceIds.includes(serviceId)),
    ];
    await Promise.all([...managedProcessShutdownQuiescers].map((quiescer) => (
      quiescer(new Set(serviceIds))
    )));
    if (serviceIds.length === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (managedProcesses.size === 0 && adoptedProcesses.size === 0 && managedProcessFinalizers.size === 0) {
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
      const record = managedProcesses.get(serviceId) ?? adoptedProcesses.get(serviceId);
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
    const passResults: Array<{ serviceId: string; failures: ManagedProcessFinalizationFailure[] }> = [];
    if (process.platform === "win32") {
      for (const serviceId of serviceIds) {
        passResults.push({ serviceId, failures: await stopOne(serviceId) });
      }
    } else {
      const failures = await Promise.all(serviceIds.map(stopOne));
      passResults.push(...serviceIds.map((serviceId, index) => ({ serviceId, failures: failures[index] ?? [] })));
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
      if (!stillTracked.has(serviceId) && failures.every((failure) => failure.phase === "stop")) {
        unresolvedFailures.delete(serviceId);
      }
    }
    if (pass === MAX_FINALIZATION_PASSES && (
      managedProcesses.size > 0 || adoptedProcesses.size > 0 || managedProcessFinalizers.size > 0
    )) {
      for (const serviceId of new Set([
        ...managedProcesses.keys(),
        ...adoptedProcesses.keys(),
        ...managedProcessFinalizers.keys(),
      ])) {
        const priorFailures = unresolvedFailures.get(serviceId) ?? [];
        unresolvedFailures.set(serviceId, [...priorFailures, {
          serviceId,
          pid: managedProcesses.get(serviceId)?.child.pid
            ?? adoptedProcesses.get(serviceId)?.pid
            ?? managedProcessFinalizers.get(serviceId)?.pid
            ?? null,
          phase: "finalize",
          code: "FINALIZATION_DID_NOT_CONVERGE",
        }]);
      }
    }
  }
  const failures = [...unresolvedFailures.values()].flat();

  if (failures.length > 0) {
    throw new ManagedProcessFinalizationError(failures);
  }
}
