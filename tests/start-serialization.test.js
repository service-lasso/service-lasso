import test from "node:test";
import assert from "node:assert/strict";
import { withServiceStartSerialization as serialize } from "../dist/runtime/lifecycle/start-serialization.js";

test("same-root calls serialize, nested calls reenter, and independent roots proceed", async () => {
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { entered = resolve; });
  const events = [];
  const a = serialize("fixture-a/service", async () => { entered(); await serialize("fixture-a/service", async () => { events.push("nested"); }); await gate; events.push("a"); });
  await ready;
  const b = serialize("fixture-a/service", async () => { events.push("b"); });
  await serialize("fixture-b/service", async () => { events.push("independent"); });
  assert.deepEqual(events, ["nested", "independent"]);
  release(); await Promise.all([a, b]);
  assert.deepEqual(events, ["nested", "independent", "a", "b"]);
});

test("failed work releases the root for subsequent callers", async () => {
  await assert.rejects(serialize("fixture-failed/service", async () => { throw new Error("expected"); }), /expected/);
  assert.equal(await serialize("fixture-failed/service", async () => 42), 42);
});
