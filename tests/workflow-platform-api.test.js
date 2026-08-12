import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import { exampleWorkflowPackageCatalog } from "../dist/platform/workflowCatalog.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function writePackage(root, packageDir, metadata, options = {}) {
  const packageRoot = path.join(root, packageDir);
  await mkdir(packageRoot, { recursive: true });
  await writeFile(path.join(packageRoot, "workflow-package.json"), JSON.stringify(metadata, null, 2));
  if (options.withDaguDefinitions !== false) {
    await mkdir(path.join(packageRoot, "workflows"), { recursive: true });
    for (const workflowId of metadata.workflows ?? []) {
      const workflowName = workflowId.split("/").at(-1);
      await writeFile(path.join(packageRoot, "workflows", `${workflowName}.yaml`), `name: ${workflowName}\nsteps: []\n`);
    }
  }
}

async function startTestApi() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-workflow-platform-api-"));
  const servicesRoot = path.join(tempRoot, "services");
  const workspaceRoot = path.join(tempRoot, "workspace");
  await mkdir(servicesRoot, { recursive: true });
  await mkdir(workspaceRoot, { recursive: true });
  const apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot });
  return { apiServer, tempRoot };
}

async function readJson(response) {
  return {
    status: response.status,
    body: await response.json(),
  };
}

function sourceFor(root, metadata) {
  return {
    id: metadata.id,
    source: metadata.source,
    repo: pathToFileURL(root).href,
    ref: metadata.repository.ref,
    channel: "stable",
  };
}

test("workflow platform API lists and validates workflow package catalog metadata", async () => {
  const { apiServer, tempRoot } = await startTestApi();
  try {
    const listed = await readJson(await fetch(`${apiServer.url}/api/platform/workflow-packages`));
    assert.equal(listed.status, 200);
    assert.equal(listed.body.ok, true);
    assert.deepEqual(listed.body.sources, { official: 1, custom: 1 });
    assert.equal(JSON.stringify(listed.body).includes("raw-workflow-secret"), false);

    const valid = clone(exampleWorkflowPackageCatalog[0].metadata);
    const colliding = clone(exampleWorkflowPackageCatalog[1].metadata);
    colliding.workflows = [valid.workflows[0]];
    const validation = await readJson(await fetch(`${apiServer.url}/api/platform/workflow-packages/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ packages: [valid, colliding] }),
    }));
    assert.equal(validation.status, 200);
    assert.equal(validation.body.ok, false);
    assert.equal(validation.body.diagnostics.some((diagnostic) => diagnostic.code === "workflow-collision"), true);

    const unsafe = clone(valid);
    unsafe.validation = [{ name: "unsafe", command: "echo", args: ["raw-workflow-secret"] }];
    const unsafeValidation = await readJson(await fetch(`${apiServer.url}/api/platform/workflow-packages/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ metadata: unsafe }),
    }));
    assert.equal(unsafeValidation.status, 200);
    assert.equal(unsafeValidation.body.ok, false);
    assert.equal(unsafeValidation.body.packages.length, 0);
    assert.equal(JSON.stringify(unsafeValidation.body).includes("raw-workflow-secret"), false);
  } finally {
    await apiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("workflow platform API exposes repo state activate sync and rollback over HTTP", async () => {
  const { apiServer, tempRoot } = await startTestApi();
  const firstRoot = path.join(tempRoot, "first-source");
  const secondRoot = path.join(tempRoot, "second-source");
  const first = clone(exampleWorkflowPackageCatalog[0].metadata);
  const second = clone(first);
  first.repository.repo = pathToFileURL(firstRoot).href;
  second.version = "2026.5.9";
  second.repository.ref = "2026.5.9";
  second.repository.repo = pathToFileURL(secondRoot).href;
  try {
    await writePackage(firstRoot, first.id, first);
    await writePackage(secondRoot, second.id, second);

    const emptyState = await readJson(await fetch(`${apiServer.url}/api/platform/workflow-repos/state`));
    assert.equal(emptyState.status, 200);
    assert.deepEqual(emptyState.body.history, []);

    const firstActivation = await readJson(await fetch(`${apiServer.url}/api/platform/workflow-repos/activate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sources: [sourceFor(firstRoot, first)] }),
    }));
    assert.equal(firstActivation.status, 200);
    assert.equal(firstActivation.body.ok, true);
    assert.equal(firstActivation.body.active.revision, "official.core.maintenance@2026.5.8");

    const secondActivation = await readJson(await fetch(`${apiServer.url}/api/platform/workflow-repos/sync`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sources: [sourceFor(secondRoot, second)] }),
    }));
    assert.equal(secondActivation.status, 200);
    assert.equal(secondActivation.body.ok, true);
    assert.equal(secondActivation.body.state.previousGood.revision, firstActivation.body.active.revision);

    const rollback = await readJson(await fetch(`${apiServer.url}/api/platform/workflow-repos/rollback`, { method: "POST" }));
    assert.equal(rollback.status, 200);
    assert.equal(rollback.body.active.revision, firstActivation.body.active.revision);
    assert.equal(rollback.body.history.at(-1).result, "rolled-back");

    const audit = await readJson(await fetch(`${apiServer.url}/api/audit?source=runtime-api&limit=20`));
    assert.equal(audit.status, 200);
    const auditActions = audit.body.events.map((event) => event.action);
    assert.ok(auditActions.includes("workflow.repo.activate"));
    assert.ok(auditActions.includes("workflow.repo.sync"));
    assert.ok(auditActions.includes("workflow.repo.rollback"));
    const activationAudit = audit.body.events.find((event) => event.action === "workflow.repo.activate");
    assert.equal(activationAudit.outcome, "success");
    assert.deepEqual(activationAudit.metadata.sourceIds, [first.id]);
    assert.deepEqual(activationAudit.metadata.sourceRefs, [first.repository.ref]);
    assert.equal(activationAudit.metadata.packageCount, 1);
    assert.equal(JSON.stringify(audit.body).includes(firstRoot), false);
    assert.equal(JSON.stringify(audit.body).includes(secondRoot), false);
  } finally {
    await apiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("workflow platform API rejects unsafe repo activation inputs before promotion", async () => {
  const { apiServer, tempRoot } = await startTestApi();
  const officialRoot = path.join(tempRoot, "official-source");
  const customRoot = path.join(tempRoot, "custom-source");
  const missingDaguRoot = path.join(tempRoot, "missing-dagu-source");
  const official = clone(exampleWorkflowPackageCatalog[0].metadata);
  const custom = clone(exampleWorkflowPackageCatalog[1].metadata);
  official.repository.repo = pathToFileURL(officialRoot).href;
  custom.repository.ref = "v0.1.0";
  custom.repository.repo = pathToFileURL(customRoot).href;
  custom.workflows = [official.workflows[0]];
  const missingDagu = clone(official);
  missingDagu.repository.ref = "2026.5.10";
  missingDagu.repository.repo = pathToFileURL(missingDaguRoot).href;
  try {
    await writePackage(officialRoot, official.id, official);
    await writePackage(customRoot, custom.id, custom);
    await writePackage(missingDaguRoot, missingDagu.id, missingDagu, { withDaguDefinitions: false });

    const empty = await readJson(await fetch(`${apiServer.url}/api/platform/workflow-repos/activate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sources: [] }),
    }));
    assert.equal(empty.status, 400);
    assert.equal(empty.body.diagnostics.some((diagnostic) => diagnostic.field === "sources"), true);

    const mutable = await readJson(await fetch(`${apiServer.url}/api/platform/workflow-repos/activate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sources: [{ ...sourceFor(officialRoot, official), ref: "main" }] }),
    }));
    assert.equal(mutable.status, 400);
    assert.equal(mutable.body.diagnostics.some((diagnostic) => diagnostic.field === "ref"), true);

    const collision = await readJson(await fetch(`${apiServer.url}/api/platform/workflow-repos/activate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sources: [sourceFor(officialRoot, official), sourceFor(customRoot, custom)] }),
    }));
    assert.equal(collision.status, 400);
    assert.equal(collision.body.diagnostics.some((diagnostic) => diagnostic.code === "workflow-collision"), true);

    const missingDaguDefinition = await readJson(await fetch(`${apiServer.url}/api/platform/workflow-repos/activate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sources: [sourceFor(missingDaguRoot, missingDagu)] }),
    }));
    assert.equal(missingDaguDefinition.status, 400);
    assert.equal(missingDaguDefinition.body.diagnostics.some((diagnostic) => /Dagu workflow definition/.test(diagnostic.message)), true);

    const secretBearingRepoUrl = `${pathToFileURL(officialRoot).href}?token=raw-workflow-secret`;
    const secretBearingActivation = await readJson(await fetch(`${apiServer.url}/api/platform/workflow-repos/activate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-service-lasso-user-id": "token=raw-workflow-secret",
      },
      body: JSON.stringify({ sources: [{ ...sourceFor(officialRoot, official), repo: secretBearingRepoUrl }] }),
    }));
    assert.equal(secretBearingActivation.status, 400);

    const audit = await readJson(await fetch(`${apiServer.url}/api/audit?source=runtime-api&action=workflow.repo.activate&outcome=failure&limit=20`));
    assert.equal(audit.status, 200);
    assert.ok(audit.body.events.length >= 4);
    const serializedAudit = JSON.stringify(audit.body);
    assert.equal(serializedAudit.includes("raw-workflow-secret"), false);
    assert.equal(serializedAudit.includes(secretBearingRepoUrl), false);
    assert.ok(audit.body.events.some((event) => event.actor === "token=[redacted]"));
  } finally {
    await apiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
