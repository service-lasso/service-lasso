import path from "node:path";
import { mkdir } from "node:fs/promises";
import { createWriteStream, type WriteStream } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import type { DiscoveredService } from "../../contracts/service.js";
import { resolveExecutionArgs, selectPlatformCommandline } from "./commandline.js";
import { buildServiceVariables, type ServiceVariableResolutionOptions } from "../operator/variables.js";
import { archiveRuntimeLogs, getServiceRuntimeLogPaths, type ServiceRuntimeLogPaths } from "../operator/logs.js";
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
  exitPromise: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>;
  finalizePromise: Promise<void>;
}

interface StartProcessOptions {
  service: DiscoveredService;
  executionPlan: ProviderExecutionPlan;
  sharedGlobalEnv?: Record<string, string>;
  resolvedPorts?: Record<string, number>;
  secureEnv?: Record<string, string>;
  variableResolution?: ServiceVariableResolutionOptions;
  onExit?: (payload: {
    service: DiscoveredService;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    wasStopping: boolean;
  }) => Promise<void> | void;
}

const managedProcesses = new Map<string, ManagedProcessRecord>();
const managedProcessFinalizers = new Map<string, Promise<void>>();

async function prepareRuntimeLogStreams(serviceRoot: string): Promise<{
  paths: ServiceRuntimeLogPaths;
  streams: ManagedProcessRecord["logStreams"];
}> {
  await archiveRuntimeLogs(serviceRoot);
  const paths = getServiceRuntimeLogPaths(serviceRoot);
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
  return managedProcesses.has(serviceId);
}

export async function startManagedProcess(options: StartProcessOptions): Promise<ManagedProcessHandle> {
  const { service, executionPlan, sharedGlobalEnv, resolvedPorts, secureEnv, variableResolution, onExit } = options;
  const serviceId = service.manifest.id;

  const priorFinalizer = managedProcessFinalizers.get(serviceId);
  if (priorFinalizer) {
    await priorFinalizer;
  }

  if (managedProcesses.has(serviceId)) {
    throw new Error(`Service "${serviceId}" already has a managed process.`);
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
  const { paths: logPaths, streams: logStreams } = await prepareRuntimeLogStreams(service.serviceRoot);

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
    exitPromise,
    finalizePromise: Promise.resolve(),
  };

  managedProcesses.set(serviceId, record);
  attachRuntimeLogCapture(record);
  managedProcessFinalizers.set(serviceId, record.finalizePromise);

  void exitPromise.then(async ({ exitCode, signal }) => {
    const current = managedProcesses.get(serviceId);
    if (current?.child === child) {
      managedProcesses.delete(serviceId);
    }

    record.exitCode = exitCode;
    record.exitSignal = signal;

    if (onExit) {
      await onExit({
        service,
        exitCode,
        signal,
        wasStopping: record.stopping,
      });
    }
  });

  void record.finalizePromise.finally(() => {
    if (managedProcessFinalizers.get(serviceId) === record.finalizePromise) {
      managedProcessFinalizers.delete(serviceId);
    }
  });

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
    return null;
  }

  record.stopping = true;

  if (!record.child.killed) {
    record.child.kill();
  }

  const timeoutPromise = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    setTimeout(() => {
      if (!record.child.killed) {
        record.child.kill("SIGKILL");
      }
      resolve({ exitCode: null, signal: "SIGKILL" });
    }, timeoutMs).unref?.();
  });

  const result = await Promise.race([record.exitPromise, timeoutPromise]);
  const finalizer = managedProcessFinalizers.get(serviceId);
  if (finalizer) {
    await finalizer;
  }

  return result;
}

export async function stopAllManagedProcesses(): Promise<void> {
  const serviceIds = [...managedProcesses.keys()];
  await Promise.all(serviceIds.map((serviceId) => stopManagedProcess(serviceId).catch(() => null)));
}
