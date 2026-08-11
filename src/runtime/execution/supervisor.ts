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
  recordProcessOwnership,
  reconcileRegisteredProcess,
  transitionProcessOwnership,
} from "../process/registry.js";
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
}

interface StartProcessOptions {
  service: DiscoveredService;
  executionPlan: ProviderExecutionPlan;
  sharedGlobalEnv?: Record<string, string>;
  resolvedPorts?: Record<string, number>;
  secureEnv?: Record<string, string>;
  variableResolution?: ServiceVariableResolutionOptions;
  workspaceRoot?: string;
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

async function waitForCommandExit(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve) => {
    const child = spawn(command, args, {
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("close", () => resolve());
    child.once("error", () => resolve());
  });
}

async function forceKillProcessTree(pid: number): Promise<void> {
  if (!pid) {
    return;
  }

  if (process.platform === "win32") {
    await waitForCommandExit("taskkill", ["/pid", String(pid), "/t", "/f"]);
    return;
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // The process may have exited between the timeout and forced kill.
  }
}

async function forceKillManagedProcessTree(child: ChildProcess): Promise<void> {
  if (child.pid) {
    await forceKillProcessTree(child.pid);
  }
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

  adoptedProcesses.set(serviceId, {
    service,
    pid,
    startedAt,
    command,
    stopping: false,
    workspaceRoot,
  });

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
    exitPromise,
    finalizePromise: Promise.resolve(),
  };
  attachRuntimeLogCapture(record);

  if (workspaceRoot) {
    try {
      const network = buildServiceNetwork(service, sharedGlobalEnv, resolvedPorts);
      await recordProcessOwnership(workspaceRoot, {
        ownerType: "service",
        ownerId: serviceId,
        serviceId,
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
      });
    } catch (error) {
      try {
        child.kill();
      } catch {
        // The child may have exited before ownership evidence was persisted.
      }
      const exited = await Promise.race([
        exitPromise.then(() => true),
        new Promise<boolean>((resolve) => {
          const timeout = setTimeout(() => resolve(false), 250);
          timeout.unref?.();
        }),
      ]);
      if (!exited) {
        await forceKillManagedProcessTree(child);
        await exitPromise;
      }
      await record.finalizePromise;
      throw error;
    }
  }

  managedProcesses.set(serviceId, record);
  const logFinalizePromise = record.finalizePromise;
  const lifecycleFinalizePromise = exitPromise.then(async ({ exitCode, signal }) => {
    await new Promise<void>((resolve) => setImmediate(resolve));
    const current = managedProcesses.get(serviceId);
    if (current?.child === child) {
      managedProcesses.delete(serviceId);
    }

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

  if (!record.child.killed) {
    record.child.kill();
  }

  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    timeout = setTimeout(() => {
      void forceKillManagedProcessTree(record.child).finally(() => {
        resolve({ exitCode: null, signal: "SIGKILL" });
      });
    }, timeoutMs);
    timeout.unref?.();
  });

  const result = await Promise.race([record.exitPromise, timeoutPromise]);
  if (timeout) {
    clearTimeout(timeout);
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

async function waitForAdoptedProcessExit(
  record: AdoptedProcessRecord,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await reconcileRegisteredProcess(record.workspaceRoot, "service", record.service.manifest.id);
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
  const status = await reconcileRegisteredProcess(record.workspaceRoot, "service", serviceId);
  if (status === "unknown_owner") {
    throw new Error(`Cannot stop service "${serviceId}" because its adopted process owner is unverifiable.`);
  }
  if (status === "not_running" || status === "identity_mismatch") {
    adoptedProcesses.delete(serviceId);
    return { exitCode: 0, signal: null };
  }

  try {
    process.kill(record.pid);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      throw error;
    }
  }

  const exited = await waitForAdoptedProcessExit(record, timeoutMs);
  if (!exited) {
    await forceKillProcessTree(record.pid);
    await waitForAdoptedProcessExit(record, timeoutMs);
    adoptedProcesses.delete(serviceId);
    await transitionProcessOwnership(record.workspaceRoot, "service", serviceId, "stopped", "not_running", record.pid);
    return { exitCode: null, signal: "SIGKILL" };
  }

  adoptedProcesses.delete(serviceId);
  await transitionProcessOwnership(record.workspaceRoot, "service", serviceId, "stopped", "not_running", record.pid);
  return { exitCode: 0, signal: null };
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
    adoptedProcesses.delete(serviceId);
    await transitionProcessOwnership(adopted.workspaceRoot, "service", serviceId, "stopped", "not_running", adopted.pid);
    return { exitCode: 0, signal: null };
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
