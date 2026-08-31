import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import {
  emitOperatorInboxWorkflowEvent,
  readOperatorInbox,
} from "../dist/runtime/operator/inbox.js";
import {
  emitInboxBrokerAttentionFromKnownFacts,
  emitInboxForHealthTransition,
  emitInboxForLifecycleAction,
  emitInboxFromUpdateSchedulerEvent,
  emitInboxRuntimeSetup,
  emitInboxRuntimeSetupCompleted,
  emitInboxUpdateFailure,
  emitInboxUpdateInstallOutcome,
} from "../dist/runtime/operator/inbox-emit.js";
import { createApiServer } from "../dist/server/index.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { makeTempServicesRoot, writeManifest } from "./test-helpers.js";

const systemActionActor = { type: "system", id: "scheduler-runtime", permissions: ["service.action.run"] };

/**
 * Starts a loopback API server without the full generation transaction.
 *
 * @param options Runtime config passed to createApiServer.
 * @returns Base URL and stop helper.
 */
async function startInboxEmitApiServer(options) {
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

function emptyHealth() {
  return {
    type: "process",
    healthy: false,
    detail: "process is not running",
  };
}

test("inbox emit system producer records first-run setup without poll storms", async () => {
  const { tempRoot } = await makeTempServicesRoot("service-lasso-inbox-emit-system-");
  const workspaceRoot = path.join(tempRoot, "workspace");

  try {
    await emitInboxRuntimeSetup(workspaceRoot, { state: "setup_required", setupMode: true }, "2026-08-31T00:00:00.000Z");
    await emitInboxRuntimeSetup(workspaceRoot, { state: "setup_required", setupMode: true }, "2026-08-31T00:01:00.000Z");
    await emitInboxRuntimeSetupCompleted(workspaceRoot, "2026-08-31T00:02:00.000Z");
    const skippedHealthyBoot = await emitInboxRuntimeSetup(
      workspaceRoot,
      { state: "not_required", setupMode: false },
      "2026-08-31T00:03:00.000Z",
    );

    const inbox = await readOperatorInbox(workspaceRoot);
    const byKey = new Map(inbox.items.map((item) => [item.dedupeKey, item]));
    assert.equal(skippedHealthyBoot, null);
    assert.equal(inbox.items.length, 2);
    assert.equal(byKey.get("system:first-run.required:current").type, "system");
    assert.equal(byKey.get("system:first-run.required:current").createdAt, "2026-08-31T00:00:00.000Z");
    assert.equal(byKey.get("system:first-run.required:current").updatedAt, "2026-08-31T00:01:00.000Z");
    assert.equal(byKey.get("system:first-run.completed:current").severity, "success");
    assert.equal(byKey.get("system:first-run.required:current").relatedTarget.route, "/api/setup/status");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("inbox emit service producer updates health in place and records lifecycle failure", async () => {
  const { tempRoot } = await makeTempServicesRoot("service-lasso-inbox-emit-service-");
  const workspaceRoot = path.join(tempRoot, "workspace");

  try {
    const firstUnhealthy = {
      history: { serviceId: "alpha-service", updatedAt: "2026-08-31T00:00:00.000Z", transitions: [] },
      appended: true,
      previousStatus: null,
      nextStatus: "unhealthy",
    };
    await emitInboxForHealthTransition(workspaceRoot, {
      serviceId: "alpha-service",
      running: false,
      health: emptyHealth(),
      transition: firstUnhealthy,
      observedAt: "2026-08-31T00:00:00.000Z",
    });
    const noStorm = await emitInboxForHealthTransition(workspaceRoot, {
      serviceId: "alpha-service",
      running: false,
      health: emptyHealth(),
      transition: {
        ...firstUnhealthy,
        appended: false,
        previousStatus: "unhealthy",
        nextStatus: "unhealthy",
      },
      observedAt: "2026-08-31T00:01:00.000Z",
    });
    await emitInboxForLifecycleAction(workspaceRoot, {
      serviceId: "alpha-service",
      action: "start",
      ok: false,
      running: false,
      health: emptyHealth(),
      healthTransition: {
        ...firstUnhealthy,
        appended: false,
        previousStatus: "unhealthy",
        nextStatus: "unhealthy",
      },
      observedAt: "2026-08-31T00:02:00.000Z",
    });
    await emitInboxForHealthTransition(workspaceRoot, {
      serviceId: "alpha-service",
      running: true,
      health: { type: "process", healthy: true, detail: "running" },
      transition: {
        history: { serviceId: "alpha-service", updatedAt: "2026-08-31T00:03:00.000Z", transitions: [] },
        appended: true,
        previousStatus: "unhealthy",
        nextStatus: "healthy",
      },
      observedAt: "2026-08-31T00:03:00.000Z",
    });

    const inbox = await readOperatorInbox(workspaceRoot);
    const byKey = new Map(inbox.items.map((item) => [item.dedupeKey, item]));
    assert.equal(noStorm, null);
    assert.equal(byKey.get("service:health.unhealthy:alpha-service:current").type, "error");
    assert.equal(byKey.get("service:lifecycle.failed:alpha-service:current").summary, "Service \"alpha-service\" start failed.");
    assert.equal(byKey.get("service:health.recovered:alpha-service:current").severity, "success");
    assert.equal(byKey.get("service:health.unhealthy:alpha-service:current").relatedTarget.route, "/services/alpha-service");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("inbox emit workflow producer records scheduled outcomes without secrets or paths", async () => {
  const { tempRoot } = await makeTempServicesRoot("service-lasso-inbox-emit-workflow-");
  const workspaceRoot = path.join(tempRoot, "workspace");

  try {
    await emitOperatorInboxWorkflowEvent(workspaceRoot, {
      workflowId: "nightly-backup",
      status: "failed",
      summary: "Scheduled action failed for service alpha-service. token=ghp_workflowSecret path=C:\\secrets\\token.txt",
      serviceId: "alpha-service",
      actionId: "backup",
      runId: "run-1",
      scheduleId: "nightly",
      route: "/services/alpha-service/actions/backup",
      observedAt: "2026-08-31T00:04:00.000Z",
    });
    const firstPersisted = await readFile(path.join(workspaceRoot, ".state", "operator-inbox.json"), "utf8");
    assert.doesNotMatch(firstPersisted, /ghp_workflowSecret|C:\\secrets\\token\.txt/);
    assert.match(firstPersisted, /\[redacted\]/);
    assert.match(firstPersisted, /\[path\]/);

    await emitOperatorInboxWorkflowEvent(workspaceRoot, {
      workflowId: "nightly-backup",
      status: "failed",
      summary: "Scheduled action failed for service alpha-service.",
      serviceId: "alpha-service",
      actionId: "backup",
      runId: "run-1",
      scheduleId: "nightly",
      route: "/services/alpha-service/actions/backup",
      observedAt: "2026-08-31T00:05:00.000Z",
    });

    const inbox = await readOperatorInbox(workspaceRoot);
    assert.equal(inbox.items.length, 1);
    assert.equal(inbox.items[0].dedupeKey, "workflow:nightly-backup:run-1");
    assert.equal(inbox.items[0].source, "workflow");
    assert.equal(inbox.items[0].createdAt, "2026-08-31T00:04:00.000Z");
    assert.equal(inbox.items[0].updatedAt, "2026-08-31T00:05:00.000Z");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("inbox emit update producer covers available installed failed and restart-required", async () => {
  const { tempRoot } = await makeTempServicesRoot("service-lasso-inbox-emit-update-");
  const workspaceRoot = path.join(tempRoot, "workspace");

  try {
    await emitInboxFromUpdateSchedulerEvent(workspaceRoot, {
      serviceId: "alpha-service",
      action: "check",
      reason: "update_available",
      mode: "notify",
      message: "Update available.",
      at: "2026-08-31T00:06:00.000Z",
    }, "2026.8.31");
    await emitInboxFromUpdateSchedulerEvent(workspaceRoot, {
      serviceId: "alpha-service",
      action: "check",
      reason: "update_available",
      mode: "notify",
      message: "Update still available.",
      at: "2026-08-31T00:07:00.000Z",
    }, "2026.8.31");
    const skippedPoll = await emitInboxFromUpdateSchedulerEvent(workspaceRoot, {
      serviceId: "alpha-service",
      action: "skip",
      reason: "interval_not_elapsed",
      mode: "notify",
      message: "Interval not elapsed.",
      at: "2026-08-31T00:07:30.000Z",
    }, "2026.8.31");
    await emitInboxUpdateInstallOutcome(workspaceRoot, {
      serviceId: "alpha-service",
      restartRequired: true,
      restartedAfterInstall: false,
      update: {
        serviceId: "alpha-service",
        state: "installed",
        updatedAt: "2026-08-31T00:08:00.000Z",
        lastCheck: null,
        provenance: { sourceRepo: null, tag: "2026.8.31", assetName: null, checksum: "absent", releaseUrl: null, discoveredAt: "2026-08-31T00:08:00.000Z", current: { installedTag: null, manifestTag: null, latestTag: null, comparison: "unknown" } },
        available: { tag: "2026.8.31", version: null, assetName: null, assetUrl: null, releaseUrl: null, publishedAt: null, assetId: null, assetNodeId: null, assetSize: null, assetUpdatedAt: null, assetDigest: null },
        downloadedCandidate: null,
        installDeferred: null,
        failed: null,
        hookResults: [],
      },
      state: {
        installArtifacts: {
          artifact: { tag: "2026.8.31" },
        },
      },
    });
    await emitInboxUpdateFailure(
      workspaceRoot,
      "beta-service",
      "Update install failed for service \"beta-service\".",
      "2026.8.30",
      "2026-08-31T00:09:00.000Z",
    );

    const inbox = await readOperatorInbox(workspaceRoot);
    const byKey = new Map(inbox.items.map((item) => [item.dedupeKey, item]));
    assert.equal(skippedPoll, null);
    assert.equal(byKey.get("update:available:alpha-service:2026.8.31").createdAt, "2026-08-31T00:06:00.000Z");
    assert.equal(byKey.get("update:available:alpha-service:2026.8.31").updatedAt, "2026-08-31T00:07:00.000Z");
    assert.equal(byKey.get("update:restart_required:alpha-service:2026.8.31").type, "update");
    assert.equal(byKey.get("update:failed:beta-service:2026.8.30").severity, "error");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("inbox emit broker producer uses known Core facts and skips healthy recovered noise", async () => {
  const { tempRoot } = await makeTempServicesRoot("service-lasso-inbox-emit-broker-");
  const workspaceRoot = path.join(tempRoot, "workspace");

  try {
    const healthySkip = await emitInboxBrokerAttentionFromKnownFacts(workspaceRoot, {
      discovered: true,
      running: true,
      vaultReady: true,
    }, "2026-08-31T00:10:00.000Z");
    assert.equal(healthySkip.items.length, 0);

    await emitInboxBrokerAttentionFromKnownFacts(workspaceRoot, {
      discovered: true,
      running: false,
      vaultReady: true,
    }, "2026-08-31T00:11:00.000Z");
    await emitInboxBrokerAttentionFromKnownFacts(workspaceRoot, {
      discovered: true,
      running: false,
      vaultReady: true,
    }, "2026-08-31T00:12:00.000Z");
    await emitInboxBrokerAttentionFromKnownFacts(workspaceRoot, {
      discovered: true,
      running: true,
      vaultReady: true,
    }, "2026-08-31T00:13:00.000Z");

    const inbox = await readOperatorInbox(workspaceRoot);
    assert.equal(inbox.items.length, 1);
    assert.equal(inbox.items[0].dedupeKey, "broker:needs-attention:current");
    assert.equal(inbox.items[0].source, "broker");
    assert.equal(inbox.items[0].createdAt, "2026-08-31T00:11:00.000Z");
    assert.equal(inbox.items[0].updatedAt, "2026-08-31T00:13:00.000Z");
    assert.equal(inbox.items[0].severity, "success");
    assert.equal(inbox.items[0].title, "Secrets Broker recovered");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("lifecycle start failure produces a durable service Inbox item through the API", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-inbox-emit-api-service-");
  await writeManifest(servicesRoot, "no-exec-service", {
    id: "no-exec-service",
    name: "No Exec Service",
    description: "Lifecycle failure Inbox producer.",
  });
  const apiServer = await startInboxEmitApiServer({ servicesRoot, workspaceRoot });

  try {
    const installed = await postJson(`${apiServer.url}/api/services/no-exec-service/install`);
    assert.equal(installed.status, 200);
    const configured = await postJson(`${apiServer.url}/api/services/no-exec-service/config`);
    assert.equal(configured.status, 200);
    const started = await postJson(`${apiServer.url}/api/services/no-exec-service/start`);
    assert.equal(started.status, 409);

    const inbox = await getJson(`${apiServer.url}/api/operator/inbox?filter=all`);
    assert.equal(inbox.status, 200);
    const failed = inbox.body.inbox.items.find((item) => item.dedupeKey === "service:lifecycle.failed:no-exec-service:current");
    assert.equal(failed?.type, "error");
    assert.equal(failed?.relatedTarget.serviceId, "no-exec-service");
    assert.equal(failed?.relatedTarget.route, "/services/no-exec-service");
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("scheduled action run produces a durable workflow Inbox item through the API", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-inbox-emit-api-workflow-");
  const serviceRoot = await writeManifest(servicesRoot, "action-service", {
    id: "action-service",
    name: "Action Service",
    description: "Workflow Inbox producer.",
    actions: {
      backup: {
        mode: "command",
        command: process.execPath,
        args: ["-e", "process.exit(0)"],
        schedules: {
          nightly: {
            cron: "15 2 * * *",
          },
        },
      },
    },
  });
  await mkdir(path.join(serviceRoot, "runtime"), { recursive: true });
  await writeFile(path.join(serviceRoot, "runtime", "keep.txt"), "ok\n", "utf8");
  const apiServer = await startInboxEmitApiServer({ servicesRoot, workspaceRoot });

  try {
    const run = await postJson(`${apiServer.url}/api/services/action-service/actions/backup/runs`, {
      source: "dagu",
      workflowId: "nightly-backup",
      scheduleId: "nightly",
      actor: systemActionActor,
    });
    assert.equal(run.status, 200);
    assert.equal(run.body.ok, true);

    const inbox = await getJson(`${apiServer.url}/api/operator/inbox?filter=workflow`);
    assert.equal(inbox.status, 200);
    const item = inbox.body.inbox.items.find((entry) => entry.dedupeKey.startsWith("workflow:nightly-backup:"));
    assert.equal(item?.source, "workflow");
    assert.equal(item?.relatedTarget.workflowId, "nightly-backup");
    assert.equal(item?.relatedTarget.serviceId, "action-service");
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
