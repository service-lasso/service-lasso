import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile, rm } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import { getLifecycleState, resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { readRuntimeGenerationRegistry } from "../dist/runtime/instance/registry.js";
import { readRuntimeEndpointAllocationPlan } from "../dist/runtime/ports/allocation.js";
import {
  STARTUP_TRANSACTION_PHASES,
  StartupTransactionRecoveryRequiredError,
  advanceStartupTransaction,
  beginStartupTransaction,
  getStartupTransactionJournalPath,
  readStartupTransactionJournal,
} from "../dist/runtime/startup/transaction.js";
import { makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";

async function withStartupEnvironment(prefix, action) {
  const fixture = await makeTempServicesRoot(prefix);
  const previous = {
    hostRegistry: process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH,
    instanceRegistry: process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH,
    hooks: process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS,
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
    resetLifecycleState();
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
}

test("AC-4BJ.1 startup journal is durable, secret-free, and blocks unresolved recovery", async () => {
  await withStartupEnvironment("service-lasso-startup-journal-", async (fixture) => {
    const input = {
      generationId: "123e4567-e89b-42d3-a456-426614174000",
      instanceId: "sl_fixture",
      servicesRoot: fixture.servicesRoot,
      workspaceRoot: fixture.workspaceRoot,
    };
    let journal = await beginStartupTransaction(input);
    journal = await advanceStartupTransaction(journal, "allocation_reserved", {
      allocationRevision: "allocation-fixture",
      completedActions: ["allocation_reserved:allocation-fixture"],
      addCompensations: ["release_allocation:allocation-fixture"],
    });

    const recovered = await readStartupTransactionJournal(fixture.workspaceRoot);
    assert.deepEqual(recovered, journal);
    assert.equal(recovered.status, "active");
    assert.deepEqual(recovered.pendingCompensations, ["release_allocation:allocation-fixture"]);
    const raw = await readFile(getStartupTransactionJournalPath(fixture.workspaceRoot), "utf8");
    assert.doesNotMatch(raw, /password|credential|token|secret-value/i);

    await assert.rejects(
      () => beginStartupTransaction({ ...input, generationId: "123e4567-e89b-42d3-a456-426614174001" }),
      (error) => {
        assert.ok(error instanceof StartupTransactionRecoveryRequiredError);
        assert.equal(error.code, "startup_transaction_recovery_required");
        assert.equal(error.journal.transactionId, journal.transactionId);
        return true;
      },
    );
  });
});

test("AC-4BJ.3 successful startup crosses every phase and seals one owned generation", async () => {
  await withStartupEnvironment("service-lasso-startup-commit-", async (fixture) => {
    const observedPhases = [];
    const apiServer = await startApiServer({
      port: 0,
      servicesRoot: fixture.servicesRoot,
      workspaceRoot: fixture.workspaceRoot,
      startupTransactionTestHooks: {
        afterPhase: async ({ phase }) => observedPhases.push(phase),
      },
    });
    try {
      const journal = await readStartupTransactionJournal(fixture.workspaceRoot);
      const generations = await readRuntimeGenerationRegistry(fixture.workspaceRoot);
      assert.deepEqual(observedPhases, [...STARTUP_TRANSACTION_PHASES]);
      assert.equal(journal.status, "committed");
      assert.equal(journal.phase, "generation_committed");
      assert.deepEqual(journal.pendingCompensations, []);
      assert.equal(journal.generationId, generations.activeGenerationId);
      assert.equal(journal.allocationRevision, apiServer.endpointAllocationPlan.allocationId);
      assert.equal(apiServer.endpointAllocationPlan.generationId, journal.generationId);
    } finally {
      await apiServer.stop();
    }
  });
});

test("AC-4BJ.2 injected failure after every phase rolls back deterministically", async () => {
  for (const injectedPhase of STARTUP_TRANSACTION_PHASES) {
    await withStartupEnvironment(`service-lasso-startup-fault-${injectedPhase}-`, async (fixture) => {
      await assert.rejects(
        startApiServer({
          port: 0,
          servicesRoot: fixture.servicesRoot,
          workspaceRoot: fixture.workspaceRoot,
          startupTransactionTestHooks: {
            afterPhase: async ({ phase }) => {
              if (phase === injectedPhase) throw new Error(`injected-${phase}`);
            },
          },
        }),
        new RegExp(`injected-${injectedPhase}`),
      );

      const journal = await readStartupTransactionJournal(fixture.workspaceRoot);
      const generations = await readRuntimeGenerationRegistry(fixture.workspaceRoot);
      const allocation = await readRuntimeEndpointAllocationPlan(fixture.workspaceRoot);
      assert.equal(journal.status, "rolled_back", injectedPhase);
      assert.equal(journal.failureCode, "error", injectedPhase);
      assert.deepEqual(journal.pendingCompensations, [], injectedPhase);
      assert.equal(generations.activeGenerationId, null, injectedPhase);
      if (allocation) assert.equal(allocation.phase, "released", injectedPhase);
    });
  }
});

test("AC-4BJ.2 a later service failure rolls back prior transaction services in reverse dependency order", async () => {
  await withStartupEnvironment("service-lasso-startup-reverse-rollback-", async (fixture) => {
    await writeExecutableFixtureService(fixture.servicesRoot, "alpha-service", {
      autostart: true,
      serviceorder: 1,
    });
    await writeExecutableFixtureService(fixture.servicesRoot, "bravo-service", {
      autostart: true,
      serviceorder: 2,
      depend_on: ["alpha-service"],
    });
    await writeExecutableFixtureService(fixture.servicesRoot, "charlie-service", {
      autostart: true,
      serviceorder: 3,
      depend_on: ["bravo-service"],
      healthcheck: {
        type: "file",
        file: "./runtime/missing-ready.txt",
        retries: 2,
        interval: 25,
      },
    });

    await assert.rejects(
      startApiServer({
        port: 0,
        servicesRoot: fixture.servicesRoot,
        workspaceRoot: fixture.workspaceRoot,
        autostart: true,
      }),
      /Transactional startup failed for service "charlie-service"/,
    );

    const journal = await readStartupTransactionJournal(fixture.workspaceRoot);
    assert.equal(journal.status, "rolled_back");
    assert.deepEqual(journal.startedServiceIds, ["alpha-service", "bravo-service"]);
    assert.ok(
      journal.completedActions.indexOf("service_stopped:bravo-service") <
        journal.completedActions.indexOf("service_stopped:alpha-service"),
    );
    assert.equal(getLifecycleState("alpha-service").running, false);
    assert.equal(getLifecycleState("bravo-service").running, false);
    assert.equal(getLifecycleState("charlie-service").running, false);
  });
});
