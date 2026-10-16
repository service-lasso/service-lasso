import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { collectDiagnosticHoldTransport, acquireDiagnosticHoldCorrespondence, encodeGuardianCommand,
  GUARDIAN_ENCODED_COMMAND_LIMIT, DIAGNOSTIC_HOLD_PARENT_OPERATIONS, DIAGNOSTIC_HOLD_CHILD_OPERATIONS } from "./fixture-diagnostic-hold-protocol.js";

const ready = JSON.stringify({ kind: "ready", pid: 20, parentPid: 10, ownerSid: "S-1-5-21-1" }) + "\n";
const surrogate = () => {
  const child = new EventEmitter(); child.pid = 20;
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
  const callbacks = [];
  child.stdin.write = (text, done) => { callbacks.push(done); };
  child.stdin.end = (text, done) => { callbacks.push(done); };
  const transport = collectDiagnosticHoldTransport(child, 10);
  const complete = (code = 0, signal = null) => {
    child.stdin.emit("finish"); child.stdout.emit("end"); child.stderr.emit("end");
    child.emit("exit", code, signal); child.emit("close", code, signal);
  };
  return { child, transport, callbacks, complete };
};
const failureOf = async promise => {
  try { await promise; } catch (original) { return original; }
  assert.fail("Failure was required.");
};

test("guardian physical source capacity witness keeps fixed32600 limit without normalization", async () => {
  const source = await readFile(new URL("./fixture-diagnostic-hold.ps1", import.meta.url), "utf8");
  const legacy = await readFile(new URL("./fixture-root-custody.js", import.meta.url), "utf8");
  const start = legacy.indexOf("const guardianScript = `") + "const guardianScript = `".length;
  const actualLegacy = legacy.slice(start, legacy.indexOf("`;", start));
  for (const actual of [source, actualLegacy]) {
    const encoded = encodeGuardianCommand(actual);
    assert.equal(encoded, Buffer.from(actual, "utf16le").toString("base64"));
    assert.ok(encoded.length <= 32600);
  }
  assert.equal(GUARDIAN_ENCODED_COMMAND_LIMIT, 32600);
  assert.doesNotMatch(source, /\r/);
  const attributes = await readFile(new URL("../.gitattributes", import.meta.url), "utf8");
  assert.match(attributes, /^tests\/fixture-diagnostic-hold\.ps1 text eol=lf$/m);
  assert.equal(encodeGuardianCommand("x".repeat(12225)).length, 32600);
  assert.throws(() => encodeGuardianCommand("x".repeat(12226)));
  assert.throws(() => encodeGuardianCommand(("x\n").repeat(5000).replaceAll("\n", "\r\n")));
  assert.match(legacy, /if \(diagnosticRole\) return holdDiagnosticRootWindows\(root, diagnosticRoot\)/);
  assert.match(legacy, /encodeGuardianCommand\(guardianScript\)/);
});

for (const operation of DIAGNOSTIC_HOLD_CHILD_OPERATIONS) test(`guardian ${operation} failure-frame SURROGATE is failure observation only`, async () => {
  const { child, transport, callbacks, complete } = surrogate();
  const pending = failureOf(transport.ready());
  child.stdout.emit("data", Buffer.from(`GDH1|fail|${operation}\n`));
  const original = await pending;
  assert.strictEqual(transport.snapshot().originals[0], original);
  assert.equal(transport.snapshot().childFailure, operation);
  assert.equal(transport.snapshot().readyWitness, undefined);
  const close = failureOf(transport.release()); callbacks.shift()(); complete(); await close;
});

test("guardian script SOURCE witness binds all4 failure frames to complete actual catch blocks", async () => {
  const source = await readFile(new URL("./fixture-diagnostic-hold.ps1", import.meta.url), "utf8");
  for (const operation of DIAGNOSTIC_HOLD_CHILD_OPERATIONS)
    assert.equal(source.split(`Record-DiagnosticFailure '${operation}' $_`).length - 1, 1);
  assert.match(source, /try \{\s*\$ErrorActionPreference = 'Stop'[\s\S]*Add-Type -TypeDefinition[\s\S]*\$sid =[\s\S]*\} catch \{ Record-DiagnosticFailure 'bootstrap' \$_ \}/);
  assert.match(source, /foreach\(\$p in \$chain\)[\s\S]*\} catch \{ Record-DiagnosticFailure 'acquire_chain' \$_ \}/);
  assert.match(source, /try \{ Verify-Held \} catch \{ Record-DiagnosticFailure 'initial_verify' \$_ \}/);
  assert.match(source, /\$receipt = [\s\S]*Out\.Write[\s\S]*\} catch \{ Record-DiagnosticFailure 'ready_emit' \$_ \}/);
  assert.match(source, /Remember-Original \$original[\s\S]*Out\.Write[\s\S]*catch \{ Remember-Original \$_ \}/);
  assert.match(source, /foreach\(\$entry in \$held\) \{ try \{ \$entry\.Handle\.Dispose\(\) \} catch \{ Remember-Original \$_ \} \}/);
  assert.match(source, /catch \{ \$primary = \$_; Remember-Original \$_; throw \}/);
  assert.match(source, /catch \{ Remember-Original \$_; if \(\$null -eq \$primary\) \{ throw \} \}/);
  assert.match(source, /AggregateException\]::new\('Diagnostic guardian failed\.', \$exceptions\.ToArray\(\)\)/);
  assert.doesNotMatch(source, /ProgressPreference|ReadLine\(|kill|SIGTERM|SIGKILL/);
});

for (const operation of DIAGNOSTIC_HOLD_PARENT_OPERATIONS) test(`parent ${operation} correspondence SURROGATE retains exact caught opaque original`, async () => {
  for (const original of [null, undefined, new Proxy({}, { get() { assert.fail("Opaque original getter."); } })]) {
    const live = { ready: async () => { if (operation === "ready_receipt") throw original; }, assertLive() {} };
    const result = await acquireDiagnosticHoldCorrespondence(live, 20, 10, async pid => {
      if (pid === (operation === "child_inspection" ? 20 : 10)) throw original;
      return { status: "running", identity: { pid } };
    });
    assert.equal(result.failed, true); assert.strictEqual(result.original, original);
    assert.strictEqual(result.operationFailure.original, original); assert.equal(result.operationFailure.operation, operation);
  }
});

test("parent correspondence SURROGATE does not relabel a later caller failure as last successful child inspection", async () => {
  const original = new Error("PRIVATE-CALLER");
  const result = await acquireDiagnosticHoldCorrespondence({ ready: async () => {}, assertLive() {} }, 20, 10,
    async pid => { if (pid === 10) throw original; return { status: "running", identity: { pid } }; });
  assert.equal(result.operationFailure.operation, "caller_inspection"); assert.strictEqual(result.original, original);
  const success = await acquireDiagnosticHoldCorrespondence({ ready: async () => {}, assertLive() {} }, 20, 10,
    async pid => ({ status: "running", identity: { pid } }));
  assert.equal(success.failed, false); assert.equal(success.operationFailure, undefined);
});

test("guardian transport SURROGATE rejects malformed, duplicate, mixed, extra, partial and nonASCII framing", async () => {
  for (const text of ["GDH1|fail|unknown\n", "GDH1|fail|bootstrap\nGDH1|fail|bootstrap\n", ready + ready,
    ready + "GDH1|fail|initial_verify\n", "GDH1|fail|bootstrap\n" + ready, ready + "extra\n", ready.replace("\n", "\r\n"),
    ready.replace('"kind":', '"kind":"ready","kind":'), ready.replace("ready", "r\u00e9ady"), ready + "\0", ready.slice(0, -1)]) {
    const { child, transport, callbacks, complete } = surrogate();
    const pending = transport.ready().then(() => true, () => false);
    child.stdout.emit("data", Buffer.from(text));
    child.stdout.emit("end");
    await pending;
    const closing = failureOf(transport.release()); callbacks.shift()?.(); complete(); await closing;
    assert.ok(transport.snapshot().originals.length);
  }
});

test("guardian transport SURROGATE retains actual first/later stream originals and waits callbacks plus real close", async () => {
  const { child, transport, callbacks, complete } = surrogate();
  const pending = failureOf(transport.ready());
  const opaque = new Proxy({}, { get() { assert.fail("No raw stream error getters."); } });
  child.emit("error", null); child.stdin.emit("error", undefined); child.stdout.emit("error", opaque); child.stderr.emit("error", 0);
  assert.strictEqual(await pending, null);
  let settled = false;
  const closing = failureOf(transport.release()).then(value => { settled = true; return value; });
  child.emit("exit", 0, null); await Promise.resolve(); assert.equal(settled, false);
  complete(); await Promise.resolve(); assert.equal(settled, false);
  callbacks.shift()(); await closing;
  const originals = transport.snapshot().originals;
  assert.strictEqual(originals[0], null); assert.strictEqual(originals[1], undefined); assert.strictEqual(originals[2], opaque); assert.strictEqual(originals[3], 0);
});

test("guardian transport SURROGATE strictstderr rejects late content and bounds retained actual bytes", async () => {
  for (const length of [1, 16384, 16385]) {
    const { child, transport, callbacks, complete } = surrogate();
    const pending = transport.ready(); child.stdout.emit("data", Buffer.from(ready)); await pending;
    child.stderr.emit("data", Buffer.alloc(length, 65));
    assert.throws(() => transport.assertLive());
    const closing = failureOf(transport.release()); callbacks.shift()(); complete(); await closing;
    assert.equal(transport.snapshot().stderr.length, Math.min(length, 16384));
    assert.equal(transport.snapshot().stderrCount, length);
  }
});

test("guardian transport SURROGATE enforces total480 stdout and preserves synchronous EPIPE original", async () => {
  for (const length of [480, 481]) {
    const { child, transport, callbacks, complete } = surrogate();
    const pending = failureOf(transport.ready()); child.stdout.emit("data", Buffer.alloc(length, 65));
    child.stdout.emit("end"); await pending;
    const closing = failureOf(transport.release()); callbacks.shift()(); complete(); await closing;
    assert.equal(transport.snapshot().stdout.length, Math.min(length, 480));
  }
  for (const original of [null, undefined, new Error("PRIVATE-EPIPE")]) {
    const { child, transport, complete } = surrogate();
    const pending = transport.ready(); child.stdout.emit("data", Buffer.from(ready)); await pending;
    child.stdin.write = () => { throw original; };
    assert.strictEqual(await failureOf(transport.verify()), original);
    child.stdin.end = (text, done) => done();
    const closing = failureOf(transport.release()); complete(); await closing;
    assert.strictEqual(transport.snapshot().originals[0], original);
  }
});

test("guardian transport SURROGATE joins ready, actual verify acknowledgement, callbacks EOF exit and real close", async () => {
  const { child, transport, callbacks, complete } = surrogate();
  const pending = transport.ready(); child.stdout.emit("data", Buffer.from(ready)); await pending;
  transport.assertLive();
  const verified = transport.verify(); callbacks.shift()(); child.stdout.emit("data", Buffer.from("verified\n")); await verified;
  let settled = false;
  const closing = transport.release().then(result => { settled = true; return result; });
  callbacks.shift()(); child.emit("exit", 0, null); await Promise.resolve(); assert.equal(settled, false);
  complete(); assert.deepEqual(await closing, { code: 0, signal: null });
  assert.equal(transport.snapshot().originals.length, 0); assert.equal(transport.snapshot().readyWitness.pid, 20);
  assert.equal(transport.snapshot().childFailure, undefined);
});

test("guardian transport SURROGATE retains asynchronous write and end callback originals after ready", async () => {
  const { child, transport, callbacks, complete } = surrogate();
  const pending = transport.ready(); child.stdout.emit("data", Buffer.from(ready)); await pending;
  const first = new Error("PRIVATE-WRITE"), later = new Proxy({}, { get() { assert.fail("No callback error getters."); } });
  const verified = failureOf(transport.verify()); callbacks.shift()(first); assert.strictEqual(await verified, first);
  const closing = failureOf(transport.release()); callbacks.shift()(later); complete(); await closing;
  assert.strictEqual(transport.snapshot().originals[0], first); assert.strictEqual(transport.snapshot().originals[1], later);
});

test("guardian transport SURROGATE rejects nonzero signal and incomplete closure without success projection", async () => {
  for (const mode of ["nonzero", "signal", "stdoutEOF", "stderrEOF", "finish"]) {
    const { child, transport, callbacks } = surrogate();
    const pending = transport.ready(); child.stdout.emit("data", Buffer.from(ready)); await pending;
    const closing = failureOf(transport.release()); callbacks.shift()();
    if (mode !== "finish") child.stdin.emit("finish");
    if (mode !== "stdoutEOF") child.stdout.emit("end");
    if (mode !== "stderrEOF") child.stderr.emit("end");
    const code = mode === "nonzero" ? 1 : 0, signal = mode === "signal" ? "SIGTERM" : null;
    child.emit("exit", code, signal); child.emit("close", code, signal); await closing;
    assert.ok(transport.snapshot().originals.length);
  }
});
