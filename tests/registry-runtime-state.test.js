import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { DependencyGraph, createServiceRegistry } from "../dist/runtime/manager/DependencyGraph.js";
import { startApiServer } from "../dist/server/index.js";
import { clearPersistedFixtureState } from "./test-helpers.js";

const servicesRoot = path.resolve("services");

test("ServiceRegistry and DependencyGraph model dependencies and dependents", async () => {
  const discovered = await discoverServices(servicesRoot);
  const registry = createServiceRegistry(discovered);
  const graph = new DependencyGraph(registry);

  assert.equal(registry.count(), 4);
  assert.equal(registry.countEnabled(), 4);
  assert.ok(registry.getById("echo-service"));
  assert.ok(registry.getById("node-sample-service"));

  const echoSummary = graph.getServiceDependencies("echo-service");
  assert.deepEqual(echoSummary.dependencies, []);
  assert.deepEqual(echoSummary.dependents, []);

  const nodeSummary = graph.getServiceDependencies("@node");
  assert.deepEqual(nodeSummary.dependencies, []);
  assert.deepEqual(nodeSummary.dependents, ["node-sample-service"]);

  const nodeSampleSummary = graph.getServiceDependencies("node-sample-service");
  assert.deepEqual(nodeSampleSummary.dependencies, ["@node"]);
  assert.deepEqual(nodeSampleSummary.dependents, []);
});

test("GET /api/services/:id returns discovered service detail with dependency context", async () => {
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
    await clearPersistedFixtureState(servicesRoot);
  }
});

test("GET /api/runtime returns runtime summary state", async () => {
  await clearPersistedFixtureState(servicesRoot);
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const response = await fetch(`${apiServer.url}/api/runtime`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.runtime.totalServices, 4);
    assert.equal(body.runtime.enabledServices, 4);
    assert.equal(body.runtime.dependencyEdges, 1);
    assert.equal(body.runtime.servicesRoot, servicesRoot);
  } finally {
    await apiServer.stop();
    await clearPersistedFixtureState(servicesRoot);
  }
});

test("GET /api/dependencies returns graph nodes and edges", async () => {
  await clearPersistedFixtureState(servicesRoot);
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const response = await fetch(`${apiServer.url}/api/dependencies`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.dependencies.nodes.length, 4);
    assert.deepEqual(body.dependencies.edges, [{ from: "@node", to: "node-sample-service" }]);
  } finally {
    await apiServer.stop();
    await clearPersistedFixtureState(servicesRoot);
  }
});
