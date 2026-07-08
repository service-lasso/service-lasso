import { spawn } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DiscoveredService, ServiceActionDefinition } from "../../contracts/service.js";
import { ApiError, LifecycleStateError } from "../../server/errors.js";
import { parseCommandlineArgs, selectPlatformCommandline } from "../execution/commandline.js";
import { getLifecycleState } from "../lifecycle/store.js";
import type { ServiceRegistry } from "../manager/ServiceRegistry.js";
import { buildServiceVariables, collectRuntimeGlobalEnv, resolveServiceText } from "../operator/variables.js";
import { createDirectExecutionPlan } from "../providers/direct.js";
import { resolveProviderExecution } from "../providers/resolveProvider.js";
import type { ProviderExecutionPlan } from "../providers/types.js";
import { getServiceStatePaths } from "../state/paths.js";

export type ServiceActionRunSource = "manual" | "dagu" | "scheduler";
export type ServiceActionRunStatus = "succeeded" | "failed" | "timeout";

export interface ServiceActionRunMetadata {
  source: ServiceActionRunSource;
  workflowId: string | null;
  scheduleId: string | null;
  stepId: string | null;
  parentActionId: string | null;
  actor: string | null;
  params: Record<string, unknown>;
}

export interface ServiceActionRunState {
  runId: string;
  serviceId: string;
  actionId: string;
  status: ServiceActionRunStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  command: string;
  exitCode: number | null;
  signal: string | null;
  message: string;
  metadata: ServiceActionRunMetadata;
  logs: {
    logPath: string;
    stdoutPath: string;
    stderrPath: string;
  };
}

export interface ServiceActionRunRequest {
  source?: ServiceActionRunSource;
  workflowId?: string;
  scheduleId?: string;
  stepId?: string;
  parentActionId?: string;
  actor?: string;
  params?: Record<string, unknown>;
  confirm?: boolean;
}

const activeRuns = new Set<string>();

function buildRunId(actionId: string): string {
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${actionId.replace(/[^\w.-]+/g, "_")}`;
}

function getActionRunLogPaths(serviceRoot: string, actionId: string, runId: string): ServiceActionRunState["logs"] {
  const root = path.join(serviceRoot, "logs", "actions", actionId, runId);
  return {
    logPath: path.join(root, "action.log"),
    stdoutPath: path.join(root, "stdout.log"),
    stderrPath: path.join(root, "stderr.log"),
  };
}

function getActionRunsStatePath(service: DiscoveredService): string {
  return path.join(getServiceStatePaths(service.serviceRoot).stateRoot, "action-runs.json");
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function expectOptionalString(candidate: Record<string, unknown>, field: string): string | null {
  const value = candidate[field];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiError("invalid_body", 400, `"${field}" must be a non-empty string when present.`);
  }
  return value.trim();
}

export function parseServiceActionRunRequest(input: unknown): ServiceActionRunRequest {
  if (!isRecord(input)) {
    throw new ApiError("invalid_body", 400, "Action run body must be a JSON object.");
  }

  const source = input.source ?? "manual";
  if (source !== "manual" && source !== "dagu" && source !== "scheduler") {
    throw new ApiError("invalid_body", 400, "\"source\" must be one of: manual, dagu, scheduler.");
  }

  if (input.params !== undefined && !isRecord(input.params)) {
    throw new ApiError("invalid_body", 400, "\"params\" must be a JSON object when present.");
  }

  if (input.confirm !== undefined && typeof input.confirm !== "boolean") {
    throw new ApiError("invalid_body", 400, "\"confirm\" must be a boolean when present.");
  }

  return {
    source,
    workflowId: expectOptionalString(input, "workflowId") ?? undefined,
    scheduleId: expectOptionalString(input, "scheduleId") ?? undefined,
    stepId: expectOptionalString(input, "stepId") ?? undefined,
    parentActionId: expectOptionalString(input, "parentActionId") ?? undefined,
    actor: expectOptionalString(input, "actor") ?? undefined,
    params: (input.params as Record<string, unknown> | undefined) ?? {},
    confirm: input.confirm,
  };
}

function buildRunMetadata(request: ServiceActionRunRequest): ServiceActionRunMetadata {
  return {
    source: request.source ?? "manual",
    workflowId: request.workflowId ?? null,
    scheduleId: request.scheduleId ?? null,
    stepId: request.stepId ?? null,
    parentActionId: request.parentActionId ?? null,
    actor: request.actor ?? null,
    params: request.params ?? {},
  };
}

function assertScheduledActionAllowed(
  service: DiscoveredService,
  actionId: string,
  action: ServiceActionDefinition,
  request: ServiceActionRunRequest,
): void {
  const source = request.source ?? "manual";
  if (source !== "dagu" && source !== "scheduler") {
    return;
  }

  if (!request.workflowId || !request.scheduleId) {
    throw new ApiError(
      "scheduled_metadata_required",
      400,
      `Action runs from source "${source}" require "workflowId" and "scheduleId".`,
    );
  }

  if (!action.schedules || Object.keys(action.schedules).length === 0) {
    throw new ApiError(
      "scheduled_action_not_configured",
      409,
      `Action "${actionId}" for service "${service.manifest.id}" does not declare schedules.`,
    );
  }

  const schedule = action.schedules[request.scheduleId];
  if (!schedule) {
    throw new ApiError(
      "unknown_action_schedule",
      404,
      `Unknown schedule "${request.scheduleId}" for action "${actionId}" on service "${service.manifest.id}".`,
    );
  }

  if (schedule.enabled === false) {
    throw new ApiError(
      "disabled_action_schedule",
      409,
      `Schedule "${request.scheduleId}" for action "${actionId}" on service "${service.manifest.id}" is disabled.`,
    );
  }
}

function assertActionAllowed(service: DiscoveredService, actionId: string, action: ServiceActionDefinition, request: ServiceActionRunRequest): void {
  assertScheduledActionAllowed(service, actionId, action, request);

  if (action.manualOnly && request.source !== "manual") {
    throw new ApiError("manual_only_action", 409, `Action "${actionId}" for service "${service.manifest.id}" can only be run manually.`);
  }

  if (action.requiresConfirmation && request.confirm !== true) {
    throw new ApiError(
      "confirmation_required",
      409,
      `Action "${actionId}" for service "${service.manifest.id}" requires explicit confirmation.`,
    );
  }

  const lifecycle = getLifecycleState(service.manifest.id);
  if (action.requiredState === "running" && !lifecycle.running) {
    throw new LifecycleStateError(`Cannot run action "${actionId}" for service "${service.manifest.id}" unless the service is running.`);
  }
  if (action.requiredState === "stopped" && lifecycle.running) {
    throw new LifecycleStateError(`Cannot run action "${actionId}" for service "${service.manifest.id}" unless the service is stopped.`);
  }
}

function buildActionService(
  service: DiscoveredService,
  action: ServiceActionDefinition,
  sharedGlobalEnv: Record<string, string>,
  resolvedPorts: Record<string, number>,
): DiscoveredService {
  const resolvedCommand = action.command
    ? resolveServiceText(action.command, service, sharedGlobalEnv, resolvedPorts)
    : service.manifest.executable;

  return {
    ...service,
    manifest: {
      ...service.manifest,
      executable: resolvedCommand,
      args: (action.args ?? []).map((arg) => resolveServiceText(arg, service, sharedGlobalEnv, resolvedPorts)),
      commandline: undefined,
      env: {
        ...(service.manifest.env ?? {}),
        ...(action.env ?? {}),
      },
    },
  };
}

function resolveActionExecutionPlan(
  service: DiscoveredService,
  registry: ServiceRegistry,
  action: ServiceActionDefinition,
  sharedGlobalEnv: Record<string, string>,
  resolvedPorts: Record<string, number>,
): ProviderExecutionPlan {
  const commandline = selectPlatformCommandline(action.commandline);
  if (commandline) {
    const parsed = parseCommandlineArgs(resolveServiceText(commandline, service, sharedGlobalEnv, resolvedPorts));
    const [executable, ...args] = parsed;
    if (!executable) {
      throw new ApiError("invalid_action", 400, `Action commandline for "${service.manifest.id}" did not resolve to an executable.`);
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

  if (action.mode && action.mode !== "command") {
    throw new ApiError("unsupported_action", 400, `Action mode "${action.mode}" is not supported by the run API yet.`);
  }

  if (!action.command && !service.manifest.executable && !service.manifest.execservice) {
    throw new ApiError("invalid_action", 400, `Action for "${service.manifest.id}" must declare command, commandline, or use a service executable.`);
  }

  const actionService = buildActionService(service, action, sharedGlobalEnv, resolvedPorts);
  if (service.manifest.execservice) {
    return resolveProviderExecution(actionService, registry);
  }

  return createDirectExecutionPlan(actionService.manifest);
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

function resolveWorkingDirectory(
  service: DiscoveredService,
  action: ServiceActionDefinition,
  executionPlan: ProviderExecutionPlan,
  executable: string,
  sharedGlobalEnv: Record<string, string>,
  resolvedPorts: Record<string, number>,
): string {
  if (action.cwd) {
    const cwd = resolveServiceText(action.cwd, service, sharedGlobalEnv, resolvedPorts);
    return path.isAbsolute(cwd) ? cwd : path.resolve(service.serviceRoot, cwd);
  }

  if (!executionPlan.commandRoot) {
    return service.serviceRoot;
  }

  const relative = path.relative(executionPlan.commandRoot, executable);
  return path.isAbsolute(executable) && relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? service.serviceRoot
    : executionPlan.commandRoot;
}

function buildProcessEnvironment(
  service: DiscoveredService,
  actionId: string,
  executionPlan: ProviderExecutionPlan,
  action: ServiceActionDefinition,
  metadata: ServiceActionRunMetadata,
  sharedGlobalEnv: Record<string, string>,
  resolvedPorts: Record<string, number>,
): NodeJS.ProcessEnv {
  const serviceVariables = Object.fromEntries(
    buildServiceVariables(service, sharedGlobalEnv, resolvedPorts).variables.map((entry) => [entry.key, entry.value]),
  );
  const actionEnv = Object.fromEntries(
    Object.entries(action.env ?? {}).map(([key, value]) => [key, resolveServiceText(value, service, sharedGlobalEnv, resolvedPorts)]),
  );

  return {
    ...process.env,
    ...executionPlan.providerEnv,
    ...serviceVariables,
    ...actionEnv,
    SERVICE_LASSO_ACTION_ID: actionId,
    SERVICE_LASSO_TARGET_ACTION_ID: actionId,
    SERVICE_LASSO_RUN_SOURCE: metadata.source,
    SERVICE_LASSO_WORKFLOW_ID: metadata.workflowId ?? "",
    SERVICE_LASSO_SCHEDULE_ID: metadata.scheduleId ?? "",
    SERVICE_LASSO_STEP_ID: metadata.stepId ?? "",
    SERVICE_LASSO_PARENT_ACTION_ID: metadata.parentActionId ?? "",
    SERVICE_LASSO_ACTION_PARAMS: JSON.stringify(metadata.params),
  };
}

async function readActionRuns(service: DiscoveredService): Promise<ServiceActionRunState[]> {
  try {
    const parsed = JSON.parse(await readFile(getActionRunsStatePath(service), "utf8")) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((run): run is ServiceActionRunState => isRecord(run) && typeof run.runId === "string");
  } catch (error: unknown) {
    if (isRecord(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function appendActionRun(service: DiscoveredService, run: ServiceActionRunState): Promise<void> {
  const statePath = getActionRunsStatePath(service);
  await mkdir(path.dirname(statePath), { recursive: true });
  const runs = await readActionRuns(service);
  runs.push(run);
  await writeFile(statePath, JSON.stringify(runs.slice(-100), null, 2));
}

export async function listServiceActionRuns(service: DiscoveredService, actionId?: string): Promise<ServiceActionRunState[]> {
  const runs = await readActionRuns(service);
  return actionId ? runs.filter((run) => run.actionId === actionId || run.metadata.parentActionId === actionId) : runs;
}

export async function runServiceAction(
  service: DiscoveredService,
  registry: ServiceRegistry,
  actionId: string,
  request: ServiceActionRunRequest = {},
): Promise<{ ok: boolean; serviceId: string; actionId: string; run: ServiceActionRunState; message: string }> {
  const action = service.manifest.actions?.[actionId];
  if (!action) {
    throw new ApiError("unknown_action", 404, `Unknown action "${actionId}" for service "${service.manifest.id}".`);
  }

  assertActionAllowed(service, actionId, action, request);

  const runKey = `${service.manifest.id}:${actionId}`;
  if (action.schedules && Object.values(action.schedules).some((schedule) => schedule.concurrencyPolicy === "skip-if-running") && activeRuns.has(runKey)) {
    throw new ApiError("action_already_running", 409, `Action "${actionId}" for service "${service.manifest.id}" is already running.`);
  }

  const metadata = buildRunMetadata(request);
  const lifecycle = getLifecycleState(service.manifest.id);
  const sharedGlobalEnv = collectRuntimeGlobalEnv(registry.list());
  const resolvedPorts = Object.keys(lifecycle.runtime.ports).length > 0 ? lifecycle.runtime.ports : service.manifest.ports ?? {};
  const executionPlan = resolveActionExecutionPlan(service, registry, action, sharedGlobalEnv, resolvedPorts);
  const executable = resolveExecutable(service, executionPlan);
  const args = executionPlan.args;
  const command = [executable, ...args].join(" ");
  const startedAt = new Date().toISOString();
  const runId = buildRunId(actionId);
  const logs = getActionRunLogPaths(service.serviceRoot, actionId, runId);
  await mkdir(path.dirname(logs.logPath), { recursive: true });

  activeRuns.add(runKey);
  try {
    const combined = createWriteStream(logs.logPath, { flags: "w" });
    const stdout = createWriteStream(logs.stdoutPath, { flags: "w" });
    const stderr = createWriteStream(logs.stderrPath, { flags: "w" });
    const child = spawn(executable, args, {
      cwd: resolveWorkingDirectory(service, action, executionPlan, executable, sharedGlobalEnv, resolvedPorts),
      env: buildProcessEnvironment(service, actionId, executionPlan, action, metadata, sharedGlobalEnv, resolvedPorts),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const stdoutDone = attachBufferedOutput(child.stdout, stdout, combined, "stdout");
    const stderrDone = attachBufferedOutput(child.stderr, stderr, combined, "stderr");
    const timeoutMs = (action.timeoutSeconds ?? 300) * 1000;
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
    const status: ServiceActionRunStatus = timedOut ? "timeout" : exit.exitCode === 0 ? "succeeded" : "failed";
    const message =
      status === "succeeded"
        ? `Action "${actionId}" completed.`
        : status === "timeout"
          ? `Action "${actionId}" timed out.`
          : `Action "${actionId}" failed with exit code ${exit.exitCode ?? "unknown"}.`;
    const run: ServiceActionRunState = {
      runId,
      serviceId: service.manifest.id,
      actionId,
      status,
      startedAt,
      finishedAt,
      durationMs,
      command,
      exitCode: exit.exitCode,
      signal: exit.signal,
      message,
      metadata,
      logs,
    };
    await appendActionRun(service, run);

    return {
      ok: status === "succeeded",
      serviceId: service.manifest.id,
      actionId,
      run,
      message,
    };
  } finally {
    activeRuns.delete(runKey);
  }
}
