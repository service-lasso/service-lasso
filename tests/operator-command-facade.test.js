import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
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
    assert.equal(response.body.audit.source, "api");
    assert.equal(response.body.audit.command, "services");
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

test("operator command facade records trusted chat actor audit metadata", async () => {
  resetLifecycleState();
  const previousToken = process.env.SERVICE_LASSO_CHAT_BRIDGE_TOKEN;
  process.env.SERVICE_LASSO_CHAT_BRIDGE_TOKEN = "SERVICE_LASSO_TEST_BRIDGE_TOKEN";
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-operator-command-audit-");
  await writeExecutableFixtureService(servicesRoot, "alpha-service");
  const apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot });

  try {
    const response = await postJson(
      apiServer.url + "/api/operator/commands",
      {
        command: "service alpha-service status",
        actor: {
          source: "chat-bridge",
          channel: "telegram",
          chatId: "-5128051597",
          senderId: "42",
          senderDisplay: "Operator",
          sourceMessageId: "1001",
          roles: ["operator"],
        },
      },
      { "x-service-lasso-chat-bridge-token": "SERVICE_LASSO_TEST_BRIDGE_TOKEN" },
    );

    assert.equal(response.status, 200);
    assert.equal(response.body.audit.source, "chat-bridge");
    assert.equal(response.body.audit.channel, "telegram");
    assert.equal(response.body.audit.chatId, "-5128051597");
    assert.equal(response.body.audit.senderId, "42");
    assert.equal(response.body.audit.actorId, "telegram:42");
    assert.equal(response.body.audit.command, "service.status");
    assert.equal(response.body.audit.targetServiceId, "alpha-service");

    const auditLog = await readFile(path.join(workspaceRoot, ".state", "operator-command-audit.jsonl"), "utf8");
    const events = auditLog.trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], response.body.audit);
    assert.equal(JSON.stringify(events[0]).includes("SERVICE_LASSO_TEST_BRIDGE_TOKEN"), false);
  } finally {
    await apiServer.stop();
    if (previousToken === undefined) {
      delete process.env.SERVICE_LASSO_CHAT_BRIDGE_TOKEN;
    } else {
      process.env.SERVICE_LASSO_CHAT_BRIDGE_TOKEN = previousToken;
    }
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("operator command facade rejects untrusted chat bridge actor metadata", async () => {
  resetLifecycleState();
  const previousToken = process.env.SERVICE_LASSO_CHAT_BRIDGE_TOKEN;
  delete process.env.SERVICE_LASSO_CHAT_BRIDGE_TOKEN;
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-operator-command-untrusted-");
  await writeExecutableFixtureService(servicesRoot, "alpha-service");
  const apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot });

  try {
    const response = await postJson(apiServer.url + "/api/operator/commands", {
      command: "services",
      actor: {
        source: "chat-bridge",
        channel: "telegram",
        chatId: "-5128051597",
        senderId: "42",
        roles: ["operator"],
      },
    });

    assert.equal(response.status, 403);
    assert.equal(response.body.error, "untrusted_chat_bridge");
  } finally {
    await apiServer.stop();
    if (previousToken === undefined) {
      delete process.env.SERVICE_LASSO_CHAT_BRIDGE_TOKEN;
    } else {
      process.env.SERVICE_LASSO_CHAT_BRIDGE_TOKEN = previousToken;
    }
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("operator command facade rejects secret-like actor metadata without auditing it", async () => {
  resetLifecycleState();
  const previousToken = process.env.SERVICE_LASSO_CHAT_BRIDGE_TOKEN;
  process.env.SERVICE_LASSO_CHAT_BRIDGE_TOKEN = "SERVICE_LASSO_TEST_BRIDGE_TOKEN";
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-operator-command-actor-secret-");
  await writeExecutableFixtureService(servicesRoot, "alpha-service");
  const apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot });

  try {
    const response = await postJson(
      apiServer.url + "/api/operator/commands",
      {
        command: "services",
        actor: {
          source: "chat-bridge",
          channel: "telegram",
          chatId: "-5128051597",
          senderId: "42",
          senderDisplay: "token=SERVICE_LASSO_FAKE_SECRET_SENTINEL_ACTOR_DO_NOT_USE",
          roles: ["operator"],
        },
      },
      { "x-service-lasso-chat-bridge-token": "SERVICE_LASSO_TEST_BRIDGE_TOKEN" },
    );

    assert.equal(response.status, 400);
    assert.equal(response.body.error, "invalid_actor");
    assert.equal(JSON.stringify(response.body).includes("SERVICE_LASSO_FAKE_SECRET_SENTINEL_ACTOR_DO_NOT_USE"), false);
    await assert.rejects(
      readFile(path.join(workspaceRoot, ".state", "operator-command-audit.jsonl"), "utf8"),
      /ENOENT/,
    );
  } finally {
    await apiServer.stop();
    if (previousToken === undefined) {
      delete process.env.SERVICE_LASSO_CHAT_BRIDGE_TOKEN;
    } else {
      process.env.SERVICE_LASSO_CHAT_BRIDGE_TOKEN = previousToken;
    }
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
