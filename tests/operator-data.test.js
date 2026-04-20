import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { startApiServer } from "../dist/server/index.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { clearPersistedFixtureState } from "./test-helpers.js";

const servicesRoot = path.resolve("services");

async function postJson(url) {
  const response = await fetch(url, { method: "POST" });
  return {
    status: response.status,
    body: await response.json(),
  };
}

test("service detail includes richer operator metadata", async () => {
  resetLifecycleState();
  await clearPersistedFixtureState(servicesRoot);
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const response = await fetch(`${apiServer.url}/api/services/echo-service`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.service.operator.logPath.endsWith(path.join("services", "echo-service", "logs", "service.log")), true);
    assert.equal(body.service.operator.variableCount >= 3, true);
    assert.equal(body.service.operator.endpointCount >= 2, true);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await clearPersistedFixtureState(servicesRoot);
  }
});

test("GET /api/services/:id/logs returns operator log payload", async () => {
  resetLifecycleState();
  await clearPersistedFixtureState(servicesRoot);
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    await postJson(`${apiServer.url}/api/services/echo-service/install`);
    await postJson(`${apiServer.url}/api/services/echo-service/config`);

    const response = await fetch(`${apiServer.url}/api/services/echo-service/logs`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.logs.serviceId, "echo-service");
    assert.equal(body.logs.logPath.endsWith(path.join("services", "echo-service", "logs", "service.log")), true);
    assert.deepEqual(body.logs.entries.map((entry) => entry.message), ["echo-service:install", "echo-service:config"]);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await clearPersistedFixtureState(servicesRoot);
  }
});

test("GET /api/services/:id/variables returns manifest and derived variables", async () => {
  resetLifecycleState();
  await clearPersistedFixtureState(servicesRoot);
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const response = await fetch(`${apiServer.url}/api/services/echo-service/variables`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.variables.serviceId, "echo-service");
    assert.ok(body.variables.variables.some((entry) => entry.key === "ECHO_MESSAGE" && entry.scope === "manifest"));
    assert.ok(body.variables.variables.some((entry) => entry.key === "SERVICE_STATE_ROOT" && entry.scope === "derived"));
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await clearPersistedFixtureState(servicesRoot);
  }
});

test("GET /api/services/:id/network returns operator network endpoints", async () => {
  resetLifecycleState();
  await clearPersistedFixtureState(servicesRoot);
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const response = await fetch(`${apiServer.url}/api/services/echo-service/network`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.network.serviceId, "echo-service");
    assert.ok(body.network.endpoints.some((entry) => entry.label === "service"));
    assert.ok(body.network.endpoints.some((entry) => entry.label === "ui"));
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await clearPersistedFixtureState(servicesRoot);
  }
});

test("GET /api/variables and /api/network aggregate operator surfaces across services", async () => {
  resetLifecycleState();
  await clearPersistedFixtureState(servicesRoot);
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const variablesResponse = await fetch(`${apiServer.url}/api/variables`);
    const variablesBody = await variablesResponse.json();
    const networkResponse = await fetch(`${apiServer.url}/api/network`);
    const networkBody = await networkResponse.json();

    assert.equal(variablesResponse.status, 200);
    assert.equal(networkResponse.status, 200);
    assert.equal(Array.isArray(variablesBody.services), true);
    assert.equal(Array.isArray(networkBody.services), true);
    assert.ok(variablesBody.services.some((service) => service.serviceId === "echo-service"));
    assert.ok(networkBody.services.some((service) => service.serviceId === "@node"));
    assert.ok(networkBody.services.some((service) => service.serviceId === "node-sample-service"));
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await clearPersistedFixtureState(servicesRoot);
  }
});
