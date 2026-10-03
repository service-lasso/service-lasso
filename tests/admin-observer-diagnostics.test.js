import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { consumeWithDurableObserver } from "../scripts/consume-admin-trusted-unlock-receipt.mjs";
import { OBSERVER_STAGES, observerExitWitness, projectObserverEvent, readObserverDiagnostic, readObserverEventBytes, retainObserverEvent } from "../scripts/admin-observer-diagnostics.mjs";

const source = { head: "a".repeat(40), tree: "b".repeat(40) };
const bindingFor = (root) => ({ root, source, nonce: "c".repeat(64) });
const recordFor = (binding, stage, event) => ({ schema: "service-lasso.admin-observer-diagnostic-private.v1", private: true, nonce: binding.nonce, source: binding.source, stage, event });

test("AC-4BY.2 phase projection rejects private data, getters, unknown events and foreign custody", () => {
  const binding = bindingFor(path.resolve("unused-private-root"));
  for (const stage of OBSERVER_STAGES) {
    assert.deepEqual(projectObserverEvent(recordFor(binding, stage, "entered"), binding), { stage, event: "entered" });
  }
  const valid = recordFor(binding, "self_native_identity", "failed");
  for (const value of [
    { ...valid, stage: "native_ready" }, { ...valid, event: "success" },
    { ...valid, nonce: "d".repeat(64) }, { ...valid, source: { ...source, head: "e".repeat(40) } },
    { ...valid, message: "PRIVATE_SENTINEL" }, { ...valid, source: { ...source, path: "PRIVATE_SENTINEL" } },
    { ...valid, get event() { throw new Error("PRIVATE_SENTINEL"); } },
  ]) assert.equal(projectObserverEvent(value, binding), null);
});

test("AC-4BY.2 actual private failure event remains primary over later close bookkeeping", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "observer-phase-events-"));
  try {
    const binding = bindingFor(root);
    assert.deepEqual(await readObserverDiagnostic(binding), { stage: "unavailable", event: "unavailable" });
    const error = new Error("PRIVATE_SENTINEL-original");
    error.stderr = Buffer.from("PRIVATE_SENTINEL-native-stderr");
    assert.equal(await retainObserverEvent(binding, "self_native_identity", "entered"), true);
    assert.equal(await retainObserverEvent(binding, "self_native_identity", "failed", error), true);
    assert.equal(await retainObserverEvent(binding, "close", "completed"), true);
    const projected = await readObserverDiagnostic(binding);
    assert.deepEqual(projected, { stage: "self_native_identity", event: "failed" });
    assert.doesNotMatch(JSON.stringify(projected), /PRIVATE_SENTINEL|pid|path|stderr/iu);
    const original = JSON.parse(await readFile(path.join(root, "observer-self_native_identity-error.json"), "utf8"));
    assert.equal(original.original.message, error.message);
    assert.equal(Buffer.from(original.original.stderr.bytes, "base64").toString(), error.stderr.toString());
    assert.equal(original.nonce, binding.nonce);
    assert.deepEqual(original.source, source);
    // Exclusive retention never replaces the first actual error/event.
    assert.equal(await retainObserverEvent(binding, "self_native_identity", "failed", new Error("replacement")), false);
    assert.equal(JSON.parse(await readFile(path.join(root, "observer-self_native_identity-error.json"), "utf8")).original.message, error.message);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("AC-4BY.2 duplicate, corrupt and filename-mismatched private phase bytes remain unavailable", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "observer-phase-invalid-"));
  try {
    const binding = bindingFor(root);
    const file = path.join(root, "observer-config-entered.json");
    const valid = JSON.stringify(recordFor(binding, "config", "entered"));
    for (const text of ["{", `${valid.slice(0, -1)},"stage":"config"}\n`, `${JSON.stringify(recordFor(binding, "close", "completed"))}\n`]) {
      await writeFile(file, text);
      assert.deepEqual(await readObserverDiagnostic(binding), { stage: "unavailable", event: "unavailable" });
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("AC-4BY.2 R3 existing damaged earlier evidence cannot be masked by later completion or failure", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "observer-mixed-damage-"));
  try {
    const binding = bindingFor(root);
    await retainObserverEvent(binding, "config", "entered");
    await retainObserverEvent(binding, "close", "completed");
    const file = path.join(root, "observer-self_native_identity-failed.json");
    const valid = JSON.stringify(recordFor(binding, "self_native_identity", "failed"));
    for (const text of [
      "{", `${valid.slice(0, -1)},"stage":"self_native_identity"}\n`,
      `${JSON.stringify({ ...recordFor(binding, "self_native_identity", "failed"), nonce: "d".repeat(64) })}\n`,
      `${JSON.stringify(recordFor(binding, "config", "failed"))}\n`, "x".repeat(2049),
    ]) {
      await writeFile(file, text);
      assert.deepEqual(await readObserverDiagnostic(binding), { stage: "unavailable", event: "unavailable" });
    }
    await rm(file);
    assert.deepEqual(await readObserverDiagnostic(binding), { stage: "close", event: "completed" });
    await retainObserverEvent(binding, "activation", "failed", new Error("later private failure"));
    await writeFile(path.join(root, "observer-config-failed.json"), "{");
    assert.deepEqual(await readObserverDiagnostic(binding), { stage: "unavailable", event: "unavailable" });
    // Damage after an otherwise valid earlier failure must also be inspected.
    await rm(path.join(root, "observer-config-failed.json"));
    await writeFile(path.join(root, "observer-consumer_terminal-completed.json"), "{");
    assert.deepEqual(await readObserverDiagnostic(binding), { stage: "unavailable", event: "unavailable" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("AC-4BY.2 R3 held event read bounds actual bytes after a smaller metadata snapshot", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "observer-grown-leaf-"));
  let handle;
  try {
    const file = path.join(root, "leaf.json");
    await writeFile(file, "small");
    handle = await open(file, "r");
    assert.equal((await handle.stat()).size, 5);
    await writeFile(file, "x".repeat(8192));
    assert.equal(await readObserverEventBytes(handle), null);
    await writeFile(file, "x".repeat(2048));
    assert.equal((await readObserverEventBytes(handle)).length, 2048);
    // Independent short-read model counts the actual requested byte budget.
    let requested = 0;
    const grown = { async read(buffer, offset, length) {
      requested += length;
      buffer.fill(120, offset, offset + length);
      return { bytesRead: length };
    } };
    assert.equal(await readObserverEventBytes(grown), null);
    assert.equal(requested, 2049);
  } finally { if (handle) await handle.close(); await rm(root, { recursive: true, force: true }); }
});

test("AC-4BY.2 R1 error result preserves original error while genuine close alone permits channel readback", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "observer-error-close-"));
  try {
    const binding = bindingFor(root);
    for (const name of ["observer-stdout.private.log", "observer-stderr.private.log"]) await writeFile(path.join(root, name), "before close");
    const child = new EventEmitter();
    const witness = observerExitWitness(child, binding);
    const original = new Error("ORIGINAL_PRIVATE_ERROR");
    original.code = "ENOENT";
    let closeObserved = false;
    witness.closed.then(() => { closeObserved = true; });
    child.emit("error", original);
    assert.deepEqual(await witness.result, { exitCode: null, signal: null, spawnError: true });
    assert.equal(closeObserved, false);
    await assert.rejects(access(path.join(root, "observer-channels-close.json")), { code: "ENOENT" });
    assert.equal(JSON.parse(await readFile(path.join(root, "observer-config-error.json"), "utf8")).original.message, original.message);
    assert.equal(original.code, "ENOENT");
    await writeFile(path.join(root, "observer-stderr.private.log"), "actual final bytes");
    child.emit("close", -2, null);
    assert.equal(await witness.readback, true);
    const retained = JSON.parse(await readFile(path.join(root, "observer-channels-close.json"), "utf8"));
    assert.deepEqual(retained.terminal, { exitCode: -2, signal: null, spawnError: true });
    assert.equal(retained.channels[1].sha256, createHash("sha256").update("actual final bytes").digest("hex"));
    assert.equal(retained.observation, "observer_closed_readback");
    assert.equal(original.message, "ORIGINAL_PRIVATE_ERROR");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("AC-4BY.2 R2 eventual private close readback survives invalid terminal, timeout and exceptional settlement", async () => {
  for (const route of ["invalid_terminal", "execution_timeout", "exception"]) {
    const root = await mkdtemp(path.join(os.tmpdir(), `observer-eventual-${route}-`));
    try {
      const child = new EventEmitter();
      const original = new Error("ORIGINAL_EXCEPTION");
      const binding = bindingFor(root);
      for (const name of ["observer-stdout.private.log", "observer-stderr.private.log"]) await writeFile(path.join(root, name), "still live");
      let witness;
      const earlyCaller = async () => {
        witness = observerExitWitness(child, binding);
        if (route === "exception") throw original;
        return { executionFailure: route === "execution_timeout" ? "execution_timeout" : "spawn_failed", trustedUnlock: { classification: route === "execution_timeout" ? "missing" : "invalid" } };
      };
      if (route === "exception") await assert.rejects(earlyCaller(), (error) => error === original);
      else assert.equal((await earlyCaller()).executionFailure, route === "execution_timeout" ? "execution_timeout" : "spawn_failed");
      await assert.rejects(access(path.join(root, "observer-channels-close.json")), { code: "ENOENT" });
      await writeFile(path.join(root, "observer-stdout.private.log"), "eventual complete bytes");
      child.emit("close", 1, null);
      assert.equal(await witness.readback, true);
      const retained = JSON.parse(await readFile(path.join(root, "observer-channels-close.json"), "utf8"));
      assert.deepEqual(retained.terminal, { exitCode: 1, signal: null, spawnError: false });
      assert.equal(retained.channels[0].sha256, createHash("sha256").update("eventual complete bytes").digest("hex"));
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test("AC-4BY.2 R1 real invalid-cwd observer spawn retains failure and eventual genuine close", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "observer-invalid-cwd-"));
  try {
    const observerRoot = path.join(root, "observer");
    const result = await consumeWithDurableObserver(process.execPath, ["never-imported.mjs"], {
      cwd: path.join(root, "absent-cwd"), observerRoot, source, inputs: {}, timeoutMs: 5_000,
      onObserverDiagnostic: () => {},
    });
    assert.equal(result.executionFailure, "spawn_failed");
    assert.deepEqual(result.trustedUnlock, { classification: "missing" });
    const original = JSON.parse(await readFile(path.join(observerRoot, "observer-config-error.json"), "utf8"));
    assert.equal(original.original.code, "ENOENT");
    // The consumer can return on error before close. Observe only persistence;
    // this test's bounded assertion does not establish a product deadline.
    let closed;
    for (let attempt = 0; attempt < 100 && !closed; attempt++) {
      try { closed = JSON.parse(await readFile(path.join(observerRoot, "observer-channels-close.json"), "utf8")); }
      catch (error) { if (error.code !== "ENOENT") throw error; await new Promise((resolve) => setTimeout(resolve, 10)); }
    }
    assert.ok(closed);
    assert.equal(closed.terminal.spawnError, true);
    assert.equal(closed.observation, "observer_closed_readback");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("AC-4BY.2 R2 real invalid initial and timeout returns retain eventual observer channel readback", async () => {
  for (const route of ["invalid_initial", "timeout"]) {
    const root = await mkdtemp(path.join(os.tmpdir(), `observer-real-${route}-`));
    try {
      const observerRoot = path.join(root, "observer"), provider = path.join(root, "provider.mjs");
      const inputs = {
        workspaceRoot: path.join(root, "workspace"),
        instanceRegistryPath: path.join(root, "instances.json"),
        hostPortRegistryPath: path.join(root, "ports.json"),
      };
      // This actual activated provider damages its own initial record. It
      // creates no successful receipt/native identity and changes no validator.
      await writeFile(provider, route === "invalid_initial" ? `
        import { readFile, writeFile } from "node:fs/promises";
        import path from "node:path";
        const file = path.join(process.env.SERVICE_LASSO_ADMIN_PROVIDER_OBSERVER_ROOT, "initial.json");
        const initial = JSON.parse(await readFile(file, "utf8"));
        initial.provider = null;
        await writeFile(file, JSON.stringify(initial) + "\\n");
        process.exitCode = 7;
      ` : "setTimeout(() => process.exit(7), 180);\n");
      const result = await consumeWithDurableObserver(process.execPath, [provider], {
        cwd: root, observerRoot, source, inputs, timeoutMs: route === "timeout" ? 20 : 5_000,
        onObserverDiagnostic: () => {},
      });
      assert.equal(result.executionFailure, route === "timeout" ? "execution_timeout" : "spawn_failed");
      assert.deepEqual(result.trustedUnlock, { classification: route === "timeout" ? "missing" : "invalid" });
      let channels;
      const assertionDeadline = Date.now() + 3_000;
      while (!channels && Date.now() < assertionDeadline) {
        try { channels = JSON.parse(await readFile(path.join(observerRoot, "observer-channels-close.json"), "utf8")); }
        catch (error) { if (error.code !== "ENOENT") throw error; await new Promise((resolve) => setTimeout(resolve, 10)); }
      }
      assert.ok(channels, "genuine eventual observer close must retain channel readback after early return");
      assert.equal(channels.terminal.spawnError, false);
      assert.equal(channels.observation, "observer_closed_readback");
      assert.deepEqual(channels.source, source);
      for (const member of channels.channels) {
        const bytes = await readFile(path.join(observerRoot, member.name));
        assert.equal(bytes.length, member.bytes);
        assert.equal(createHash("sha256").update(bytes).digest("hex"), member.sha256);
      }
      await assert.rejects(access(path.join(observerRoot, "consumer-terminal.json")), { code: "ENOENT" });
    } finally { await rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }); }
  }
});

test("AC-4BY.2 R2 timeout CLI retains its real observer handle until eventual private readback", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "observer-cli-timeout-"));
  try {
    const observerRoot = path.join(root, "observer"), provider = path.join(root, "provider.mjs"), receipt = path.join(root, "consumer.json");
    await writeFile(provider, "setTimeout(() => process.exit(7), 180);\n");
    const consumer = fileURLToPath(new URL("../scripts/consume-admin-trusted-unlock-receipt.mjs", import.meta.url));
    const child = spawn(process.execPath, [consumer, "--receipt", receipt, "--", process.execPath, provider], {
      cwd: root, stdio: "ignore", windowsHide: true,
      env: { ...process.env,
        SERVICE_LASSO_ADMIN_RECEIPT_OBSERVER_ROOT: observerRoot,
        SERVICE_LASSO_TEST_SOURCE_HEAD: source.head, SERVICE_LASSO_TEST_SOURCE_TREE: source.tree,
        SERVICE_LASSO_WORKSPACE_ROOT: path.join(root, "workspace"),
        SERVICE_LASSO_INSTANCE_REGISTRY_PATH: path.join(root, "instances.json"),
        SERVICE_LASSO_HOST_PORT_REGISTRY_PATH: path.join(root, "ports.json"),
        SERVICE_LASSO_ADMIN_RECEIPT_TIMEOUT_MS: "20",
      },
    });
    const terminal = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    assert.deepEqual(terminal, { code: 1, signal: null });
    const result = JSON.parse(await readFile(receipt, "utf8"));
    assert.equal(result.executionFailure, "execution_timeout");
    assert.deepEqual(result.trustedUnlock, { classification: "missing" });
    // No polling after CLI exit: its natural terminal boundary must already
    // include readback, rather than abandoning a detached live continuation.
    const channels = JSON.parse(await readFile(path.join(observerRoot, "observer-channels-close.json"), "utf8"));
    assert.equal(channels.observation, "observer_closed_readback");
    assert.equal(channels.terminal.spawnError, false);
    await assert.rejects(access(path.join(observerRoot, "consumer-terminal.json")), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }); }
});

test("AC-4BY.2 actual observer config rejection retains private original channels without claiming OS spawn failure", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "observer-config-rejection-"));
  try {
    const observerRoot = path.join(root, "observer");
    const observed = [];
    const result = await consumeWithDurableObserver(process.execPath, ["never-imported.mjs"], {
      cwd: root, observerRoot, source, inputs: {}, timeoutMs: 5_000,
      onObserverDiagnostic: (value) => observed.push(value),
    });
    // Preserve the existing failed consumer contract. The actual closed stage
    // distinguishes this setup rejection from any inferred OS spawn cause.
    assert.equal(result.executionFailure, "spawn_failed");
    assert.equal(result.code, null);
    assert.deepEqual(result.trustedUnlock, { classification: "missing" });
    assert.deepEqual(observed, [{ stage: "config", event: "failed" }]);
    const original = JSON.parse(await readFile(path.join(observerRoot, "observer-config-error.json"), "utf8"));
    assert.equal(original.original.message, "observer_runtime_inputs_invalid");
    assert.deepEqual(original.source, source);
    const closed = JSON.parse(await readFile(path.join(observerRoot, "observer-channels-close.json"), "utf8"));
    assert.deepEqual(closed.source, source);
    assert.equal(closed.nonce, original.nonce);
    assert.equal(closed.terminal.spawnError, false);
    assert.equal(closed.terminal.exitCode > 0, true);
    assert.equal(closed.observation, "observer_closed_readback");
    for (const member of closed.channels) {
      const bytes = await readFile(path.join(observerRoot, member.name));
      assert.equal(bytes.length, member.bytes);
      assert.equal(createHash("sha256").update(bytes).digest("hex"), member.sha256);
    }
    assert.match(await readFile(path.join(observerRoot, "observer-stderr.private.log"), "utf8"), /observer_runtime_inputs_invalid/u);
    assert.doesNotMatch(JSON.stringify(observed), /observer_runtime_inputs_invalid|nonce|head|tree|path|pid/iu);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("AC-4BY.2 an actual pre-plan image lookup failure cannot manufacture provider launch or activation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "observer-image-rejection-"));
  try {
    const observerRoot = path.join(root, "observer");
    const observed = [];
    const result = await consumeWithDurableObserver(path.join(root, "absent-node-image"), ["never-imported.mjs"], {
      cwd: root, observerRoot, source, timeoutMs: 5_000,
      inputs: { workspaceRoot: path.join(root, "workspace"), instanceRegistryPath: path.join(root, "instances.json"), hostPortRegistryPath: path.join(root, "ports.json") },
      onObserverDiagnostic: (value) => observed.push(value),
    });
    assert.equal(result.code, null);
    assert.equal(result.executionFailure, "spawn_failed");
    assert.deepEqual(observed, [{ stage: "self_native_identity", event: "failed" }]);
    const original = JSON.parse(await readFile(path.join(observerRoot, "observer-self_native_identity-error.json"), "utf8"));
    assert.equal(original.original.code, "ENOENT");
    for (const name of ["plan.json", "initial.json", "activation.json", "close.json", "observer-provider_spawn-entered.json"]) {
      await assert.rejects(access(path.join(observerRoot, name)), { code: "ENOENT" });
    }
    assert.doesNotMatch(JSON.stringify(observed), /absent-node-image|nonce|path|pid/iu);
  } finally { await rm(root, { recursive: true, force: true }); }
});
