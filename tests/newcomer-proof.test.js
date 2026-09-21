import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeEvidence, ensureServiceStarted, ownedRuntimePortEnvironment } from "../scripts/newcomer-proof.mjs";

test("owned runtime range includes the port wired into Admin's upstream", () => {
  assert.deepEqual(ownedRuntimePortEnvironment(21480), {
    SERVICE_LASSO_PORT_RANGE_START: "21480",
    SERVICE_LASSO_PORT_RANGE_END: "21639",
  });
});

test("bootstrap does not start an already-running service again", async () => {
  const calls = [];
  await ensureServiceStarted("http://127.0.0.1:21000", "@serviceadmin", async (url, options) => {
    calls.push([url, options.method ?? "GET"]);
    return Response.json({ service: { lifecycle: { running: true } } });
  });
  assert.deepEqual(calls, [["http://127.0.0.1:21000/api/services/%40serviceadmin", "GET"]]);
});

test("bootstrap starts a stopped service and rejects start failures", async () => {
  const methods = [];
  await assert.rejects(ensureServiceStarted("http://127.0.0.1:21000", "echo-service", async (_url, options) => {
    methods.push(options.method ?? "GET");
    return options.method === "POST" ? new Response("", { status: 409 }) : Response.json({ service: { lifecycle: { running: false } } });
  }), /returned 409/);
  assert.deepEqual(methods, ["GET", "POST"]);
});

test("bootstrap rejects absent lifecycle state instead of assuming success", async () => {
  await assert.rejects(ensureServiceStarted("http://127.0.0.1:21000", "echo-service", async () => Response.json({})), /Missing lifecycle state/);
});

test("newcomer proof receipts redact sensitive fields and private paths", () => {
  const receipt = sanitizeEvidence({
    token: "secret-token",
    workspaceRoot: "C:\\Users\\operator\\private-proof",
    nested: { password: "nope", message: "token=abc /home/operator/evidence" },
  });
  assert.deepEqual(receipt, { workspaceRoot: "<local-path>", nested: { message: "token=<redacted> <local-path>" } });
});
