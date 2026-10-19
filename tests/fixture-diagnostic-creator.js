import { spawn } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { lstat, realpath, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { inspectProcess } from "../dist/runtime/process/identity.js";
import { createFixtureOwnedError } from "./fixture-private-error-capture.js";

// The shared collector is correspondence only. A surrogate cannot mint a
// native owner; only the private fixed spawn below creates a creation owner.
export function collectDiagnosticGuardian(child, nonce) {
  const originals = [], stdout = [], stderr = [];
  let stdoutCount = 0, stderrCount = 0, line = "", sequence = 0, pending, deliveryReject;
  let stdoutEnd = false, stderrEnd = false, closed = false, exit, exitEvent, stdinFinished = false, stdinEndAttempted = false;
  child.stdin.once("finish", () => { stdinFinished = true; });
  child.once("exit", (code, signal) => { exitEvent = { code, signal }; });
  const phases = ["created-held", "verified", "handoff-held", "capture-held", "closed"];
  const failure = (stage, original) => { originals.push({ stage, original }); pending?.reject(original); pending = undefined; deliveryReject?.(original); deliveryReject = undefined; };
  const malformed = () => failure("protocol", createFixtureOwnedError("Diagnostic guardian protocol rejected."));
  for (const [stream, stage] of [[child, "spawn"], [child.stdin, "stdin"], [child.stdout, "stdout"], [child.stderr, "stderr"]])
    stream.on("error", original => failure(stage, original));
  child.stdout.on("end", () => { stdoutEnd = true; if (line) malformed(); });
  child.stderr.on("end", () => { stderrEnd = true; });
  child.stdout.on("data", chunk => {
    const bytes = Buffer.from(chunk); const remaining = Math.max(0, 480 - stdoutCount);
    stdout.push(bytes.subarray(0, remaining)); stdoutCount += bytes.length;
    if (stdoutCount > 480) { malformed(); return; }
    for (const byte of bytes) {
      if (byte > 127 || byte === 0 || byte === 13 || line.length >= 95) { malformed(); return; }
      if (byte !== 10) { line += String.fromCharCode(byte); continue; }
      const expected = `GDC1|${nonce}|${sequence + 1}|${phases[sequence]}`;
      if (line !== expected || !pending || pending.sequence !== sequence + 1 || sequence >= phases.length) { malformed(); return; }
      sequence++; line = ""; const waiter = pending; pending = undefined; waiter.resolve();
    }
  });
  child.stderr.on("data", chunk => {
    const bytes = Buffer.from(chunk), remaining = Math.max(0, 16384 - stderrCount);
    stderr.push(bytes.subarray(0, remaining)); stderrCount += bytes.length;
    failure(stderrCount > 16384 ? "stderr_overflow" : "stderr_content", createFixtureOwnedError("Diagnostic guardian private stderr rejected."));
  });
  const closure = new Promise(resolve => child.once("close", (code, signal) => {
    closed = true; exit = { code, signal };
    if (pending) failure("close", createFixtureOwnedError("Diagnostic guardian closed before acknowledgement."));
    resolve(exit);
  }));
  const awaitFrame = expected => new Promise((resolve, reject) => {
    if (originals.length) { reject(originals[0].original); return; }
    if (pending || closed || sequence + 1 !== expected) { reject(createFixtureOwnedError("Diagnostic guardian request state rejected.")); return; }
    pending = { sequence: expected, resolve, reject };
  });
  const command = async (expected, verb) => {
    if (originals.length) throw originals[0].original;
    const frame = awaitFrame(expected);
    const delivery = new Promise((resolve, reject) => {
      deliveryReject = reject;
      try { child.stdin.write(`GDC1|${nonce}|${expected - 1}|${verb}\n`, error => {
        deliveryReject = undefined;
        if (error !== null && error !== undefined) { failure("write", error); reject(error); }
        else if (verb === "close") { try { stdinEndAttempted = true; child.stdin.end(error => {
          if (error !== null && error !== undefined) { failure("end", error); reject(error); } else resolve();
        }); } catch (original) { failure("end", original); reject(original); } }
        else resolve();
      }); } catch (original) { failure("write", original); reject(original); }
    });
    // Observe both completions even when either fails; never lose a rejection.
    const outcomes = await Promise.allSettled([frame, delivery]);
    const rejected = outcomes.find(row => row.status === "rejected");
    if (rejected) throw rejected.reason;
  };
  return {
    ready: () => awaitFrame(1), verify: () => command(2, "verify"), handoff: () => command(3, "handoff"), capture: () => command(4, "capture"),
    originals, snapshot: () => ({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), stdoutCount, stderrCount, sequence,
      stdoutEnd, stderrEnd, stdinFinished, closed, exit, exitEvent }),
    healthy: () => originals.length === 0 && !closed,
    async close() {
      let commandFailure, commandFailed = false;
      if (!closed && originals.length === 0 && sequence === 4) {
        try { await command(5, "close"); } catch (original) { commandFailed = true; commandFailure = original; }
      }
      // EOF is owned handle cleanup, not a timer/kill/retry. Callers must first
      // settle every admitted borrower. Failure never claims postexit custody.
      if (!closed && !stdinEndAttempted) {
        stdinEndAttempted = true;
        try { child.stdin.end(); } catch (original) { failure("end", original); }
      }
      const result = await closure;
      if (commandFailed || originals.length || result.code !== 0 || result.signal !== null || !stdoutEnd || !stderrEnd || !stdinFinished ||
          !exitEvent || exitEvent.code !== result.code || exitEvent.signal !== result.signal || sequence !== 5 || line)
        throw new AggregateError([...(commandFailed ? [commandFailure] : []), ...originals.map(row => row.original), createFixtureOwnedError("Diagnostic guardian closure rejected.")], "Diagnostic guardian failed.");
    },
  };
}

export async function createPrivateDiagnosticDirectory(parent, prefix, retainOwner) {
  if (process.platform !== "win32" || !/^[A-Za-z0-9_-]{1,140}$/.test(prefix)) throw createFixtureOwnedError("Diagnostic creation inputs rejected.");
  if (process.env.SystemRoot?.toLowerCase() !== "c:\\windows") throw createFixtureOwnedError("Diagnostic physical tool recipe unavailable.");
  const namedParent = path.resolve(parent), info = await lstat(namedParent, { bigint: true });
  parent = await realpath(namedParent);
  const canonical = await lstat(parent, { bigint: true });
  if (!info.isDirectory() || info.isSymbolicLink() || !canonical.isDirectory() || canonical.isSymbolicLink() ||
      info.dev !== canonical.dev || info.ino !== canonical.ino) throw createFixtureOwnedError("Diagnostic parent namespace rejected.");
  const leaf = `${prefix}${randomBytes(16).toString("hex")}`, nonce = randomBytes(16).toString("hex");
  const root = path.join(parent, leaf);
  const script = await readFile(new URL("./fixture-diagnostic-creator.ps1", import.meta.url), "utf8");
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  // Fixed executable/flag quoting consumes fewer than 167 UTF16 characters.
  // Refuse source growth beyond the actual Windows command-line capacity.
  if (encoded.length > 32600) throw createFixtureOwnedError("Diagnostic fixed command exceeds Windows capacity.");
  const child = spawn("C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
    { cwd: parent, windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env,
      SERVICE_LASSO_DIAGNOSTIC_PARENT: parent, SERVICE_LASSO_DIAGNOSTIC_LEAF: leaf,
      SERVICE_LASSO_DIAGNOSTIC_NONCE: nonce, SERVICE_LASSO_DIAGNOSTIC_CALLER: String(process.pid) } });
  const collector = collectDiagnosticGuardian(child, nonce);
  let ready = false, verified = false, verifyAttempted = false, handed = false, handoffAttempted = false;
  let captured = false, captureAttempted = false, settled = false, releasing = false, receiptWritten = false;
  let borrowers = 0;
  const owner = {
    root,
    live: () => ready && handed && !settled && collector.healthy(),
    assertLive() { if (!owner.live()) throw createFixtureOwnedError("Diagnostic native owner is unavailable."); },
    async borrow(action) {
      if (!ready || handed || settled || !collector.healthy()) throw createFixtureOwnedError("Diagnostic borrower state rejected.");
      borrowers++;
      try { return await action(); } finally { borrowers--; }
    },
    async verify() { if (!ready || verifyAttempted || settled) throw createFixtureOwnedError("Diagnostic verify state rejected."); verifyAttempted = true; await collector.verify(); verified = true; },
    async handoff() { if (!verified || borrowers || handoffAttempted || settled) throw createFixtureOwnedError("Diagnostic handoff state rejected."); handoffAttempted = true; await collector.handoff(); handed = true; },
    async capture() { if (!handed || borrowers || captureAttempted || settled) throw createFixtureOwnedError("Diagnostic capture state rejected."); captureAttempted = true; await collector.capture(); captured = true; },
    async release() {
      if (settled) return;
      if (borrowers) throw createFixtureOwnedError("Diagnostic borrowers remain active; original retained.");
      if (releasing) throw createFixtureOwnedError("Diagnostic settlement is already pending.");
      releasing = true;
      const failures = [];
      if (handed && !captureAttempted) { try { await owner.capture(); } catch (error) { failures.push(error); } }
      if (captured && !receiptWritten) {
        receiptWritten = true;
        const raw = collector.snapshot();
        for (const [file, bytes] of [["birth-guardian-stdout.bin", raw.stdout], ["birth-guardian-stderr.bin", raw.stderr],
          ["birth-guardian-custody.json", JSON.stringify({ schema: "service-lasso.diagnostic-birth-custody.v1", state: "pending",
            stdout: { bytes: raw.stdoutCount, sha256: createHash("sha256").update(raw.stdout).digest("hex") },
            stderr: { bytes: raw.stderrCount, sha256: createHash("sha256").update(raw.stderr).digest("hex") } })]]) {
          try { await writeFile(path.join(root, file), bytes, { flag: "wx", mode: 0o600 }); } catch (error) { failures.push(error); }
        }
      }
      try { await collector.close(); } catch (error) { failures.push(error); }
      settled = true;
      if (failures.length) throw new AggregateError(failures, "Diagnostic birth settlement failed; final persistence unavailable.");
    },
  };
  retainOwner(owner); // Own partial creation BEFORE awaiting child readiness.
  await collector.ready();
  const [actualChild, actualCaller] = await Promise.all([inspectProcess(child.pid, { deadlineMs: Date.now() + 5000 }), inspectProcess(process.pid, { deadlineMs: Date.now() + 5000 })]);
  if (!collector.healthy() || actualChild.status !== "running" || actualChild.identity.pid !== child.pid || actualCaller.status !== "running" || actualCaller.identity.pid !== process.pid)
    throw createFixtureOwnedError("Diagnostic owned process occurrence unavailable.");
  ready = true;
  return owner;
}
