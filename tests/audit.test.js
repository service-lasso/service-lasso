import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile, rm } from "node:fs/promises";
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

async function postJson(url) {
  const response = await fetch(url, { method: "POST" });
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

test("audit API returns durable safe service and runtime mutation events after restart", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-audit-");
  const workspaceRoot = path.join(tempRoot, "workspace");
  const { serviceRoot } = await writeExecutableFixtureService(servicesRoot, "audit-service", {
    healthcheck: { type: "process" },
  });
  let apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot });

  try {
    const initial = await getJson(`${apiServer.url}/api/audit`);
    assert.equal(initial.status, 200);
    assert.deepEqual(initial.body.events, []);

    const install = await postJson(`${apiServer.url}/api/services/audit-service/install`);
    assert.equal(install.status, 200);
    const meta = await patchJson(`${apiServer.url}/api/services/audit-service/meta`, { favorite: true });
    assert.equal(meta.status, 200);
    const runtime = await postJson(`${apiServer.url}/api/runtime/actions/stopAll`);
    assert.equal(runtime.status, 200);

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
    assert.equal(audit.body.pagination.total, 3);
    assert.deepEqual(
      audit.body.events.map((event) => event.action).sort(),
      ["service.config.save", "service.lifecycle.install", "service.meta.update"],
    );

    const configEvent = audit.body.events.find((event) => event.action === "service.config.save");
    assert.equal(configEvent.actor, "operator-ui");
    assert.equal(configEvent.relatedRevisionId, save.body.backup.id);
    assert.equal(configEvent.outcome, "success");
    assert.equal(configEvent.chainId, "service:audit-service");
    assert.ok(configEvent.eventHash);
    assert.equal(configEvent.chainStatus, "valid");

    const runtimeAudit = await getJson(`${apiServer.url}/api/audit?action=runtime.stopAll`);
    assert.equal(runtimeAudit.status, 200);
    assert.equal(runtimeAudit.body.events.length, 1);
    assert.equal(runtimeAudit.body.events[0].chainId, "runtime");

    const secretSearch = await getJson(`${apiServer.url}/api/audit?query=SUPER_SECRET_VALUE`);
    assert.equal(secretSearch.status, 200);
    assert.equal(secretSearch.body.pagination.total, 0);

    const serviceAuditFile = path.join(serviceRoot, ".state", "audit", "events.jsonl");
    const runtimeAuditFile = path.join(workspaceRoot, ".service-lasso", "audit", "runtime", `${new Date().toISOString().slice(0, 10)}.jsonl`);
    assert.doesNotMatch(await readFile(serviceAuditFile, "utf8"), /SUPER_SECRET_VALUE/u);
    assert.doesNotMatch(await readFile(runtimeAuditFile, "utf8"), /SUPER_SECRET_VALUE/u);
  } finally {
    await apiServer.stop().catch(() => undefined);
    await rm(tempRoot, { recursive: true, force: true });
    resetLifecycleState();
  }
});
