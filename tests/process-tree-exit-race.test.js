import test from "node:test";
import assert from "node:assert/strict";
import {
  captureOwnedProcessTreeMembers,
  terminateOwnedProcessTree,
} from "../dist/runtime/process/tree.js";

const identity = {
  pid: 43123,
  createdAt: "2026-08-12T00:00:00.000Z",
  executablePath: "/usr/bin/node",
  commandHash: "a".repeat(64),
};

const target = {
  rootPid: identity.pid,
  rootIdentity: identity,
  processGroup: { kind: "none", id: null },
  knownMembers: [identity],
};

function missingProcessError() {
  return Object.assign(new Error("fixture process exited"), { code: "ENOENT" });
}

function sequencedInspector(...inspections) {
  let index = 0;
  return async () => inspections[Math.min(index++, inspections.length - 1)];
}

test("post-signal process absence settles adopted restart tree control", async () => {
  const signals = [];
  const result = await terminateOwnedProcessTree(target, 0, {
    platform: "linux",
    inspectProcess: sequencedInspector(
      { status: "running", identity },
      { status: "unknown", reason: "linux_process_evidence_incomplete" },
    ),
    killProcess: (pid, signal) => {
      if (signal === 0) throw missingProcessError();
      signals.push({ pid, signal });
    },
    readFile: async () => {
      throw missingProcessError();
    },
  });

  assert.deepEqual(result, { forced: false });
  assert.deepEqual(signals, [{ pid: identity.pid, signal: "SIGTERM" }]);
});

test("transient pre-signal inspection failure is retried without weakening identity verification", async () => {
  const signals = [];
  const result = await terminateOwnedProcessTree(target, 0, {
    platform: "linux",
    inspectProcess: sequencedInspector(
      { status: "unknown", reason: "windows_process_inspection_failed:transient" },
      { status: "running", identity },
      { status: "not_running", reason: "process_not_running" },
    ),
    killProcess: (pid, signal) => {
      if (signal !== 0) signals.push({ pid, signal });
    },
  });

  assert.deepEqual(result, { forced: false });
  assert.deepEqual(signals, [{ pid: identity.pid, signal: "SIGTERM" }]);
});

test("post-signal zombie settles legacy verified-member stop", async () => {
  const signals = [];
  const result = await terminateOwnedProcessTree(target, 0, {
    platform: "linux",
    inspectProcess: sequencedInspector(
      { status: "running", identity },
      { status: "unknown", reason: "linux_process_evidence_incomplete" },
    ),
    killProcess: (pid, signal) => {
      if (signal !== 0) signals.push({ pid, signal });
    },
    readFile: async () => `${identity.pid} (node) Z 1 1 1 0`,
  });

  assert.deepEqual(result, { forced: false });
  assert.deepEqual(signals, [{ pid: identity.pid, signal: "SIGTERM" }]);
});

test("post-signal process exit between presence and proc inspection settles cleanly", async () => {
  let presenceProbes = 0;
  const result = await terminateOwnedProcessTree(target, 0, {
    platform: "linux",
    inspectProcess: sequencedInspector(
      { status: "running", identity },
      { status: "unknown", reason: "linux_process_evidence_incomplete" },
    ),
    killProcess: (_pid, signal) => {
      if (signal !== 0) return;
      presenceProbes += 1;
      if (presenceProbes > 1) throw missingProcessError();
    },
    readFile: async () => {
      throw missingProcessError();
    },
  });

  assert.deepEqual(result, { forced: false });
  assert.equal(presenceProbes, 2);
});

test("live identity mismatch blocks process-tree control before and after signaling", async () => {
  const mismatch = {
    status: "running",
    identity: { ...identity, createdAt: "2026-08-12T00:00:01.000Z" },
  };
  let preSignalKills = 0;
  await assert.rejects(
    terminateOwnedProcessTree(target, 0, {
      platform: "linux",
      inspectProcess: async () => mismatch,
      killProcess: () => {
        preSignalKills += 1;
      },
    }),
    /Cannot verify process 43123/,
  );
  assert.equal(preSignalKills, 0);

  let postSignalExitProbes = 0;
  await assert.rejects(
    terminateOwnedProcessTree(target, 0, {
      platform: "linux",
      inspectProcess: sequencedInspector({ status: "running", identity }, mismatch),
      killProcess: (_pid, signal) => {
        if (signal !== 0) return;
      },
      readFile: async () => {
        postSignalExitProbes += 1;
        throw missingProcessError();
      },
    }),
    /Cannot verify process 43123/,
  );
  assert.equal(postSignalExitProbes, 0);
});

test("post-signal unverifiable active process remains fail closed", async () => {
  await assert.rejects(
    terminateOwnedProcessTree(target, 0, {
      platform: "linux",
      inspectProcess: sequencedInspector(
        { status: "running", identity },
        { status: "unknown", reason: "linux_process_evidence_incomplete" },
      ),
      killProcess: (_pid, signal) => {
        if (signal !== 0) return;
      },
      readFile: async () => `${identity.pid} (node) S 1 1 1 0`,
    }),
    /Cannot verify process 43123/,
  );
});

test("transient descendant inspection failure is retried before Windows adoption fails", async () => {
  const childIdentity = { ...identity, pid: identity.pid + 1, commandHash: "b".repeat(64) };
  let childInspections = 0;
  const members = await captureOwnedProcessTreeMembers(target, {
    platform: "win32",
    readWindowsProcessTable: async () => [
      { pid: identity.pid, parentPid: 1 },
      { pid: childIdentity.pid, parentPid: identity.pid },
    ],
    inspectProcess: async (pid) => {
      if (pid === identity.pid) {
        return { status: "running", identity };
      }
      childInspections += 1;
      return childInspections === 1
        ? { status: "unknown", reason: "windows_process_evidence_incomplete" }
        : { status: "running", identity: childIdentity };
    },
  });

  assert.equal(childInspections, 2);
  assert.deepEqual(members, [childIdentity, identity]);
});

test("Windows adoption ignores cyclic process-table descendants", async () => {
  const childIdentity = { ...identity, pid: identity.pid + 1, commandHash: "b".repeat(64) };
  const members = await captureOwnedProcessTreeMembers(target, {
    platform: "win32",
    readWindowsProcessTable: async () => [
      { pid: identity.pid, parentPid: childIdentity.pid },
      { pid: childIdentity.pid, parentPid: identity.pid },
    ],
    inspectProcess: async (pid) => pid === identity.pid
      ? { status: "running", identity }
      : { status: "running", identity: childIdentity },
  });

  assert.deepEqual(members, [childIdentity, identity]);
});

test("persistently unverifiable Windows descendant remains fail closed", async () => {
  let childInspections = 0;
  await assert.rejects(
    captureOwnedProcessTreeMembers(target, {
      platform: "win32",
      readWindowsProcessTable: async () => [
        { pid: identity.pid, parentPid: 1 },
        { pid: identity.pid + 1, parentPid: identity.pid },
      ],
      inspectProcess: async (pid) => {
        if (pid === identity.pid) {
          return { status: "running", identity };
        }
        childInspections += 1;
        return { status: "unknown", reason: "windows_process_evidence_incomplete" };
      },
    }),
    /Cannot verify descendant process 43124: windows_process_evidence_incomplete/,
  );
  assert.equal(childInspections, 3);
});
