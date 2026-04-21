import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import type { DiscoveredService } from "../../contracts/service.js";
import { buildServiceVariables } from "../operator/variables.js";
import type { ProviderExecutionPlan } from "../providers/types.js";

export interface ManagedProcessHandle {
  pid: number;
  startedAt: string;
  command: string;
}

interface ManagedProcessRecord {
  child: ChildProcess;
  service: DiscoveredService;
  startedAt: string;
  command: string;
  stopping: boolean;
  exitCode: number | null;
  exitSignal: NodeJS.Signals | null;
  exitPromise: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>;
}

interface StartProcessOptions {
  service: DiscoveredService;
  executionPlan: ProviderExecutionPlan;
  sharedGlobalEnv?: Record<string, string>;
  resolvedPorts?: Record<string, number>;
  onExit?: (payload: {
    service: DiscoveredService;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    wasStopping: boolean;
  }) => Promise<void> | void;
}

const managedProcesses = new Map<string, ManagedProcessRecord>();

function resolveExecutable(service: DiscoveredService, executionPlan: ProviderExecutionPlan): string {
  const executable = executionPlan.executable;

  if (
    executionPlan.provider === "direct" &&
    (path.isAbsolute(executable) || executable.startsWith(".") || executable.includes("/") || executable.includes("\\"))
  ) {
    return path.resolve(service.serviceRoot, executable);
  }

  return executable;
}

function buildCommandString(executable: string, args: string[]): string {
  return [executable, ...args].join(" ");
}

function buildProcessEnvironment(
  service: DiscoveredService,
  executionPlan: ProviderExecutionPlan,
  sharedGlobalEnv: Record<string, string> = {},
  resolvedPorts: Record<string, number> = {},
): NodeJS.ProcessEnv {
  const serviceVariables = Object.fromEntries(
    buildServiceVariables(service, sharedGlobalEnv, resolvedPorts).variables.map((entry) => [entry.key, entry.value]),
  );

  return {
    ...process.env,
    ...executionPlan.providerEnv,
    ...serviceVariables,
  };
}

export function hasManagedProcess(serviceId: string): boolean {
  return managedProcesses.has(serviceId);
}

export async function startManagedProcess(options: StartProcessOptions): Promise<ManagedProcessHandle> {
  const { service, executionPlan, sharedGlobalEnv, resolvedPorts, onExit } = options;
  const serviceId = service.manifest.id;

  if (managedProcesses.has(serviceId)) {
    throw new Error(`Service "${serviceId}" already has a managed process.`);
  }

  const executable = resolveExecutable(service, executionPlan);
  const args = executionPlan.args;
  const command = buildCommandString(executable, args);
  const startedAt = new Date().toISOString();

  const child = spawn(executable, args, {
    cwd: service.serviceRoot,
    env: buildProcessEnvironment(service, executionPlan, sharedGlobalEnv, resolvedPorts),
    stdio: "ignore",
    windowsHide: true,
  });

  const exitPromise = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once("exit", (exitCode, signal) => {
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

  await spawnPromise;

  const record: ManagedProcessRecord = {
    child,
    service,
    startedAt,
    command,
    stopping: false,
    exitCode: null,
    exitSignal: null,
    exitPromise,
  };

  managedProcesses.set(serviceId, record);

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

  return {
    pid: child.pid ?? 0,
    startedAt,
    command,
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

  return Promise.race([record.exitPromise, timeoutPromise]);
}

export async function stopAllManagedProcesses(): Promise<void> {
  const serviceIds = [...managedProcesses.keys()];
  await Promise.all(serviceIds.map((serviceId) => stopManagedProcess(serviceId).catch(() => null)));
}
