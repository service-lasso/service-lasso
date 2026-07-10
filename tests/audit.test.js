import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";

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
    const meta = await patchJson(`${apiServer.url}/api/services/audit-service/meta`, { favorite: true });
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

    await apiServer.stop();
    apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot });

    const audit = await getJson(`${apiServer.url}/api/audit?serviceId=audit-service&limit=10`);
    assert.equal(audit.status, 200);
    assert.equal(audit.body.pagination.total, 7);
    assert.deepEqual(
      audit.body.events.map((event) => event.action).sort(),
      [
        "service.action.run",
        "service.config.save",
        "service.lifecycle.config",
        "service.lifecycle.install",
        "service.meta.update",
        "service.recovery.doctor",
        "service.setup.run",
      ],
    );

    const configEvent = audit.body.events.find((event) => event.action === "service.config.save");
    assert.equal(configEvent.actor, "operator-ui");
    assert.equal(configEvent.relatedRevisionId, save.body.backup.id);
    assert.equal(configEvent.outcome, "success");
    assert.equal(configEvent.chainId, "service:audit-service");
    assert.ok(configEvent.eventHash);
    assert.equal(configEvent.chainStatus, "valid");

    const setupEvent = audit.body.events.find((event) => event.action === "service.setup.run");
    assert.equal(setupEvent.subject, "write-audit-proof");
    assert.equal(setupEvent.outcome, "success");
    assert.equal(setupEvent.relatedRevisionId, setup.body.runs[0].runId);

    const recoveryEvent = audit.body.events.find((event) => event.action === "service.recovery.doctor");
    assert.equal(recoveryEvent.subject, "doctor");
    assert.equal(recoveryEvent.outcome, "success");

    const actionEvent = audit.body.events.find((event) => event.action === "service.action.run");
    assert.equal(actionEvent.subject, "write-audit-proof");
    assert.equal(actionEvent.outcome, "success");
    assert.equal(actionEvent.relatedRevisionId, action.body.run.runId);

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

    const serviceAuditFile = path.join(serviceRoot, ".state", "audit", "events.jsonl");
    const runtimeAuditFile = path.join(workspaceRoot, ".service-lasso", "audit", "runtime", `${new Date().toISOString().slice(0, 10)}.jsonl`);
    assert.doesNotMatch(await readFile(serviceAuditFile, "utf8"), /SUPER_SECRET_VALUE/u);
    assert.doesNotMatch(await readFile(serviceAuditFile, "utf8"), /AUDIT_SECRET_OUTPUT/u);
    assert.doesNotMatch(await readFile(runtimeAuditFile, "utf8"), /SUPER_SECRET_VALUE/u);
  } finally {
    await apiServer.stop().catch(() => undefined);
    await rm(tempRoot, { recursive: true, force: true });
    resetLifecycleState();
  }
});
