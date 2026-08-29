import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { appendAuditEvent, readAuditEvents } from "../dist/runtime/audit/store.js";
import { makeTempServicesRoot, writeExecutableFixtureService, writeManifest } from "./test-helpers.js";

async function runAuditAppendChild(input) {
  const child = spawn(process.execPath, ["tests/fixtures/audit-append-runner.mjs"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdin.end(JSON.stringify(input));
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  assert.equal(exitCode, 0, stderr);
  return JSON.parse(stdout.trim());
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

function createAuditInput(overrides = {}) {
  return {
    source: "runtime",
    action: "runtime.test",
    actor: "operator:test",
    outcome: "success",
    statusCode: 200,
    summary: "Runtime test completed",
    ...overrides,
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
    assert.equal(initial.body.source, "runtime-audit");
    assert.equal(initial.body.chainStatus, "unavailable");
    assert.equal(initial.body.rawMaterialReturned, false);
    assert.equal(initial.body.nextCursor, null);

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
      actor: "operator-ui",
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
    assert.equal(audit.body.source, "runtime-audit");
    assert.equal(audit.body.chainStatus, "verified");
    assert.equal(audit.body.rawMaterialReturned, false);
    assert.equal(audit.body.nextCursor, null);
    assert.equal(audit.body.pagination.total, 17);
    assert.deepEqual(
      audit.body.events.map((event) => event.action).sort(),
      [
        "permission.decision",
        "permission.decision",
        "permission.decision",
        "permission.decision",
        "permission.decision",
        "permission.decision",
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
    assert.equal(configEvent.chainStatus, "verified");
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

    const permissionEvents = audit.body.events.filter((event) => event.action === "permission.decision");
    assert.equal(permissionEvents.length, 6);
    const actionPermissionEvents = permissionEvents.filter(
      (event) => event.metadata.permission === "service.action.run",
    );
    assert.equal(actionPermissionEvents.length, 4);
    assert.ok(actionPermissionEvents.some((event) => event.subject === "dangerous-audit-proof" && event.outcome === "failure"));
    assert.deepEqual(
      permissionEvents
        .filter((event) => event.metadata.permission !== "service.action.run")
        .map((event) => event.metadata.permission)
        .sort(),
      ["service:configure", "service:install"],
    );

    const confirmationEvents = audit.body.events.filter(
      (event) => event.action === "service.action.run" && event.subject === "dangerous-audit-proof",
    );
    assert.equal(confirmationEvents.length, 2);
    assert.deepEqual(confirmationEvents.map((event) => event.actor), ["local-root", "local-root"]);
    assert.deepEqual(confirmationEvents.map((event) => event.outcome).sort(), ["failure", "success"]);
    const confirmationFailure = confirmationEvents.find((event) => event.outcome === "failure");
    assert.match(confirmationFailure.reason, /requires explicit confirmation/u);
    const confirmationSuccess = confirmationEvents.find((event) => event.outcome === "success");
    assert.equal(confirmationSuccess.relatedRevisionId, confirmedAction.body.run.runId);

    const scheduledEvent = audit.body.events.find(
      (event) => event.action === "service.action.run" && event.subject === "scheduled-audit-proof",
    );
    assert.equal(scheduledEvent.actor, "local-root");
    assert.equal(scheduledEvent.outcome, "success");
    assert.equal(scheduledEvent.relatedRevisionId, scheduledAction.body.run.runId);
    assert.match(scheduledEvent.summary, /dagu/u);

    const runtimeAudit = await getJson(`${apiServer.url}/api/audit?action=runtime.stopAll`);
    assert.equal(runtimeAudit.status, 200);
    assert.equal(runtimeAudit.body.events.length, 1);
    assert.equal(runtimeAudit.body.events[0].chainId, "runtime");
    assert.equal(runtimeAudit.body.chainStatus, "verified");

    const serviceScopedAudit = await getJson(`${apiServer.url}/api/services/audit-service/audit?limit=4`);
    assert.equal(serviceScopedAudit.status, 200);
    assert.equal(serviceScopedAudit.body.source, "runtime-audit");
    assert.equal(serviceScopedAudit.body.chainStatus, "verified");
    assert.equal(serviceScopedAudit.body.rawMaterialReturned, false);
    assert.equal(serviceScopedAudit.body.events.length, 4);
    assert.equal(serviceScopedAudit.body.pagination.total, 17);
    assert.equal(serviceScopedAudit.body.nextCursor, "4");
    assert.deepEqual([...new Set(serviceScopedAudit.body.events.map((event) => event.serviceId))], ["audit-service"]);

    const nextServiceAuditPage = await getJson(`${apiServer.url}/api/services/audit-service/audit?limit=4&cursor=${serviceScopedAudit.body.nextCursor}`);
    assert.equal(nextServiceAuditPage.status, 200);
    assert.equal(nextServiceAuditPage.body.events.length, 4);
    assert.equal(nextServiceAuditPage.body.pagination.total, 17);
    assert.equal(nextServiceAuditPage.body.nextCursor, "8");

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

    const serviceAuditFile = path.join(serviceRoot, ".state", "audit", `${new Date().toISOString().slice(0, 10)}.jsonl`);
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

test("audit store keeps service events in portable date-bucket JSONL files", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-audit-portable-");
  const serviceRoot = path.join(servicesRoot, "portable-service");

  try {
    await mkdir(serviceRoot, { recursive: true });
    const event = await appendAuditEvent(createAuditInput({
      serviceRoot,
      serviceId: "portable-service",
      source: "service",
      action: "service.lifecycle.install",
      summary: "Service portable-service installed",
    }));
    const auditFile = path.join(serviceRoot, ".state", "audit", `${event.timestamp.slice(0, 10)}.jsonl`);
    const raw = await readFile(auditFile, "utf8");

    assert.equal(raw.trim().split(/\r?\n/u).length, 1);
    assert.match(raw, /service\.lifecycle\.install/u);

    const movedRoot = path.join(servicesRoot, "portable-service-copy");
    await rename(serviceRoot, movedRoot);
    const result = await readAuditEvents({
      serviceRoots: [movedRoot],
      query: { serviceId: "portable-service" },
    });

    assert.equal(result.chainStatus, "verified");
    assert.equal(result.pagination.total, 1);
    assert.equal(result.events[0].id, event.id);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("#863 Audit appends are serialized across independent runtime processes", async () => {
  const { tempRoot } = await makeTempServicesRoot("service-lasso-audit-cross-process-");
  const workspaceRoot = path.join(tempRoot, "workspace");
  const runnerCount = 4;
  const eventsPerRunner = 12;
  const startAt = Date.now() + 750;
  try {
    const completed = await Promise.all(Array.from({ length: runnerCount }, (_, runnerId) =>
      runAuditAppendChild({ workspaceRoot, runnerId, count: eventsPerRunner, startAt })));
    assert.deepEqual(completed.map((entry) => entry.count), Array(runnerCount).fill(eventsPerRunner));

    const audit = await readAuditEvents({
      workspaceRoot,
      query: { action: "audit.cross-process", limit: runnerCount * eventsPerRunner },
    });
    assert.equal(audit.chainStatus, "verified");
    assert.equal(audit.pagination.total, runnerCount * eventsPerRunner);
    assert.equal(new Set(audit.events.map((event) => event.id)).size, runnerCount * eventsPerRunner);
    assert.deepEqual(
      audit.events.map((event) => event.sequence).sort((left, right) => left - right),
      Array.from({ length: runnerCount * eventsPerRunner }, (_, index) => index + 1),
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("#863 a delayed pre-midnight process appends to the non-regressing Audit bucket", async () => {
  const { tempRoot } = await makeTempServicesRoot("service-lasso-audit-rollover-");
  const workspaceRoot = path.join(tempRoot, "workspace");
  try {
    await runAuditAppendChild({
      workspaceRoot,
      runnerId: "post-midnight",
      count: 1,
      startAt: Date.now(),
      timestamp: "2026-08-30T00:00:00.001Z",
    });
    await runAuditAppendChild({
      workspaceRoot,
      runnerId: "delayed-pre-midnight",
      count: 1,
      startAt: Date.now(),
      timestamp: "2026-08-29T23:59:59.999Z",
    });

    const audit = await readAuditEvents({
      workspaceRoot,
      query: { action: "audit.cross-process", limit: 10 },
    });
    assert.equal(audit.chainStatus, "verified");
    assert.equal(audit.pagination.total, 2);
    assert.deepEqual(audit.events.map((event) => event.sequence).sort((left, right) => left - right), [1, 2]);
    const auditDir = path.join(workspaceRoot, ".service-lasso", "audit", "runtime");
    const newBucket = await readFile(path.join(auditDir, "2026-08-30.jsonl"), "utf8");
    assert.equal(newBucket.trim().split(/\r?\n/u).length, 2);
    await assert.rejects(
      readFile(path.join(auditDir, "2026-08-29.jsonl"), "utf8"),
      (error) => error?.code === "ENOENT",
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
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

test("audit API records update download and install failures without unsafe request material", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-audit-update-failure-");
  const workspaceRoot = path.join(tempRoot, "workspace");
  const releaseServer = await startAuditReleaseServer();
  await writeManifest(servicesRoot, "audit-update-service", createAuditUpdateManifest(releaseServer));
  const apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot });

  try {
    const check = await postJson(`${apiServer.url}/api/updates/check`, { serviceId: "audit-update-service" });
    assert.equal(check.status, 200);
    assert.equal(check.body.services[0].result.status, "update_available");

    const download = await postJson(`${apiServer.url}/api/services/audit-update-service/update/download`);
    assert.equal(download.status, 500);

    const install = await postJson(`${apiServer.url}/api/services/audit-update-service/update/install`, {
      force: "raw-update-secret",
    });
    assert.equal(install.status, 400);

    const audit = await getJson(`${apiServer.url}/api/audit?serviceId=audit-update-service&limit=10`);
    assert.equal(audit.status, 200);
    const downloadAudit = audit.body.events.find((event) => event.action === "service.update.download");
    const installAudit = audit.body.events.find((event) => event.action === "service.update.install");
    assert.equal(downloadAudit.outcome, "failure");
    assert.equal(downloadAudit.routeTemplate, "/api/services/:serviceId/update/download");
    assert.equal(installAudit.outcome, "failure");
    assert.equal(installAudit.statusCode, 400);
    assert.equal(installAudit.routeTemplate, "/api/services/:serviceId/update/install");
    assert.equal(JSON.stringify(audit.body).includes("raw-update-secret"), false);
  } finally {
    await apiServer.stop().catch(() => undefined);
    await releaseServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
    resetLifecycleState();
  }
});
