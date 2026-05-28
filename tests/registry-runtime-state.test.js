import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { DependencyGraph, createServiceRegistry } from "../dist/runtime/manager/DependencyGraph.js";
import { startApiServer } from "../dist/server/index.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { getRuntimeInstanceStatePath } from "../dist/runtime/instance/registry.js";
import { clearPersistedFixtureState, makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";

const servicesRoot = path.resolve("services");
const execFileAsync = promisify(execFile);

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

  assert.equal(registry.count(), 11);
  assert.equal(registry.countEnabled(), 9);
  assert.ok(registry.getById("@archive"));
  assert.ok(registry.getById("@python"));
  assert.ok(registry.getById("echo-service"));
  assert.ok(registry.getById("node-sample-service"));
  assert.ok(registry.getById("@serviceadmin"));
  assert.ok(registry.getById("@secretsbroker"));
  assert.ok(registry.getById("@java"));
  assert.ok(registry.getById("@python"));
  assert.equal(registry.getById("@archive")?.manifest.enabled, false);
  assert.equal(registry.getById("@python")?.manifest.enabled, false);
  assert.equal(registry.getById("@archive")?.manifest.role, "provider");
  assert.equal(registry.getById("@archive")?.manifest.artifact?.source.repo, "service-lasso/lasso-archive");
  assert.equal(registry.getById("@archive")?.manifest.artifact?.source.tag, "2026.5.2-a223a48");
  assert.equal(registry.getById("@traefik")?.manifest.enabled, true);
  assert.equal(registry.getById("@localcert")?.manifest.role, "provider");
  assert.equal(registry.getById("@localcert")?.manifest.artifact?.source.repo, "service-lasso/lasso-localcert");
  assert.equal(registry.getById("@localcert")?.manifest.artifact?.source.tag, "2026.5.2-24e7d2f");
  assert.equal(registry.getById("@nginx")?.manifest.role, undefined);
  assert.equal(registry.getById("@nginx")?.manifest.artifact?.source.repo, "service-lasso/lasso-nginx");

  const echoSummary = graph.getServiceDependencies("echo-service");
  assert.deepEqual(echoSummary.dependencies, []);
  assert.deepEqual(echoSummary.dependents, []);

  const nodeSummary = graph.getServiceDependencies("@node");
  assert.deepEqual(nodeSummary.dependencies, []);
  assert.deepEqual(nodeSummary.dependents, ["@serviceadmin", "node-sample-service"]);

  const traefikSummary = graph.getServiceDependencies("@traefik");
  assert.deepEqual(traefikSummary.dependencies, ["@localcert", "@nginx"]);
  assert.deepEqual(traefikSummary.dependents, []);
  assert.deepEqual(graph.getStartupOrder("@traefik"), ["@java", "@localcert", "@nginx"]);

  assert.deepEqual(graph.getServiceDependencies("@localcert").dependencies, ["@java"]);
  assert.deepEqual(graph.getServiceDependencies("@localcert").dependents, ["@traefik"]);
  assert.deepEqual(graph.getServiceDependencies("@nginx").dependents, ["@traefik"]);

  const nodeSampleSummary = graph.getServiceDependencies("node-sample-service");
  assert.deepEqual(nodeSampleSummary.dependencies, ["@node"]);
  assert.deepEqual(nodeSampleSummary.dependents, []);
  assert.deepEqual(graph.getStartupOrder("node-sample-service"), ["@node"]);

  const serviceAdminSummary = graph.getServiceDependencies("@serviceadmin");
  assert.deepEqual(serviceAdminSummary.dependencies, ["@node"]);
  assert.deepEqual(serviceAdminSummary.dependents, []);
  assert.deepEqual(graph.getStartupOrder("@serviceadmin"), ["@node"]);
});

test("DependencyGraph reverse lookup classifies direct, transitive, cyclic, and missing targets", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-reverse-deps-");

  try {
    await writeExecutableFixtureService(servicesRoot, "base-service");
    await writeExecutableFixtureService(servicesRoot, "direct-a", { depend_on: ["base-service"] });
    await writeExecutableFixtureService(servicesRoot, "direct-b", { depend_on: ["base-service"] });
    await writeExecutableFixtureService(servicesRoot, "transitive-c", { depend_on: ["direct-a", "cycle-d"] });
    await writeExecutableFixtureService(servicesRoot, "cycle-d", { depend_on: ["transitive-c"] });
    await writeExecutableFixtureService(servicesRoot, "missing-consumer", { depend_on: ["missing-provider"] });

    const registry = createServiceRegistry(await discoverServices(servicesRoot));
    const graph = new DependencyGraph(registry);
    const reverse = graph.getReverseDependencies("base-service");
    const byId = new Map(reverse.dependents.map((dependent) => [dependent.id, dependent]));

    assert.deepEqual(reverse.target, { id: "base-service", name: "base-service", exists: true });
    assert.deepEqual(reverse.summary, { total: 4, direct: 2, transitive: 2, missingTarget: false });
    assert.equal(byId.get("direct-a")?.relation, "direct");
    assert.equal(byId.get("direct-a")?.depth, 1);
    assert.deepEqual(byId.get("direct-a")?.path, ["base-service", "direct-a"]);
    assert.deepEqual(byId.get("direct-a")?.blockedBy, [
      { id: "base-service", name: "base-service", missing: false },
    ]);
    assert.equal(byId.get("transitive-c")?.relation, "transitive");
    assert.equal(byId.get("transitive-c")?.depth, 2);
    assert.deepEqual(byId.get("transitive-c")?.path, ["base-service", "direct-a", "transitive-c"]);
    assert.equal(byId.get("cycle-d")?.relation, "transitive");
    assert.deepEqual(byId.get("cycle-d")?.path, ["base-service", "direct-a", "transitive-c", "cycle-d"]);

    const missingReverse = graph.getReverseDependencies("missing-provider");
    assert.deepEqual(missingReverse.target, { id: "missing-provider", name: null, exists: false });
    assert.deepEqual(missingReverse.summary, { total: 1, direct: 1, transitive: 0, missingTarget: true });
    assert.deepEqual(missingReverse.dependents[0]?.blockedBy, [
      { id: "missing-provider", name: null, missing: true },
    ]);
  } finally {
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
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
    assert.equal(body.runtime.totalServices, 11);
    assert.equal(body.runtime.enabledServices, 9);
    assert.equal(body.runtime.dependencyEdges, 5);
    assert.equal(body.runtime.servicesRoot, servicesRoot);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await clearPersistedFixtureState(servicesRoot);
  }
});

test("runtime instance API and CLI expose distinct local instance records", async () => {
  resetLifecycleState();
  const first = await makeTempServicesRoot("service-lasso-instance-a-");
  const second = await makeTempServicesRoot("service-lasso-instance-b-");
  const registryPath = path.join(first.tempRoot, "host-registry", "instances.json");
  const previousRegistryPath = process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH;
  process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH = registryPath;
  let firstServer = null;
  let secondServer = null;

  try {
    const firstWorkspaceRoot = path.join(first.tempRoot, "workspace");
    const secondWorkspaceRoot = path.join(second.tempRoot, "workspace");
    await writeExecutableFixtureService(first.servicesRoot, "first-service");
    await writeExecutableFixtureService(second.servicesRoot, "second-service");

    firstServer = await startApiServer({ port: 0, servicesRoot: first.servicesRoot, workspaceRoot: firstWorkspaceRoot });
    secondServer = await startApiServer({ port: 0, servicesRoot: second.servicesRoot, workspaceRoot: secondWorkspaceRoot });

    const firstResponse = await fetch(firstServer.url + "/api/runtime/instance");
    const secondResponse = await fetch(secondServer.url + "/api/runtime/instance");
    const firstBody = await firstResponse.json();
    const secondBody = await secondResponse.json();

    assert.equal(firstResponse.status, 200);
    assert.equal(secondResponse.status, 200);
    assert.ok(firstBody.instance.instanceId.startsWith("sl_"));
    assert.ok(secondBody.instance.instanceId.startsWith("sl_"));
    assert.notEqual(firstBody.instance.instanceId, secondBody.instance.instanceId);
    assert.equal(firstBody.instance.status, "active");
    assert.equal(secondBody.instance.status, "active");
    assert.equal(firstBody.instance.pid, process.pid);
    assert.equal(secondBody.instance.pid, process.pid);
    assert.equal(firstBody.instance.apiPort, firstServer.port);
    assert.equal(secondBody.instance.apiPort, secondServer.port);
    assert.equal(firstBody.instance.servicesRoot, first.servicesRoot);
    assert.equal(secondBody.instance.workspaceRoot, secondWorkspaceRoot);
    assert.equal(secondBody.registry.path, registryPath);
    assert.equal(secondBody.registry.activeCount, 2);
    assert.equal(secondBody.registry.instances.length, 2);

    const instanceFile = JSON.parse(await readFile(getRuntimeInstanceStatePath(firstWorkspaceRoot), "utf8"));
    assert.equal(instanceFile.instanceId, firstBody.instance.instanceId);
    assert.equal(instanceFile.apiUrl, firstServer.url);

    const cli = await execFileAsync(
      process.execPath,
      [
        path.resolve("dist", "cli.js"),
        "instance",
        "--services-root",
        first.servicesRoot,
        "--workspace-root",
        firstWorkspaceRoot,
        "--json",
      ],
      {
        env: {
          ...process.env,
          SERVICE_LASSO_INSTANCE_REGISTRY_PATH: registryPath,
        },
      },
    );
    const cliBody = JSON.parse(cli.stdout);
    assert.equal(cliBody.instance.instanceId, firstBody.instance.instanceId);
    assert.equal(cliBody.registry.activeCount, 2);
  } finally {
    if (firstServer) await firstServer.stop();
    if (secondServer) await secondServer.stop();
    if (previousRegistryPath === undefined) {
      delete process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH;
    } else {
      process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH = previousRegistryPath;
    }
    resetLifecycleState();
    await rm(first.tempRoot, { recursive: true, force: true });
    await rm(second.tempRoot, { recursive: true, force: true });
  }
});

test("runtime instance registry classifies old process entries as stale", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-stale-instance-");
  const workspaceRoot = path.join(tempRoot, "workspace");
  const registryPath = path.join(tempRoot, "registry", "instances.json");
  const previousRegistryPath = process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH;
  process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH = registryPath;
  let apiServer = null;

  try {
    await writeExecutableFixtureService(servicesRoot, "active-service");
    await mkdir(path.dirname(registryPath), { recursive: true });
    await writeFile(
      registryPath,
      JSON.stringify(
        {
          version: 1,
          updatedAt: "2026-01-01T00:00:00.000Z",
          instances: [
            {
              instanceId: "sl_old",
              servicesRoot: path.join(tempRoot, "old-services"),
              workspaceRoot: path.join(tempRoot, "old-workspace"),
              pid: 999999999,
              apiPort: 19000,
              apiUrl: "http://127.0.0.1:19000",
              advertisedUrls: ["http://127.0.0.1:19000"],
              startedAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
              version: "0.0.0-test",
              status: "active",
            },
          ],
        },
        null,
        2,
      ),
    );

    apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot });
    const response = await fetch(apiServer.url + "/api/runtime/instance");
    const body = await response.json();
    const oldEntry = body.registry.instances.find((entry) => entry.instanceId === "sl_old");

    assert.equal(response.status, 200);
    assert.equal(body.registry.activeCount, 1);
    assert.equal(body.registry.staleCount, 1);
    assert.equal(oldEntry.status, "stale");
    assert.equal(oldEntry.staleReason, "process_not_running");
  } finally {
    if (apiServer) await apiServer.stop();
    if (previousRegistryPath === undefined) {
      delete process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH;
    } else {
      process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH = previousRegistryPath;
    }
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
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
    assert.equal(body.dependencies.nodes.length, 11);
    assert.deepEqual(body.dependencies.edges, [
      { from: "@java", to: "@localcert" },
      { from: "@node", to: "@serviceadmin" },
      { from: "@localcert", to: "@traefik" },
      { from: "@nginx", to: "@traefik" },
      { from: "@node", to: "node-sample-service" },
    ]);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await clearPersistedFixtureState(servicesRoot);
  }
});

test("GET /api/dependencies/:id/dependents returns reverse dependency lookup", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-reverse-deps-api-");
  let apiServer = null;

  try {
    await writeExecutableFixtureService(servicesRoot, "base-service");
    await writeExecutableFixtureService(servicesRoot, "direct-a", { depend_on: ["base-service"] });
    await writeExecutableFixtureService(servicesRoot, "transitive-b", { depend_on: ["direct-a"] });
    await writeExecutableFixtureService(servicesRoot, "missing-consumer", { depend_on: ["missing-provider"] });

    apiServer = await startApiServer({ port: 0, servicesRoot });

    const response = await fetch(`${apiServer.url}/api/dependencies/base-service/dependents`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.dependencies.target, { id: "base-service", name: "base-service", exists: true });
    assert.deepEqual(body.dependencies.summary, { total: 2, direct: 1, transitive: 1, missingTarget: false });
    assert.deepEqual(
      body.dependencies.dependents.map((dependent) => ({
        id: dependent.id,
        relation: dependent.relation,
        path: dependent.path,
      })),
      [
        { id: "direct-a", relation: "direct", path: ["base-service", "direct-a"] },
        { id: "transitive-b", relation: "transitive", path: ["base-service", "direct-a", "transitive-b"] },
      ],
    );

    const missingResponse = await fetch(`${apiServer.url}/api/dependencies/missing-provider/dependents`);
    const missingBody = await missingResponse.json();

    assert.equal(missingResponse.status, 200);
    assert.deepEqual(missingBody.dependencies.target, { id: "missing-provider", name: null, exists: false });
    assert.deepEqual(missingBody.dependencies.summary, { total: 1, direct: 1, transitive: 0, missingTarget: true });
  } finally {
    if (apiServer) await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
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
