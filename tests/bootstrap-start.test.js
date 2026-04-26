import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { rm } from "node:fs/promises";
import { bootstrapBaselineServices } from "../dist/runtime/cli/bootstrap.js";
import { stopAllManagedProcesses } from "../dist/runtime/execution/supervisor.js";
import { getLifecycleState, resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";

test("bootstrapBaselineServices installs, configures, and starts baseline services in dependency order", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-baseline-start-");
  const workspaceRoot = path.join(tempRoot, "workspace");

  try {
    await writeExecutableFixtureService(servicesRoot, "@traefik", {
      install: { files: [{ path: "./runtime/install.txt", content: "installed ${SERVICE_ID}\n" }] },
      config: { files: [{ path: "./runtime/config.txt", content: "configured ${SERVICE_ID}\n" }] },
    });
    await writeExecutableFixtureService(servicesRoot, "@node");
    await writeExecutableFixtureService(servicesRoot, "echo-service", {
      depend_on: ["@node", "@traefik"],
    });
    await writeExecutableFixtureService(servicesRoot, "service-admin", {
      depend_on: ["@node"],
    });

    const result = await bootstrapBaselineServices({
      servicesRoot,
      workspaceRoot,
      version: "test-version",
    });

    assert.deepEqual(result.requestedServiceIds, ["@traefik", "@node", "echo-service", "service-admin"]);
    assert.deepEqual(result.serviceOrder, ["@node", "@traefik", "echo-service", "service-admin"]);
    assert.equal(result.services.length, 4);

    for (const service of result.services) {
      assert.equal(service.status, "completed");
      assert.deepEqual(
        service.actions.map((action) => `${action.action}:${action.status}`),
        ["install:completed", "config:completed", "start:completed"],
      );
      const state = getLifecycleState(service.serviceId);
      assert.equal(state.installed, true, `${service.serviceId} installed`);
      assert.equal(state.configured, true, `${service.serviceId} configured`);
      assert.equal(state.running, true, `${service.serviceId} running`);
    }

    const rerun = await bootstrapBaselineServices({
      servicesRoot,
      workspaceRoot,
      version: "test-version",
    });

    for (const service of rerun.services) {
      assert.deepEqual(
        service.actions.map((action) => `${action.action}:${action.status}`),
        ["install:skipped", "config:skipped", "start:skipped"],
      );
    }
  } finally {
    await stopAllManagedProcesses();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("bootstrapBaselineServices skips managed start for provider-role baseline services", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-baseline-provider-");
  const workspaceRoot = path.join(tempRoot, "workspace");

  try {
    await writeExecutableFixtureService(servicesRoot, "@traefik", {
      install: { files: [{ path: "./runtime/install.txt", content: "installed ${SERVICE_ID}\n" }] },
      config: { files: [{ path: "./runtime/config.txt", content: "configured ${SERVICE_ID}\n" }] },
    });
    await writeExecutableFixtureService(servicesRoot, "@node", {
      role: "provider",
      healthcheck: null,
    });
    await writeExecutableFixtureService(servicesRoot, "echo-service", {
      depend_on: ["@node", "@traefik"],
    });
    await writeExecutableFixtureService(servicesRoot, "service-admin", {
      depend_on: ["@node"],
    });

    const result = await bootstrapBaselineServices({
      servicesRoot,
      workspaceRoot,
      version: "test-version",
    });
    const node = result.services.find((service) => service.serviceId === "@node");

    assert.ok(node);
    assert.deepEqual(
      node.actions.map((action) => `${action.action}:${action.status}`),
      ["install:completed", "config:completed", "start:skipped"],
    );
    assert.match(node.actions.at(-1)?.message ?? "", /Provider role/);
    assert.equal(node.state.installed, true);
    assert.equal(node.state.configured, true);
    assert.equal(node.state.running, false);
    assert.equal(result.services.find((service) => service.serviceId === "service-admin")?.state.running, true);
  } finally {
    await stopAllManagedProcesses();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
