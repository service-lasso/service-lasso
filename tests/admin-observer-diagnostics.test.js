import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { consumeWithDurableObserver } from "../scripts/consume-admin-trusted-unlock-receipt.mjs";
import { OBSERVER_STAGES, projectObserverEvent, readObserverDiagnostic, retainObserverEvent } from "../scripts/admin-observer-diagnostics.mjs";

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
