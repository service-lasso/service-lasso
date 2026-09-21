import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { collectStartupFailure, retainStartupFailure } from "../scripts/newcomer-runtime-diagnostics.mjs";

const failed = { service: { lifecycle: { runtime: { startTrace: { current: {
  status: "failed", message: "PRIVATE", events: [{ phase: "process_spawn", status: "failed", metadata: { processStartFailurePhase: "initial_tree_inspection", password: "PRIVATE" } }],
} } } } }, token: "PRIVATE" };
const response = body => ({ ok: true, status: 200, json: async () => body });

test("newcomer snapshot targets only the named owned service with read-only requests and closed metadata", async () => {
  const result = await collectStartupFailure("http://127.0.0.1:21480/", "@nginx", { request: async (url, options) => {
    assert.equal(url, "http://127.0.0.1:21480/api/services/%40nginx");
    assert.equal(options.method, "GET");
    assert.ok(options.signal instanceof AbortSignal);
    return response(failed);
  } });
  assert.equal(result.observations.length, 1);
  assert.equal(result.observations[0].events[0].failurePhase, "initial_tree_inspection");
  assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
});

test("newcomer snapshot observes an eventual server failure without replaying a mutation", async () => {
  let calls = 0;
  const started = Date.now();
  const result = await collectStartupFailure("http://127.0.0.1:21480", "echo-service", { request: async () => {
    calls++;
    return response(Date.now() - started < 900 ? {} : failed);
  } });
  assert.equal(calls, 2);
  assert.equal(result.observations[1].attemptStatus, "failed");
});

test("newcomer snapshot is bounded even when request or response body ignores cancellation", async () => {
  for (const request of [() => new Promise(() => {}), async () => ({ ok: true, json: () => new Promise(() => {}) })]) {
    const started = Date.now();
    const result = await collectStartupFailure("http://127.0.0.1:21480", "@nginx", { request, budgetMs: 20 });
    assert.ok(Date.now() - started < 1000);
    assert.equal(result.observations[0].diagnostic, "metadata_unavailable");
    assert.ok(result.observations.length <= 3);
  }
});

test("unavailable or malformed responses remain closed and collection has at most three reads", async () => {
  let calls = 0;
  const result = await collectStartupFailure("http://127.0.0.1:21480", "@nginx", { request: async () => {
    calls++;
    throw new Error("PRIVATE");
  } });
  assert.equal(calls, 3);
  assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
  const malformed = await collectStartupFailure("http://127.0.0.1:21480", "@nginx", { request: async () => response({ service: { lifecycle: { get runtime() { throw new Error("PRIVATE"); } } } }), budgetMs: 1 });
  assert.equal(JSON.stringify(malformed).includes("PRIVATE"), false);
});

test("invalid targets never send requests and diagnostic persistence failure does not escape", async () => {
  const request = async () => { assert.fail("invalid target requested"); };
  for (const url of [undefined, "http://external.invalid", "http://private:secret@127.0.0.1", "https://127.0.0.1"]) await collectStartupFailure(url, "@nginx", { request });
  await collectStartupFailure("http://127.0.0.1", "PRIVATE", { request });
  await assert.doesNotReject(retainStartupFailure(undefined, "@nginx", async () => { throw new Error("disk unavailable"); }));
});

test("runner retains diagnostics outside bundle after invalidation and before owned cleanup", async () => {
  const runner = await readFile(new URL("../scripts/newcomer-proof.mjs", import.meta.url), "utf8");
  assert.match(runner, /path.join\(proofRoot, "private-startup-diagnostic.json"\)/);
  assert.ok(runner.indexOf('receipt.status = "Invalidated"') < runner.indexOf("await retainStartupFailure"));
  assert.ok(runner.indexOf("await retainStartupFailure") < runner.indexOf("const cleanup = await cleanupWorktreeProof"));
  assert.match(runner, /signal: AbortSignal.timeout\(30_000\)/);
});
