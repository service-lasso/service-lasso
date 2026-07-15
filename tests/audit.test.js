import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createServer } from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { makeTempServicesRoot, writeExecutableFixtureService, writeManifest } from "./test-helpers.js";

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
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function patchJson(url, body) {
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function putJson(url, body) {
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function writeAuditScript(serviceRoot) {
  const runtimeRoot = path.join(serviceRoot, "runtime");
  await mkdir(runtimeRoot, { recursive: true });
  await writeFile(
    path.join(runtimeRoot, "audit-writer.mjs"),
    [
      "console.log('AUDIT_SECRET_OUTPUT');",
      "console.error('AUDIT_SECRET_STDERR');",
    ].join("\n"),
    "utf8",
  );
}

async function startAuditReleaseServer() {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/repos/service-lasso/audit-update-fixture/releases/latest") {
      const baseUrl = `http://127.0.0.1:${server.address().port}`;
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify({
        tag_name: "2026.4.24-new",
        name: "2026.4.24-new",
        html_url: `${baseUrl}/releases/2026.4.24-new`,
        published_at: "2026-04-24T00:00:00Z",
        assets: [
          {
            name: "audit-update-fixture.zip",
            browser_download_url: `${baseUrl}/downloads/audit-update-fixture.zip`,
          },
        ],
      }));
      return;
    }

    response.statusCode = 404;
    response.end();
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    stop: async () => {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function createAuditUpdateManifest(releaseServer) {
  return {
    id: "audit-update-service",
    name: "Audit Update Service",
    description: "Release-backed fixture for audit update checks.",
    version: "2026.4.20-old",
    artifact: {
      kind: "archive",
      source: {
        type: "github-release",
        repo: "service-lasso/audit-update-fixture",
        tag: "2026.4.20-old",
        api_base_url: releaseServer.baseUrl,
      },
      platforms: {
        default: {
          assetName: "audit-update-fixture.zip",
          archiveType: "zip",
          command: "node",
          args: ["runtime/audit-update-fixture.mjs"],
        },
      },
    },
    updates: {
      mode: "notify",
      track: "latest",
    },
  };
}

test("audit API returns durable safe service and runtime mutation events after restart", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-audit-");
  const workspaceRoot = path.join(tempRoot, "workspace");
  const { serviceRoot } = await writeExecutableFixtureService(servicesRoot, "audit-service", {
    healthcheck: { type: "process" },
    doctor: {
      enabled: true,
      failurePolicy: "block",
      steps: [
        {
          name: "doctor-pass",
          command: process.execPath,
          args: ["-e", "process.exit(0)"],
        },
      ],
    },
    setup: {
      steps: {
        "write-audit-proof": {
          executable: process.execPath,
          args: ["runtime/audit-writer.mjs"],
          timeoutSeconds: 5,
        },
      },
    },
    actions: {
      "write-audit-proof": {
        mode: "command",
        command: process.execPath,
        args: ["runtime/audit-writer.mjs"],
        timeoutSeconds: 5,
      },
      "dangerous-audit-proof": {
        mode: "command",
        command: process.execPath,
        args: ["-e", "process.exit(0)"],
        requiresConfirmation: true,
      },
      "scheduled-audit-proof": {
        mode: "command",
        command: process.execPath,
        args: ["runtime/audit-writer.mjs"],
        schedules: {
          nightly: {
            cron: "15 2 * * *",
          },
        },
      },
    },
  });
  await writeAuditScript(serviceRoot);
  let apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot });

  try {
    const initial = await getJson(`${apiServer.url}/api/audit`);
    assert.equal(initial.status, 200);
    assert.deepEqual(initial.body.events, []);

    const install = await postJson(`${apiServer.url}/api/services/audit-service/install`);
    assert.equal(install.status, 200);
    const config = await postJson(`${apiServer.url}/api/services/audit-service/config`);
    assert.equal(config.status, 200);
    const meta = await patchJson(`${apiServer.url}/api/services/audit-service/meta`, {
      actor: "operator-ui",
      reason: "pin favorite and graph position",
      favorite: true,
      dependencyGraphPosition: { x: 12, y: 34 },
    });
    assert.equal(meta.status, 200);
    const runtime = await postJson(`${apiServer.url}/api/runtime/actions/stopAll`);
    assert.equal(runtime.status, 200);
    const setup = await postJson(`${apiServer.url}/api/services/audit-service/setup/run/write-audit-proof`);
    assert.equal(setup.status, 200);
    const recovery = await postJson(`${apiServer.url}/api/services/audit-service/recovery/doctor`);
    assert.equal(recovery.status, 200);
    const action = await postJson(`${apiServer.url}/api/services/audit-service/actions/write-audit-proof/runs`, {
      source: "manual",
    });
    assert.equal(action.status, 200);
    const missingConfirmation = await postJson(`${apiServer.url}/api/services/audit-service/actions/dangerous-audit-proof/runs`, {
      actor: "operator-ui",
    });
    assert.equal(missingConfirmation.status, 409);
    assert.equal(missingConfirmation.body.error, "confirmation_required");
    const confirmedAction = await postJson(`${apiServer.url}/api/services/audit-service/actions/dangerous-audit-proof/runs`, {
      actor: "operator-ui",
      confirm: true,
    });
    assert.equal(confirmedAction.status, 200);
    const scheduledAction = await postJson(`${apiServer.url}/api/services/audit-service/actions/scheduled-audit-proof/runs`, {
      source: "dagu",
      workflowId: "audit.workflow.nightly",
      scheduleId: "nightly",
      stepId: "run-audit-proof",
      parentActionId: "audit-parent",
      actor: "workflow-engine",
      params: {
        unsafe: "WORKFLOW_SECRET_PARAM",
      },
    });
    assert.equal(scheduledAction.status, 200);

    const currentConfig = await getJson(`${apiServer.url}/api/services/audit-service/config`);
    assert.equal(currentConfig.status, 200);
    const editedConfig = {
      ...JSON.parse(currentConfig.body.content),
      env: {
        SECRET_TOKEN: "SUPER_SECRET_VALUE",
      },
    };
    const save = await putJson(`${apiServer.url}/api/services/audit-service/config`, {
      actor: "operator-ui",
      reason: "metadata-only audit coverage",
      content: JSON.stringify(editedConfig, null, 2),
    });
    assert.equal(save.status, 200);
    const invalidSave = await putJson(`${apiServer.url}/api/services/audit-service/config`, {
      actor: "operator-ui",
      reason: "bad config should still audit safely",
      content: '{"id":"audit-service","env":{"SECRET_TOKEN":"SUPER_SECRET_VALUE"',
    });
    assert.equal(invalidSave.status, 400);

    await apiServer.stop();
    apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot });

    const audit = await getJson(`${apiServer.url}/api/audit?serviceId=audit-service&limit=20`);
    assert.equal(audit.status, 200);
    assert.equal(audit.body.pagination.total, 11);
    assert.deepEqual(
      audit.body.events.map((event) => event.action).sort(),
      [
        "service.action.run",
        "service.action.run",
        "service.action.run",
        "service.action.run",
        "service.config.save",
        "service.config.save",
        "service.lifecycle.config",
        "service.lifecycle.install",
        "service.meta.update",
        "service.recovery.doctor",
        "service.setup.run",
      ],
    );

    const metaEvent = audit.body.events.find((event) => event.action === "service.meta.update");
    assert.equal(metaEvent.actor, "operator-ui");
    assert.equal(metaEvent.reason, "pin favorite and graph position");
    assert.deepEqual(metaEvent.metadata.changedFields, ["favorite", "dependencyGraphPosition"]);
    assert.equal(metaEvent.metadata.favorite, true);
    assert.deepEqual(metaEvent.metadata.dependencyGraphPosition, { x: 12, y: 34 });

    const configEvent = audit.body.events.find((event) => event.action === "service.config.save" && event.outcome === "success");
    assert.equal(configEvent.actor, "operator-ui");
    assert.equal(configEvent.reason, "metadata-only audit coverage");
    assert.equal(configEvent.relatedRevisionId, save.body.backup.id);
    assert.equal(configEvent.outcome, "success");
    assert.equal(configEvent.chainId, "service:audit-service");
    assert.ok(configEvent.eventHash);
    assert.equal(configEvent.chainStatus, "valid");
    assert.equal(configEvent.metadata.configPath, "service.json");
    assert.equal(configEvent.metadata.previousHash, save.body.backup.previousHash);
    assert.equal(configEvent.metadata.currentHash, save.body.backup.currentHash);
    assert.equal(configEvent.metadata.validationStatus, "valid");

    const configFailure = audit.body.events.find((event) => event.action === "service.config.save" && event.outcome === "failure");
    assert.equal(configFailure.actor, "operator-ui");
    assert.match(configFailure.reason, /valid JSON object string/u);
    assert.equal(configFailure.relatedRevisionId, null);
    assert.equal(configFailure.metadata.configPath, "service.json");
    assert.equal(configFailure.metadata.validationStatus, "invalid");
    assert.equal(configFailure.metadata.requestedReason, "bad config should still audit safely");
    assert.equal(typeof configFailure.metadata.previousHash, "string");
    assert.equal(typeof configFailure.metadata.currentHash, "string");

    const setupEvent = audit.body.events.find((event) => event.action === "service.setup.run");
    assert.equal(setupEvent.subject, "write-audit-proof");
    assert.equal(setupEvent.outcome, "success");
    assert.equal(setupEvent.relatedRevisionId, setup.body.runs[0].runId);

    const recoveryEvent = audit.body.events.find((event) => event.action === "service.recovery.doctor");
    assert.equal(recoveryEvent.subject, "doctor");
    assert.equal(recoveryEvent.outcome, "success");

    const actionEvent = audit.body.events.find(
      (event) => event.action === "service.action.run" && event.subject === "write-audit-proof",
    );
    assert.equal(actionEvent.subject, "write-audit-proof");
    assert.equal(actionEvent.outcome, "success");
    assert.equal(actionEvent.relatedRevisionId, action.body.run.runId);

    const confirmationEvents = audit.body.events.filter((event) => event.subject === "dangerous-audit-proof");
    assert.equal(confirmationEvents.length, 2);
    assert.deepEqual(confirmationEvents.map((event) => event.actor), ["operator-ui", "operator-ui"]);
    assert.deepEqual(confirmationEvents.map((event) => event.outcome).sort(), ["failure", "success"]);
    const confirmationFailure = confirmationEvents.find((event) => event.outcome === "failure");
    assert.match(confirmationFailure.reason, /requires explicit confirmation/u);
    const confirmationSuccess = confirmationEvents.find((event) => event.outcome === "success");
    assert.equal(confirmationSuccess.relatedRevisionId, confirmedAction.body.run.runId);

    const scheduledEvent = audit.body.events.find((event) => event.subject === "scheduled-audit-proof");
    assert.equal(scheduledEvent.actor, "workflow-engine");
    assert.equal(scheduledEvent.outcome, "success");
    assert.equal(scheduledEvent.relatedRevisionId, scheduledAction.body.run.runId);
    assert.match(scheduledEvent.summary, /dagu/u);

    const runtimeAudit = await getJson(`${apiServer.url}/api/audit?action=runtime.stopAll`);
    assert.equal(runtimeAudit.status, 200);
    assert.equal(runtimeAudit.body.events.length, 1);
    assert.equal(runtimeAudit.body.events[0].chainId, "runtime");

    const secretSearch = await getJson(`${apiServer.url}/api/audit?query=SUPER_SECRET_VALUE`);
    assert.equal(secretSearch.status, 200);
    assert.equal(secretSearch.body.pagination.total, 0);
    const setupOutputSearch = await getJson(`${apiServer.url}/api/audit?query=AUDIT_SECRET_OUTPUT`);
    assert.equal(setupOutputSearch.status, 200);
    assert.equal(setupOutputSearch.body.pagination.total, 0);
    const workflowParamSearch = await getJson(`${apiServer.url}/api/audit?query=WORKFLOW_SECRET_PARAM`);
    assert.equal(workflowParamSearch.status, 200);
    assert.equal(workflowParamSearch.body.pagination.total, 0);
    assert.equal(JSON.stringify(audit.body).includes("SUPER_SECRET_VALUE"), false);

    const serviceAuditFile = path.join(serviceRoot, ".state", "audit", "events.jsonl");
    const runtimeAuditFile = path.join(workspaceRoot, ".service-lasso", "audit", "runtime", `${new Date().toISOString().slice(0, 10)}.jsonl`);
    assert.doesNotMatch(await readFile(serviceAuditFile, "utf8"), /SUPER_SECRET_VALUE/u);
    assert.doesNotMatch(await readFile(serviceAuditFile, "utf8"), /AUDIT_SECRET_OUTPUT/u);
    assert.doesNotMatch(await readFile(serviceAuditFile, "utf8"), /WORKFLOW_SECRET_PARAM/u);
    assert.doesNotMatch(await readFile(runtimeAuditFile, "utf8"), /SUPER_SECRET_VALUE/u);
  } finally {
    await apiServer.stop().catch(() => undefined);
    await rm(tempRoot, { recursive: true, force: true });
    resetLifecycleState();
  }
});

test("audit API records update checks that mutate durable update state", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-audit-update-");
  const workspaceRoot = path.join(tempRoot, "workspace");
  const releaseServer = await startAuditReleaseServer();
  await writeManifest(servicesRoot, "audit-update-service", createAuditUpdateManifest(releaseServer));
  let apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot });

  try {
    const check = await postJson(`${apiServer.url}/api/updates/check`, { serviceId: "audit-update-service" });
    assert.equal(check.status, 200);
    assert.equal(check.body.services[0].result.status, "update_available");

    await apiServer.stop();
    apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot });

    const audit = await getJson(`${apiServer.url}/api/audit?action=service.update.check`);
    assert.equal(audit.status, 200);
    assert.equal(audit.body.pagination.total, 1);
    assert.equal(audit.body.events[0].serviceId, "audit-update-service");
    assert.equal(audit.body.events[0].outcome, "success");
    assert.equal(audit.body.events[0].relatedRevisionId, "2026.4.24-new");
    assert.match(audit.body.events[0].summary, /update_available/u);
  } finally {
    await apiServer.stop().catch(() => undefined);
    await releaseServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
    resetLifecycleState();
  }
});
