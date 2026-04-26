import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { stopAllManagedProcesses } from "../dist/runtime/execution/supervisor.js";
import { configService, installService, startService } from "../dist/runtime/lifecycle/actions.js";
import { getLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { createServiceRegistry } from "../dist/runtime/manager/DependencyGraph.js";
import { createRuntimeServiceMonitor } from "../dist/runtime/recovery/monitor.js";
import { rehydrateDiscoveredServices } from "../dist/runtime/state/rehydrate.js";
import { readStoredState } from "../dist/runtime/state/readState.js";
import { writeServiceState } from "../dist/runtime/state/writeState.js";
import { startApiServer } from "../dist/server/index.js";
import { makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";

async function waitFor(readinessCheck, timeoutMs = 2_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const result = await readinessCheck();
    if (result) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error("Timed out waiting for monitor test readiness.");
}

async function prepareRegistry(servicesRoot) {
  const discovered = await discoverServices(servicesRoot);
  await rehydrateDiscoveredServices(discovered);
  return createServiceRegistry(discovered);
}

async function installConfigStart(service, registry) {
  const install = await installService(service, registry);
  await writeServiceState(service, install.state);
  const config = await configService(service, registry);
  await writeServiceState(service, config.state);
  const start = await startService(service, registry);
  await writeServiceState(service, start.state);
}

test("runtime monitor restarts a crashed service when policy allows", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-monitor-crash-");

  try {
    await writeExecutableFixtureService(servicesRoot, "crash-restart-service", {
      autoExitMs: 200,
      exitCode: 2,
      monitoring: {
        enabled: true,
        intervalSeconds: 1,
      },
      restartPolicy: {
        enabled: true,
        onCrash: true,
        maxAttempts: 1,
        backoffSeconds: 0,
      },
    });

    const registry = await prepareRegistry(servicesRoot);
    const service = registry.getById("crash-restart-service");
    assert.ok(service);
    await installConfigStart(service, registry);

    await waitFor(() => getLifecycleState("crash-restart-service").runtime.lastTermination === "crashed");

    const monitor = createRuntimeServiceMonitor({
      registry,
      logger: { log: () => undefined, warn: () => undefined },
    });
    const events = await monitor.runOnce();
    const event = events.find((entry) => entry.serviceId === "crash-restart-service");

    assert.equal(event?.action, "restart");
    assert.equal(event?.reason, "crashed");
    assert.equal(getLifecycleState("crash-restart-service").running, true);
    assert.equal(getLifecycleState("crash-restart-service").runtime.metrics.restartCount, 1);
    const stored = await readStoredState(service.serviceRoot);
    assert.equal(stored.recovery.events.at(-1).kind, "monitor");
    assert.equal(stored.recovery.events.at(-1).reason, "crashed");
  } finally {
    await stopAllManagedProcesses();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runtime monitor skips restart when maxAttempts is already exhausted", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-monitor-max-");

  try {
    await writeExecutableFixtureService(servicesRoot, "max-attempt-service", {
      autoExitMs: 100,
      exitCode: 2,
      monitoring: {
        enabled: true,
      },
      restartPolicy: {
        enabled: true,
        onCrash: true,
        maxAttempts: 0,
      },
    });

    const registry = await prepareRegistry(servicesRoot);
    const service = registry.getById("max-attempt-service");
    assert.ok(service);
    await installConfigStart(service, registry);

    await waitFor(() => getLifecycleState("max-attempt-service").runtime.lastTermination === "crashed");

    const monitor = createRuntimeServiceMonitor({
      registry,
      logger: { log: () => undefined, warn: () => undefined },
    });
    const events = await monitor.runOnce();
    const event = events.find((entry) => entry.serviceId === "max-attempt-service");

    assert.equal(event?.action, "skip");
    assert.equal(event?.reason, "max_attempts");
    assert.equal(getLifecycleState("max-attempt-service").running, false);
    const stored = await readStoredState(service.serviceRoot);
    assert.equal(stored.recovery.events.at(-1).kind, "monitor");
    assert.equal(stored.recovery.events.at(-1).reason, "max_attempts");
  } finally {
    await stopAllManagedProcesses();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("API server can start and stop the opt-in runtime monitor cleanly", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-monitor-server-");
  const apiServer = await startApiServer({
    port: 0,
    servicesRoot,
    monitor: true,
    monitorIntervalMs: 10,
  });

  try {
    assert.ok(apiServer.monitor);
  } finally {
    await apiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
