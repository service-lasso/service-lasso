import assert from "node:assert/strict";
import path from "node:path";
import { createHistoryObservation } from "./fixture-history-observation.js";

export function serializePrivateHistoryErrors(value) {
  // A bounded private serialization attempt, never a public formatter. Originals
  // remain held by the invocation even if getters, cycles or size reject it.
  const seen = new WeakSet();
  const bytes = JSON.stringify(value, (_key, item) => {
    if (item && (typeof item === "object" || typeof item === "function")) {
      if (seen.has(item)) throw new Error("Private history serialization cycle.");
      seen.add(item);
      if (item instanceof Error) {
        return { name: item.name, message: item.message, stack: item.stack,
          ...(Object.hasOwn(item, "cause") ? { cause: item.cause } : {}),
          ...(Object.hasOwn(item, "errors") ? { errors: item.errors } : {}) };
      }
    }
    return item;
  });
  if (Buffer.byteLength(bytes) > 65_536) throw new Error("Private history serialization overflow.");
  return bytes;
}

// The seven protected callers share this actual action/finally/aggregate owner.
// Dependencies allow prospective diagnostic proof without claiming native proof.
export async function runFixtureHistoryScenario(mode, dependencies, options = {}) {
  const { makeTempServicesRoot, writeExecutableFixtureService, writeFile, readFile, rm, spawn, protectOriginalFixture, verifyOriginalFixturePrivacy, setManagedProcessEnrollmentHookForTests, setManagedWindowsTreeInspectorForTests, inspectWindowsProcessTree, discoverServices, startManagedProcess, createDirectExecutionPlan, hasManagedProcess, inspectProcess, recordProcessOwnership, adoptManagedProcess, retainManagedProcessCustodyForTest, stopManagedProcess, waitForManagedProcessFinalization, resetLifecycleState } = dependencies;
    const previous = process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
    const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-custody-refresh-");
    const serviceId = `custody-refresh-${mode}`;
    const { serviceRoot, scriptPath } = await writeExecutableFixtureService(servicesRoot, serviceId);
    await writeFile(scriptPath, `
      import fs from 'node:fs';
      import { spawn } from 'node:child_process';
      let child, second, stopped = false;
      setInterval(() => {
        let command; try { command = fs.readFileSync('custody-command.txt', 'utf8'); } catch { return; }
        if (command === 'spawn' && !child) {
          child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
          child.once('spawn', () => fs.writeFileSync('custody-child.txt', String(child.pid)));
        }
        if (command === 'spawn-second' && !second) {
          second = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
          second.once('spawn', () => fs.writeFileSync('custody-second.txt', String(second.pid)));
        }
        if (command === 'close' && child && !stopped) { stopped = true; child.kill('SIGTERM'); }
      }, 25);
    `);
    let adoptedChild, adoptedClosed, reader, descendant;
    let rejectedChild, rejectedClosed, rejectedIdentity;
    let heldRejectedChild, heldRejectedClosed;
    let omitted = false;
    const mixedMode = mode.endsWith("mixed-conflict");
    let secondIdentity, mixedObserved = false, mixedOmitted = false;
    let secondAdmissionArmed = false, mixedComplete = false;
    let observerFailures = 0;
    let primary;
    const observation = (options.createObservation ?? createHistoryObservation)();
    const mark = stage => observation.mark(stage);
    const cleanupFailures = [];
    const preEnrollmentFailure = new Error("PRIVATE-PRE-ENROLLMENT-FAILURE");
    const attempt = async (stage, action) => {
      observation.cleanupBegin(stage);
      try { await action(); observation.cleanupEnd(stage, false); }
      catch (error) { cleanupFailures.push({ stage, error }); observation.cleanupEnd(stage, true, error); }
    };
    const closeDirectChild = async (child, closed) => {
      if (!child) return;
      if (!closed) throw new Error("Direct adopted child close custody is missing.");
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      const closedWithinBound = () => Promise.race([closed.then(() => true),
        new Promise(resolve => setTimeout(() => resolve(false), 5_000))]);
      if (!await closedWithinBound()) {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        if (!await closedWithinBound()) throw new Error("Direct adopted child closure remains unresolved.");
      }
    };
    const waitUntil = async (predicate) => {
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        if (await predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error("Real custody observation deadline expired.");
    };
    try {
      process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = "1";
      mark("original_privacy"); observation.originalBegin();
      try {
        await protectOriginalFixture(tempRoot, (value, transports) => observation.original(value, transports));
        observation.originalEnd(false);
      } catch (error) { observation.originalEnd(true); throw error; }
      mark("enrollment_observer_arm");
      setManagedProcessEnrollmentHookForTests(mode === "managed-held-child-rejection" ? async (child) => {
        heldRejectedChild = child;
        heldRejectedClosed = new Promise(resolve => child.once("close", resolve));
        await closeDirectChild(child, heldRejectedClosed);
      } : null, (id, read) => {
        if (id === serviceId) { reader = read; throw new Error("PRIVATE-OBSERVER-FAILURE"); }
      }, () => { observerFailures++; });
      mark("inspector_arm");
      setManagedWindowsTreeInspectorForTests(async (root, options) => {
        let result;
        try { result = await inspectWindowsProcessTree(root, options); }
        catch (error) { observation.native(error); throw error; }
        if (mode === "adopted-pre-enrollment-failure") throw preEnrollmentFailure;
        if (mode === "adopted-root-rejection") return { ...result, rootStatus: "exited", members: [...result.members, rejectedIdentity] };
        if (mixedMode && secondAdmissionArmed && !secondIdentity) {
          return { ...result, members: result.members.filter(member => member.pid === root.pid || member.pid === descendant.pid) };
        }
        if (mixedMode && !mixedComplete && secondIdentity && result.members.some(member => member.pid === secondIdentity.pid)) {
          if (!mixedObserved) {
            mixedObserved = true;
            // A and B are real current root descendants. Only this provisional
            // receipt changes A's lifetime evidence to exercise acceptance.
            return { ...result, members: result.members.map(member => member.pid === descendant.pid
              ? { ...member, commandHash: member.commandHash === "f".repeat(64) ? "e".repeat(64) : "f".repeat(64) } : member) };
          }
          mixedOmitted = true;
          return { ...result, members: result.members.filter(member => member.pid !== secondIdentity.pid) };
        }
        if (descendant && !result.members.some(member => member.pid === descendant.pid)) omitted = true;
        return result;
      });
      mark("discovery");
      const [service] = await discoverServices(servicesRoot);
      if (mode.startsWith("managed")) {
        mark("managed_start");
        const startup = startManagedProcess({ service, executionPlan: createDirectExecutionPlan(service.manifest), workspaceRoot });
        if (mode === "managed-held-child-rejection") {
          mark("managed_rejection");
          await assert.rejects(startup);
          mark("managed_record_absent");
          assert.equal(hasManagedProcess(serviceId), false);
          mark("held_child_closed");
          assert.equal(heldRejectedChild.exitCode !== null || heldRejectedChild.signalCode !== null, true);
          mark("held_reader_empty");
          assert.deepEqual(reader(), []);
        } else await startup;
      } else {
        mark("adopted_spawn");
        adoptedChild = spawn(process.execPath, [path.relative(serviceRoot, scriptPath)], { cwd: serviceRoot, stdio: "ignore", windowsHide: true });
        adoptedClosed = new Promise(resolve => adoptedChild.once("close", resolve));
        mark("adopted_spawn_observe");
        await new Promise((resolve, reject) => { adoptedChild.once("spawn", resolve); adoptedChild.once("error", reject); });
        mark("adopted_inspection");
        const inspection = await inspectProcess(adoptedChild.pid);
        mark("adopted_running");
        assert.equal(inspection.status, "running");
        if (mode === "adopted-root-rejection") {
          mark("rejected_spawn");
          rejectedChild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", windowsHide: true });
          rejectedClosed = new Promise(resolve => rejectedChild.once("close", resolve));
          mark("rejected_spawn_observe");
          await new Promise((resolve, reject) => { rejectedChild.once("spawn", resolve); rejectedChild.once("error", reject); });
          mark("rejected_inspection");
          const rejectedInspection = await inspectProcess(rejectedChild.pid);
          mark("rejected_running");
          assert.equal(rejectedInspection.status, "running");
          rejectedIdentity = rejectedInspection.identity;
        }
        mark("owner_record");
        await recordProcessOwnership(workspaceRoot, { ownerType: "service", ownerId: serviceId, serviceId,
          pid: adoptedChild.pid, ownerRoot: serviceRoot, lifecycleState: "running", source: "legacy-verified" });
        mark("adopted_start");
        const adoption = adoptManagedProcess({ service, pid: adoptedChild.pid, startedAt: inspection.identity.createdAt,
          command: `${process.execPath} ${path.relative(serviceRoot, scriptPath)}`, workspaceRoot });
        if (mode === "adopted-pre-enrollment-failure" || mode === "adopted-root-rejection") {
          mark("adopted_rejection");
          if (mode === "adopted-pre-enrollment-failure") await assert.rejects(adoption, error => error === preEnrollmentFailure);
          else await assert.rejects(adoption, /Cannot refresh exited adopted process/);
          mark("adopted_record_absent");
          assert.equal(hasManagedProcess(serviceId), false);
          mark("adopted_child_live");
          assert.equal(adoptedChild.exitCode, null);
          mark("rejected_reader_excluded");
          if (rejectedIdentity) assert.equal(reader().some(member => member.pid === rejectedIdentity.pid), false);
        } else await adoption;
      }
      if (mode === "managed" || mode === "adopted" || mixedMode) {
        mark("reader_presence");
        assert.equal(typeof reader, "function");
        mark("observer_count");
        assert.equal(observerFailures, 1);
        mark("initial_reader_read");
        const initial = reader();
        mark("compatibility_reader_acquire");
        const compatibilityReader = retainManagedProcessCustodyForTest(serviceId);
        mark("initial_reader_nonempty");
        assert.ok(initial.length > 0);
        mark("descendant_command");
        await writeFile(path.join(serviceRoot, "custody-command.txt"), "spawn");
        let descendantPid;
        mark("descendant_file_wait");
        await waitUntil(async () => {
          try { descendantPid = Number(await readFile(path.join(serviceRoot, "custody-child.txt"), "utf8")); return descendantPid > 0; }
          catch (error) { if (error.code === "ENOENT") return false; throw error; }
        });
        mark("initial_descendant_excluded");
        assert.equal(initial.some(member => member.pid === descendantPid), false);
        mark("descendant_history_wait");
        await waitUntil(() => { descendant = reader().find(member => member.pid === descendantPid); return Boolean(descendant); });
        mark("reader_copy_read");
        const copied = reader();
        copied.find(member => member.pid === descendantPid).commandHash = "0".repeat(64);
        mark("reader_copy_defensive");
        assert.deepEqual(reader().find(member => member.pid === descendantPid), descendant);
        if (mixedMode) {
          secondAdmissionArmed = true;
          mark("second_command");
          await writeFile(path.join(serviceRoot, "custody-command.txt"), "spawn-second");
          let secondPid;
          mark("second_file_wait");
          await waitUntil(async () => {
            try { secondPid = Number(await readFile(path.join(serviceRoot, "custody-second.txt"), "utf8")); return secondPid > 0; }
            catch (error) { if (error.code === "ENOENT") return false; throw error; }
          });
          mark("second_inspection");
          const observed = await inspectProcess(secondPid);
          mark("second_running");
          assert.equal(observed.status, "running");
          mark("second_pre_admission_excluded");
          assert.equal(reader().some(member => member.pid === secondPid), false);
          secondIdentity = observed.identity;
          mark("mixed_snapshot_wait");
          await waitUntil(() => mixedObserved && mixedOmitted);
          mark("prior_a_retained");
          assert.deepEqual(reader().find(member => member.pid === descendantPid), descendant);
          mark("independent_b_retained");
          assert.deepEqual(reader().find(member => member.pid === secondPid), secondIdentity);
          mark("second_still_running");
          assert.equal((await inspectProcess(secondPid)).status, "running");
          // Return production control to the original real native inspector.
          // This does not erase the omitted B from fixture lifetime history.
          mixedComplete = true;
        }
        mark("descendant_close_command");
        await writeFile(path.join(serviceRoot, "custody-command.txt"), "close");
        mark("descendant_absence_wait");
        await waitUntil(async () => (await inspectProcess(descendantPid)).status === "not_running");
        mark("omission_wait");
        await waitUntil(() => omitted);
        mark("omitted_a_retained");
        assert.deepEqual(reader().find(member => member.pid === descendantPid), descendant);
        mark("action_stop");
        await stopManagedProcess(serviceId, 5_000);
        mark("action_finalization");
        await waitForManagedProcessFinalization(serviceId, Date.now() + 5_000);
        mark("final_record_absent");
        assert.equal(hasManagedProcess(serviceId), false);
        mark("final_a_retained");
        assert.deepEqual(reader().find(member => member.pid === descendantPid), descendant);
        mark("all_members_absent");
        for (const member of reader()) assert.equal((await inspectProcess(member.pid)).status, "not_running");
        mark("compatibility_a_retained");
        assert.deepEqual(compatibilityReader().find(member => member.pid === descendantPid), descendant);
        if (mixedMode) {
          mark("final_b_retained");
          assert.deepEqual(reader().find(member => member.pid === secondIdentity.pid), secondIdentity);
          mark("final_b_absent");
          assert.equal((await inspectProcess(secondIdentity.pid)).status, "not_running");
        }
      }
    } catch (error) { primary = error; observation.caught(error);
    } finally {
      try {
        await attempt("hook", () => setManagedProcessEnrollmentHookForTests(null));
        await attempt("inspector", () => setManagedWindowsTreeInspectorForTests(null));
        await attempt("stop", () => stopManagedProcess(serviceId, 5_000));
        await attempt("finalization", () => waitForManagedProcessFinalization(serviceId, Date.now() + 5_000));
        await attempt("direct_child", () => closeDirectChild(adoptedChild, adoptedClosed));
        await attempt("rejected_child", () => closeDirectChild(rejectedChild, rejectedClosed));
        await attempt("held_child", () => closeDirectChild(heldRejectedChild, heldRejectedClosed));
      } finally {
        if (previous === undefined) delete process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
        else process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = previous;
      }
      if (!primary && cleanupFailures.length === 0) {
        await attempt("reset", () => resetLifecycleState());
        if (cleanupFailures.length === 0) await attempt("removal", () => rm(tempRoot, { recursive: true, force: true }));
      }
    }
    if (primary || cleanupFailures.length) {
      await attempt("private_diagnostic", async () => {
        try {
          observation.localBegin("privacy_verification");
          await verifyOriginalFixturePrivacy(tempRoot, (result, transport) => observation.diagnostic(result, transport));
          observation.localBegin("serialization");
          const bytes = (options.serializePrivate ?? serializePrivateHistoryErrors)({
            primary, caught: observation.originals().caught, cleanup: cleanupFailures,
            native: observation.originals().native,
          });
          observation.localBegin("write");
          await writeFile(path.join(tempRoot, "private-custody-errors.json"), bytes, { flag: "wx", mode: 0o600 });
          observation.localWritten();
        } catch (error) { observation.localFailed(); throw error; }
      });
      await observation.capture(options.independentCapture);
      const projection = observation.project();
      try { options.observe?.(projection); } catch { observation.lose(); }
      throw new AggregateError([...(primary ? [primary] : []), ...cleanupFailures.map(entry => entry.error)],
        `Windows fixture custody failed: ${JSON.stringify(observation.project())}`);
    }
    // Caught falsy originals retain the original control predicates while exposing observational loss.
    if (!primary && cleanupFailures.length === 0) {
      if (observation.originals().caught) await observation.capture(options.independentCapture);
      const projection = observation.project();
      if (projection) try { options.observe?.(projection); } catch { observation.lose(); }
    }
}
