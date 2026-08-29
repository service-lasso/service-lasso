import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import type { DiscoveredService, ServiceHookFailurePolicy, ServiceHookStep, ServiceLifecycleHooks } from "../../contracts/service.js";
import { resolveServiceEnvValue } from "../operator/variables.js";
import {
  buildExecutableInputFiles,
  type ServiceExecutableMutationBinding,
} from "../setup/definition-revision.js";

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

function buildHookEnvironment(
  service: DiscoveredService,
  phase: ServiceHookPhase,
  step: ServiceHookStep,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...Object.fromEntries(
      Object.entries(step.env ?? {}).map(([key, value]) => [
        key,
        resolveServiceEnvValue(value, service),
      ]),
    ),
    SERVICE_ID: service.manifest.id,
    SERVICE_ROOT: service.serviceRoot,
    SERVICE_HOOK_PHASE: phase,
  };
}

async function buildHookStepExecutableBinding(
  service: DiscoveredService,
  phase: ServiceHookPhase,
  step: ServiceHookStep,
  index: number,
): Promise<ServiceExecutableMutationBinding> {
  const cwd = resolveStepCwd(service, step);
  const env = buildHookEnvironment(service, phase, step);
  const files = await buildExecutableInputFiles(step.command, step.args ?? [], cwd, env);
  const identity = {
    serviceId: service.manifest.id,
    phase,
    index,
    step,
    cwd: path.normalize(cwd).replaceAll("\\", "/"),
    files,
  };
  return {
    revision: `service-hook-executable-${createHash("sha256").update(JSON.stringify(identity)).digest("hex")}`,
    files,
  };
}

export async function buildLifecycleHookExecutableBindings(
  service: DiscoveredService,
  phases: readonly ServiceHookPhase[] = ["preRestart", "postRestart", "preUpgrade", "postUpgrade", "rollback", "onFailure"],
): Promise<Record<string, ServiceExecutableMutationBinding>> {
  const entries: Array<[string, ServiceExecutableMutationBinding]> = [];
  for (const phase of phases) {
    const steps = service.manifest.hooks?.[phase] ?? [];
    for (const [index, step] of steps.entries()) {
      entries.push([`${phase}:${index}`, await buildHookStepExecutableBinding(service, phase, step, index)]);
    }
  }
  return Object.fromEntries(entries);
}

async function runHookStep(
  service: DiscoveredService,
  phase: ServiceHookPhase,
  step: ServiceHookStep,
  index: number,
  expectedBinding?: ServiceExecutableMutationBinding,
): Promise<LifecycleHookStepResult> {
  const startedAt = new Date().toISOString();
  const failurePolicy = resolveFailurePolicy(step);
  if (expectedBinding) {
    const currentBinding = await buildHookStepExecutableBinding(service, phase, step, index);
    if (currentBinding.revision !== expectedBinding.revision) {
      throw new Error(`Lifecycle hook "${phase}:${index}" executable inputs changed after guarded preflight.`);
    }
  }
  const child = spawn(step.command, step.args ?? [], {
    cwd: resolveStepCwd(service, step),
    env: buildHookEnvironment(service, phase, step),
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
  expectedBindings?: Readonly<Record<string, ServiceExecutableMutationBinding>>,
): Promise<LifecycleHookPhaseResult> {
  const steps = service.manifest.hooks?.[phase] ?? [];
  const results: LifecycleHookStepResult[] = [];

  for (const [index, step] of steps.entries()) {
    const expectedBinding = expectedBindings ? expectedBindings[`${phase}:${index}`] : undefined;
    if (expectedBindings && !expectedBinding) {
      throw new Error(`Lifecycle hook "${phase}:${index}" was not part of the approved guarded plan.`);
    }
    const result = await runHookStep(service, phase, step, index, expectedBinding);
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
