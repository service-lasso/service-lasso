import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawn } from "node:child_process";
import { rm, readFile, writeFile } from "node:fs/promises";
import { makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { createDirectExecutionPlan } from "../dist/runtime/providers/direct.js";
import { inspectProcess, inspectWindowsProcessTree } from "../dist/runtime/process/identity.js";
import { recordProcessOwnership, findProcessOwnership } from "../dist/runtime/process/registry.js";
import { terminateOwnedProcessTree } from "../dist/runtime/process/tree.js";
import { startApiServer } from "../dist/server/index.js";
import { startManagedProcess, adoptManagedProcess, stopManagedProcess,
  setManagedWindowsTreeInspectorForTests, setManagedProcessTreeTerminatorForTests,
  waitForManagedProcessFinalization,
  setManagedProcessEnrollmentHookForTests, retainManagedProcessCustodyForTest, hasManagedProcess,
} from "../dist/runtime/execution/supervisor.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

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
      const sentinelInspection = await inspectProcess(sentinel.pid);
      assert.equal(sentinelInspection.status, "running");
      setManagedWindowsTreeInspectorForTests(async (root, options) => {
        const snapshot = await inspectWindowsProcessTree(root, options);
        snapshots += 1;
        // Deterministic lifetime-filtered receipt. Parser exclusion has its own
        // complete native-output tests; this exercises real lifecycle records.
        return snapshots === 1
          ? {
            ...snapshot,
            members: [...snapshot.members, sentinelInspection.identity],
            verifiedMembersOnly: true,
            excludedMemberPids: [sentinel.pid],
          }
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

test("Windows request-context stop takes a fresh managed inspection before control", {
  skip: process.platform !== "win32",
}, async () => {
  resetLifecycleState();
  const priorHooks = process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
  process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = "1";
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-filtered-http-");
  const serviceId = "filtered-http";
  const sentinel = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", windowsHide: true });
  const sentinelClosed = new Promise(resolve => sentinel.once("close", resolve));
  let apiServer;
  let snapshotCount = 0;
  let sentinelInspection;
  try {
    await new Promise((resolve, reject) => { sentinel.once("spawn", resolve); sentinel.once("error", reject); });
    const sentinelIdentity = (await inspectProcess(sentinel.pid)).identity;
    assert.ok(sentinelIdentity);
    await writeExecutableFixtureService(servicesRoot, serviceId);
    setManagedWindowsTreeInspectorForTests(async (root, options) => {
      const snapshot = await inspectWindowsProcessTree(root, options);
      snapshotCount += 1;
      // The record retained this member from the earlier verified snapshot.
      // It is absent by the explicit operator stop, so the new inspection
      // must classify that absence before tree control can proceed.
      return snapshotCount <= 2
        ? { ...snapshot, members: [...snapshot.members, sentinelIdentity] }
        : snapshot;
    });
    setManagedProcessTreeTerminatorForTests(async (target, timeoutMs, dependencies) => {
      sentinelInspection = await dependencies.inspectProcess(sentinel.pid);
      assert.equal(sentinelInspection.status, "not_running");
      return await terminateOwnedProcessTree(target, timeoutMs, dependencies);
    });
    apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot });
    assert.equal((await postJson(`${apiServer.url}/api/services/${serviceId}/install`, {})).status, 200);
    assert.equal((await postJson(`${apiServer.url}/api/services/${serviceId}/config`, {})).status, 200);
    assert.equal((await postJson(`${apiServer.url}/api/services/${serviceId}/start`, { confirm: true })).status, 200);
    sentinel.kill("SIGKILL");
    await sentinelClosed;

    const stopped = await postJson(`${apiServer.url}/api/services/${serviceId}/stop`, { confirm: true });
    assert.equal(stopped.status, 200, JSON.stringify(stopped.body));
    assert.equal(snapshotCount >= 3, true);
    assert.equal(sentinelInspection.status, "not_running");
  } finally {
    setManagedProcessTreeTerminatorForTests(null);
    setManagedWindowsTreeInspectorForTests(null);
    await apiServer?.stop();
    await stopManagedProcess(serviceId, 5_000).catch(() => null);
    if (sentinel.exitCode === null) sentinel.kill("SIGKILL");
    await sentinelClosed;
    if (priorHooks === undefined) delete process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
    else process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = priorHooks;
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("Windows confirmed operator stop takes a fresh managed inspection before control", {
  skip: process.platform !== "win32",
}, async () => {
  resetLifecycleState();
  const priorHooks = process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
  const priorBridgeToken = process.env.SERVICE_LASSO_CHAT_BRIDGE_TOKEN;
  process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = "1";
  process.env.SERVICE_LASSO_CHAT_BRIDGE_TOKEN = "SERVICE_LASSO_FILTERED_CONFIRMATION_TEST_TOKEN";
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-filtered-confirmed-http-");
  const serviceId = "filtered-confirmed-http";
  const headers = { "x-service-lasso-chat-bridge-token": process.env.SERVICE_LASSO_CHAT_BRIDGE_TOKEN };
  const actor = { source: "chat-bridge", channel: "telegram", chatId: "-5128051597", senderId: "42", roles: ["operator"] };
  const plan = { dryRun: true, action: "stop", serviceId, generatedAt: "2026-10-02T00:00:00.000Z", steps: [{ serviceId, action: "stop", status: "would_run" }] };
  const sentinel = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", windowsHide: true });
  const sentinelClosed = new Promise(resolve => sentinel.once("close", resolve));
  let apiServer;
  let snapshotCount = 0;
  let sentinelInspection;
  try {
    await new Promise((resolve, reject) => { sentinel.once("spawn", resolve); sentinel.once("error", reject); });
    const sentinelIdentity = (await inspectProcess(sentinel.pid)).identity;
    assert.ok(sentinelIdentity);
    await writeExecutableFixtureService(servicesRoot, serviceId);
    setManagedWindowsTreeInspectorForTests(async (root, options) => {
      const snapshot = await inspectWindowsProcessTree(root, options);
      snapshotCount += 1;
      return snapshotCount <= 2
        ? { ...snapshot, members: [...snapshot.members, sentinelIdentity] }
        : snapshot;
    });
    setManagedProcessTreeTerminatorForTests(async (target, timeoutMs, dependencies) => {
      sentinelInspection = await dependencies.inspectProcess(sentinel.pid);
      assert.equal(sentinelInspection.status, "not_running");
      return await terminateOwnedProcessTree(target, timeoutMs, dependencies);
    });
    apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot });
    assert.equal((await postJson(`${apiServer.url}/api/services/${serviceId}/install`, {})).status, 200);
    assert.equal((await postJson(`${apiServer.url}/api/services/${serviceId}/config`, {})).status, 200);
    assert.equal((await postJson(`${apiServer.url}/api/services/${serviceId}/start`, { confirm: true })).status, 200);
    sentinel.kill("SIGKILL");
    await sentinelClosed;

    const issued = await postJson(`${apiServer.url}/api/operator/confirmations`, {
      command: `stop ${serviceId}`, actor, planId: "filtered-confirmed-stop-plan", plan,
    }, headers);
    assert.equal(issued.status, 201, JSON.stringify(issued.body));
    const confirmed = await postJson(`${apiServer.url}/api/operator/confirmations/${encodeURIComponent(issued.body.confirmation.id)}/confirm`, {
      actor, plan, confirmationPhrase: issued.body.confirmationPhrase,
    }, headers);
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    const executed = await postJson(`${apiServer.url}/api/operator/confirmations/${encodeURIComponent(issued.body.confirmation.id)}/execute`, { actor, plan }, headers);
    assert.equal(executed.status, 200, JSON.stringify(executed.body));
    assert.equal(executed.body.action.action, "stop");
    assert.equal(snapshotCount >= 3, true);
    assert.equal(sentinelInspection.status, "not_running");
  } finally {
    setManagedProcessTreeTerminatorForTests(null);
    setManagedWindowsTreeInspectorForTests(null);
    await apiServer?.stop();
    await stopManagedProcess(serviceId, 5_000).catch(() => null);
    if (sentinel.exitCode === null) sentinel.kill("SIGKILL");
    await sentinelClosed;
    if (priorHooks === undefined) delete process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
    else process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = priorHooks;
    if (priorBridgeToken === undefined) delete process.env.SERVICE_LASSO_CHAT_BRIDGE_TOKEN;
    else process.env.SERVICE_LASSO_CHAT_BRIDGE_TOKEN = priorBridgeToken;
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("Windows adopted stop retains durable ownership when its fresh absence inspection fails", {
  skip: process.platform !== "win32",
}, async () => {
  const priorHooks = process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
  process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = "1";
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-filtered-adopted-retention-");
  const serviceId = "filtered-adopted-retention";
  const { serviceRoot, scriptPath } = await writeExecutableFixtureService(servicesRoot, serviceId);
  const child = spawn(process.execPath, [path.relative(serviceRoot, scriptPath)], { cwd: serviceRoot, stdio: "ignore", windowsHide: true });
  const childClosed = new Promise(resolve => child.once("close", resolve));
  const sentinel = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", windowsHide: true });
  const sentinelClosed = new Promise(resolve => sentinel.once("close", resolve));
  let snapshots = 0;
  let freshInspection;
  try {
    await Promise.all([
      new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); }),
      new Promise((resolve, reject) => { sentinel.once("spawn", resolve); sentinel.once("error", reject); }),
    ]);
    const [service] = await discoverServices(servicesRoot);
    const childInspection = await inspectProcess(child.pid);
    const sentinelIdentity = (await inspectProcess(sentinel.pid)).identity;
    assert.equal(childInspection.status, "running");
    assert.ok(sentinelIdentity);
    await recordProcessOwnership(workspaceRoot, { ownerType: "service", ownerId: serviceId, serviceId,
      pid: child.pid, ownerRoot: serviceRoot, lifecycleState: "running", source: "legacy-verified" });
    setManagedWindowsTreeInspectorForTests(async (root, options) => {
      const snapshot = await inspectWindowsProcessTree(root, options);
      snapshots += 1;
      return snapshots === 1
        ? { ...snapshot, members: [...snapshot.members, { ...sentinelIdentity, commandHash: "f".repeat(64) }] }
        : snapshot;
    });
    setManagedProcessTreeTerminatorForTests(async (target, timeoutMs, dependencies) => {
      freshInspection = await dependencies.inspectProcess(sentinel.pid);
      return await terminateOwnedProcessTree(target, timeoutMs, dependencies);
    });
    await adoptManagedProcess({ service, pid: child.pid, startedAt: childInspection.identity.createdAt,
      command: `${process.execPath} ${path.relative(serviceRoot, scriptPath)}`, workspaceRoot });

    await assert.rejects(
      stopManagedProcess(serviceId, 5_000, { newWindowsInspectionEpisode: true }),
      /Cannot verify process/,
    );
    assert.equal(snapshots >= 2, true);
    assert.equal(freshInspection.status, "running");
    const retainedOwnership = await findProcessOwnership(workspaceRoot, "service", serviceId);
    assert.equal(retainedOwnership.lifecycleState, "stopping");
    assert.equal(retainedOwnership.pid, child.pid);
    assert.equal((await inspectProcess(sentinel.pid)).status, "running");
  } finally {
    setManagedProcessTreeTerminatorForTests(null);
    setManagedWindowsTreeInspectorForTests(null);
    if (child.exitCode === null) child.kill("SIGKILL");
    if (sentinel.exitCode === null) sentinel.kill("SIGKILL");
    await Promise.all([childClosed, sentinelClosed]);
    if (priorHooks === undefined) delete process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
    else process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = priorHooks;
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

// AC-4BH.2 / AC-4BJ.9c: real native discovery and supervisor replacement,
// never a fabricated process-tree member. Preparation only until admission.
for (const mode of ["managed", "adopted"]) {
  test(`Windows ${mode} fixture history keeps a later descendant across omission and finalization`, {
    skip: process.platform !== "win32", timeout: 120_000,
  }, async () => {
    const previous = process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
    process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = "1";
    const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-custody-refresh-");
    const serviceId = `custody-refresh-${mode}`;
    const { serviceRoot, scriptPath } = await writeExecutableFixtureService(servicesRoot, serviceId);
    await writeFile(scriptPath, `
      import fs from 'node:fs';
      import { spawn } from 'node:child_process';
      let child, stopped = false;
      setInterval(() => {
        let command; try { command = fs.readFileSync('custody-command.txt', 'utf8'); } catch { return; }
        if (command === 'spawn' && !child) {
          child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
          child.once('spawn', () => fs.writeFileSync('custody-child.txt', String(child.pid)));
        }
        if (command === 'close' && child && !stopped) { stopped = true; child.kill('SIGTERM'); }
      }, 25);
    `);
    let adoptedChild, adoptedClosed, reader, descendant;
    let omitted = false;
    let observerFailures = 0;
    const waitUntil = async (predicate) => {
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        if (await predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error("Real custody observation deadline expired.");
    };
    try {
      setManagedProcessEnrollmentHookForTests(null, (id, read) => {
        if (id === serviceId) { reader = read; throw new Error("PRIVATE-OBSERVER-FAILURE"); }
      }, () => { observerFailures++; });
      setManagedWindowsTreeInspectorForTests(async (root, options) => {
        const result = await inspectWindowsProcessTree(root, options);
        if (descendant && !result.members.some(member => member.pid === descendant.pid)) omitted = true;
        return result;
      });
      const [service] = await discoverServices(servicesRoot);
      if (mode === "managed") {
        await startManagedProcess({ service, executionPlan: createDirectExecutionPlan(service.manifest), workspaceRoot });
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
      }
      assert.equal(typeof reader, "function");
      assert.equal(observerFailures, 1);
      const initial = reader();
      const compatibilityReader = retainManagedProcessCustodyForTest(serviceId);
      assert.ok(initial.length > 0);
      await writeFile(path.join(serviceRoot, "custody-command.txt"), "spawn");
      let descendantPid;
      await waitUntil(async () => {
        try { descendantPid = Number(await readFile(path.join(serviceRoot, "custody-child.txt"), "utf8")); return descendantPid > 0; }
        catch (error) { if (error.code === "ENOENT") return false; throw error; }
      });
      assert.equal(initial.some(member => member.pid === descendantPid), false);
      await waitUntil(() => { descendant = reader().find(member => member.pid === descendantPid); return Boolean(descendant); });
      const copied = reader();
      copied.find(member => member.pid === descendantPid).commandHash = "0".repeat(64);
      assert.deepEqual(reader().find(member => member.pid === descendantPid), descendant);
      await writeFile(path.join(serviceRoot, "custody-command.txt"), "close");
      await waitUntil(async () => (await inspectProcess(descendantPid)).status === "not_running");
      await waitUntil(() => omitted);
      assert.deepEqual(reader().find(member => member.pid === descendantPid), descendant);
      await stopManagedProcess(serviceId, 5_000);
      await waitForManagedProcessFinalization(serviceId, Date.now() + 5_000);
      assert.equal(hasManagedProcess(serviceId), false);
      assert.deepEqual(reader().find(member => member.pid === descendantPid), descendant);
      for (const member of reader()) assert.equal((await inspectProcess(member.pid)).status, "not_running");
      assert.deepEqual(compatibilityReader().find(member => member.pid === descendantPid), descendant);
    } finally {
      setManagedProcessEnrollmentHookForTests(null);
      setManagedWindowsTreeInspectorForTests(null);
      await stopManagedProcess(serviceId, 5_000);
      await waitForManagedProcessFinalization(serviceId, Date.now() + 5_000);
      if (adoptedChild) await adoptedClosed;
      if (previous === undefined) delete process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
      else process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = previous;
      resetLifecycleState();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
}
