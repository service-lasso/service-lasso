import path from "node:path";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import type { DiscoveredService, ServiceSetupStep } from "../../contracts/service.js";
import type { ProviderExecutionPlan } from "../providers/types.js";
import { createDirectExecutionPlan } from "../providers/direct.js";
import { resolveProviderExecution } from "../providers/resolveProvider.js";
import { DependencyGraph } from "../manager/DependencyGraph.js";
import type { ServiceRegistry } from "../manager/ServiceRegistry.js";
import { isProviderRole } from "../roles.js";
import { getLifecycleState, setLifecycleState } from "../lifecycle/store.js";
import type { ServiceLifecycleState, ServiceSetupStepRunState, SetupStepStatus } from "../lifecycle/types.js";
import { startService } from "../lifecycle/actions.js";
import { waitForServiceReadiness } from "../health/waitForReadiness.js";
import { buildServiceVariables, collectRuntimeGlobalEnv, resolveServiceText } from "../operator/variables.js";
import { parseCommandlineArgs, selectPlatformCommandline } from "../execution/commandline.js";
import { writeServiceState } from "../state/writeState.js";

export interface SetupStepRunResult {
  ok: boolean;
  action: "setup";
  serviceId: string;
  stepId: string;
  state: ServiceLifecycleState;
  run: ServiceSetupStepRunState;
  message: string;
}

export interface SetupServiceResult {
  action: "setup";
  serviceId: string;
  ok: boolean;
  state: ServiceLifecycleState;
  runs: ServiceSetupStepRunState[];
  skipped: Array<{ stepId: string; reason: string }>;
  message: string;
}

export function listSetupStepIds(service: DiscoveredService): string[] {
  return Object.keys(service.manifest.setup?.steps ?? {}).sort((left, right) => left.localeCompare(right));
}

function buildRunId(stepId: string): string {
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${stepId.replace(/[^\w.-]+/g, "_")}`;
}

function getSetupRunLogPaths(serviceRoot: string, stepId: string, runId: string): ServiceSetupStepRunState["logs"] {
  const root = path.join(serviceRoot, "logs", "setup", stepId, runId);
  return {
    logPath: path.join(root, "setup.log"),
    stdoutPath: path.join(root, "stdout.log"),
    stderrPath: path.join(root, "stderr.log"),
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

function writeCombinedLogEntry(stream: WriteStream, level: "stdout" | "stderr", message: string): void {
  stream.write(`${JSON.stringify({ level, message })}\n`);
}

function attachBufferedOutput(
  source: NodeJS.ReadableStream | null,
  output: WriteStream,
  combined: WriteStream,
  level: "stdout" | "stderr",
): Promise<void> {
  if (!source) {
    return Promise.resolve();
  }

  let buffer = "";
  source.setEncoding("utf8");

  const flush = (flushRemainder = false) => {
    const parts = buffer.replace(/\r\n/g, "\n").split("\n");
    const remainder = flushRemainder ? "" : (parts.pop() ?? "");
    for (const line of parts) {
      output.write(`${line}\n`);
      writeCombinedLogEntry(combined, level, line);
    }
    buffer = remainder;
  };

  source.on("data", (chunk: string) => {
    buffer += chunk;
    flush();
  });

  return new Promise((resolve) => {
    source.once("end", () => {
      flush(true);
      resolve();
    });
  });
}

function isPathInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
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

function resolveWorkingDirectory(service: DiscoveredService, executionPlan: ProviderExecutionPlan, executable: string): string {
  if (!executionPlan.commandRoot) {
    return service.serviceRoot;
  }

  return path.isAbsolute(executable) && isPathInside(executionPlan.commandRoot, executable)
    ? service.serviceRoot
    : executionPlan.commandRoot;
}

function buildStepService(service: DiscoveredService, step: ServiceSetupStep): DiscoveredService {
  return {
    ...service,
    manifest: {
      ...service.manifest,
      execservice: step.execservice,
      executable: step.executable ?? service.manifest.executable,
      args: step.args ?? [],
      commandline: undefined,
      env: {
        ...(service.manifest.env ?? {}),
        ...(step.env ?? {}),
      },
    },
  };
}

function resolveStepArgs(
  service: DiscoveredService,
  step: ServiceSetupStep,
  sharedGlobalEnv: Record<string, string>,
  resolvedPorts: Record<string, number>,
): string[] {
  const commandline = selectPlatformCommandline(step.commandline);
  if (commandline) {
    return parseCommandlineArgs(resolveServiceText(commandline, service, sharedGlobalEnv, resolvedPorts));
  }

  return (step.args ?? []).map((arg) => resolveServiceText(arg, service, sharedGlobalEnv, resolvedPorts));
}

function resolveDirectExecutionPlan(
  service: DiscoveredService,
  step: ServiceSetupStep,
  sharedGlobalEnv: Record<string, string>,
  resolvedPorts: Record<string, number>,
): ProviderExecutionPlan {
  const commandline = selectPlatformCommandline(step.commandline);
  if (!step.executable && commandline) {
    const parsed = parseCommandlineArgs(resolveServiceText(commandline, service, sharedGlobalEnv, resolvedPorts));
    const [executable, ...args] = parsed;
    if (!executable) {
      throw new Error(`Setup step commandline for "${service.manifest.id}" did not resolve to an executable.`);
    }

    return {
      provider: "direct",
      providerServiceId: null,
      executable,
      args,
      commandPreview: [executable, ...args].join(" "),
      providerEnv: {},
      commandRoot: null,
    };
  }

  const plan = createDirectExecutionPlan({
    ...service.manifest,
    executable: step.executable ?? service.manifest.executable,
    args: step.args ?? [],
  });
  const args = resolveStepArgs(service, step, sharedGlobalEnv, resolvedPorts);

  return {
    ...plan,
    args,
    commandPreview: [plan.executable, ...args].join(" ").trim(),
  };
}

function resolveStepExecutionPlan(
  service: DiscoveredService,
  registry: ServiceRegistry,
  step: ServiceSetupStep,
  sharedGlobalEnv: Record<string, string>,
  resolvedPorts: Record<string, number>,
): ProviderExecutionPlan {
  if (!step.execservice) {
    return resolveDirectExecutionPlan(service, step, sharedGlobalEnv, resolvedPorts);
  }

  const plan = resolveProviderExecution(buildStepService(service, step), registry);
  const args = resolveStepArgs(service, step, sharedGlobalEnv, resolvedPorts);
  return {
    ...plan,
    args,
    commandPreview: [plan.executable, ...args].join(" ").trim(),
  };
}

function buildProcessEnvironment(
  service: DiscoveredService,
  executionPlan: ProviderExecutionPlan,
  step: ServiceSetupStep,
  sharedGlobalEnv: Record<string, string>,
  resolvedPorts: Record<string, number>,
): NodeJS.ProcessEnv {
  const serviceVariables = Object.fromEntries(
    buildServiceVariables(service, sharedGlobalEnv, resolvedPorts).variables.map((entry) => [entry.key, entry.value]),
  );
  const stepEnv = Object.fromEntries(
    Object.entries(step.env ?? {}).map(([key, value]) => [key, resolveServiceText(value, service, sharedGlobalEnv, resolvedPorts)]),
  );

  return {
    ...process.env,
    ...executionPlan.providerEnv,
    ...serviceVariables,
    ...stepEnv,
  };
}

function recordSetupRun(serviceId: string, run: ServiceSetupStepRunState): ServiceLifecycleState {
  const current = getLifecycleState(serviceId);
  const existing = current.setup.steps[run.stepId];
  return setLifecycleState(serviceId, {
    ...current,
    lastAction: "setup",
    actionHistory: [...current.actionHistory, "setup"],
    setup: {
      updatedAt: run.finishedAt,
      steps: {
        ...current.setup.steps,
        [run.stepId]: {
          status: run.status,
          lastRun: run,
          history: [...(existing?.history ?? []), run].slice(-20),
        },
      },
    },
  });
}

function shouldSkipStep(
  service: DiscoveredService,
  stepId: string,
  step: ServiceSetupStep,
  force: boolean,
): string | null {
  if (force || step.rerun === "always") {
    return null;
  }

  const prior = getLifecycleState(service.manifest.id).setup.steps[stepId];
  if (!prior || prior.status !== "succeeded") {
    return null;
  }

  return step.rerun === "manual" ? "manual step already succeeded" : "setup step already succeeded";
}

async function ensureServiceDependencyReady(
  owner: DiscoveredService,
  dependencyId: string,
  registry: ServiceRegistry,
): Promise<void> {
  const dependency = registry.getById(dependencyId);
  if (!dependency) {
    throw new Error(`Setup for "${owner.manifest.id}" depends on unknown service "${dependencyId}".`);
  }

  const dependencyState = getLifecycleState(dependencyId);
  if (!dependencyState.installed) {
    throw new Error(`Setup for "${owner.manifest.id}" requires dependency "${dependencyId}" to be installed.`);
  }
  if (!dependencyState.configured) {
    throw new Error(`Setup for "${owner.manifest.id}" requires dependency "${dependencyId}" to be configured.`);
  }

  if (isProviderRole(dependency.manifest)) {
    return;
  }

  if (!dependencyState.running) {
    const result = await startService(dependency, registry);
    await writeServiceState(dependency, result.state);
  }

  const sharedGlobalEnv = collectRuntimeGlobalEnv(registry.list());
  const readiness = await waitForServiceReadiness(dependency, sharedGlobalEnv);
  if (!readiness.ready) {
    throw new Error(`Setup for "${owner.manifest.id}" dependency "${dependencyId}" is not ready: ${readiness.message}`);
  }
}

async function ensureSetupDependencies(
  service: DiscoveredService,
  stepId: string,
  step: ServiceSetupStep,
  registry: ServiceRegistry,
  visiting: Set<string>,
): Promise<void> {
  for (const dependencyId of step.depend_on ?? []) {
    const setupDependency = dependencyId.match(/^(.+):([^:]+)$/);
    if (setupDependency) {
      const [, dependencyServiceId, dependencyStepId] = setupDependency;
      const dependencyService = registry.getById(dependencyServiceId);
      if (!dependencyService) {
        throw new Error(`Setup step "${service.manifest.id}:${stepId}" depends on unknown setup service "${dependencyServiceId}".`);
      }
      await runSetupStep(dependencyService, registry, dependencyStepId, { visiting });
      continue;
    }

    await ensureServiceDependencyReady(service, dependencyId, registry);
  }
}

export async function runSetupStep(
  service: DiscoveredService,
  registry: ServiceRegistry,
  stepId: string,
  options: { force?: boolean; visiting?: Set<string> } = {},
): Promise<SetupStepRunResult> {
  const serviceId = service.manifest.id;
  const step = service.manifest.setup?.steps?.[stepId];
  if (!step) {
    throw new Error(`Unknown setup step "${stepId}" for service "${serviceId}".`);
  }

  const visitKey = `${serviceId}:${stepId}`;
  const visiting = options.visiting ?? new Set<string>();
  if (visiting.has(visitKey)) {
    throw new Error(`Setup dependency cycle detected at "${visitKey}".`);
  }
  visiting.add(visitKey);

  const lifecycle = getLifecycleState(serviceId);
  if (!lifecycle.installed) {
    throw new Error(`Cannot run setup for service "${serviceId}" before install.`);
  }
  if (!lifecycle.configured) {
    throw new Error(`Cannot run setup for service "${serviceId}" before config.`);
  }

  const skipReason = shouldSkipStep(service, stepId, step, options.force === true);
  if (skipReason) {
    const now = new Date().toISOString();
    const prior = getLifecycleState(serviceId).setup.steps[stepId]?.lastRun;
    const run: ServiceSetupStepRunState = prior
      ? { ...prior, status: "skipped", message: skipReason }
      : {
          runId: buildRunId(stepId),
          serviceId,
          stepId,
          status: "skipped",
          startedAt: now,
          finishedAt: now,
          durationMs: 0,
          command: "",
          exitCode: null,
          signal: null,
          message: skipReason,
          logs: getSetupRunLogPaths(service.serviceRoot, stepId, buildRunId(stepId)),
        };
    visiting.delete(visitKey);
    return {
      ok: true,
      action: "setup",
      serviceId,
      stepId,
      state: getLifecycleState(serviceId),
      run,
      message: skipReason,
    };
  }

  await ensureSetupDependencies(service, stepId, step, registry, visiting);

  const sharedGlobalEnv = collectRuntimeGlobalEnv(registry.list());
  const resolvedPorts = Object.keys(lifecycle.runtime.ports).length > 0 ? lifecycle.runtime.ports : service.manifest.ports ?? {};
  const executionPlan = resolveStepExecutionPlan(service, registry, step, sharedGlobalEnv, resolvedPorts);
  const executable = resolveExecutable(service, executionPlan);
  const args = executionPlan.args;
  const command = [executable, ...args].join(" ");
  const startedAt = new Date().toISOString();
  const runId = buildRunId(stepId);
  const logs = getSetupRunLogPaths(service.serviceRoot, stepId, runId);
  await mkdir(path.dirname(logs.logPath), { recursive: true });

  const combined = createWriteStream(logs.logPath, { flags: "w" });
  const stdout = createWriteStream(logs.stdoutPath, { flags: "w" });
  const stderr = createWriteStream(logs.stderrPath, { flags: "w" });
  const child = spawn(executable, args, {
    cwd: resolveWorkingDirectory(service, executionPlan, executable),
    env: buildProcessEnvironment(service, executionPlan, step, sharedGlobalEnv, resolvedPorts),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  const stdoutDone = attachBufferedOutput(child.stdout, stdout, combined, "stdout");
  const stderrDone = attachBufferedOutput(child.stderr, stderr, combined, "stderr");
  const timeoutMs = (step.timeoutSeconds ?? 300) * 1000;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, timeoutMs);
  timeout.unref?.();

  const exit = await new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal }));
  });
  clearTimeout(timeout);
  await Promise.all([stdoutDone, stderrDone]);
  await Promise.all([closeWriteStream(combined), closeWriteStream(stdout), closeWriteStream(stderr)]);

  const finishedAt = new Date().toISOString();
  const durationMs = Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt));
  const status: SetupStepStatus = timedOut ? "timeout" : exit.exitCode === 0 ? "succeeded" : "failed";
  const message =
    status === "succeeded"
      ? `Setup step "${stepId}" completed.`
      : status === "timeout"
        ? `Setup step "${stepId}" timed out.`
        : `Setup step "${stepId}" failed with exit code ${exit.exitCode ?? "unknown"}.`;
  const run: ServiceSetupStepRunState = {
    runId,
    serviceId,
    stepId,
    status,
    startedAt,
    finishedAt,
    durationMs,
    command,
    exitCode: exit.exitCode,
    signal: exit.signal,
    message,
    logs,
  };
  const nextState = recordSetupRun(serviceId, run);
  visiting.delete(visitKey);

  return {
    ok: status === "succeeded",
    action: "setup",
    serviceId,
    stepId,
    state: nextState,
    run,
    message,
  };
}

function resolveSetupOrder(service: DiscoveredService, selectedStepId?: string): string[] {
  const steps = service.manifest.setup?.steps ?? {};
  if (selectedStepId) {
    if (!steps[selectedStepId]) {
      throw new Error(`Unknown setup step "${selectedStepId}" for service "${service.manifest.id}".`);
    }
    return [selectedStepId];
  }

  const ordered: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (stepId: string) => {
    if (visited.has(stepId)) {
      return;
    }
    if (visiting.has(stepId)) {
      throw new Error(`Setup dependency cycle detected while resolving setup for "${service.manifest.id}".`);
    }

    visiting.add(stepId);
    for (const dependencyId of steps[stepId]?.depend_on ?? []) {
      const setupDependency = dependencyId.match(/^(.+):([^:]+)$/);
      if (setupDependency && setupDependency[1] === service.manifest.id && steps[setupDependency[2]]) {
        visit(setupDependency[2]);
      }
    }
    visiting.delete(stepId);
    visited.add(stepId);
    ordered.push(stepId);
  };

  for (const stepId of Object.keys(steps).sort((left, right) => left.localeCompare(right))) {
    visit(stepId);
  }

  return ordered;
}

export async function runServiceSetup(
  service: DiscoveredService,
  registry: ServiceRegistry,
  options: { stepId?: string; force?: boolean; includeManual?: boolean } = {},
): Promise<SetupServiceResult> {
  const stepIds = resolveSetupOrder(service, options.stepId);
  const runs: ServiceSetupStepRunState[] = [];
  const skipped: SetupServiceResult["skipped"] = [];

  for (const stepId of stepIds) {
    const step = service.manifest.setup?.steps?.[stepId];
    if (!step) {
      continue;
    }

    if (!options.stepId && step.rerun === "manual" && options.includeManual !== true) {
      skipped.push({ stepId, reason: "manual setup step" });
      continue;
    }

    const result = await runSetupStep(service, registry, stepId, { force: options.force });
    if (result.run.status === "skipped") {
      skipped.push({ stepId, reason: result.run.message });
      continue;
    }
    runs.push(result.run);

    if (!result.ok) {
      return {
        action: "setup",
        serviceId: service.manifest.id,
        ok: false,
        state: result.state,
        runs,
        skipped,
        message: result.message,
      };
    }
  }

  return {
    action: "setup",
    serviceId: service.manifest.id,
    ok: true,
    state: getLifecycleState(service.manifest.id),
    runs,
    skipped,
    message: runs.length > 0 ? `Setup completed for "${service.manifest.id}".` : `No setup steps ran for "${service.manifest.id}".`,
  };
}

export async function ensureStartupDependenciesForSetup(service: DiscoveredService, registry: ServiceRegistry): Promise<void> {
  const graph = new DependencyGraph(registry);
  for (const dependencyId of graph.getStartupOrder(service.manifest.id)) {
    await ensureServiceDependencyReady(service, dependencyId, registry);
  }
}
