import { createHash } from "node:crypto";
import type { DiscoveredService, ServiceSetupStep } from "../../contracts/service.js";
import { getLifecycleState } from "../lifecycle/store.js";
import type { SetupInputFingerprintSnapshot } from "../lifecycle/types.js";
import { resolveServiceText } from "../operator/variables.js";

/**
 * Thrown when a declared setup fingerprint cannot be evaluated safely.
 */
export class SetupInputFingerprintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SetupInputFingerprintError";
  }
}

/**
 * `ifChanged` requires a declared fingerprint list so skip decisions stay explicit.
 */
export function setupStepHonorsInputFingerprint(step: ServiceSetupStep): boolean {
  return step.rerun === "ifChanged" && Array.isArray(step.fingerprint) && step.fingerprint.length > 0;
}

/**
 * True when the step declares fingerprint inputs that should be hashed after a run.
 */
export function setupStepDeclaresInputFingerprint(step: ServiceSetupStep): boolean {
  return Array.isArray(step.fingerprint) && step.fingerprint.length > 0;
}

/**
 * Read the installed artifact release tag. Empty string means no installed version.
 */
function currentArtifactTag(serviceId: string): string {
  const tag = getLifecycleState(serviceId).installArtifacts.artifact?.tag;
  return typeof tag === "string" ? tag : "";
}

/**
 * Hash declared templates plus resolved values and the artifact tag.
 * Resolved values stay in memory only; the returned snapshot never includes them.
 */
function hashFingerprintPayload(declared: string[], resolved: string[], artifactTag: string): string {
  const payload = JSON.stringify({
    v: 1,
    declared,
    resolved,
    artifactTag,
  });
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Resolve fingerprint templates through Service Lasso variables and return a hash-only snapshot.
 */
export function evaluateSetupInputFingerprint(
  service: DiscoveredService,
  step: ServiceSetupStep,
  sharedGlobalEnv: Record<string, string>,
  resolvedPorts: Record<string, number>,
): SetupInputFingerprintSnapshot {
  const declared = step.fingerprint ?? [];
  if (declared.length === 0) {
    throw new SetupInputFingerprintError("Setup step fingerprint must declare at least one input.");
  }

  const resolved = declared.map((template) => resolveServiceText(template, service, sharedGlobalEnv, resolvedPorts));
  const artifactTag = currentArtifactTag(service.manifest.id);

  return {
    algorithm: "sha256",
    hash: hashFingerprintPayload(declared, resolved, artifactTag),
    declared: [...declared],
    evaluatedAt: new Date().toISOString(),
  };
}

/**
 * Evaluate a declared fingerprint, or return null when the step has none.
 */
export function evaluateSetupInputFingerprintIfDeclared(
  service: DiscoveredService,
  step: ServiceSetupStep,
  sharedGlobalEnv: Record<string, string>,
  resolvedPorts: Record<string, number>,
): SetupInputFingerprintSnapshot | null {
  if (!setupStepDeclaresInputFingerprint(step)) {
    return null;
  }
  return evaluateSetupInputFingerprint(service, step, sharedGlobalEnv, resolvedPorts);
}
