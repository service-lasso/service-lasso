import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
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

async function putJson(url, body) {
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
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

test("runtime API binds to all interfaces by default while reporting a local URL", async () => {
  const previousHost = process.env.SERVICE_LASSO_HOST;
  delete process.env.SERVICE_LASSO_HOST;

  const apiServer = await startApiServer({ port: 0, version: "lan-bind-test" });

  try {
    const address = apiServer.server.address();

    assert.ok(address && typeof address !== "string");
    assert.equal(address.address, "0.0.0.0");
    assert.equal(apiServer.url, `http://127.0.0.1:${apiServer.port}`);
  } finally {
    await apiServer.stop();
    if (previousHost === undefined) {
      delete process.env.SERVICE_LASSO_HOST;
    } else {
      process.env.SERVICE_LASSO_HOST = previousHost;
    }
  }
});

test("runtime app host option overrides SERVICE_LASSO_HOST", async () => {
  const previousHost = process.env.SERVICE_LASSO_HOST;
  process.env.SERVICE_LASSO_HOST = "0.0.0.0";
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-runtime-host-"));
  const app = await startRuntimeApp({
    port: 0,
    host: "127.0.0.1",
    servicesRoot: path.resolve("services"),
    workspaceRoot: tempDir,
    version: "host-option-test",
  });

  try {
    const address = app.apiServer.server.address();

    assert.ok(address && typeof address !== "string");
    assert.equal(address.address, "127.0.0.1");
  } finally {
    await app.apiServer.stop();
    await rm(tempDir, { recursive: true, force: true });
    if (previousHost === undefined) {
      delete process.env.SERVICE_LASSO_HOST;
    } else {
      process.env.SERVICE_LASSO_HOST = previousHost;
    }
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
    assert.equal(result.body.services.length, 11);
    assert.deepEqual(
      result.body.services.map((service) => service.id),
      ["@archive", "@java", "@localcert", "@nginx", "@node", "@python", "@secretsbroker", "@serviceadmin", "@traefik", "echo-service", "node-sample-service"],
    );
    assert.equal(result.body.services[0].status, "discovered");
    assert.equal(result.body.services[0].source, "manifest");
  } finally {
    await apiServer.stop();
    await clearPersistedFixtureState(servicesRoot);
  }
});

test("GET /api/diagnostics/dependencies reports start blockers and safe next actions", async () => {
  resetLifecycleState();
  const occupiedPortServer = net.createServer();
  await new Promise((resolve, reject) => {
    occupiedPortServer.once("error", reject);
    occupiedPortServer.listen(0, "127.0.0.1", resolve);
  });
  const occupiedAddress = occupiedPortServer.address();
  assert.notEqual(typeof occupiedAddress, "string");
  const occupiedPort = occupiedAddress.port;
  await new Promise((resolve) => occupiedPortServer.close(resolve));
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-dependency-diagnostics-");

  await writeExecutableFixtureService(servicesRoot, "alpha-running", {
    ports: {
      service: 43150,
    },
  });
  await writeExecutableFixtureService(servicesRoot, "bravo-ready", {
    depend_on: ["alpha-running"],
    ports: {
      service: 43151,
    },
  });
  await writeExecutableFixtureService(servicesRoot, "charlie-missing-dependency", {
    depend_on: ["missing-service"],
  });
  await writeExecutableFixtureService(servicesRoot, "delta-occupied-port", {
    ports: {
      service: occupiedPort,
    },
  });
  await writeExecutableFixtureService(servicesRoot, "echo-disabled", {
    enabled: false,
  });
  await writeExecutableFixtureService(servicesRoot, "foxtrot-unhealthy", {
    healthcheck: {
      type: "tcp",
      address: "127.0.0.1:9",
    },
  });

  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    for (const serviceId of ["alpha-running", "bravo-ready", "delta-occupied-port", "foxtrot-unhealthy"]) {
      let result = await postJson(apiServer.url + "/api/services/" + serviceId + "/install");
      assert.equal(result.status, 200);
      result = await postJson(apiServer.url + "/api/services/" + serviceId + "/config");
      assert.equal(result.status, 200);
    }

    await new Promise((resolve, reject) => {
      occupiedPortServer.once("error", reject);
      occupiedPortServer.listen(occupiedPort, "127.0.0.1", resolve);
    });

    let result = await postJson(apiServer.url + "/api/services/alpha-running/start");
    assert.equal(result.status, 200);
    result = await postJson(apiServer.url + "/api/services/foxtrot-unhealthy/start");
    assert.equal(result.status, 200);

    const diagnostics = await getJson(apiServer.url + "/api/diagnostics/dependencies");
    assert.equal(diagnostics.status, 200);
    assert.equal(diagnostics.body.diagnostics.summary.status, "blocked");
    assert.equal(diagnostics.body.diagnostics.summary.totalServices, 6);
    assert.equal(diagnostics.body.diagnostics.summary.disabledServices, 1);

    const byId = new Map(diagnostics.body.diagnostics.services.map((service) => [service.id, service]));
    assert.equal(byId.get("alpha-running").readiness, "running");
    assert.equal(byId.get("bravo-ready").readiness, "ready");
    assert.equal(byId.get("bravo-ready").dependencies[0].ready, true);
    assert.equal(byId.get("charlie-missing-dependency").readiness, "blocked");
    assert.equal(byId.get("charlie-missing-dependency").blockingReason, "missing_dependency");
    assert.equal(byId.get("delta-occupied-port").blockingReason, "port_occupied");
    assert.equal(byId.get("echo-disabled").readiness, "disabled");
    assert.equal(byId.get("foxtrot-unhealthy").readiness, "degraded");
    assert.equal(byId.get("foxtrot-unhealthy").blockingReason, "unhealthy");
    assert.equal(
      diagnostics.body.diagnostics.services.every((service) =>
        service.endpoints.every((endpoint) => !endpoint.url.includes("?") && !endpoint.url.includes("#")),
      ),
      true,
    );
  } finally {
    await apiServer.stop();
    if (occupiedPortServer.listening) {
      await new Promise((resolve) => occupiedPortServer.close(resolve));
    }
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
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
  await writeManifest(servicesRoot, "provider-utility", {
    id: "provider-utility",
    name: "Provider Utility",
    description: "Provider utility fixture that is ready once installed/configured.",
    role: "provider",
  });
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    for (const serviceId of ["alpha-service", "bravo-service", "provider-utility"]) {
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
    const utilityDetail = await getJson(`${apiServer.url}/api/dashboard/services/provider-utility`);

    assert.equal(summary.status, 200);
    assert.equal(summary.body.summary.servicesTotal, 3);
    assert.equal(summary.body.summary.servicesRunning, 1);
    assert.equal(summary.body.summary.servicesAvailable, 1);
    assert.equal(summary.body.summary.servicesStopped, 1);
    assert.equal(summary.body.summary.favorites.length, 1);
    assert.equal(summary.body.summary.favorites[0].id, "alpha-service");
    assert.ok(summary.body.summary.warnings.includes("At least one managed service is currently stopped."));

    assert.equal(services.status, 200);
    assert.equal(Array.isArray(services.body.services), true);
    assert.equal(services.body.services.length, 3);

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

    assert.equal(utilityDetail.status, 200);
    assert.equal(utilityDetail.body.service.status, "available");
    assert.equal(utilityDetail.body.service.role, "provider");
    assert.equal(utilityDetail.body.service.metadata.serviceType, "provider");
    assert.equal(utilityDetail.body.service.runtimeHealth.state, "available");
    assert.equal(utilityDetail.body.service.runtimeHealth.health, "healthy");
    assert.equal(utilityDetail.body.service.installed, true);
    assert.deepEqual(
      utilityDetail.body.service.actions
        .filter((action) => ["start", "stop", "restart"].includes(action.kind))
        .map((action) => action.kind),
      [],
    );
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("service config document API loads and saves runtime-backed service.json with backup history", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-config-document-");
  const serviceRoot = await writeManifest(servicesRoot, "node-sample-service", {
    id: "node-sample-service",
    name: "Node Sample Service",
    description: "Config document fixture.",
    enabled: true,
    executable: process.execPath,
    args: ["runtime/server.mjs"],
    healthcheck: {
      type: "process",
    },
  });
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const initial = await getJson(`${apiServer.url}/api/services/node-sample-service/config`);
    assert.equal(initial.status, 200);
    assert.equal(initial.body.serviceId, "node-sample-service");
    assert.equal(initial.body.fileName, "server.json");
    assert.equal(initial.body.path, path.join(serviceRoot, "service.json"));
    assert.equal(initial.body.backupCount, 0);
    assert.equal(initial.body.safety.rawSecretValuesLoaded, false);
    assert.match(initial.body.content, /Node Sample Service/);

    const nextContent = JSON.stringify(
      {
        id: "node-sample-service",
        name: "Node Sample Service",
        description: "Edited through the config document API.",
        enabled: true,
        executable: process.execPath,
        args: ["runtime/server.mjs"],
        healthcheck: {
          type: "process",
        },
      },
      null,
      2,
    );
    const save = await putJson(`${apiServer.url}/api/services/node-sample-service/config`, {
      content: nextContent,
      actor: "service-admin-web",
      reason: "prove config editor save path",
    });

    assert.equal(save.status, 200);
    assert.equal(save.body.serviceId, "node-sample-service");
    assert.equal(save.body.validationStatus, "valid");
    assert.equal(save.body.backup.actor, "service-admin-web");
    assert.equal(save.body.backup.reason, "prove config editor save path");
    assert.equal(save.body.backup.path, "service.json");
    assert.match(save.body.backup.content, /Config document fixture/);

    const backupDir = path.join(serviceRoot, ".state", "backups", "config");
    const backupFiles = await readdir(backupDir);
    assert.ok(backupFiles.some((fileName) => fileName.endsWith(".server.json")));
    assert.ok(backupFiles.some((fileName) => fileName.endsWith(".metadata.json")));

    const savedManifest = await readFile(path.join(serviceRoot, "service.json"), "utf8");
    assert.match(savedManifest, /Edited through the config document API/);

    const reloaded = await getJson(`${apiServer.url}/api/services/node-sample-service/config`);
    assert.equal(reloaded.status, 200);
    assert.equal(reloaded.body.backupCount, 1);
    assert.equal(reloaded.body.revisions.length, 1);
    assert.equal(reloaded.body.revisions[0].id, save.body.backup.id);
    assert.match(reloaded.body.content, /Edited through the config document API/);
  } finally {
    await apiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("service config history travels with a copied service root", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-config-copy-source-");
  const serviceRoot = await writeManifest(servicesRoot, "node-sample-service", {
    id: "node-sample-service",
    name: "Node Sample Service",
    description: "Portable config history fixture.",
    enabled: true,
  });
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const nextContent = JSON.stringify(
      {
        id: "node-sample-service",
        name: "Node Sample Service",
        description: "Copied bundle config.",
        enabled: true,
      },
      null,
      2,
    );
    const save = await putJson(`${apiServer.url}/api/services/node-sample-service/config`, {
      content: nextContent,
      actor: "service-admin-web",
      reason: "prove copied service root history",
    });
    assert.equal(save.status, 200);
  } finally {
    await apiServer.stop();
  }

  const restartedApiServer = await startApiServer({ port: 0, servicesRoot });
  try {
    const afterRestart = await getJson(`${restartedApiServer.url}/api/services/node-sample-service/config`);
    assert.equal(afterRestart.status, 200);
    assert.equal(afterRestart.body.backupCount, 1);
    assert.match(afterRestart.body.revisions[0].content, /Portable config history fixture/);
  } finally {
    await restartedApiServer.stop();
  }

  const movedTempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-config-copy-target-"));
  const movedServicesRoot = path.join(movedTempRoot, "services");
  const movedServiceRoot = path.join(movedServicesRoot, "node-sample-service");
  await mkdir(movedServicesRoot, { recursive: true });
  await cp(serviceRoot, movedServiceRoot, { recursive: true });
  const copiedApiServer = await startApiServer({ port: 0, servicesRoot: movedServicesRoot });

  try {
    const copied = await getJson(`${copiedApiServer.url}/api/services/node-sample-service/config`);
    assert.equal(copied.status, 200);
    assert.equal(copied.body.backupCount, 1);
    assert.equal(copied.body.revisions.length, 1);
    assert.match(copied.body.revisions[0].content, /Portable config history fixture/);
  } finally {
    await copiedApiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
    await rm(movedTempRoot, { recursive: true, force: true });
  }
});

test("service config document API reads legacy workspace backup history during fallback", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-config-legacy-");
  const workspaceRoot = path.join(tempRoot, "workspace");
  const serviceRoot = await writeManifest(servicesRoot, "node-sample-service", {
    id: "node-sample-service",
    name: "Node Sample Service",
    description: "Legacy workspace history fixture.",
    enabled: true,
  });
  const legacyBackupDir = path.join(workspaceRoot, "service-config-backups", "node-sample-service");
  await mkdir(legacyBackupDir, { recursive: true });
  await writeFile(
    path.join(legacyBackupDir, "legacy-revision.json"),
    JSON.stringify(
      {
        id: "legacy-revision",
        createdAt: "2026-06-26T09:12:44.123Z",
        actor: "service-admin-web",
        reason: "legacy workspace fallback",
        path: path.join(serviceRoot, "service.json"),
        previousHash: "previous",
        currentHash: "current",
        validationStatus: "valid",
        content: "{\n  \"id\": \"node-sample-service\",\n  \"description\": \"Legacy workspace history fixture.\"\n}\n",
      },
      null,
      2,
    ),
  );
  const apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot });

  try {
    const response = await getJson(`${apiServer.url}/api/services/node-sample-service/config`);
    assert.equal(response.status, 200);
    assert.equal(response.body.backupCount, 1);
    assert.equal(response.body.revisions[0].id, "legacy-revision");
    assert.equal(response.body.revisions[0].reason, "legacy workspace fallback");
    assert.match(response.body.revisions[0].content, /Legacy workspace history fixture/);
  } finally {
    await apiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("service config document API rejects invalid or wrong-service JSON saves", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-config-document-invalid-");
  await writeManifest(servicesRoot, "node-sample-service", {
    id: "node-sample-service",
    name: "Node Sample Service",
    description: "Config document fixture.",
    enabled: true,
  });
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const invalidJson = await putJson(`${apiServer.url}/api/services/node-sample-service/config`, {
      content: "",
      actor: "service-admin-web",
      reason: "invalid save",
    });
    assert.equal(invalidJson.status, 400);
    assert.equal(invalidJson.body.error, "invalid_json");

    const wrongService = await putJson(`${apiServer.url}/api/services/node-sample-service/config`, {
      content: JSON.stringify({ id: "other-service", name: "Other service" }),
      actor: "service-admin-web",
      reason: "wrong service",
    });
    assert.equal(wrongService.status, 400);
    assert.equal(wrongService.body.error, "invalid_json");
    assert.match(wrongService.body.message, /must remain "node-sample-service"/);
  } finally {
    await apiServer.stop();
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

test("GET /api/runtime/capabilities returns versioned runtime capability metadata", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-capabilities-");
  await writeExecutableFixtureService(servicesRoot, "alpha-service", {
    role: "provider",
  });
  await writeExecutableFixtureService(servicesRoot, "@serviceadmin");
  const apiServer = await startApiServer({
    port: 0,
    servicesRoot,
    version: "capability-test-version",
  });

  try {
    const result = await getJson(apiServer.url + "/api/runtime/capabilities");

    assert.equal(result.status, 200);
    assert.equal(result.body.capabilities.runtime.version, "capability-test-version");
    assert.equal(result.body.capabilities.api.contractVersion, "service-lasso.runtime-capabilities.v1");
    assert.ok(result.body.capabilities.api.endpointGroups.some((group) => group.id === "runtime"));
    assert.ok(result.body.capabilities.api.endpointGroups.some((group) => group.id === "operator-mcp" && group.mutating === false));
    assert.equal(result.body.capabilities.features.lifecycleActions, true);
    assert.equal(result.body.capabilities.features.dashboardAdapter, true);
    assert.equal(result.body.capabilities.features.operatorMcp, true);
    assert.equal(result.body.capabilities.features.providerConnections, false);
    assert.equal(result.body.capabilities.features.workflowFacade, false);
    assert.equal(result.body.capabilities.features.autostart, false);
    assert.equal(result.body.capabilities.features.monitor, false);
    assert.equal(result.body.capabilities.features.updateScheduler, false);
    assert.deepEqual(result.body.capabilities.baseline.defaultServiceIds, [
      "@archive",
      "@java",
      "@localcert",
      "@nginx",
      "@traefik",
      "@node",
      "@python",
      "@secretsbroker",
      "echo-service",
      "@serviceadmin",
    ]);
    assert.deepEqual(result.body.capabilities.baseline.serviceRoles, [
      {
        id: "@serviceadmin",
        role: "service",
        enabled: true,
        defaultBaseline: true,
      },
      {
        id: "alpha-service",
        role: "provider",
        enabled: true,
        defaultBaseline: false,
      },
    ]);
    assert.equal(result.body.capabilities.compatibility.serviceAdmin.runtimeApiBaseUrlRequired, true);
    assert.equal(result.body.capabilities.compatibility.serviceAdmin.supportsSafeSecretMetadataOnly, true);
  } finally {
    await apiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("GET /api/runtime/capabilities reflects configured runtime option flags", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-capability-flags-");
  const apiServer = await startApiServer({
    port: 0,
    servicesRoot,
    version: "capability-flags-test",
    monitor: true,
    updateScheduler: true,
  });

  try {
    const result = await getJson(apiServer.url + "/api/runtime/capabilities");

    assert.equal(result.status, 200);
    assert.equal(result.body.capabilities.features.monitor, true);
    assert.equal(result.body.capabilities.features.updateScheduler, true);
    assert.equal(result.body.capabilities.features.autostart, false);
  } finally {
    await apiServer.stop();
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

test("POST /api/runtime/actions/startAll prepares and starts eligible services in deterministic order", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-runtime-actions-");
  await writeExecutableFixtureService(servicesRoot, "alpha-service");
  await writeExecutableFixtureService(servicesRoot, "bravo-service", {
    depend_on: ["alpha-service"],
  });
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const startAll = await postJson(`${apiServer.url}/api/runtime/actions/startAll`);
    assert.equal(startAll.status, 200);
    assert.equal(startAll.body.action, "startAll");
    assert.equal(startAll.body.ok, true);
    assert.deepEqual(
      startAll.body.results.map((result) => result.serviceId),
      ["alpha-service", "bravo-service"],
    );
    assert.deepEqual(startAll.body.skipped, []);
    assert.equal(startAll.body.results[0].state.installed, true);
    assert.equal(startAll.body.results[0].state.configured, true);
    assert.equal(startAll.body.results[0].state.running, true);
    assert.equal(startAll.body.results[1].state.installed, true);
    assert.equal(startAll.body.results[1].state.configured, true);
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

test("POST /api/services/:id/start prepares missing dependencies before starting it", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-single-start-prepare-");
  await writeExecutableFixtureService(servicesRoot, "alpha-service");
  await writeExecutableFixtureService(servicesRoot, "bravo-service", {
    depend_on: ["alpha-service"],
  });
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const start = await postJson(`${apiServer.url}/api/services/bravo-service/start`);
    assert.equal(start.status, 200);
    assert.equal(start.body.action, "start");
    assert.equal(start.body.ok, true);
    assert.equal(start.body.state.installed, true);
    assert.equal(start.body.state.configured, true);
    assert.equal(start.body.state.running, true);

    const detail = await getJson(`${apiServer.url}/api/services/alpha-service`);
    assert.equal(detail.body.service.lifecycle.installed, true);
    assert.equal(detail.body.service.lifecycle.configured, true);
    assert.equal(detail.body.service.lifecycle.running, true);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("POST /api/runtime/actions/startAll preserves only true skip semantics", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-runtime-skips-");
  await writeManifest(servicesRoot, "@python", {
    id: "@python",
    name: "Python Runtime",
    description: "Disabled-by-default provider fixture that canonical startAll should still prepare.",
    role: "provider",
    enabled: false,
    install: { files: [{ path: "./runtime/install.txt", content: "installed ${SERVICE_ID}\n" }] },
    config: { files: [{ path: "./runtime/config.txt", content: "configured ${SERVICE_ID}\n" }] },
  });
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
    assert.deepEqual(
      startAll.body.results.map((actionResult) => actionResult.serviceId),
      ["alpha-installed-only", "bravo-missing-install"],
    );
    assert.deepEqual(startAll.body.skipped, [
      { serviceId: "@python", reason: "provider_role" },
      { serviceId: "charlie-running", reason: "already_running" },
    ]);
    assert.equal(startAll.body.results[0].state.configured, true);
    assert.equal(startAll.body.results[0].state.running, true);
    assert.equal(startAll.body.results[1].state.installed, true);
    assert.equal(startAll.body.results[1].state.configured, true);
    assert.equal(startAll.body.results[1].state.running, true);

    const pythonDetail = await getJson(`${apiServer.url}/api/services/%40python`);
    assert.equal(pythonDetail.body.service.enabled, false);
    assert.equal(pythonDetail.body.service.lifecycle.installed, true);
    assert.equal(pythonDetail.body.service.lifecycle.configured, true);
    assert.equal(pythonDetail.body.service.lifecycle.running, false);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("GET /api/runtime/actions/startAll/plan returns dependency ordered dry-run without starting services", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-runtime-start-plan-");
  await writeExecutableFixtureService(servicesRoot, "alpha-service");
  await writeExecutableFixtureService(servicesRoot, "bravo-service", {
    depend_on: ["alpha-service"],
  });
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    let result = await postJson(apiServer.url + "/api/services/alpha-service/install");
    assert.equal(result.status, 200);
    result = await postJson(apiServer.url + "/api/services/alpha-service/config");
    assert.equal(result.status, 200);

    const plan = await getJson(apiServer.url + "/api/runtime/actions/startAll/plan");
    assert.equal(plan.status, 200);
    assert.equal(plan.body.action, "startAll");
    assert.equal(plan.body.dryRun, true);
    assert.equal(plan.body.ok, true);
    assert.deepEqual(plan.body.order, ["alpha-service", "bravo-service"]);
    assert.deepEqual(
      plan.body.steps.map((step) => [step.serviceId, step.status, step.reason]),
      [
        ["alpha-service", "would_run", null],
        ["bravo-service", "would_run", null],
      ],
    );
    assert.deepEqual(plan.body.steps[1].prerequisites, ["install", "config"]);
    assert.deepEqual(plan.body.mutations, []);

    const alphaDetail = await getJson(apiServer.url + "/api/services/alpha-service");
    const bravoDetail = await getJson(apiServer.url + "/api/services/bravo-service");
    assert.equal(alphaDetail.body.service.lifecycle.running, false);
    assert.equal(bravoDetail.body.service.lifecycle.running, false);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("GET /api/services/:id/update/install/plan reports blockers without writing update state", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-update-install-plan-");
  const { serviceRoot } = await writeExecutableFixtureService(servicesRoot, "update-plan-service", {
    updates: {
      mode: "download",
      runningService: "require-stopped",
    },
  });
  const stateRoot = path.join(serviceRoot, ".state");
  await mkdir(stateRoot, { recursive: true });
  const updatesPath = path.join(stateRoot, "updates.json");
  const before = {
    serviceId: "update-plan-service",
    state: "downloadedCandidate",
    lastCheck: null,
    available: null,
    downloadedCandidate: {
      tag: "2026.5.1",
      assetName: "update-plan-service.zip",
      archivePath: "updates/update-plan-service.zip",
      downloadedAt: "2026-05-20T00:00:00.000Z",
    },
    installDeferred: null,
    failed: null,
    hookResults: [],
  };
  await writeFile(updatesPath, JSON.stringify(before, null, 2));
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const plan = await getJson(apiServer.url + "/api/services/update-plan-service/update/install/plan");
    assert.equal(plan.status, 200);
    assert.equal(plan.body.action, "updateInstall");
    assert.equal(plan.body.dryRun, true);
    assert.equal(plan.body.ok, false);
    assert.equal(plan.body.steps[0].status, "blocked");
    assert.match(plan.body.steps[0].reason, /updates_mode_not_install/);
    assert.deepEqual(plan.body.mutations, []);

    const after = JSON.parse(await readFile(updatesPath, "utf8"));
    assert.deepEqual(after, before);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("GET /api/runtime/actions/importService/plan previews app-owned import without copying manifest", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-import-plan-");
  const sourceRoot = path.join(tempRoot, "source-service");
  const sourceManifestPath = path.join(sourceRoot, "service.json");
  const targetManifestPath = path.join(servicesRoot, "imported-service", "service.json");
  await mkdir(sourceRoot, { recursive: true });
  await writeFile(sourceManifestPath, JSON.stringify({
    id: "imported-service",
    name: "Imported Service",
    description: "Fixture service import plan.",
    executable: process.execPath,
    args: ["runtime/imported-service.mjs"],
    healthcheck: { type: "process" },
  }, null, 2));
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const plan = await getJson(
      apiServer.url + "/api/runtime/actions/importService/plan?manifestPath=" + encodeURIComponent(sourceManifestPath),
    );

    assert.equal(plan.status, 200);
    assert.equal(plan.body.action, "importService");
    assert.equal(plan.body.dryRun, true);
    assert.equal(plan.body.ok, true);
    assert.equal(plan.body.steps[0].serviceId, "imported-service");
    assert.equal(plan.body.steps[0].status, "would_run");
    assert.equal(plan.body.steps[0].metadata.targetManifestPath, targetManifestPath);
    assert.deepEqual(plan.body.mutations, []);
    await assert.rejects(readFile(targetManifestPath, "utf8"), /ENOENT/);
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
