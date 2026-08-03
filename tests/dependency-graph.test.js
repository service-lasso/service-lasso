import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { DependencyGraph, createServiceRegistry } from "../dist/runtime/manager/DependencyGraph.js";
import { makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";

test("global startup order uses serviceorder for ready independent services without weakening dependencies", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-serviceorder-");

  try {
    await writeExecutableFixtureService(servicesRoot, "z-unordered");
    await writeExecutableFixtureService(servicesRoot, "middle", {
      serviceorder: 50,
    });
    await writeExecutableFixtureService(servicesRoot, "legacy-first", {
      execconfig: {
        serviceorder: 5,
      },
    });
    await writeExecutableFixtureService(servicesRoot, "blocked-low-priority", {
      serviceorder: 1,
      depend_on: ["late-provider"],
    });
    await writeExecutableFixtureService(servicesRoot, "independent-mid", {
      serviceorder: 200,
    });
    await writeExecutableFixtureService(servicesRoot, "late-provider", {
      serviceorder: 500,
    });

    const graph = new DependencyGraph(createServiceRegistry(await discoverServices(servicesRoot)));

    assert.deepEqual(graph.getGlobalStartupOrder(), [
      "legacy-first",
      "middle",
      "independent-mid",
      "late-provider",
      "blocked-low-priority",
      "z-unordered",
    ]);
    assert.deepEqual(graph.getGlobalShutdownOrder(), [
      "z-unordered",
      "blocked-low-priority",
      "late-provider",
      "independent-mid",
      "middle",
      "legacy-first",
    ]);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("startup dependency lists are resolved by serviceorder when dependencies are independent", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-serviceorder-dependencies-");

  try {
    await writeExecutableFixtureService(servicesRoot, "slow-provider", {
      serviceorder: 50,
    });
    await writeExecutableFixtureService(servicesRoot, "fast-provider", {
      serviceorder: 5,
    });
    await writeExecutableFixtureService(servicesRoot, "target", {
      depend_on: ["slow-provider", "fast-provider"],
    });

    const graph = new DependencyGraph(createServiceRegistry(await discoverServices(servicesRoot)));

    assert.deepEqual(graph.getStartupOrder("target"), ["fast-provider", "slow-provider"]);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("provider capability requirements resolve to one concrete service dependency", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-provider-requires-");

  try {
    await writeExecutableFixtureService(servicesRoot, "postgres-provider", {
      role: "provider",
      provides: { postgres: "15.4" },
      serviceorder: 5,
    });
    await writeExecutableFixtureService(servicesRoot, "app-service", {
      requires: { postgres: ">=15" },
    });

    const graph = new DependencyGraph(createServiceRegistry(await discoverServices(servicesRoot)));
    const summary = graph.getServiceDependencies("app-service");

    assert.deepEqual(summary.dependencies, ["postgres-provider"]);
    assert.deepEqual(summary.providerRequirements, [
      {
        capability: "postgres",
        requirement: ">=15",
        serviceId: "postgres-provider",
        version: "15.4",
      },
    ]);
    assert.deepEqual(graph.getStartupOrder("app-service"), ["postgres-provider"]);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("explicit service id dependencies continue to work alongside capability requirements", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-direct-and-capability-");

  try {
    await writeExecutableFixtureService(servicesRoot, "direct-provider", { serviceorder: 10 });
    await writeExecutableFixtureService(servicesRoot, "java-provider", {
      role: "provider",
      provides: { java: "17.0.18" },
      serviceorder: 5,
    });
    await writeExecutableFixtureService(servicesRoot, "consumer", {
      depend_on: ["direct-provider"],
      requires: { java: ">=17" },
    });

    const graph = new DependencyGraph(createServiceRegistry(await discoverServices(servicesRoot)));

    assert.deepEqual(graph.getServiceDependencies("consumer").dependencies, ["java-provider", "direct-provider"]);
    assert.deepEqual(graph.getReverseDependencies("java-provider").dependents.map((entry) => entry.id), ["consumer"]);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("missing provider capability reports the required operator action", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-missing-provider-");

  try {
    await writeExecutableFixtureService(servicesRoot, "consumer", {
      requires: { postgres: ">=15" },
    });

    const graph = new DependencyGraph(createServiceRegistry(await discoverServices(servicesRoot)));

    assert.throws(
      () => graph.getServiceDependencies("consumer"),
      /No installed provider satisfies capability "postgres" required by "consumer" \(>=15\)\./,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("ambiguous provider capability reports concrete provider candidates", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-ambiguous-provider-");

  try {
    await writeExecutableFixtureService(servicesRoot, "postgres-a", {
      role: "provider",
      provides: { postgres: "15.0" },
    });
    await writeExecutableFixtureService(servicesRoot, "postgres-b", {
      role: "provider",
      provides: { postgres: "16.0" },
    });
    await writeExecutableFixtureService(servicesRoot, "consumer", {
      requires: { postgres: ">=15" },
    });

    const graph = new DependencyGraph(createServiceRegistry(await discoverServices(servicesRoot)));

    assert.throws(
      () => graph.getGlobalStartupOrder(),
      /Ambiguous provider capability "postgres" required by "consumer": postgres-a, postgres-b\./,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("depend_on can pin one provider when multiple services satisfy a capability", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-pinned-provider-");

  try {
    await writeExecutableFixtureService(servicesRoot, "postgres-a", {
      role: "provider",
      provides: { postgres: "15.0" },
    });
    await writeExecutableFixtureService(servicesRoot, "postgres-b", {
      role: "provider",
      provides: { postgres: "16.0" },
    });
    await writeExecutableFixtureService(servicesRoot, "consumer", {
      depend_on: ["postgres-b"],
      requires: { postgres: ">=15" },
    });

    const graph = new DependencyGraph(createServiceRegistry(await discoverServices(servicesRoot)));

    assert.deepEqual(graph.getServiceDependencies("consumer").dependencies, ["postgres-b"]);
    assert.deepEqual(graph.getServiceDependencies("consumer").providerRequirements, [
      {
        capability: "postgres",
        requirement: ">=15",
        serviceId: "postgres-b",
        version: "16.0",
      },
    ]);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("endpoint cutover impact includes selector consumers and downstream dependents only", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-endpoint-cutover-");

  try {
    await writeExecutableFixtureService(servicesRoot, "api-provider", {
      endpoints: [
        {
          id: "api",
          kind: "network",
          direction: "inbound",
          protocol: "http",
          port: { default: 3200, strategy: "preferred" },
        },
      ],
      serviceorder: 1,
    });
    await writeExecutableFixtureService(servicesRoot, "direct-consumer", {
      depend_on: ["api-provider"],
      env: {
        API_URL: "${endpoint.api.url}",
      },
      serviceorder: 10,
    });
    await writeExecutableFixtureService(servicesRoot, "fanout-consumer", {
      depend_on: ["api-provider"],
      config: {
        files: [
          {
            path: "generated/client.json",
            content: "{\"port\":\"${endpoint.api.port}\"}",
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
        STATIC_URL: "http://127.0.0.1:3200",
      },
      serviceorder: 30,
    });

    const graph = new DependencyGraph(createServiceRegistry(await discoverServices(servicesRoot)));
    const impact = graph.getEndpointCutoverImpact("api-provider", ["api"]);

    assert.deepEqual(impact.selectorConsumerIds, ["direct-consumer", "fanout-consumer"]);
    assert.deepEqual(impact.restartOrder, ["direct-consumer", "fanout-consumer", "transitive-worker"]);
    assert.deepEqual(
      impact.impactedServices.map((service) => ({
        id: service.id,
        relation: service.relation,
        selectors: service.selectorUses.map((use) => use.selector),
      })),
      [
        {
          id: "direct-consumer",
          relation: "direct",
          selectors: ["endpoint.api.url"],
        },
        {
          id: "fanout-consumer",
          relation: "direct",
          selectors: ["endpoint.api.port"],
        },
        {
          id: "transitive-worker",
          relation: "transitive",
          selectors: [],
        },
      ],
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("endpoint cutover impact filters unchanged endpoint selectors", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-endpoint-cutover-filter-");

  try {
    await writeExecutableFixtureService(servicesRoot, "provider", {
      endpoints: [
        { id: "api", kind: "network", port: { default: 3200 } },
        { id: "admin", kind: "network", port: { default: 3201 } },
      ],
    });
    await writeExecutableFixtureService(servicesRoot, "api-consumer", {
      depend_on: ["provider"],
      env: { API_PORT: "${endpoint.api.port}" },
    });
    await writeExecutableFixtureService(servicesRoot, "admin-consumer", {
      depend_on: ["provider"],
      env: { ADMIN_PORT: "${endpoint.admin.port}" },
    });

    const graph = new DependencyGraph(createServiceRegistry(await discoverServices(servicesRoot)));

    assert.deepEqual(graph.getEndpointCutoverImpact("provider", ["api"]).restartOrder, ["api-consumer"]);
    assert.deepEqual(graph.getEndpointCutoverImpact("provider", ["admin"]).restartOrder, ["admin-consumer"]);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("endpoint cutover impact fails before mutation when dependencies cycle", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-endpoint-cutover-cycle-");

  try {
    await writeExecutableFixtureService(servicesRoot, "provider", {
      endpoints: [{ id: "api", kind: "network", port: { default: 3200 } }],
    });
    await writeExecutableFixtureService(servicesRoot, "cycle-a", {
      depend_on: ["provider", "cycle-b"],
      env: { API_PORT: "${endpoint.api.port}" },
    });
    await writeExecutableFixtureService(servicesRoot, "cycle-b", {
      depend_on: ["cycle-a"],
    });

    const graph = new DependencyGraph(createServiceRegistry(await discoverServices(servicesRoot)));

    assert.throws(
      () => graph.getEndpointCutoverImpact("provider", ["api"]),
      /Dependency cycle detected while resolving endpoint cutover impact for "provider"/,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
