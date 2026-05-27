import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { rm } from "node:fs/promises";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { createServiceRegistry } from "../dist/runtime/manager/DependencyGraph.js";
import { installService } from "../dist/runtime/lifecycle/actions.js";
import { getLifecycleState, resetLifecycleState, setLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { buildConfigApplyPreflightReport } from "../dist/runtime/operator/config-apply-preflight.js";
import { runConfigApplyCliAction } from "../dist/runtime/cli/config-apply.js";
import { makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";

async function prepareRegistry(servicesRoot) {
  const discovered = await discoverServices(servicesRoot);
  return createServiceRegistry(discovered);
}

test("config apply preflight allows installed config that would create files", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-config-apply-allowed-");

  try {
    await writeExecutableFixtureService(servicesRoot, "allowed-config-service", {
      config: {
        files: [{ path: "runtime/app.conf", content: "mode=local\n" }],
      },
    });
    const registry = await prepareRegistry(servicesRoot);
    const service = registry.getById("allowed-config-service");
    assert.ok(service);
    await installService(service, registry);

    const report = await buildConfigApplyPreflightReport(registry, "allowed-config-service");

    assert.equal(report.ok, true);
    assert.equal(report.mutated, false);
    assert.equal(report.summary.allowed, 1);
    assert.equal(report.services[0].status, "allowed");
    assert.equal(report.services[0].configDrift?.summary.missing, 1);
    assert.equal(report.services[0].secretRefChanges.count, 0);
  } finally {
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("config apply preflight warns when running config would change and unsupported fields exist", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-config-apply-warning-");

  try {
    await writeExecutableFixtureService(servicesRoot, "warning-config-service", {
      config: {
        files: [{ path: "runtime/app.conf", content: "mode=changed\n" }],
        template: "unsupported",
      },
    });
    const registry = await prepareRegistry(servicesRoot);
    const service = registry.getById("warning-config-service");
    assert.ok(service);
    await installService(service, registry);
    const currentState = getLifecycleState("warning-config-service");
    setLifecycleState("warning-config-service", {
      ...currentState,
      installed: true,
      configured: true,
      running: true,
    });

    const report = await buildConfigApplyPreflightReport(registry, "warning-config-service");

    assert.equal(report.ok, true);
    assert.equal(report.summary.warning, 1);
    assert.equal(report.services[0].restartRequirement.required, true);
    assert.deepEqual(report.services[0].unsupportedFields, [
      {
        location: "config.template",
        reason: "The config apply preflight only supports config.files in this slice.",
      },
    ]);
    assert.ok(report.services[0].policyGates.some((gate) => gate.gate === "restart" && gate.status === "warning"));
  } finally {
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("config apply preflight blocks missing required secret refs without leaking values", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-config-apply-blocked-");
  const rawSecretValue = "super-secret-token";

  try {
    await writeExecutableFixtureService(servicesRoot, "blocked-config-service", {
      env: {
        API_TOKEN: rawSecretValue,
      },
      config: {
        files: [{ path: "runtime/app.conf", content: "token=${missing.token}\n" }],
      },
    });
    const registry = await prepareRegistry(servicesRoot);
    const service = registry.getById("blocked-config-service");
    assert.ok(service);
    await installService(service, registry);

    const report = await runConfigApplyCliAction({
      action: "preflight",
      servicesRoot,
      workspaceRoot: path.join(tempRoot, "workspace"),
      serviceId: "blocked-config-service",
    });
    const serialized = JSON.stringify(report);

    assert.equal(report.ok, false);
    assert.equal(report.summary.blocked, 1);
    assert.equal(report.services[0].secretRefChanges.refs[0].ref, "missing.token");
    assert.equal(report.services[0].secretRefChanges.refs[0].status, "missing");
    assert.equal(serialized.includes(rawSecretValue), false);
    assert.equal(serialized.includes("super-secret-token"), false);
  } finally {
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
