import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import path from "node:path";
import { readFile, rm } from "node:fs/promises";
import {
  emitOperatorInboxServiceEvent,
  emitOperatorInboxSystemEvent,
  emitOperatorInboxUpdateEvent,
  emitOperatorInboxWorkflowEvent,
  readOperatorInbox,
  upsertOperatorInboxItem,
} from "../dist/runtime/operator/inbox.js";
import { createApiServer } from "../dist/server/index.js";
import { makeTempServicesRoot } from "./test-helpers.js";

async function startOperatorInboxApiServer(options) {
  const server = createApiServer({ ...options, host: "127.0.0.1" });
  const listening = once(server, "listening");
  server.listen(0, "127.0.0.1");
  await listening;
  const address = server.address();
  assert.equal(typeof address, "object");
  assert.notEqual(address, null);

  return {
    url: `http://127.0.0.1:${address.port}`,
    async stop() {
      const closed = once(server, "close");
      server.close();
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
      await closed;
    },
  };
}

async function getJson(url) {
  const response = await fetch(url);
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function postJson(url, body = {}) {
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

test("operator inbox persists durable items and redacts sensitive fields", async () => {
  const { tempRoot } = await makeTempServicesRoot("service-lasso-operator-inbox-state-");
  const workspaceRoot = path.join(tempRoot, "workspace");

  try {
    let inbox = await upsertOperatorInboxItem(workspaceRoot, {
      dedupeKey: "update:@node:available",
      title: "Provider update available",
      summary: "A new provider package is ready without token=ghp_exampleSecret.",
      details: "Download using Bearer abcdef123456 should never be stored.",
      type: "update",
      severity: "info",
      source: "updater",
      relatedTarget: {
        serviceId: "@node",
        updateId: "2026.8.1",
        route: "/services/@node/updates?token=ghp_routeSecret",
      },
      action: {
        label: "Install update",
        target: "/api/services/%40node/update/install",
        kind: "api",
        availability: "available",
      },
      observedAt: "2026-08-01T00:00:00.000Z",
    });

    assert.equal(inbox.items.length, 1);
    assert.equal(inbox.items[0].id, "inbox-update:-node:available");
    assert.equal(inbox.items[0].state, "unread");
    assert.equal(inbox.items[0].visibility, "visible");

    const initiallyPersisted = await readFile(path.join(workspaceRoot, ".state", "operator-inbox.json"), "utf8");
    assert.doesNotMatch(initiallyPersisted, /ghp_exampleSecret|abcdef123456|ghp_routeSecret/);
    assert.match(initiallyPersisted, /\[redacted\]/);

    inbox = await upsertOperatorInboxItem(workspaceRoot, {
      dedupeKey: "update:@node:available",
      title: "Provider update still available",
      summary: "Safe retry summary.",
      type: "update",
      severity: "warning",
      source: "updater",
      observedAt: "2026-08-01T00:05:00.000Z",
    });

    assert.equal(inbox.items.length, 1);
    assert.equal(inbox.items[0].title, "Provider update still available");
    assert.equal(inbox.items[0].createdAt, "2026-08-01T00:00:00.000Z");
    assert.equal(inbox.items[0].updatedAt, "2026-08-01T00:05:00.000Z");
    assert.equal(inbox.items[0].severity, "warning");

    const persisted = await readFile(path.join(workspaceRoot, ".state", "operator-inbox.json"), "utf8");
    assert.doesNotMatch(persisted, /ghp_exampleSecret|abcdef123456|ghp_routeSecret/);
    assert.doesNotMatch(persisted, /\[redacted\]/);

    const reread = await readOperatorInbox(workspaceRoot);
    assert.equal(reread.items.length, 1);
    assert.equal(reread.items[0].id, inbox.items[0].id);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("operator inbox API lists filters counts and persists mutations across restart", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-operator-inbox-api-");
  const workspaceRoot = path.join(tempRoot, "workspace");
  let apiServer = null;

  try {
    apiServer = await startOperatorInboxApiServer({ servicesRoot, workspaceRoot });
    const updateRecord = await postJson(apiServer.url + "/api/operator/inbox/record", {
      dedupeKey: "update:core:available",
      title: "Runtime update available",
      summary: "A runtime update is available.",
      details: "Safe update metadata only.",
      type: "update",
      severity: "info",
      source: "updater",
      relatedTarget: {
        updateId: "2026.8.1",
        route: "/updates",
      },
      action: {
        label: "Review update",
        target: "/updates",
        kind: "link",
        availability: "available",
      },
      observedAt: "2026-08-01T00:10:00.000Z",
    });
    assert.equal(updateRecord.status, 200);
    const updateId = updateRecord.body.inbox.items.find((item) => item.dedupeKey === "update:core:available").id;

    const securityRecord = await postJson(apiServer.url + "/api/operator/inbox/record", {
      dedupeKey: "security:remote-auth-required",
      title: "Remote auth required",
      summary: "Remote API access is missing trusted identity.",
      type: "security",
      severity: "critical",
      source: "runtime",
      relatedTarget: {
        auditId: "audit-1",
        route: "/security",
      },
      observedAt: "2026-08-01T00:11:00.000Z",
    });
    assert.equal(securityRecord.status, 200);
    const securityId = securityRecord.body.inbox.items.find((item) => item.dedupeKey === "security:remote-auth-required").id;

    let response = await getJson(apiServer.url + "/api/operator/inbox?filter=unread&limit=1");
    assert.equal(response.status, 200);
    assert.equal(response.body.inbox.items.length, 1);
    assert.equal(response.body.inbox.pagination.total, 2);
    assert.equal(response.body.inbox.pagination.nextCursor, "1");

    response = await getJson(apiServer.url + "/api/operator/inbox?filter=updates");
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.inbox.items.map((item) => item.id), [updateId]);

    response = await getJson(apiServer.url + "/api/operator/inbox/counts");
    assert.equal(response.status, 200);
    assert.equal(response.body.inbox.counts.total, 2);
    assert.equal(response.body.inbox.counts.unread, 2);
    assert.equal(response.body.inbox.counts.byFilter.updates, 1);
    assert.equal(response.body.inbox.counts.byFilter.errors, 1);

    response = await getJson(apiServer.url + "/api/operator/inbox/" + encodeURIComponent(securityId));
    assert.equal(response.status, 200);
    assert.equal(response.body.inboxItem.title, "Remote auth required");

    response = await postJson(apiServer.url + "/api/operator/inbox/" + encodeURIComponent(updateId) + "/read", {
      now: "2026-08-01T00:12:00.000Z",
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.inbox.items.find((item) => item.id === updateId).state, "read");

    response = await postJson(apiServer.url + "/api/operator/inbox/bulk", {
      action: "hide",
      ids: [securityId],
      now: "2026-08-01T00:13:00.000Z",
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.inbox.counts.hidden, 1);

    await apiServer.stop();
    apiServer = null;
    apiServer = await startOperatorInboxApiServer({ servicesRoot, workspaceRoot });

    response = await getJson(apiServer.url + "/api/operator/inbox/counts");
    assert.equal(response.status, 200);
    assert.equal(response.body.inbox.counts.read, 1);
    assert.equal(response.body.inbox.counts.hidden, 1);

    response = await getJson(apiServer.url + "/api/operator/inbox?filter=hidden");
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.inbox.items.map((item) => item.id), [securityId]);

    response = await postJson(apiServer.url + "/api/operator/inbox/" + encodeURIComponent(securityId) + "/unhide", {
      now: "2026-08-01T00:14:00.000Z",
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.inbox.items.find((item) => item.id === securityId).visibility, "visible");

    response = await postJson(apiServer.url + "/api/operator/inbox/" + encodeURIComponent(updateId) + "/unread", {
      now: "2026-08-01T00:15:00.000Z",
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.inbox.items.find((item) => item.id === updateId).state, "unread");
  } finally {
    await apiServer?.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("operator inbox producers cover system service workflow and update events without duplicate storms", async () => {
  const { tempRoot } = await makeTempServicesRoot("service-lasso-operator-inbox-producers-");
  const workspaceRoot = path.join(tempRoot, "workspace");

  try {
    await emitOperatorInboxSystemEvent(workspaceRoot, {
      kind: "runtime.startup",
      status: "success",
      summary: "Runtime started with two discovered services.",
      route: "/api/dashboard",
      correlationKey: "generation-1",
      observedAt: "2026-08-13T00:00:00.000Z",
    });

    await emitOperatorInboxServiceEvent(workspaceRoot, {
      serviceId: "alpha-service",
      kind: "health.unhealthy",
      summary: "Service alpha-service healthcheck is unhealthy.",
      route: "/services/alpha-service",
      correlationKey: "current",
      observedAt: "2026-08-13T00:01:00.000Z",
    });

    await emitOperatorInboxWorkflowEvent(workspaceRoot, {
      workflowId: "nightly-backup",
      status: "failed",
      summary: "Scheduled action failed for service alpha-service.",
      serviceId: "alpha-service",
      actionId: "backup",
      runId: "run-1",
      scheduleId: "nightly",
      route: "/services/alpha-service/actions/backup",
      observedAt: "2026-08-13T00:02:00.000Z",
    });

    await emitOperatorInboxUpdateEvent(workspaceRoot, {
      serviceId: "alpha-service",
      status: "available",
      summary: "Update 2026.8.13-new is available.",
      updateId: "2026.8.13-new",
      route: "/services/alpha-service/updates",
      observedAt: "2026-08-13T00:03:00.000Z",
    });
    await emitOperatorInboxUpdateEvent(workspaceRoot, {
      serviceId: "alpha-service",
      status: "available",
      summary: "Update 2026.8.13-new remains available.",
      updateId: "2026.8.13-new",
      route: "/services/alpha-service/updates",
      observedAt: "2026-08-13T00:04:00.000Z",
    });

    const inbox = await readOperatorInbox(workspaceRoot);
    assert.equal(inbox.items.length, 4);
    const byKey = new Map(inbox.items.map((item) => [item.dedupeKey, item]));

    assert.equal(byKey.get("system:runtime.startup:generation-1").type, "system");
    assert.equal(byKey.get("service:health.unhealthy:alpha-service:current").type, "error");
    assert.equal(byKey.get("workflow:nightly-backup:run-1").source, "workflow");
    assert.equal(byKey.get("update:available:alpha-service:2026.8.13-new").summary, "Update 2026.8.13-new remains available.");
    assert.equal(byKey.get("update:available:alpha-service:2026.8.13-new").createdAt, "2026-08-13T00:03:00.000Z");
    assert.equal(byKey.get("update:available:alpha-service:2026.8.13-new").updatedAt, "2026-08-13T00:04:00.000Z");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
