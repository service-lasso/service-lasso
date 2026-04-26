import path from "node:path";
import { spawn } from "node:child_process";
import type { DiscoveredService, ServiceDoctorPolicy, ServiceHookFailurePolicy, ServiceHookStep } from "../../contracts/service.js";
import { LifecycleStateError } from "../../server/errors.js";

export interface DoctorStepResult {
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

export interface DoctorRunResult {
  ok: boolean;
  blocked: boolean;
  steps: DoctorStepResult[];
}

function resolveFailurePolicy(
  doctor: ServiceDoctorPolicy,
  step: ServiceHookStep,
): ServiceHookFailurePolicy {
  return step.failurePolicy ?? doctor.failurePolicy ?? "block";
}

function resolveTimeoutMs(doctor: ServiceDoctorPolicy, step: ServiceHookStep): number {
  return (step.timeoutSeconds ?? doctor.timeoutSeconds ?? 30) * 1000;
}

function resolveStepCwd(service: DiscoveredService, step: ServiceHookStep): string {
  if (!step.cwd) {
    return service.serviceRoot;
  }

  return path.isAbsolute(step.cwd) ? step.cwd : path.resolve(service.serviceRoot, step.cwd);
}

async function runDoctorStep(
  service: DiscoveredService,
  doctor: ServiceDoctorPolicy,
  step: ServiceHookStep,
): Promise<DoctorStepResult> {
  const startedAt = new Date().toISOString();
  const failurePolicy = resolveFailurePolicy(doctor, step);
  const child = spawn(step.command, step.args ?? [], {
    cwd: resolveStepCwd(service, step),
    env: {
      ...process.env,
      ...(step.env ?? {}),
      SERVICE_ID: service.manifest.id,
      SERVICE_ROOT: service.serviceRoot,
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
  }, resolveTimeoutMs(doctor, step));
  timeout.unref?.();

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(typeof code === "number" ? code : null));
  }).finally(() => clearTimeout(timeout));

  const ok = !timedOut && exitCode === 0;
  return {
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

export async function runDoctorPreflight(service: DiscoveredService): Promise<DoctorRunResult> {
  const doctor = service.manifest.doctor;
  if (!doctor || doctor.enabled !== true || !doctor.steps || doctor.steps.length === 0) {
    return {
      ok: true,
      blocked: false,
      steps: [],
    };
  }

  const steps: DoctorStepResult[] = [];
  for (const step of doctor.steps) {
    const result = await runDoctorStep(service, doctor, step);
    steps.push(result);
    if (!result.ok && result.failurePolicy === "block") {
      return {
        ok: false,
        blocked: true,
        steps,
      };
    }
  }

  return {
    ok: steps.every((step) => step.ok || step.failurePolicy !== "block"),
    blocked: false,
    steps,
  };
}

export async function assertDoctorPreflightAllowsRestart(service: DiscoveredService): Promise<DoctorRunResult> {
  const result = await runDoctorPreflight(service);
  if (result.blocked) {
    const failed = result.steps.find((step) => !step.ok && step.failurePolicy === "block");
    throw new LifecycleStateError(
      `Doctor preflight blocked restart for service "${service.manifest.id}" at step "${failed?.name ?? "unknown"}".`,
    );
  }

  return result;
}

