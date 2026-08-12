import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import net from "node:net";
import { createServer } from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { startApiServer as startRuntimeApiServer } from "../dist/server/index.js";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import {
  installService,
  configService,
  startService,
  stopService,
  cancelScheduledSupervisionRestart,
} from "../dist/runtime/lifecycle/actions.js";
import {
  hasManagedProcess,
  startManagedProcess,
  stopManagedProcess,
  waitForManagedProcessFinalization,
} from "../dist/runtime/execution/supervisor.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { resolveServiceVariable } from "../dist/runtime/operator/variables.js";
import { createServiceRegistry } from "../dist/runtime/manager/DependencyGraph.js";
import { createDirectExecutionPlan } from "../dist/runtime/providers/direct.js";
import { readStoredState } from "../dist/runtime/state/readState.js";
import {
  makeTempServicesRoot,
  writeManifest,
  writeExecutableFixtureService,
} from "./test-helpers.js";

async function postJson(url) {
  const response = await fetch(url, { method: "POST" });
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function startApiServer(options) {
  return await startRuntimeApiServer({
    ...options,
    workspaceRoot: options.workspaceRoot ?? path.join(path.dirname(options.servicesRoot), "workspace"),
  });
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

async function writeCrashOnceService(servicesRoot, serviceId, restartPolicy) {
  const serviceRoot = path.join(servicesRoot, serviceId);
  const runtimeRoot = path.join(serviceRoot, "runtime");
  await mkdir(runtimeRoot, { recursive: true });
  await writeFile(
    path.join(runtimeRoot, "crash-once.mjs"),
    `
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const runtimeRoot = path.resolve(process.cwd(), "runtime");
const markerPath = path.join(runtimeRoot, "crashed-once.txt");
const readyPath = path.join(runtimeRoot, "ready.txt");
await mkdir(runtimeRoot, { recursive: true });

try {
  await access(markerPath);
  setTimeout(() => {
    void writeFile(readyPath, "ready");
  }, 60);
  setInterval(() => {}, 1000);
} catch {
  await writeFile(readyPath, "ready");
  await writeFile(markerPath, "yes");
  setTimeout(() => {
    void rm(readyPath, { force: true }).finally(() => process.exit(7));
  }, 50);
}
`.trim(),
  );
  await writeManifest(servicesRoot, serviceId, {
    id: serviceId,
    name: serviceId,
    description: "Fixture that crashes once before staying up.",
    executable: process.execPath,
    args: ["runtime/crash-once.mjs"],
    restartPolicy,
    healthcheck: {
      type: "file",
      file: "./runtime/ready.txt",
      retries: 10,
      interval: 20,
      start_period: 0,
    },
  });
  return { serviceRoot };
}

test("lifecycle actions execute in the expected bounded order", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot(
    "service-lasso-lifecycle-",
  );
  await writeExecutableFixtureService(servicesRoot, "echo-service", {
    config: { files: [{ path: "./runtime/configured.txt", content: "configured\n" }] },
  });
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const install = await postJson(
      `${apiServer.url}/api/services/echo-service/install`,
    );
    assert.equal(install.status, 200);
    assert.equal(install.body.action, "install");
    assert.equal(install.body.state.installed, true);
    assert.equal(install.body.state.configured, false);
    assert.equal(install.body.state.running, false);

    const config = await postJson(
      `${apiServer.url}/api/services/echo-service/config`,
    );
    assert.equal(config.status, 200);
    assert.equal(config.body.action, "config");
    assert.equal(config.body.state.configured, true);

    const start = await postJson(
      `${apiServer.url}/api/services/echo-service/start`,
    );
    assert.equal(start.status, 200);
    assert.equal(start.body.action, "start");
    assert.equal(start.body.state.running, true);
    assert.equal(start.body.state.runtime.pid > 0, true);
    assert.equal(typeof start.body.state.runtime.command, "string");

    const restart = await postJson(
      `${apiServer.url}/api/services/echo-service/restart`,
    );
    assert.equal(restart.status, 200);
    assert.equal(restart.body.action, "restart");
    assert.equal(restart.body.state.running, true);
    assert.equal(restart.body.state.runtime.pid > 0, true);

    const stop = await postJson(
      `${apiServer.url}/api/services/echo-service/stop`,
    );
    assert.equal(stop.status, 200);
    assert.equal(stop.body.action, "stop");
    assert.equal(stop.body.state.running, false);
    assert.equal(stop.body.state.runtime.pid, null);

    const detailResponse = await fetch(
      `${apiServer.url}/api/services/echo-service`,
    );
    const detailBody = await detailResponse.json();

    assert.deepEqual(detailBody.service.lifecycle.actionHistory, [
      "install",
      "config",
      "start",
      "restart",
      "stop",
    ]);
    assert.equal(detailBody.service.lifecycle.lastAction, "stop");
    assert.equal(detailBody.service.lifecycle.runtime.exitCode, stop.body.state.runtime.exitCode);
    assert.equal(detailBody.service.lifecycle.runtime.lastTermination, "stopped");
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("install and config materialize bounded on-disk artifacts and persist them in lifecycle state", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot(
    "service-lasso-lifecycle-",
  );
  const { serviceRoot } = await writeExecutableFixtureService(
    servicesRoot,
    "materialized-service",
    {
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
            content:
              "SERVICE_PORT=${SERVICE_PORT}\nSERVICE_ROOT=${SERVICE_ROOT}\n",
          },
        ],
        templates: [
          {
            source: "./templates/templated.env",
            target: "./runtime/${SERVICE_ID}.templated.env",
          },
        ],
      },
    },
  );
  await mkdir(path.join(serviceRoot, "templates"), { recursive: true });
  await writeFile(
    path.join(serviceRoot, "templates", "templated.env"),
    "TEMPLATE_SERVICE=${SERVICE_ID}\nTEMPLATE_PORT=${SERVICE_PORT}\n",
  );
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const install = await postJson(
      `${apiServer.url}/api/services/materialized-service/install`,
    );
    const config = await postJson(
      `${apiServer.url}/api/services/materialized-service/config`,
    );

    const installPath = path.join(serviceRoot, "runtime", "install.txt");
    const configPath = path.join(serviceRoot, "runtime", "config.env");
    const templatedConfigPath = path.join(serviceRoot, "runtime", "materialized-service.templated.env");
    const stored = await readStoredState(serviceRoot);

    assert.equal(install.status, 200);
    assert.deepEqual(install.body.state.installArtifacts.files, [
      "runtime/install.txt",
    ]);
    assert.equal(
      typeof install.body.state.installArtifacts.updatedAt,
      "string",
    );
    assert.equal(
      await readFile(installPath, "utf8"),
      "installed materialized-service",
    );

    assert.equal(config.status, 200);
    assert.deepEqual(config.body.state.configArtifacts.files, [
      "runtime/config.env",
      "runtime/materialized-service.templated.env",
    ]);
    assert.equal(typeof config.body.state.configArtifacts.updatedAt, "string");
    assert.equal(
      await readFile(configPath, "utf8"),
      `SERVICE_PORT=41234\nSERVICE_ROOT=${serviceRoot}\n`,
    );
    assert.equal(
      await readFile(templatedConfigPath, "utf8"),
      "TEMPLATE_SERVICE=materialized-service\nTEMPLATE_PORT=41234\n",
    );
    assert.deepEqual(stored.install.files, ["runtime/install.txt"]);
    assert.deepEqual(stored.config.files, [
      "runtime/config.env",
      "runtime/materialized-service.templated.env",
    ]);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("config template materialization rejects sources outside the service root", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot(
    "service-lasso-lifecycle-",
  );
  await writeExecutableFixtureService(servicesRoot, "unsafe-template-source-service", {
    config: {
      templates: [
        {
          source: "../outside.env",
          target: "./runtime/generated.env",
        },
      ],
    },
  });

  try {
    const [service] = await discoverServices(servicesRoot);
    await installService(service);

    await assert.rejects(
      () => configService(service),
      /Materialized template source escapes the service root: \.\.\/outside\.env/,
    );
  } finally {
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("config template materialization rejects missing source files", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot(
    "service-lasso-lifecycle-",
  );
  await writeExecutableFixtureService(servicesRoot, "missing-template-service", {
    config: {
      templates: [
        {
          source: "./templates/missing.env",
          target: "./runtime/generated.env",
        },
      ],
    },
  });

  try {
    const [service] = await discoverServices(servicesRoot);
    await installService(service);

    await assert.rejects(
      () => configService(service),
      /Materialized template source does not exist: templates\/missing\.env/,
    );
  } finally {
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("config template materialization rejects targets outside the service root", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot(
    "service-lasso-lifecycle-",
  );
  const { serviceRoot } = await writeExecutableFixtureService(
    servicesRoot,
    "unsafe-template-target-service",
    {
      config: {
        templates: [
          {
            source: "./templates/config.env",
            target: "../outside.env",
          },
        ],
      },
    },
  );
  await mkdir(path.join(serviceRoot, "templates"), { recursive: true });
  await writeFile(path.join(serviceRoot, "templates", "config.env"), "SAFE=${SERVICE_ID}\n");

  try {
    const [service] = await discoverServices(servicesRoot);
    await installService(service);

    await assert.rejects(
      () => configService(service),
      /Materialized file path escapes the service root: \.\.\/outside\.env/,
    );
  } finally {
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("config can rerun without reinstall and rewrites effective config artifacts", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot(
    "service-lasso-lifecycle-",
  );
  const { serviceRoot } = await writeExecutableFixtureService(
    servicesRoot,
    "rerunnable-config-service",
    {
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
    },
  );
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    await postJson(
      `${apiServer.url}/api/services/rerunnable-config-service/install`,
    );

    const firstConfig = await postJson(
      `${apiServer.url}/api/services/rerunnable-config-service/config`,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    const secondConfig = await postJson(
      `${apiServer.url}/api/services/rerunnable-config-service/config`,
    );

    const configPath = path.join(serviceRoot, "runtime", "config.env");
    const detailResponse = await fetch(
      `${apiServer.url}/api/services/rerunnable-config-service`,
    );
    const detailBody = await detailResponse.json();

    assert.equal(firstConfig.status, 200);
    assert.equal(secondConfig.status, 200);
    assert.equal(secondConfig.body.state.configured, true);
    assert.deepEqual(secondConfig.body.state.actionHistory, [
      "install",
      "config",
      "config",
    ]);
    assert.equal(
      await readFile(configPath, "utf8"),
      "SERVICE_PORT=41235\nSERVICE_ID=rerunnable-config-service\n",
    );
    assert.equal(detailResponse.status, 200);
    assert.deepEqual(detailBody.service.lifecycle.configArtifacts.files, [
      "runtime/config.env",
    ]);
    assert.equal(
      typeof detailBody.service.lifecycle.configArtifacts.updatedAt,
      "string",
    );
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("intentional stop keeps persisted lifecycle metadata on stop", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot(
    "service-lasso-lifecycle-",
  );
  const { serviceRoot } = await writeExecutableFixtureService(
    servicesRoot,
    "echo-service",
  );
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    await postJson(`${apiServer.url}/api/services/echo-service/install`);
    await postJson(`${apiServer.url}/api/services/echo-service/config`);
    await postJson(`${apiServer.url}/api/services/echo-service/start`);

    const stop = await postJson(
      `${apiServer.url}/api/services/echo-service/stop`,
    );
    assert.equal(stop.status, 200);

    await waitFor(async () => {
      const stored = await readStoredState(serviceRoot);
      return (
        stored.runtime.lastAction === "stop" && stored.runtime.running === false
      );
    });

    const stored = await readStoredState(serviceRoot);
    assert.equal(stored.runtime.lastAction, "stop");
    assert.deepEqual(stored.runtime.actionHistory, [
      "install",
      "config",
      "start",
      "stop",
    ]);
    assert.equal(stored.runtime.running, false);
    assert.equal(stored.runtime.lastTermination, "stopped");
    assert.equal(typeof stored.runtime.finishedAt, "string");
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("restart replaces the running process and clears stale termination evidence", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot(
    "service-lasso-lifecycle-",
  );
  const { serviceRoot } = await writeExecutableFixtureService(
    servicesRoot,
    "restart-service",
  );
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    await postJson(`${apiServer.url}/api/services/restart-service/install`);
    await postJson(`${apiServer.url}/api/services/restart-service/config`);
    const start = await postJson(
      `${apiServer.url}/api/services/restart-service/start`,
    );
    const restart = await postJson(
      `${apiServer.url}/api/services/restart-service/restart`,
    );

    const stored = await readStoredState(serviceRoot);

    assert.equal(start.status, 200);
    assert.equal(restart.status, 200);
    assert.equal(restart.body.state.running, true);
    assert.equal(restart.body.state.lastAction, "restart");
    assert.equal(restart.body.state.runtime.pid > 0, true);
    assert.notEqual(
      restart.body.state.runtime.pid,
      start.body.state.runtime.pid,
    );
    assert.equal(restart.body.state.runtime.finishedAt, null);
    assert.equal(restart.body.state.runtime.lastTermination, null);
    assert.equal(stored.runtime.running, true);
    assert.equal(stored.runtime.lastAction, "restart");
    assert.deepEqual(stored.runtime.actionHistory, [
      "install",
      "config",
      "start",
      "restart",
    ]);
    assert.equal(stored.runtime.finishedAt, null);
    assert.equal(stored.runtime.lastTermination, null);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("start blocks required broker failures with safe ref and status metadata", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot(
    "service-lasso-startup-broker-fail-",
  );
  await writeExecutableFixtureService(servicesRoot, "broker-gated", {
    env: {
      DB_PASSWORD: "${database.PASSWORD}",
    },
    broker: {
      imports: [
        {
          namespace: "shared/database",
          ref: "database.PASSWORD",
          as: "DB_PASSWORD",
          required: true,
        },
      ],
    },
  });

  try {
    const discovered = await discoverServices(servicesRoot);
    const registry = createServiceRegistry(discovered);
    const service = registry.getById("broker-gated");
    assert.ok(service);

    await installService(service, registry);
    await configService(service, registry);
    await assert.rejects(
      () =>
        startService(service, registry, {
          brokerLookup: () => [
            {
              ref: "database.PASSWORD",
              status: "policy-denied",
              value: "raw-secret-must-not-leak",
            },
          ],
        }),
      (error) => {
        assert.match(error.message, /database\.PASSWORD:policy-denied/);
        assert.equal(error.message.includes("raw-secret-must-not-leak"), false);
        return true;
      },
    );
  } finally {
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("start fails when the executable is missing and keeps the error explicit", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot(
    "service-lasso-lifecycle-",
  );
  await writeManifest(servicesRoot, "missing-executable", {
    id: "missing-executable",
    name: "missing-executable",
    description: "Fixture with a missing executable.",
    executable: "./runtime/missing-executable.exe",
    args: [],
    healthcheck: { type: "process" },
  });
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const start = await postJson(
      `${apiServer.url}/api/services/missing-executable/start`,
    );
    assert.equal(start.status, 409);
    assert.equal(start.body.error, "invalid_lifecycle_state");
    assert.equal(start.body.statusCode, 409);
    assert.match(start.body.message, /process spawn failed/i);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("unknown lifecycle actions return a deterministic client error", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot(
    "service-lasso-lifecycle-",
  );
  await writeExecutableFixtureService(servicesRoot, "echo-service");
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const response = await postJson(
      `${apiServer.url}/api/services/echo-service/ship-it`,
    );

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
  const { tempRoot, servicesRoot } = await makeTempServicesRoot(
    "service-lasso-lifecycle-",
  );
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
  const { tempRoot, servicesRoot } = await makeTempServicesRoot(
    "service-lasso-lifecycle-",
  );
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
    const start = await postJson(
      `${apiServer.url}/api/services/ready-file-service/start`,
    );
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

test("unexpected crash without restartPolicy records no automatic restart", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot(
    "service-lasso-supervision-no-policy-",
  );
  const { serviceRoot } = await writeExecutableFixtureService(servicesRoot, "no-policy-crash", {
    autoExitMs: 30,
    exitCode: 7,
  });

  try {
    const [service] = await discoverServices(servicesRoot);
    await installService(service);
    await configService(service);
    await startService(service);

    await waitForManagedProcessFinalization("no-policy-crash");

    const stored = await readStoredState(serviceRoot);
    assert.equal(stored.runtime.lastTermination, "crashed");
    assert.equal(stored.runtime.supervision.lastRestartResult, "blocked");
    assert.equal(stored.runtime.supervision.restartAttempts, 0);
    assert.equal(hasManagedProcess("no-policy-crash"), false);
  } finally {
    await stopManagedProcess("no-policy-crash", 100).catch(() => null);
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("start waits for each required healthchecks array item and reports attempts", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot(
    "service-lasso-lifecycle-healthchecks-array-",
  );
  await writeExecutableFixtureService(servicesRoot, "array-ready-service", {
    readyFileAfterMs: 500,
    readyFileRelativePath: "./runtime/ready.txt",
    healthchecks: [
      {
        id: "process-started",
        type: "process",
        retries: 2,
        interval: 10,
      },
      {
        id: "ready-file",
        type: "file",
        file: "./runtime/ready.txt",
        retries: 20,
        interval: 50,
        start_period: 0,
      },
    ],
  });
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    await postJson(`${apiServer.url}/api/services/array-ready-service/install`);
    await postJson(`${apiServer.url}/api/services/array-ready-service/config`);

    const start = await postJson(`${apiServer.url}/api/services/array-ready-service/start`);

    assert.equal(start.status, 200);
    assert.equal(start.body.ok, true);
    assert.equal(start.body.health.type, "aggregate");
    assert.equal(start.body.health.healthy, true);
    assert.deepEqual(start.body.health.checks.map((check) => check.id), ["process-started", "ready-file"]);
    assert.equal(start.body.health.checks.find((check) => check.id === "ready-file").attempts >= 1, true);
    assert.match(start.body.message, /2 healthcheck/i);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("disabled restartPolicy records no automatic restart after crash", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot(
    "service-lasso-supervision-disabled-policy-",
  );
  const { serviceRoot } = await writeExecutableFixtureService(servicesRoot, "disabled-policy-crash", {
    autoExitMs: 30,
    exitCode: 7,
    restartPolicy: {
      enabled: false,
      onCrash: true,
    },
  });

  try {
    const [service] = await discoverServices(servicesRoot);
    await installService(service);
    await configService(service);
    await startService(service);

    await waitForManagedProcessFinalization("disabled-policy-crash");

    const stored = await readStoredState(serviceRoot);
    assert.equal(stored.runtime.lastTermination, "crashed");
    assert.equal(stored.runtime.supervision.lastRestartResult, "blocked");
    assert.equal(stored.runtime.supervision.restartAttempts, 0);
    assert.equal(hasManagedProcess("disabled-policy-crash"), false);
  } finally {
    await stopManagedProcess("disabled-policy-crash", 100).catch(() => null);
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("start blocks on a failed required healthchecks item and names the check id", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot(
    "service-lasso-lifecycle-healthchecks-fail-",
  );
  await writeExecutableFixtureService(servicesRoot, "array-not-ready-service", {
    healthchecks: [
      {
        id: "process-started",
        type: "process",
      },
      {
        id: "missing-ready-file",
        type: "file",
        file: "./runtime/ready.txt",
        retries: 3,
        interval: 25,
      },
    ],
  });
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    await postJson(`${apiServer.url}/api/services/array-not-ready-service/install`);
    await postJson(`${apiServer.url}/api/services/array-not-ready-service/config`);

    const start = await postJson(`${apiServer.url}/api/services/array-not-ready-service/start`);

    assert.equal(start.status, 200);
    assert.equal(start.body.ok, false);
    assert.equal(start.body.health.type, "aggregate");
    assert.equal(start.body.health.healthy, false);
    assert.match(start.body.message, /missing-ready-file/);
    assert.match(start.body.message, /failed after 3 readiness attempt/i);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("enabled crash restart policy starts service again through readiness", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot(
    "service-lasso-supervision-crash-restart-",
  );
  const { serviceRoot } = await writeCrashOnceService(servicesRoot, "crash-once-service", {
    enabled: true,
    onCrash: true,
    maxAttempts: 2,
    backoffSeconds: 0,
  });

  try {
    const [service] = await discoverServices(servicesRoot);
    await installService(service);
    await configService(service);
    const firstStart = await startService(service);

    await waitFor(async () => {
      const stored = await readStoredState(serviceRoot);
      return (
        stored.runtime?.running === true &&
        stored.runtime?.metrics?.launchCount >= 2 &&
        stored.runtime?.supervision?.lastRestartResult === "started"
      );
    }, 2_000);

    const stored = await readStoredState(serviceRoot);
    assert.equal(firstStart.ok, true);
    assert.equal(stored.runtime.running, true);
    assert.notEqual(stored.runtime.pid, firstStart.state.runtime.pid);
    assert.equal(stored.runtime.supervision.restartAttempts, 0);
    assert.equal(stored.runtime.supervision.lastRestartReason, "crash");
    assert.equal(stored.runtime.supervision.nextRestartAt, null);
    assert.equal(
      stored.runtime.startTrace.current.events.some(
        (event) => event.phase === "health_check" && event.status === "completed",
      ),
      true,
    );
  } finally {
    await stopManagedProcess("crash-once-service", 100).catch(() => null);
    await waitForManagedProcessFinalization("crash-once-service").catch(() => undefined);
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("manual stop does not trigger automatic restart", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot(
    "service-lasso-supervision-manual-stop-",
  );
  const { serviceRoot } = await writeExecutableFixtureService(servicesRoot, "manual-stop-service", {
    restartPolicy: {
      enabled: true,
      onCrash: true,
      backoffSeconds: 0,
    },
  });

  try {
    const [service] = await discoverServices(servicesRoot);
    await installService(service);
    await configService(service);
    await startService(service);
    const stop = await stopService(service);
    await new Promise((resolve) => setTimeout(resolve, 100));

    assert.equal(stop.state.running, false);
    assert.equal(stop.state.runtime.lastTermination, "stopped");
    assert.equal(stop.state.runtime.metrics.launchCount, 1);
    assert.equal(stop.state.runtime.supervision.lastRestartResult, null);
  } finally {
    await stopManagedProcess("manual-stop-service", 100).catch(() => null);
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("clean unexpected exit does not restart under crash policy", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot(
    "service-lasso-supervision-clean-exit-",
  );
  const { serviceRoot } = await writeExecutableFixtureService(servicesRoot, "clean-exit-service", {
    autoExitMs: 30,
    exitCode: 0,
    restartPolicy: {
      enabled: true,
      onCrash: true,
      backoffSeconds: 0,
    },
  });

  try {
    const [service] = await discoverServices(servicesRoot);
    await installService(service);
    await configService(service);
    await startService(service);
    await waitForManagedProcessFinalization("clean-exit-service");

    const stored = await readStoredState(serviceRoot);
    assert.equal(stored.runtime.lastTermination, "exited");
    assert.equal(stored.runtime.supervision.lastRestartResult, "blocked");
    assert.equal(stored.runtime.metrics.launchCount, 1);
  } finally {
    await stopManagedProcess("clean-exit-service", 100).catch(() => null);
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("maxAttempts blocks crash restart attempts at the configured limit", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot(
    "service-lasso-supervision-max-attempts-",
  );
  const { serviceRoot } = await writeExecutableFixtureService(servicesRoot, "max-attempts-service", {
    autoExitMs: 30,
    exitCode: 7,
    restartPolicy: {
      enabled: true,
      onCrash: true,
      maxAttempts: 0,
      backoffSeconds: 0,
    },
  });

  try {
    const [service] = await discoverServices(servicesRoot);
    await installService(service);
    await configService(service);
    await startService(service);

    await waitFor(async () => {
      const stored = await readStoredState(serviceRoot);
      return stored.runtime?.supervision?.lastRestartResult === "blocked";
    }, 1_500);

    const stored = await readStoredState(serviceRoot);
    assert.equal(stored.runtime.running, false);
    assert.equal(stored.runtime.supervision.restartAttempts, 0);
    assert.equal(stored.runtime.metrics.launchCount, 1);
  } finally {
    await stopManagedProcess("max-attempts-service", 100).catch(() => null);
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("backoff records the next restart time before launching again", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot(
    "service-lasso-supervision-backoff-",
  );
  const { serviceRoot } = await writeCrashOnceService(servicesRoot, "backoff-service", {
    enabled: true,
    onCrash: true,
    maxAttempts: 1,
    backoffSeconds: 1,
  });

  try {
    const [service] = await discoverServices(servicesRoot);
    await installService(service);
    await configService(service);
    await startService(service);

    await waitFor(async () => {
      const stored = await readStoredState(serviceRoot);
      return stored.runtime?.supervision?.lastRestartResult === "scheduled";
    }, 1_500);

    const stored = await readStoredState(serviceRoot);
    assert.equal(stored.runtime.running, false);
    assert.equal(stored.runtime.metrics.launchCount, 1);
    assert.equal(stored.runtime.supervision.restartAttempts, 1);
    assert.ok(Date.parse(stored.runtime.supervision.nextRestartAt) > Date.parse(stored.runtime.supervision.lastRestartAttemptAt));
    cancelScheduledSupervisionRestart("backoff-service");
  } finally {
    cancelScheduledSupervisionRestart("backoff-service");
    await stopManagedProcess("backoff-service", 100).catch(() => null);
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("disabled service is not automatically restarted after crash", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot(
    "service-lasso-supervision-disabled-service-",
  );
  const { serviceRoot } = await writeExecutableFixtureService(servicesRoot, "disabled-service-crash", {
    enabled: false,
    autoExitMs: 30,
    exitCode: 7,
    restartPolicy: {
      enabled: true,
      onCrash: true,
      backoffSeconds: 0,
    },
  });

  try {
    const [service] = await discoverServices(servicesRoot);
    await installService(service);
    await configService(service);
    await startService(service);

    await waitFor(async () => {
      const stored = await readStoredState(serviceRoot);
      return stored.runtime?.supervision?.lastRestartResult === "blocked";
    }, 1_500);

    const stored = await readStoredState(serviceRoot);
    assert.equal(stored.runtime.running, false);
    assert.equal(stored.runtime.metrics.launchCount, 1);
    assert.equal(stored.runtime.supervision.restartAttempts, 0);
  } finally {
    await stopManagedProcess("disabled-service-crash", 100).catch(() => null);
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("start does not block on failed optional healthchecks array items", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot(
    "service-lasso-lifecycle-healthchecks-optional-",
  );
  await writeExecutableFixtureService(servicesRoot, "optional-array-service", {
    healthchecks: [
      {
        id: "process-started",
        type: "process",
      },
      {
        id: "optional-ready-file",
        type: "file",
        file: "./runtime/optional.txt",
        required: false,
        retries: 5,
        interval: 25,
      },
    ],
  });
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    await postJson(`${apiServer.url}/api/services/optional-array-service/install`);
    await postJson(`${apiServer.url}/api/services/optional-array-service/config`);

    const start = await postJson(`${apiServer.url}/api/services/optional-array-service/start`);

    assert.equal(start.status, 200);
    assert.equal(start.body.ok, true);
    assert.equal(start.body.health.type, "aggregate");
    assert.equal(start.body.health.healthy, true);
    const optional = start.body.health.checks.find((check) => check.id === "optional-ready-file");
    assert.equal(optional.required, false);
    assert.equal(optional.healthy, false);
    assert.equal(optional.attempts, 1);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("explicit HTTP healthcheck without readiness options waits with default attempts", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot(
    "service-lasso-lifecycle-http-default-readiness-",
  );
  const readyAt = Date.now() + 120;
  const probeServer = createServer((_, response) => {
    response.statusCode = Date.now() >= readyAt ? 200 : 503;
    response.end("ok");
  });
  probeServer.listen(0, "127.0.0.1");
  await new Promise((resolve) => probeServer.once("listening", resolve));
  const probeAddress = probeServer.address();
  if (!probeAddress || typeof probeAddress === "string") {
    throw new Error("HTTP probe server failed to bind.");
  }

  await writeExecutableFixtureService(servicesRoot, "http-default-readiness", {
    healthcheck: {
      type: "http",
      url: `http://127.0.0.1:${probeAddress.port}/health`,
      expected_status: 200,
    },
  });
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    await postJson(`${apiServer.url}/api/services/http-default-readiness/install`);
    await postJson(`${apiServer.url}/api/services/http-default-readiness/config`);

    const start = await postJson(`${apiServer.url}/api/services/http-default-readiness/start`);

    assert.equal(start.status, 200);
    assert.equal(start.body.ok, true);
    assert.equal(start.body.health.type, "http");
    assert.equal(start.body.health.healthy, true);
    assert.match(start.body.message, /of 10/i);
  } finally {
    await apiServer.stop();
    await new Promise((resolve) => probeServer.close(resolve));
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("explicit TCP healthcheck without retries uses default attempts", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot(
    "service-lasso-lifecycle-tcp-default-readiness-",
  );
  const reservationServer = net.createServer();
  reservationServer.listen(0, "127.0.0.1");
  await new Promise((resolve) => reservationServer.once("listening", resolve));
  const reservedAddress = reservationServer.address();
  if (!reservedAddress || typeof reservedAddress === "string") {
    throw new Error("TCP probe reservation failed to bind.");
  }
  const probePort = reservedAddress.port;
  await new Promise((resolve) => reservationServer.close(resolve));

  const delayedProbeServer = net.createServer((socket) => {
    socket.end("OK");
  });
  const openProbe = setTimeout(() => {
    delayedProbeServer.listen(probePort, "127.0.0.1");
  }, 80);

  await writeExecutableFixtureService(servicesRoot, "tcp-default-attempts", {
    healthcheck: {
      type: "tcp",
      address: `127.0.0.1:${probePort}`,
      interval: 20,
    },
  });
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    await postJson(`${apiServer.url}/api/services/tcp-default-attempts/install`);
    await postJson(`${apiServer.url}/api/services/tcp-default-attempts/config`);

    const start = await postJson(`${apiServer.url}/api/services/tcp-default-attempts/start`);

    assert.equal(start.status, 200);
    assert.equal(start.body.ok, true);
    assert.equal(start.body.health.type, "tcp");
    assert.equal(start.body.health.healthy, true);
    assert.match(start.body.message, /of 10/i);
  } finally {
    clearTimeout(openProbe);
    await apiServer.stop();
    if (delayedProbeServer.listening) {
      await new Promise((resolve) => delayedProbeServer.close(resolve));
    }
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("managed process stop escalates after timeout and clears supervisor state", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot(
    "service-lasso-managed-stop-",
  );
  await writeExecutableFixtureService(servicesRoot, "stubborn-service", {
    ignoreSignals: true,
    stdoutLines: ["signal-handlers-ready"],
  });
  let exitFinalized = false;

  try {
    const [service] = await discoverServices(servicesRoot);
    const handle = await startManagedProcess({
      service,
      executionPlan: createDirectExecutionPlan(service.manifest),
      onExit: async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        exitFinalized = true;
      },
    });

    assert.equal(handle.pid > 0, true);
    assert.equal(hasManagedProcess("stubborn-service"), true);

    // Wait for output emitted after the fixture installs its signal handlers.
    await waitFor(async () => {
      try {
        return (await readFile(handle.logs.stdoutPath, "utf8")).includes("signal-handlers-ready");
      } catch {
        return false;
      }
    });

    const stopped = await stopManagedProcess("stubborn-service", 100);

    assert.ok(stopped);
    assert.equal(hasManagedProcess("stubborn-service"), false);
    assert.equal(exitFinalized, true);
    if (process.platform !== "win32") {
      assert.equal(stopped.signal, "SIGKILL");
    }
  } finally {
    await stopManagedProcess("stubborn-service", 100).catch(() => null);
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("managed process captures outputvarregex matches into runtime state", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot(
    "service-lasso-outputvarregex-",
  );
  const { serviceRoot } = await writeExecutableFixtureService(
    servicesRoot,
    "outputvar-service",
    {
      stdoutLines: ["IGNORED", "PORT=4123", "PORT=4124"],
      stderrLines: ["TOKEN=stderr-value"],
      outputvarregex: {
        CAPTURED_PORT: "PORT=(\\d+)",
        STDERR_TOKEN: "TOKEN=(\\S+)",
        NO_MATCH: "NO_MATCH=(\\S+)",
      },
    },
  );

  try {
    const [service] = await discoverServices(servicesRoot);
    const handle = await startManagedProcess({
      service,
      executionPlan: createDirectExecutionPlan(service.manifest),
    });

    assert.equal(handle.pid > 0, true);
    await waitFor(async () => {
      const stored = await readStoredState(serviceRoot);
      return (
        stored.runtime?.variables?.CAPTURED_PORT?.value === "4124" &&
        stored.runtime?.variables?.STDERR_TOKEN?.value === "stderr-value"
      );
    });

    const stored = await readStoredState(serviceRoot);
    assert.deepEqual(stored.runtime.variables.CAPTURED_PORT, {
      value: "4124",
      source: "stdout",
      matchedAt: stored.runtime.variables.CAPTURED_PORT.matchedAt,
    });
    assert.equal(typeof stored.runtime.variables.CAPTURED_PORT.matchedAt, "string");
    assert.deepEqual(stored.runtime.variables.STDERR_TOKEN, {
      value: "stderr-value",
      source: "stderr",
      matchedAt: stored.runtime.variables.STDERR_TOKEN.matchedAt,
    });
    assert.equal(stored.runtime.variables.NO_MATCH, undefined);

    const capturedPort = resolveServiceVariable(service, "CAPTURED_PORT");
    const stderrToken = resolveServiceVariable(service, "STDERR_TOKEN");
    assert.deepEqual(capturedPort, {
      key: "CAPTURED_PORT",
      value: "4124",
      scope: "runtime",
    });
    assert.deepEqual(stderrToken, {
      key: "STDERR_TOKEN",
      value: "stderr-value",
      scope: "runtime",
    });
  } finally {
    await stopManagedProcess("outputvar-service", 100).catch(() => null);
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("managed process spawn resolves path-list env to strings with secure env precedence", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot(
    "service-lasso-path-list-spawn-env-",
  );
  const captureEnvFileRelativePath = "./runtime/spawn-env.json";
  const { serviceRoot } = await writeExecutableFixtureService(
    servicesRoot,
    "path-list-spawn-env",
    {
      captureEnvKeys: [
        "PATH",
        "PLUGIN_PATH",
        "API_TOKEN",
        "BROKER_ONLY",
        "SERVICE_PORT",
      ],
      captureEnvFileRelativePath,
      env: {
        PATH: ["${PYTHON_HOME}", "${PYTHON_SCRIPTS_PATH}", "${SERVICE_ROOT}/bin"],
        PLUGIN_PATH: ["${SERVICE_ROOT}/plugins", "${vault.api.token}"],
        API_TOKEN: "${vault.api.token}",
      },
      broker: {
        imports: [
          {
            namespace: "shared/vault",
            ref: "vault.api.token",
            as: "BROKER_ONLY",
            required: true,
          },
        ],
      },
      ports: {
        service: 4577,
      },
    },
  );

  try {
    const [service] = await discoverServices(servicesRoot);
    const handle = await startManagedProcess({
      service,
      executionPlan: createDirectExecutionPlan(service.manifest),
      sharedGlobalEnv: {
        PYTHON_HOME: "C:/Python311",
        PYTHON_SCRIPTS_PATH: "C:/Python311/Scripts",
      },
      resolvedPorts: { service: 4577 },
      secureEnv: {
        API_TOKEN: "secure-api-token",
        BROKER_ONLY: "secure-broker-token",
      },
      variableResolution: {
        brokerValues: {
          "vault.api.token": "broker-api-token",
        },
      },
    });

    assert.equal(handle.pid > 0, true);
    const capturePath = path.join(serviceRoot, captureEnvFileRelativePath);
    await waitFor(async () => {
      try {
        await readFile(capturePath, "utf8");
        return true;
      } catch {
        return false;
      }
    });

    const captured = JSON.parse(await readFile(capturePath, "utf8"));
    const serviceRootBin = `${serviceRoot}/bin`;
    assert.equal(
      captured.PATH,
      ["C:/Python311", "C:/Python311/Scripts", serviceRootBin].join(path.delimiter),
    );
    assert.equal(
      captured.PLUGIN_PATH,
      [`${serviceRoot}/plugins`, "broker-api-token"].join(path.delimiter),
    );
    assert.equal(captured.API_TOKEN, "secure-api-token");
    assert.equal(captured.BROKER_ONLY, "secure-broker-token");
    assert.equal(captured.SERVICE_PORT, "4577");
    assert.deepEqual(
      Object.entries(captured).filter(([, value]) => typeof value !== "string"),
      [],
    );
  } finally {
    await stopManagedProcess("path-list-spawn-env", 100).catch(() => null);
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("stop uses manifest actions.stop.commandline override before managed fallback", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot(
    "service-lasso-stop-override-",
  );
  const serviceRoot = path.join(servicesRoot, "graceful-stop-service");
  const runtimeRoot = path.join(serviceRoot, "runtime");
  await mkdir(runtimeRoot, { recursive: true });
  await writeFile(
    path.join(runtimeRoot, "server.mjs"),
    `
import { access } from "node:fs/promises";
import path from "node:path";

const stopFile = path.resolve(process.cwd(), "runtime", "stop-requested.txt");
const heartbeat = setInterval(async () => {
  try {
    await access(stopFile);
    clearInterval(heartbeat);
    process.exit(0);
  } catch {
  }
}, 25);
`.trim(),
  );
  await writeFile(
    path.join(runtimeRoot, "stop.mjs"),
    `
import { writeFile } from "node:fs/promises";
import path from "node:path";

await writeFile(path.resolve(process.cwd(), "runtime", "stop-requested.txt"), "stop");
await writeFile(path.resolve(process.cwd(), "runtime", "override-ran.txt"), "ran");
`.trim(),
  );
  await writeManifest(servicesRoot, "graceful-stop-service", {
    id: "graceful-stop-service",
    name: "Graceful Stop Service",
    description: "Fixture with manifest stop override.",
    executable: process.execPath,
    args: ["runtime/server.mjs"],
    healthcheck: { type: "process" },
    actions: {
      stop: {
        commandline: {
          default: `${JSON.stringify(process.execPath)} runtime/stop.mjs`,
        },
        timeoutSeconds: 2,
      },
    },
  });

  try {
    const [service] = await discoverServices(servicesRoot);

    await installService(service);
    await configService(service);
    const start = await startService(service);
    assert.equal(start.state.running, true);
    assert.equal(hasManagedProcess("graceful-stop-service"), true);

    const stop = await stopService(service);

    assert.equal(stop.ok, true);
    assert.equal(stop.state.running, false);
    assert.equal(stop.state.runtime.pid, null);
    assert.match(stop.message, /actions\.stop override/i);
    assert.equal(await readFile(path.join(runtimeRoot, "override-ran.txt"), "utf8"), "ran");
    assert.equal(hasManagedProcess("graceful-stop-service"), false);
  } finally {
    await stopManagedProcess("graceful-stop-service", 100).catch(() => null);
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("stop falls back to managed process stop when manifest override fails", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot(
    "service-lasso-stop-override-fallback-",
  );
  await writeExecutableFixtureService(servicesRoot, "fallback-stop-service", {
    actions: {
      stop: {
        commandline: {
          default: `${JSON.stringify(process.execPath)} -e "process.exit(7)"`,
        },
        timeoutSeconds: 1,
      },
    },
  });

  try {
    const [service] = await discoverServices(servicesRoot);

    await installService(service);
    await configService(service);
    await startService(service);
    assert.equal(hasManagedProcess("fallback-stop-service"), true);

    const stop = await stopService(service);

    assert.equal(stop.ok, true);
    assert.equal(stop.state.running, false);
    assert.equal(stop.state.runtime.pid, null);
    assert.match(stop.message, /fallback stop completed/i);
    assert.equal(hasManagedProcess("fallback-stop-service"), false);
  } finally {
    await stopManagedProcess("fallback-stop-service", 100).catch(() => null);
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("start returns a deterministic non-ready result when readiness times out", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot(
    "service-lasso-lifecycle-",
  );
  const { serviceRoot } = await writeExecutableFixtureService(
    servicesRoot,
    "not-ready-service",
    {
      healthcheck: {
        type: "file",
        file: "./runtime/ready.txt",
        retries: 3,
        interval: 25,
        start_period: 10,
      },
    },
  );
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    await postJson(`${apiServer.url}/api/services/not-ready-service/install`);
    await postJson(`${apiServer.url}/api/services/not-ready-service/config`);

    const start = await postJson(
      `${apiServer.url}/api/services/not-ready-service/start`,
    );

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
    assert.deepEqual(stored.runtime.actionHistory, [
      "install",
      "config",
      "start",
    ]);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
