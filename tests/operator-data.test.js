import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile, rm } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { clearPersistedFixtureState, makeTempServicesRoot, writeExecutableFixtureService, writeManifest } from "./test-helpers.js";

const servicesRoot = path.resolve("services");

async function postJson(url) {
  const response = await fetch(url, { method: "POST" });
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function waitFor(readinessCheck, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await readinessCheck();
    if (result) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Condition not met within ${timeoutMs}ms`);
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

test("GET /api/globalenv returns the merged bounded shared env map", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-globalenv-");
  const apiServer = await (async () => {
    await writeManifest(servicesRoot, "emitter-service", {
      id: "emitter-service",
      name: "Emitter Service",
      description: "Emits shared env.",
      env: {
        ECHO_MESSAGE: "hello shared env",
      },
      globalenv: {
        SHARED_MESSAGE: "${ECHO_MESSAGE}",
      },
    });

    return startApiServer({ port: 0, servicesRoot });
  })();

  try {
    const response = await fetch(`${apiServer.url}/api/globalenv`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.globalenv, {
      SHARED_MESSAGE: "hello shared env",
    });
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("service variables include merged globalenv entries and managed processes receive them", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-globalenv-");
  const { serviceRoot } = await writeExecutableFixtureService(servicesRoot, "consumer-service", {
    captureEnvKeys: ["SHARED_MESSAGE"],
  });

  await writeManifest(servicesRoot, "emitter-service", {
    id: "emitter-service",
    name: "Emitter Service",
    description: "Emits shared env.",
    env: {
      ECHO_MESSAGE: "hello shared env",
    },
    globalenv: {
      SHARED_MESSAGE: "${ECHO_MESSAGE}",
    },
  });

  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const variablesResponse = await fetch(`${apiServer.url}/api/services/consumer-service/variables`);
    const variablesBody = await variablesResponse.json();

    assert.equal(variablesResponse.status, 200);
    assert.ok(
      variablesBody.variables.variables.some(
        (entry) => entry.key === "SHARED_MESSAGE" && entry.value === "hello shared env" && entry.scope === "global",
      ),
    );

    await postJson(`${apiServer.url}/api/services/consumer-service/install`);
    await postJson(`${apiServer.url}/api/services/consumer-service/config`);
    await postJson(`${apiServer.url}/api/services/consumer-service/start`);

    const envSnapshot = JSON.parse(
      await waitFor(async () => {
        try {
          return await readFile(path.join(serviceRoot, "runtime", "env.json"), "utf8");
        } catch (error) {
          if ((error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
            return null;
          }
          throw error;
        }
      }),
    );
    assert.equal(envSnapshot.SHARED_MESSAGE, "hello shared env");

    await postJson(`${apiServer.url}/api/services/consumer-service/stop`);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
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
