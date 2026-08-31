import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { configService, installService } from "../dist/runtime/lifecycle/actions.js";
import { getLifecycleState, resetLifecycleState, setLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { DependencyGraph, createServiceRegistry } from "../dist/runtime/manager/DependencyGraph.js";
import { buildServiceVariables, resolveServiceText } from "../dist/runtime/operator/variables.js";
import { mergeServiceVariableResolutionOptions } from "../dist/runtime/broker/launch-resolution.js";
import { rollbackStartupMaterializations } from "../dist/runtime/startup/materialization.js";
import {
  consumerEndpointSelectorValues,
  executeEndpointCutover,
  planEndpointCutover,
  snapshotLifecycleAllocationRevision,
  snapshotLifecyclePortsByService,
} from "../dist/runtime/startup/endpoint-cutover.js";
import {
  advanceStartupTransaction,
  beginStartupTransaction,
} from "../dist/runtime/startup/transaction.js";
import { writeServiceState } from "../dist/runtime/state/writeState.js";
import { makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";

const PREVIOUS_PORT = 32111;
const NEXT_PORT = 32222;
const GENERATED_RELATIVE_PATH = "generated/client.json";
const GENERATED_TEMPLATE = "{\"port\":\"${endpoint.api.port}\"}";

function digestText(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertNoEndpointValues(serialized) {
  assert.equal(serialized.includes(String(PREVIOUS_PORT)), false);
  assert.equal(serialized.includes(String(NEXT_PORT)), false);
}

function serviceAllocationPlan(fixture, allocationId, endpoints) {
  return {
    version: 1,
    allocationId,
    laneId: "cutover-test",
    generationId: null,
    servicesRoot: fixture.servicesRoot,
    workspaceRoot: fixture.workspaceRoot,
    phase: "reserved",
    attempt: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    endpoints: endpoints.map((endpoint) => ({
      ownerType: "service",
      ownerId: endpoint.ownerId,
      endpointId: endpoint.endpointId,
      host: "127.0.0.1",
      advertiseHost: "127.0.0.1",
      transport: "tcp",
      protocol: "http",
      policy: "preferred",
      resolution: "renegotiated",
      port: endpoint.port,
      preferredPorts: [endpoint.port],
      range: null,
      pinned: false,
      selectors: {
        bind: "127.0.0.1",
        host: "127.0.0.1",
        port: endpoint.port,
        url: `http://127.0.0.1:${endpoint.port}`,
      },
    })),
  };
}

async function withCutoverEnvironment(prefix, action) {
  const fixture = await makeTempServicesRoot(prefix);
  const previousHooks = process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
  process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = "1";
  try {
    await action(fixture);
  } finally {
    if (previousHooks === undefined) delete process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
    else process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = previousHooks;
    resetLifecycleState();
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
}

async function writeCutoverGraph(servicesRoot, options = {}) {
  await writeExecutableFixtureService(servicesRoot, "api-provider", {
    endpoints: [
      {
        id: "api",
        kind: "network",
        direction: "inbound",
        protocol: "http",
        port: { default: PREVIOUS_PORT, strategy: "preferred" },
      },
    ],
    serviceorder: 1,
  });
  await writeExecutableFixtureService(servicesRoot, "direct-consumer", {
    depend_on: ["api-provider"],
    env: {
      API_URL: "${endpoint.api.url}",
    },
    config: {
      files: [
        {
          path: GENERATED_RELATIVE_PATH,
          content: GENERATED_TEMPLATE,
        },
      ],
    },
    healthcheck: {
      type: "http",
      url: "${endpoint.api.url}/health",
    },
    serviceorder: 10,
    ...(options.directActions ? { actions: options.directActions } : {}),
  });
  await writeExecutableFixtureService(servicesRoot, "fanout-consumer", {
    depend_on: ["api-provider"],
    config: {
      files: [
        {
          path: GENERATED_RELATIVE_PATH,
          content: GENERATED_TEMPLATE,
        },
      ],
    },
    serviceorder: 11,
  });
  await writeExecutableFixtureService(servicesRoot, "transitive-worker", {
    depend_on: ["direct-consumer"],
    serviceorder: 20,
  });
  await writeExecutableFixtureService(servicesRoot, "unaffected-dependent", {
    depend_on: ["api-provider"],
    env: {
      STATIC_URL: "http://127.0.0.1:65500",
    },
    serviceorder: 30,
  });
}

async function installAndConfigService(registry, serviceId, plannedPorts, allocationRevision, overlay) {
  const service = registry.getById(serviceId);
  assert.ok(service);
  const installed = await installService(service, registry);
  setLifecycleState(serviceId, installed.state);
  await writeServiceState(service, installed.state);
  const configured = await configService(service, registry, {
    plannedPorts,
    allocationRevision,
    variableResolution: overlay ? { endpointSelectorValues: overlay } : undefined,
  });
  setLifecycleState(serviceId, configured.state);
  await writeServiceState(service, configured.state);
  return service;
}

async function seedGraphFromPlan(fixture, plan) {
  const discovered = await discoverServices(fixture.servicesRoot);
  const registry = createServiceRegistry(discovered);
  const graph = new DependencyGraph(registry);
  const overlayFor = (serviceId) =>
    consumerEndpointSelectorValues(
      plan,
      serviceId,
      graph.getServiceDependencies(serviceId).dependencies,
    );
  await installAndConfigService(
    registry,
    "api-provider",
    { api: PREVIOUS_PORT },
    plan.allocationId,
    overlayFor("api-provider"),
  );
  await installAndConfigService(
    registry,
    "direct-consumer",
    {},
    plan.allocationId,
    overlayFor("direct-consumer"),
  );
  await installAndConfigService(
    registry,
    "fanout-consumer",
    {},
    plan.allocationId,
    overlayFor("fanout-consumer"),
  );
  await installAndConfigService(
    registry,
    "transitive-worker",
    {},
    plan.allocationId,
    overlayFor("transitive-worker"),
  );
  await installAndConfigService(
    registry,
    "unaffected-dependent",
    {},
    plan.allocationId,
    overlayFor("unaffected-dependent"),
  );
  return { discovered, registry, graph };
}

function generatedPath(servicesRoot, serviceId) {
  return path.join(servicesRoot, serviceId, GENERATED_RELATIVE_PATH);
}

async function fileDigest(servicesRoot, serviceId) {
  return digestText(await readFile(generatedPath(servicesRoot, serviceId)));
}

function expectedGeneratedDigest(plan, registry, graph, serviceId) {
  const service = registry.getById(serviceId);
  assert.ok(service);
  const overlay = consumerEndpointSelectorValues(
    plan,
    serviceId,
    graph.getServiceDependencies(serviceId).dependencies,
  );
  return digestText(resolveServiceText(GENERATED_TEMPLATE, service, {}, {}, { endpointSelectorValues: overlay }));
}

test("AC-4BK rematerialises direct and fan-out consumers from one allocation revision", async () => {
  await withCutoverEnvironment("service-lasso-endpoint-cutover-direct-", async (fixture) => {
    await writeCutoverGraph(fixture.servicesRoot);
    const previousPlan = serviceAllocationPlan(fixture, "alloc-previous", [
      { ownerId: "api-provider", endpointId: "api", port: PREVIOUS_PORT },
    ]);
    const nextPlan = serviceAllocationPlan(fixture, "alloc-next", [
      { ownerId: "api-provider", endpointId: "api", port: NEXT_PORT },
    ]);
    const { discovered, registry, graph } = await seedGraphFromPlan(fixture, previousPlan);
    const previousDirectDigest = await fileDigest(fixture.servicesRoot, "direct-consumer");
    const previousFanoutDigest = await fileDigest(fixture.servicesRoot, "fanout-consumer");

    const result = await executeEndpointCutover({
      graph,
      registry,
      services: discovered,
      workspaceRoot: fixture.workspaceRoot,
      allocationPlan: nextPlan,
    });

    assert.equal(result.status, "applied");
    assert.equal(result.previousAllocationRevision, "alloc-previous");
    assert.equal(result.nextAllocationRevision, "alloc-next");
    assert.deepEqual(result.rematerializedServiceIds, [
      "api-provider",
      "direct-consumer",
      "fanout-consumer",
      "transitive-worker",
    ]);
    assert.deepEqual(result.reloadedServiceIds, []);
    assert.deepEqual(result.restartedServiceIds, []);
    assert.equal(result.rematerializedServiceIds.includes("unaffected-dependent"), false);
    assertNoEndpointValues(JSON.stringify(result));

    const nextDirectDigest = await fileDigest(fixture.servicesRoot, "direct-consumer");
    const nextFanoutDigest = await fileDigest(fixture.servicesRoot, "fanout-consumer");
    assert.notEqual(nextDirectDigest, previousDirectDigest);
    assert.notEqual(nextFanoutDigest, previousFanoutDigest);
    assert.equal(nextDirectDigest, expectedGeneratedDigest(nextPlan, registry, graph, "direct-consumer"));
    assert.equal(nextFanoutDigest, expectedGeneratedDigest(nextPlan, registry, graph, "fanout-consumer"));
    assert.equal((await readFile(generatedPath(fixture.servicesRoot, "direct-consumer"), "utf8")).includes(String(PREVIOUS_PORT)), false);
    assert.equal((await readFile(generatedPath(fixture.servicesRoot, "fanout-consumer"), "utf8")).includes(String(PREVIOUS_PORT)), false);
    assert.equal(getLifecycleState("direct-consumer").runtime.allocationRevision, "alloc-next");
    assert.equal(getLifecycleState("fanout-consumer").runtime.allocationRevision, "alloc-next");
    assert.equal(getLifecycleState("api-provider").runtime.allocationRevision, "alloc-next");
  });
});

test("AC-4BK reloads reload-capable consumers and restarts the rest in provider-before-consumer order", async () => {
  await withCutoverEnvironment("service-lasso-endpoint-cutover-reload-", async (fixture) => {
    await writeCutoverGraph(fixture.servicesRoot, {
      directActions: {
        reload: {
          command: process.execPath,
          args: ["-e", "process.exit(0)"],
        },
      },
    });
    const previousPlan = serviceAllocationPlan(fixture, "alloc-previous", [
      { ownerId: "api-provider", endpointId: "api", port: PREVIOUS_PORT },
    ]);
    const nextPlan = serviceAllocationPlan(fixture, "alloc-next", [
      { ownerId: "api-provider", endpointId: "api", port: NEXT_PORT },
    ]);
    const { discovered, registry, graph } = await seedGraphFromPlan(fixture, previousPlan);
    for (const serviceId of ["direct-consumer", "fanout-consumer", "transitive-worker"]) {
      const current = getLifecycleState(serviceId);
      setLifecycleState(serviceId, { ...current, running: true });
    }

    const observed = [];
    const result = await executeEndpointCutover({
      graph,
      registry,
      services: discovered,
      workspaceRoot: fixture.workspaceRoot,
      allocationPlan: nextPlan,
      operations: {
        rematerialize: async (service) => {
          observed.push(`rematerialize:${service.manifest.id}`);
          const current = getLifecycleState(service.manifest.id);
          setLifecycleState(service.manifest.id, {
            ...current,
            runtime: {
              ...current.runtime,
              allocationRevision: nextPlan.allocationId,
            },
          });
        },
        reload: async (service) => {
          observed.push(`reload:${service.manifest.id}`);
        },
        restart: async (service) => {
          observed.push(`restart:${service.manifest.id}`);
        },
      },
    });

    assert.deepEqual(observed, [
      "rematerialize:api-provider",
      "rematerialize:direct-consumer",
      "reload:direct-consumer",
      "rematerialize:fanout-consumer",
      "restart:fanout-consumer",
      "rematerialize:transitive-worker",
      "restart:transitive-worker",
    ]);
    assert.deepEqual(result.reloadedServiceIds, ["direct-consumer"]);
    assert.deepEqual(result.restartedServiceIds, ["fanout-consumer", "transitive-worker"]);
    assertNoEndpointValues(JSON.stringify(result));
    assertNoEndpointValues(JSON.stringify(observed));
  });
});

test("AC-4BK keeps previous and next allocation revisions distinct during cutover", async () => {
  await withCutoverEnvironment("service-lasso-endpoint-cutover-revision-", async (fixture) => {
    await writeCutoverGraph(fixture.servicesRoot);
    const previousPlan = serviceAllocationPlan(fixture, "alloc-previous", [
      { ownerId: "api-provider", endpointId: "api", port: PREVIOUS_PORT },
    ]);
    const nextPlan = serviceAllocationPlan(fixture, "alloc-next", [
      { ownerId: "api-provider", endpointId: "api", port: NEXT_PORT },
    ]);
    const { discovered, registry, graph } = await seedGraphFromPlan(fixture, previousPlan);
    const seen = [];

    await executeEndpointCutover({
      graph,
      registry,
      services: discovered,
      workspaceRoot: fixture.workspaceRoot,
      allocationPlan: nextPlan,
      testHooks: {
        beforeService: async (serviceId, previousRevision) => {
          seen.push({
            serviceId,
            phase: "before",
            previousRevision,
            providerRevision: getLifecycleState("api-provider").runtime.allocationRevision,
          });
        },
        afterService: async (serviceId, nextRevision) => {
          seen.push({
            serviceId,
            phase: "after",
            nextRevision,
            serviceRevision: getLifecycleState(serviceId).runtime.allocationRevision,
          });
        },
      },
    });

    const consumerBefore = seen.find((entry) => entry.serviceId === "direct-consumer" && entry.phase === "before");
    const providerAfter = seen.find((entry) => entry.serviceId === "api-provider" && entry.phase === "after");
    assert.equal(consumerBefore.previousRevision, "alloc-previous");
    assert.equal(consumerBefore.providerRevision, "alloc-next");
    assert.equal(providerAfter.nextRevision, "alloc-next");
    assert.equal(providerAfter.serviceRevision, "alloc-next");
    assert.notEqual(snapshotLifecycleAllocationRevision(["direct-consumer"]), "alloc-previous");
    assertNoEndpointValues(JSON.stringify(seen));
  });
});

test("AC-4BK fails before mutation when endpoint cutover order is cyclic", async () => {
  await withCutoverEnvironment("service-lasso-endpoint-cutover-cycle-exec-", async (fixture) => {
    await writeExecutableFixtureService(fixture.servicesRoot, "provider", {
      endpoints: [{ id: "api", kind: "network", port: { default: PREVIOUS_PORT } }],
    });
    await writeExecutableFixtureService(fixture.servicesRoot, "cycle-a", {
      depend_on: ["provider", "cycle-b"],
      env: { API_PORT: "${endpoint.api.port}" },
    });
    await writeExecutableFixtureService(fixture.servicesRoot, "cycle-b", {
      depend_on: ["cycle-a"],
    });
    const discovered = await discoverServices(fixture.servicesRoot);
    const registry = createServiceRegistry(discovered);
    const graph = new DependencyGraph(registry);
    const nextPlan = serviceAllocationPlan(fixture, "alloc-next", [
      { ownerId: "provider", endpointId: "api", port: NEXT_PORT },
    ]);
    let rematerialized = 0;

    await assert.rejects(
      () => executeEndpointCutover({
        graph,
        registry,
        services: discovered,
        workspaceRoot: fixture.workspaceRoot,
        allocationPlan: nextPlan,
        operations: {
          rematerialize: async () => {
            rematerialized += 1;
          },
        },
      }),
      /Dependency cycle detected while resolving endpoint cutover impact for "provider"/,
    );
    assert.equal(rematerialized, 0);
    assert.throws(
      () => planEndpointCutover(
        graph,
        snapshotLifecyclePortsByService(["provider"]),
        nextPlan,
        null,
      ),
      /Dependency cycle detected while resolving endpoint cutover impact for "provider"/,
    );
  });
});

test("AC-4BK rolls back a partial cutover through the startup transaction", async () => {
  await withCutoverEnvironment("service-lasso-endpoint-cutover-rollback-", async (fixture) => {
    await writeCutoverGraph(fixture.servicesRoot);
    const previousPlan = serviceAllocationPlan(fixture, "alloc-previous", [
      { ownerId: "api-provider", endpointId: "api", port: PREVIOUS_PORT },
    ]);
    const nextPlan = serviceAllocationPlan(fixture, "alloc-next", [
      { ownerId: "api-provider", endpointId: "api", port: NEXT_PORT },
    ]);
    const { discovered, registry, graph } = await seedGraphFromPlan(fixture, previousPlan);
    const previousDirectDigest = await fileDigest(fixture.servicesRoot, "direct-consumer");
    const transaction = {
      journal: await beginStartupTransaction({
        generationId: "123e4567-e89b-42d3-a456-426614174000",
        instanceId: "sl-cutover",
        servicesRoot: fixture.servicesRoot,
        workspaceRoot: fixture.workspaceRoot,
      }),
    };
    transaction.journal = await advanceStartupTransaction(transaction.journal, "allocation_reserved", {
      allocationRevision: nextPlan.allocationId,
    });

    await assert.rejects(
      () => executeEndpointCutover({
        graph,
        registry,
        services: discovered,
        workspaceRoot: fixture.workspaceRoot,
        allocationPlan: nextPlan,
        transaction,
        testHooks: {
          beforeService: async (serviceId) => {
            if (serviceId === "fanout-consumer") {
              throw new Error("injected-cutover-failure");
            }
          },
        },
      }),
      /injected-cutover-failure/,
    );

    const rollback = await rollbackStartupMaterializations(transaction.journal);
    assert.equal(rollback.blockedActionIds.length, 0);
    assert.equal(rollback.completedActionIds.length > 0, true);
    assert.equal(await fileDigest(fixture.servicesRoot, "direct-consumer"), previousDirectDigest);
    assert.equal((await readFile(generatedPath(fixture.servicesRoot, "direct-consumer"), "utf8")).includes(String(NEXT_PORT)), false);
    assertNoEndpointValues(JSON.stringify({
      completedActionIds: rollback.completedActionIds,
      blockedActionIds: rollback.blockedActionIds,
    }));
  });
});

test("AC-4BK overlay selector values fill missing keys and never replace local endpoints", async () => {
  await withCutoverEnvironment("service-lasso-endpoint-cutover-overlay-", async (fixture) => {
    await writeExecutableFixtureService(fixture.servicesRoot, "local-owner", {
      endpoints: [
        {
          id: "api",
          kind: "network",
          direction: "inbound",
          protocol: "http",
          port: { default: PREVIOUS_PORT, strategy: "preferred" },
        },
      ],
    });
    const discovered = await discoverServices(fixture.servicesRoot);
    const service = discovered.find((entry) => entry.manifest.id === "local-owner");
    assert.ok(service);

    const merged = mergeServiceVariableResolutionOptions(
      { endpointSelectorValues: { "endpoint.api.port": "11111", "endpoint.upstream.port": "22222" } },
      { endpointSelectorValues: { "endpoint.upstream.port": String(NEXT_PORT), "endpoint.upstream.host": "127.0.0.1" } },
    );
    const payload = buildServiceVariables(service, {}, { api: PREVIOUS_PORT }, merged);
    const byKey = Object.fromEntries(payload.variables.map((entry) => [entry.key, entry.value]));
    const localPortDigest = digestText(String(PREVIOUS_PORT));
    const overlayPortDigest = digestText(String(NEXT_PORT));

    assert.equal(digestText(byKey["endpoint.api.port"]), localPortDigest);
    assert.equal(digestText(byKey["endpoint.upstream.port"]), overlayPortDigest);
    assert.equal(Object.prototype.hasOwnProperty.call(byKey, "endpoint.upstream.host"), true);
    assert.notEqual(digestText(byKey["endpoint.api.port"]), overlayPortDigest);
    assertNoEndpointValues(JSON.stringify({
      keys: Object.keys(byKey).filter((key) => key.startsWith("endpoint.")).sort(),
    }));
  });
});
