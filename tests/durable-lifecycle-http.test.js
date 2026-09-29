import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import { makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";

async function lifecycleRequest(apiServer, path, method = "GET", body) {
  const response = await fetch(`${apiServer.url}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test("#1465 durable lifecycle HTTP operations preserve confirmation, idempotency, readback, and safe cancellation", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-durable-lifecycle-http-");
  let apiServer;
  try {
    await writeExecutableFixtureService(servicesRoot, "durable-http-service", { autoExitMs: 500 });
    apiServer = await startApiServer({
      port: 0,
      servicesRoot,
      workspaceRoot,
      mcpHttpIdentity: { env: { SERVICE_LASSO_MCP_MODE: "guarded" } },
    });

    const availability = await lifecycleRequest(
      apiServer,
      "/api/operator/lifecycle/services/durable-http-service/availability",
    );
    assert.equal(availability.status, 200);
    assert.equal(availability.body.contractVersion, "service-lasso-durable-lifecycle-operation.v1");
    assert.equal(availability.body.actions.find((entry) => entry.action === "start").available, true);
    assert.deepEqual(availability.body.actions.find((entry) => entry.action === "reload"), {
      action: "reload",
      available: false,
      reason: "durable_operation_unavailable",
      permission: "service-lasso:lifecycle:write",
      requiresConfirmation: true,
    });

    const denied = await lifecycleRequest(apiServer, "/api/operator/lifecycle/operations", "POST", {
      action: "start",
      serviceId: "durable-http-service",
      execute: true,
      idempotencyKey: "durable-http-key-0001",
    });
    assert.equal(denied.status, 409);
    assert.equal(denied.body.error, "confirmation_required");

    const plan = await lifecycleRequest(apiServer, "/api/operator/lifecycle/operations", "POST", {
      action: "start",
      serviceId: "durable-http-service",
    });
    assert.equal(plan.status, 200);
    assert.equal(plan.body.confirmation.status, "pending");

    const execute = {
      action: "start",
      serviceId: "durable-http-service",
      execute: true,
      idempotencyKey: "durable-http-key-0001",
      confirmationId: plan.body.confirmation.id,
      confirmationPhrase: plan.body.confirmation.confirmationPhrase,
    };
    assert.equal(typeof execute.confirmationId, "string");
    assert.equal(typeof execute.confirmationPhrase, "string");
    const accepted = await lifecycleRequest(apiServer, "/api/operator/lifecycle/operations", "POST", execute);
    assert.equal(accepted.status, 202);
    assert.equal(accepted.body.accepted, true);
    assert.match(accepted.body.operation.operationId, /^mcp-operation-/u);
    assert.equal(accepted.body.operation.cancellationSupported, false);

    const replay = await lifecycleRequest(apiServer, "/api/operator/lifecycle/operations", "POST", execute);
    assert.equal(replay.status, 202);
    assert.equal(replay.body.operation.operationId, accepted.body.operation.operationId);

    let status;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      status = await lifecycleRequest(apiServer, `/api/operator/lifecycle/operations/${accepted.body.operation.operationId}`);
      if (status.body.operation.outcome !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(status.status, 200);
    assert.equal(status.body.operation.action, "service_start");
    assert.equal(status.body.operation.outcome, "succeeded");
    assert.equal(JSON.stringify(status.body).includes(tempRoot), false);

    const cancelled = await lifecycleRequest(apiServer, `/api/operator/lifecycle/operations/${accepted.body.operation.operationId}/cancel`, "POST", {});
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.cancellation.result, "too_late");

    const changedKey = await lifecycleRequest(apiServer, "/api/operator/lifecycle/operations", "POST", {
      ...execute,
      action: "stop",
    });
    assert.equal(changedKey.status, 409);
    assert.equal(changedKey.body.error, "idempotency_conflict");

    await apiServer.stop();
    apiServer = await startApiServer({
      port: 0,
      servicesRoot,
      workspaceRoot,
      mcpHttpIdentity: { env: { SERVICE_LASSO_MCP_MODE: "guarded" } },
    });
    const afterRestart = await lifecycleRequest(apiServer, `/api/operator/lifecycle/operations/${accepted.body.operation.operationId}`);
    assert.equal(afterRestart.status, 200);
    assert.equal(afterRestart.body.operation.operationId, accepted.body.operation.operationId);
    assert.equal(afterRestart.body.operation.outcome, "succeeded");
  } finally {
    await apiServer?.stop().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await rm(tempRoot, { recursive: true, force: true });
  }
});
