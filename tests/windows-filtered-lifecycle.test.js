import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { createDirectExecutionPlan } from "../dist/runtime/providers/direct.js";
import { inspectProcess, inspectWindowsProcessTree } from "../dist/runtime/process/identity.js";
import { recordProcessOwnership, findProcessOwnership } from "../dist/runtime/process/registry.js";
import { terminateOwnedProcessTree } from "../dist/runtime/process/tree.js";
import { startManagedProcess, adoptManagedProcess, stopManagedProcess,
  setManagedWindowsTreeInspectorForTests, setManagedProcessTreeTerminatorForTests,
  waitForManagedProcessFinalization,
} from "../dist/runtime/execution/supervisor.js";

for (const mode of ["managed", "adopted", "managed-root-exit", "adopted-root-exit"]) {
  test(`Windows filtered ${mode} lifecycle retains restriction after an unfiltered refresh`, { skip: process.platform !== "win32" }, async () => {
    const priorHooks = process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
    process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = "1";
    const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot(`service-lasso-filtered-${mode}-`);
    const serviceId = `filtered-${mode}`;
    const { serviceRoot, scriptPath } = await writeExecutableFixtureService(servicesRoot, serviceId);
    const sentinel = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", windowsHide: true });
    const sentinelClosed = new Promise(resolve => sentinel.once("close", resolve));
    let adoptedChild;
    let adoptedClosed;
    let managedHandle;
    let snapshots = 0;
    let controls = 0;
    try {
      await new Promise((resolve, reject) => { sentinel.once("spawn", resolve); sentinel.once("error", reject); });
      setManagedWindowsTreeInspectorForTests(async (root, options) => {
        const snapshot = await inspectWindowsProcessTree(root, options);
        snapshots += 1;
        // Deterministic lifetime-filtered receipt. Parser exclusion has its own
        // complete native-output tests; this exercises real lifecycle records.
        return snapshots === 1
          ? { ...snapshot, verifiedMembersOnly: true, excludedMemberPids: [sentinel.pid] }
          : snapshot;
      });
      setManagedProcessTreeTerminatorForTests(async (target, timeoutMs, dependencies) => {
        controls += 1;
        assert.equal(timeoutMs <= 5_000, true);
        assert.equal(target.verifiedMembersOnly, true);
        if (mode.endsWith("root-exit")) assert.equal(target.rootExitObserved, true);
        assert.equal(target.knownMembers.some(member => member.pid === sentinel.pid), false);
        const started = Date.now();
        const phases = [];
        try {
          return await terminateOwnedProcessTree(target, timeoutMs, {
            ...dependencies,
            inspectProcess: async (pid, options) => {
              const phaseStarted = Date.now();
              try {
                const result = await dependencies.inspectProcess(pid, options);
                phases.push({ kind: "identity", root: pid === target.rootPid, elapsedMs: Date.now() - phaseStarted, status: result.status });
                return result;
              } catch (error) {
                phases.push({ kind: "identity", root: pid === target.rootPid, elapsedMs: Date.now() - phaseStarted, status: "failed" });
                throw error;
              }
            },
            killProcess: (pid, controlSignal) => {
              phases.push({ kind: "signal", root: pid === target.rootPid, signal: String(controlSignal), elapsedMs: Date.now() - started });
              return process.kill(pid, controlSignal);
            },
            runWindowsCommand: async () => { throw new Error("Filtered lifecycle must never invoke taskkill /T."); },
          });
        } catch (error) {
          console.error(JSON.stringify({ kind: "filtered-lifecycle-control", mode, budgetMs: timeoutMs, elapsedMs: Date.now() - started, phases }));
          throw error;
        }
      });
      const [service] = await discoverServices(servicesRoot);
      if (mode.startsWith("managed")) {
        managedHandle = await startManagedProcess({ service, executionPlan: createDirectExecutionPlan(service.manifest), workspaceRoot });
      } else {
        adoptedChild = spawn(process.execPath, [path.relative(serviceRoot, scriptPath)], { cwd: serviceRoot, stdio: "ignore", windowsHide: true });
        adoptedClosed = new Promise(resolve => adoptedChild.once("close", resolve));
        await new Promise((resolve, reject) => { adoptedChild.once("spawn", resolve); adoptedChild.once("error", reject); });
        const inspection = await inspectProcess(adoptedChild.pid);
        assert.equal(inspection.status, "running");
        await recordProcessOwnership(workspaceRoot, { ownerType: "service", ownerId: serviceId, serviceId,
          pid: adoptedChild.pid, ownerRoot: serviceRoot, lifecycleState: "running", source: "legacy-verified" });
        await adoptManagedProcess({ service, pid: adoptedChild.pid, startedAt: inspection.identity.createdAt,
          command: `${process.execPath} ${path.relative(serviceRoot, scriptPath)}`, workspaceRoot });
        // Adoption reconstructed the flag from a full-tree receipt, with no
        // persisted flag or in-memory managed record to inherit.
      }
      if (mode.endsWith("root-exit")) {
        process.kill(managedHandle?.pid ?? adoptedChild.pid, "SIGKILL");
        // Adopted exit detection already polls every five seconds; that delay
        // precedes its unchanged five-second termination budget. The waiter
        // observes both phases without changing the production control bound.
        await waitForManagedProcessFinalization(serviceId, Date.now() + (mode === "adopted-root-exit" ? 10_000 : 5_000));
      } else {
        await stopManagedProcess(serviceId, 5_000);
      }
      assert.equal(snapshots >= 2, true);
      assert.equal(controls, 1);
      assert.equal((await inspectProcess(sentinel.pid)).status, "running");
      const ownership = await findProcessOwnership(workspaceRoot, "service", serviceId);
      assert.equal(ownership.lifecycleState, "stopped");
      assert.equal(ownership.pid, null);
    } finally {
      setManagedProcessTreeTerminatorForTests(null);
      setManagedWindowsTreeInspectorForTests(null);
      await stopManagedProcess(serviceId, 5_000).catch(() => null);
      adoptedChild?.kill("SIGKILL");
      if (adoptedClosed) await adoptedClosed;
      sentinel.kill("SIGKILL");
      await sentinelClosed;
      if (priorHooks === undefined) delete process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
      else process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = priorHooks;
      await rm(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
}
