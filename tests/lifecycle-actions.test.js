import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile, rm } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { readStoredState } from "../dist/runtime/state/readState.js";
import { makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";

async function postJson(url) {
  const response = await fetch(url, { method: "POST" });
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function waitFor(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

test("lifecycle actions execute in the expected bounded order", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-lifecycle-");
  await writeExecutableFixtureService(servicesRoot, "echo-service");
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const install = await postJson(`${apiServer.url}/api/services/echo-service/install`);
    assert.equal(install.status, 200);
    assert.equal(install.body.action, "install");
    assert.equal(install.body.state.installed, true);
    assert.equal(install.body.state.configured, false);
    assert.equal(install.body.state.running, false);

    const config = await postJson(`${apiServer.url}/api/services/echo-service/config`);
    assert.equal(config.status, 200);
    assert.equal(config.body.action, "config");
    assert.equal(config.body.state.configured, true);

    const start = await postJson(`${apiServer.url}/api/services/echo-service/start`);
    assert.equal(start.status, 200);
    assert.equal(start.body.action, "start");
    assert.equal(start.body.state.running, true);
    assert.equal(start.body.state.runtime.pid > 0, true);
    assert.equal(typeof start.body.state.runtime.command, "string");

    const restart = await postJson(`${apiServer.url}/api/services/echo-service/restart`);
    assert.equal(restart.status, 200);
    assert.equal(restart.body.action, "restart");
    assert.equal(restart.body.state.running, true);
    assert.equal(restart.body.state.runtime.pid > 0, true);

    const stop = await postJson(`${apiServer.url}/api/services/echo-service/stop`);
    assert.equal(stop.status, 200);
    assert.equal(stop.body.action, "stop");
    assert.equal(stop.body.state.running, false);
    assert.equal(stop.body.state.runtime.pid, null);

    let detailBody;
    await waitFor(async () => {
      const detailResponse = await fetch(`${apiServer.url}/api/services/echo-service`);
      detailBody = await detailResponse.json();
      return detailBody.service.lifecycle.runtime.exitCode === 0;
    });

    assert.deepEqual(detailBody.service.lifecycle.actionHistory, ["install", "config", "start", "restart", "stop"]);
    assert.equal(detailBody.service.lifecycle.lastAction, "stop");
    assert.equal(detailBody.service.lifecycle.runtime.exitCode, 0);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("install and config materialize bounded on-disk artifacts and persist them in lifecycle state", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-lifecycle-");
  const { serviceRoot } = await writeExecutableFixtureService(servicesRoot, "materialized-service", {
    ports: {
      service: 41234,
    },
    install: {
      files: [
        {
          path: "./runtime/install.txt",
          content: "installed ${SERVICE_ID}",
        },
      ],
    },
    config: {
      files: [
        {
          path: "./runtime/config.env",
          content: "SERVICE_PORT=${SERVICE_PORT}\nSERVICE_ROOT=${SERVICE_ROOT}\n",
        },
      ],
    },
  });
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const install = await postJson(`${apiServer.url}/api/services/materialized-service/install`);
    const config = await postJson(`${apiServer.url}/api/services/materialized-service/config`);

    const installPath = path.join(serviceRoot, "runtime", "install.txt");
    const configPath = path.join(serviceRoot, "runtime", "config.env");
    const stored = await readStoredState(serviceRoot);

    assert.equal(install.status, 200);
    assert.deepEqual(install.body.state.installArtifacts.files, ["runtime/install.txt"]);
    assert.equal(typeof install.body.state.installArtifacts.updatedAt, "string");
    assert.equal(await readFile(installPath, "utf8"), "installed materialized-service");

    assert.equal(config.status, 200);
    assert.deepEqual(config.body.state.configArtifacts.files, ["runtime/config.env"]);
    assert.equal(typeof config.body.state.configArtifacts.updatedAt, "string");
    assert.equal(await readFile(configPath, "utf8"), `SERVICE_PORT=41234\nSERVICE_ROOT=${serviceRoot}\n`);
    assert.deepEqual(stored.install.files, ["runtime/install.txt"]);
    assert.deepEqual(stored.config.files, ["runtime/config.env"]);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("config can rerun without reinstall and rewrites effective config artifacts", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-lifecycle-");
  const { serviceRoot } = await writeExecutableFixtureService(servicesRoot, "rerunnable-config-service", {
    ports: {
      service: 41235,
    },
    config: {
      files: [
        {
          path: "./runtime/config.env",
          content: "SERVICE_PORT=${SERVICE_PORT}\nSERVICE_ID=${SERVICE_ID}\n",
        },
      ],
    },
  });
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    await postJson(`${apiServer.url}/api/services/rerunnable-config-service/install`);

    const firstConfig = await postJson(`${apiServer.url}/api/services/rerunnable-config-service/config`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const secondConfig = await postJson(`${apiServer.url}/api/services/rerunnable-config-service/config`);

    const configPath = path.join(serviceRoot, "runtime", "config.env");
    const detailResponse = await fetch(`${apiServer.url}/api/services/rerunnable-config-service`);
    const detailBody = await detailResponse.json();

    assert.equal(firstConfig.status, 200);
    assert.equal(secondConfig.status, 200);
    assert.equal(secondConfig.body.state.configured, true);
    assert.deepEqual(secondConfig.body.state.actionHistory, ["install", "config", "config"]);
    assert.equal(await readFile(configPath, "utf8"), "SERVICE_PORT=41235\nSERVICE_ID=rerunnable-config-service\n");
    assert.equal(detailResponse.status, 200);
    assert.deepEqual(detailBody.service.lifecycle.configArtifacts.files, ["runtime/config.env"]);
    assert.equal(typeof detailBody.service.lifecycle.configArtifacts.updatedAt, "string");
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("intentional stop keeps persisted lifecycle metadata on stop", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-lifecycle-");
  const { serviceRoot } = await writeExecutableFixtureService(servicesRoot, "echo-service");
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    await postJson(`${apiServer.url}/api/services/echo-service/install`);
    await postJson(`${apiServer.url}/api/services/echo-service/config`);
    await postJson(`${apiServer.url}/api/services/echo-service/start`);

    const stop = await postJson(`${apiServer.url}/api/services/echo-service/stop`);
    assert.equal(stop.status, 200);

    await waitFor(async () => {
      const stored = await readStoredState(serviceRoot);
      return stored.runtime.lastAction === "stop" && stored.runtime.running === false;
    });

    const stored = await readStoredState(serviceRoot);
    assert.equal(stored.runtime.lastAction, "stop");
    assert.deepEqual(stored.runtime.actionHistory, ["install", "config", "start", "stop"]);
    assert.equal(stored.runtime.running, false);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("start fails before config and keeps the error explicit", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-lifecycle-");
  await writeExecutableFixtureService(servicesRoot, "echo-service");
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const install = await postJson(`${apiServer.url}/api/services/echo-service/install`);
    assert.equal(install.status, 200);

    const start = await postJson(`${apiServer.url}/api/services/echo-service/start`);
    assert.equal(start.status, 409);
    assert.equal(start.body.error, "invalid_lifecycle_state");
    assert.equal(start.body.statusCode, 409);
    assert.match(start.body.message, /before config/i);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("unknown lifecycle actions return a deterministic client error", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-lifecycle-");
  await writeExecutableFixtureService(servicesRoot, "echo-service");
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const response = await postJson(`${apiServer.url}/api/services/echo-service/ship-it`);

    assert.equal(response.status, 400);
    assert.equal(response.body.error, "invalid_action");
    assert.equal(response.body.statusCode, 400);
    assert.match(response.body.message, /unknown lifecycle action/i);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runtime summary reflects running services after lifecycle actions", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-lifecycle-");
  await writeExecutableFixtureService(servicesRoot, "echo-service");
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    await postJson(`${apiServer.url}/api/services/echo-service/install`);
    await postJson(`${apiServer.url}/api/services/echo-service/config`);
    await postJson(`${apiServer.url}/api/services/echo-service/start`);

    const runtimeResponse = await fetch(`${apiServer.url}/api/runtime`);
    const runtimeBody = await runtimeResponse.json();

    assert.equal(runtimeResponse.status, 200);
    assert.equal(runtimeBody.runtime.runningServices, 1);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("start waits for configured readiness and returns healthy once ready", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-lifecycle-");
  await writeExecutableFixtureService(servicesRoot, "ready-file-service", {
    readyFileAfterMs: 120,
    readyFileRelativePath: "./runtime/ready.txt",
    healthcheck: {
      type: "file",
      file: "./runtime/ready.txt",
      retries: 8,
      interval: 50,
      start_period: 25,
    },
  });
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    await postJson(`${apiServer.url}/api/services/ready-file-service/install`);
    await postJson(`${apiServer.url}/api/services/ready-file-service/config`);

    const startedAt = Date.now();
    const start = await postJson(`${apiServer.url}/api/services/ready-file-service/start`);
    const elapsedMs = Date.now() - startedAt;

    assert.equal(start.status, 200);
    assert.equal(start.body.ok, true);
    assert.equal(start.body.state.running, true);
    assert.equal(start.body.health.type, "file");
    assert.equal(start.body.health.healthy, true);
    assert.match(start.body.message, /readiness succeeded/i);
    assert.ok(elapsedMs >= 75);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("start returns a deterministic non-ready result when readiness times out", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-lifecycle-");
  const { serviceRoot } = await writeExecutableFixtureService(servicesRoot, "not-ready-service", {
    healthcheck: {
      type: "file",
      file: "./runtime/ready.txt",
      retries: 3,
      interval: 25,
      start_period: 10,
    },
  });
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    await postJson(`${apiServer.url}/api/services/not-ready-service/install`);
    await postJson(`${apiServer.url}/api/services/not-ready-service/config`);

    const start = await postJson(`${apiServer.url}/api/services/not-ready-service/start`);

    assert.equal(start.status, 200);
    assert.equal(start.body.ok, false);
    assert.equal(start.body.action, "start");
    assert.equal(start.body.state.running, false);
    assert.equal(start.body.state.runtime.pid, null);
    assert.equal(start.body.health.type, "file");
    assert.equal(start.body.health.healthy, false);
    assert.match(start.body.message, /did not become ready/i);

    const stored = await readStoredState(serviceRoot);
    assert.equal(stored.runtime.lastAction, "start");
    assert.equal(stored.runtime.running, false);
    assert.deepEqual(stored.runtime.actionHistory, ["install", "config", "start"]);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
