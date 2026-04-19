import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { startApiServer } from "../dist/server/index.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";

const servicesRoot = path.resolve("services");

async function postJson(url) {
  const response = await fetch(url, { method: "POST" });
  return {
    status: response.status,
    body: await response.json(),
  };
}

test("lifecycle actions execute in the expected bounded order", async () => {
  resetLifecycleState();
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

    const restart = await postJson(`${apiServer.url}/api/services/echo-service/restart`);
    assert.equal(restart.status, 200);
    assert.equal(restart.body.action, "restart");
    assert.equal(restart.body.state.running, true);

    const stop = await postJson(`${apiServer.url}/api/services/echo-service/stop`);
    assert.equal(stop.status, 200);
    assert.equal(stop.body.action, "stop");
    assert.equal(stop.body.state.running, false);

    const detailResponse = await fetch(`${apiServer.url}/api/services/echo-service`);
    const detailBody = await detailResponse.json();
    assert.deepEqual(detailBody.service.lifecycle.actionHistory, ["install", "config", "start", "restart", "stop"]);
    assert.equal(detailBody.service.lifecycle.lastAction, "stop");
  } finally {
    await apiServer.stop();
    resetLifecycleState();
  }
});

test("start fails before config and keeps the error explicit", async () => {
  resetLifecycleState();
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const install = await postJson(`${apiServer.url}/api/services/echo-service/install`);
    assert.equal(install.status, 200);

    const start = await postJson(`${apiServer.url}/api/services/echo-service/start`);
    assert.equal(start.status, 500);
    assert.equal(start.body.error, "internal_error");
    assert.match(start.body.message, /before config/i);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
  }
});

test("runtime summary reflects running services after lifecycle actions", async () => {
  resetLifecycleState();
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
  }
});
