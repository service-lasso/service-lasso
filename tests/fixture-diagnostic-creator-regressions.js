import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { captureFixtureErrors, retainFixtureOriginals, fixtureOriginalsMatch } from "./fixture-private-error-capture.js";
import { collectDiagnosticGuardian } from "./fixture-diagnostic-creator.js";

export function registerDiagnosticCreatorRegressions() {
  test("useful private capture retains supported cause content without formatting stack or getters", () => {
    const first = new Error("PRIVATE-FIRST"), later = new AggregateError([first], "PRIVATE-LATER", { cause: first });
    const owner = {}, rows = [{ stage: "action", error: first }, { stage: "diagnostic", error: later }];
    retainFixtureOriginals(owner, rows);
    let formats = 0; const old = Error.prepareStackTrace;
    Error.prepareStackTrace = () => { formats++; throw new Error("PRIVATE-FORMATTER"); };
    try {
      const captured = captureFixtureErrors(rows);
      assert.match(captured, /PRIVATE-FIRST/); assert.match(captured, /PRIVATE-LATER/);
      assert.equal(formats, 0); assert.equal(fixtureOriginalsMatch(owner, [first, later]), true);
    } finally { Error.prepareStackTrace = old; }
    for (const field of ["message", "cause", "errors"]) {
      let reads = 0; const original = new Error("PRIVATE-OPAQUE");
      Object.defineProperty(original, field, { get() { reads++; throw first; } });
      retainFixtureOriginals(owner, [{ stage: "diagnostic", error: original }]);
      assert.throws(() => captureFixtureErrors([{ stage: "diagnostic", error: original }]));
      assert.equal(reads, 0); assert.equal(fixtureOriginalsMatch(owner, [original]), true);
    }
    const opaque = new Proxy({}, { get() { throw first; }, getOwnPropertyDescriptor() { throw first; } });
    retainFixtureOriginals(owner, [{ stage: "action", error: opaque }, { stage: "diagnostic", error: null }, { stage: "held_release", error: undefined }]);
    assert.throws(() => captureFixtureErrors([{ stage: "action", error: opaque }]));
    assert.equal(fixtureOriginalsMatch(owner, [opaque, null, undefined]), true);
    const cycle = new Error("PRIVATE-CYCLE"); cycle.cause = cycle;
    assert.match(captureFixtureErrors([{ stage: "action", error: cycle }]), /"kind":"cycle"/);
    assert.throws(() => captureFixtureErrors([{ stage: "action", error: new Error("x".repeat(16385)) }]));
  });
  const nonce = "a".repeat(32);
  const surrogate = () => {
    const child = new EventEmitter(); child.stdin = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdin.write = (_bytes, callback) => { callback(null); };
    child.stdin.end = callback => { child.stdin.emit("finish"); callback?.(); };
    return { child, collector: collectDiagnosticGuardian(child, nonce), frame: (sequence, phase) => child.stdout.emit("data", Buffer.from(`GDC1|${nonce}|${sequence}|${phase}\n`)) };
  };
  test("diagnostic collector SURROGATE drives actual five-phase machinery and waits real close", async () => {
    const row = surrogate();
    const ready = row.collector.ready(); row.frame(1, "created-held"); await ready;
    const verify = row.collector.verify(); row.frame(2, "verified"); await verify;
    const handoff = row.collector.handoff(); row.frame(3, "handoff-held"); await handoff;
    const capture = row.collector.capture(); row.frame(4, "capture-held"); await capture;
    let settled = false; const close = row.collector.close().then(() => { settled = true; });
    row.frame(5, "closed"); await Promise.resolve(); await Promise.resolve();
    assert.equal(settled, false);
    row.child.stdin.emit("finish"); row.child.stdout.emit("end"); row.child.stderr.emit("end"); row.child.emit("exit", 0, null);
    assert.equal(settled, false); row.child.emit("close", 0, null); await close;
    assert.equal(settled, true);
  });
  test("diagnostic collector SURROGATES preserve opaque stream originals and reject malformed/partial/overflow output", async () => {
    for (const stage of ["spawn", "stdin", "stdout", "stderr"]) {
      const row = surrogate(), first = new Proxy({}, { get() { throw new Error("PRIVATE-GETTER"); } });
      const ready = row.collector.ready();
      (stage === "spawn" ? row.child : row.child[stage]).emit("error", first);
      let caught = false;
      try { await ready; } catch (actual) { caught = true; assert.strictEqual(actual, first); }
      assert.equal(caught, true);
      row.child.stdin.emit("error", null); row.child.stdout.emit("error", undefined);
      assert.strictEqual(row.collector.originals[0].original, first);
      assert.strictEqual(row.collector.originals[1].original, null); assert.strictEqual(row.collector.originals[2].original, undefined);
      const closed = row.collector.close(); row.child.stdout.emit("end"); row.child.stderr.emit("end"); row.child.emit("exit", 1, null); row.child.emit("close", 1, null);
      await assert.rejects(closed);
    }
    for (const wire of [`GDC1|${nonce}|2|verified\n`, `GDC1|${"b".repeat(32)}|1|created-held\n`,
      `GDC1|${nonce}|1|created-held\r\n`, "\n", "x".repeat(481), "\0", "\u0080"]) {
      const row = surrogate(), ready = row.collector.ready(); row.child.stdout.emit("data", Buffer.from(wire)); await assert.rejects(ready);
    }
    const partial = surrogate(), ready = partial.collector.ready(); partial.child.stdout.emit("data", Buffer.from("GDC1|")); partial.child.stdout.emit("end"); await assert.rejects(ready);
  });
  test("diagnostic collector SURROGATES reject lost acknowledgement, duplicate frame and EPIPE without losing originals", async () => {
    for (const scenario of ["duplicate", "lost_ack", "epipe", "write_throw", "stderr", "stderr_overflow"]) {
      const row = surrogate(), ready = row.collector.ready(); row.frame(1, "created-held"); await ready;
      const original = new Error("PRIVATE-EPIPE");
      if (scenario === "epipe") row.child.stdin.write = (_wire, callback) => { callback(original); };
      if (scenario === "write_throw") row.child.stdin.write = () => { throw original; };
      const verify = row.collector.verify();
      if (scenario === "duplicate") row.frame(1, "created-held");
      if (scenario === "stderr" || scenario === "stderr_overflow") row.child.stderr.emit("data", Buffer.alloc(scenario === "stderr" ? 1 : 16385, 120));
      if (scenario === "lost_ack") { row.child.stdout.emit("end"); row.child.stderr.emit("end"); row.child.emit("exit", 2, null); row.child.emit("close", 2, null); }
      await assert.rejects(verify);
      if (scenario === "epipe" || scenario === "write_throw") assert.strictEqual(row.collector.originals[0].original, original);
      if (scenario === "stderr_overflow") { assert.equal(row.collector.snapshot().stderr.length, 16384); assert.equal(row.collector.snapshot().stderrCount, 16385); }
      if (scenario !== "lost_ack") { const close = row.collector.close(); row.child.stdout.emit("end"); row.child.stderr.emit("end"); row.child.emit("exit", 2, null); row.child.emit("close", 2, null); await assert.rejects(close); }
    }
    for (const failure of ["signal", "missing_stdout_eof", "missing_stderr_eof", "missing_exit"]) {
      const row = surrogate(), ready = row.collector.ready(); row.frame(1, "created-held"); await ready;
      const close = row.collector.close();
      row.child.stdin.emit("finish");
      if (failure !== "missing_stdout_eof") row.child.stdout.emit("end");
      if (failure !== "missing_stderr_eof") row.child.stderr.emit("end");
      if (failure !== "missing_exit") row.child.emit("exit", failure === "signal" ? null : 1, failure === "signal" ? "SIGTERM" : null);
      row.child.emit("close", failure === "signal" ? null : 1, failure === "signal" ? "SIGTERM" : null);
      await assert.rejects(close);
    }
  });
}
