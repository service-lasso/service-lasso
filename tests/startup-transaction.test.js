import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, rm } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import { getLifecycleState, resetLifecycleState, setLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { configService, installService, startService } from "../dist/runtime/lifecycle/actions.js";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { createServiceRegistry } from "../dist/runtime/manager/DependencyGraph.js";
import { stopManagedProcess } from "../dist/runtime/execution/supervisor.js";
import { writeServiceState } from "../dist/runtime/state/writeState.js";
import {
  beginRuntimeGeneration,
  publishRuntimeGeneration,
  readRuntimeGenerationRegistry,
  registerRuntimeInstance,
  resolveRuntimeInstanceId,
} from "../dist/runtime/instance/registry.js";
import {
  classifyRegisteredProcess,
  findProcessOwnership,
  readProcessOwnershipRegistry,
  recordProcessOwnership,
  transitionProcessOwnership,
} from "../dist/runtime/process/registry.js";
import { inspectStartupRecovery } from "../dist/runtime/startup/recovery.js";
import {
  readRuntimeEndpointAllocationPlan,
  servicePortsFromEndpointAllocation,
} from "../dist/runtime/ports/allocation.js";
import {
  STARTUP_TRANSACTION_PHASES,
  StartupTransactionRecoveryRequiredError,
  advanceStartupTransaction,
  beginStartupTransaction,
  getStartupTransactionJournalPath,
  readStartupTransactionJournal,
  settleStartupTransaction,
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

test("AC-4BJ.2 injected failure before generation commit rolls back deterministically", async () => {
  for (const injectedPhase of STARTUP_TRANSACTION_PHASES.filter((phase) => phase !== "generation_committed")) {
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
    assert.deepEqual(journal.startedServiceIds, ["alpha-service", "bravo-service", "charlie-service"]);
    assert.ok(journal.completedActions.includes("service_start_intended:charlie-service"));
    assert.equal(journal.completedActions.includes("service_started:charlie-service"), false);
    assert.ok(
      journal.completedActions.indexOf("service_stopped:charlie-service") <
        journal.completedActions.indexOf("service_stopped:bravo-service"),
    );
    assert.ok(
      journal.completedActions.indexOf("service_stopped:bravo-service") <
        journal.completedActions.indexOf("service_stopped:alpha-service"),
    );
    assert.equal(getLifecycleState("alpha-service").running, false);
    assert.equal(getLifecycleState("bravo-service").running, false);
    assert.equal(getLifecycleState("charlie-service").running, false);
  });
});

test("AC-4BJ.4 hard-interrupted startup resumes the same generation, allocation, and recorded service owner", async () => {
  await withStartupEnvironment("service-lasso-startup-cross-process-resume-", async (fixture) => {
    await writeExecutableFixtureService(fixture.servicesRoot, "resume-service", { autostart: true });
    const child = spawn(
      process.execPath,
      [
        path.resolve("tests", "fixtures", "startup-crash-runner.mjs"),
        fixture.servicesRoot,
        fixture.workspaceRoot,
        "ownership_persisted",
      ],
      { env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] },
    );
    const [exitCode] = await once(child, "exit");
    assert.equal(exitCode, 86);

    let interrupted = await readStartupTransactionJournal(fixture.workspaceRoot);
    const interruptedAllocation = await readRuntimeEndpointAllocationPlan(fixture.workspaceRoot);
    assert.equal(interrupted.status, "active");
    assert.equal(interrupted.phase, "ownership_persisted");

    const discovered = await discoverServices(fixture.servicesRoot);
    const registry = createServiceRegistry(discovered);
    const service = registry.getById("resume-service");
    assert.ok(service);
    await writeServiceState(service, (await installService(service, registry)).state);
    await writeServiceState(service, (await configService(service, registry)).state);
    const started = await startService(service, registry, {
      workspaceRoot: fixture.workspaceRoot,
      runtimeGenerationId: interrupted.generationId,
      runtimeInstanceId: interrupted.instanceId,
      allocationRevision: interruptedAllocation.allocationId,
      plannedPorts: servicePortsFromEndpointAllocation(interruptedAllocation)[service.manifest.id],
    });
    await writeServiceState(service, started.state);
    interrupted = await advanceStartupTransaction(interrupted, interrupted.phase, {
      completedActions: ["service_started:resume-service"],
      addCompensations: ["stop_service:resume-service"],
      startedServiceIds: ["resume-service"],
    });

    let apiServer;
    try {
      apiServer = await startApiServer({
        port: 0,
        servicesRoot: fixture.servicesRoot,
        workspaceRoot: fixture.workspaceRoot,
        autostart: true,
      });
      const resumed = await readStartupTransactionJournal(fixture.workspaceRoot);
      const generations = await readRuntimeGenerationRegistry(fixture.workspaceRoot);
      const resumedOwner = await findProcessOwnership(fixture.workspaceRoot, "service", "resume-service");
      assert.equal(resumed.status, "committed");
      assert.equal(resumed.generationId, interrupted.generationId);
      assert.equal(resumed.allocationRevision, interruptedAllocation.allocationId);
      assert.equal(apiServer.endpointAllocationPlan.allocationId, interruptedAllocation.allocationId);
      assert.equal(generations.activeGenerationId, interrupted.generationId);
      assert.equal(resumedOwner.pid, started.state.runtime.pid);
      assert.equal(await classifyRegisteredProcess(resumedOwner), "owned");
      assert.equal(getLifecycleState("resume-service").runtime.pid, started.state.runtime.pid);
      assert.ok(resumed.completedActions.includes("recovery_resume_started"));
      assert.ok(resumed.completedActions.includes("generation_recovered"));
    } finally {
      await apiServer?.stop();
      await stopManagedProcess("resume-service", 100).catch(() => null);
    }
  });
});

test("AC-4BJ.4 recovery preparation failure remains blocked and recoverable before allocation claim", async () => {
  await withStartupEnvironment("service-lasso-startup-recovery-preparation-", async (fixture) => {
    const child = spawn(
      process.execPath,
      [
        path.resolve("tests", "fixtures", "startup-preflight-crash-runner.mjs"),
        fixture.servicesRoot,
        fixture.workspaceRoot,
      ],
      { env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] },
    );
    const [exitCode] = await once(child, "exit");
    assert.equal(exitCode, 86);

    const recoveryConfig = {
      servicesRoot: fixture.servicesRoot,
      workspaceRoot: fixture.workspaceRoot,
      version: "test",
    };
    let recovery = await inspectStartupRecovery(recoveryConfig, []);
    const recoveryDeadline = Date.now() + 15_000;
    while (recovery.classification !== "resume" && Date.now() < recoveryDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      recovery = await inspectStartupRecovery(recoveryConfig, []);
    }
    assert.equal(recovery.classification, "resume", recovery.reason);
    assert.equal(recovery.reason, "transaction_evidence_agrees");

    await assert.rejects(
      startApiServer({
        port: 0,
        servicesRoot: fixture.servicesRoot,
        workspaceRoot: fixture.workspaceRoot,
        startupTransactionTestHooks: {
          beforeRecoveryGeneration: async () => {
            throw new Error("injected-recovery-preparation-failure");
          },
        },
      }),
      /injected-recovery-preparation-failure/,
    );

    const journal = await readStartupTransactionJournal(fixture.workspaceRoot);
    const allocation = await readRuntimeEndpointAllocationPlan(fixture.workspaceRoot);
    const inspection = await inspectStartupRecovery({
      servicesRoot: fixture.servicesRoot,
      workspaceRoot: fixture.workspaceRoot,
      version: "test",
    }, []);
    assert.equal(journal.status, "blocked");
    assert.ok(journal.completedActions.includes("recovery_preparation_started"));
    assert.ok(journal.pendingCompensations.includes("mark_generation_failed"));
    assert.equal(allocation, null);
    assert.equal(inspection.classification, "rollback");
  });
});

test("AC-4BJ.5 pre-generation rollback preserves unrelated owned processes", async () => {
  await withStartupEnvironment("service-lasso-startup-preserve-unrelated-", async (fixture) => {
    const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
      windowsHide: true,
    });
    try {
      await recordProcessOwnership(fixture.workspaceRoot, {
        ownerType: "service",
        ownerId: "unrelated-service",
        serviceId: "unrelated-service",
        generationId: "123e4567-e89b-42d3-a456-426614174099",
        pid: unrelated.pid,
        ownerRoot: fixture.tempRoot,
        lifecycleState: "running",
        source: "spawn",
      });
      const interrupted = await beginStartupTransaction({
        generationId: "123e4567-e89b-42d3-a456-426614174098",
        instanceId: resolveRuntimeInstanceId({
          servicesRoot: fixture.servicesRoot,
          workspaceRoot: fixture.workspaceRoot,
          version: "test",
        }),
        servicesRoot: fixture.servicesRoot,
        workspaceRoot: fixture.workspaceRoot,
      });

      const apiServer = await startApiServer({
        port: 0,
        servicesRoot: fixture.servicesRoot,
        workspaceRoot: fixture.workspaceRoot,
      });
      try {
        assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
        const ownership = await readProcessOwnershipRegistry(fixture.workspaceRoot);
        assert.equal(ownership.entries.find((entry) => entry.ownerId === "unrelated-service")?.pid, unrelated.pid);
        const current = await readStartupTransactionJournal(fixture.workspaceRoot);
        assert.equal(current.status, "committed");
        assert.equal(current.recoveredFromTransactionId, interrupted.transactionId);
      } finally {
        await apiServer.stop();
      }
      assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
    } finally {
      if (unrelated.exitCode === null) {
        unrelated.kill();
        await once(unrelated, "exit").catch(() => undefined);
      }
    }
  });
});

test("AC-4BJ.4 contradictory live runtime ownership blocks recovery without mutation", async () => {
  await withStartupEnvironment("service-lasso-startup-blocked-recovery-", async (fixture) => {
    const config = {
      servicesRoot: fixture.servicesRoot,
      workspaceRoot: fixture.workspaceRoot,
      version: "test",
    };
    const generationId = "123e4567-e89b-42d3-a456-426614174097";
    let journal = await beginStartupTransaction({
      generationId,
      instanceId: resolveRuntimeInstanceId(config),
      servicesRoot: fixture.servicesRoot,
      workspaceRoot: fixture.workspaceRoot,
    });
    await beginRuntimeGeneration(config, { generationId });
    journal = await advanceStartupTransaction(journal, "preflight_reconciliation", {
      completedActions: ["generation_started"],
      addCompensations: ["mark_generation_failed"],
    });
    await recordProcessOwnership(fixture.workspaceRoot, {
      ownerType: "runtime",
      ownerId: journal.instanceId,
      generationId: "123e4567-e89b-42d3-a456-426614174096",
      runtimeInstanceId: journal.instanceId,
      pid: process.pid,
      ownerRoot: fixture.servicesRoot,
      lifecycleState: "running",
      source: "runtime",
    });

    const inspection = await inspectStartupRecovery(config, []);
    assert.equal(inspection.classification, "blocked");
    assert.equal(inspection.reason, "runtime_owner_unverifiable_or_mismatched");
    assert.equal((await findProcessOwnership(fixture.workspaceRoot, "runtime", journal.instanceId)).pid, process.pid);
    assert.doesNotThrow(() => process.kill(process.pid, 0));

    await transitionProcessOwnership(
      fixture.workspaceRoot,
      "runtime",
      journal.instanceId,
      "stopped",
      "not_running",
      process.pid,
    );
    await publishRuntimeGeneration(config, generationId, { phase: "failed" });
    await settleStartupTransaction(journal, "rolled_back", {
      removeCompensations: ["mark_generation_failed"],
    });
  });
});

test("AC-4BJ.4 a live generation PID without runtime ownership remains blocked and untouched", async () => {
  await withStartupEnvironment("service-lasso-startup-unverified-generation-", async (fixture) => {
    const config = {
      servicesRoot: fixture.servicesRoot,
      workspaceRoot: fixture.workspaceRoot,
      version: "test",
    };
    const generationId = "123e4567-e89b-42d3-a456-426614174095";
    let journal = await beginStartupTransaction({
      generationId,
      instanceId: resolveRuntimeInstanceId(config),
      servicesRoot: fixture.servicesRoot,
      workspaceRoot: fixture.workspaceRoot,
    });
    await beginRuntimeGeneration(config, { generationId });
    journal = await advanceStartupTransaction(journal, "preflight_reconciliation", {
      completedActions: ["generation_started"],
      addCompensations: ["mark_generation_failed"],
    });

    const inspection = await inspectStartupRecovery(config, []);
    assert.equal(inspection.classification, "blocked");
    assert.equal(inspection.reason, "generation_process_unverifiable_without_runtime_ownership");
    assert.doesNotThrow(() => process.kill(process.pid, 0));

    await publishRuntimeGeneration(config, generationId, { phase: "failed" });
    await settleStartupTransaction(journal, "rolled_back", {
      removeCompensations: ["mark_generation_failed"],
    });
  });
});

test("AC-4BJ.4 runtime-instance evidence must agree across workspace and host recovery state", async () => {
  await withStartupEnvironment("service-lasso-startup-instance-mismatch-", async (fixture) => {
    const config = {
      servicesRoot: fixture.servicesRoot,
      workspaceRoot: fixture.workspaceRoot,
      version: "test",
    };
    const generationId = "123e4567-e89b-42d3-a456-426614174093";
    const wrongGenerationId = "123e4567-e89b-42d3-a456-426614174092";
    const priorRuntime = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
      windowsHide: true,
    });
    let journal = await beginStartupTransaction({
      generationId,
      instanceId: resolveRuntimeInstanceId(config),
      servicesRoot: fixture.servicesRoot,
      workspaceRoot: fixture.workspaceRoot,
    });
    await beginRuntimeGeneration(config, { generationId });
    await recordProcessOwnership(fixture.workspaceRoot, {
      ownerType: "runtime",
      ownerId: journal.instanceId,
      generationId,
      runtimeInstanceId: journal.instanceId,
      pid: priorRuntime.pid,
      ownerRoot: fixture.servicesRoot,
      lifecycleState: "running",
      source: "runtime",
    });
    priorRuntime.kill();
    await once(priorRuntime, "exit");
    journal = await advanceStartupTransaction(journal, "ownership_persisted", {
      completedActions: ["generation_started", "runtime_ownership_persisted", "runtime_instance_registered"],
      addCompensations: ["mark_generation_failed", "clear_runtime_ownership", "stop_runtime_instance"],
    });
    await registerRuntimeInstance(config, {
      generationId,
      apiPort: 18080,
      apiUrl: "http://127.0.0.1:18080",
      phase: "running",
    });
    const missingAllocation = await inspectStartupRecovery(config, []);
    assert.equal(missingAllocation.classification, "blocked");
    assert.equal(missingAllocation.reason, "runtime_instance_allocation_missing");
    assert.equal(missingAllocation.workspaceInstance.generationId, generationId);
    assert.equal(missingAllocation.hostInstance.generationId, generationId);

    await registerRuntimeInstance(config, {
      generationId: wrongGenerationId,
      apiPort: 18081,
      apiUrl: "http://127.0.0.1:18081",
      phase: "running",
    });

    const inspection = await inspectStartupRecovery(config, []);
    assert.equal(inspection.classification, "blocked");
    assert.equal(inspection.reason, "runtime_instance_workspace_host_mismatch");
    assert.equal(inspection.workspaceInstance.generationId, wrongGenerationId);
    assert.equal(inspection.hostInstance.generationId, generationId);
  });
});

test("AC-4BJ.5 a running service without durable ownership remains blocked and untouched", async () => {
  await withStartupEnvironment("service-lasso-startup-unverified-service-", async (fixture) => {
    await writeExecutableFixtureService(fixture.servicesRoot, "unverified-service", { autostart: true });
    const [service] = await discoverServices(fixture.servicesRoot);
    const config = {
      servicesRoot: fixture.servicesRoot,
      workspaceRoot: fixture.workspaceRoot,
      version: "test",
    };
    const generationId = "123e4567-e89b-42d3-a456-426614174094";
    let journal = await beginStartupTransaction({
      generationId,
      instanceId: resolveRuntimeInstanceId(config),
      servicesRoot: fixture.servicesRoot,
      workspaceRoot: fixture.workspaceRoot,
    });
    await beginRuntimeGeneration(config, { generationId });
    journal = await advanceStartupTransaction(journal, "preflight_reconciliation", {
      completedActions: ["generation_started", "service_start_intended:unverified-service"],
      addCompensations: ["mark_generation_failed", "stop_service:unverified-service"],
      startedServiceIds: ["unverified-service"],
    });
    await publishRuntimeGeneration(config, generationId, { phase: "failed" });
    journal = await advanceStartupTransaction(journal, journal.phase, {
      completedActions: ["generation_failed"],
      removeCompensations: ["mark_generation_failed"],
    });
    journal = await settleStartupTransaction(journal, "blocked");
    const runningState = setLifecycleState("unverified-service", {
      ...getLifecycleState("unverified-service"),
      running: true,
      runtime: {
        ...getLifecycleState("unverified-service").runtime,
        generationId,
        pid: process.pid,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        command: process.execPath,
      },
    });
    await writeServiceState(service, runningState);

    const inspection = await inspectStartupRecovery(config, [service]);
    assert.equal(inspection.classification, "blocked");
    assert.equal(inspection.reason, "recorded_service_running_without_ownership");
    assert.equal(await findProcessOwnership(fixture.workspaceRoot, "service", "unverified-service"), null);
    assert.doesNotThrow(() => process.kill(process.pid, 0));

    await writeServiceState(service, setLifecycleState("unverified-service", {
      ...runningState,
      running: false,
      runtime: { ...runningState.runtime, pid: null, finishedAt: new Date().toISOString() },
    }));
    await settleStartupTransaction(journal, "rolled_back", {
      removeCompensations: ["stop_service:unverified-service"],
    });
  });
});

test("AC-4BJ.5 dead transaction service selects rollback and a fresh generation", async () => {
  await withStartupEnvironment("service-lasso-startup-cross-process-rollback-", async (fixture) => {
    await writeExecutableFixtureService(fixture.servicesRoot, "rollback-service", { autostart: true });
    const child = spawn(
      process.execPath,
      [
        path.resolve("tests", "fixtures", "startup-crash-runner.mjs"),
        fixture.servicesRoot,
        fixture.workspaceRoot,
        "owned_readiness_proven",
        "rollback-service",
      ],
      { env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] },
    );
    const [exitCode] = await once(child, "exit");
    assert.equal(exitCode, 86);
    const interrupted = await readStartupTransactionJournal(fixture.workspaceRoot);
    const oldOwner = await findProcessOwnership(fixture.workspaceRoot, "service", "rollback-service");
    assert.equal(await classifyRegisteredProcess(oldOwner), "not_running");
    let recovery = await inspectStartupRecovery({
      servicesRoot: fixture.servicesRoot,
      workspaceRoot: fixture.workspaceRoot,
      version: "test",
    }, await discoverServices(fixture.servicesRoot));
    const recoveryDeadline = Date.now() + 15_000;
    while (recovery.classification !== "rollback" && Date.now() < recoveryDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      recovery = await inspectStartupRecovery({
        servicesRoot: fixture.servicesRoot,
        workspaceRoot: fixture.workspaceRoot,
        version: "test",
      }, await discoverServices(fixture.servicesRoot));
    }
    assert.equal(recovery.classification, "rollback", recovery.reason);
    assert.equal(recovery.reason, "transaction_resources_require_rollback");

    let apiServer;
    try {
      apiServer = await startApiServer({
        port: 0,
        servicesRoot: fixture.servicesRoot,
        workspaceRoot: fixture.workspaceRoot,
        autostart: true,
      });
    } catch (error) {
      const trace = getLifecycleState("rollback-service").runtime.startTrace.current;
      const processSpawn = trace?.events.find((event) => event.phase === "process_spawn" && event.status === "failed");
      throw new Error(
        `Successor startup failed during ${String(processSpawn?.metadata.processStartFailurePhase ?? "unknown_phase")}.`,
        { cause: error },
      );
    }
    try {
      const recovered = await readStartupTransactionJournal(fixture.workspaceRoot);
      const generations = await readRuntimeGenerationRegistry(fixture.workspaceRoot);
      const oldGeneration = generations.generations.find((entry) => entry.generationId === interrupted.generationId);
      const newOwner = await findProcessOwnership(fixture.workspaceRoot, "service", "rollback-service");
      assert.equal(recovered.status, "committed");
      assert.equal(recovered.recoveredFromTransactionId, interrupted.transactionId);
      assert.notEqual(recovered.generationId, interrupted.generationId);
      assert.equal(oldGeneration.phase, "failed");
      assert.equal(generations.activeGenerationId, recovered.generationId);
      assert.notEqual(newOwner.pid, oldOwner.pid);
      assert.equal(newOwner.generationId, recovered.generationId);
    } finally {
      await apiServer.stop();
    }
  });
});
