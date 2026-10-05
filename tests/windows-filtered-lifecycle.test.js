import { runFixtureHistoryScenario } from "./fixture-history-scenario.js";
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
  setManagedProcessTreeMonitorForTests,
  waitForManagedProcessFinalization,
  setManagedProcessEnrollmentHookForTests, retainManagedProcessCustodyForTest, hasManagedProcess,
} from "../dist/runtime/execution/supervisor.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { protectOriginalFixture, verifyOriginalFixturePrivacy } from "./hard-crash-fixture-custody.js";

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test("Windows rejected initial tree persists native exclusions through emergency startup containment", {
  skip: process.platform !== "win32", timeout: 120_000,
}, async () => {
  const previous = process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
  process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = "1";
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-excluded-emergency-");
  const serviceId = "excluded-emergency";
  await writeExecutableFixtureService(servicesRoot, serviceId);
  const sentinel = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", windowsHide: true });
  const closed = new Promise(resolve => sentinel.once("close", resolve));
  let snapshots = 0;
  let controls = 0;
  let reader;
  let custodyObservationFailed = false;
  try {
    await new Promise((resolve, reject) => { sentinel.once("spawn", resolve); sentinel.once("error", reject); });
    const sentinelInspection = await inspectProcess(sentinel.pid);
    assert.equal(sentinelInspection.status, "running");
    setManagedProcessEnrollmentHookForTests(null, (id, read) => { if (id === serviceId) reader = read; },
      () => { custodyObservationFailed = true; });
    setManagedWindowsTreeInspectorForTests(async (root, options) => {
      const actual = await inspectWindowsProcessTree(root, options);
      snapshots++;
      return snapshots === 1
        ? { ...actual, rootStatus: "exited", members: [], verifiedMembersOnly: true, excludedMemberPids: [sentinel.pid] }
        : { ...actual, members: [...actual.members, sentinelInspection.identity] };
    });
    setManagedProcessTreeTerminatorForTests(async (target, timeoutMs, dependencies) => {
      controls++;
      assert.equal(timeoutMs <= 5_000, true);
      assert.equal(target.verifiedMembersOnly, true);
      assert.equal(target.knownMembers.some(member => member.pid === sentinel.pid), false);
      await assert.rejects(dependencies.inspectProcess(sentinel.pid), /control excludes/);
      return await terminateOwnedProcessTree(target, timeoutMs, {
        ...dependencies,
        runWindowsCommand: async () => { throw new Error("Emergency containment must never use taskkill /T."); },
      });
    });
    const [service] = await discoverServices(servicesRoot);
    await assert.rejects(startManagedProcess({ service, executionPlan: createDirectExecutionPlan(service.manifest), workspaceRoot }), /root exited during ownership enrollment/);
    assert.equal(snapshots >= 3, true);
    assert.equal(controls, 1);
    assert.equal(typeof reader, "function");
    assert.equal(reader().some(member => member.pid === sentinel.pid), false);
    assert.equal((await inspectProcess(sentinel.pid)).status, "running");
    assert.equal(hasManagedProcess(serviceId), false);
    const ownership = await findProcessOwnership(workspaceRoot, "service", serviceId);
    assert.equal(ownership.lifecycleState, "stopped"); assert.equal(ownership.pid, null);
    assert.equal(custodyObservationFailed, false, "Emergency containment custody observation failed.");
  } finally {
    setManagedProcessEnrollmentHookForTests(null);
    setManagedProcessTreeTerminatorForTests(null);
    setManagedWindowsTreeInspectorForTests(null);
    await stopManagedProcess(serviceId, 5_000).catch(() => null);
    await waitForManagedProcessFinalization(serviceId, Date.now() + 5_000).catch(() => null);
    if (sentinel.exitCode === null) sentinel.kill("SIGKILL");
    await closed;
    if (previous === undefined) delete process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS; else process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = previous;
    resetLifecycleState();
    // Check the bounded recorder after teardown and ENV restoration. A failure
    // remains a test failure and retains the original fixture for investigation.
    assert.equal(custodyObservationFailed, false, "Emergency containment custody observation failed; fixture retained.");
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

for (const earlyRefresh of [false, true]) for (const mode of ["managed", "adopted", "managed-root-exit", "adopted-root-exit"]) {
  test(`Windows filtered ${mode} lifecycle retains restriction after an unfiltered refresh${earlyRefresh ? " including enrollment" : ""}`, { skip: process.platform !== "win32" }, async () => {
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
    let custodyReader;
    let unfilteredDiscovery = earlyRefresh;
    try {
      setManagedProcessEnrollmentHookForTests(null, (id, read) => { if (id === serviceId) custodyReader = read; }, () => assert.fail("Fixture observation failed."));
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
          : unfilteredDiscovery ? { ...snapshot, members: [...snapshot.members, sentinelInspection.identity] } : snapshot;
      });
      setManagedProcessTreeTerminatorForTests(async (target, timeoutMs, dependencies) => {
        controls += 1;
        assert.equal(timeoutMs <= 5_000, true);
        assert.equal(target.verifiedMembersOnly, true);
        if (mode.endsWith("root-exit")) assert.equal(target.rootExitObserved, true);
        assert.equal(target.knownMembers.some(member => member.pid === sentinel.pid), false);
        if (earlyRefresh) await assert.rejects(dependencies.inspectProcess(sentinel.pid), /control excludes/);
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
      assert.equal(typeof custodyReader, "function");
      assert.equal(custodyReader().some(member => member.pid === sentinel.pid), false);
      if (mode.startsWith("adopted")) {
        const baseline = snapshots;
        unfilteredDiscovery = true;
        const deadline = Date.now() + 20_000;
        while (snapshots === baseline && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
        assert.ok(snapshots > baseline);
        assert.equal(custodyReader().some(member => member.pid === sentinel.pid), false);
        unfilteredDiscovery = earlyRefresh;
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
      assert.equal(custodyReader().some(member => member.pid === sentinel.pid), false);
    } finally {
      setManagedProcessEnrollmentHookForTests(null);
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
  let custodyReader;
  try {
    setManagedProcessEnrollmentHookForTests(null, (id, read) => { if (id === serviceId) custodyReader = read; }, () => assert.fail("Fixture observation failed."));
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
    const acceptedSentinel = custodyReader().find(member => member.pid === sentinel.pid);
    assert.equal(acceptedSentinel.commandHash, "f".repeat(64));

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
    assert.deepEqual(custodyReader().filter(member => member.pid === sentinel.pid), [acceptedSentinel]);
  } finally {
    setManagedProcessEnrollmentHookForTests(null);
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

// AC-4BH.2 / AC-4BJ.9c: baseline modes exercise real later-descendant native
// discovery/replacement. Rejection modes use directly spawned native identities
// and controlled provisional receipts as supporting acceptance-boundary proof.
// All are preparation only until admission; the formal matrix remains required.
for (const mode of ["managed", "adopted", "managed-mixed-conflict", "adopted-mixed-conflict", "adopted-pre-enrollment-failure", "adopted-root-rejection", "managed-held-child-rejection"]) {
  test(`Windows ${mode} fixture history keeps a later descendant across omission and finalization`, {
    skip: process.platform !== "win32", timeout: 120_000,
  }, async () => {
    await runFixtureHistoryScenario(mode, { makeTempServicesRoot, writeExecutableFixtureService, writeFile, readFile, rm, spawn, protectOriginalFixture, verifyOriginalFixturePrivacy, setManagedProcessEnrollmentHookForTests, setManagedWindowsTreeInspectorForTests, inspectWindowsProcessTree, discoverServices, startManagedProcess, createDirectExecutionPlan, hasManagedProcess, inspectProcess, recordProcessOwnership, adoptManagedProcess, retainManagedProcessCustodyForTest, stopManagedProcess, waitForManagedProcessFinalization, resetLifecycleState });
  });
}

// AC-4BH.2: exercise the ordinary managed caller directly, independently of
// the protected HTTP/operator cases. Real native acquisition/control remain
// required; suppress only the background refresh to isolate this stop episode.
for (const emptyEnrollment of [false, true]) {
  test(`Windows requested ordinary managed stop shares a fresh snapshot and original deadline (empty retained members=${emptyEnrollment})`, {
    skip: process.platform !== "win32",
  }, async () => {
    const previous = process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
    process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = "1";
    const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-managed-fresh-episode-");
    const serviceId = "managed-fresh-episode";
    let snapshots = 0;
    let controls = 0;
    let stopping = false;
    let stopSnapshot;
    let stopOptions;
    let stopStarted;
    let stopFinished;
    let stopReturned;
    try {
      await writeExecutableFixtureService(servicesRoot, serviceId);
      setManagedProcessTreeMonitorForTests(async () => {});
      setManagedWindowsTreeInspectorForTests(async (root, options) => {
        const actual = await inspectWindowsProcessTree(root, options);
        snapshots++;
        assert.notEqual(actual.verifiedMembersOnly, true);
        if (stopping) {
          stopSnapshot = actual;
          stopOptions = options;
          assert.equal(actual.rootStatus, "owned");
          assert.equal(options.deadlineMs >= stopStarted + 5_000, true);
          assert.equal(options.deadlineMs <= stopReturned + 5_000, true);
          assert.equal(options.signal.aborted, false);
        }
        return emptyEnrollment && !stopping ? { ...actual, members: [] } : actual;
      });
      setManagedProcessTreeTerminatorForTests(async (target, timeoutMs, dependencies) => {
        controls++;
        assert.ok(stopSnapshot, "Native shared snapshot must precede control.");
        assert.equal(target.rootExitObserved, false);
        assert.notEqual(target.verifiedMembersOnly, true);
        assert.equal(dependencies.deadlineMs, stopOptions.deadlineMs);
        assert.equal(dependencies.signal, stopOptions.signal);
        assert.equal(timeoutMs > 0 && timeoutMs <= 5_000, true);
        assert.deepEqual(target.knownMembers, stopSnapshot.members);
        const root = stopSnapshot.members.find(member => member.pid === target.rootPid);
        assert.ok(root);
        assert.deepEqual(await dependencies.inspectProcess(target.rootPid), { status: "running", identity: root });
        return await terminateOwnedProcessTree(target, timeoutMs, dependencies);
      });
      const [service] = await discoverServices(servicesRoot);
      const handle = await startManagedProcess({ service, executionPlan: createDirectExecutionPlan(service.manifest), workspaceRoot });
      assert.equal((await inspectProcess(handle.pid)).status, "running");
      const beforeStop = snapshots;
      stopping = true;
      stopStarted = Date.now();
      const stopped = stopManagedProcess(serviceId, 5_000, { newWindowsInspectionEpisode: true });
      stopReturned = Date.now();
      await stopped;
      stopFinished = Date.now();
      assert.equal(snapshots, beforeStop + 1);
      assert.equal(controls, 1);
      assert.equal(stopFinished - stopStarted <= 5_000, true);
      assert.equal(hasManagedProcess(serviceId), false);
      const ownership = await findProcessOwnership(workspaceRoot, "service", serviceId);
      assert.equal(ownership.lifecycleState, "stopped");
      assert.equal(ownership.pid, null);
    } finally {
      setManagedProcessTreeTerminatorForTests(null);
      setManagedWindowsTreeInspectorForTests(null);
      setManagedProcessTreeMonitorForTests(null);
      await stopManagedProcess(serviceId, 5_000).catch(() => null);
      await waitForManagedProcessFinalization(serviceId, Date.now() + 5_000).catch(() => null);
      if (previous === undefined) delete process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
      else process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = previous;
      await rm(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
}
