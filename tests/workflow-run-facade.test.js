import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  assertWorkflowRunFacadeSecretSafe,
  cancelWorkflowFacadeRun,
  exampleWorkflowRunFacadeState,
  getWorkflowFacadeDefinition,
  getWorkflowFacadeRun,
  listWorkflowFacadeDefinitions,
  mapEngineRunStatus,
  retryWorkflowFacadeRun,
  startWorkflowFacadeRun,
  workflowRunFacadeEndpoints,
} from "../dist/platform/workflowRunFacade.js";

const repoRoot = process.cwd();
const context = {
  userId: "usr_01hzy9operator",
  workspaceId: "wks_local_demo",
  linkedIdentityId: "lid_zitadel_operator",
  entitlements: ["workspace:read", "provider-connection:use", "secrets-broker:resolve", "workflow:run"],
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("workflow run facade exposes product-facing endpoint contract", () => {
  assert.deepEqual(workflowRunFacadeEndpoints, {
    listWorkflows: "GET /api/platform/workspaces/{workspaceId}/workflows",
    getWorkflow: "GET /api/platform/workspaces/{workspaceId}/workflows/{workflowId}",
    startRun: "POST /api/platform/workspaces/{workspaceId}/workflows/{workflowId}/runs",
    getRun: "GET /api/platform/workspaces/{workspaceId}/workflow-runs/{runId}",
    cancelRun: "POST /api/platform/workspaces/{workspaceId}/workflow-runs/{runId}/cancel",
    retryRun: "POST /api/platform/workspaces/{workspaceId}/workflow-runs/{runId}/retry",
    runLogs: "GET /api/platform/workspaces/{workspaceId}/workflow-runs/{runId}/logs",
    runArtifacts: "GET /api/platform/workspaces/{workspaceId}/workflow-runs/{runId}/artifacts",
  });
});

test("workflow facade lists gets and starts runs with facade and engine run linkage", () => {
  const list = listWorkflowFacadeDefinitions(context, "wks_local_demo");
  assert.equal(list.ok, true);
  assert.equal(list.value[0].id, "official.core.maintenance/backup-check");
  assert.deepEqual(list.value[0].secretDependencies.map((secret) => [secret.namespace, secret.ref, secret.status]), [
    ["workflows/core-maintenance", "maintenance.API_TOKEN", "available"],
  ]);

  const workflow = getWorkflowFacadeDefinition(context, "wks_local_demo", "official.core.maintenance/backup-check");
  assert.equal(workflow.ok, true);
  assert.equal(workflow.value.engine.kind, "dagu");
  assert.equal(workflow.value.engine.dagu.workflowName, "backup-check");

  const started = startWorkflowFacadeRun(context, { workspaceId: "wks_local_demo", workflowId: workflow.value.id }, exampleWorkflowRunFacadeState, () => new Date("2026-05-08T12:10:00Z"));
  assert.equal(started.ok, true);
  assert.equal(started.value.status, "queued");
  assert.match(started.value.facadeRunId, /^wfr_/);
  assert.match(started.value.engine.runId, /^dagu-run-/);
  assert.equal(started.value.engine.dagu.runId, started.value.engine.runId);
  assert.equal(started.value.auditEvents[0].engineRunId, started.value.engine.runId);
  assert.doesNotThrow(() => assertWorkflowRunFacadeSecretSafe(started.value));
});

test("workflow run facade normalizes Dagu and generic statuses", () => {
  assert.equal(mapEngineRunStatus("dagu", "not_started"), "queued");
  assert.equal(mapEngineRunStatus("dagu", "running"), "running");
  assert.equal(mapEngineRunStatus("dagu", "success"), "succeeded");
  assert.equal(mapEngineRunStatus("dagu", "error"), "failed");
  assert.equal(mapEngineRunStatus("dagu", "cancel"), "cancelled");
  assert.equal(mapEngineRunStatus("custom", "retrying"), "retrying");
  assert.equal(mapEngineRunStatus("dagu", "engine-specific-surprise"), "unknown");
});

test("workflow start fails closed for workspace entitlement provider and secret policy", () => {
  const missingWorkflowRun = startWorkflowFacadeRun({ ...context, entitlements: ["workspace:read", "provider-connection:use", "secrets-broker:resolve"] }, { workspaceId: "wks_local_demo", workflowId: "official.core.maintenance/backup-check" });
  assert.equal(missingWorkflowRun.ok, false);
  assert.equal(missingWorkflowRun.error.code, "missing-entitlement");

  const connectionState = clone(exampleWorkflowRunFacadeState);
  connectionState.providerConnections[0].status = "needs-auth";
  const connectionDenied = startWorkflowFacadeRun(context, { workspaceId: "wks_local_demo", workflowId: "official.core.maintenance/backup-check" }, connectionState);
  assert.equal(connectionDenied.ok, false);
  assert.equal(connectionDenied.error.code, "connection-not-ready");

  const missingSecretState = clone(exampleWorkflowRunFacadeState);
  missingSecretState.workflows[0].secretDependencies[0].status = "missing";
  const missingSecret = startWorkflowFacadeRun(context, { workspaceId: "wks_local_demo", workflowId: "official.core.maintenance/backup-check" }, missingSecretState);
  assert.equal(missingSecret.ok, false);
  assert.equal(missingSecret.error.code, "missing-secret");
  assert.match(missingSecret.error.action, /Populate the broker ref/);

  const deniedSecretState = clone(exampleWorkflowRunFacadeState);
  deniedSecretState.workflows[0].secretDependencies[0].status = "denied";
  const deniedSecret = startWorkflowFacadeRun(context, { workspaceId: "wks_local_demo", workflowId: "official.core.maintenance/backup-check" }, deniedSecretState);
  assert.equal(deniedSecret.ok, false);
  assert.equal(deniedSecret.error.code, "secret-denied");
});

test("workflow run facade cancels and retries with normalized audit events", () => {
  const cancelled = cancelWorkflowFacadeRun(context, "wks_local_demo", "wfr_20260508_backup_check_01", exampleWorkflowRunFacadeState, () => new Date("2026-05-08T12:11:00Z"));
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.value.status, "cancelling");
  assert.equal(cancelled.value.auditEvents.at(-1).action, "workflow.run.cancel");
  assert.equal(cancelled.value.auditEvents.at(-1).engineRunId, "dagu-run-20260508-01");

  const retryState = clone(exampleWorkflowRunFacadeState);
  retryState.runs[0].status = "failed";
  retryState.runs[0].engine.status = "error";
  const retried = retryWorkflowFacadeRun(context, "wks_local_demo", "wfr_20260508_backup_check_01", retryState, () => new Date("2026-05-08T12:12:00Z"));
  assert.equal(retried.ok, true);
  assert.equal(retried.value.status, "retrying");
  assert.equal(retried.value.auditEvents.at(-1).action, "workflow.run.retry");
});

test("workflow run facade renders run logs artifacts and secrets without raw secret material", () => {
  const run = getWorkflowFacadeRun(context, "wks_local_demo", "wfr_20260508_backup_check_01");
  assert.equal(run.ok, true);
  assert.equal(run.value.logsSummary.available, true);
  assert.equal(run.value.artifactsSummary[0].name, "summary.json");
  assert.deepEqual(Object.keys(run.value.secretDependencies[0]).sort(), ["description", "namespace", "ref", "required", "status"].sort());
  assert.equal(JSON.stringify(run.value).includes("raw-workflow-secret"), false);
  assert.equal(JSON.stringify(run.value).includes("access-token-value"), false);
  assert.doesNotThrow(() => assertWorkflowRunFacadeSecretSafe(run.value));
  assert.throws(() => assertWorkflowRunFacadeSecretSafe({ ...run.value, accessToken: "access-token-value" }), /secret-like/);
});

test("workflow run facade docs cover endpoints status policy and no-secret rendering", async () => {
  const docs = await readFile(path.join(repoRoot, "docs", "reference", "workflow-run-facade.md"), "utf8");
  for (const requiredText of [
    "list workflows",
    "start run",
    "cancel run",
    "retry run",
    "run logs",
    "artifacts summary",
    "status normalization",
    "workspace/provider/broker policy checks",
    "secret dependency status by ref metadata only",
    "Dagu-specific fields",
    "raw secret values",
  ]) {
    assert.ok(docs.includes(requiredText), `Expected docs to include ${requiredText}`);
  }
});
