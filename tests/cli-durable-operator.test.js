import test from "node:test";
import assert from "node:assert/strict";
import { runDurableOperator } from "../dist/runtime/cli/durable-operator.js";

const env = { SERVICE_LASSO_OPERATOR_API_URL: "http://127.0.0.1:43199", SERVICE_LASSO_OPERATOR_TOKEN: "test-token" };

function response(status, body) {
  return { status, async json() { return body; } };
}

function fixture(options = {}) {
  const calls = [];
  let submissions = 0;
  const fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ path, body, authorization: init.headers?.authorization });
    if (path.endsWith("/availability")) return response(200, { contractVersion: "service-lasso-durable-lifecycle-operation.v1", actions: [{ action: "start", available: true }] });
    if (path === "/api/operator/lifecycle/operations" && !body?.execute) return response(200, { confirmation: { id: "mcp-confirmation-00000000-0000-0000-0000-000000000000", confirmationPhrase: "server phrase never emitted" } });
    if (path === "/api/operator/lifecycle/operations" && body?.execute) { submissions += 1; return response(202, { accepted: true, operation: { operationId: "mcp-operation-1" } }); }
    if (path === "/api/operator/lifecycle/operations/mcp-operation-1") return response(200, { operation: { operationId: "mcp-operation-1", outcome: options.outcome ?? null } });
    if (path.endsWith("/cancel")) return response(options.cancelStatus ?? 200, options.cancelBody ?? { cancellation: { result: "too_late" } });
    return response(401, { error: "authorization_required" });
  };
  return { fetch, calls, submissions: () => submissions };
}

test("durable CLI gates on the reviewed capability and submits one confirmed effect", async () => {
  const api = fixture();
  const value = await runDurableOperator({ command: "start", serviceId: "service-a", idempotencyKey: "cli-key-0001", confirm: true, env, fetch: api.fetch });
  assert.equal(value.status, "accepted");
  assert.equal(value.operationId, "mcp-operation-1");
  assert.equal(api.submissions(), 1);
  assert.equal(JSON.stringify(value).includes("server phrase never emitted"), false);
  assert.equal(api.calls.every((call) => call.authorization === "Bearer test-token"), true);
});

test("durable CLI refuses mutation without explicit local confirmation", async () => {
  const api = fixture();
  const value = await runDurableOperator({ command: "start", serviceId: "service-a", idempotencyKey: "cli-key-0001", env, fetch: api.fetch });
  assert.equal(value.status, "rejected");
  assert.equal(api.calls.length, 0);
});

test("durable CLI reports a server rejection without printing response detail", async () => {
  const fetch = async () => response(403, { error: "forbidden", detail: "https://secret.invalid/path" });
  const value = await runDurableOperator({ command: "available-actions", serviceId: "service-a", env, fetch });
  assert.equal(value.status, "unsupported");
  assert.equal(JSON.stringify(value).includes("secret.invalid"), false);
});

test("durable CLI maps terminal, bounded wait, and cancellation states honestly", async () => {
  const succeeded = await runDurableOperator({ command: "inspect", operationId: "mcp-operation-1", env, fetch: fixture({ outcome: "succeeded" }).fetch });
  assert.equal(succeeded.status, "succeeded");
  const waiting = await runDurableOperator({ command: "wait", operationId: "mcp-operation-1", waitMs: 1, env, fetch: fixture().fetch });
  assert.equal(waiting.status, "timeout");
  const cancel = await runDurableOperator({ command: "cancel", operationId: "mcp-operation-1", env, fetch: fixture().fetch });
  assert.equal(cancel.status, "accepted");
});

test("durable CLI does not infer cancellation or resubmit after a transport failure", async () => {
  let calls = 0;
  const fetch = async () => { calls += 1; throw new Error("network down"); };
  const value = await runDurableOperator({ command: "start", serviceId: "service-a", idempotencyKey: "cli-key-0001", confirm: true, env, fetch });
  assert.equal(value.status, "uncertain");
  assert.equal(calls, 1);
});
