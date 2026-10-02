import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { observeHardCrashChildExit } from "./hard-crash-child-exit.js";
import { lifecycleFailureDiagnostic } from "./lifecycle-failure-diagnostics.js";
import { readFile, readdir, rm } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import { resolveRuntimeConfig } from "../dist/runtime/config.js";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { getLifecycleState, resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { stopManagedProcess, waitForManagedProcessFinalization, setManagedProcessEnrollmentHookForTests, hasManagedProcess } from "../dist/runtime/execution/supervisor.js";
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
  readProcessOwnershipCustodyForTest,
} from "../dist/runtime/process/registry.js";
import { inspectProcess } from "../dist/runtime/process/identity.js";
import { captureOwnedProcessTreeMembers } from "../dist/runtime/process/tree.js";
import { createFixtureCustody, closeFixture, createFixtureCleanupAdapter, createFixtureEvidenceBoundary } from "./hard-crash-fixture-custody.js";
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
  if (!child) return;
  const closed = child.fixtureClose;
  if (!closed) throw new Error("Fixture child close custody is missing.");
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  if (!(await Promise.race([closed.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 5_000))]))) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    if (!(await Promise.race([closed.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 5_000))]))) {
      throw new Error("Fixture child close remains unresolved.");
    }
  }
}

async function waitForHardExit(child, timeoutMs = 120_000) {
  const outcome = await observeHardCrashChildExit(child, timeoutMs);
  if (outcome.kind === "timeout") {
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

async function allocateFixtureApiPort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const closed = once(server, "close");
  server.close();
  await closed;
  return address.port;
}

async function withMatrixEnvironment(phase, action) {
  const fixture = await makeTempServicesRoot(`service-lasso-hard-crash-${phase}-`);
  const keys = ["SERVICE_LASSO_HOST_PORT_REGISTRY_PATH", "SERVICE_LASSO_INSTANCE_REGISTRY_PATH",
    "SERVICE_LASSO_PORT_RANGE_START", "SERVICE_LASSO_PORT_RANGE_END",
    "SERVICE_LASSO_ENABLE_TEST_HOOKS", "SERVICE_LASSO_HARD_CRASH_SECRET"];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  fixture.custody = createFixtureCustody();
  fixture.cleanupFailures = [];
  fixture.custodyReaders = [];
  fixture.recovery = "unknown";
  let enrollmentHookArmed = false;
  let primary;
  try {
    const apiPort = await allocateFixtureApiPort();
    process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH = path.join(fixture.tempRoot, "host", "allocations.json");
    process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH = path.join(fixture.tempRoot, "host", "instances.json");
    process.env.SERVICE_LASSO_PORT_RANGE_START = String(apiPort);
    process.env.SERVICE_LASSO_PORT_RANGE_END = String(apiPort);
    process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = "1";
    setManagedProcessEnrollmentHookForTests(null, (serviceId, read) => {
      try {
        if (serviceId === "matrix-service") fixture.custodyReaders.push(read);
      } catch (error) { fixture.cleanupFailures.push({ stage: "enrollment_observation", error }); }
    }, () => { fixture.cleanupFailures.push({ stage: "enrollment_observation", error: new Error("Fixture enrollment observation failed.") }); });
    enrollmentHookArmed = true;
    process.env.SERVICE_LASSO_HARD_CRASH_SECRET = "matrix-secret-must-not-appear";
    await action(fixture, apiPort);
  } catch (error) { primary = error; }
  await closeFixture({ primary, failures: fixture.cleanupFailures, custody: fixture.custody,
    recovery: fixture.recovery,
    adapter: createFixtureCleanupAdapter(fixture, {
      readRegistry: readProcessOwnershipCustodyForTest, classify: classifyRegisteredProcess,
      capture: captureOwnedProcessTreeMembers, stop: stopManagedProcess,
      finalize: waitForManagedProcessFinalization, inspect: inspectProcess,
      readInterrupted: async (workspaceRoot) => JSON.parse(await readFile(
        path.join(workspaceRoot, ".service-lasso", "hard-crash-fixture-custody.json"), "utf8")),
    }),
    restore: () => {
      try { if (enrollmentHookArmed) setManagedProcessEnrollmentHookForTests(null); }
      finally {
        for (const [key, value] of previous) {
          if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
      }
    },
    reset: () => resetLifecycleState(),
    evidence: createFixtureEvidenceBoundary(fixture.tempRoot),
    remove: () => rm(fixture.tempRoot, { recursive: true, force: true }),
    report: (summary) => console.error(JSON.stringify(summary)),
  });
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
    await withMatrixEnvironment(phase, async (fixture, apiPort) => {
      await writeExecutableFixtureService(fixture.servicesRoot, "matrix-service", {
        autostart: true,
        env: { MATRIX_PRIVATE_VALUE: "matrix-secret-must-not-appear" },
      });
      let unrelated;
      let crash;
      let apiServer = null;
      try {
        unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
          stdio: "ignore",
          windowsHide: true,
        });
        unrelated.fixtureClose = once(unrelated, "close");
        await once(unrelated, "spawn");
        crash = spawn(
          process.execPath,
          [
            path.resolve("tests", "fixtures", "startup-crash-runner.mjs"),
            fixture.servicesRoot,
            fixture.workspaceRoot,
            phase,
          ],
          { env: { ...process.env }, stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true },
        );
        crash.fixtureClose = once(crash, "close");
        let failureDiagnostic = null;
        crash.on("message", (message) => {
          if (message?.kind === "startup-crash-failure") failureDiagnostic = message;
        });
        const stdout = collectBoundedOutput(crash.stdout);
        const stderr = collectBoundedOutput(crash.stderr);

        const exit = await waitForHardExit(crash);
        assert.equal(exit.code, 86, JSON.stringify({ expectedExit: 86, actualExit: exit.code, failureDiagnostic }));
        assert.equal(exit.signal, null);
        assert.ok(stdout.bytes <= 64 * 1024);
        assert.ok(stderr.bytes <= 64 * 1024);
        assert.doesNotMatch(`${stdout.value}\n${stderr.value}`, /matrix-secret-must-not-appear/);

        fixture.custody.retain(JSON.parse(await readFile(path.join(fixture.workspaceRoot, ".service-lasso", "hard-crash-fixture-custody.json"), "utf8")));
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
        if (interruptedAllocation) {
          assert.equal(runtimeApiEndpointFromAllocation(interruptedAllocation).port, apiPort);
        }

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
        fixture.recovery = expectedClassification;
        const resumedInterruptedTransaction = expectedClassification === "resume";

        apiServer = await startApiServer({
          port: 0,
          servicesRoot: fixture.servicesRoot,
          workspaceRoot: fixture.workspaceRoot,
          autostart: true,
        });

        fixture.custody.retain(fixture.custodyReaders.flatMap((read) => read()));
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
        assert.equal(runtimeApiEndpointFromAllocation(allocation).port, apiPort);
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
      } catch (error) {
        try {
          console.error(JSON.stringify({
            kind: "startup-recovery-failure",
            interruptedPhase: phase,
            lifecycle: JSON.parse(lifecycleFailureDiagnostic({ error, state: getLifecycleState("matrix-service") })),
          }));
        } catch {
          // Bounded observation must not replace the assertion or cleanup path.
        }
        throw error;
      } finally {
        for (const [stage, cleanup] of [
          ["stop", () => apiServer?.stop()],
          ["child_close", () => stopExactChild(crash)],
          ["child_close", () => stopExactChild(unrelated)],
        ]) {
          try { await cleanup(); }
          catch (error) { fixture.cleanupFailures.push({ stage, error }); }
        }
      }
    });
  });
}

// Additional regression rows do not replace/narrow any formal matrix row.
// Both paths acquire custody during actual recovered enrollment/adoption and
// throw at owned readiness, after that acquisition but before startup returns.
for (const interruptedPhase of ["process_spawned", "generation_committed"]) {
  test(`AC-4BJ.9c recovered ${interruptedPhase} custody survives startup compensation before return`, {
    timeout: 720_000,
  }, async () => {
    const injected = new Error("PRIVATE-RECOVERED-STARTUP-FAILURE");
    await assert.rejects(withMatrixEnvironment(`compensation-${interruptedPhase}`, async (fixture) => {
      await writeExecutableFixtureService(fixture.servicesRoot, "matrix-service", { autostart: true });
      const crash = spawn(process.execPath, [path.resolve("tests", "fixtures", "startup-crash-runner.mjs"),
        fixture.servicesRoot, fixture.workspaceRoot, interruptedPhase], {
        env: { ...process.env }, stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true,
      });
      crash.fixtureClose = once(crash, "close");
      collectBoundedOutput(crash.stdout);
      collectBoundedOutput(crash.stderr);
      try {
        const exit = await waitForHardExit(crash);
        assert.equal(exit.code, 86);
        assert.equal(exit.signal, null);
        fixture.custody.retain(JSON.parse(await readFile(path.join(fixture.workspaceRoot,
          ".service-lasso", "hard-crash-fixture-custody.json"), "utf8")));
        const interruptedOwner = await findProcessOwnership(fixture.workspaceRoot, "service", "matrix-service");
        if (interruptedPhase === "generation_committed") {
          // A replacement start is not adoption proof. This regression requires
          // the real interrupted owner to remain owned before recovery.
          assert.ok(interruptedOwner?.identity);
          assert.equal(await classifyRegisteredProcess(interruptedOwner), "owned");
        }
        let observedBeforeReturn = false;
        let returned = false;
        let server;
        try {
          server = await startApiServer({ port: 0, servicesRoot: fixture.servicesRoot,
            workspaceRoot: fixture.workspaceRoot, autostart: true,
            startupTransactionTestHooks: {
              afterPhase: async ({ phase }) => {
                if (phase !== "owned_readiness_proven") return;
                assert.equal(fixture.custodyReaders.length > 0, true);
                const members = fixture.custodyReaders.flatMap(read => read());
                const owner = await findProcessOwnership(fixture.workspaceRoot, "service", "matrix-service");
                assert.ok(owner?.identity);
                if (interruptedPhase === "generation_committed") assert.deepEqual(owner.identity, interruptedOwner.identity);
                assert.ok(members.some(member => member.pid === owner.identity.pid &&
                  member.createdAt === owner.identity.createdAt && member.commandHash === owner.identity.commandHash));
                assert.equal(hasManagedProcess("matrix-service"), true);
                observedBeforeReturn = true;
                fixture.custody.retain(members);
                throw injected;
              },
            },
          });
          returned = true;
        } catch (error) {
          assert.equal(error, injected);
        } finally { await server?.stop(); }
        assert.equal(returned, false);
        assert.equal(observedBeforeReturn, true);
        if (interruptedPhase === "process_spawned") {
          assert.equal(hasManagedProcess("matrix-service"), false);
          for (const member of fixture.custodyReaders.flatMap(read => read())) {
            assert.equal((await inspectProcess(member.pid)).status, "not_running");
          }
        }
        await stopManagedProcess("matrix-service", 5_000);
        await waitForManagedProcessFinalization("matrix-service", Date.now() + 5_000);
        assert.equal(hasManagedProcess("matrix-service"), false);
        const retained = fixture.custodyReaders.flatMap(read => read());
        assert.ok(retained.length > 0);
        for (const member of retained) assert.equal((await inspectProcess(member.pid)).status, "not_running");
        fixture.custody.retain(retained);
        throw injected;
      } finally {
        try { await stopExactChild(crash); }
        catch (error) { fixture.cleanupFailures.push({ stage: "direct_child", error }); }
      }
    }), (error) => {
      assert.ok(error instanceof AggregateError);
      assert.ok(error.errors.includes(injected));
      return true;
    });
  });
}
