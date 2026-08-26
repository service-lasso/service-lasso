import path from "node:path";

import { discoverServices } from "../../dist/runtime/discovery/discoverServices.js";
import {
  hasManagedProcess,
  setManagedProcessRootInspectorForTests,
  setManagedProcessTreeTerminatorForTests,
  startManagedProcess,
  stopManagedProcess,
  waitForManagedProcessFinalization,
} from "../../dist/runtime/execution/supervisor.js";
import { createDirectExecutionPlan } from "../../dist/runtime/providers/direct.js";
import { writeExecutableFixtureService } from "../test-helpers.js";

const tempRoot = process.env.SERVICE_LASSO_DEADLINE_TEST_ROOT;
if (!tempRoot) {
  process.stderr.write(`${JSON.stringify({ outcome: "fixture_failed", errorCode: "TEMP_ROOT_REQUIRED" })}\n`);
  process.exit(1);
}

const servicesRoot = path.join(tempRoot, "services");
const serviceId = "deadline-service";
process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = "1";

try {
  await writeExecutableFixtureService(servicesRoot, serviceId, { autoExitMs: 6_500 });
  const [service] = await discoverServices(servicesRoot);
  setManagedProcessRootInspectorForTests(async (pid) => ({
    status: "running",
    identity: {
      pid,
      createdAt: new Date(0).toISOString(),
      executablePath: process.execPath,
      commandHash: "a".repeat(64),
    },
  }));
  const handle = await startManagedProcess({
    service,
    executionPlan: createDirectExecutionPlan(service.manifest),
  });
  setManagedProcessRootInspectorForTests(null);
  if (!(handle.pid > 0)) {
    throw Object.assign(new Error("managed process did not start"), { code: "PROCESS_START_FAILED" });
  }

  let abortObserved = false;
  let receivedTimeoutMs = null;
  let receivedDeadlineMs = null;
  setManagedProcessTreeTerminatorForTests(async (_target, timeoutMs, dependencies = {}) => {
    receivedTimeoutMs = timeoutMs;
    receivedDeadlineMs = dependencies.deadlineMs;
    return await new Promise(() => {
      dependencies.signal?.addEventListener("abort", () => {
        abortObserved = true;
      }, { once: true });
    });
  });

  const startedAt = Date.now();
  let failure = null;
  try {
    await stopManagedProcess(serviceId, 5_000);
  } catch (error) {
    failure = error;
  }
  const elapsedMs = Date.now() - startedAt;
  const mismatchCode = failure?.code !== "PROCESS_CONTROL_DEADLINE_EXCEEDED"
    ? "DEADLINE_ERROR_CODE_MISMATCH"
    : failure?.message !== "Process control did not converge before its deadline."
      ? "DEADLINE_ERROR_MESSAGE_MISMATCH"
      : !abortObserved
        ? "DEADLINE_ABORT_NOT_OBSERVED"
        : !(receivedTimeoutMs > 0 && receivedTimeoutMs <= 5_000)
          ? "DEADLINE_TIMEOUT_NOT_PROPAGATED"
          : !Number.isFinite(receivedDeadlineMs)
            ? "DEADLINE_ABSOLUTE_BOUND_MISSING"
            : elapsedMs < 4_500
              ? "DEADLINE_RETURNED_TOO_EARLY"
              : elapsedMs >= 6_000
                ? "DEADLINE_RETURNED_TOO_LATE"
                : !hasManagedProcess(serviceId)
                  ? "DEADLINE_MANAGED_STATE_LOST"
                  : null;
  if (mismatchCode) {
    throw Object.assign(new Error("managed stop deadline evidence did not match"), {
      code: mismatchCode,
    });
  }

  setManagedProcessTreeTerminatorForTests(null);
  await waitForManagedProcessFinalization(serviceId, Date.now() + 5_000);
  if (hasManagedProcess(serviceId)) {
    throw Object.assign(new Error("managed finalization did not converge"), {
      code: "FINALIZATION_DID_NOT_CONVERGE",
    });
  }

  process.stdout.write(`${JSON.stringify({
    outcome: "deadline_observed",
    errorCode: failure.code,
    elapsedMs,
    helperAborted: abortObserved,
    finalizationOutcome: "converged",
  })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    outcome: "fixture_failed",
    errorCode: typeof error?.code === "string" ? error.code : "FIXTURE_FAILED",
  })}\n`);
  process.exitCode = 1;
} finally {
  setManagedProcessRootInspectorForTests(null);
  setManagedProcessTreeTerminatorForTests(null);
  await waitForManagedProcessFinalization(serviceId, Date.now() + 10_000).catch(() => undefined);
  await stopManagedProcess(serviceId, 5_000).catch(() => undefined);
  setManagedProcessTreeTerminatorForTests(null);
}
