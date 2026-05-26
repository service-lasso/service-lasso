import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, rm, unlink, writeFile } from "node:fs/promises";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { createServiceRegistry } from "../dist/runtime/manager/DependencyGraph.js";
import { installService, configService } from "../dist/runtime/lifecycle/actions.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { buildServiceConfigDriftReport } from "../dist/runtime/operator/config-drift.js";
import { runConfigDriftCliAction } from "../dist/runtime/cli/config-drift.js";
import { startApiServer } from "../dist/server/index.js";
import { makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";

async function prepareService(servicesRoot, serviceId, configFiles, env = {}) {
  await writeExecutableFixtureService(servicesRoot, serviceId, {
    env,
    config: {
      files: configFiles,
    },
  });
  const discovered = await discoverServices(servicesRoot);
  const registry = createServiceRegistry(discovered);
  const service = registry.getById(serviceId);
  assert.ok(service);
  await installService(service, registry);
  await configService(service, registry);
  return { service, registry };
}

test("config drift reports unchanged materialized config files", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-config-drift-clean-");

  try {
    const { service, registry } = await prepareService(servicesRoot, "clean-config-service", [
      { path: "runtime/app.conf", content: "mode=local\nport=${SERVICE_PORT}\n" },
    ]);

    const report = await buildServiceConfigDriftReport(service, registry.list());

    assert.equal(report.summary.total, 1);
    assert.equal(report.summary.drifted, 0);
    assert.equal(report.files[0].status, "unchanged");
    assert.equal(report.files[0].desiredPreview, undefined);
    assert.equal(report.files[0].currentPreview, undefined);
  } finally {
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("config drift reports changed and missing files without leaking secret values", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-config-drift-redact-");
  const rawDesiredToken = "raw-desired-token";
  const rawCurrentToken = "raw-current-token";

  try {
    const { service, registry } = await prepareService(
      servicesRoot,
      "drift-config-service",
      [
        { path: "runtime/app.json", content: "{\"apiToken\":\"${API_TOKEN}\",\"safe\":\"ok\"}\n" },
        { path: "runtime/missing.env", content: "PUBLIC_VALUE=yes\n" },
      ],
      { API_TOKEN: rawDesiredToken },
    );

    await writeFile(path.join(service.serviceRoot, "runtime", "app.json"), "{\"apiToken\":\"" + rawCurrentToken + "\",\"safe\":\"changed\"}\n");
    await unlink(path.join(service.serviceRoot, "runtime", "missing.env"));

    const report = await buildServiceConfigDriftReport(service, registry.list());
    const serialized = JSON.stringify(report);

    assert.equal(report.summary.changed, 1);
    assert.equal(report.summary.missing, 1);
    assert.equal(report.files.find((file) => file.path === "runtime/app.json")?.status, "changed");
    assert.equal(report.files.find((file) => file.path === "runtime/missing.env")?.status, "missing");
    assert.equal(serialized.includes(rawDesiredToken), false);
    assert.equal(serialized.includes(rawCurrentToken), false);
    assert.ok(serialized.includes("[redacted]"));
  } finally {
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("config drift reports unmanaged files from previous config state", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-config-drift-unmanaged-");

  try {
    const { service, registry } = await prepareService(servicesRoot, "unmanaged-config-service", [
      { path: "runtime/old.conf", content: "old=true\n" },
    ]);
    service.manifest.config = { files: [] };

    const report = await buildServiceConfigDriftReport(service, registry.list());

    assert.equal(report.summary.unmanaged, 1);
    assert.equal(report.files[0].path, "runtime/old.conf");
    assert.equal(report.files[0].status, "unmanaged");
  } finally {
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("config drift is exposed through API and CLI read-only surfaces", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-config-drift-api-");
  const workspaceRoot = path.join(tempRoot, "workspace");

  try {
    await mkdir(workspaceRoot, { recursive: true });
    await writeExecutableFixtureService(servicesRoot, "api-config-service", {
      config: {
        files: [{ path: "runtime/app.conf", content: "mode=api\n" }],
      },
    });
    const apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot });

    try {
      await fetch(apiServer.url + "/api/services/api-config-service/install", { method: "POST" });
      await fetch(apiServer.url + "/api/services/api-config-service/config", { method: "POST" });

      const response = await fetch(apiServer.url + "/api/services/api-config-service/config-drift");
      const body = await response.json();
      const cli = await runConfigDriftCliAction({ servicesRoot, workspaceRoot, serviceId: "api-config-service" });

      assert.equal(response.status, 200);
      assert.equal(body.drift.serviceId, "api-config-service");
      assert.equal(body.drift.summary.drifted, 0);
      assert.equal(cli.services.length, 1);
      assert.equal(cli.services[0].summary.drifted, 0);
    } finally {
      await apiServer.stop();
    }
  } finally {
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
