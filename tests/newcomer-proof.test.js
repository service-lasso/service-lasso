import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeEvidence } from "../scripts/newcomer-proof.mjs";

test("newcomer proof receipts redact sensitive fields and private paths", () => {
  const receipt = sanitizeEvidence({
    token: "secret-token",
    workspaceRoot: "C:\\Users\\operator\\private-proof",
    nested: { password: "nope", message: "token=abc /home/operator/evidence" },
  });
  assert.deepEqual(receipt, { workspaceRoot: "<local-path>", nested: { message: "token=<redacted> <local-path>" } });
});
