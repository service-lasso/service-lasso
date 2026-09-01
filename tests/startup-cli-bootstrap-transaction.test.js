import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, rm } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import { resolveRuntimeConfig } from "../dist/runtime/config.js";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { getLifecycleState, resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { stopManagedProcess } from "../dist/runtime/execution/supervisor.js";
import { findProcessOwnership } from "../dist/runtime/process/registry.js";
import { readRuntimeGenerationRegistry } from "../dist/runtime/instance/registry.js";
import { readRuntimeEndpointAllocationPlan } from "../dist/runtime/ports/allocation.js";
import { inspectStartupRecovery } from "../dist/runtime/startup/recovery.js";
import {
  getStartupTransactionJournalPath,
  readStartupTransactionJournal,
} from "../dist/runtime/startup/transaction.js";
import { ensureTestSecretsBrokerReady, makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";

async function withStartupEnvironment(prefix, action) {
  const fixture = await makeTempServicesRoot(prefix);
  const previous = {
    hostRegistry: process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH,
    instanceRegistry: process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH,
    hooks: process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS,
    runtimeApiBaseUrl: process.env.SERVICE_LASSO_RUNTIME_API_BASE_URL,
  };
  process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH = path.join(fixture.tempRoot, "host", "allocations.json");
  process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH = path.join(fixture.tempRoot, "host", "instances.json");
  process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = "1";
  try {
    await action(fixture);
  } finally {
    if (previous.hostRegistry === undefined) delete process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH;
    else process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH = previous.hostRegistry;
    if (previous.instanceRegistry === undefined) delete process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH;
    else process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH = previous.instanceRegistry;
    if (previous.hooks === undefined) delete process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
    else process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = previous.hooks;
    if (previous.runtimeApiBaseUrl === undefined) delete process.env.SERVICE_LASSO_RUNTIME_API_BASE_URL;
    else process.env.SERVICE_LASSO_RUNTIME_API_BASE_URL = previous.runtimeApiBaseUrl;
    resetLifecycleState();
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stopExactChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, "exit");
  child.kill("SIGTERM");
  await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 5_000))]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 5_000))]);
  }
}

test("AC-4BJ.2/.8 later CLI-baseline failure rolls back owned services and preserves an unrelated process", async () => {
  await withStartupEnvironment("service-lasso-cli-baseline-failure-", async (fixture) => {
    await ensureTestSecretsBrokerReady(fixture.workspaceRoot);
    await writeExecutableFixtureService(fixture.servicesRoot, "alpha-service", { serviceorder: 1 });
    await writeExecutableFixtureService(fixture.servicesRoot, "bravo-service", {
      serviceorder: 2,
      depend_on: ["alpha-service"],
    });
    const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
      windowsHide: true,
    });
    await once(unrelated, "spawn");
    const sensitiveFailure = "injected-baseline-failure-secret-value-C:/private/workspace";
    const priorRuntimeApiBaseUrl = "http://127.0.0.1:19999";
    process.env.SERVICE_LASSO_RUNTIME_API_BASE_URL = priorRuntimeApiBaseUrl;

    try {
      await assert.rejects(
        startApiServer({
          port: 0,
          servicesRoot: fixture.servicesRoot,
          workspaceRoot: fixture.workspaceRoot,
          baselineBootstrap: { serviceIds: ["alpha-service", "bravo-service"] },
          startupTransactionTestHooks: {
            afterBaselineAction: async ({ serviceId, action }) => {
              if (serviceId === "bravo-service" && action === "install") {
                throw new Error(sensitiveFailure);
              }
            },
          },
        }),
        /injected-baseline-failure-secret-value/,
      );

      const journal = await readStartupTransactionJournal(fixture.workspaceRoot);
      const generations = await readRuntimeGenerationRegistry(fixture.workspaceRoot);
      const allocation = await readRuntimeEndpointAllocationPlan(fixture.workspaceRoot);
      const rawJournal = await readFile(getStartupTransactionJournalPath(fixture.workspaceRoot), "utf8");
      assert.equal(journal.status, "rolled_back");
      assert.deepEqual(journal.pendingCompensations, []);
      assert.ok(journal.completedActions.includes("baseline_bootstrap_intended"));
      assert.ok(journal.completedActions.includes("baseline_action_completed:alpha-service:start"));
      assert.ok(journal.completedActions.includes("baseline_action_completed:bravo-service:install"));
      assert.ok(journal.completedActions.includes("service_stopped:alpha-service"));
      assert.equal(getLifecycleState("alpha-service").running, false);
      assert.equal(getLifecycleState("bravo-service").running, false);
      assert.equal(generations.activeGenerationId, null);
      if (allocation) assert.equal(allocation.phase, "released");
      assert.equal(processIsAlive(unrelated.pid), true);
      assert.equal(process.env.SERVICE_LASSO_RUNTIME_API_BASE_URL, priorRuntimeApiBaseUrl);
      assert.equal(rawJournal.includes(sensitiveFailure), false);
      assert.doesNotMatch(rawJournal, /secret-value|private\/workspace/i);
    } finally {
      await stopManagedProcess("alpha-service").catch(() => undefined);
      await stopManagedProcess("bravo-service").catch(() => undefined);
      await stopExactChild(unrelated);
    }
  });
});

test("AC-4BJ.4/.5/.8 hard-crashed CLI baseline rolls back its uncommitted owner and starts a fresh generation", async () => {
  await withStartupEnvironment("service-lasso-cli-baseline-crash-", async (fixture) => {
    await ensureTestSecretsBrokerReady(fixture.workspaceRoot);
    await writeExecutableFixtureService(fixture.servicesRoot, "resume-service", {
      captureEnvKeys: ["SERVICE_LASSO_RUNTIME_API_BASE_URL"],
    });
    const child = spawn(
      process.execPath,
      [
        path.resolve("tests", "fixtures", "startup-baseline-crash-runner.mjs"),
        fixture.servicesRoot,
        fixture.workspaceRoot,
        "resume-service",
      ],
      { env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );

    let apiServer = null;
    try {
      const [exitCode] = await once(child, "exit");
      assert.equal(exitCode, 87);
      const interrupted = await readStartupTransactionJournal(fixture.workspaceRoot);
      const interruptedAllocation = await readRuntimeEndpointAllocationPlan(fixture.workspaceRoot);
      const interruptedOwner = await findProcessOwnership(fixture.workspaceRoot, "service", "resume-service");
      assert.equal(interrupted.status, "active");
      assert.ok(interrupted.completedActions.includes("baseline_action_completed:resume-service:start"));
      assert.ok(interruptedOwner);

      const recoveryConfig = resolveRuntimeConfig({
        servicesRoot: fixture.servicesRoot,
        workspaceRoot: fixture.workspaceRoot,
      });
      const discovered = await discoverServices(fixture.servicesRoot);
      let inspection = await inspectStartupRecovery(recoveryConfig, discovered);
      const recoveryDeadline = Date.now() + 15_000;
      while (inspection.classification === "blocked" && Date.now() < recoveryDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        inspection = await inspectStartupRecovery(recoveryConfig, discovered);
      }
      assert.ok(
        inspection.classification === "resume" || inspection.classification === "rollback",
        `startup recovery inspection: ${inspection.reason}`,
      );

      apiServer = await startApiServer({
        port: 0,
        servicesRoot: fixture.servicesRoot,
        workspaceRoot: fixture.workspaceRoot,
        baselineBootstrap: { serviceIds: ["resume-service"] },
      });

      const recovered = await readStartupTransactionJournal(fixture.workspaceRoot);
      const recoveredOwner = await findProcessOwnership(fixture.workspaceRoot, "service", "resume-service");
      assert.equal(recovered.status, "committed");
      assert.equal(recovered.recoveredFromTransactionId, interrupted.transactionId);
      assert.notEqual(recovered.transactionId, interrupted.transactionId);
      assert.notEqual(recovered.generationId, interrupted.generationId);
      assert.notEqual(apiServer.endpointAllocationPlan.allocationId, interruptedAllocation.allocationId);
      assert.notEqual(recoveredOwner.pid, interruptedOwner.pid);
      assert.equal(recoveredOwner.generationId, apiServer.generationId);
      assert.equal(recoveredOwner.allocation.revision, apiServer.endpointAllocationPlan.allocationId);
      assert.equal(getLifecycleState("resume-service").running, true);
      assert.equal(getLifecycleState("resume-service").runtime.generationId, apiServer.generationId);
      assert.equal(
        getLifecycleState("resume-service").runtime.allocationRevision,
        apiServer.endpointAllocationPlan.allocationId,
      );
      const capturedEnv = JSON.parse(await readFile(
        path.join(fixture.servicesRoot, "resume-service", "runtime", "env.json"),
        "utf8",
      ));
      assert.equal(capturedEnv.SERVICE_LASSO_RUNTIME_API_BASE_URL, apiServer.url);
      assert.deepEqual(apiServer.baselineBootstrap.requestedServiceIds, ["resume-service"]);
      assert.deepEqual(
        apiServer.baselineBootstrap.services[0].actions.map(({ action, status }) => `${action}:${status}`),
        ["install:skipped", "config:skipped", "start:completed"],
      );
    } finally {
      await apiServer?.stop().catch(() => undefined);
      await stopManagedProcess("resume-service").catch(() => undefined);
      await stopExactChild(child);
    }
  });
});
