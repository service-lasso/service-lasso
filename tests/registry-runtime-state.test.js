import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile, rm } from "node:fs/promises";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { DependencyGraph, createServiceRegistry } from "../dist/runtime/manager/DependencyGraph.js";
import { startApiServer } from "../dist/server/index.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { clearPersistedFixtureState, makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";

const servicesRoot = path.resolve("services");

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

test("ServiceRegistry and DependencyGraph model dependencies and dependents", async () => {
  resetLifecycleState();
  const discovered = await discoverServices(servicesRoot);
  const registry = createServiceRegistry(discovered);
  const graph = new DependencyGraph(registry);

  assert.equal(registry.count(), 7);
  assert.equal(registry.countEnabled(), 5);
  assert.ok(registry.getById("echo-service"));
  assert.ok(registry.getById("node-sample-service"));
  assert.ok(registry.getById("service-admin"));
  assert.ok(registry.getById("@java"));
  assert.equal(registry.getById("@traefik")?.manifest.enabled, true);

  const echoSummary = graph.getServiceDependencies("echo-service");
  assert.deepEqual(echoSummary.dependencies, []);
  assert.deepEqual(echoSummary.dependents, []);

  const nodeSummary = graph.getServiceDependencies("@node");
  assert.deepEqual(nodeSummary.dependencies, []);
  assert.deepEqual(nodeSummary.dependents, ["node-sample-service", "service-admin"]);

  const nodeSampleSummary = graph.getServiceDependencies("node-sample-service");
  assert.deepEqual(nodeSampleSummary.dependencies, ["@node"]);
  assert.deepEqual(nodeSampleSummary.dependents, []);
  assert.deepEqual(graph.getStartupOrder("node-sample-service"), ["@node"]);

  const serviceAdminSummary = graph.getServiceDependencies("service-admin");
  assert.deepEqual(serviceAdminSummary.dependencies, ["@node"]);
  assert.deepEqual(serviceAdminSummary.dependents, []);
  assert.deepEqual(graph.getStartupOrder("service-admin"), ["@node"]);
});

test("GET /api/services/:id returns discovered service detail with dependency context", async () => {
  resetLifecycleState();
  await clearPersistedFixtureState(servicesRoot);
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const response = await fetch(`${apiServer.url}/api/services/echo-service`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.service.id, "echo-service");
    assert.deepEqual(body.service.dependencies, []);
    assert.deepEqual(body.service.dependents, []);
    assert.equal(body.service.source, "manifest");
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await clearPersistedFixtureState(servicesRoot);
  }
});

test("GET /api/runtime returns runtime summary state", async () => {
  resetLifecycleState();
  await clearPersistedFixtureState(servicesRoot);
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const response = await fetch(`${apiServer.url}/api/runtime`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.runtime.totalServices, 7);
    assert.equal(body.runtime.enabledServices, 5);
    assert.equal(body.runtime.dependencyEdges, 2);
    assert.equal(body.runtime.servicesRoot, servicesRoot);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await clearPersistedFixtureState(servicesRoot);
  }
});

test("GET /api/dependencies returns graph nodes and edges", async () => {
  resetLifecycleState();
  await clearPersistedFixtureState(servicesRoot);
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const response = await fetch(`${apiServer.url}/api/dependencies`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.dependencies.nodes.length, 7);
    assert.deepEqual(body.dependencies.edges, [
      { from: "@node", to: "node-sample-service" },
      { from: "@node", to: "service-admin" },
    ]);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await clearPersistedFixtureState(servicesRoot);
  }
});

test("start sequences dependencies in order and waits for dependency readiness", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-deps-");
  const provider = await writeExecutableFixtureService(servicesRoot, "provider-service", {
    readyFileAfterMs: 120,
    readyFileRelativePath: "./runtime/provider-ready.txt",
    captureEnvKeys: ["SERVICE_ID"],
    captureEnvFileRelativePath: "./runtime/provider-env.json",
    healthcheck: {
      type: "file",
      file: "./runtime/provider-ready.txt",
      retries: 8,
      interval: 50,
      start_period: 25,
    },
  });
  const consumer = await writeExecutableFixtureService(servicesRoot, "consumer-service", {
    captureEnvKeys: ["SERVICE_ID"],
    captureEnvFileRelativePath: "./runtime/consumer-env.json",
    depend_on: ["provider-service"],
  });

  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    await fetch(`${apiServer.url}/api/services/provider-service/install`, { method: "POST" });
    await fetch(`${apiServer.url}/api/services/provider-service/config`, { method: "POST" });
    await fetch(`${apiServer.url}/api/services/consumer-service/install`, { method: "POST" });
    await fetch(`${apiServer.url}/api/services/consumer-service/config`, { method: "POST" });

    const startedAt = Date.now();
    const response = await fetch(`${apiServer.url}/api/services/consumer-service/start`, { method: "POST" });
    const body = await response.json();
    const elapsedMs = Date.now() - startedAt;

    const providerEnvSnapshot = JSON.parse(
      await waitFor(async () => {
        try {
          return await readFile(path.join(provider.serviceRoot, "runtime", "provider-env.json"), "utf8");
        } catch (error) {
          if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
            return null;
          }
          throw error;
        }
      }),
    );
    const consumerEnvSnapshot = JSON.parse(
      await waitFor(async () => {
        try {
          return await readFile(path.join(consumer.serviceRoot, "runtime", "consumer-env.json"), "utf8");
        } catch (error) {
          if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
            return null;
          }
          throw error;
        }
      }),
    );

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.state.running, true);
    assert.ok(elapsedMs >= 75);
    assert.equal(providerEnvSnapshot.SERVICE_ID, "provider-service");
    assert.equal(consumerEnvSnapshot.SERVICE_ID, "consumer-service");

    const providerDetail = await fetch(`${apiServer.url}/api/services/provider-service`);
    const providerBody = await providerDetail.json();
    assert.equal(providerBody.service.lifecycle.running, true);
    assert.equal(providerBody.service.lifecycle.lastAction, "start");
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("start does not restart dependencies that are already running", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-deps-");
  const provider = await writeExecutableFixtureService(servicesRoot, "provider-service", {
    captureEnvKeys: ["SERVICE_ID"],
    captureEnvFileRelativePath: "./runtime/provider-env.json",
  });
  await writeExecutableFixtureService(servicesRoot, "consumer-service", {
    depend_on: ["provider-service"],
  });

  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    await fetch(`${apiServer.url}/api/services/provider-service/install`, { method: "POST" });
    await fetch(`${apiServer.url}/api/services/provider-service/config`, { method: "POST" });
    await fetch(`${apiServer.url}/api/services/provider-service/start`, { method: "POST" });
    const firstProviderDetail = await fetch(`${apiServer.url}/api/services/provider-service`);
    const firstProviderBody = await firstProviderDetail.json();

    await fetch(`${apiServer.url}/api/services/consumer-service/install`, { method: "POST" });
    await fetch(`${apiServer.url}/api/services/consumer-service/config`, { method: "POST" });
    const consumerStart = await fetch(`${apiServer.url}/api/services/consumer-service/start`, { method: "POST" });
    const consumerBody = await consumerStart.json();

    const secondProviderDetail = await fetch(`${apiServer.url}/api/services/provider-service`);
    const secondProviderBody = await secondProviderDetail.json();

    assert.equal(consumerStart.status, 200);
    assert.equal(consumerBody.ok, true);
    assert.equal(firstProviderBody.service.lifecycle.runtime.pid, secondProviderBody.service.lifecycle.runtime.pid);
    assert.deepEqual(secondProviderBody.service.lifecycle.actionHistory, ["install", "config", "start"]);
    assert.equal(
      JSON.parse(
        await waitFor(async () => {
          try {
            return await readFile(path.join(provider.serviceRoot, "runtime", "provider-env.json"), "utf8");
          } catch (error) {
            if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
              return null;
            }
            throw error;
          }
        }),
      ).SERVICE_ID,
      "provider-service",
    );
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
