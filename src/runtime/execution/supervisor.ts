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
import { inspectProcess, type ProcessFingerprint } from "../process/identity.js";
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
  treeTerminationPromise: Promise<ProcessTreeTerminationResult> | null;
  exitPromise: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>;
  finalizePromise: Promise<void>;
}

interface AdoptedProcessRecord {
  service: DiscoveredService;
  pid: number;
  startedAt: string;
  command: string;
  stopping: boolean;
  workspaceRoot: string;
  rootIdentity: ProcessFingerprint;
  processGroup: ProcessOwnershipEntry["processGroup"];
  knownTreeMembers: ProcessFingerprint[];
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
const managedProcessFinalizers = new Map<string, Promise<void>>();
const adoptedProcesses = new Map<string, AdoptedProcessRecord>();
const ADOPTED_PROCESS_POLL_INTERVAL_MS = 250;

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

export function hasManagedProcess(serviceId: string): boolean {
  return managedProcesses.has(serviceId) || adoptedProcesses.has(serviceId);
}

function managedProcessTreeTarget(record: ManagedProcessRecord): OwnedProcessTreeTarget {
  return {
    rootPid: record.child.pid ?? 0,
    rootIdentity: record.rootIdentity,
    processGroup: record.processGroup,
    knownMembers: record.knownTreeMembers,
  };
}

function adoptedProcessTreeTarget(record: AdoptedProcessRecord): OwnedProcessTreeTarget {
  return {
    rootPid: record.pid,
    rootIdentity: record.rootIdentity,
    processGroup: record.processGroup,
    knownMembers: record.knownTreeMembers,
  };
}

async function adoptedProcessPollDelay(): Promise<void> {
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, ADOPTED_PROCESS_POLL_INTERVAL_MS);
    timeout.unref?.();
  });
}

async function refreshAdoptedProcessTreeMembers(record: AdoptedProcessRecord): Promise<void> {
  const members = await captureOwnedProcessTreeMembers({
    rootPid: record.pid,
    rootIdentity: record.rootIdentity,
    processGroup: record.processGroup,
  });
  if (members.length > 0) {
    record.knownTreeMembers = members;
  }
}

async function monitorManagedProcessTree(record: ManagedProcessRecord): Promise<void> {
  if (process.platform !== "win32") {
    return;
  }

  const serviceId = record.service.manifest.id;
  while (managedProcesses.get(serviceId) === record && !record.treeTerminationPromise) {
    try {
      const members = await captureOwnedProcessTreeMembers(managedProcessTreeTarget(record));
      if (members.length > 0) {
        record.knownTreeMembers = members;
      }
    } catch {
      // Process inspection can fail transiently; retain the last verified snapshot.
    }
    await adoptedProcessPollDelay();
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
  adoptedProcesses.delete(serviceId);
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
}

async function monitorAdoptedProcess(record: AdoptedProcessRecord): Promise<void> {
  const serviceId = record.service.manifest.id;
  while (adoptedProcesses.get(serviceId) === record && !record.stopping) {
    await adoptedProcessPollDelay();
    if (adoptedProcesses.get(serviceId) !== record || record.stopping) {
      return;
    }

    try {
      const ownership = await findProcessOwnership(record.workspaceRoot, "service", serviceId);
      if (!ownership) {
        return;
      }
      const status = await classifyRegisteredProcess(ownership);
      if (status === "owned") {
        await refreshAdoptedProcessTreeMembers(record);
        continue;
      }
      if (status === "not_running" || status === "identity_mismatch") {
        await finalizeAdoptedProcessExit(record);
        return;
      }
    } catch {
      // Process inspection can fail transiently; retain durable ownership and retry.
    }
  }
}

export async function beginManagedProcessStop(serviceId: string): Promise<boolean> {
  const record = managedProcesses.get(serviceId);
  if (record) {
    record.stopping = true;
    if (record.workspaceRoot) {
      await transitionProcessOwnership(record.workspaceRoot, "service", serviceId, "stopping", undefined, record.child.pid);
    }
    return true;
  }

  const adopted = adoptedProcesses.get(serviceId);
  if (adopted) {
    adopted.stopping = true;
    await transitionProcessOwnership(adopted.workspaceRoot, "service", serviceId, "stopping", undefined, adopted.pid);
    return true;
  }

  return false;
}

export async function adoptManagedProcess(options: AdoptManagedProcessOptions): Promise<ManagedProcessHandle> {
  const { service, pid, startedAt, command, workspaceRoot } = options;
  const serviceId = service.manifest.id;

  const priorFinalizer = managedProcessFinalizers.get(serviceId);
  if (priorFinalizer) {
    await priorFinalizer;
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
    workspaceRoot,
    rootIdentity: ownership.identity,
    processGroup: ownership.processGroup,
    knownTreeMembers: [],
  };
  await refreshAdoptedProcessTreeMembers(record);
  adoptedProcesses.set(serviceId, record);
  void monitorAdoptedProcess(record).catch(() => undefined);

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
    await priorFinalizer;
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

  const executable = resolveExecutable(service, executionPlan);
  const workingDirectory = resolveWorkingDirectory(service, executionPlan, executable);
  const args = resolveCommandRootArgs(
    service,
    executionPlan,
    resolveExecutionArgs(service, executionPlan, sharedGlobalEnv, resolvedPorts, variableResolution),
  );
  const command = buildCommandString(executable, args);
  const startedAt = new Date().toISOString();
  const { paths: logPaths, streams: logStreams } = await prepareRuntimeLogStreams(service.serviceRoot, startedAt);

  const child = spawn(executable, args, {
    cwd: workingDirectory,
    env: buildProcessEnvironment(service, executionPlan, sharedGlobalEnv, resolvedPorts, secureEnv, variableResolution),
    stdio: ["ignore", "pipe", "pipe"],
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
  const rootInspection = rootPid > 0 ? await inspectProcess(rootPid) : null;
  let rootIdentity = rootInspection?.status === "running" ? rootInspection.identity : null;

  const record: ManagedProcessRecord = {
    child,
    service,
    startedAt,
    command,
    stopping: false,
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
    treeTerminationPromise: null,
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
  void monitorManagedProcessTree(record).catch(() => undefined);
  const logFinalizePromise = record.finalizePromise;
  const lifecycleFinalizePromise = exitPromise.then(async ({ exitCode, signal }) => {
    record.treeTerminationPromise ??= terminateOwnedProcessTree(managedProcessTreeTarget(record), 5_000);
    await record.treeTerminationPromise;
    await new Promise<void>((resolve) => setImmediate(resolve));
    record.exitCode = exitCode;
    record.exitSignal = signal;

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
  });
  record.finalizePromise = Promise.all([
    logFinalizePromise,
    lifecycleFinalizePromise,
  ]).then(() => undefined);
  managedProcessFinalizers.set(serviceId, record.finalizePromise);

  const clearFinalizer = () => {
    if (managedProcessFinalizers.get(serviceId) === record.finalizePromise) {
      managedProcessFinalizers.delete(serviceId);
    }
  };
  void record.finalizePromise.then(clearFinalizer, clearFinalizer);

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

  await beginManagedProcessStop(serviceId);
  record.treeTerminationPromise ??= terminateOwnedProcessTree(managedProcessTreeTarget(record), timeoutMs);
  await record.treeTerminationPromise;
  const result = await record.exitPromise;
  const finalizer = managedProcessFinalizers.get(serviceId);
  if (finalizer) {
    await finalizer;
  }

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

  await beginManagedProcessStop(serviceId);
  const ownership = await findProcessOwnership(record.workspaceRoot, "service", serviceId);
  const status = ownership ? await classifyRegisteredProcess(ownership) : "not_running";
  if (status === "unknown_owner") {
    throw new Error(`Cannot stop service "${serviceId}" because its adopted process owner is unverifiable.`);
  }
  const terminationTarget = status === "owned"
    ? adoptedProcessTreeTarget(record)
    : {
        ...adoptedProcessTreeTarget(record),
        processGroup: { kind: "none" as const, id: null },
      };
  const termination = await terminateOwnedProcessTree(terminationTarget, timeoutMs);

  adoptedProcesses.delete(serviceId);
  await transitionProcessOwnership(record.workspaceRoot, "service", serviceId, "stopped", "not_running", record.pid);
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
    await beginManagedProcessStop(serviceId);
    const exited = await waitForAdoptedProcessExit(adopted, timeoutMs);
    if (!exited) {
      return null;
    }
    const termination = await terminateOwnedProcessTree({
      ...adoptedProcessTreeTarget(adopted),
      processGroup: { kind: "none", id: null },
    }, timeoutMs);
    adoptedProcesses.delete(serviceId);
    await transitionProcessOwnership(adopted.workspaceRoot, "service", serviceId, "stopped", "not_running", adopted.pid);
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

  const finalizer = managedProcessFinalizers.get(serviceId);
  if (finalizer) {
    await finalizer;
  }
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
  const serviceIds = [...new Set([...managedProcesses.keys(), ...adoptedProcesses.keys()])];
  await Promise.all(serviceIds.map((serviceId) => stopManagedProcess(serviceId).catch(() => null)));
}
