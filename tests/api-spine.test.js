import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import { startRuntimeApp } from "../dist/runtime/app.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import {
  clearPersistedFixtureState,
  makeTempServicesRoot,
  writeManifest,
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
    assert.equal(result.body.services.length, 10);
    assert.deepEqual(
      result.body.services.map((service) => service.id),
      ["@archive", "@java", "@localcert", "@nginx", "@node", "@python", "@serviceadmin", "@traefik", "echo-service", "node-sample-service"],
    );
    assert.equal(result.body.services[0].status, "discovered");
    assert.equal(result.body.services[0].source, "manifest");
  } finally {
    await apiServer.stop();
    await clearPersistedFixtureState(servicesRoot);
  }
});

test("dashboard adapter routes expose bounded admin-facing service and summary shapes", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-dashboard-adapter-");
  await writeExecutableFixtureService(servicesRoot, "alpha-service", {
    stdoutLines: ["alpha ready"],
    stderrLines: ["alpha warn"],
    ports: {
      service: 43140,
    },
    urls: [
      {
        label: "service",
        url: "http://127.0.0.1:${SERVICE_PORT}/",
        kind: "local",
      },
    ],
  });
  await writeExecutableFixtureService(servicesRoot, "bravo-service", {
    depend_on: ["alpha-service"],
    ports: {
      service: 43141,
    },
    urls: [
      {
        label: "service",
        url: "http://127.0.0.1:${SERVICE_PORT}/",
        kind: "local",
      },
    ],
  });
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    for (const serviceId of ["alpha-service", "bravo-service"]) {
      let result = await postJson(`${apiServer.url}/api/services/${serviceId}/install`);
      assert.equal(result.status, 200);
      result = await postJson(`${apiServer.url}/api/services/${serviceId}/config`);
      assert.equal(result.status, 200);
    }

    let result = await postJson(`${apiServer.url}/api/services/alpha-service/start`);
    assert.equal(result.status, 200);

    const favoriteResponse = await fetch(`${apiServer.url}/api/services/alpha-service/meta`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        favorite: true,
      }),
    });
    assert.equal(favoriteResponse.status, 200);

    await waitFor(async () => {
      const response = await getJson(`${apiServer.url}/api/dashboard/services/alpha-service`);
      if (response.body.service.recentLogs.some((entry) => entry.message === "alpha ready")) {
        return response;
      }
      return null;
    });

    const summary = await getJson(`${apiServer.url}/api/dashboard`);
    const services = await getJson(`${apiServer.url}/api/dashboard/services`);
    const alphaDetail = await getJson(`${apiServer.url}/api/dashboard/services/alpha-service`);
    const bravoDetail = await getJson(`${apiServer.url}/api/dashboard/services/bravo-service`);

    assert.equal(summary.status, 200);
    assert.equal(summary.body.summary.servicesTotal, 2);
    assert.equal(summary.body.summary.servicesRunning, 1);
    assert.equal(summary.body.summary.servicesStopped, 1);
    assert.equal(summary.body.summary.favorites.length, 1);
    assert.equal(summary.body.summary.favorites[0].id, "alpha-service");
    assert.ok(summary.body.summary.warnings.includes("At least one managed service is currently stopped."));

    assert.equal(services.status, 200);
    assert.equal(Array.isArray(services.body.services), true);
    assert.equal(services.body.services.length, 2);

    assert.equal(alphaDetail.status, 200);
    assert.equal(alphaDetail.body.service.id, "alpha-service");
    assert.equal(alphaDetail.body.service.favorite, true);
    assert.equal(alphaDetail.body.service.status, "running");
    assert.equal(alphaDetail.body.service.installed, true);
    assert.equal(alphaDetail.body.service.role.length > 0, true);
    assert.equal(alphaDetail.body.service.metadata.installPath.endsWith(path.join("services", "alpha-service")), true);
    assert.equal(alphaDetail.body.service.metadata.configPath.endsWith(path.join("services", "alpha-service", "service.json")), true);
    assert.equal(alphaDetail.body.service.metadata.logPath.endsWith(path.join("services", "alpha-service", "logs", "runtime", "service.log")), true);
    assert.ok(alphaDetail.body.service.links.some((link) => link.label === "service"));
    assert.ok(alphaDetail.body.service.endpoints.some((endpoint) => endpoint.port === 43140));
    assert.ok(alphaDetail.body.service.environmentVariables.some((entry) => entry.key === "SERVICE_PORT"));
    assert.ok(alphaDetail.body.service.recentLogs.some((entry) => entry.message === "alpha ready" && entry.source === "stdout"));
    assert.ok(alphaDetail.body.service.actions.some((action) => action.kind === "open_logs"));
    assert.ok(alphaDetail.body.service.dependents.some((entry) => entry.id === "bravo-service" && entry.status === "stopped"));

    assert.equal(bravoDetail.status, 200);
    assert.equal(bravoDetail.body.service.status, "stopped");
    assert.ok(bravoDetail.body.service.dependencies.some((entry) => entry.id === "alpha-service" && entry.status === "running"));
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
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

test("runtime app honors servicesRoot and workspaceRoot environment overrides", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-app-env-config-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const previousServicesRoot = process.env.SERVICE_LASSO_SERVICES_ROOT;
  const previousWorkspaceRoot = process.env.SERVICE_LASSO_WORKSPACE_ROOT;

  process.env.SERVICE_LASSO_SERVICES_ROOT = path.resolve("services");
  process.env.SERVICE_LASSO_WORKSPACE_ROOT = workspaceRoot;

  try {
    const app = await startRuntimeApp({ port: 0, version: "env-config-test" });

    try {
      const result = await getJson(`${app.apiServer.url}/api/runtime`);

      assert.equal(result.status, 200);
      assert.equal(result.body.runtime.servicesRoot, path.resolve("services"));
      assert.equal(result.body.runtime.workspaceRoot, path.resolve(workspaceRoot));
    } finally {
      await app.apiServer.stop();
    }
  } finally {
    if (previousServicesRoot === undefined) {
      delete process.env.SERVICE_LASSO_SERVICES_ROOT;
    } else {
      process.env.SERVICE_LASSO_SERVICES_ROOT = previousServicesRoot;
    }
    if (previousWorkspaceRoot === undefined) {
      delete process.env.SERVICE_LASSO_WORKSPACE_ROOT;
    } else {
      process.env.SERVICE_LASSO_WORKSPACE_ROOT = previousWorkspaceRoot;
    }
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

test("POST /api/runtime/actions/autostart starts only autostart-eligible services deterministically", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-runtime-autostart-");
  await writeExecutableFixtureService(servicesRoot, "alpha-service", {
    autostart: true,
  });
  await writeExecutableFixtureService(servicesRoot, "bravo-service");
  await writeExecutableFixtureService(servicesRoot, "charlie-service", {
    autostart: true,
    depend_on: ["alpha-service"],
  });
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    for (const serviceId of ["alpha-service", "bravo-service", "charlie-service"]) {
      let result = await postJson(`${apiServer.url}/api/services/${serviceId}/install`);
      assert.equal(result.status, 200);
      result = await postJson(`${apiServer.url}/api/services/${serviceId}/config`);
      assert.equal(result.status, 200);
    }

    const autostart = await postJson(`${apiServer.url}/api/runtime/actions/autostart`);
    assert.equal(autostart.status, 200);
    assert.equal(autostart.body.action, "autostart");
    assert.equal(autostart.body.ok, true);
    assert.deepEqual(
      autostart.body.results.map((result) => result.serviceId),
      ["alpha-service", "charlie-service"],
    );
    assert.deepEqual(autostart.body.skipped, [
      { serviceId: "bravo-service", reason: "autostart_disabled" },
    ]);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runtime boot autostart starts eligible rehydrated services", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-runtime-boot-autostart-");
  await writeExecutableFixtureService(servicesRoot, "auto-service", {
    autostart: true,
  });
  await writeExecutableFixtureService(servicesRoot, "manual-service");

  const bootstrapServer = await startApiServer({ port: 0, servicesRoot });

  try {
    for (const serviceId of ["auto-service", "manual-service"]) {
      let result = await postJson(`${bootstrapServer.url}/api/services/${serviceId}/install`);
      assert.equal(result.status, 200);
      result = await postJson(`${bootstrapServer.url}/api/services/${serviceId}/config`);
      assert.equal(result.status, 200);
    }
  } finally {
    await bootstrapServer.stop();
    resetLifecycleState();
  }

  const autostartServer = await startApiServer({ port: 0, servicesRoot, autostart: true });

  try {
    const autoService = await getJson(`${autostartServer.url}/api/services/auto-service`);
    const manualService = await getJson(`${autostartServer.url}/api/services/manual-service`);

    assert.equal(autoService.status, 200);
    assert.equal(autoService.body.service.lifecycle.running, true);
    assert.equal(manualService.status, 200);
    assert.equal(manualService.body.service.lifecycle.running, false);
  } finally {
    await autostartServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("POST /api/runtime/actions/reload rediscover manifests and restart previously running eligible services", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-runtime-reload-");
  const alpha = await writeExecutableFixtureService(servicesRoot, "alpha-service");
  const bravo = await writeExecutableFixtureService(servicesRoot, "bravo-service", {
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

    let startAll = await postJson(`${apiServer.url}/api/runtime/actions/startAll`);
    assert.equal(startAll.status, 200);

    await writeManifest(servicesRoot, "bravo-service", {
      id: "bravo-service",
      name: "bravo-service",
      description: "Executable fixture for bravo-service.",
      enabled: false,
      executable: process.execPath,
      args: [path.relative(bravo.serviceRoot, bravo.scriptPath)],
      depend_on: ["alpha-service"],
      env: {
        FIXTURE_EXIT_CODE: "0",
      },
      healthcheck: { type: "process" },
    });

    const reload = await postJson(`${apiServer.url}/api/runtime/actions/reload`);
    assert.equal(reload.status, 200);
    assert.equal(reload.body.action, "reload");
    assert.equal(reload.body.ok, true);
    assert.deepEqual(
      reload.body.stopped.map((result) => result.serviceId),
      ["bravo-service", "alpha-service"],
    );
    assert.deepEqual(
      reload.body.results.map((result) => result.serviceId),
      ["alpha-service"],
    );
    assert.deepEqual(reload.body.skipped, [
      { serviceId: "bravo-service", reason: "disabled_after_reload" },
    ]);

    const alphaDetail = await getJson(`${apiServer.url}/api/services/alpha-service`);
    const bravoDetail = await getJson(`${apiServer.url}/api/services/bravo-service`);

    assert.equal(alphaDetail.body.service.lifecycle.running, true);
    assert.equal(bravoDetail.body.service.enabled, false);
    assert.equal(bravoDetail.body.service.lifecycle.running, false);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
