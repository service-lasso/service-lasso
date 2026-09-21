import assert from "node:assert/strict";
import test from "node:test";
import { readLinuxProcessTable } from "../dist/runtime/process/tree.js";
import { inspectTcpListenerProcesses } from "../dist/runtime/process/listener.js";

const vanished = () => Object.assign(new Error("process disappeared"), { code: "ENOENT" });

test("AC-4BH.1 process table avoids implicit stat and tolerates a vanished entry", async () => {
  const inspected = [];
  const rows = await readLinuxProcessTable({
    readdir: async (root, options) => {
      assert.equal(root, "/proc");
      // Models the failing Dirent conversion while the names remain readable.
      if (options?.withFileTypes) throw vanished();
      return ["101", "102", "103", "104", "105", "self", "not-a-pid"];
    },
    readlink: async (file) => file.startsWith("/proc/103/") ? "foreign" : "owned",
    readFile: async (file) => {
      inspected.push(file);
      if (file.startsWith("/proc/102/")) throw vanished();
      if (file.startsWith("/proc/104/")) return "malformed";
      if (file.endsWith("/status")) {
        const pid = file.startsWith("/proc/105/") ? 2 : 1;
        return `NSpid:\t101\t${pid}\nNSpgid:\t101\t1\n`;
      }
      return file.startsWith("/proc/105/") ? "105 (child) S 101 101" : "101 (parent) S 0 101";
    },
  });
  assert.deepEqual(rows, [
    { pid: 1, parentPid: 0, processGroupId: 1, state: "S" },
    { pid: 2, parentPid: 1, processGroupId: 1, state: "S" },
  ]);
  assert.ok(inspected.every((file) => /^\/proc\/\d+\//.test(file)));
});

for (const code of ["EACCES", "EIO", "ENOENT"]) {
  test(`AC-4BH.1 process table preserves root enumeration failure ${code}`, async () => {
    const error = Object.assign(new Error("enumeration unavailable"), { code });
    await assert.rejects(readLinuxProcessTable({
      readlink: async () => "owned",
      readdir: async () => { throw error; },
    }), (actual) => actual === error);
  });
}

const tcpTable = "header\n0: 0100007F:A029 00000000:0000 0A 0 0 0 1000 0 424242 1";
test("AC-4BH.1 listener scan skips vanished PID and retains surviving socket owner", async () => {
  const result = await inspectTcpListenerProcesses("127.0.0.1", 41001, {
    platform: "linux",
    readFile: async (file) => file === "/proc/net/tcp" ? tcpTable : "",
    readdir: async (file, options) => {
      assert.equal(options?.withFileTypes, undefined);
      if (file === "/proc") return ["102", "105", "self"];
      if (file === "/proc/102/fd") throw vanished();
      assert.equal(file, "/proc/105/fd");
      return ["7"];
    },
    readlink: async () => "socket:[424242]",
  });
  assert.deepEqual(result, { status: "listening", pids: [105] });
});

test("AC-4BH.1 listener enumeration failure remains unknown, not absent", async () => {
  const result = await inspectTcpListenerProcesses("127.0.0.1", 41001, {
    platform: "linux",
    readFile: async (file) => file === "/proc/net/tcp" ? tcpTable : "",
    readdir: async () => { throw Object.assign(new Error("denied"), { code: "EACCES" }); },
  });
  assert.deepEqual(result, { status: "unknown", reason: "inspection_unavailable" });
});
