import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { verifyPairIsolation } from "../scripts/newcomer-pair.mjs";
import { createPairCheckpoint } from "../scripts/newcomer-pair-checkpoint.mjs";

const a = { commit: "same", servicesRoot: "a", workspaceRoot: "aw", corePid: 1, runtimeUrl: "a-core", adminUrl: "a-admin", appUrl: "a-app", appCoreUrl: "a-app-core", start: 21000, end: 21159 };
const b = { commit: "same", servicesRoot: "b", workspaceRoot: "bw", corePid: 2, runtimeUrl: "b-core", adminUrl: "b-admin", appUrl: "b-app", appCoreUrl: "b-app-core", start: 21160, end: 21319 };
test("pair rejects shared identity, roots, endpoints and lease overlap", () => {
  verifyPairIsolation(a, b);
  for (const field of ["servicesRoot", "workspaceRoot", "corePid", "runtimeUrl", "adminUrl", "appUrl", "appCoreUrl"]) assert.throws(() => verifyPairIsolation(a, { ...b, [field]: a[field] }));
  assert.throws(() => verifyPairIsolation(a, { ...b, commit: "other" }));
  assert.throws(() => verifyPairIsolation(a, { ...b, start: 21159 }));
});
test("early coordinator abort is retained rather than losing the cleanup signal", async () => {
  const channel = new EventEmitter(); channel.connected = true;
  const checkpoint = createPairCheckpoint(channel);
  channel.emit("message", { stage: "allow-cleanup" });
  await assert.rejects(checkpoint.wait(a), /aborted/);
  checkpoint.dispose();
  assert.equal(channel.listenerCount("message"), 0);
});
test("checkpoint holds cleanup until its coordinator releases it", async () => {
  const channel = new EventEmitter(); channel.connected = true;
  channel.send = message => { assert.equal(message.stage, "browser-complete"); queueMicrotask(() => channel.emit("message", { stage: "allow-cleanup" })); };
  const checkpoint = createPairCheckpoint(channel);
  await checkpoint.wait(a);
  checkpoint.dispose();
});
