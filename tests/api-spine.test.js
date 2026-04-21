import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import {
  clearPersistedFixtureState,
  makeTempServicesRoot,
  writeExecutableFixtureService,
} from "./test-helpers.js";

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

test("GET /api/health returns core API health", async () => {
  const apiServer = await startApiServer({ port: 0, version: "test-version" });

  try {
    const result = await getJson(`${apiServer.url}/api/health`);

    assert.equal(result.status, 200);
    assert.equal(result.body.service, "service-lasso");
    assert.equal(result.body.status, "ok");
    assert.equal(result.body.mode, "development");
    assert.equal(result.body.api.status, "up");
    assert.equal(result.body.api.version, "test-version");
  } finally {
    await apiServer.stop();
  }
});

test("GET /api/services returns discovered services from the tracked services root", async () => {
  const servicesRoot = path.resolve("services");
  await clearPersistedFixtureState(servicesRoot);
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const result = await getJson(`${apiServer.url}/api/services`);

    assert.equal(result.status, 200);
    assert.ok(Array.isArray(result.body.services));
    assert.equal(result.body.services.length, 4);
    assert.deepEqual(
      result.body.services.map((service) => service.id),
      ["@node", "@python", "echo-service", "node-sample-service"],
    );
    assert.equal(result.body.services[0].status, "discovered");
    assert.equal(result.body.services[0].source, "manifest");
  } finally {
    await apiServer.stop();
    await clearPersistedFixtureState(servicesRoot);
  }
});

test("runtime boots from explicit servicesRoot and workspaceRoot config", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-config-"));
  const workspaceRoot = path.join(tempRoot, "workspace");

  try {
    const apiServer = await startApiServer({
      port: 0,
      servicesRoot: path.resolve("services"),
      workspaceRoot,
      version: "config-test",
    });

    try {
      const result = await getJson(`${apiServer.url}/api/runtime`);

      assert.equal(result.status, 200);
      assert.equal(result.body.runtime.servicesRoot, path.resolve("services"));
      assert.equal(result.body.runtime.workspaceRoot, path.resolve(workspaceRoot));
    } finally {
      await apiServer.stop();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runtime rejects a missing servicesRoot during startup validation", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-config-"));
  const missingServicesRoot = path.join(tempRoot, "missing-services");
  const workspaceRoot = path.join(tempRoot, "workspace");
  await mkdir(workspaceRoot, { recursive: true });

  await assert.rejects(
    () =>
      startApiServer({
        port: 0,
        servicesRoot: missingServicesRoot,
        workspaceRoot,
      }),
    /servicesRoot does not exist/i,
  );

  await rm(tempRoot, { recursive: true, force: true });
});

test("POST /api/runtime/actions/startAll and stopAll orchestrate eligible services in deterministic order", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-runtime-actions-");
  await writeExecutableFixtureService(servicesRoot, "alpha-service");
  await writeExecutableFixtureService(servicesRoot, "bravo-service", {
    depend_on: ["alpha-service"],
  });
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    for (const serviceId of ["alpha-service", "bravo-service"]) {
      let result = await postJson(`${apiServer.url}/api/services/${serviceId}/install`);
      assert.equal(result.status, 200);
      result = await postJson(`${apiServer.url}/api/services/${serviceId}/config`);
      assert.equal(result.status, 200);
    }

    const startAll = await postJson(`${apiServer.url}/api/runtime/actions/startAll`);
    assert.equal(startAll.status, 200);
    assert.equal(startAll.body.action, "startAll");
    assert.equal(startAll.body.ok, true);
    assert.deepEqual(
      startAll.body.results.map((result) => result.serviceId),
      ["alpha-service", "bravo-service"],
    );
    assert.deepEqual(startAll.body.skipped, []);
    assert.equal(startAll.body.results[0].state.running, true);
    assert.equal(startAll.body.results[1].state.running, true);

    const stopAll = await postJson(`${apiServer.url}/api/runtime/actions/stopAll`);
    assert.equal(stopAll.status, 200);
    assert.equal(stopAll.body.action, "stopAll");
    assert.equal(stopAll.body.ok, true);
    assert.deepEqual(
      stopAll.body.results.map((result) => result.serviceId),
      ["bravo-service", "alpha-service"],
    );
    assert.deepEqual(stopAll.body.skipped, []);
    assert.equal(stopAll.body.results[0].state.running, false);
    assert.equal(stopAll.body.results[1].state.running, false);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("POST /api/runtime/actions/startAll skips ineligible services deterministically", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-runtime-skips-");
  await writeExecutableFixtureService(servicesRoot, "alpha-installed-only");
  await writeExecutableFixtureService(servicesRoot, "bravo-missing-install");
  await writeExecutableFixtureService(servicesRoot, "charlie-running");
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    let result = await postJson(`${apiServer.url}/api/services/alpha-installed-only/install`);
    assert.equal(result.status, 200);

    for (const action of ["install", "config", "start"]) {
      result = await postJson(`${apiServer.url}/api/services/charlie-running/${action}`);
      assert.equal(result.status, 200);
    }

    const startAll = await postJson(`${apiServer.url}/api/runtime/actions/startAll`);
    assert.equal(startAll.status, 200);
    assert.equal(startAll.body.action, "startAll");
    assert.equal(startAll.body.ok, true);
    assert.deepEqual(startAll.body.results, []);
    assert.deepEqual(startAll.body.skipped, [
      { serviceId: "alpha-installed-only", reason: "not_configured" },
      { serviceId: "bravo-missing-install", reason: "not_installed" },
      { serviceId: "charlie-running", reason: "already_running" },
    ]);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
