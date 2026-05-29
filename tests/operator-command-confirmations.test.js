import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile, rm } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import { getLifecycleState, resetLifecycleState, setLifecycleState } from "../dist/runtime/lifecycle/store.js";
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

function chatActor(senderId = "42") {
  return {
    source: "chat-bridge",
    channel: "telegram",
    chatId: "-5128051597",
    senderId,
    senderDisplay: "Operator",
    sourceMessageId: "2001",
    roles: ["operator"],
  };
}

function safePlan() {
  return {
    dryRun: true,
    action: "restart",
    serviceId: "alpha-service",
    generatedAt: "2026-05-29T00:00:00.000Z",
    steps: [
      {
        serviceId: "alpha-service",
        action: "restart",
        status: "would_run",
      },
    ],
  };
}

async function withApiServer(prefix, fn) {
  resetLifecycleState();
  const previousToken = process.env.SERVICE_LASSO_CHAT_BRIDGE_TOKEN;
  process.env.SERVICE_LASSO_CHAT_BRIDGE_TOKEN = "SERVICE_LASSO_TEST_BRIDGE_TOKEN";
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot(prefix);
  await writeExecutableFixtureService(servicesRoot, "alpha-service");
  const apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot });

  try {
    await fn({ apiServer, workspaceRoot });
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
}

test("operator command confirmations issue and confirm with the same trusted chat actor", async () => {
  await withApiServer("service-lasso-command-confirmation-success-", async ({ apiServer, workspaceRoot }) => {
    const issued = await postJson(
      apiServer.url + "/api/operator/confirmations",
      {
        command: "restart alpha-service",
        actor: chatActor(),
        planId: "restart-plan-1",
        plan: safePlan(),
      },
      { "x-service-lasso-chat-bridge-token": "SERVICE_LASSO_TEST_BRIDGE_TOKEN" },
    );

    assert.equal(issued.status, 201);
    assert.equal(issued.body.ok, true);
    assert.equal(issued.body.confirmation.status, "pending");
    assert.equal(issued.body.confirmation.command, "restart");
    assert.equal(issued.body.confirmation.targetServiceId, "alpha-service");
    assert.equal(issued.body.confirmationPhrase, "confirm restart alpha-service");
    assert.equal("confirmationPhrase" in issued.body.confirmation, false);

    const confirmed = await postJson(
      apiServer.url + `/api/operator/confirmations/${encodeURIComponent(issued.body.confirmation.id)}/confirm`,
      {
        actor: chatActor(),
        plan: safePlan(),
        confirmationPhrase: issued.body.confirmationPhrase,
      },
      { "x-service-lasso-chat-bridge-token": "SERVICE_LASSO_TEST_BRIDGE_TOKEN" },
    );

    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.ok, true);
    assert.equal(confirmed.body.confirmation.status, "confirmed");
    assert.equal(confirmed.body.confirmation.confirmedAt !== null, true);
    assert.equal("confirmationPhrase" in confirmed.body.confirmation, false);

    const store = JSON.parse(await readFile(path.join(workspaceRoot, ".state", "operator-command-confirmations.json"), "utf8"));
    assert.equal(store.records.length, 1);
    assert.equal(store.records[0].confirmationPhrase, "confirm restart alpha-service");
    assert.equal(store.records[0].status, "confirmed");

    const auditLog = await readFile(path.join(workspaceRoot, ".state", "operator-command-confirmation-audit.jsonl"), "utf8");
    const events = auditLog.trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(events.map((event) => event.event), ["issued", "confirmed"]);
    assert.equal(events.every((event) => event.actorId === "telegram:42"), true);
    assert.equal(JSON.stringify({ issued, confirmed, events }).includes("SERVICE_LASSO_TEST_BRIDGE_TOKEN"), false);
  });
});

test("operator command confirmations deny actor mismatch and capability drift", async () => {
  await withApiServer("service-lasso-command-confirmation-deny-", async ({ apiServer, workspaceRoot }) => {
    const issueBody = {
      command: "restart alpha-service",
      actor: chatActor(),
      planId: "restart-plan-2",
      plan: safePlan(),
    };
    const headers = { "x-service-lasso-chat-bridge-token": "SERVICE_LASSO_TEST_BRIDGE_TOKEN" };

    const actorMismatchIssued = await postJson(apiServer.url + "/api/operator/confirmations", issueBody, headers);
    const actorMismatch = await postJson(
      apiServer.url + `/api/operator/confirmations/${encodeURIComponent(actorMismatchIssued.body.confirmation.id)}/confirm`,
      {
        actor: chatActor("99"),
        plan: safePlan(),
        confirmationPhrase: actorMismatchIssued.body.confirmationPhrase,
      },
      headers,
    );

    assert.equal(actorMismatch.status, 403);
    assert.equal(actorMismatch.body.error, "actor_mismatch");

    const driftIssued = await postJson(
      apiServer.url + "/api/operator/confirmations",
      { ...issueBody, planId: "restart-plan-3" },
      headers,
    );
    const current = getLifecycleState("alpha-service");
    setLifecycleState("alpha-service", {
      ...current,
      installed: true,
    });

    const drift = await postJson(
      apiServer.url + `/api/operator/confirmations/${encodeURIComponent(driftIssued.body.confirmation.id)}/confirm`,
      {
        actor: chatActor(),
        plan: safePlan(),
        confirmationPhrase: driftIssued.body.confirmationPhrase,
      },
      headers,
    );

    assert.equal(drift.status, 409);
    assert.equal(drift.body.error, "capability_drift");

    const auditLog = await readFile(path.join(workspaceRoot, ".state", "operator-command-confirmation-audit.jsonl"), "utf8");
    const events = auditLog.trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(events.some((event) => event.event === "denied" && event.errorCode === "actor_mismatch"), true);
    assert.equal(events.some((event) => event.event === "denied" && event.errorCode === "capability_drift"), true);
  });
});

test("operator command confirmations reject unsafe plans before audit persistence", async () => {
  await withApiServer("service-lasso-command-confirmation-unsafe-", async ({ apiServer, workspaceRoot }) => {
    const response = await postJson(
      apiServer.url + "/api/operator/confirmations",
      {
        command: "restart alpha-service",
        actor: chatActor(),
        planId: "restart-plan-unsafe",
        plan: {
          dryRun: true,
          detail: "token=SERVICE_LASSO_FAKE_SECRET_SENTINEL_CONFIRMATION_DO_NOT_USE",
        },
      },
      { "x-service-lasso-chat-bridge-token": "SERVICE_LASSO_TEST_BRIDGE_TOKEN" },
    );

    assert.equal(response.status, 400);
    assert.equal(response.body.error, "invalid_plan");
    assert.equal(JSON.stringify(response.body).includes("SERVICE_LASSO_FAKE_SECRET_SENTINEL_CONFIRMATION_DO_NOT_USE"), false);
    await assert.rejects(
      readFile(path.join(workspaceRoot, ".state", "operator-command-confirmation-audit.jsonl"), "utf8"),
      /ENOENT/,
    );
  });
});
