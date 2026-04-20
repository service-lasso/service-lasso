import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { startApiServer } from "../dist/server/index.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { getServiceStatePaths } from "../dist/runtime/state/paths.js";
import { readStoredState } from "../dist/runtime/state/readState.js";
import { makeTempServicesRoot, writeExecutableFixtureService, writeManifest } from "./test-helpers.js";

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
  const { serviceRoot } = await writeExecutableFixtureService(servicesRoot, "echo-service");

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

test("GET /api/services/:id/health supports bounded TCP healthchecks", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot();

  const tcpServer = net.createServer((socket) => {
    socket.end("OK");
  });
  tcpServer.listen(0, "127.0.0.1");
  await once(tcpServer, "listening");
  const tcpAddress = tcpServer.address();
  if (!tcpAddress || typeof tcpAddress === "string") {
    throw new Error("TCP probe server failed to bind.");
  }

  await writeManifest(servicesRoot, "tcp-service", {
    id: "tcp-service",
    name: "TCP Service",
    description: "Temporary service for TCP health proof.",
    healthcheck: {
      type: "tcp",
      address: `127.0.0.1:${tcpAddress.port}`,
    },
  });

  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const response = await fetch(`${apiServer.url}/api/services/tcp-service/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.serviceId, "tcp-service");
    assert.equal(body.health.type, "tcp");
    assert.equal(body.health.healthy, true);
    assert.match(body.health.detail, /connected successfully/i);
  } finally {
    await apiServer.stop();
    tcpServer.close();
    await once(tcpServer, "close");
    await rm(tempRoot, { recursive: true, force: true });
    resetLifecycleState();
  }
});

test("HTTP healthcheck lifecycle actions stay 200 when the probe is unavailable", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot();
  await writeExecutableFixtureService(servicesRoot, "http-health-fixture", {
    healthcheck: {
      type: "http",
      url: "http://127.0.0.1:65534/health",
      expected_status: 200,
    },
  });

  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const install = await postJson(`${apiServer.url}/api/services/http-health-fixture/install`);
    const config = await postJson(`${apiServer.url}/api/services/http-health-fixture/config`);
    const start = await postJson(`${apiServer.url}/api/services/http-health-fixture/start`);
    const stop = await postJson(`${apiServer.url}/api/services/http-health-fixture/stop`);

    for (const response of [install, config, start, stop]) {
      assert.equal(response.status, 200);
      assert.equal(response.body.health.type, "http");
      assert.equal(response.body.health.healthy, false);
      assert.match(response.body.health.detail, /HTTP healthcheck failed:/i);
    }
  } finally {
    await apiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
    resetLifecycleState();
  }
});

test("TCP healthcheck lifecycle actions stay 200 when the probe is unavailable", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot();
  await writeExecutableFixtureService(servicesRoot, "tcp-health-fixture", {
    healthcheck: {
      type: "tcp",
      address: "127.0.0.1:65533",
    },
  });

  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const install = await postJson(`${apiServer.url}/api/services/tcp-health-fixture/install`);
    const config = await postJson(`${apiServer.url}/api/services/tcp-health-fixture/config`);
    const start = await postJson(`${apiServer.url}/api/services/tcp-health-fixture/start`);
    const stop = await postJson(`${apiServer.url}/api/services/tcp-health-fixture/stop`);

    for (const response of [install, config, start, stop]) {
      assert.equal(response.status, 200);
      assert.equal(response.body.health.type, "tcp");
      assert.equal(response.body.health.healthy, false);
      assert.match(response.body.health.detail, /TCP healthcheck failed:/i);
    }
  } finally {
    await apiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
    resetLifecycleState();
  }
});

test("runtime summary reports healthy services", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot();
  await writeExecutableFixtureService(servicesRoot, "echo-service");

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

test("startup rehydrates persisted lifecycle state from service .state files", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot();
  const serviceRoot = await writeManifest(servicesRoot, "echo-service", {
    id: "echo-service",
    name: "Echo Service",
    description: "Temporary service for rehydration proof.",
    healthcheck: { type: "process" },
  });

  const statePaths = getServiceStatePaths(serviceRoot);
  await mkdir(statePaths.stateRoot, { recursive: true });
  await writeFile(path.join(statePaths.stateRoot, "install.json"), JSON.stringify({ installed: true, lastAction: "install" }, null, 2));
  await writeFile(path.join(statePaths.stateRoot, "config.json"), JSON.stringify({ configured: true, lastAction: "config" }, null, 2));
  await writeFile(
    path.join(statePaths.stateRoot, "runtime.json"),
    JSON.stringify(
      {
        running: true,
        pid: 12345,
        startedAt: "2026-04-20T00:00:00.000Z",
        exitCode: null,
        command: "node runtime/fixture-service.mjs",
        lastAction: "start",
        actionHistory: ["install", "config", "start"],
      },
      null,
      2,
    ),
  );

  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const detailResponse = await fetch(`${apiServer.url}/api/services/echo-service`);
    const detailBody = await detailResponse.json();
    const runtimeResponse = await fetch(`${apiServer.url}/api/runtime`);
    const runtimeBody = await runtimeResponse.json();

    assert.equal(detailResponse.status, 200);
    assert.equal(detailBody.service.lifecycle.installed, true);
    assert.equal(detailBody.service.lifecycle.configured, true);
    assert.equal(detailBody.service.lifecycle.running, false);
    assert.deepEqual(detailBody.service.lifecycle.actionHistory, ["install", "config", "start"]);
    assert.equal(detailBody.service.lifecycle.runtime.pid, null);
    assert.equal(detailBody.service.lifecycle.runtime.command, "node runtime/fixture-service.mjs");
    assert.equal(runtimeResponse.status, 200);
    assert.equal(runtimeBody.runtime.runningServices, 0);
  } finally {
    await apiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
    resetLifecycleState();
  }
});

test("managed process exits update lifecycle and persisted runtime state", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot();
  const { serviceRoot } = await writeExecutableFixtureService(servicesRoot, "short-lived-service", {
    autoExitMs: 150,
    exitCode: 7,
  });

  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    await postJson(`${apiServer.url}/api/services/short-lived-service/install`);
    await postJson(`${apiServer.url}/api/services/short-lived-service/config`);
    const start = await postJson(`${apiServer.url}/api/services/short-lived-service/start`);

    assert.equal(start.status, 200);
    assert.equal(start.body.state.running, true);
    assert.equal(start.body.state.runtime.pid > 0, true);

    await new Promise((resolve) => setTimeout(resolve, 500));

    const detailResponse = await fetch(`${apiServer.url}/api/services/short-lived-service`);
    const detailBody = await detailResponse.json();
    const stored = await readStoredState(serviceRoot);

    assert.equal(detailResponse.status, 200);
    assert.equal(detailBody.service.lifecycle.running, false);
    assert.equal(detailBody.service.lifecycle.runtime.pid, null);
    assert.equal(detailBody.service.lifecycle.runtime.exitCode, 7);
    assert.equal(stored.runtime.running, false);
    assert.equal(stored.runtime.exitCode, 7);
  } finally {
    await apiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
    resetLifecycleState();
  }
});
