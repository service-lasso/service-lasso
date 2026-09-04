import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  HISTORICAL_FAILED_DISPATCHES,
  PRE_MUTATION_RETRY_PHASES,
  QUALIFICATION_FAILURE_CODES,
  QUALIFICATION_PHASES,
  TERMINAL_GREEN_RUN_ID,
  classifyQualificationFailure,
  classifyReadinessSample,
  createObservedFailureFixtures,
  decideQualificationRetry,
  inspectOwnedChild,
  preserveFirstFailure,
  selectCurrentAttemptArtifacts,
  validateReliabilitySuccessFields,
} from "../scripts/published-package-qualification-reliability.mjs";
import {
  QUALIFICATION_SCHEMA,
  assertMetadataOnlyEvidence,
} from "../scripts/published-package-qualification-lib.mjs";

const fixtures = createObservedFailureFixtures();

test("AC-4BZ.2 historical failed dispatches remain unwaived and are not the green run", () => {
  assert.equal(HISTORICAL_FAILED_DISPATCHES.length, 3);
  assert.equal(TERMINAL_GREEN_RUN_ID, "33509489660");
  for (const dispatch of HISTORICAL_FAILED_DISPATCHES) {
    assert.equal(dispatch.waived, false);
    assert.notEqual(dispatch.runId, TERMINAL_GREEN_RUN_ID);
  }
  assert.deepEqual(
    HISTORICAL_FAILED_DISPATCHES.map((entry) => entry.runId),
    ["33500138538", "33503750329", "33506286697"],
  );
});

test("AC-4BZ.2 Windows npm install fixture classifies acquisition with zero mutation and retry allowed", () => {
  const classified = classifyQualificationFailure(fixtures.windowsNpmInstall);
  assert.equal(classified.phase, QUALIFICATION_PHASES.NPM_ACQUISITION);
  assert.equal(classified.failureCode, QUALIFICATION_FAILURE_CODES.npm_acquisition);
  assert.equal(classified.classification, "acquisition_failure");
  assert.equal(classified.mutationCount, 0);
  assert.equal(classified.retryAllowed, true);
  assert.equal(classified.retryReason, "pre_mutation_acquisition_startup");
  assertMetadataOnlyEvidence({
    schema: QUALIFICATION_SCHEMA,
    retainedContent: "metadata_only",
    phase: classified.phase,
    failureCode: classified.failureCode,
    classification: classified.classification,
    mutationCount: classified.mutationCount,
    retryAllowed: classified.retryAllowed,
    retryReason: classified.retryReason,
  });
});

test("AC-4BZ.2 macOS readiness lag uses fresh owned-process evidence and is not a product start failure", () => {
  const classified = classifyQualificationFailure(fixtures.macosReadinessLag);
  assert.equal(classified.phase, QUALIFICATION_PHASES.READINESS_SAMPLING);
  assert.equal(classified.failureCode, QUALIFICATION_FAILURE_CODES.readiness_sampling_lag);
  assert.equal(classified.classification, "readiness_lag");
  assert.equal(classified.mutationCount, 0);
  assert.equal(classified.retryAllowed, false);
  assert.equal(classified.ownedProcess.fresh, true);
  assert.equal(classified.ownedProcess.status, "running");
  assert.equal(classified.ownedProcess.classification, "owned");
  const readiness = classifyReadinessSample(fixtures.macosReadinessLag);
  assert.equal(readiness.ready, true);
  assert.equal(readiness.failureCode, QUALIFICATION_FAILURE_CODES.readiness_sampling_lag);
});

test("AC-4BZ.2 HTTP 200 with expected body and no owned process is a real product start failure", () => {
  const classified = classifyQualificationFailure({
    phase: QUALIFICATION_PHASES.CORE_STARTUP,
    httpStatus: 200,
    expectedBodyMatched: true,
    sampledRunning: false,
    ownedProcess: { status: "not_running", classification: "not_running", fresh: true },
    mutationCount: 0,
  });
  assert.equal(classified.failureCode, QUALIFICATION_FAILURE_CODES.product_start_failed);
  assert.equal(classified.classification, "product_start_failure");
  assert.equal(classified.retryAllowed, false);
  assert.equal(classifyReadinessSample({
    phase: QUALIFICATION_PHASES.CORE_STARTUP,
    httpStatus: 200,
    expectedBodyMatched: true,
    sampledRunning: false,
    ownedProcess: { status: "not_running", classification: "not_running", fresh: true },
    mutationCount: 0,
  }).ready, false);
});

test("AC-4BZ.2 Windows Broker process start fixture classifies startup before later mutations", () => {
  const classified = classifyQualificationFailure(fixtures.windowsBrokerProcessStart);
  assert.equal(classified.phase, QUALIFICATION_PHASES.BROKER_STARTUP);
  assert.equal(classified.failureCode, QUALIFICATION_FAILURE_CODES.broker_startup);
  assert.equal(classified.classification, "startup_failure");
  assert.equal(classified.mutationCount, 0);
  assert.equal(classified.retryAllowed, true);
  const afterMutation = classifyQualificationFailure({
    ...fixtures.windowsBrokerProcessStart,
    mutationCount: 1,
  });
  assert.equal(afterMutation.retryAllowed, false);
  assert.equal(afterMutation.retryReason, "mutation_retry_forbidden");
});

test("AC-4BZ.2 retry is limited to one pre-mutation acquisition or startup attempt", () => {
  for (const phase of PRE_MUTATION_RETRY_PHASES) {
    assert.deepEqual(decideQualificationRetry({ phase, mutationCount: 0, priorRetryCount: 0 }), {
      allowed: true,
      reason: "pre_mutation_acquisition_startup",
    });
    assert.deepEqual(decideQualificationRetry({ phase, mutationCount: 0, priorRetryCount: 1 }), {
      allowed: false,
      reason: "acquisition_startup_retry_exhausted",
    });
    assert.deepEqual(decideQualificationRetry({ phase, mutationCount: 1, priorRetryCount: 0 }), {
      allowed: false,
      reason: "mutation_retry_forbidden",
    });
  }
  assert.deepEqual(
    decideQualificationRetry({
      phase: QUALIFICATION_PHASES.READINESS_SAMPLING,
      mutationCount: 0,
      priorRetryCount: 0,
    }),
    { allowed: false, reason: "retry_not_allowed_for_phase" },
  );
  assert.deepEqual(
    decideQualificationRetry({
      phase: QUALIFICATION_PHASES.OWNED_CLEANUP,
      mutationCount: 0,
      priorRetryCount: 0,
    }),
    { allowed: false, reason: "retry_not_allowed_for_phase" },
  );
});

test("AC-4BZ.2 first failure and zero-mutation state survive later cleanup classification", () => {
  const first = classifyQualificationFailure(fixtures.windowsNpmInstall);
  const cleanup = classifyQualificationFailure({
    phase: QUALIFICATION_PHASES.OWNED_CLEANUP,
    error: { code: "cleanup_not_converged" },
    mutationCount: 0,
  });
  const preserved = preserveFirstFailure(first, cleanup);
  assert.equal(preserved.phase, QUALIFICATION_PHASES.NPM_ACQUISITION);
  assert.equal(preserved.failureCode, QUALIFICATION_FAILURE_CODES.npm_acquisition);
  assert.equal(preserved.mutationCount, 0);
  assert.equal(cleanup.failureCode, QUALIFICATION_FAILURE_CODES.owned_cleanup);
  assert.equal(cleanup.retryAllowed, false);
});

test("AC-4BZ.2 current-attempt artifact selection retains prior failures without counting them as extras", () => {
  const runId = "33500138538";
  const artifacts = [
    { name: `published-package-qualification-linux-${runId}-1` },
    { name: `published-package-qualification-win32-${runId}-1` },
    { name: `published-package-qualification-darwin-${runId}-1` },
    { name: `published-package-qualification-linux-${runId}-2` },
    { name: `published-package-qualification-win32-${runId}-2` },
    { name: `published-package-qualification-darwin-${runId}-2` },
  ];
  const selected = selectCurrentAttemptArtifacts(artifacts, runId, "2");
  assert.equal(selected.currentComplete, true);
  assert.equal(selected.current.length, 3);
  assert.equal(selected.retainedPriorAttempts.length, 3);
  assert.equal(selected.extras.length, 0);
  assert.equal(selectCurrentAttemptArtifacts(artifacts, runId, "1").retainedPriorAttempts.length, 3);
  const extra = selectCurrentAttemptArtifacts(
    [...artifacts, { name: "screenshots-win32" }],
    runId,
    "2",
  );
  assert.equal(extra.currentComplete, false);
  assert.equal(extra.extras.length, 1);
});

test("AC-4BZ.2 success evidence may record a retried pre-mutation first failure and never mutation retry", () => {
  const firstFailure = classifyQualificationFailure(fixtures.windowsNpmInstall);
  const ok = validateReliabilitySuccessFields({
    mutationRetry: false,
    acquisitionRetry: true,
    startupRetry: false,
    firstFailure: {
      phase: firstFailure.phase,
      failureCode: firstFailure.failureCode,
      classification: firstFailure.classification,
      mutationCount: 0,
    },
  });
  assert.deepEqual(ok, { ok: true, code: null });
  assert.equal(
    validateReliabilitySuccessFields({
      mutationRetry: true,
      acquisitionRetry: false,
      startupRetry: false,
      firstFailure: null,
    }).ok,
    false,
  );
  assert.equal(
    validateReliabilitySuccessFields({
      mutationRetry: false,
      acquisitionRetry: true,
      startupRetry: false,
      firstFailure: {
        phase: QUALIFICATION_PHASES.NPM_ACQUISITION,
        failureCode: QUALIFICATION_FAILURE_CODES.npm_acquisition,
        classification: "acquisition_failure",
        mutationCount: 1,
      },
    }).ok,
    false,
  );
});

test("AC-4BZ.2 inspectOwnedChild reports live vs exited children without identity fields", () => {
  const live = inspectOwnedChild(process);
  assert.equal(live.fresh, true);
  assert.equal(live.status, "running");
  assert.equal(live.classification, "owned");
  assert.equal(Object.hasOwn(live, "pid"), false);

  const exited = new EventEmitter();
  exited.pid = 1;
  exited.exitCode = 1;
  const dead = inspectOwnedChild(exited);
  assert.equal(dead.status, "not_running");
  assert.equal(dead.classification, "not_running");

  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });
  try {
    const owned = inspectOwnedChild(child);
    assert.equal(owned.status, "running");
    assert.equal(owned.classification, "owned");
  } finally {
    child.kill("SIGTERM");
  }
});

test("AC-4BZ.2 three observed fixtures classify identically across repeated runs on every platform class", () => {
  const platforms = ["win32", "linux", "darwin"];
  for (const platform of platforms) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const npm = classifyQualificationFailure({
        ...fixtures.windowsNpmInstall,
        platform,
      });
      const lag = classifyQualificationFailure({
        ...fixtures.macosReadinessLag,
        platform,
      });
      const broker = classifyQualificationFailure({
        ...fixtures.windowsBrokerProcessStart,
        platform,
      });
      assert.equal(npm.failureCode, QUALIFICATION_FAILURE_CODES.npm_acquisition);
      assert.equal(lag.failureCode, QUALIFICATION_FAILURE_CODES.readiness_sampling_lag);
      assert.equal(broker.failureCode, QUALIFICATION_FAILURE_CODES.broker_startup);
      assert.equal(npm.mutationCount, 0);
      assert.equal(lag.mutationCount, 0);
      assert.equal(broker.mutationCount, 0);
    }
  }
});
