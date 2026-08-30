import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  captureOwnedProcessTreeMembers,
  terminateOwnedProcessTree,
} from "../dist/runtime/process/tree.js";
import { inspectProcess as inspectOwnedProcess } from "../dist/runtime/process/identity.js";

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
const CONTROL_TIMEOUT_MS = 250;

function missingProcessError() {
  return Object.assign(new Error("fixture process exited"), { code: "ENOENT" });
}

function sequencedInspector(...inspections) {
  let index = 0;
  return async () => inspections[Math.min(index++, inspections.length - 1)];
}

test("post-signal process absence settles adopted restart tree control", async () => {
  const signals = [];
  const result = await terminateOwnedProcessTree(target, CONTROL_TIMEOUT_MS, {
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
  const result = await terminateOwnedProcessTree(target, CONTROL_TIMEOUT_MS, {
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
  const result = await terminateOwnedProcessTree(target, CONTROL_TIMEOUT_MS, {
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
  const result = await terminateOwnedProcessTree(target, CONTROL_TIMEOUT_MS, {
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
    terminateOwnedProcessTree(target, CONTROL_TIMEOUT_MS, {
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
    terminateOwnedProcessTree(target, CONTROL_TIMEOUT_MS, {
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
    terminateOwnedProcessTree(target, CONTROL_TIMEOUT_MS, {
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
    killProcess: () => undefined,
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
      killProcess: () => undefined,
    }),
    /Cannot verify descendant process 43124: windows_process_evidence_incomplete/,
  );
  assert.equal(childInspections, 3);
});

test("Windows adoption ignores a descendant that exits after the process-table snapshot", async () => {
  const childPid = identity.pid + 1;
  let childInspections = 0;
  const members = await captureOwnedProcessTreeMembers(target, {
    platform: "win32",
    readWindowsProcessTable: async () => [
      { pid: identity.pid, parentPid: 1 },
      { pid: childPid, parentPid: identity.pid },
    ],
    inspectProcess: async (pid) => {
      if (pid === identity.pid) {
        return { status: "running", identity };
      }
      childInspections += 1;
      return { status: "unknown", reason: "windows_process_evidence_incomplete" };
    },
    killProcess: (pid, signal) => {
      assert.equal(pid, childPid);
      assert.equal(signal, 0);
      throw missingProcessError();
    },
  });

  assert.equal(childInspections, 1);
  assert.deepEqual(members, [identity]);
});

test("Windows full-table native inspection is aborted at the shared deadline without signaling any process", async () => {
  const inspected = [];
  let fullTableAbortObserved = false;
  const startedAt = Date.now();

  await assert.rejects(
    captureOwnedProcessTreeMembers({ ...target, knownMembers: [] }, {
      platform: "win32",
      deadlineMs: Date.now() + 150,
      inspectProcess: async (pid) => {
        inspected.push(pid);
        return { status: "running", identity };
      },
      readWindowsProcessTable: async ({ signal } = {}) => await new Promise(() => {
        signal?.addEventListener("abort", () => { fullTableAbortObserved = true; }, { once: true });
      }),
      runWindowsCommand: async () => {
        throw new Error("no Windows command may run when full-table inspection never closes");
      },
    }),
    (error) => error?.code === "PROCESS_CONTROL_DEADLINE_EXCEEDED" &&
      error.message === "Process control did not converge before its deadline.",
  );

  assert.equal(fullTableAbortObserved, true);
  assert.equal(Date.now() - startedAt < 1_000, true);
  assert.deepEqual(new Set(inspected), new Set([identity.pid]));
});

test("Windows per-PID native inspection is aborted at the shared deadline before taskkill", async () => {
  const childIdentity = { ...identity, pid: identity.pid + 1, commandHash: "b".repeat(64) };
  const inspected = [];
  const commands = [];
  let childAbortObserved = false;
  const startedAt = Date.now();

  await assert.rejects(
    captureOwnedProcessTreeMembers({ ...target, knownMembers: [] }, {
      platform: "win32",
      deadlineMs: Date.now() + 150,
      inspectProcess: async (pid, { signal } = {}) => {
        inspected.push(pid);
        if (pid === identity.pid) return { status: "running", identity };
        return await new Promise(() => {
          signal?.addEventListener("abort", () => { childAbortObserved = true; }, { once: true });
        });
      },
      readWindowsProcessTable: async () => [
        { pid: identity.pid, parentPid: 1 },
        { pid: childIdentity.pid, parentPid: identity.pid },
      ],
      runWindowsCommand: async (command, args) => {
        commands.push([command, ...args]);
        return { exitCode: 0, stdout: "" };
      },
    }),
    (error) => error?.code === "PROCESS_CONTROL_DEADLINE_EXCEEDED",
  );

  assert.equal(childAbortObserved, true);
  assert.equal(Date.now() - startedAt < 1_000, true);
  assert.deepEqual(new Set(inspected), new Set([identity.pid, childIdentity.pid]));
  assert.deepEqual(commands, []);
});

test("Windows per-PID native helper is killed and observed closed inside its absolute deadline", async () => {
  let helperAbortObserved = false;
  let helperCloseObserved = false;
  let helperPid = null;
  const startedAt = Date.now();

  await assert.rejects(
    inspectOwnedProcess(identity.pid, {
      platform: "win32",
      windowsSystemRoot: "C:\\Windows",
      deadlineMs: Date.now() + 500,
      runCommand: async (_command, _args, { signal } = {}) => {
        const helper = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
          stdio: ["ignore", "pipe", "ignore"],
          windowsHide: true,
        });
        helperPid = helper.pid;
        return await new Promise((resolve, reject) => {
          helper.once("error", reject);
          helper.once("close", () => {
            helperCloseObserved = true;
            resolve({ stdout: "" });
          });
          signal?.addEventListener("abort", () => {
            helperAbortObserved = true;
            helper.kill("SIGKILL");
          }, { once: true });
        });
      },
    }),
    (error) => error?.code === "PROCESS_CONTROL_DEADLINE_EXCEEDED",
  );

  assert.equal(helperAbortObserved, true);
  assert.equal(helperCloseObserved, true);
  assert.equal(Number.isInteger(helperPid) && helperPid > 0 && helperPid !== identity.pid, true);
  assert.equal(Date.now() - startedAt < 1_500, true);
});

test("Windows taskkill helpers are aborted at one deadline and target only the verified root tree", async () => {
  const commands = [];
  let helperAbortCount = 0;
  let helperCloseCount = 0;
  const helperPids = [];
  const startedAt = Date.now();

  await assert.rejects(
    terminateOwnedProcessTree({
      ...target,
      rootOwnershipProbe: () => "owned",
    }, 500, {
      platform: "win32",
      inspectProcess: async () => {
        throw new Error("Managed root handle proof must bypass per-PID CIM.");
      },
      runWindowsCommand: async (command, args, { signal }) => {
        commands.push([command, ...args]);
        const helper = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
          stdio: "ignore",
          windowsHide: true,
        });
        helperPids.push(helper.pid);
        return await new Promise((resolve, reject) => {
          helper.once("error", reject);
          helper.once("close", () => {
            helperCloseCount += 1;
            resolve({ exitCode: null, stdout: "" });
          });
          signal.addEventListener("abort", () => {
            helperAbortCount += 1;
            helper.kill("SIGKILL");
          }, { once: true });
        });
      },
    }),
    (error) => error?.code === "PROCESS_CONTROL_DEADLINE_EXCEEDED",
  );

  assert.equal(Date.now() - startedAt < 1_500, true);
  assert.equal(helperAbortCount, 2);
  assert.equal(helperCloseCount, 2);
  assert.equal(helperPids.every((pid) => Number.isInteger(pid) && pid > 0 && pid !== identity.pid), true);
  assert.deepEqual(commands, [
    ["taskkill", "/pid", String(identity.pid), "/t"],
    ["taskkill", "/pid", String(identity.pid), "/t", "/f"],
  ]);
  assert.equal(JSON.stringify(commands).includes(String(process.pid)), false);
});

test("Windows process-tree stop refuses a missing root fingerprint before taskkill", async () => {
  const commands = [];
  await assert.rejects(
    terminateOwnedProcessTree({ ...target, rootIdentity: null, knownMembers: [] }, 150, {
      platform: "win32",
      runWindowsCommand: async (command, args) => {
        commands.push([command, ...args]);
        return { exitCode: 0, stdout: "" };
      },
    }),
    /without verified root identity/,
  );
  assert.deepEqual(commands, []);
});

test("Windows adopted stop uses one forced exact-root taskkill without a graceful helper", async () => {
  const commands = [];
  const result = await terminateOwnedProcessTree({
    ...target,
    forceImmediately: true,
    preferFastWindowsRootIdentity: true,
  }, 500, {
    platform: "win32",
    classifyWindowsProcessIdentityFast: async () => "owned",
    inspectProcess: async () => {
      throw new Error("Conclusive native identity must bypass per-PID CIM.");
    },
    killProcess: (_pid, signal) => {
      if (signal === 0) throw missingProcessError();
      throw new Error("Verified adopted members must remain owned by taskkill /T.");
    },
    runWindowsCommand: async (command, args) => {
      commands.push([command, ...args]);
      return { exitCode: 0, stdout: "" };
    },
  });

  assert.deepEqual(result, { forced: true });
  assert.deepEqual(commands, [["taskkill", "/pid", String(identity.pid), "/t", "/f"]]);
});

test("Windows adopted immediate-force stop rejects a changed fingerprint before any helper", async () => {
  const commands = [];
  await assert.rejects(
    terminateOwnedProcessTree({
      ...target,
      forceImmediately: true,
      preferFastWindowsRootIdentity: true,
    }, 500, {
      platform: "win32",
      classifyWindowsProcessIdentityFast: async () => "identity_mismatch",
      inspectProcess: async () => {
        throw new Error("Conclusive native mismatch must bypass per-PID CIM.");
      },
      runWindowsCommand: async (command, args) => {
        commands.push([command, ...args]);
        return { exitCode: 0, stdout: "" };
      },
    }),
    /Cannot verify process 43123/,
  );

  assert.deepEqual(commands, []);
});

test("Windows adopted immediate-force stop treats a conclusively exited incarnation as clean without a helper", async () => {
  const commands = [];
  const result = await terminateOwnedProcessTree({
    ...target,
    knownMembers: [],
    forceImmediately: true,
    preferFastWindowsRootIdentity: true,
  }, 500, {
    platform: "win32",
    classifyWindowsProcessIdentityFast: async () => "not_running",
    inspectProcess: async () => {
      throw new Error("Conclusive native exit must bypass per-PID CIM.");
    },
    runWindowsCommand: async (command, args) => {
      commands.push([command, ...args]);
      return { exitCode: 0, stdout: "" };
    },
  });

  assert.deepEqual(result, { forced: false });
  assert.deepEqual(commands, []);
});

test("Windows adopted immediate-force stop settles an authorized root that exits before taskkill completes", async () => {
  const commands = [];
  let presenceProbes = 0;
  const result = await terminateOwnedProcessTree({
    ...target,
    forceImmediately: true,
    preferFastWindowsRootIdentity: true,
  }, 500, {
    platform: "win32",
    classifyWindowsProcessIdentityFast: async () => "owned",
    inspectProcess: async () => {
      throw new Error("Post-taskkill absence must bypass per-PID CIM.");
    },
    killProcess: (_pid, signal) => {
      if (signal === 0) {
        presenceProbes += 1;
        throw missingProcessError();
      }
    },
    runWindowsCommand: async (command, args) => {
      commands.push([command, ...args]);
      return { exitCode: 128, stdout: "" };
    },
  });

  assert.deepEqual(result, { forced: true });
  assert.equal(presenceProbes, 1);
  assert.deepEqual(commands, [["taskkill", "/pid", String(identity.pid), "/t", "/f"]]);
});

test("Windows adopted immediate-force stop falls back to the full fingerprint only for inconclusive native evidence", async () => {
  const commands = [];
  let fullFingerprintChecks = 0;
  const result = await terminateOwnedProcessTree({
    ...target,
    forceImmediately: true,
    preferFastWindowsRootIdentity: true,
  }, 500, {
    platform: "win32",
    classifyWindowsProcessIdentityFast: async () => "unknown_owner",
    inspectProcess: async () => {
      fullFingerprintChecks += 1;
      return { status: "running", identity };
    },
    killProcess: (_pid, signal) => {
      if (signal === 0) throw missingProcessError();
    },
    runWindowsCommand: async (command, args) => {
      commands.push([command, ...args]);
      return { exitCode: 0, stdout: "" };
    },
  });

  assert.deepEqual(result, { forced: true });
  assert.equal(fullFingerprintChecks, 1);
  assert.deepEqual(commands, [["taskkill", "/pid", String(identity.pid), "/t", "/f"]]);
});

test("Windows managed root-handle exit proof prevents taskkill against a reused PID", async () => {
  const commands = [];
  const result = await terminateOwnedProcessTree({
    ...target,
    knownMembers: [],
    rootOwnershipProbe: () => "exited",
  }, 500, {
    platform: "win32",
    inspectProcess: async () => {
      throw new Error("Exited native process handle must bypass per-PID CIM.");
    },
    runWindowsCommand: async (command, args) => {
      commands.push([command, ...args]);
      return { exitCode: 0, stdout: "" };
    },
  });

  assert.deepEqual(result, { forced: false });
  assert.deepEqual(commands, []);
});

test("Windows exited managed root still cleans its verified descendant without retargeting the root PID", async () => {
  const childIdentity = { ...identity, pid: identity.pid + 1, commandHash: "b".repeat(64) };
  const signals = [];
  const commands = [];
  const result = await terminateOwnedProcessTree({
    ...target,
    knownMembers: [identity, childIdentity],
    rootOwnershipProbe: () => "exited",
  }, 500, {
    platform: "win32",
    inspectProcess: async (pid) => pid === childIdentity.pid
      ? { status: "running", identity: childIdentity }
      : { status: "not_running", reason: "process_not_running" },
    killProcess: (pid, signal) => {
      if (signal === 0) {
        throw missingProcessError();
      }
      signals.push({ pid, signal });
    },
    runWindowsCommand: async (command, args) => {
      commands.push([command, ...args]);
      return { exitCode: 0, stdout: "" };
    },
  });

  assert.deepEqual(result, { forced: false });
  assert.deepEqual(signals, [{ pid: childIdentity.pid, signal: "SIGTERM" }]);
  assert.deepEqual(commands, []);
});

test("Windows managed root-handle probe failure remains fail closed before taskkill", async () => {
  const commands = [];
  await assert.rejects(
    terminateOwnedProcessTree({
      ...target,
      knownMembers: [],
      rootOwnershipProbe: () => "unverifiable",
    }, 500, {
      platform: "win32",
      inspectProcess: async () => {
        throw new Error("Unverifiable native process handle must not fall back to PID authorization.");
      },
      runWindowsCommand: async (command, args) => {
        commands.push([command, ...args]);
        return { exitCode: 0, stdout: "" };
      },
    }),
    /Cannot verify process 43123/,
  );

  assert.deepEqual(commands, []);
});
