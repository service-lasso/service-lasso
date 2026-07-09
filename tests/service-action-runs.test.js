import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { makeTempServicesRoot, writeManifest } from "./test-helpers.js";

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

async function getJson(url) {
  const response = await fetch(url);
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function writeActionScript(serviceRoot) {
  const runtimeRoot = path.join(serviceRoot, "runtime");
  await mkdir(runtimeRoot, { recursive: true });
  await writeFile(
    path.join(runtimeRoot, "action-writer.mjs"),
    [
      "import { mkdir, writeFile } from 'node:fs/promises';",
      "import path from 'node:path';",
      "const outputPath = path.resolve(process.cwd(), './runtime/action-output.json');",
      "await mkdir(path.dirname(outputPath), { recursive: true });",
      "await writeFile(outputPath, JSON.stringify({",
      "  serviceId: process.env.SERVICE_ID,",
      "  actionId: process.env.SERVICE_LASSO_ACTION_ID,",
      "  source: process.env.SERVICE_LASSO_RUN_SOURCE,",
      "  workflowId: process.env.SERVICE_LASSO_WORKFLOW_ID,",
      "  scheduleId: process.env.SERVICE_LASSO_SCHEDULE_ID,",
      "  stepId: process.env.SERVICE_LASSO_STEP_ID,",
      "  parentActionId: process.env.SERVICE_LASSO_PARENT_ACTION_ID,",
      "  params: JSON.parse(process.env.SERVICE_LASSO_ACTION_PARAMS ?? '{}'),",
      "  payload: JSON.parse(process.env.SERVICE_LASSO_ACTION_PAYLOAD ?? '{}'),",
      "  payloadRef: process.env.SERVICE_LASSO_ACTION_PAYLOAD_REF,",
      "  payloadSource: process.env.SERVICE_LASSO_ACTION_PAYLOAD_SOURCE,",
      "  inlineMetadata: JSON.parse(process.env.SERVICE_LASSO_ACTION_INLINE_METADATA ?? '{}'),",
      "  actionValue: process.env.ACTION_VALUE",
      "}, null, 2));",
      "console.log('action writer complete');",
      "console.error('action writer stderr');",
    ].join("\n"),
    "utf8",
  );
}

test("service action run API executes command actions and exposes persisted history", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-action-runs-");
  const serviceRoot = await writeManifest(servicesRoot, "action-service", {
    id: "action-service",
    name: "Action Service",
    description: "Action run proof.",
    actions: {
      backup: {
        mode: "command",
        command: process.execPath,
        args: ["runtime/action-writer.mjs"],
        schedules: {
          nightly: {
            cron: "15 2 * * *",
            timezone: "Australia/Sydney",
          },
          disabled: {
            enabled: false,
            cron: "0 3 * * *",
          },
        },
        env: {
          ACTION_VALUE: "configured-${SERVICE_ID}",
        },
        payload: {
          inline: true,
          references: true,
          allowMixed: true,
          required: true,
          schema: {
            type: "object",
            required: ["retainDays"],
            additionalProperties: false,
            properties: {
              retainDays: { type: "integer" },
              mode: { type: "string" },
              storedOnly: { type: "boolean" },
            },
          },
          recordInlineFields: ["retainDays", "mode"],
        },
        timeoutSeconds: 5,
      },
      unscheduled: {
        mode: "command",
        command: process.execPath,
        args: ["-e", "process.exit(0)"],
      },
      dangerous: {
        mode: "command",
        command: process.execPath,
        args: ["-e", "process.exit(0)"],
        requiresConfirmation: true,
      },
      manual: {
        mode: "command",
        command: process.execPath,
        args: ["-e", "process.exit(0)"],
        manualOnly: true,
        schedules: {
          nightly: {
            cron: "15 2 * * *",
          },
        },
      },
      workflow: {
        mode: "workflow",
      },
      strictPayload: {
        mode: "command",
        command: process.execPath,
        args: ["-e", "process.exit(0)"],
        payload: {
          inline: true,
          references: true,
          allowMixed: false,
        },
      },
    },
  });
  await writeActionScript(serviceRoot);
  await mkdir(path.join(serviceRoot, ".state", "action-payloads"), { recursive: true });
  await writeFile(
    path.join(serviceRoot, ".state", "action-payloads", "stored-backup.json"),
    JSON.stringify({ retainDays: 14, storedOnly: true }, null, 2),
    "utf8",
  );
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const run = await postJson(`${apiServer.url}/api/services/action-service/actions/backup/runs`, {
      source: "dagu",
      workflowId: "minecraft.backup.nightly",
      scheduleId: "nightly",
      stepId: "backup",
      parentActionId: "nightly-backup",
      params: {
        retainDays: 7,
      },
      payload: {
        retainDays: 7,
        mode: "full",
      },
    });

    assert.equal(run.status, 200);
    assert.equal(run.body.ok, true);
    assert.equal(run.body.run.status, "succeeded");
    assert.equal(run.body.run.metadata.source, "dagu");
    assert.equal(run.body.run.metadata.workflowId, "minecraft.backup.nightly");
    assert.equal(run.body.run.metadata.scheduleId, "nightly");
    assert.equal(run.body.run.metadata.stepId, "backup");
    assert.equal(run.body.run.metadata.parentActionId, "nightly-backup");
    assert.deepEqual(run.body.run.metadata.params, { retainDays: 7 });
    assert.deepEqual(run.body.run.metadata.payload, {
      source: "inline",
      referenceId: null,
      inline: {
        retainDays: 7,
        mode: "full",
      },
    });

    const output = JSON.parse(await readFile(path.join(serviceRoot, "runtime", "action-output.json"), "utf8"));
    assert.equal(output.serviceId, "action-service");
    assert.equal(output.actionId, "backup");
    assert.equal(output.source, "dagu");
    assert.equal(output.workflowId, "minecraft.backup.nightly");
    assert.equal(output.scheduleId, "nightly");
    assert.equal(output.stepId, "backup");
    assert.equal(output.parentActionId, "nightly-backup");
    assert.deepEqual(output.params, { retainDays: 7 });
    assert.deepEqual(output.payload, { retainDays: 7, mode: "full" });
    assert.equal(output.payloadRef, "");
    assert.equal(output.payloadSource, "inline");
    assert.deepEqual(output.inlineMetadata, { retainDays: 7, mode: "full" });
    assert.equal(output.actionValue, "configured-action-service");

    const mixedPayload = await postJson(`${apiServer.url}/api/services/action-service/actions/backup/runs`, {
      source: "dagu",
      workflowId: "minecraft.backup.nightly",
      scheduleId: "nightly",
      payloadRef: "stored-backup",
      payload: {
        mode: "incremental",
      },
    });
    assert.equal(mixedPayload.status, 200);
    assert.equal(mixedPayload.body.ok, true);
    assert.deepEqual(mixedPayload.body.run.metadata.payload, {
      source: "mixed",
      referenceId: "stored-backup",
      inline: {
        mode: "incremental",
      },
    });

    const mixedOutput = JSON.parse(await readFile(path.join(serviceRoot, "runtime", "action-output.json"), "utf8"));
    assert.deepEqual(mixedOutput.payload, { retainDays: 14, storedOnly: true, mode: "incremental" });
    assert.equal(mixedOutput.payloadRef, "stored-backup");
    assert.equal(mixedOutput.payloadSource, "mixed");
    assert.deepEqual(mixedOutput.inlineMetadata, { mode: "incremental" });

    const history = await getJson(`${apiServer.url}/api/services/action-service/actions/backup/runs`);
    assert.equal(history.status, 200);
    assert.equal(history.body.serviceId, "action-service");
    assert.equal(history.body.actionId, "backup");
    assert.equal(history.body.runs.length, 2);
    assert.equal(history.body.runs[0].runId, run.body.run.runId);
    assert.match(await readFile(history.body.runs[0].logs.stdoutPath, "utf8"), /action writer complete/);
    assert.match(await readFile(history.body.runs[0].logs.stderrPath, "utf8"), /action writer stderr/);

    const allHistory = await getJson(`${apiServer.url}/api/services/action-service/actions`);
    assert.equal(allHistory.status, 200);
    assert.equal(allHistory.body.runs.length, 2);

    const missingPayload = await postJson(`${apiServer.url}/api/services/action-service/actions/backup/runs`);
    assert.equal(missingPayload.status, 400);
    assert.equal(missingPayload.body.error, "action_payload_required");

    const invalidPayload = await postJson(`${apiServer.url}/api/services/action-service/actions/backup/runs`, {
      payload: {
        retainDays: "seven",
      },
    });
    assert.equal(invalidPayload.status, 400);
    assert.equal(invalidPayload.body.error, "invalid_action_payload");

    const unknownPayloadRef = await postJson(`${apiServer.url}/api/services/action-service/actions/backup/runs`, {
      payloadRef: "missing-payload",
    });
    assert.equal(unknownPayloadRef.status, 404);
    assert.equal(unknownPayloadRef.body.error, "unknown_action_payload_ref");

    const payloadNotAllowed = await postJson(`${apiServer.url}/api/services/action-service/actions/unscheduled/runs`, {
      payload: {
        retainDays: 1,
      },
    });
    assert.equal(payloadNotAllowed.status, 400);
    assert.equal(payloadNotAllowed.body.error, "action_payload_not_allowed");

    const mixedNotAllowed = await postJson(`${apiServer.url}/api/services/action-service/actions/strictPayload/runs`, {
      payloadRef: "stored-backup",
      payload: {
        mode: "full",
      },
    });
    assert.equal(mixedNotAllowed.status, 400);
    assert.equal(mixedNotAllowed.body.error, "mixed_action_payload_not_allowed");

    const scheduledWithoutWorkflow = await postJson(`${apiServer.url}/api/services/action-service/actions/backup/runs`, {
      source: "dagu",
      scheduleId: "nightly",
    });
    assert.equal(scheduledWithoutWorkflow.status, 400);
    assert.equal(scheduledWithoutWorkflow.body.error, "scheduled_metadata_required");
    assert.match(scheduledWithoutWorkflow.body.message, /workflowId/);
    assert.match(scheduledWithoutWorkflow.body.message, /scheduleId/);

    const scheduledWithoutSchedule = await postJson(`${apiServer.url}/api/services/action-service/actions/backup/runs`, {
      source: "scheduler",
      workflowId: "minecraft.backup.nightly",
    });
    assert.equal(scheduledWithoutSchedule.status, 400);
    assert.equal(scheduledWithoutSchedule.body.error, "scheduled_metadata_required");

    const unknownSchedule = await postJson(`${apiServer.url}/api/services/action-service/actions/backup/runs`, {
      source: "dagu",
      workflowId: "minecraft.backup.nightly",
      scheduleId: "unknown",
    });
    assert.equal(unknownSchedule.status, 404);
    assert.equal(unknownSchedule.body.error, "unknown_action_schedule");

    const disabledSchedule = await postJson(`${apiServer.url}/api/services/action-service/actions/backup/runs`, {
      source: "scheduler",
      workflowId: "minecraft.backup.disabled",
      scheduleId: "disabled",
    });
    assert.equal(disabledSchedule.status, 409);
    assert.equal(disabledSchedule.body.error, "disabled_action_schedule");

    const unscheduledAction = await postJson(`${apiServer.url}/api/services/action-service/actions/unscheduled/runs`, {
      source: "dagu",
      workflowId: "minecraft.unscheduled.nightly",
      scheduleId: "nightly",
    });
    assert.equal(unscheduledAction.status, 409);
    assert.equal(unscheduledAction.body.error, "scheduled_action_not_configured");

    const missingConfirmation = await postJson(`${apiServer.url}/api/services/action-service/actions/dangerous/runs`);
    assert.equal(missingConfirmation.status, 409);
    assert.equal(missingConfirmation.body.error, "confirmation_required");

    const manualFromDagu = await postJson(`${apiServer.url}/api/services/action-service/actions/manual/runs`, {
      source: "dagu",
      workflowId: "minecraft.manual.nightly",
      scheduleId: "nightly",
    });
    assert.equal(manualFromDagu.status, 409);
    assert.equal(manualFromDagu.body.error, "manual_only_action");

    const unsupported = await postJson(`${apiServer.url}/api/services/action-service/actions/workflow/runs`);
    assert.equal(unsupported.status, 400);
    assert.equal(unsupported.body.error, "unsupported_action");
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
