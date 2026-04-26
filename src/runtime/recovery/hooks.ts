import path from "node:path";
import { spawn } from "node:child_process";
import type { DiscoveredService, ServiceHookFailurePolicy, ServiceHookStep, ServiceLifecycleHooks } from "../../contracts/service.js";

export type ServiceHookPhase = keyof ServiceLifecycleHooks;

export interface LifecycleHookStepResult {
  phase: ServiceHookPhase;
  name: string;
  command: string;
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
  failurePolicy: ServiceHookFailurePolicy;
  stdout: string;
  stderr: string;
  startedAt: string;
  finishedAt: string;
}

export interface LifecycleHookPhaseResult {
  phase: ServiceHookPhase;
  ok: boolean;
  blocked: boolean;
  steps: LifecycleHookStepResult[];
}

function resolveTimeoutMs(step: ServiceHookStep): number {
  return (step.timeoutSeconds ?? 30) * 1000;
}

function resolveFailurePolicy(step: ServiceHookStep): ServiceHookFailurePolicy {
  return step.failurePolicy ?? "block";
}

function resolveStepCwd(service: DiscoveredService, step: ServiceHookStep): string {
  if (!step.cwd) {
    return service.serviceRoot;
  }

  return path.isAbsolute(step.cwd) ? step.cwd : path.resolve(service.serviceRoot, step.cwd);
}

async function runHookStep(
  service: DiscoveredService,
  phase: ServiceHookPhase,
  step: ServiceHookStep,
): Promise<LifecycleHookStepResult> {
  const startedAt = new Date().toISOString();
  const failurePolicy = resolveFailurePolicy(step);
  const child = spawn(step.command, step.args ?? [], {
    cwd: resolveStepCwd(service, step),
    env: {
      ...process.env,
      ...(step.env ?? {}),
      SERVICE_ID: service.manifest.id,
      SERVICE_ROOT: service.serviceRoot,
      SERVICE_HOOK_PHASE: phase,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  let timedOut = false;

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, resolveTimeoutMs(step));
  timeout.unref?.();

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(typeof code === "number" ? code : null));
  }).finally(() => clearTimeout(timeout));

  const ok = !timedOut && exitCode === 0;
  return {
    phase,
    name: step.name,
    command: [step.command, ...(step.args ?? [])].join(" "),
    ok,
    exitCode,
    timedOut,
    failurePolicy,
    stdout,
    stderr,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}

export async function runLifecycleHookPhase(
  service: DiscoveredService,
  phase: ServiceHookPhase,
): Promise<LifecycleHookPhaseResult> {
  const steps = service.manifest.hooks?.[phase] ?? [];
  const results: LifecycleHookStepResult[] = [];

  for (const step of steps) {
    const result = await runHookStep(service, phase, step);
    results.push(result);
    if (!result.ok && result.failurePolicy === "block") {
      return {
        phase,
        ok: false,
        blocked: true,
        steps: results,
      };
    }
  }

  return {
    phase,
    ok: results.every((step) => step.ok || step.failurePolicy !== "block"),
    blocked: false,
    steps: results,
  };
}
