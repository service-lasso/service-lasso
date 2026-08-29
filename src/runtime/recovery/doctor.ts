import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import type { DiscoveredService, ServiceDoctorPolicy, ServiceHookFailurePolicy, ServiceHookStep } from "../../contracts/service.js";
import { LifecycleStateError } from "../../server/errors.js";
import { resolveServiceEnvValue } from "../operator/variables.js";
import { appendServiceRecoveryHistoryEvents } from "./history.js";
import {
  buildExecutableInputFiles,
  type ServiceExecutableMutationBinding,
} from "../setup/definition-revision.js";

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

function buildDoctorEnvironment(service: DiscoveredService, step: ServiceHookStep): NodeJS.ProcessEnv {
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
  };
}

async function buildDoctorStepExecutableBinding(
  service: DiscoveredService,
  step: ServiceHookStep,
  index: number,
): Promise<ServiceExecutableMutationBinding> {
  const cwd = resolveStepCwd(service, step);
  const files = await buildExecutableInputFiles(step.command, step.args ?? [], cwd, buildDoctorEnvironment(service, step));
  const identity = {
    serviceId: service.manifest.id,
    index,
    step,
    cwd: path.normalize(cwd).replaceAll("\\", "/"),
    files,
  };
  return {
    revision: `service-doctor-executable-${createHash("sha256").update(JSON.stringify(identity)).digest("hex")}`,
    files,
  };
}

export async function buildDoctorExecutableBindings(
  service: DiscoveredService,
): Promise<Record<string, ServiceExecutableMutationBinding>> {
  const steps = service.manifest.doctor?.steps ?? [];
  return Object.fromEntries(await Promise.all(steps.map(async (step, index) => [
    String(index),
    await buildDoctorStepExecutableBinding(service, step, index),
  ])));
}

async function runDoctorStep(
  service: DiscoveredService,
  doctor: ServiceDoctorPolicy,
  step: ServiceHookStep,
  index: number,
  expectedBinding?: ServiceExecutableMutationBinding,
): Promise<DoctorStepResult> {
  const startedAt = new Date().toISOString();
  const failurePolicy = resolveFailurePolicy(doctor, step);
  if (expectedBinding) {
    const currentBinding = await buildDoctorStepExecutableBinding(service, step, index);
    if (currentBinding.revision !== expectedBinding.revision) {
      throw new LifecycleStateError(`Doctor step "${index}" executable inputs changed after guarded preflight.`);
    }
  }
  const child = spawn(step.command, step.args ?? [], {
    cwd: resolveStepCwd(service, step),
    env: buildDoctorEnvironment(service, step),
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

export async function runDoctorPreflight(
  service: DiscoveredService,
  expectedBindings?: Readonly<Record<string, ServiceExecutableMutationBinding>>,
): Promise<DoctorRunResult> {
  const doctor = service.manifest.doctor;
  if (!doctor || doctor.enabled !== true || !doctor.steps || doctor.steps.length === 0) {
    return {
      ok: true,
      blocked: false,
      steps: [],
    };
  }

  const steps: DoctorStepResult[] = [];
  for (const [index, step] of doctor.steps.entries()) {
    const expectedBinding = expectedBindings ? expectedBindings[String(index)] : undefined;
    if (expectedBindings && !expectedBinding) {
      throw new LifecycleStateError(`Doctor step "${index}" was not part of the approved guarded plan.`);
    }
    const result = await runDoctorStep(service, doctor, step, index, expectedBinding);
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

export async function runAndRecordDoctorPreflight(
  service: DiscoveredService,
  expectedBindings?: Readonly<Record<string, ServiceExecutableMutationBinding>>,
): Promise<DoctorRunResult> {
  const result = await runDoctorPreflight(service, expectedBindings);
  await appendServiceRecoveryHistoryEvents(service, [{
    kind: "doctor",
    serviceId: service.manifest.id,
    ok: result.ok,
    blocked: result.blocked,
    steps: result.steps,
    at: new Date().toISOString(),
  }]);

  return result;
}

export async function assertDoctorPreflightAllowsRestart(
  service: DiscoveredService,
  expectedBindings?: Readonly<Record<string, ServiceExecutableMutationBinding>>,
): Promise<DoctorRunResult> {
  const result = await runAndRecordDoctorPreflight(service, expectedBindings);

  if (result.blocked) {
    const failed = result.steps.find((step) => !step.ok && step.failurePolicy === "block");
    throw new LifecycleStateError(
      `Doctor preflight blocked restart for service "${service.manifest.id}" at step "${failed?.name ?? "unknown"}".`,
    );
  }

  return result;
}
