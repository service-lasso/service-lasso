import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { rm } from "node:fs/promises";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { stopManagedProcess } from "../dist/runtime/execution/supervisor.js";
import {
  beginRuntimeGeneration,
  publishRuntimeGeneration,
  resolveRuntimeInstanceId,
} from "../dist/runtime/instance/registry.js";
import { configService, installService, startService } from "../dist/runtime/lifecycle/actions.js";
import { getLifecycleState, resetLifecycleState, setLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { createServiceRegistry } from "../dist/runtime/manager/DependencyGraph.js";
import {
  planAndReserveRuntimeEndpoints,
  releaseRuntimeEndpointAllocation,
  servicePortsFromEndpointAllocation,
} from "../dist/runtime/ports/allocation.js";
import {
  classifyRegisteredProcess,
  findProcessOwnership,
} from "../dist/runtime/process/registry.js";
import { rebindCommittedServiceAdoption } from "../dist/runtime/startup/committed-adoption.js";
import { writeServiceState } from "../dist/runtime/state/writeState.js";
import { makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";

async function withAdoptionEnvironment(action) {
  const fixture = await makeTempServicesRoot("service-lasso-committed-adoption-");
  const previousHostRegistry = process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH;
  process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH = path.join(fixture.tempRoot, "host", "allocations.json");
  try {
    await action(fixture);
  } finally {
    if (previousHostRegistry === undefined) delete process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH;
    else process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH = previousHostRegistry;
    await stopManagedProcess("committed-service", 5_000).catch(() => null);
    resetLifecycleState();
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
}

async function createCommittedServiceFixture(fixture) {
  await writeExecutableFixtureService(fixture.servicesRoot, "committed-service", {
    autostart: true,
    endpoints: [{
      id: "http",
      kind: "network",
      direction: "inbound",
      transport: "tcp",
      protocol: "http",
      port: { default: 0, strategy: "automatic" },
    }],
  });
  const discovered = await discoverServices(fixture.servicesRoot);
  const registry = createServiceRegistry(discovered);
  const service = registry.getById("committed-service");
  assert.ok(service);
  const config = { servicesRoot: fixture.servicesRoot, workspaceRoot: fixture.workspaceRoot, version: "test" };
  const oldGenerationId = "123e4567-e89b-42d3-a456-426614174181";
  await beginRuntimeGeneration(config, { generationId: oldGenerationId });
  const oldAllocation = await planAndReserveRuntimeEndpoints({
    laneId: resolveRuntimeInstanceId(config),
    servicesRoot: fixture.servicesRoot,
    workspaceRoot: fixture.workspaceRoot,
    api: { host: "127.0.0.1", advertiseHost: "127.0.0.1", port: 0, policy: "automatic" },
    services: discovered,
    generationId: oldGenerationId,
    attempt: 1,
  });
  await writeServiceState(service, (await installService(service, registry)).state);
  await writeServiceState(service, (await configService(service, registry)).state);
  const started = await startService(service, registry, {
    workspaceRoot: fixture.workspaceRoot,
    runtimeGenerationId: oldGenerationId,
    runtimeInstanceId: resolveRuntimeInstanceId(config),
    allocationRevision: oldAllocation.allocationId,
    plannedPorts: servicePortsFromEndpointAllocation(oldAllocation)[service.manifest.id],
  });
  await writeServiceState(service, started.state);
  await publishRuntimeGeneration(config, oldGenerationId, {
    phase: "running",
    allocationRevision: oldAllocation.allocationId,
  });
  await releaseRuntimeEndpointAllocation(oldAllocation);
  await publishRuntimeGeneration(config, oldGenerationId, { phase: "superseded" });

  const newGenerationId = "123e4567-e89b-42d3-a456-426614174182";
  await beginRuntimeGeneration(config, { generationId: newGenerationId });
  const newAllocation = await planAndReserveRuntimeEndpoints({
    laneId: resolveRuntimeInstanceId(config),
    servicesRoot: fixture.servicesRoot,
    workspaceRoot: fixture.workspaceRoot,
    api: { host: "127.0.0.1", advertiseHost: "127.0.0.1", port: 0, policy: "automatic" },
    services: discovered,
    generationId: newGenerationId,
    attempt: 1,
  });
  return { config, service, started, oldGenerationId, newGenerationId, newAllocation };
}

test("AC-4BJ.9 verified committed service rebinds idempotently to the fresh generation and allocation", async () => {
  await withAdoptionEnvironment(async (fixture) => {
    const setup = await createCommittedServiceFixture(fixture);
    try {
      const options = {
        workspaceRoot: fixture.workspaceRoot,
        runtimeGenerationId: setup.newGenerationId,
        runtimeInstanceId: resolveRuntimeInstanceId(setup.config),
        allocationPlan: setup.newAllocation,
      };
      const priorState = getLifecycleState(setup.service.manifest.id);
      await writeServiceState(setup.service, setLifecycleState(setup.service.manifest.id, {
        ...priorState,
        runtime: {
          ...priorState.runtime,
          allocationRevision: setup.newAllocation.allocationId,
        },
      }));
      const firstPid = await rebindCommittedServiceAdoption(setup.service, options);
      const secondPid = await rebindCommittedServiceAdoption(setup.service, options);
      const owner = await findProcessOwnership(fixture.workspaceRoot, "service", setup.service.manifest.id);
      const state = getLifecycleState(setup.service.manifest.id);

      assert.equal(firstPid, setup.started.state.runtime.pid);
      assert.equal(secondPid, firstPid);
      assert.equal(await classifyRegisteredProcess(owner), "owned");
      assert.equal(owner.generationId, setup.newGenerationId);
      assert.equal(owner.allocation.revision, setup.newAllocation.allocationId);
      assert.equal(state.runtime.pid, firstPid);
      assert.equal(state.runtime.generationId, setup.newGenerationId);
      assert.equal(state.runtime.allocationRevision, setup.newAllocation.allocationId);
    } finally {
      await releaseRuntimeEndpointAllocation(setup.newAllocation);
    }
  });
});

test("AC-4BJ.9 committed service rebind fails closed when the target allocation changes live ports", async () => {
  await withAdoptionEnvironment(async (fixture) => {
    const setup = await createCommittedServiceFixture(fixture);
    try {
      const mismatchedAllocation = {
        ...setup.newAllocation,
        endpoints: setup.newAllocation.endpoints.map((endpoint) => endpoint.ownerType === "service"
          ? { ...endpoint, port: endpoint.port === 65535 ? 65534 : endpoint.port + 1 }
          : endpoint),
      };
      await assert.rejects(
        rebindCommittedServiceAdoption(setup.service, {
          workspaceRoot: fixture.workspaceRoot,
          runtimeGenerationId: setup.newGenerationId,
          runtimeInstanceId: resolveRuntimeInstanceId(setup.config),
          allocationPlan: mismatchedAllocation,
        }),
        /different endpoint allocation/,
      );
      const owner = await findProcessOwnership(fixture.workspaceRoot, "service", setup.service.manifest.id);
      assert.equal(await classifyRegisteredProcess(owner), "owned");
      assert.equal(owner.generationId, setup.oldGenerationId);
      assert.equal(getLifecycleState(setup.service.manifest.id).runtime.generationId, setup.oldGenerationId);
    } finally {
      await releaseRuntimeEndpointAllocation(setup.newAllocation);
    }
  });
});
