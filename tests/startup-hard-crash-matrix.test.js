import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, readdir, rm } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import { resolveRuntimeConfig } from "../dist/runtime/config.js";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { getLifecycleState, resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { stopManagedProcess } from "../dist/runtime/execution/supervisor.js";
import {
  readRuntimeGenerationRegistry,
  readRuntimeInstanceRegistry,
  readRuntimeInstanceState,
} from "../dist/runtime/instance/registry.js";
import {
  readRuntimeEndpointAllocationPlan,
  runtimeApiEndpointFromAllocation,
} from "../dist/runtime/ports/allocation.js";
import {
  classifyRegisteredProcess,
  findProcessOwnership,
  readProcessOwnershipRegistry,
} from "../dist/runtime/process/registry.js";
import { terminateOwnedProcessTree } from "../dist/runtime/process/tree.js";
import { inspectStartupRecovery } from "../dist/runtime/startup/recovery.js";
import {
  STARTUP_TRANSACTION_PHASES,
  getStartupTransactionJournalPath,
  readStartupTransactionJournal,
} from "../dist/runtime/startup/transaction.js";
import { makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";

const selectedPhase = process.env.SERVICE_LASSO_HARD_CRASH_PHASE?.trim() || null;
const expectedInspection = new Map([
  ["preflight_reconciliation", "rollback"],
  ["allocation_reserved", "resume"],
  ["configuration_materialized", "resume"],
  ["process_spawned", "resume"],
  ["ownership_persisted", "resume"],
  ["owned_readiness_proven", "evidence-dependent"],
  ["generation_committed", "commit_cleanup"],
]);
const serviceWasStartedBeforeCrash = new Set(["owned_readiness_proven", "generation_committed"]);

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stopExactChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, "exit");
  child.kill("SIGTERM");
  if (!(await Promise.race([closed.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 5_000))]))) {
    child.kill("SIGKILL");
    await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 5_000))]);
  }
}

async function waitForHardExit(child, timeoutMs = 120_000) {
  const closed = once(child, "exit");
  const outcome = await Promise.race([
    closed.then(([code, signal]) => ({ kind: "exit", code, signal })),
    new Promise((resolve) => setTimeout(() => resolve({ kind: "timeout" }), timeoutMs)),
  ]);
  if (outcome.kind === "timeout") {
    await stopExactChild(child);
    throw new Error(`Hard-crash fixture did not exit within ${timeoutMs}ms.`);
  }
  return outcome;
}

async function waitForRecoveryClassification(config, discovered, accepts, timeoutMs = 15_000) {
  let inspection = await inspectStartupRecovery(config, discovered);
  const deadline = Date.now() + timeoutMs;
  while (!accepts(inspection.classification) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    inspection = await inspectStartupRecovery(config, discovered);
  }
  return inspection;
}

function collectBoundedOutput(stream, maxBytes = 64 * 1024) {
  let bytes = 0;
  let text = "";
  stream?.on("data", (chunk) => {
    bytes += chunk.length;
    if (bytes <= maxBytes) text += chunk.toString("utf8");
  });
  return {
    get value() { return text; },
    get bytes() { return bytes; },
  };
}

async function cleanupPersistedServiceOwner(workspaceRoot, serviceId) {
  await stopManagedProcess(serviceId).catch(() => undefined);
  const ownership = await findProcessOwnership(workspaceRoot, "service", serviceId).catch(() => null);
  if (!ownership?.pid || !ownership.identity) return;
  if (ownership.lifecycleState === "stopped") return;
  if (await classifyRegisteredProcess(ownership).catch(() => "unknown_owner") !== "owned") return;
  await terminateOwnedProcessTree({
    rootPid: ownership.pid,
    rootIdentity: ownership.identity,
    processGroup: ownership.processGroup,
  }, 5_000).catch(() => undefined);
}

async function listStartupResidue(workspaceRoot) {
  const stateRoot = path.join(workspaceRoot, ".service-lasso");
  let entries;
  try {
    entries = await readdir(stateRoot, { recursive: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  return entries.filter((entry) => {
    const normalized = entry.replaceAll("\\", "/");
    return /startup-transaction\.json\..+\.tmp$/i.test(normalized) ||
      /materialization-preimages\.json(?:\..+\.tmp)?$/i.test(normalized) ||
      /\.restore\.tmp$/i.test(normalized) ||
      /\.startup-[a-f0-9]{24}\.tmp$/i.test(normalized);
  });
}

async function withMatrixEnvironment(phase, action) {
  const fixture = await makeTempServicesRoot(`service-lasso-hard-crash-${phase}-`);
  const previous = {
    hostRegistry: process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH,
    instanceRegistry: process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH,
    hooks: process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS,
    secret: process.env.SERVICE_LASSO_HARD_CRASH_SECRET,
  };
  process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH = path.join(fixture.tempRoot, "host", "allocations.json");
  process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH = path.join(fixture.tempRoot, "host", "instances.json");
  process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = "1";
  process.env.SERVICE_LASSO_HARD_CRASH_SECRET = "matrix-secret-must-not-appear";
  try {
    await action(fixture);
  } finally {
    await cleanupPersistedServiceOwner(fixture.workspaceRoot, "matrix-service");
    if (previous.hostRegistry === undefined) delete process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH;
    else process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH = previous.hostRegistry;
    if (previous.instanceRegistry === undefined) delete process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH;
    else process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH = previous.instanceRegistry;
    if (previous.hooks === undefined) delete process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
    else process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = previous.hooks;
    if (previous.secret === undefined) delete process.env.SERVICE_LASSO_HARD_CRASH_SECRET;
    else process.env.SERVICE_LASSO_HARD_CRASH_SECRET = previous.secret;
    resetLifecycleState();
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
}

test("AC-4BJ.9 hard-crash matrix metadata covers every formal startup phase", async () => {
  assert.deepEqual([...expectedInspection.keys()], [...STARTUP_TRANSACTION_PHASES]);
  const documentation = await readFile(new URL("../docs/reference/startup-hard-crash-matrix.md", import.meta.url), "utf8");
  const workflow = await readFile(new URL("../.github/workflows/startup-hard-crash-matrix.yml", import.meta.url), "utf8");
  for (const phase of STARTUP_TRANSACTION_PHASES) {
    assert.match(documentation, new RegExp(`\\b${phase}\\b`));
    assert.match(workflow, new RegExp(`- ${phase}\\b`));
  }
  assert.match(workflow, /ubuntu-latest/);
  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /SERVICE_LASSO_HARD_CRASH_PHASE/);
});

for (const phase of STARTUP_TRANSACTION_PHASES) {
  test(`AC-4BJ.9 hard exit after ${phase} recovers without unrelated termination or residue`, {
    skip: selectedPhase !== null && selectedPhase !== phase,
    timeout: 720_000,
  }, async () => {
    await withMatrixEnvironment(phase, async (fixture) => {
      await writeExecutableFixtureService(fixture.servicesRoot, "matrix-service", {
        autostart: true,
        env: { MATRIX_PRIVATE_VALUE: "matrix-secret-must-not-appear" },
      });
      const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        stdio: "ignore",
        windowsHide: true,
      });
      await once(unrelated, "spawn");
      const crash = spawn(
        process.execPath,
        [
          path.resolve("tests", "fixtures", "startup-crash-runner.mjs"),
          fixture.servicesRoot,
          fixture.workspaceRoot,
          phase,
        ],
        { env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
      );
      const stdout = collectBoundedOutput(crash.stdout);
      const stderr = collectBoundedOutput(crash.stderr);
      let apiServer = null;

      try {
        const exit = await waitForHardExit(crash);
        assert.equal(exit.code, 86);
        assert.equal(exit.signal, null);
        assert.ok(stdout.bytes <= 64 * 1024);
        assert.ok(stderr.bytes <= 64 * 1024);
        assert.doesNotMatch(`${stdout.value}\n${stderr.value}`, /matrix-secret-must-not-appear/);

        const interrupted = await readStartupTransactionJournal(fixture.workspaceRoot);
        const interruptedRaw = await readFile(getStartupTransactionJournalPath(fixture.workspaceRoot), "utf8");
        const interruptedAllocation = await readRuntimeEndpointAllocationPlan(fixture.workspaceRoot);
        const interruptedServiceOwner = await findProcessOwnership(
          fixture.workspaceRoot,
          "service",
          "matrix-service",
        );
        const interruptedServiceOwnership = interruptedServiceOwner
          ? await classifyRegisteredProcess(interruptedServiceOwner)
          : "missing";
        assert.equal(interrupted.status, "active");
        assert.equal(interrupted.phase, phase);
        assert.doesNotMatch(interruptedRaw, /matrix-secret-must-not-appear/);
        assert.equal(processIsAlive(unrelated.pid), true);
        assert.deepEqual(await listStartupResidue(fixture.workspaceRoot), []);
        assert.equal(Boolean(interruptedServiceOwner), serviceWasStartedBeforeCrash.has(phase));

        const config = resolveRuntimeConfig({
          servicesRoot: fixture.servicesRoot,
          workspaceRoot: fixture.workspaceRoot,
        });
        const discovered = await discoverServices(fixture.servicesRoot);
        const declaredClassification = expectedInspection.get(phase);
        const inspection = await waitForRecoveryClassification(
          config,
          discovered,
          (classification) => declaredClassification === "evidence-dependent"
            ? classification === "resume" || classification === "rollback"
            : classification === declaredClassification,
        );
        const expectedClassification = phase === "owned_readiness_proven"
          ? inspection.services.length === 1 && inspection.services[0].ownership === "owned"
            ? "resume"
            : "rollback"
          : declaredClassification;
        assert.equal(
          inspection.classification,
          expectedClassification,
          `startup recovery inspection: ${inspection.reason}`,
        );
        if (phase === "owned_readiness_proven") {
          assert.equal(
            inspection.reason,
            expectedClassification === "resume" ? "transaction_evidence_agrees" : "transaction_resources_require_rollback",
          );
        }
        const resumedInterruptedTransaction = expectedClassification === "resume";

        apiServer = await startApiServer({
          port: 0,
          servicesRoot: fixture.servicesRoot,
          workspaceRoot: fixture.workspaceRoot,
          autostart: true,
        });

        const recovered = await readStartupTransactionJournal(fixture.workspaceRoot);
        const recoveredRaw = await readFile(getStartupTransactionJournalPath(fixture.workspaceRoot), "utf8");
        const generations = await readRuntimeGenerationRegistry(fixture.workspaceRoot);
        const allocation = await readRuntimeEndpointAllocationPlan(fixture.workspaceRoot);
        const workspaceInstance = await readRuntimeInstanceState(config);
        const hostInstances = await readRuntimeInstanceRegistry();
        const runtimeOwner = await findProcessOwnership(fixture.workspaceRoot, "runtime", apiServer.instanceId);
        const serviceOwner = await findProcessOwnership(fixture.workspaceRoot, "service", "matrix-service");
        const processRegistry = await readProcessOwnershipRegistry(fixture.workspaceRoot);

        assert.equal(recovered.status, "committed");
        assert.equal(recovered.phase, "generation_committed");
        assert.deepEqual(recovered.pendingCompensations, []);
        assert.doesNotMatch(recoveredRaw, /matrix-secret-must-not-appear/);
        assert.equal(generations.activeGenerationId, apiServer.generationId);
        assert.equal(allocation.phase, "reserved");
        assert.equal(allocation.generationId, apiServer.generationId);
        assert.equal(allocation.allocationId, apiServer.endpointAllocationPlan.allocationId);
        assert.equal(runtimeApiEndpointFromAllocation(allocation).selectors.url.replace(/\/$/, ""), apiServer.url);
        assert.equal(workspaceInstance.generationId, apiServer.generationId);
        assert.equal(workspaceInstance.pid, process.pid);
        assert.equal(workspaceInstance.apiUrl, apiServer.url);
        const hostInstance = hostInstances.instances.find((entry) =>
          entry.instanceId === apiServer.instanceId && entry.generationId === apiServer.generationId,
        );
        assert.ok(hostInstance);
        assert.equal(hostInstance.pid, process.pid);
        assert.equal(hostInstance.apiUrl, apiServer.url);
        assert.equal(
          hostInstances.instances.some((entry) =>
            entry.instanceId === apiServer.instanceId &&
            entry.generationId !== apiServer.generationId &&
            (entry.status === "active" || entry.status === "unknown"),
          ),
          false,
        );
        assert.equal(await classifyRegisteredProcess(runtimeOwner), "owned");
        assert.equal(runtimeOwner.generationId, apiServer.generationId);
        assert.equal(runtimeOwner.allocation.revision, allocation.allocationId);
        assert.equal(await classifyRegisteredProcess(serviceOwner), "owned");
        assert.equal(serviceOwner.generationId, apiServer.generationId);
        assert.equal(serviceOwner.allocation.revision, allocation.allocationId);
        assert.equal(getLifecycleState("matrix-service").runtime.generationId, apiServer.generationId);
        assert.equal(getLifecycleState("matrix-service").runtime.allocationRevision, allocation.allocationId);
        assert.equal(
          processRegistry.entries.some((entry) =>
            entry.lifecycleState !== "stopped" && entry.generationId !== apiServer.generationId,
          ),
          false,
        );
        assert.equal(processIsAlive(unrelated.pid), true);
        assert.deepEqual(await listStartupResidue(fixture.workspaceRoot), []);

        if (resumedInterruptedTransaction) {
          assert.equal(recovered.transactionId, interrupted.transactionId);
          assert.equal(recovered.generationId, interrupted.generationId);
          assert.equal(allocation.allocationId, interruptedAllocation.allocationId);
        } else {
          assert.notEqual(recovered.transactionId, interrupted.transactionId);
          assert.notEqual(recovered.generationId, interrupted.generationId);
          if (phase !== "generation_committed") {
            assert.equal(recovered.recoveredFromTransactionId, interrupted.transactionId);
            if (phase === "preflight_reconciliation") assert.equal(interruptedAllocation, null);
          } else {
            const committedGeneration = generations.generations.find((entry) =>
              entry.generationId === interrupted.generationId,
            );
            assert.equal(phase, "generation_committed");
            assert.equal(committedGeneration.phase, "superseded");
            assert.notEqual(serviceOwner.pid, null);
            if (interruptedServiceOwnership === "owned") {
              assert.equal(serviceOwner.pid, interruptedServiceOwner.pid);
            }
          }
        }

        if (phase === "owned_readiness_proven" && resumedInterruptedTransaction) {
          assert.equal(serviceOwner.pid, interruptedServiceOwner.pid);
        }

        await apiServer.stop();
        apiServer = null;
        const stoppedAllocation = await readRuntimeEndpointAllocationPlan(fixture.workspaceRoot);
        const stoppedGenerations = await readRuntimeGenerationRegistry(fixture.workspaceRoot);
        const stoppedRegistry = await readProcessOwnershipRegistry(fixture.workspaceRoot);
        assert.equal(stoppedAllocation.phase, "released");
        assert.equal(stoppedGenerations.activeGenerationId, null);
        assert.equal(stoppedRegistry.entries.some((entry) => entry.lifecycleState !== "stopped"), false);
        assert.equal(processIsAlive(unrelated.pid), true);
        assert.deepEqual(await listStartupResidue(fixture.workspaceRoot), []);
      } finally {
        await apiServer?.stop().catch(() => undefined);
        await stopExactChild(crash);
        await stopExactChild(unrelated);
      }
    });
  });
}
