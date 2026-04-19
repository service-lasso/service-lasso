import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { startApiServer } from "../dist/server/index.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { getServiceStatePaths } from "../dist/runtime/state/paths.js";
import { readStoredState } from "../dist/runtime/state/readState.js";

async function makeTempServicesRoot() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-state-"));
  const servicesRoot = path.join(tempRoot, "services");
  await mkdir(servicesRoot, { recursive: true });
  return { tempRoot, servicesRoot };
}

async function writeManifest(servicesRoot, serviceId, body) {
  const serviceRoot = path.join(servicesRoot, serviceId);
  await mkdir(serviceRoot, { recursive: true });
  await writeFile(path.join(serviceRoot, "service.json"), JSON.stringify(body, null, 2));
  return serviceRoot;
}

async function postJson(url) {
  const response = await fetch(url, { method: "POST" });
  return {
    status: response.status,
    body: await response.json(),
  };
}

test("lifecycle actions write structured .state records to disk", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot();
  const serviceRoot = await writeManifest(servicesRoot, "echo-service", {
    id: "echo-service",
    name: "Echo Service",
    description: "Temporary service for state persistence proof.",
    healthcheck: { type: "process" },
  });

  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    await postJson(`${apiServer.url}/api/services/echo-service/install`);
    await postJson(`${apiServer.url}/api/services/echo-service/config`);
    await postJson(`${apiServer.url}/api/services/echo-service/start`);

    const statePaths = getServiceStatePaths(serviceRoot);
    const stored = await readStoredState(serviceRoot);

    assert.ok(JSON.parse(await readFile(statePaths.service, "utf8")));
    assert.ok(JSON.parse(await readFile(statePaths.install, "utf8")));
    assert.ok(JSON.parse(await readFile(statePaths.config, "utf8")));
    assert.ok(JSON.parse(await readFile(statePaths.runtime, "utf8")));
    assert.equal(stored.install.installed, true);
    assert.equal(stored.config.configured, true);
    assert.equal(stored.runtime.running, true);
  } finally {
    await apiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
    resetLifecycleState();
  }
});

test("GET /api/services/:id/health supports bounded HTTP healthchecks", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot();

  const probeServer = createServer((_, res) => {
    res.statusCode = 200;
    res.end("ok");
  });
  probeServer.listen(0, "127.0.0.1");
  await once(probeServer, "listening");
  const probeAddress = probeServer.address();
  if (!probeAddress || typeof probeAddress === "string") {
    throw new Error("Probe server failed to bind.");
  }

  await writeManifest(servicesRoot, "http-service", {
    id: "http-service",
    name: "HTTP Service",
    description: "Temporary service for HTTP health proof.",
    healthcheck: {
      type: "http",
      url: `http://127.0.0.1:${probeAddress.port}/health`,
      expected_status: 200,
    },
  });

  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const response = await fetch(`${apiServer.url}/api/services/http-service/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.serviceId, "http-service");
    assert.equal(body.health.type, "http");
    assert.equal(body.health.healthy, true);
  } finally {
    await apiServer.stop();
    probeServer.close();
    await once(probeServer, "close");
    await rm(tempRoot, { recursive: true, force: true });
    resetLifecycleState();
  }
});

test("runtime summary reports healthy services", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot();
  await writeManifest(servicesRoot, "echo-service", {
    id: "echo-service",
    name: "Echo Service",
    description: "Temporary service for runtime health proof.",
    healthcheck: { type: "process" },
  });

  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    await postJson(`${apiServer.url}/api/services/echo-service/install`);
    await postJson(`${apiServer.url}/api/services/echo-service/config`);
    await postJson(`${apiServer.url}/api/services/echo-service/start`);

    const response = await fetch(`${apiServer.url}/api/runtime`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.runtime.healthyServices, 1);
  } finally {
    await apiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
    resetLifecycleState();
  }
});
