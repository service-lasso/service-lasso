import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile, rm } from "node:fs/promises";
import { bootstrapBaselineServices } from "../dist/runtime/cli/bootstrap.js";
import { stopAllManagedProcesses } from "../dist/runtime/execution/supervisor.js";
import { getLifecycleState, resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";

async function readJsonWhenReady(filePath, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      return JSON.parse(await readFile(filePath, "utf8"));
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  throw lastError;
}

test("bootstrapBaselineServices installs, configures, and starts baseline services in dependency order", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-baseline-start-");
  const workspaceRoot = path.join(tempRoot, "workspace");

  try {
    await writeExecutableFixtureService(servicesRoot, "@archive", {
      role: "provider",
      enabled: false,
      healthcheck: null,
    });
    await writeExecutableFixtureService(servicesRoot, "@java");
    await writeExecutableFixtureService(servicesRoot, "@localcert");
    await writeExecutableFixtureService(servicesRoot, "@nginx");
    await writeExecutableFixtureService(servicesRoot, "@traefik", {
      depend_on: ["@localcert", "@nginx"],
      install: { files: [{ path: "./runtime/install.txt", content: "installed ${SERVICE_ID}\n" }] },
      config: { files: [{ path: "./runtime/config.txt", content: "configured ${SERVICE_ID}\n" }] },
    });
    await writeExecutableFixtureService(servicesRoot, "@node");
    await writeExecutableFixtureService(servicesRoot, "@python", {
      role: "provider",
      enabled: false,
      healthcheck: null,
    });
    await writeExecutableFixtureService(servicesRoot, "@secretsbroker");
    await writeExecutableFixtureService(servicesRoot, "echo-service", {
      depend_on: ["@node", "@traefik"],
    });
    await writeExecutableFixtureService(servicesRoot, "@serviceadmin", {
      depend_on: ["@node"],
    });

    const result = await bootstrapBaselineServices({
      servicesRoot,
      workspaceRoot,
      version: "test-version",
    });

    assert.deepEqual(result.requestedServiceIds, ["@archive", "@java", "@localcert", "@nginx", "@traefik", "@node", "@secretsbroker", "echo-service", "@serviceadmin"]);
    assert.deepEqual(result.serviceOrder, ["@archive", "@java", "@localcert", "@nginx", "@node", "@secretsbroker", "@serviceadmin", "@traefik", "echo-service"]);
    assert.equal(result.services.length, 9);

    for (const service of result.services) {
      assert.equal(service.status, "completed");
      const expectedActions = service.serviceId === "@archive"
        ? ["install:completed", "config:completed", "start:skipped"]
        : ["install:completed", "config:completed", "start:completed"];
      assert.deepEqual(
        service.actions.map((action) => `${action.action}:${action.status}`),
        expectedActions,
      );
      const state = getLifecycleState(service.serviceId);
      assert.equal(state.installed, true, `${service.serviceId} installed`);
      assert.equal(state.configured, true, `${service.serviceId} configured`);
      assert.equal(state.running, service.serviceId !== "@archive", `${service.serviceId} running`);
    }

    const rerun = await bootstrapBaselineServices({
      servicesRoot,
      workspaceRoot,
      version: "test-version",
    });

    for (const service of rerun.services) {
      assert.deepEqual(
        service.actions.map((action) => `${action.action}:${action.status}`),
        ["install:skipped", "config:skipped", "start:skipped"],
      );
    }
  } finally {
    await stopAllManagedProcesses();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("bootstrapBaselineServices passes the owning runtime API URL to Service Admin", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-serviceadmin-runtime-api-");
  const workspaceRoot = path.join(tempRoot, "workspace");
  const previousRuntimeApiBaseUrl = process.env.SERVICE_LASSO_RUNTIME_API_BASE_URL;
  process.env.SERVICE_LASSO_RUNTIME_API_BASE_URL = "http://127.0.0.1:19876";

  try {
    await writeExecutableFixtureService(servicesRoot, "@node", {
      role: "provider",
      healthcheck: null,
    });
    await writeExecutableFixtureService(servicesRoot, "@serviceadmin", {
      depend_on: ["@node"],
      captureEnvKeys: ["SERVICE_LASSO_RUNTIME_API_BASE_URL"],
    });

    const result = await bootstrapBaselineServices({
      servicesRoot,
      workspaceRoot,
      version: "test-version",
      serviceIds: ["@node", "@serviceadmin"],
    });

    assert.deepEqual(result.serviceOrder, ["@node", "@serviceadmin"]);
    assert.equal(result.services.find((service) => service.serviceId === "@serviceadmin")?.state.running, true);

    const envSnapshot = await readJsonWhenReady(path.join(servicesRoot, "@serviceadmin", "runtime", "env.json"));
    assert.equal(envSnapshot.SERVICE_LASSO_RUNTIME_API_BASE_URL, "http://127.0.0.1:19876");
  } finally {
    if (previousRuntimeApiBaseUrl === undefined) {
      delete process.env.SERVICE_LASSO_RUNTIME_API_BASE_URL;
    } else {
      process.env.SERVICE_LASSO_RUNTIME_API_BASE_URL = previousRuntimeApiBaseUrl;
    }
    await stopAllManagedProcesses();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("bootstrapBaselineServices skips managed start for provider-role baseline services", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-baseline-provider-");
  const workspaceRoot = path.join(tempRoot, "workspace");

  try {
    await writeExecutableFixtureService(servicesRoot, "@archive", {
      role: "provider",
      enabled: false,
      healthcheck: null,
    });
    await writeExecutableFixtureService(servicesRoot, "@java", {
      role: "provider",
      healthcheck: null,
    });
    await writeExecutableFixtureService(servicesRoot, "@localcert", {
      role: "provider",
      healthcheck: null,
    });
    await writeExecutableFixtureService(servicesRoot, "@nginx", {
      role: "provider",
      healthcheck: null,
    });
    await writeExecutableFixtureService(servicesRoot, "@traefik", {
      depend_on: ["@localcert", "@nginx"],
      install: { files: [{ path: "./runtime/install.txt", content: "installed ${SERVICE_ID}\n" }] },
      config: { files: [{ path: "./runtime/config.txt", content: "configured ${SERVICE_ID}\n" }] },
    });
    await writeExecutableFixtureService(servicesRoot, "@node", {
      role: "provider",
      healthcheck: null,
    });
    await writeExecutableFixtureService(servicesRoot, "@python", {
      role: "provider",
      enabled: false,
      healthcheck: null,
    });
    await writeExecutableFixtureService(servicesRoot, "@secretsbroker");
    await writeExecutableFixtureService(servicesRoot, "echo-service", {
      depend_on: ["@node", "@traefik"],
    });
    await writeExecutableFixtureService(servicesRoot, "@serviceadmin", {
      depend_on: ["@node"],
    });

    const result = await bootstrapBaselineServices({
      servicesRoot,
      workspaceRoot,
      version: "test-version",
      serviceIds: ["@archive", "@java", "@localcert", "@nginx", "@traefik", "@node", "@python", "@secretsbroker", "echo-service", "@serviceadmin"],
    });
    const archive = result.services.find((service) => service.serviceId === "@archive");
    const node = result.services.find((service) => service.serviceId === "@node");
    const python = result.services.find((service) => service.serviceId === "@python");
    const java = result.services.find((service) => service.serviceId === "@java");
    const localcert = result.services.find((service) => service.serviceId === "@localcert");
    const nginx = result.services.find((service) => service.serviceId === "@nginx");

    assert.ok(archive);
    assert.ok(java);
    assert.ok(node);
    assert.ok(python);
    assert.ok(localcert);
    assert.ok(nginx);
    assert.deepEqual(
      archive.actions.map((action) => `${action.action}:${action.status}`),
      ["install:completed", "config:completed", "start:skipped"],
    );
    assert.deepEqual(
      java.actions.map((action) => `${action.action}:${action.status}`),
      ["install:completed", "config:completed", "start:skipped"],
    );
    assert.deepEqual(
      node.actions.map((action) => `${action.action}:${action.status}`),
      ["install:completed", "config:completed", "start:skipped"],
    );
    assert.deepEqual(
      localcert.actions.map((action) => `${action.action}:${action.status}`),
      ["install:completed", "config:completed", "start:skipped"],
    );
    assert.deepEqual(
      nginx.actions.map((action) => `${action.action}:${action.status}`),
      ["install:completed", "config:completed", "start:skipped"],
    );
    assert.deepEqual(
      python.actions.map((action) => `${action.action}:${action.status}`),
      ["install:completed", "config:completed", "start:skipped"],
    );
    assert.match(archive.actions.at(-1)?.message ?? "", /Provider role/);
    assert.match(java.actions.at(-1)?.message ?? "", /Provider role/);
    assert.match(node.actions.at(-1)?.message ?? "", /Provider role/);
    assert.match(python.actions.at(-1)?.message ?? "", /Provider role/);
    assert.equal(archive.state.installed, true);
    assert.equal(archive.state.configured, true);
    assert.equal(archive.state.running, false);
    assert.equal(java.state.installed, true);
    assert.equal(java.state.configured, true);
    assert.equal(java.state.running, false);
    assert.equal(node.state.installed, true);
    assert.equal(node.state.configured, true);
    assert.equal(node.state.running, false);
    assert.equal(python.state.installed, true);
    assert.equal(python.state.configured, true);
    assert.equal(python.state.running, false);
    assert.equal(localcert.state.running, false);
    assert.equal(nginx.state.running, false);
    assert.equal(result.services.find((service) => service.serviceId === "@secretsbroker")?.state.running, true);
    assert.equal(result.services.find((service) => service.serviceId === "@traefik")?.state.running, true);
    assert.equal(result.services.find((service) => service.serviceId === "@serviceadmin")?.state.running, true);
  } finally {
    await stopAllManagedProcesses();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
