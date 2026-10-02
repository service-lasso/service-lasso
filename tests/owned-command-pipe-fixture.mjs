import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";

// Test-only control channel. The holder owns inherited stdout/stderr and reports
// readiness through root IPC before root exit. No timer claims pipe ownership.
export async function withOwnedPipeFixture({ rootMode, releaseOnDisconnect }, exercise) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-1598-pipe-"));
  const token = randomBytes(32).toString("hex");
  const events = [];
  let socket;
  let ready = false;
  let released = false;
  let closed = false;
  let holderPid;
  let channelFailure;
  let closeResolve;
  const closure = new Promise(resolve => { closeResolve = resolve; });
  let connectionResolve;
  const connection = new Promise(resolve => { connectionResolve = resolve; });
  const server = createServer(candidate => {
    if (socket) { candidate.destroy(); channelFailure = new Error("Duplicate fixture connection"); return; }
    socket = candidate;
    connectionResolve();
    let pending = "";
    candidate.setEncoding("utf8");
    candidate.on("error", error => { channelFailure = error; });
    candidate.on("data", chunk => {
      pending += chunk;
      if (pending.length > 4096) { channelFailure = new Error("Fixture protocol overflow"); return; }
      while (pending.includes("\n")) {
        const index = pending.indexOf("\n");
        const line = pending.slice(0, index); pending = pending.slice(index + 1);
        let message;
        try { message = JSON.parse(line); } catch { channelFailure = new Error("Malformed fixture event"); continue; }
        if (message.token !== token || !Number.isSafeInteger(message.pid) || message.pid <= 0 ||
            (holderPid !== undefined && holderPid !== message.pid)) {
          channelFailure = new Error("Fixture identity mismatch"); continue;
        }
        holderPid = message.pid;
        events.push(message.event);
        if (message.event === "pipe-held") {
          if (ready) channelFailure = new Error("Duplicate pipe readiness");
          ready = true;
        } else if (message.event === "root-disconnected") {
          if (!ready) channelFailure = new Error("Root disconnected before pipe readiness");
          if (releaseOnDisconnect) release();
        } else if (message.event === "released") {
          if (!released) channelFailure = new Error("Unrequested fixture release");
        } else if (message.event === "pipes-ended") {
          if (!released) channelFailure = new Error("Unrequested inherited pipe closure");
        } else if (message.event === "fallback-expired") {
          channelFailure = new Error("Owned pipe-holder release bound expired");
        } else channelFailure = new Error("Unknown fixture event");
      }
    });
    candidate.on("close", () => { closed = true; events.push("control-closed"); closeResolve(); });
  });
  function release() {
    if (!socket || released || closed) return;
    released = true;
    events.push("release-requested");
    socket.write(JSON.stringify({ token, event: "release" }) + "\n");
  }
  let primary;
  let result;
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const port = server.address().port;
    const holder = path.join(tempRoot, "holder.mjs");
    const parent = path.join(tempRoot, "parent.mjs");
    await writeFile(holder, `
import { connect } from "node:net";
const token = ${JSON.stringify(token)};
const channel = connect(${port}, "127.0.0.1");
const emit = event => channel.write(JSON.stringify({ token, pid: process.pid, event }) + "\\n");
const fallback = setTimeout(() => { emit("fallback-expired"); finish(); }, 5000);
let finished = false;
function finish() {
  if (finished) return;
  finished = true; clearTimeout(fallback);
  let ended = 0;
  const pipeEnded = () => {
    if (++ended !== 2) return;
    emit("pipes-ended"); channel.end();
    if (process.connected) process.disconnect();
  };
  process.stdout.end(pipeEnded); process.stderr.end(pipeEnded);

}
channel.on("error", () => { process.exitCode = 1; finish(); });
channel.on("connect", () => {
  // Both inherited write streams are live in this process before acknowledgement.
  process.stdout.write("", () => process.stderr.write("", () => {
    emit("pipe-held"); process.send({ token, event: "pipe-held", pid: process.pid });
  }));
});
process.on("disconnect", () => { if (!finished) emit("root-disconnected"); });
let pending = "";
channel.setEncoding("utf8");
channel.on("data", chunk => {
  pending += chunk;
  if (pending.length > 4096) { process.exitCode = 1; finish(); return; }
  if (!pending.includes("\\n")) return;
  let message;
  try { message = JSON.parse(pending.trim()); } catch { process.exitCode = 1; finish(); return; }
  if (message.token !== token || message.event !== "release") { process.exitCode = 1; finish(); return; }
  emit("released"); finish();
});
`, "utf8");
    await writeFile(parent, `
import { spawn } from "node:child_process";
const token = ${JSON.stringify(token)};
const holder = spawn(process.execPath, [${JSON.stringify(holder)}], {
  stdio: ["ignore", "inherit", "inherit", "ipc"], detached: true, windowsHide: true,
});
holder.on("error", () => { process.exitCode = 1; });
holder.once("message", message => {
  if (message.token !== token || message.event !== "pipe-held" || message.pid !== holder.pid) { process.exit(2); }
  ${rootMode === "exit" ? "process.exit(0);" : "// Root remains alive until the caller-owned300ms deadline terminates it."}
});
`, "utf8");
    result = await exercise({ tempRoot, parent, controlPort: port,
      waitForControlConnection: () => connection, events, release, assertHeld() {
      assert.equal(channelFailure, undefined, "Owned fixture control channel failed");
      assert.equal(ready, true, "Pipe-holder readiness was not observed before command settlement");
      assert.ok(holderPid > 0);
      assert.equal(events.includes("fallback-expired"), false);
    } });
  } catch (error) { primary = error; }
  // Release only this unpredictable channel's holder. No PID signalling.
  let cleanup;
  try { release(); } catch (error) { cleanup = error; }
  if (socket) {
    let timer;
    try {
      await Promise.race([closure, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Owned fixture closure unresolved")), 5500); })]);
      assert.equal(channelFailure, undefined);
      assert.equal(events.includes("released"), true);
      assert.equal(events.includes("pipes-ended"), true);
      assert.equal(closed, true);
    } catch (error) { cleanup = cleanup ? new AggregateError([cleanup, error], "Release and closure failed") : error; }
    finally { clearTimeout(timer); }
  } else cleanup = new Error("Owned fixture never established its control channel; retain files");
  if (!cleanup && !primary) {
    await new Promise(resolve => server.close(resolve));
    await rm(tempRoot, { recursive: true, force: true });
  }
  if (primary || cleanup) {
    // Snapshot the failed observation BEFORE local handle disposal can emit close.
    // Local TCP disposal never establishes protocol completion or holder absence.
    try {
      await writeFile(path.join(tempRoot, "fixture-trace.json"), JSON.stringify({
        schema: "issue1598-owned-pipe-trace-v1", rootMode, releaseOnDisconnect,
        holderPid: holderPid ?? null, ready, released, controlClosed: closed, events,
        deadlineMs: rootMode === "deadline" ? 300 : 5000, closeWaitMs: 100,
        closureMeaning: "Private dedicated channel and inherited writable-end observations; no native descendant absence claim",
        primaryFailed: Boolean(primary), cleanupFailed: Boolean(cleanup),
        observationBeforeFixtureDisposal: true,
      }, null, 2) + "\n", "utf8");
    } catch (traceError) {
      cleanup = cleanup ? new AggregateError([cleanup, traceError], "Closure and private trace failed") : traceError;
    }
    try {
      // Only the accepted handle owned by this fixture; never signal a PID.
      socket?.destroy();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    } catch (disposeError) {
      cleanup = cleanup ? new AggregateError([cleanup, disposeError], "Closure and fixture disposal failed") : disposeError;
    }
  }
  if (primary && cleanup) throw new AggregateError([primary, cleanup], "Fixture assertion and retained closure failure");
  if (primary) throw primary;
  if (cleanup) throw cleanup;
  return result;
}
