import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import {
  mutateOperatorActionItem,
  readOperatorActionQueue,
  upsertOperatorActionItem,
} from "../dist/runtime/operator/action-queue.js";
import { startApiServer } from "../dist/server/index.js";
import { makeTempServicesRoot } from "./test-helpers.js";

const execFile = promisify(execFileCallback);

async function runCli(args, cwd = path.resolve(".")) {
  const cliPath = path.join(cwd, "dist", "cli.js");
  const result = await execFile(process.execPath, [cliPath, ...args], {
    cwd,
    env: {
      ...process.env,
      npm_package_version: "0.1.0-test",
    },
  });

  return result.stdout.trim();
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

test("operator action queue persists deduped actions and safe mutations", async () => {
  const { tempRoot } = await makeTempServicesRoot("service-lasso-operator-actions-state-");
  const workspaceRoot = path.join(tempRoot, "workspace");

  try {
    let queue = await upsertOperatorActionItem(workspaceRoot, {
      dedupeKey: "updates:@node:failed-check",
      severity: "warning",
      source: {
        kind: "failed_check",
        serviceId: "@node",
        reference: "update-check",
      },
      title: "Update check failed",
      summary: "Provider returned token=ghp_exampleSecret and password=hunter2",
      evidence: [
        {
          label: "safe detail",
          value: "Bearer abcdef123456",
        },
      ],
      observedAt: "2026-05-21T18:00:00.000Z",
    });

    assert.equal(queue.items.length, 1);
    assert.equal(queue.items[0].id, "action-updates:-node:failed-check");
    assert.equal(queue.items[0].status, "open");

    const initialPersisted = await readFile(path.join(workspaceRoot, ".state", "operator-actions.json"), "utf8");
    assert.doesNotMatch(initialPersisted, /hunter2|ghp_exampleSecret|abcdef123456/);
    assert.match(initialPersisted, /\[redacted\]/);

    queue = await upsertOperatorActionItem(workspaceRoot, {
      dedupeKey: "updates:@node:failed-check",
      severity: "critical",
      source: {
        kind: "failed_check",
        serviceId: "@node",
        reference: "second-check",
      },
      title: "Update check still failing",
      summary: "Retry failed without exposing values.",
      observedAt: "2026-05-21T18:05:00.000Z",
    });

    assert.equal(queue.items.length, 1);
    assert.equal(queue.items[0].severity, "critical");
    assert.equal(queue.items[0].firstSeenAt, "2026-05-21T18:00:00.000Z");
    assert.equal(queue.items[0].lastSeenAt, "2026-05-21T18:05:00.000Z");

    queue = await mutateOperatorActionItem(workspaceRoot, queue.items[0].id, "acknowledge", {
      now: "2026-05-21T18:06:00.000Z",
    });
    assert.equal(queue.items[0].status, "acknowledged");
    assert.equal(queue.items[0].acknowledgedAt, "2026-05-21T18:06:00.000Z");

    queue = await mutateOperatorActionItem(workspaceRoot, queue.items[0].id, "defer", {
      now: "2026-05-21T18:07:00.000Z",
      deferredUntil: "2026-05-22T18:07:00.000Z",
    });
    assert.equal(queue.items[0].status, "deferred");
    assert.equal(queue.items[0].deferredUntil, "2026-05-22T18:07:00.000Z");

    queue = await mutateOperatorActionItem(workspaceRoot, queue.items[0].id, "reopen", {
      now: "2026-05-21T18:08:00.000Z",
    });
    assert.equal(queue.items[0].status, "open");
    assert.equal(queue.items[0].reopenedAt, "2026-05-21T18:08:00.000Z");

    const reread = await readOperatorActionQueue(workspaceRoot);
    assert.equal(reread.items.length, 1);

    const persisted = await readFile(path.join(workspaceRoot, ".state", "operator-actions.json"), "utf8");
    assert.doesNotMatch(persisted, /hunter2|ghp_exampleSecret|abcdef123456/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("operator action queue is available through API and CLI", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-operator-actions-api-");
  const workspaceRoot = path.join(tempRoot, "workspace");
  const apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot });

  try {
    const record = await postJson(apiServer.url + "/api/operator/actions/record", {
      dedupeKey: "recovery:sample:doctor",
      severity: "warning",
      source: {
        kind: "recovery",
        serviceId: "sample",
        reference: "doctor",
      },
      title: "Recovery doctor warning",
      summary: "Doctor reported a warning.",
      evidence: [
        {
          label: "step",
          value: "doctor-warn",
        },
      ],
      observedAt: "2026-05-21T18:10:00.000Z",
    });

    assert.equal(record.status, 200);
    const actionId = record.body.queue.items[0].id;

    let response = await fetch(apiServer.url + "/api/operator/actions");
    let payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.queue.items[0].id, actionId);

    const acknowledged = await postJson(apiServer.url + "/api/operator/actions/" + encodeURIComponent(actionId) + "/acknowledge");
    assert.equal(acknowledged.status, 200);
    assert.equal(acknowledged.body.queue.items[0].status, "acknowledged");

    const cliListOut = await runCli([
      "operator",
      "actions",
      "list",
      "--services-root",
      servicesRoot,
      "--workspace-root",
      workspaceRoot,
      "--json",
    ]);
    const cliList = JSON.parse(cliListOut);
    assert.equal(cliList.queue.items[0].status, "acknowledged");

    const cliReopenOut = await runCli([
      "operator",
      "actions",
      "reopen",
      actionId,
      "--services-root",
      servicesRoot,
      "--workspace-root",
      workspaceRoot,
      "--json",
    ]);
    const cliReopen = JSON.parse(cliReopenOut);
    assert.equal(cliReopen.queue.items[0].status, "open");
  } finally {
    await apiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
