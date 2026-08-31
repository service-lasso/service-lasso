import path from "node:path";
import { stat } from "node:fs/promises";
import type { DiscoveredService, ServiceSetupStep } from "../../contracts/service.js";
import { getLifecycleState } from "../lifecycle/store.js";
import type { SetupOutputGuardResult, SetupOutputGuardSnapshot } from "../lifecycle/types.js";
import { resolveServiceText } from "../operator/variables.js";

/**
 * Thrown when a declared `creates` path cannot be used as an output guard.
 */
export class SetupOutputGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SetupOutputGuardError";
  }
}

export interface SetupSkipDecision {
  skip: boolean;
  reason: string | null;
  outputGuards: SetupOutputGuardSnapshot | null;
}

/**
 * `ifMissing` (and the omitted default) honor `creates` existence checks.
 */
export function setupStepHonorsCreatesGuards(step: ServiceSetupStep): boolean {
  return (step.rerun === "ifMissing" || step.rerun === undefined) && Array.isArray(step.creates) && step.creates.length > 0;
}

/**
 * Keep resolved creates targets inside the owning service root.
 */
function isPathInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative.length === 0 || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Resolve one declared `creates` template, then record file/directory presence.
 * Persisted metadata is the manifest template plus a service-root-relative path.
 */
async function evaluateDeclaredCreate(
  service: DiscoveredService,
  declared: string,
  sharedGlobalEnv: Record<string, string>,
  resolvedPorts: Record<string, number>,
): Promise<SetupOutputGuardResult> {
  const resolved = resolveServiceText(declared, service, sharedGlobalEnv, resolvedPorts);
  const absolute = path.resolve(service.serviceRoot, resolved);
  if (!isPathInside(service.serviceRoot, absolute)) {
    throw new SetupOutputGuardError("Setup step creates path must stay inside the service root.");
  }

  const relativePath = path.relative(service.serviceRoot, absolute).replaceAll("\\", "/") || ".";
  const stats = await stat(absolute).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  });
  const isFile = stats?.isFile() === true;
  const isDirectory = stats?.isDirectory() === true;

  return {
    declared,
    relativePath,
    present: isFile || isDirectory,
    kind: isFile ? "file" : isDirectory ? "directory" : null,
  };
}

/**
 * Evaluate every declared `creates` output as a file or directory existence guard.
 */
export async function evaluateSetupOutputGuards(
  service: DiscoveredService,
  step: ServiceSetupStep,
  sharedGlobalEnv: Record<string, string>,
  resolvedPorts: Record<string, number>,
): Promise<SetupOutputGuardSnapshot> {
  const results: SetupOutputGuardResult[] = [];
  for (const declared of step.creates ?? []) {
    results.push(await evaluateDeclaredCreate(service, declared, sharedGlobalEnv, resolvedPorts));
  }

  return {
    evaluatedAt: new Date().toISOString(),
    satisfied: results.every((result) => result.present),
    results,
  };
}

/**
 * Decide whether a setup step should skip based on rerun policy and `creates`.
 */
export async function decideSetupStepSkip(
  service: DiscoveredService,
  stepId: string,
  step: ServiceSetupStep,
  force: boolean,
  sharedGlobalEnv: Record<string, string>,
  resolvedPorts: Record<string, number>,
): Promise<SetupSkipDecision> {
  if (force || step.rerun === "always") {
    return { skip: false, reason: null, outputGuards: null };
  }

  if (setupStepHonorsCreatesGuards(step)) {
    const outputGuards = await evaluateSetupOutputGuards(service, step, sharedGlobalEnv, resolvedPorts);
    if (outputGuards.satisfied) {
      return {
        skip: true,
        reason: "setup step creates already exist",
        outputGuards,
      };
    }

    return { skip: false, reason: null, outputGuards };
  }

  const prior = getLifecycleState(service.manifest.id).setup.steps[stepId];
  if (!prior || prior.status !== "succeeded") {
    return { skip: false, reason: null, outputGuards: null };
  }

  return {
    skip: true,
    reason: step.rerun === "manual" ? "manual step already succeeded" : "setup step already succeeded",
    outputGuards: null,
  };
}
