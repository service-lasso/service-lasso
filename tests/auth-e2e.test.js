import test from "node:test";
import assert from "node:assert/strict";
import { runAuthE2e } from "../scripts/verify-auth-e2e.mjs";

test("HTTP e2e proves loopback local-root, first-run copy gate, and remote local-operator login (AC-5I, AC-5J)", async () => {
  const result = await runAuthE2e();
  assert.equal(result.ok, true);
  assert.ok(result.checks >= 16, "auth e2e must cover the SPEC-005 HTTP matrix including first-run");
});
