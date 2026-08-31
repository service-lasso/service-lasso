import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import path from "node:path";
import { once } from "node:events";
import { readFile, rm } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { getLifecycleState, resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import {
  RuntimeEndpointAllocationError,
  endpointHostsOverlap,
  planAndReserveRuntimeEndpoints,
  readRuntimeEndpointAllocationPlan,
  releaseRuntimeEndpointAllocation,
  runtimeApiEndpointFromAllocation,
  servicePortsFromEndpointAllocation,
} from "../dist/runtime/ports/allocation.js";
import { recordProcessOwnership } from "../dist/runtime/process/registry.js";
import { reconcilePortReservationLedger, reservePorts } from "../dist/runtime/ports/reservations.js";
import { rehydrateDiscoveredServices } from "../dist/runtime/state/rehydrate.js";
import { makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";

const alwaysFree = async () => true;

async function withAllocationEnvironment(prefix, range, action) {
  const fixture = await makeTempServicesRoot(prefix);
  const previousRegistry = process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH;
  const previousStart = process.env.SERVICE_LASSO_PORT_RANGE_START;
  const previousEnd = process.env.SERVICE_LASSO_PORT_RANGE_END;
  process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH = path.join(fixture.tempRoot, "host", "allocations.json");
  if (range) {
    process.env.SERVICE_LASSO_PORT_RANGE_START = String(range.start);
    process.env.SERVICE_LASSO_PORT_RANGE_END = String(range.end);
  } else {
    delete process.env.SERVICE_LASSO_PORT_RANGE_START;
    delete process.env.SERVICE_LASSO_PORT_RANGE_END;
  }
  try {
    return await action(fixture);
  } finally {
    if (previousRegistry === undefined) delete process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH;
    else process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH = previousRegistry;
    if (previousStart === undefined) delete process.env.SERVICE_LASSO_PORT_RANGE_START;
    else process.env.SERVICE_LASSO_PORT_RANGE_START = previousStart;
    if (previousEnd === undefined) delete process.env.SERVICE_LASSO_PORT_RANGE_END;
    else process.env.SERVICE_LASSO_PORT_RANGE_END = previousEnd;
    resetLifecycleState();
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
}

function planOptions(fixture, services, api = {}) {
  return {
    laneId: `lane:${path.basename(fixture.tempRoot)}`,
    servicesRoot: fixture.servicesRoot,
    workspaceRoot: fixture.workspaceRoot,
    api: { host: "127.0.0.1", port: 18180, policy: "preferred", ...api },
    services,
    probePort: alwaysFree,
  };
}

test("startup-wide allocation keeps the API preference and renegotiates a colliding service", async () => {
  await withAllocationEnvironment("service-lasso-allocation-collision-", { start: 18180, end: 18182 }, async (fixture) => {
    await writeExecutableFixtureService(fixture.servicesRoot, "echo-service", { ports: { service: 18180 } });
    const services = await discoverServices(fixture.servicesRoot);
    const plan = await planAndReserveRuntimeEndpoints(planOptions(fixture, services));
    try {
      assert.equal(runtimeApiEndpointFromAllocation(plan).port, 18180);
      assert.equal(servicePortsFromEndpointAllocation(plan)["echo-service"].service, 18181);
      assert.equal(plan.endpoints.find((entry) => entry.ownerId === "echo-service").resolution, "renegotiated");
      assert.equal(new Set(plan.endpoints.map((entry) => entry.port)).size, plan.endpoints.length);
      assert.equal((await readRuntimeEndpointAllocationPlan(fixture.workspaceRoot)).allocationId, plan.allocationId);
    } finally {
      await releaseRuntimeEndpointAllocation(plan);
    }
  });
});

test("wildcard and loopback bindings overlap during one allocation plan", async () => {
  assert.equal(endpointHostsOverlap("0.0.0.0", "127.0.0.1"), true);
  await withAllocationEnvironment("service-lasso-allocation-wildcard-", { start: 18190, end: 18192 }, async (fixture) => {
    await writeExecutableFixtureService(fixture.servicesRoot, "wildcard-service", {
      endpoints: [{
        id: "http",
        kind: "network",
        direction: "inbound",
        transport: "tcp",
        bind: "0.0.0.0",
        port: { default: 18190, strategy: "preferred" },
      }],
    });
    const services = await discoverServices(fixture.servicesRoot);
    const plan = await planAndReserveRuntimeEndpoints(planOptions(fixture, services, { port: 18190 }));
    try {
      assert.equal(runtimeApiEndpointFromAllocation(plan).port, 18190);
      assert.equal(servicePortsFromEndpointAllocation(plan)["wildcard-service"].http, 18191);
    } finally {
      await releaseRuntimeEndpointAllocation(plan);
    }
  });
});

test("wildcard API allocation rejects a port occupied by a specific local listener", async () => {
  await withAllocationEnvironment("service-lasso-allocation-wildcard-listener-", { start: 18193, end: 18194 }, async (fixture) => {
    const listener = net.createServer();
    listener.listen(18193, "127.0.0.1");
    await once(listener, "listening");
    try {
      const apiServer = await startApiServer({
        port: 18193,
        host: "0.0.0.0",
        servicesRoot: fixture.servicesRoot,
        workspaceRoot: fixture.workspaceRoot,
      });
      try {
        assert.equal(apiServer.port, 18194);
        const security = await fetch(`${apiServer.url}/api/runtime/security`).then((response) => response.json());
        assert.equal(security.auth.policy.bindHost, "0.0.0.0");
      } finally {
        await apiServer.stop();
      }
    } finally {
      await new Promise((resolve) => listener.close(() => resolve()));
    }
  });
});

test("fixed endpoints fail preflight while occupied preferred endpoints move", async () => {
  await withAllocationEnvironment("service-lasso-allocation-policy-", { start: 18200, end: 18202 }, async (fixture) => {
    await writeExecutableFixtureService(fixture.servicesRoot, "fixed-service", {
      endpoints: [{
        id: "http",
        kind: "network",
        direction: "inbound",
        transport: "tcp",
        bind: "127.0.0.1",
        port: { default: 18200, strategy: "fixed" },
      }],
    });
    const services = await discoverServices(fixture.servicesRoot);
    await assert.rejects(
      planAndReserveRuntimeEndpoints({
        ...planOptions(fixture, services, { port: 0, policy: "automatic" }),
        probePort: async ({ port }) => port !== 18200,
      }),
      (error) => {
        assert.ok(error instanceof RuntimeEndpointAllocationError);
        assert.equal(error.code, "endpoint_allocation_conflict");
        assert.equal(error.ownerId, "fixed-service");
        assert.equal(error.port, 18200);
        return true;
      },
    );
    assert.equal(getLifecycleState("fixed-service").running, false);
  });
});

test("verified adopted services retain pinned live allocations", async () => {
  await withAllocationEnvironment("service-lasso-allocation-adopted-", { start: 18210, end: 18212 }, async (fixture) => {
    const { serviceRoot } = await writeExecutableFixtureService(fixture.servicesRoot, "adopted-service", {
      ports: { service: 18210 },
    });
    await recordProcessOwnership(fixture.workspaceRoot, {
      ownerType: "service",
      ownerId: "adopted-service",
      serviceId: "adopted-service",
      pid: process.pid,
      ownerRoot: serviceRoot,
      ports: { service: 18212 },
      lifecycleState: "running",
      source: "spawn",
    });
    const services = await discoverServices(fixture.servicesRoot);
    const plan = await planAndReserveRuntimeEndpoints(planOptions(fixture, services, { port: 18210 }));
    try {
      const adopted = plan.endpoints.find((entry) => entry.ownerId === "adopted-service");
      assert.equal(adopted.port, 18212);
      assert.equal(adopted.pinned, true);
      assert.equal(adopted.resolution, "pinned");
    } finally {
      await releaseRuntimeEndpointAllocation(plan);
    }
  });
});

test("a stopped allocation is a restart preference and renegotiates when occupied", async () => {
  await withAllocationEnvironment("service-lasso-allocation-restart-", { start: 18215, end: 18217 }, async (fixture) => {
    const first = await planAndReserveRuntimeEndpoints(planOptions(fixture, [], { port: 18215 }));
    await releaseRuntimeEndpointAllocation(first);
    const second = await planAndReserveRuntimeEndpoints({
      ...planOptions(fixture, [], { port: 18215 }),
      probePort: async ({ port }) => port !== 18215,
    });
    try {
      const endpoint = runtimeApiEndpointFromAllocation(second);
      assert.equal(endpoint.port, 18216);
      assert.equal(endpoint.resolution, "renegotiated");
    } finally {
      await releaseRuntimeEndpointAllocation(second);
    }
  });
});

test("stale legacy ledger entries do not override current manifest preferences", async () => {
  await withAllocationEnvironment("service-lasso-allocation-stale-ledger-", { start: 18218, end: 18220 }, async (fixture) => {
    await writeExecutableFixtureService(fixture.servicesRoot, "echo-service", { ports: { service: 18218 } });
    await reservePorts(fixture.workspaceRoot, [{
      kind: "service-negotiated",
      ownerId: "echo-service",
      portName: "service",
      port: 18219,
    }]);
    await reconcilePortReservationLedger(fixture.workspaceRoot, [], "fixture allocation released");
    const services = await discoverServices(fixture.servicesRoot);
    const plan = await planAndReserveRuntimeEndpoints(planOptions(fixture, services, { port: 18220, policy: "fixed" }));
    try {
      assert.equal(servicePortsFromEndpointAllocation(plan)["echo-service"].service, 18218);
    } finally {
      await releaseRuntimeEndpointAllocation(plan);
    }
  });
});

test("host allocation lock prevents concurrent lanes from claiming the same endpoint", async () => {
  await withAllocationEnvironment("service-lasso-allocation-concurrent-", { start: 18220, end: 18222 }, async (first) => {
    const second = await makeTempServicesRoot("service-lasso-allocation-concurrent-peer-");
    try {
      const [firstPlan, secondPlan] = await Promise.all([
        planAndReserveRuntimeEndpoints(planOptions(first, [], { port: 18220 })),
        planAndReserveRuntimeEndpoints({
          ...planOptions(second, [], { port: 18220 }),
          laneId: `lane:${path.basename(second.tempRoot)}`,
        }),
      ]);
      try {
        assert.notEqual(runtimeApiEndpointFromAllocation(firstPlan).port, runtimeApiEndpointFromAllocation(secondPlan).port);
        assert.deepEqual(
          [runtimeApiEndpointFromAllocation(firstPlan).port, runtimeApiEndpointFromAllocation(secondPlan).port].sort(),
          [18220, 18221],
        );
      } finally {
        await releaseRuntimeEndpointAllocation(firstPlan);
        await releaseRuntimeEndpointAllocation(secondPlan);
      }
    } finally {
      await rm(second.tempRoot, { recursive: true, force: true });
    }
  });
});

test("runtime startup consumes one plan and materializes the renegotiated service port", async () => {
  await withAllocationEnvironment("service-lasso-allocation-startup-", { start: 18230, end: 18232 }, async (fixture) => {
    const { serviceRoot } = await writeExecutableFixtureService(fixture.servicesRoot, "echo-service", {
      autostart: true,
      ports: { service: 18230 },
      config: {
        files: [{ path: "./runtime/allocated.txt", content: "port=${endpoint.service.port}\n" }],
      },
    });
    const apiServer = await startApiServer({
      port: 18230,
      servicesRoot: fixture.servicesRoot,
      workspaceRoot: fixture.workspaceRoot,
      autostart: true,
    });
    try {
      assert.equal(apiServer.port, 18230);
      const lifecycle = getLifecycleState("echo-service");
      assert.equal(lifecycle.runtime.ports.service, 18231);
      assert.equal(lifecycle.runtime.allocationRevision, apiServer.endpointAllocationPlan.allocationId);
      assert.equal(await readFile(path.join(serviceRoot, "runtime", "allocated.txt"), "utf8"), "port=18231\n");
      const persistedRuntime = JSON.parse(await readFile(path.join(serviceRoot, ".state", "runtime.json"), "utf8"));
      assert.equal(persistedRuntime.allocationRevision, apiServer.endpointAllocationPlan.allocationId);
      const response = await fetch(`${apiServer.url}/api/runtime/endpoints/allocation`);
      const body = await response.json();
      assert.equal(body.allocation.phase, "reserved");
      assert.equal(body.allocation.endpoints.find((entry) => entry.ownerId === "echo-service").port, 18231);
      const detailResponse = await fetch(`${apiServer.url}/api/services/echo-service`);
      const detail = await detailResponse.json();
      assert.equal(detail.service.lifecycle.runtime.allocationRevision, apiServer.endpointAllocationPlan.allocationId);
    } finally {
      await apiServer.stop();
    }
    assert.equal((await readRuntimeEndpointAllocationPlan(fixture.workspaceRoot)).phase, "released");
  });
});

test("restart renegotiation rematerializes configured service selectors before relaunch", async () => {
  await withAllocationEnvironment("service-lasso-allocation-rematerialize-", { start: 18235, end: 18237 }, async (fixture) => {
    const { serviceRoot } = await writeExecutableFixtureService(fixture.servicesRoot, "echo-service", {
      autostart: true,
      ports: { service: 18235 },
      config: {
        files: [{ path: "./runtime/allocated.txt", content: "port=${endpoint.service.port}\n" }],
      },
    });
    const first = await startApiServer({
      port: 18235,
      servicesRoot: fixture.servicesRoot,
      workspaceRoot: fixture.workspaceRoot,
      autostart: true,
    });
    assert.equal(getLifecycleState("echo-service").runtime.ports.service, 18236);
    const firstAllocationId = first.endpointAllocationPlan.allocationId;
    await first.stop();
    resetLifecycleState();
    await rehydrateDiscoveredServices(await discoverServices(fixture.servicesRoot), {
      workspaceRoot: fixture.workspaceRoot,
    });
    assert.equal(getLifecycleState("echo-service").runtime.allocationRevision, firstAllocationId);
    assert.equal(getLifecycleState("echo-service").runtime.ports.service, 18236);

    const listener = net.createServer();
    listener.listen(18236, "127.0.0.1");
    await once(listener, "listening");
    try {
      const second = await startApiServer({
        port: 18235,
        servicesRoot: fixture.servicesRoot,
        workspaceRoot: fixture.workspaceRoot,
        autostart: true,
      });
      try {
        assert.equal(second.port, 18235);
        const lifecycle = getLifecycleState("echo-service");
        assert.equal(lifecycle.runtime.ports.service, 18237);
        assert.equal(lifecycle.runtime.allocationRevision, second.endpointAllocationPlan.allocationId);
        assert.equal(await readFile(path.join(serviceRoot, "runtime", "allocated.txt"), "utf8"), "port=18237\n");
      } finally {
        await second.stop();
      }
    } finally {
      await new Promise((resolve) => listener.close(() => resolve()));
    }
  });
});

test("an external listener makes a fixed service fail before any service starts", async () => {
  await withAllocationEnvironment("service-lasso-allocation-fixed-listener-", { start: 18240, end: 18242 }, async (fixture) => {
    const listener = net.createServer();
    listener.listen(18240, "127.0.0.1");
    await once(listener, "listening");
    await writeExecutableFixtureService(fixture.servicesRoot, "fixed-service", {
      autostart: true,
      endpoints: [{
        id: "http",
        kind: "network",
        direction: "inbound",
        transport: "tcp",
        bind: "127.0.0.1",
        port: { default: 18240, strategy: "fixed" },
      }],
    });
    try {
      await assert.rejects(
        startApiServer({ port: 0, servicesRoot: fixture.servicesRoot, workspaceRoot: fixture.workspaceRoot, autostart: true }),
        (error) => error instanceof RuntimeEndpointAllocationError && error.code === "endpoint_allocation_conflict",
      );
      assert.equal(getLifecycleState("fixed-service").running, false);
    } finally {
      await new Promise((resolve) => listener.close(() => resolve()));
    }
  });
});

test("a post-reservation API bind race replans within the configured finite limit", async () => {
  await withAllocationEnvironment("service-lasso-allocation-bind-race-", { start: 18250, end: 18252 }, async (fixture) => {
    const previousHooks = process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
    const previousLimit = process.env.SERVICE_LASSO_BIND_RETRY_LIMIT;
    process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = "1";
    process.env.SERVICE_LASSO_BIND_RETRY_LIMIT = "1";
    const racingListener = net.createServer();
    let racedPort = null;
    try {
      const apiServer = await startApiServer({
        port: 18250,
        servicesRoot: fixture.servicesRoot,
        workspaceRoot: fixture.workspaceRoot,
        endpointAllocationTestHooks: {
          beforeApiBind: async ({ attempt, endpoint }) => {
            if (attempt !== 1) return;
            racedPort = endpoint.port;
            racingListener.listen(endpoint.port, endpoint.host);
            await once(racingListener, "listening");
          },
        },
      });
      try {
        assert.equal(racedPort, 18250);
        assert.equal(apiServer.port, 18251);
        assert.equal(apiServer.endpointAllocationPlan.attempt, 2);
      } finally {
        await apiServer.stop();
      }
    } finally {
      if (racingListener.listening) {
        await new Promise((resolve) => racingListener.close(() => resolve()));
      }
      if (previousHooks === undefined) delete process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
      else process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = previousHooks;
      if (previousLimit === undefined) delete process.env.SERVICE_LASSO_BIND_RETRY_LIMIT;
      else process.env.SERVICE_LASSO_BIND_RETRY_LIMIT = previousLimit;
    }
  });
});

test("a specific-address bind race cannot capture a wildcard API advertised selector", async () => {
  await withAllocationEnvironment("service-lasso-allocation-selector-race-", { start: 18253, end: 18254 }, async (fixture) => {
    const previousHooks = process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
    const previousLimit = process.env.SERVICE_LASSO_BIND_RETRY_LIMIT;
    process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = "1";
    process.env.SERVICE_LASSO_BIND_RETRY_LIMIT = "1";
    const racingListener = net.createServer((socket) => {
      socket.end("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", () => socket.destroy());
    });
    try {
      const apiServer = await startApiServer({
        port: 18253,
        host: "0.0.0.0",
        servicesRoot: fixture.servicesRoot,
        workspaceRoot: fixture.workspaceRoot,
        endpointAllocationTestHooks: {
          beforeApiBind: async ({ attempt }) => {
            if (attempt !== 1) return;
            racingListener.listen(18253, "127.0.0.1");
            await once(racingListener, "listening");
          },
        },
      });
      try {
        assert.equal(apiServer.port, 18254);
        assert.equal(apiServer.endpointAllocationPlan.attempt, 2);
        const setup = await fetch(`${apiServer.url}/api/setup/status`).then((response) => response.json());
        assert.equal(setup.setup.trustBoundary.bindHost, "0.0.0.0");
      } finally {
        await apiServer.stop();
      }
    } finally {
      if (racingListener.listening) {
        await new Promise((resolve) => racingListener.close(() => resolve()));
      }
      if (previousHooks === undefined) delete process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
      else process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = previousHooks;
      if (previousLimit === undefined) delete process.env.SERVICE_LASSO_BIND_RETRY_LIMIT;
      else process.env.SERVICE_LASSO_BIND_RETRY_LIMIT = previousLimit;
    }
  });
});

test("startup failure after reservation releases the authoritative plan", async () => {
  await withAllocationEnvironment("service-lasso-allocation-startup-cleanup-", { start: 18255, end: 18257 }, async (fixture) => {
    const previousHooks = process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
    process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = "1";
    try {
      await assert.rejects(
        startApiServer({
          port: 18255,
          servicesRoot: fixture.servicesRoot,
          workspaceRoot: fixture.workspaceRoot,
          endpointAllocationTestHooks: {
            beforeApiBind: async () => {
              throw new Error("fixture startup failure");
            },
          },
        }),
        /fixture startup failure/,
      );
      assert.equal((await readRuntimeEndpointAllocationPlan(fixture.workspaceRoot)).phase, "released");
    } finally {
      if (previousHooks === undefined) delete process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
      else process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = previousHooks;
    }
  });
});
