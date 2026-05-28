import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { configService, installService } from "../dist/runtime/lifecycle/actions.js";
import { getLifecycleState, setLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { createServiceRegistry } from "../dist/runtime/manager/DependencyGraph.js";
import { buildRestartSafetyPreflightReport } from "../dist/runtime/operator/restart-safety-preflight.js";
import { rehydrateDiscoveredServices } from "../dist/runtime/state/rehydrate.js";
import { makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";

async function installAndConfig(registry, serviceId) {
  const service = registry.getById(serviceId);
  assert.ok(service);
  const install = await installService(service, registry);
  setLifecycleState(serviceId, install.state);
  const config = await configService(service, registry);
  setLifecycleState(serviceId, config.state);
  return service;
}

test("restart safety preflight reports ready dependencies, provider ref, doctor requirement, and dependent restart risk", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-restart-preflight-ready-");

  try {
    await writeExecutableFixtureService(servicesRoot, "@node", { role: "provider" });
    await writeExecutableFixtureService(servicesRoot, "database");
    await writeExecutableFixtureService(servicesRoot, "api", {
      depend_on: ["database"],
      execservice: "@node",
      doctor: {
        enabled: true,
        failurePolicy: "block",
        steps: [
          {
            name: "dependency-change-check",
            command: process.execPath,
            args: ["-e", "process.exit(0)"],
          },
        ],
      },
    });
    await writeExecutableFixtureService(servicesRoot, "web", {
      depend_on: ["api"],
    });

    const discovered = await discoverServices(servicesRoot);
    await rehydrateDiscoveredServices(discovered);
    const registry = createServiceRegistry(discovered);

    await installAndConfig(registry, "@node");
    await installAndConfig(registry, "database");
    const api = await installAndConfig(registry, "api");
    await installAndConfig(registry, "web");
    setLifecycleState("web", {
      ...getLifecycleState("web"),
      running: true,
      runtime: {
        ...getLifecycleState("web").runtime,
        pid: 12345,
      },
    });

    const report = buildRestartSafetyPreflightReport(api, registry);

    assert.equal(report.action, "restart-preflight");
    assert.equal(report.ok, true);
    assert.equal(report.status, "warning");
    assert.equal(report.dryRun, true);
    assert.equal(report.mutated, false);
    assert.deepEqual(report.dependencyGraph.dependencies, ["database"]);
    assert.deepEqual(report.dependencyGraph.startupOrder, ["database"]);
    assert.equal(report.providerRef.serviceId, "@node");
    assert.equal(report.providerRef.status, "available");
    assert.equal(report.doctorRequirement.required, true);
    assert.equal(report.doctorRequirement.stepCount, 1);
    assert.equal(report.restartOrderRisk.level, "dependent_restart_recommended");
    assert.deepEqual(report.restartOrderRisk.stopBeforeTarget, ["web"]);
    assert.equal(report.dependencyGraph.dependents[0].serviceId, "web");
    assert.equal(report.dependencyGraph.dependents[0].running, true);
    assert.doesNotMatch(JSON.stringify(report), /BEGIN PRIVATE KEY|Bearer\s+\S+|ACTUAL_SECRET|client_secret[:=]|password[:=]/i);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("restart safety preflight blocks missing dependencies and provider refs", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-restart-preflight-blocked-");

  try {
    await writeExecutableFixtureService(servicesRoot, "blocked-api", {
      depend_on: ["missing-database"],
      execservice: "missing-provider",
    });
    const discovered = await discoverServices(servicesRoot);
    await rehydrateDiscoveredServices(discovered);
    const registry = createServiceRegistry(discovered);
    const api = registry.getById("blocked-api");
    assert.ok(api);

    const report = buildRestartSafetyPreflightReport(api, registry);
    const blockerCodes = report.blockers.map((blocker) => blocker.code).sort();

    assert.equal(report.ok, false);
    assert.equal(report.status, "blocked");
    assert.equal(report.restartOrderRisk.level, "blocked");
    assert.deepEqual(report.dependencyGraph.missingDependencies, ["missing-database"]);
    assert.ok(blockerCodes.includes("dependency_missing"));
    assert.ok(blockerCodes.includes("provider_missing"));
    assert.ok(blockerCodes.includes("service_not_installed"));
    assert.ok(blockerCodes.includes("service_not_configured"));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
