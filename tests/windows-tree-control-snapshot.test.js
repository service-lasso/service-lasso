import test from "node:test";
import assert from "node:assert/strict";
import { inspectKnownWindowsTreeMembers } from "../dist/runtime/process/windows-tree-control-snapshot.js";
import { terminateOwnedProcessTree } from "../dist/runtime/process/tree.js";

const root = { pid: 4342, createdAt: "2026-07-18T01:02:04.456Z", executablePath: "C:\\node.exe", commandHash: "a".repeat(64) };
const child = { ...root, pid: 4345, commandHash: "b".repeat(64) };
const old = { ...root, pid: 4343, createdAt: "2026-07-18T01:02:02.456Z" };
const missing = { ...root, pid: 4346 };

test("filtered stop snapshot removes excluded old members, retains omitted owned evidence and checks identity afresh", async () => {
  const deadlineMs = Date.now() + 500;
  const signal = new AbortController().signal;
  const checks = [];
  const snapshot = await inspectKnownWindowsTreeMembers(root, [old, missing, root], deadlineMs, signal, false, {
    inspectTree: async (expected, options) => {
      assert.deepEqual(expected, root);
      assert.deepEqual(options, { deadlineMs, signal });
      return { rootStatus: "owned", members: [child, root], verifiedMembersOnly: true, excludedMemberPids: [old.pid] };
    },
    inspectIdentity: async (pid, options) => {
      assert.deepEqual(options, { deadlineMs, signal });
      checks.push(pid);
      return { status: "running", identity: missing };
    },
  });
  assert.equal(snapshot.verifiedMembersOnly, true);
  assert.deepEqual(snapshot.members.map(member => member.pid), [missing.pid, child.pid, root.pid]);
  assert.equal((await snapshot.inspectProcess(missing.pid)).status, "running");
  await snapshot.inspectProcess(missing.pid);
  assert.deepEqual(checks, [missing.pid, missing.pid]);
});

test("a previously filtered record retains fresh verification when its next snapshot has no exclusions", async () => {
  let checks = 0;
  const snapshot = await inspectKnownWindowsTreeMembers(root, [root], Date.now() + 500, new AbortController().signal, true, {
    inspectTree: async () => ({ rootStatus: "owned", members: [root] }),
    inspectIdentity: async () => { checks += 1; return { status: "unknown", reason: "access_denied" }; },
  });
  assert.equal(snapshot.verifiedMembersOnly, true);
  assert.equal((await snapshot.inspectProcess(root.pid)).status, "unknown");
  assert.equal(checks, 1);
});

test("filtered signal-time inspection forwards its narrower grace deadline and abort signal", async () => {
  const deadlineMs = Date.now() + 5_000;
  const outerSignal = new AbortController().signal;
  const graceController = new AbortController();
  const graceDeadlineMs = deadlineMs - 4_000;
  const snapshot = await inspectKnownWindowsTreeMembers(root, [root], deadlineMs, outerSignal, true, {
    inspectTree: async () => ({ rootStatus: "owned", members: [root] }),
    inspectIdentity: async (_pid, options) => {
      assert.equal(options.deadlineMs, graceDeadlineMs);
      assert.equal(options.signal, graceController.signal);
      return { status: "running", identity: root };
    },
  });
  await snapshot.inspectProcess(root.pid, { deadlineMs: graceDeadlineMs, signal: graceController.signal });
});

test("filtered refresh rejects a reused retained PID before it can replace an authorized fingerprint", async () => {
  await assert.rejects(inspectKnownWindowsTreeMembers(root, [child, root], Date.now() + 500, new AbortController().signal, true, {
    inspectTree: async () => ({ rootStatus: "owned", members: [{ ...child, commandHash: "c".repeat(64) }, root] }),
  }), /Cannot verify process 4345/);
});

test("filtered snapshot feeds adopted force control without reintroducing or signaling excluded members", async () => {
  const deadlineMs = Date.now() + 500;
  const signal = new AbortController().signal;
  const live = new Set([root.pid, child.pid, old.pid]);
  const signals = [];
  const snapshot = await inspectKnownWindowsTreeMembers(root, [old, root], deadlineMs, signal, false, {
    inspectTree: async () => ({ rootStatus: "owned", members: [child, root], verifiedMembersOnly: true, excludedMemberPids: [old.pid] }),
    inspectIdentity: async pid => ({ status: "running", identity: pid === root.pid ? root : child }),
  });
  await terminateOwnedProcessTree({ rootPid: root.pid, rootIdentity: root,
    processGroup: { kind: "none", id: null }, knownMembers: snapshot.members,
    verifiedMembersOnly: snapshot.verifiedMembersOnly, forceImmediately: true,
  }, 500, {
    platform: "win32", deadlineMs, signal, inspectProcess: snapshot.inspectProcess,
    killProcess: (pid, controlSignal) => {
      assert.notEqual(pid, old.pid);
      if (controlSignal === 0) {
        if (!live.has(pid)) throw Object.assign(new Error("exited"), { code: "ESRCH" });
        return;
      }
      signals.push(pid);
      live.delete(pid);
    },
    runWindowsCommand: async () => { throw new Error("No tree-wide rediscovery is authorized."); },
  });
  assert.deepEqual(signals, [child.pid, root.pid]);
  assert.equal(live.has(old.pid), true);
});
