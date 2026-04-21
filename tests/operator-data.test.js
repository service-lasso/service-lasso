import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile, readdir, rm } from "node:fs/promises";
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
    assert.equal(body.service.operator.logPath.endsWith(path.join("services", "echo-service", "logs", "runtime", "service.log")), true);
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
    assert.equal(body.logs.logPath.endsWith(path.join("services", "echo-service", "logs", "runtime", "service.log")), true);
    assert.equal(body.logs.stdoutPath.endsWith(path.join("services", "echo-service", "logs", "runtime", "stdout.log")), true);
    assert.equal(body.logs.stderrPath.endsWith(path.join("services", "echo-service", "logs", "runtime", "stderr.log")), true);
    assert.equal(body.logs.retention.maxArchives, 3);
    assert.deepEqual(body.logs.archives, []);
    assert.deepEqual(body.logs.entries.map((entry) => entry.message), ["echo-service:install", "echo-service:config"]);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await clearPersistedFixtureState(servicesRoot);
  }
});

test("managed stdout/stderr are captured into runtime-owned log files and surfaced through API/state", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-runtime-logs-");
  const { serviceRoot } = await writeExecutableFixtureService(servicesRoot, "loggy-service", {
    stdoutLines: ["hello stdout", "second stdout"],
    stderrLines: ["hello stderr"],
  });
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    await postJson(`${apiServer.url}/api/services/loggy-service/install`);
    await postJson(`${apiServer.url}/api/services/loggy-service/config`);
    const start = await postJson(`${apiServer.url}/api/services/loggy-service/start`);

    assert.equal(start.status, 200);
    assert.equal(start.body.state.runtime.logs.logPath.endsWith(path.join("loggy-service", "logs", "runtime", "service.log")), true);
    assert.equal(start.body.state.runtime.logs.stdoutPath.endsWith(path.join("loggy-service", "logs", "runtime", "stdout.log")), true);
    assert.equal(start.body.state.runtime.logs.stderrPath.endsWith(path.join("loggy-service", "logs", "runtime", "stderr.log")), true);

    const logsResponse = await waitFor(async () => {
      const response = await fetch(`${apiServer.url}/api/services/loggy-service/logs`);
      const body = await response.json();
      if (body.logs.entries.some((entry) => entry.level === "stdout") && body.logs.entries.some((entry) => entry.level === "stderr")) {
        return { response, body };
      }
      return null;
    });

    assert.equal(logsResponse.response.status, 200);
    assert.equal(logsResponse.body.logs.retention.maxArchives, 3);
    assert.deepEqual(logsResponse.body.logs.archives, []);
    assert.deepEqual(
      logsResponse.body.logs.entries.map((entry) => `${entry.level}:${entry.message}`).sort(),
      ["stderr:hello stderr", "stdout:hello stdout", "stdout:second stdout"].sort(),
    );

    const detailResponse = await fetch(`${apiServer.url}/api/services/loggy-service`);
    const detailBody = await detailResponse.json();
    assert.equal(detailResponse.status, 200);
    assert.equal(
      detailBody.service.lifecycle.runtime.logs.logPath.endsWith(path.join("loggy-service", "logs", "runtime", "service.log")),
      true,
    );

    const stdoutContents = await readFile(path.join(serviceRoot, "logs", "runtime", "stdout.log"), "utf8");
    const stderrContents = await readFile(path.join(serviceRoot, "logs", "runtime", "stderr.log"), "utf8");
    const combinedContents = await readFile(path.join(serviceRoot, "logs", "runtime", "service.log"), "utf8");
    const persistedRuntime = JSON.parse(await readFile(path.join(serviceRoot, ".state", "runtime.json"), "utf8"));

    assert.match(stdoutContents, /hello stdout/);
    assert.match(stdoutContents, /second stdout/);
    assert.match(stderrContents, /hello stderr/);
    assert.match(combinedContents, /"level":"stdout"/);
    assert.match(combinedContents, /"level":"stderr"/);
    assert.equal(
      persistedRuntime.logs.logPath.endsWith(path.join("loggy-service", "logs", "runtime", "service.log")),
      true,
    );

    await postJson(`${apiServer.url}/api/services/loggy-service/stop`);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runtime logs archive previous runs and enforce bounded retention", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-runtime-log-archive-");
  const { serviceRoot } = await writeExecutableFixtureService(servicesRoot, "archive-loggy-service", {
    stdoutLines: ["archive stdout"],
    stderrLines: ["archive stderr"],
  });
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    await postJson(`${apiServer.url}/api/services/archive-loggy-service/install`);
    await postJson(`${apiServer.url}/api/services/archive-loggy-service/config`);

    for (let run = 0; run < 5; run += 1) {
      const start = await postJson(`${apiServer.url}/api/services/archive-loggy-service/start`);
      assert.equal(start.status, 200);

      await waitFor(async () => {
        const response = await fetch(`${apiServer.url}/api/services/archive-loggy-service/logs`);
        const body = await response.json();
        if (body.logs.entries.some((entry) => entry.message === "archive stdout")) {
          return body;
        }
        return null;
      });

      const stop = await postJson(`${apiServer.url}/api/services/archive-loggy-service/stop`);
      assert.equal(stop.status, 200);
    }

    const logsResponse = await fetch(`${apiServer.url}/api/services/archive-loggy-service/logs`);
    const logsBody = await logsResponse.json();

    assert.equal(logsResponse.status, 200);
    assert.equal(logsBody.logs.retention.maxArchives, 3);
    assert.equal(logsBody.logs.archives.length, 3);
    assert.deepEqual(
      logsBody.logs.entries
        .filter((entry) => entry.message.length > 0)
        .map((entry) => `${entry.level}:${entry.message}`)
        .sort(),
      ["stderr:archive stderr", "stdout:archive stdout"].sort(),
    );

    for (const archive of logsBody.logs.archives) {
      const archivedCombined = await readFile(archive.logPath, "utf8");
      const archivedStdout = await readFile(archive.stdoutPath, "utf8");
      const archivedStderr = await readFile(archive.stderrPath, "utf8");

      assert.match(archivedCombined, /archive stdout/);
      assert.match(archivedCombined, /archive stderr/);
      assert.match(archivedStdout, /archive stdout/);
      assert.match(archivedStderr, /archive stderr/);
    }

    const archiveDirectories = await readdir(path.join(serviceRoot, "logs", "archive"), { withFileTypes: true });
    assert.equal(archiveDirectories.filter((entry) => entry.isDirectory()).length, 3);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("service metrics surface persisted process evidence and survive runtime restart", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-runtime-metrics-");
  await writeExecutableFixtureService(servicesRoot, "metric-service", {
    stdoutLines: ["metric stdout"],
    stderrLines: ["metric stderr"],
    autoExitMs: 75,
    exitCode: 3,
  });

  const firstServer = await startApiServer({ port: 0, servicesRoot });

  try {
    await postJson(`${firstServer.url}/api/services/metric-service/install`);
    await postJson(`${firstServer.url}/api/services/metric-service/config`);
    const start = await postJson(`${firstServer.url}/api/services/metric-service/start`);
    assert.equal(start.status, 200);

    const metricsResponse = await waitFor(async () => {
      const response = await fetch(`${firstServer.url}/api/services/metric-service/metrics`);
      const body = await response.json();

      if (body.metrics.process.crashCount === 1) {
        return { response, body };
      }

      return null;
    }, 2_000);

    assert.equal(metricsResponse.response.status, 200);
    assert.equal(metricsResponse.body.metrics.serviceId, "metric-service");
    assert.equal(metricsResponse.body.metrics.process.running, false);
    assert.equal(metricsResponse.body.metrics.process.launchCount, 1);
    assert.equal(metricsResponse.body.metrics.process.crashCount, 1);
    assert.equal(metricsResponse.body.metrics.process.stopCount, 0);
    assert.equal(metricsResponse.body.metrics.process.exitCount, 0);
    assert.equal(metricsResponse.body.metrics.process.restartCount, 0);
    assert.equal(metricsResponse.body.metrics.process.lastTermination, "crashed");
    assert.equal(typeof metricsResponse.body.metrics.process.lastRunDurationMs, "number");
    assert.equal(metricsResponse.body.metrics.process.currentRunDurationMs, null);
    assert.equal(metricsResponse.body.metrics.logs.current.stdoutLines, 1);
    assert.equal(metricsResponse.body.metrics.logs.current.stderrLines, 1);
    assert.equal(metricsResponse.body.metrics.logs.current.combinedEntries >= 2, true);
    assert.equal(metricsResponse.body.metrics.logs.archives.count, 0);
  } finally {
    await firstServer.stop();
    resetLifecycleState();
  }

  const secondServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const detailResponse = await fetch(`${secondServer.url}/api/services/metric-service`);
    const detailBody = await detailResponse.json();
    const metricsResponse = await fetch(`${secondServer.url}/api/services/metric-service/metrics`);
    const metricsBody = await metricsResponse.json();
    const aggregateResponse = await fetch(`${secondServer.url}/api/metrics`);
    const aggregateBody = await aggregateResponse.json();

    assert.equal(detailResponse.status, 200);
    assert.equal(detailBody.service.lifecycle.runtime.metrics.launchCount, 1);
    assert.equal(detailBody.service.lifecycle.runtime.metrics.crashCount, 1);
    assert.equal(detailBody.service.lifecycle.runtime.metrics.lastRunDurationMs >= 0, true);

    assert.equal(metricsResponse.status, 200);
    assert.equal(metricsBody.metrics.process.launchCount, 1);
    assert.equal(metricsBody.metrics.process.crashCount, 1);
    assert.equal(metricsBody.metrics.process.running, false);

    assert.equal(aggregateResponse.status, 200);
    assert.ok(aggregateBody.services.some((service) => service.serviceId === "metric-service"));
  } finally {
    await secondServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
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
    assert.equal(body.network.ports.service, 4010);
    assert.ok(body.network.endpoints.some((entry) => entry.label === "service"));
    assert.ok(body.network.endpoints.some((entry) => entry.label === "ui"));
    assert.ok(body.network.endpoints.some((entry) => entry.url === "http://127.0.0.1:4010/health"));
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await clearPersistedFixtureState(servicesRoot);
  }
});

test("config negotiates colliding ports deterministically and surfaces resolved network endpoints", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-ports-");

  await writeExecutableFixtureService(servicesRoot, "alpha-service", {
    ports: { service: 43100 },
    env: { ECHO_PORT: "${SERVICE_PORT}" },
    urls: undefined,
  });

  await writeManifest(servicesRoot, "alpha-service", {
    id: "alpha-service",
    name: "Alpha Service",
    description: "First service claiming a port.",
    executable: process.execPath,
    args: ["runtime/fixture-service.mjs"],
    env: {
      FIXTURE_EXIT_CODE: "0",
      ECHO_PORT: "${SERVICE_PORT}",
    },
    ports: {
      service: 43100,
    },
    urls: [
      {
        label: "service",
        url: "http://127.0.0.1:${SERVICE_PORT}/health",
      },
    ],
    healthcheck: { type: "process" },
  });

  await writeExecutableFixtureService(servicesRoot, "beta-service", {
    ports: { service: 43100 },
    env: { ECHO_PORT: "${SERVICE_PORT}" },
  });
  await writeManifest(servicesRoot, "beta-service", {
    id: "beta-service",
    name: "Beta Service",
    description: "Second service colliding on the same preferred port.",
    executable: process.execPath,
    args: ["runtime/fixture-service.mjs"],
    env: {
      FIXTURE_EXIT_CODE: "0",
      ECHO_PORT: "${SERVICE_PORT}",
    },
    ports: {
      service: 43100,
    },
    urls: [
      {
        label: "service",
        url: "http://127.0.0.1:${SERVICE_PORT}/health",
      },
    ],
    healthcheck: { type: "process" },
  });

  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    await postJson(`${apiServer.url}/api/services/alpha-service/install`);
    await postJson(`${apiServer.url}/api/services/beta-service/install`);

    const alphaConfig = await postJson(`${apiServer.url}/api/services/alpha-service/config`);
    const betaConfig = await postJson(`${apiServer.url}/api/services/beta-service/config`);

    assert.equal(alphaConfig.status, 200);
    assert.equal(betaConfig.status, 200);
    assert.equal(alphaConfig.body.state.runtime.ports.service, 43100);
    assert.equal(betaConfig.body.state.runtime.ports.service > 43100, true);

    const alphaNetwork = await fetch(`${apiServer.url}/api/services/alpha-service/network`);
    const alphaBody = await alphaNetwork.json();
    const betaNetwork = await fetch(`${apiServer.url}/api/services/beta-service/network`);
    const betaBody = await betaNetwork.json();

    assert.equal(alphaBody.network.ports.service, 43100);
    assert.equal(betaBody.network.ports.service > 43100, true);
    assert.ok(alphaBody.network.endpoints.some((entry) => entry.url === "http://127.0.0.1:43100/health"));
    assert.ok(
      betaBody.network.endpoints.some(
        (entry) => entry.url === `http://127.0.0.1:${betaBody.network.ports.service}/health`,
      ),
    );
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("managed processes receive negotiated port env values", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-ports-");
  const { serviceRoot } = await writeExecutableFixtureService(servicesRoot, "port-env-service", {
    captureEnvKeys: ["SERVICE_PORT", "ECHO_PORT"],
    env: {
      ECHO_PORT: "${SERVICE_PORT}",
    },
    ports: {
      service: 43120,
    },
  });

  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    await postJson(`${apiServer.url}/api/services/port-env-service/install`);
    const config = await postJson(`${apiServer.url}/api/services/port-env-service/config`);
    await postJson(`${apiServer.url}/api/services/port-env-service/start`);

    const envSnapshot = JSON.parse(
      await waitFor(async () => {
        try {
          return await readFile(path.join(serviceRoot, "runtime", "env.json"), "utf8");
        } catch (error) {
          if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
            return null;
          }
          throw error;
        }
      }),
    );

    assert.equal(envSnapshot.SERVICE_PORT, String(config.body.state.runtime.ports.service));
    assert.equal(envSnapshot.ECHO_PORT, String(config.body.state.runtime.ports.service));

    await postJson(`${apiServer.url}/api/services/port-env-service/stop`);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
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
