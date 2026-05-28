import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return {
    status: response.status,
    body: await response.json(),
  };
}

test("operator command facade lists services without leaking environment values", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-operator-command-services-");
  await writeExecutableFixtureService(servicesRoot, "alpha-service", {
    env: {
      SECRET_TOKEN: "SERVICE_LASSO_FAKE_SECRET_SENTINEL_OPERATOR_COMMAND_DO_NOT_USE",
    },
    ports: {
      service: 43210,
    },
  });
  const apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot, version: "operator-command-test" });

  try {
    const response = await postJson(apiServer.url + "/api/operator/commands", {
      command: "services",
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.contractVersion, "operator-command.v1");
    assert.equal(response.body.ok, true);
    assert.equal(response.body.command, "services");
    assert.equal(response.body.commandClass, "read");
    assert.equal(response.body.data.services.length, 1);
    assert.equal(response.body.data.services[0].id, "alpha-service");
    assert.ok(response.body.data.services[0].envKeyCount >= 1);
    assert.equal(JSON.stringify(response.body).includes("SERVICE_LASSO_FAKE_SECRET_SENTINEL_OPERATOR_COMMAND_DO_NOT_USE"), false);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("operator command facade returns bounded redacted log tails", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-operator-command-logs-");
  const { serviceRoot } = await writeExecutableFixtureService(servicesRoot, "alpha-service");
  const logRoot = path.join(serviceRoot, "logs", "runtime");
  await mkdir(logRoot, { recursive: true });
  await writeFile(
    path.join(logRoot, "service.log"),
    [
      "ordinary startup line",
      "token=SERVICE_LASSO_FAKE_SECRET_SENTINEL_OPERATOR_COMMAND_LOG_DO_NOT_USE",
      "ordinary ready line",
    ].join("\n"),
  );
  const apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot });

  try {
    const response = await postJson(apiServer.url + "/api/operator/commands", {
      command: "service alpha-service logs --tail 2",
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.command, "service.logs.tail");
    assert.equal(response.body.data.returnedLines, 2);
    assert.deepEqual(response.body.data.lines, [
      "token=[REDACTED]",
      "ordinary ready line",
    ]);
    assert.equal(response.body.safety.redacted, true);
    assert.equal(JSON.stringify(response.body).includes("SERVICE_LASSO_FAKE_SECRET_SENTINEL_OPERATOR_COMMAND_LOG_DO_NOT_USE"), false);

    const unbounded = await postJson(apiServer.url + "/api/operator/commands", {
      command: "service alpha-service logs --tail 1000",
    });
    assert.equal(unbounded.status, 400);
    assert.equal(unbounded.body.error.code, "invalid_log_tail");
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("operator command facade blocks mutating commands and reports stable service errors", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-operator-command-blocked-");
  await writeExecutableFixtureService(servicesRoot, "alpha-service");
  const apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot });

  try {
    const restart = await postJson(apiServer.url + "/api/operator/commands", {
      command: "restart alpha-service",
    });
    assert.equal(restart.status, 400);
    assert.equal(restart.body.ok, false);
    assert.equal(restart.body.commandClass, "blocked");
    assert.equal(restart.body.error.code, "mutating_command_blocked");
    assert.equal(restart.body.safety.mutating, false);

    const missing = await postJson(apiServer.url + "/api/operator/commands", {
      command: "service missing-service status",
    });
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, "service_not_found");
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
