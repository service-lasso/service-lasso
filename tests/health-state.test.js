import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import dgram from "node:dgram";
import path from "node:path";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { startApiServer } from "../dist/server/index.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { getServiceStatePaths } from "../dist/runtime/state/paths.js";
import { readStoredState } from "../dist/runtime/state/readState.js";
import { makeTempServicesRoot, writeExecutableFixtureService, writeManifest } from "./test-helpers.js";

const execFile = promisify(execFileCallback);

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function runCli(args, cwd = path.resolve(".")) {
  const cliPath = path.join(cwd, "dist", "cli.js");
  const result = await execFile(process.execPath, [cliPath, ...args], {
    cwd,
    env: {
      ...process.env,
      npm_package_version: "0.1.0-test",
    },
  });

  return result.stdout.trim();
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

test("health checks persist bounded transition history without secret-bearing URL query values", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-health-history-");

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

  const serviceRoot = await writeManifest(servicesRoot, "http-history-service", {
    id: "http-history-service",
    name: "HTTP History Service",
    description: "Temporary service for health history proof.",
    healthcheck: {
      type: "http",
      url: `http://127.0.0.1:${probeAddress.port}/health?token=super-secret-token`,
      expected_status: 200,
    },
  });

  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const first = await fetch(`${apiServer.url}/api/services/http-history-service/health`);
    const firstBody = await first.json();
    const duplicate = await fetch(`${apiServer.url}/api/services/http-history-service/health`);
    const duplicateBody = await duplicate.json();
    const history = await fetch(`${apiServer.url}/api/services/http-history-service/health/history`);
    const historyBody = await history.json();
    const detail = await fetch(`${apiServer.url}/api/services/http-history-service`);
    const detailBody = await detail.json();
    const stored = await readStoredState(serviceRoot);
    const statePaths = getServiceStatePaths(serviceRoot);
    const persistedHealth = await readFile(statePaths.health, "utf8");

    assert.equal(first.status, 200);
    assert.equal(firstBody.history.transitions.length, 1);
    assert.equal(firstBody.history.transitions[0].status, "healthy");
    assert.equal(firstBody.history.transitions[0].checkType, "http");
    assert.equal(firstBody.history.transitions[0].observed.url, `http://127.0.0.1:${probeAddress.port}/health`);
    assert.equal(duplicateBody.history.transitions.length, 1);
    assert.equal(history.status, 200);
    assert.equal(historyBody.history.transitions.length, 1);
    assert.equal(detailBody.service.healthHistory.transitions.length, 1);
    assert.equal(stored.health.transitions.length, 1);
    assert.doesNotMatch(JSON.stringify(firstBody.history), /super-secret-token/);
    assert.doesNotMatch(JSON.stringify(historyBody.history), /super-secret-token/);
    assert.doesNotMatch(persistedHealth, /super-secret-token/);
  } finally {
    await apiServer.stop();
    const probeClosed = once(probeServer, "close");
    probeServer.close();
    await probeClosed;
    await rm(tempRoot, { recursive: true, force: true });
    resetLifecycleState();
  }
});

test("CLI health history reads persisted transitions for one service and all services", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-cli-health-history-");
  const { serviceRoot } = await writeExecutableFixtureService(servicesRoot, "cli-health-service");
  await writeExecutableFixtureService(servicesRoot, "empty-health-service");

  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    await fetch(`${apiServer.url}/api/services/cli-health-service/health`);

    const singleOut = await runCli([
      "health",
      "history",
      "cli-health-service",
      "--services-root",
      servicesRoot,
      "--json",
    ]);
    const single = JSON.parse(singleOut);

    assert.equal(single.action, "history");
    assert.equal(single.services.length, 1);
    assert.equal(single.services[0].serviceId, "cli-health-service");
    assert.equal(single.services[0].healthHistory.transitions.length, 1);

    const allOut = await runCli([
      "health",
      "history",
      "--services-root",
      servicesRoot,
      "--json",
    ]);
    const all = JSON.parse(allOut);

    assert.deepEqual(
      all.services.map((service) => service.serviceId),
      ["cli-health-service", "empty-health-service"],
    );
    assert.equal(all.services[0].healthHistory.transitions.length, 1);
    assert.equal(all.services[1].healthHistory.transitions.length, 0);

    const humanOut = await runCli([
      "health",
      "history",
      "cli-health-service",
      "--services-root",
      servicesRoot,
    ]);

    assert.match(humanOut, /\[service-lasso\] health history/);
    assert.match(humanOut, /cli-health-service: 1 transitions, last unhealthy\/process/);

    const stored = await readStoredState(serviceRoot);
    assert.equal(stored.health.transitions.length, 1);
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
    const probeClosed = once(probeServer, "close");
    probeServer.close();
    await probeClosed;
    await rm(tempRoot, { recursive: true, force: true });
    resetLifecycleState();
  }
});

test("HTTP healthchecks resolve manifest port selectors", async () => {
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

  await writeManifest(servicesRoot, "http-selector-service", {
    id: "http-selector-service",
    name: "HTTP Selector Service",
    description: "Temporary service for HTTP health selector proof.",
    ports: {
      admin: probeAddress.port,
    },
    healthcheck: {
      type: "http",
      url: "http://127.0.0.1:${ADMIN_PORT}/health",
      expected_status: 200,
    },
  });

  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const response = await fetch(`${apiServer.url}/api/services/http-selector-service/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.serviceId, "http-selector-service");
    assert.equal(body.health.type, "http");
    assert.equal(body.health.healthy, true);
  } finally {
    await apiServer.stop();
    const probeClosed = once(probeServer, "close");
    probeServer.close();
    await probeClosed;
    await rm(tempRoot, { recursive: true, force: true });
    resetLifecycleState();
  }
});

test("HTTP healthchecks resolve and send cookie selectors", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot();

  const probeServer = createServer((request, res) => {
    res.statusCode = request.headers.cookie === "healthcheck=http-cookie-service-ready" ? 200 : 401;
    res.end("ok");
  });
  probeServer.listen(0, "127.0.0.1");
  await once(probeServer, "listening");
  const probeAddress = probeServer.address();
  if (!probeAddress || typeof probeAddress === "string") {
    throw new Error("Probe server failed to bind.");
  }

  await writeManifest(servicesRoot, "http-cookie-service", {
    id: "http-cookie-service",
    name: "HTTP Cookie Service",
    description: "Temporary service for HTTP health cookie selector proof.",
    ports: {
      admin: probeAddress.port,
    },
    healthcheck: {
      type: "http",
      url: "http://127.0.0.1:${ADMIN_PORT}/health",
      expected_status: 200,
      cookies: {
        healthcheck: "${SERVICE_ID}-ready",
      },
    },
  });

  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const response = await fetch(`${apiServer.url}/api/services/http-cookie-service/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.serviceId, "http-cookie-service");
    assert.equal(body.health.type, "http");
    assert.equal(body.health.healthy, true);
  } finally {
    await apiServer.stop();
    const probeClosed = once(probeServer, "close");
    probeServer.close();
    await probeClosed;
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
    const tcpClosed = once(tcpServer, "close");
    tcpServer.close();
    await tcpClosed;
    await rm(tempRoot, { recursive: true, force: true });
    resetLifecycleState();
  }
});

test("TCP healthchecks resolve host and port selectors", async () => {
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

  await writeManifest(servicesRoot, "tcp-selector-service", {
    id: "tcp-selector-service",
    name: "TCP Selector Service",
    description: "Temporary service for TCP selector health proof.",
    ports: {
      http: tcpAddress.port,
    },
    healthcheck: {
      type: "tcp",
      host: "127.0.0.1",
      port: "${HTTP_PORT}",
    },
  });

  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const response = await fetch(`${apiServer.url}/api/services/tcp-selector-service/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.serviceId, "tcp-selector-service");
    assert.equal(body.health.type, "tcp");
    assert.equal(body.health.healthy, true);
    assert.match(body.health.detail, /connected successfully/i);
  } finally {
    await apiServer.stop();
    const tcpClosed = once(tcpServer, "close");
    tcpServer.close();
    await tcpClosed;
    await rm(tempRoot, { recursive: true, force: true });
    resetLifecycleState();
  }
});

test("bare TCP healthchecks infer the default single service port", async () => {
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

  await writeManifest(servicesRoot, "tcp-default-service", {
    id: "tcp-default-service",
    name: "TCP Default Service",
    description: "Temporary service for default TCP health proof.",
    ports: {
      service: tcpAddress.port,
    },
    healthcheck: {
      type: "tcp",
    },
  });

  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const response = await fetch(`${apiServer.url}/api/services/tcp-default-service/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.serviceId, "tcp-default-service");
    assert.equal(body.health.type, "tcp");
    assert.equal(body.health.healthy, true);
    assert.match(body.health.detail, /127\.0\.0\.1/i);
  } finally {
    await apiServer.stop();
    const tcpClosed = once(tcpServer, "close");
    tcpServer.close();
    await tcpClosed;
    await rm(tempRoot, { recursive: true, force: true });
    resetLifecycleState();
  }
});

test("bare TCP healthchecks report ambiguous multi-port services", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot();

  await writeManifest(servicesRoot, "tcp-ambiguous-service", {
    id: "tcp-ambiguous-service",
    name: "TCP Ambiguous Service",
    description: "Temporary service for ambiguous TCP health proof.",
    ports: {
      http: 4012,
      admin: 4013,
    },
    healthcheck: {
      type: "tcp",
    },
  });

  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const response = await fetch(`${apiServer.url}/api/services/tcp-ambiguous-service/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.serviceId, "tcp-ambiguous-service");
    assert.equal(body.health.type, "tcp");
    assert.equal(body.health.healthy, false);
    assert.match(body.health.detail, /multiple service ports/i);
    assert.match(body.health.detail, /address or host \+ port/i);
  } finally {
    await apiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
    resetLifecycleState();
  }
});

test("GET /api/services/:id/health aggregates canonical HTTP and TCP healthchecks", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot();

  const httpServer = createServer((_, res) => {
    res.statusCode = 200;
    res.end("ok");
  });
  httpServer.listen(0, "127.0.0.1");
  await once(httpServer, "listening");
  const httpAddress = httpServer.address();
  if (!httpAddress || typeof httpAddress === "string") {
    throw new Error("HTTP probe server failed to bind.");
  }

  const tcpServer = net.createServer((socket) => {
    socket.end("OK");
  });
  tcpServer.listen(0, "127.0.0.1");
  await once(tcpServer, "listening");
  const tcpAddress = tcpServer.address();
  if (!tcpAddress || typeof tcpAddress === "string") {
    throw new Error("TCP probe server failed to bind.");
  }

  await writeManifest(servicesRoot, "aggregate-health-service", {
    id: "aggregate-health-service",
    name: "Aggregate Health Service",
    description: "Temporary service for healthchecks array aggregation.",
    ports: {
      http: httpAddress.port,
      tcp: tcpAddress.port,
    },
    healthchecks: [
      {
        id: "tcp-port-open",
        type: "tcp",
        host: "127.0.0.1",
        port: "${TCP_PORT}",
      },
      {
        id: "http-ready",
        type: "http",
        url: "http://127.0.0.1:${HTTP_PORT}/health",
        expected_status: 200,
      },
    ],
  });

  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const response = await fetch(`${apiServer.url}/api/services/aggregate-health-service/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.serviceId, "aggregate-health-service");
    assert.equal(body.health.type, "aggregate");
    assert.equal(body.health.healthy, true);
    assert.deepEqual(
      body.health.checks.map((check) => [check.id, check.type, check.required, check.healthy, check.attempts]),
      [
        ["tcp-port-open", "tcp", true, true, 1],
        ["http-ready", "http", true, true, 1],
      ],
    );
  } finally {
    await apiServer.stop();
    const httpClosed = once(httpServer, "close");
    const tcpClosed = once(tcpServer, "close");
    httpServer.close();
    tcpServer.close();
    await Promise.all([httpClosed, tcpClosed]);
    await rm(tempRoot, { recursive: true, force: true });
    resetLifecycleState();
  }
});

test("GET /api/services/:id/health reports optional failures without failing the aggregate", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot();
  const serviceRoot = await writeManifest(servicesRoot, "optional-health-service", {
    id: "optional-health-service",
    name: "Optional Health Service",
    description: "Temporary service for optional healthchecks.",
    healthchecks: [
      {
        id: "required-file",
        type: "file",
        file: "${SERVICE_ROOT}/runtime/ready.txt",
      },
      {
        id: "optional-diagnostic",
        type: "file",
        file: "runtime/diagnostic.txt",
        required: false,
      },
    ],
  });
  const readyPath = path.join(serviceRoot, "runtime", "ready.txt");
  await mkdir(path.dirname(readyPath), { recursive: true });
  await writeFile(readyPath, "ok");

  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const response = await fetch(`${apiServer.url}/api/services/optional-health-service/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.health.type, "aggregate");
    assert.equal(body.health.healthy, true);
    assert.equal(body.health.checks.find((check) => check.id === "required-file").healthy, true);
    assert.equal(body.health.checks.find((check) => check.id === "optional-diagnostic").healthy, false);
  } finally {
    await apiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
    resetLifecycleState();
  }
});

test("GET /api/services/:id/health supports UDP send expect healthchecks", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot();
  const udpServer = dgram.createSocket("udp4");
  udpServer.on("message", (message, remote) => {
    if (message.toString("utf8") === "ping") {
      udpServer.send(Buffer.from("pong"), remote.port, remote.address);
    }
  });
  udpServer.bind(0, "127.0.0.1");
  await once(udpServer, "listening");
  const udpAddress = udpServer.address();

  await writeManifest(servicesRoot, "udp-health-service", {
    id: "udp-health-service",
    name: "UDP Health Service",
    description: "Temporary service for UDP healthchecks.",
    ports: {
      udp: udpAddress.port,
    },
    healthchecks: [
      {
        id: "udp-ready",
        type: "udp",
        host: "127.0.0.1",
        port: "${UDP_PORT}",
        send: "ping",
        expect: "pong",
        timeout: 250,
      },
    ],
  });

  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const response = await fetch(`${apiServer.url}/api/services/udp-health-service/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.health.type, "aggregate");
    assert.equal(body.health.healthy, true);
    assert.deepEqual(body.health.checks.map((check) => [check.id, check.type, check.healthy]), [
      ["udp-ready", "udp", true],
    ]);
  } finally {
    await apiServer.stop();
    const udpClosed = once(udpServer, "close");
    udpServer.close();
    await udpClosed;
    await rm(tempRoot, { recursive: true, force: true });
    resetLifecycleState();
  }
});

test("GET /api/services/:id/health reports UDP timeout by check id", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot();

  await writeManifest(servicesRoot, "udp-timeout-service", {
    id: "udp-timeout-service",
    name: "UDP Timeout Service",
    description: "Temporary service for UDP timeout healthchecks.",
    healthchecks: [
      {
        id: "udp-timeout",
        type: "udp",
        address: "127.0.0.1:9",
        send: "ping",
        expect: "pong",
        timeout: 25,
      },
    ],
  });

  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const response = await fetch(`${apiServer.url}/api/services/udp-timeout-service/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.health.type, "aggregate");
    assert.equal(body.health.healthy, false);
    assert.match(body.health.detail, /udp-timeout/);
    assert.equal(body.health.checks[0].id, "udp-timeout");
    assert.match(body.health.checks[0].detail, /timed out after 25ms/i);
  } finally {
    await apiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
    resetLifecycleState();
  }
});

test("GET /api/services/:id/health supports bare and selector variable healthchecks", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot();

  await writeManifest(servicesRoot, "variable-array-service", {
    id: "variable-array-service",
    name: "Variable Array Service",
    description: "Temporary service for variable healthchecks array.",
    env: {
      BARE_READY: "ready",
      SELECTOR_READY: "ready",
    },
    healthchecks: [
      {
        id: "bare-variable",
        type: "variable",
        variable: "BARE_READY",
      },
      {
        id: "selector-variable",
        type: "variable",
        variable: "${SELECTOR_READY}",
      },
    ],
  });

  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const response = await fetch(`${apiServer.url}/api/services/variable-array-service/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.health.type, "aggregate");
    assert.equal(body.health.healthy, true);
    assert.deepEqual(body.health.checks.map((check) => [check.id, check.type, check.healthy]), [
      ["bare-variable", "variable", true],
      ["selector-variable", "variable", true],
    ]);
  } finally {
    await apiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
    resetLifecycleState();
  }
});

test("HTTP healthcheck lifecycle actions fail start cleanly when the probe is unavailable", async () => {
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
    const stop = await postJson(`${apiServer.url}/api/services/http-health-fixture/stop`, { confirm: true });

    for (const response of [install, config, start]) {
      assert.equal(response.status, 200);
      assert.equal(response.body.health.type, "http");
      assert.equal(response.body.health.healthy, false);
      assert.match(response.body.health.detail, /HTTP healthcheck failed:/i);
    }
    assert.equal(start.body.ok, false);
    assert.equal(stop.status, 409);
    assert.equal(stop.body.error, "invalid_lifecycle_state");
  } finally {
    await apiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
    resetLifecycleState();
  }
});

test("TCP healthcheck lifecycle actions fail start cleanly when the probe is unavailable", async () => {
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
    const stop = await postJson(`${apiServer.url}/api/services/tcp-health-fixture/stop`, { confirm: true });

    for (const response of [install, config, start]) {
      assert.equal(response.status, 200);
      assert.equal(response.body.health.type, "tcp");
      assert.equal(response.body.health.healthy, false);
      assert.match(response.body.health.detail, /TCP healthcheck failed:/i);
    }
    assert.equal(start.body.ok, false);
    assert.equal(stop.status, 409);
    assert.equal(stop.body.error, "invalid_lifecycle_state");
  } finally {
    await apiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
    resetLifecycleState();
  }
});

test("GET /api/services/:id/health supports bounded file healthchecks", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot();
  const serviceRoot = await writeManifest(servicesRoot, "file-service", {
    id: "file-service",
    name: "File Service",
    description: "Temporary service for file health proof.",
    healthcheck: {
      type: "file",
      file: "./runtime/ready.txt",
    },
  });
  await mkdir(path.join(serviceRoot, "runtime"), { recursive: true });
  await writeFile(path.join(serviceRoot, "runtime", "ready.txt"), "ok");

  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const response = await fetch(`${apiServer.url}/api/services/file-service/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.serviceId, "file-service");
    assert.equal(body.health.type, "file");
    assert.equal(body.health.healthy, true);
    assert.match(body.health.detail, /found expected file/i);
  } finally {
    await apiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
    resetLifecycleState();
  }
});

test("file healthchecks resolve service selectors before checking paths", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot();
  const serviceRoot = await writeManifest(servicesRoot, "file-selector-service", {
    id: "file-selector-service",
    name: "File Selector Service",
    description: "Temporary service for file health selector proof.",
    healthcheck: {
      type: "file",
      file: "${SERVICE_ROOT}/runtime/ready.txt",
    },
  });
  const readyPath = path.join(serviceRoot, "runtime", "ready.txt");
  await mkdir(path.dirname(readyPath), { recursive: true });
  await writeFile(readyPath, "ok");

  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const response = await fetch(`${apiServer.url}/api/services/file-selector-service/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.serviceId, "file-selector-service");
    assert.equal(body.health.type, "file");
    assert.equal(body.health.healthy, true);
    assert.match(body.health.detail, /found expected file/i);
    assert.equal(body.health.detail.includes("${SERVICE_ROOT}"), false);
    const checkedPath = body.health.detail.replace(/^File healthcheck found expected file: /, "");
    assert.equal(path.normalize(checkedPath), readyPath);
  } finally {
    await apiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
    resetLifecycleState();
  }
});

test("file healthchecks support absolute paths", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot();
  const absoluteReadyPath = path.join(tempRoot, "external-ready.txt");
  await writeFile(absoluteReadyPath, "ok");

  await writeManifest(servicesRoot, "file-absolute-service", {
    id: "file-absolute-service",
    name: "File Absolute Service",
    description: "Temporary service for absolute file health proof.",
    healthcheck: {
      type: "file",
      file: absoluteReadyPath,
    },
  });

  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const response = await fetch(`${apiServer.url}/api/services/file-absolute-service/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.serviceId, "file-absolute-service");
    assert.equal(body.health.type, "file");
    assert.equal(body.health.healthy, true);
    assert.match(body.health.detail, /found expected file/i);
    assert.ok(body.health.detail.includes(absoluteReadyPath));
  } finally {
    await apiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
    resetLifecycleState();
  }
});

test("file healthcheck lifecycle actions fail start cleanly when the file is unavailable", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot();
  await writeExecutableFixtureService(servicesRoot, "file-health-fixture", {
    healthcheck: {
      type: "file",
      file: "./runtime/ready.txt",
    },
  });

  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const install = await postJson(`${apiServer.url}/api/services/file-health-fixture/install`);
    const config = await postJson(`${apiServer.url}/api/services/file-health-fixture/config`);
    const start = await postJson(`${apiServer.url}/api/services/file-health-fixture/start`);
    const stop = await postJson(`${apiServer.url}/api/services/file-health-fixture/stop`, { confirm: true });

    for (const response of [install, config, start]) {
      assert.equal(response.status, 200);
      assert.equal(response.body.health.type, "file");
      assert.equal(response.body.health.healthy, false);
      assert.match(response.body.health.detail, /did not find expected file/i);
    }
    assert.equal(start.body.ok, false);
    assert.equal(stop.status, 409);
    assert.equal(stop.body.error, "invalid_lifecycle_state");
  } finally {
    await apiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
    resetLifecycleState();
  }
});

test("GET /api/services/:id/health supports bounded variable healthchecks", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot();
  await writeManifest(servicesRoot, "variable-service", {
    id: "variable-service",
    name: "Variable Service",
    description: "Temporary service for variable health proof.",
    env: {
      ECHO_MESSAGE: "hello from variable health",
    },
    healthcheck: {
      type: "variable",
      variable: "${ECHO_MESSAGE}",
    },
  });

  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const response = await fetch(`${apiServer.url}/api/services/variable-service/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.serviceId, "variable-service");
    assert.equal(body.health.type, "variable");
    assert.equal(body.health.healthy, true);
    assert.match(body.health.detail, /resolved ECHO_MESSAGE/i);
  } finally {
    await apiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
    resetLifecycleState();
  }
});

test("variable healthcheck lifecycle actions fail start cleanly when the variable is unavailable", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot();
  await writeExecutableFixtureService(servicesRoot, "variable-health-fixture", {
    healthcheck: {
      type: "variable",
      variable: "${MISSING_VALUE}",
    },
  });

  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const install = await postJson(`${apiServer.url}/api/services/variable-health-fixture/install`);
    const config = await postJson(`${apiServer.url}/api/services/variable-health-fixture/config`);
    const start = await postJson(`${apiServer.url}/api/services/variable-health-fixture/start`);
    const stop = await postJson(`${apiServer.url}/api/services/variable-health-fixture/stop`, { confirm: true });

    for (const response of [install, config, start]) {
      assert.equal(response.status, 200);
      assert.equal(response.body.health.type, "variable");
      assert.equal(response.body.health.healthy, false);
      assert.match(response.body.health.detail, /did not resolve expected variable/i);
    }
    assert.equal(start.body.ok, false);
    assert.equal(stop.status, 409);
    assert.equal(stop.body.error, "invalid_lifecycle_state");
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
  await writeFile(
    path.join(statePaths.stateRoot, "install.json"),
    JSON.stringify(
      {
        installed: true,
        lastAction: "install",
        files: ["runtime/install.txt"],
        updatedAt: "2026-04-20T00:00:00.000Z",
        artifact: {
          sourceType: "github-release",
          repo: "service-lasso/fixture",
          channel: null,
          tag: "2026.4.20-test",
          assetName: "fixture.zip",
          assetUrl: "https://example.invalid/fixture.zip",
          archiveType: "zip",
          archivePath: ".state/artifacts/2026.4.20-test/fixture.zip",
          extractedPath: ".state/extracted/current",
          command: "./fixture",
          args: [],
        },
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(statePaths.stateRoot, "config.json"),
    JSON.stringify({ configured: true, lastAction: "config", files: ["runtime/config.json"], updatedAt: "2026-04-20T00:01:00.000Z" }, null, 2),
  );
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
    assert.deepEqual(detailBody.service.lifecycle.installArtifacts.files, ["runtime/install.txt"]);
    assert.equal(
      detailBody.service.lifecycle.installArtifacts.artifact.archivePath,
      path.join(serviceRoot, ".state", "artifacts", "2026.4.20-test", "fixture.zip"),
    );
    assert.equal(
      detailBody.service.lifecycle.installArtifacts.artifact.extractedPath,
      path.join(serviceRoot, ".state", "extracted", "current"),
    );
    assert.deepEqual(detailBody.service.lifecycle.configArtifacts.files, ["runtime/config.json"]);
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
    assert.equal(detailBody.service.lifecycle.runtime.lastTermination, "crashed");
    assert.equal(typeof detailBody.service.lifecycle.runtime.finishedAt, "string");
    assert.equal(stored.runtime.running, false);
    assert.equal(stored.runtime.exitCode, 7);
    assert.equal(stored.runtime.lastTermination, "crashed");
    assert.equal(typeof stored.runtime.finishedAt, "string");
  } finally {
    await apiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
    resetLifecycleState();
  }
});
