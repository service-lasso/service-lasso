/**
 * Published-package qualification reliability for Core #1209.
 *
 * Classifies npm acquisition, Core/Admin/Broker startup, readiness sampling,
 * and owned cleanup with stable metadata-only phase codes. Preserves the
 * original first failure and zero-mutation state. Distinguishes
 * test-infrastructure readiness lag from a real product start failure using
 * fresh owned-process evidence. Allows at most one retry, and only for
 * pre-mutation acquisition/startup; mutation retry stays forbidden.
 *
 * Spec binding: SPEC-002 AC-4BZ.1 / AC-4BZ.2, SPEC-007 AC-7G.
 * Historical failed dispatches 33500138538, 33503750329, and 33506286697
 * remain failures. Terminal-green run 33509489660 is not a waiver.
 */

import process from "node:process";

/** @typedef {"npm_acquisition" | "core_startup" | "admin_startup" | "broker_startup" | "readiness_sampling" | "owned_cleanup"} QualificationPhase */
/** @typedef {"running" | "not_running" | "unknown"} OwnedProcessStatus */
/** @typedef {"owned" | "not_running" | "identity_mismatch" | "unknown_owner"} OwnedProcessClassification */
/** @typedef {"acquisition_failure" | "startup_failure" | "readiness_lag" | "product_start_failure" | "cleanup_failure"} QualificationClassification */

/**
 * @typedef {object} OwnedProcessEvidence
 * @property {OwnedProcessStatus} status
 * @property {OwnedProcessClassification} classification
 * @property {boolean} fresh
 */

/**
 * @typedef {object} QualificationFailureRecord
 * @property {QualificationPhase} phase
 * @property {string} failureCode
 * @property {QualificationClassification} classification
 * @property {number} mutationCount
 * @property {boolean} retryAllowed
 * @property {string} retryReason
 * @property {OwnedProcessEvidence | null} ownedProcess
 * @property {boolean} expectedBodyMatched
 * @property {boolean} sampledRunning
 * @property {number | null} httpStatus
 */

export const QUALIFICATION_PHASES = Object.freeze({
  NPM_ACQUISITION: "npm_acquisition",
  CORE_STARTUP: "core_startup",
  ADMIN_STARTUP: "admin_startup",
  BROKER_STARTUP: "broker_startup",
  READINESS_SAMPLING: "readiness_sampling",
  OWNED_CLEANUP: "owned_cleanup",
});

export const QUALIFICATION_PHASE_LIST = Object.freeze([
  QUALIFICATION_PHASES.NPM_ACQUISITION,
  QUALIFICATION_PHASES.CORE_STARTUP,
  QUALIFICATION_PHASES.ADMIN_STARTUP,
  QUALIFICATION_PHASES.BROKER_STARTUP,
  QUALIFICATION_PHASES.READINESS_SAMPLING,
  QUALIFICATION_PHASES.OWNED_CLEANUP,
]);

export const PRE_MUTATION_RETRY_PHASES = Object.freeze([
  QUALIFICATION_PHASES.NPM_ACQUISITION,
  QUALIFICATION_PHASES.CORE_STARTUP,
  QUALIFICATION_PHASES.ADMIN_STARTUP,
  QUALIFICATION_PHASES.BROKER_STARTUP,
]);

export const QUALIFICATION_FAILURE_CODES = Object.freeze({
  npm_acquisition: "npm_acquisition_failed",
  core_startup: "core_startup_failed",
  admin_startup: "admin_startup_failed",
  broker_startup: "broker_startup_failed",
  readiness_sampling: "readiness_sampling_failed",
  owned_cleanup: "owned_cleanup_failed",
  readiness_sampling_lag: "readiness_sampling_lag",
  product_start_failed: "product_start_failed",
});

export const QUALIFICATION_ARTIFACT_NAME =
  /^published-package-qualification-(linux|win32|darwin)-([1-9][0-9]*)-([1-9][0-9]*)$/u;

export const HISTORICAL_FAILED_DISPATCHES = Object.freeze([
  Object.freeze({
    runId: "33500138538",
    platform: "win32",
    fixtureId: "windows_npm_install",
    phase: QUALIFICATION_PHASES.NPM_ACQUISITION,
    waived: false,
  }),
  Object.freeze({
    runId: "33503750329",
    platform: "darwin",
    fixtureId: "macos_readiness_lag",
    phase: QUALIFICATION_PHASES.READINESS_SAMPLING,
    waived: false,
  }),
  Object.freeze({
    runId: "33506286697",
    platform: "win32",
    fixtureId: "windows_broker_process_start",
    phase: QUALIFICATION_PHASES.BROKER_STARTUP,
    waived: false,
  }),
]);

export const TERMINAL_GREEN_RUN_ID = "33509489660";

const PHASE_SET = new Set(QUALIFICATION_PHASE_LIST);
const PRE_MUTATION_SET = new Set(PRE_MUTATION_RETRY_PHASES);
const STARTUP_CODE_BY_PHASE = Object.freeze({
  [QUALIFICATION_PHASES.CORE_STARTUP]: QUALIFICATION_FAILURE_CODES.core_startup,
  [QUALIFICATION_PHASES.ADMIN_STARTUP]: QUALIFICATION_FAILURE_CODES.admin_startup,
  [QUALIFICATION_PHASES.BROKER_STARTUP]: QUALIFICATION_FAILURE_CODES.broker_startup,
});

/**
 * Return whether value is a governed qualification phase code.
 *
 * @param {unknown} value
 * @returns {value is QualificationPhase}
 */
export function isQualificationPhase(value) {
  return typeof value === "string" && PHASE_SET.has(value);
}

/**
 * Return whether the phase may retry before lifecycle mutation.
 *
 * @param {unknown} phase
 * @returns {boolean}
 */
export function isPreMutationRetryPhase(phase) {
  return typeof phase === "string" && PRE_MUTATION_SET.has(phase);
}

/**
 * Normalize caller-supplied owned-process evidence without PIDs or paths.
 *
 * @param {unknown} value
 * @returns {OwnedProcessEvidence}
 */
export function normalizeOwnedProcessEvidence(value) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const status =
    record.status === "running" || record.status === "not_running" || record.status === "unknown"
      ? record.status
      : "unknown";
  const classification =
    record.classification === "owned" ||
    record.classification === "not_running" ||
    record.classification === "identity_mismatch" ||
    record.classification === "unknown_owner"
      ? record.classification
      : "unknown_owner";
  return {
    status,
    classification,
    fresh: record.fresh === true,
  };
}

/**
 * Inspect a child this harness spawned. Evidence is metadata-only.
 *
 * @param {import("node:child_process").ChildProcess | null | undefined} child
 * @returns {OwnedProcessEvidence}
 */
export function inspectOwnedChild(child) {
  if (!child || typeof child.pid !== "number" || child.pid <= 0) {
    return { status: "unknown", classification: "unknown_owner", fresh: true };
  }
  if (typeof child.exitCode === "number") {
    return { status: "not_running", classification: "not_running", fresh: true };
  }
  try {
    process.kill(child.pid, 0);
    return { status: "running", classification: "owned", fresh: true };
  } catch {
    return { status: "not_running", classification: "not_running", fresh: true };
  }
}

/**
 * Decide whether a pre-mutation retry is allowed. Mutation retry is forbidden.
 *
 * @param {{ phase: unknown, mutationCount?: unknown, priorRetryCount?: unknown }} input
 * @returns {{ allowed: boolean, reason: string }}
 */
export function decideQualificationRetry(input) {
  const mutationCount = Number(input?.mutationCount ?? 0);
  const priorRetryCount = Number(input?.priorRetryCount ?? 0);
  if (!Number.isFinite(mutationCount) || mutationCount > 0) {
    return { allowed: false, reason: "mutation_retry_forbidden" };
  }
  if (!isPreMutationRetryPhase(input?.phase)) {
    return { allowed: false, reason: "retry_not_allowed_for_phase" };
  }
  if (!Number.isFinite(priorRetryCount) || priorRetryCount >= 1) {
    return { allowed: false, reason: "acquisition_startup_retry_exhausted" };
  }
  return { allowed: true, reason: "pre_mutation_acquisition_startup" };
}

/**
 * Keep the original first failure. Later cleanup or retry outcomes cannot replace it.
 *
 * @param {QualificationFailureRecord | null | undefined} existing
 * @param {QualificationFailureRecord} candidate
 * @returns {QualificationFailureRecord}
 */
export function preserveFirstFailure(existing, candidate) {
  if (existing && isQualificationPhase(existing.phase) && typeof existing.failureCode === "string") {
    return existing;
  }
  return candidate;
}

/**
 * Read a stable metadata-only error code from an unknown failure.
 *
 * @param {unknown} error
 * @returns {string | null}
 */
function readErrorCode(error) {
  if (error && typeof error === "object" && typeof error.code === "string" && /^[a-z0-9_]{1,64}$/u.test(error.code)) {
    return error.code;
  }
  return null;
}

/**
 * Map a raw error code onto a phase when the caller did not pin one.
 *
 * @param {string | null} errorCode
 * @param {unknown} fallbackPhase
 * @returns {QualificationPhase}
 */
function resolvePhase(errorCode, fallbackPhase) {
  if (isQualificationPhase(fallbackPhase)) return fallbackPhase;
  if (errorCode === QUALIFICATION_FAILURE_CODES.npm_acquisition || errorCode === "npm_install_failed") {
    return QUALIFICATION_PHASES.NPM_ACQUISITION;
  }
  if (errorCode === "secrets_broker_process_start_failed" || errorCode === QUALIFICATION_FAILURE_CODES.broker_startup) {
    return QUALIFICATION_PHASES.BROKER_STARTUP;
  }
  if (errorCode === QUALIFICATION_FAILURE_CODES.admin_startup || errorCode === "published_admin_not_ready") {
    return QUALIFICATION_PHASES.ADMIN_STARTUP;
  }
  if (
    errorCode === QUALIFICATION_FAILURE_CODES.core_startup ||
    errorCode === "published_runtime_not_ready" ||
    errorCode === "published_runtime_cleanup_failed"
  ) {
    return QUALIFICATION_PHASES.CORE_STARTUP;
  }
  if (
    errorCode === QUALIFICATION_FAILURE_CODES.readiness_sampling ||
    errorCode === QUALIFICATION_FAILURE_CODES.readiness_sampling_lag ||
    errorCode === QUALIFICATION_FAILURE_CODES.product_start_failed
  ) {
    return QUALIFICATION_PHASES.READINESS_SAMPLING;
  }
  if (
    errorCode === QUALIFICATION_FAILURE_CODES.owned_cleanup ||
    errorCode === "cleanup_not_converged" ||
    errorCode === "unsafe_cleanup_target"
  ) {
    return QUALIFICATION_PHASES.OWNED_CLEANUP;
  }
  return QUALIFICATION_PHASES.NPM_ACQUISITION;
}

/**
 * Distinguish HTTP-200 expected-body success with a lagging runtime sample
 * from a real product start failure, using fresh owned-process evidence.
 *
 * @param {{
 *   phase?: unknown,
 *   httpStatus?: unknown,
 *   expectedBodyMatched?: unknown,
 *   sampledRunning?: unknown,
 *   ownedProcess?: unknown,
 *   mutationCount?: unknown,
 * }} input
 * @returns {{ ready: boolean } & QualificationFailureRecord}
 */
export function classifyReadinessSample(input) {
  const httpStatus = Number.isInteger(input?.httpStatus) ? Number(input.httpStatus) : null;
  const expectedBodyMatched = input?.expectedBodyMatched === true;
  const sampledRunning = input?.sampledRunning === true;
  const ownedProcess = normalizeOwnedProcessEvidence(input?.ownedProcess);
  const mutationCount = Number(input?.mutationCount ?? 0);
  const phase = isQualificationPhase(input?.phase)
    ? input.phase
    : QUALIFICATION_PHASES.READINESS_SAMPLING;
  const retry = decideQualificationRetry({ phase, mutationCount, priorRetryCount: 0 });

  if (httpStatus === 200 && expectedBodyMatched && sampledRunning) {
    return {
      ready: true,
      phase,
      failureCode: QUALIFICATION_FAILURE_CODES.readiness_sampling,
      classification: "readiness_lag",
      mutationCount: Number.isFinite(mutationCount) ? mutationCount : 0,
      retryAllowed: false,
      retryReason: "retry_not_allowed_for_phase",
      ownedProcess,
      expectedBodyMatched,
      sampledRunning,
      httpStatus,
    };
  }

  if (
    httpStatus === 200 &&
    expectedBodyMatched &&
    sampledRunning === false &&
    ownedProcess.fresh === true &&
    ownedProcess.status === "running" &&
    ownedProcess.classification === "owned"
  ) {
    return {
      ready: true,
      phase: QUALIFICATION_PHASES.READINESS_SAMPLING,
      failureCode: QUALIFICATION_FAILURE_CODES.readiness_sampling_lag,
      classification: "readiness_lag",
      mutationCount: Number.isFinite(mutationCount) ? mutationCount : 0,
      retryAllowed: false,
      retryReason: "retry_not_allowed_for_phase",
      ownedProcess,
      expectedBodyMatched,
      sampledRunning,
      httpStatus,
    };
  }

  const productStart = ownedProcess.status !== "running" || ownedProcess.classification !== "owned";
  return {
    ready: false,
    phase: productStart ? phase : QUALIFICATION_PHASES.READINESS_SAMPLING,
    failureCode: productStart
      ? QUALIFICATION_FAILURE_CODES.product_start_failed
      : QUALIFICATION_FAILURE_CODES.readiness_sampling,
    classification: productStart ? "product_start_failure" : "readiness_lag",
    mutationCount: Number.isFinite(mutationCount) ? mutationCount : 0,
    retryAllowed: retry.allowed,
    retryReason: retry.reason,
    ownedProcess,
    expectedBodyMatched,
    sampledRunning,
    httpStatus,
  };
}

/**
 * Classify a qualification failure into one stable metadata-only phase code.
 *
 * @param {{
 *   phase?: unknown,
 *   error?: unknown,
 *   mutationCount?: unknown,
 *   httpStatus?: unknown,
 *   expectedBodyMatched?: unknown,
 *   sampledRunning?: unknown,
 *   ownedProcess?: unknown,
 *   priorRetryCount?: unknown,
 * }} input
 * @returns {QualificationFailureRecord}
 */
export function classifyQualificationFailure(input) {
  const errorCode = readErrorCode(input?.error);
  const mutationCount = Number.isFinite(Number(input?.mutationCount)) ? Number(input.mutationCount) : 0;
  const httpStatus = Number.isInteger(input?.httpStatus) ? Number(input.httpStatus) : null;
  const expectedBodyMatched = input?.expectedBodyMatched === true;
  const sampledRunning = input?.sampledRunning === true;
  const ownedProcess = input?.ownedProcess
    ? normalizeOwnedProcessEvidence(input.ownedProcess)
    : null;

  if (httpStatus === 200 && expectedBodyMatched && sampledRunning === false) {
    const readiness = classifyReadinessSample({
      ...input,
      mutationCount,
      ownedProcess: ownedProcess ?? { status: "unknown", classification: "unknown_owner", fresh: false },
    });
    return {
      phase: readiness.phase,
      failureCode: readiness.failureCode,
      classification: readiness.classification,
      mutationCount: readiness.mutationCount,
      retryAllowed: false,
      retryReason: "retry_not_allowed_for_phase",
      ownedProcess: readiness.ownedProcess,
      expectedBodyMatched,
      sampledRunning,
      httpStatus,
    };
  }

  const phase = resolvePhase(errorCode, input?.phase);
  const retry = decideQualificationRetry({
    phase,
    mutationCount,
    priorRetryCount: input?.priorRetryCount ?? 0,
  });

  if (phase === QUALIFICATION_PHASES.OWNED_CLEANUP) {
    return {
      phase,
      failureCode: QUALIFICATION_FAILURE_CODES.owned_cleanup,
      classification: "cleanup_failure",
      mutationCount,
      retryAllowed: false,
      retryReason: "retry_not_allowed_for_phase",
      ownedProcess,
      expectedBodyMatched,
      sampledRunning,
      httpStatus,
    };
  }

  if (phase === QUALIFICATION_PHASES.NPM_ACQUISITION) {
    return {
      phase,
      failureCode: QUALIFICATION_FAILURE_CODES.npm_acquisition,
      classification: "acquisition_failure",
      mutationCount,
      retryAllowed: retry.allowed,
      retryReason: retry.reason,
      ownedProcess,
      expectedBodyMatched,
      sampledRunning,
      httpStatus,
    };
  }

  if (phase === QUALIFICATION_PHASES.READINESS_SAMPLING) {
    return {
      phase,
      failureCode: QUALIFICATION_FAILURE_CODES.readiness_sampling,
      classification: "readiness_lag",
      mutationCount,
      retryAllowed: false,
      retryReason: "retry_not_allowed_for_phase",
      ownedProcess,
      expectedBodyMatched,
      sampledRunning,
      httpStatus,
    };
  }

  return {
    phase,
    failureCode: STARTUP_CODE_BY_PHASE[phase] ?? QUALIFICATION_FAILURE_CODES.core_startup,
    classification: "startup_failure",
    mutationCount,
    retryAllowed: retry.allowed,
    retryReason: retry.reason,
    ownedProcess,
    expectedBodyMatched,
    sampledRunning,
    httpStatus,
  };
}

/**
 * Deterministic fixtures for the three observed published-package failure classes.
 *
 * @returns {Readonly<{
 *   windowsNpmInstall: object,
 *   macosReadinessLag: object,
 *   windowsBrokerProcessStart: object,
 * }>}
 */
export function createObservedFailureFixtures() {
  return Object.freeze({
    windowsNpmInstall: Object.freeze({
      id: "windows_npm_install",
      platform: "win32",
      historicalRunId: "33500138538",
      phase: QUALIFICATION_PHASES.NPM_ACQUISITION,
      httpStatus: null,
      expectedBodyMatched: false,
      sampledRunning: false,
      ownedProcess: Object.freeze({
        status: "not_running",
        classification: "not_running",
        fresh: true,
      }),
      mutationCount: 0,
      error: Object.freeze({ code: "npm_acquisition_failed" }),
    }),
    macosReadinessLag: Object.freeze({
      id: "macos_readiness_lag",
      platform: "darwin",
      historicalRunId: "33503750329",
      phase: QUALIFICATION_PHASES.READINESS_SAMPLING,
      httpStatus: 200,
      expectedBodyMatched: true,
      sampledRunning: false,
      ownedProcess: Object.freeze({
        status: "running",
        classification: "owned",
        fresh: true,
      }),
      mutationCount: 0,
      error: Object.freeze({ code: "readiness_sampling_lag" }),
    }),
    windowsBrokerProcessStart: Object.freeze({
      id: "windows_broker_process_start",
      platform: "win32",
      historicalRunId: "33506286697",
      phase: QUALIFICATION_PHASES.BROKER_STARTUP,
      httpStatus: null,
      expectedBodyMatched: false,
      sampledRunning: false,
      ownedProcess: Object.freeze({
        status: "not_running",
        classification: "not_running",
        fresh: true,
      }),
      mutationCount: 0,
      error: Object.freeze({ code: "secrets_broker_process_start_failed" }),
    }),
  });
}

/**
 * Select exact current-attempt platform artifacts. Prior attempts of the same
 * run stay retained and are not waived. Unknown extra names fail closed.
 *
 * @param {readonly object[]} artifacts
 * @param {string | number} runId
 * @param {string | number} runAttempt
 * @returns {{
 *   current: object[],
 *   retainedPriorAttempts: object[],
 *   extras: object[],
 *   currentComplete: boolean,
 * }}
 */
export function selectCurrentAttemptArtifacts(artifacts, runId, runAttempt) {
  const expectedNames = ["linux", "win32", "darwin"].map(
    (platform) => `published-package-qualification-${platform}-${runId}-${runAttempt}`,
  );
  const current = [];
  const retainedPriorAttempts = [];
  const extras = [];
  for (const artifact of Array.isArray(artifacts) ? artifacts : []) {
    const match = QUALIFICATION_ARTIFACT_NAME.exec(String(artifact?.name ?? ""));
    if (!match) {
      extras.push(artifact);
      continue;
    }
    const artifactRunId = match[2];
    const artifactAttempt = match[3];
    if (artifactRunId !== String(runId)) {
      extras.push(artifact);
      continue;
    }
    if (artifactAttempt === String(runAttempt)) {
      current.push(artifact);
      continue;
    }
    retainedPriorAttempts.push(artifact);
  }
  const observedNames = current.map((artifact) => artifact.name).sort();
  const expectedSorted = [...expectedNames].sort();
  const currentComplete =
    extras.length === 0 &&
    JSON.stringify(observedNames) === JSON.stringify(expectedSorted) &&
    new Set(observedNames).size === 3;
  return { current, retainedPriorAttempts, extras, currentComplete };
}

/**
 * Validate metadata-only reliability fields on retained success evidence.
 *
 * @param {object} evidence
 * @returns {{ ok: boolean, code: string | null }}
 */
export function validateReliabilitySuccessFields(evidence) {
  if (evidence?.mutationRetry !== false) {
    return { ok: false, code: "evidence_policy_mismatch" };
  }
  if (evidence?.acquisitionRetry !== true && evidence?.acquisitionRetry !== false) {
    return { ok: false, code: "evidence_policy_mismatch" };
  }
  if (evidence?.startupRetry !== true && evidence?.startupRetry !== false) {
    return { ok: false, code: "evidence_policy_mismatch" };
  }
  if (evidence.firstFailure == null) {
    if (evidence.acquisitionRetry === true || evidence.startupRetry === true) {
      return { ok: false, code: "evidence_policy_mismatch" };
    }
    return { ok: true, code: null };
  }
  const firstFailure = evidence.firstFailure;
  if (
    !isQualificationPhase(firstFailure.phase) ||
    typeof firstFailure.failureCode !== "string" ||
    !/^[a-z0-9_]{1,64}$/u.test(firstFailure.failureCode) ||
    firstFailure.mutationCount !== 0 ||
    typeof firstFailure.classification !== "string"
  ) {
    return { ok: false, code: "evidence_policy_mismatch" };
  }
  if (evidence.acquisitionRetry === true && firstFailure.phase !== QUALIFICATION_PHASES.NPM_ACQUISITION) {
    return { ok: false, code: "evidence_policy_mismatch" };
  }
  if (
    evidence.startupRetry === true &&
    firstFailure.phase !== QUALIFICATION_PHASES.CORE_STARTUP &&
    firstFailure.phase !== QUALIFICATION_PHASES.ADMIN_STARTUP &&
    firstFailure.phase !== QUALIFICATION_PHASES.BROKER_STARTUP
  ) {
    return { ok: false, code: "evidence_policy_mismatch" };
  }
  return { ok: true, code: null };
}
