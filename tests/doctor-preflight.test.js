import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { stopAllManagedProcesses } from "../dist/runtime/execution/supervisor.js";
import { configService, installService, restartService, startService } from "../dist/runtime/lifecycle/actions.js";
import { getLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { createServiceRegistry } from "../dist/runtime/manager/DependencyGraph.js";
import { rehydrateDiscoveredServices } from "../dist/runtime/state/rehydrate.js";
import { readStoredState } from "../dist/runtime/state/readState.js";
import { writeServiceState } from "../dist/runtime/state/writeState.js";
import { makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";

async function prepareService(servicesRoot, serviceId, doctor) {
  await writeExecutableFixtureService(servicesRoot, serviceId, {
    doctor,
  });
  const discovered = await discoverServices(servicesRoot);
  await rehydrateDiscoveredServices(discovered);
  const registry = createServiceRegistry(discovered);
  const service = registry.getById(serviceId);
  assert.ok(service);

  const install = await installService(service, registry);
  await writeServiceState(service, install.state);
  const config = await configService(service, registry);
  await writeServiceState(service, config.state);
  const start = await startService(service, registry);
  await writeServiceState(service, start.state);

  return { registry, service };
}

test("restart runs passing doctor preflight before replacing the service process", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-doctor-pass-");

  try {
    const { registry, service } = await prepareService(servicesRoot, "doctor-pass-service", {
      enabled: true,
      failurePolicy: "block",
      steps: [
        {
          name: "doctor-pass",
          command: process.execPath,
          args: ["-e", "process.exit(0)"],
        },
      ],
    });

    const result = await restartService(service, registry);
    await writeServiceState(service, result.state);
    const stored = await readStoredState(service.serviceRoot);

    assert.equal(result.ok, true);
    assert.equal(result.state.running, true);
    assert.equal(result.state.runtime.metrics.restartCount, 1);
    assert.deepEqual(stored.recovery.events.map((event) => event.kind), ["doctor", "restart"]);
    assert.equal(stored.recovery.events[0].ok, true);
    assert.equal(stored.recovery.events[1].ok, true);
  } finally {
    await stopAllManagedProcesses();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("restart is blocked when doctor preflight fails with block policy", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-doctor-block-");

  try {
    const { registry, service } = await prepareService(servicesRoot, "doctor-block-service", {
      enabled: true,
      failurePolicy: "block",
      steps: [
        {
          name: "doctor-fail",
          command: process.execPath,
          args: ["-e", "process.exit(7)"],
        },
      ],
    });

    const before = getLifecycleState("doctor-block-service");
    await assert.rejects(
      () => restartService(service, registry),
      /Doctor preflight blocked restart for service "doctor-block-service" at step "doctor-fail"/,
    );
    const after = getLifecycleState("doctor-block-service");
    const stored = await readStoredState(service.serviceRoot);

    assert.equal(after.running, true);
    assert.equal(after.runtime.pid, before.runtime.pid);
    assert.equal(after.runtime.metrics.restartCount, 0);
    assert.equal(stored.recovery.events.length, 1);
    assert.equal(stored.recovery.events[0].kind, "doctor");
    assert.equal(stored.recovery.events[0].blocked, true);
  } finally {
    await stopAllManagedProcesses();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("restart continues when doctor preflight fails with warn policy", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-doctor-warn-");

  try {
    const { registry, service } = await prepareService(servicesRoot, "doctor-warn-service", {
      enabled: true,
      failurePolicy: "warn",
      steps: [
        {
          name: "doctor-warn",
          command: process.execPath,
          args: ["-e", "process.exit(9)"],
        },
      ],
    });

    const result = await restartService(service, registry);
    await writeServiceState(service, result.state);
    const stored = await readStoredState(service.serviceRoot);

    assert.equal(result.ok, true);
    assert.equal(result.state.running, true);
    assert.equal(result.state.runtime.metrics.restartCount, 1);
    assert.deepEqual(stored.recovery.events.map((event) => event.kind), ["doctor", "restart"]);
    assert.equal(stored.recovery.events[0].ok, true);
    assert.equal(stored.recovery.events[0].steps[0].ok, false);
  } finally {
    await stopAllManagedProcesses();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
