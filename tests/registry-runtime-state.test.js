import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { DependencyGraph, createServiceRegistry } from "../dist/runtime/manager/DependencyGraph.js";
import { startApiServer } from "../dist/server/index.js";

const servicesRoot = path.resolve("services");

test("ServiceRegistry and DependencyGraph model dependencies and dependents", async () => {
  const discovered = await discoverServices(servicesRoot);
  const registry = createServiceRegistry(discovered);
  const graph = new DependencyGraph(registry);

  assert.equal(registry.count(), 3);
  assert.equal(registry.countEnabled(), 3);
  assert.ok(registry.getById("echo-service"));

  const echoSummary = graph.getServiceDependencies("echo-service");
  assert.deepEqual(echoSummary.dependencies, ["@node"]);
  assert.deepEqual(echoSummary.dependents, []);

  const nodeSummary = graph.getServiceDependencies("@node");
  assert.deepEqual(nodeSummary.dependencies, []);
  assert.deepEqual(nodeSummary.dependents, ["echo-service"]);
});

test("GET /api/services/:id returns discovered service detail with dependency context", async () => {
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const response = await fetch(`${apiServer.url}/api/services/echo-service`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.service.id, "echo-service");
    assert.deepEqual(body.service.dependencies, ["@node"]);
    assert.deepEqual(body.service.dependents, []);
    assert.equal(body.service.source, "manifest");
  } finally {
    await apiServer.stop();
  }
});

test("GET /api/runtime returns runtime summary state", async () => {
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const response = await fetch(`${apiServer.url}/api/runtime`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.runtime.totalServices, 3);
    assert.equal(body.runtime.enabledServices, 3);
    assert.equal(body.runtime.dependencyEdges, 1);
    assert.equal(body.runtime.servicesRoot, servicesRoot);
  } finally {
    await apiServer.stop();
  }
});

test("GET /api/dependencies returns graph nodes and edges", async () => {
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const response = await fetch(`${apiServer.url}/api/dependencies`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.dependencies.nodes.length, 3);
    assert.deepEqual(body.dependencies.edges, [{ from: "@node", to: "echo-service" }]);
  } finally {
    await apiServer.stop();
  }
});
