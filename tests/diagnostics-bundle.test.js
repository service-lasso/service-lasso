import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import {
  buildDiagnosticsBundle,
  writeDiagnosticsBundleFolder,
} from "../dist/runtime/diagnostics/bundle.js";
import { getServiceRuntimeLogPaths } from "../dist/runtime/operator/logs.js";
import { startApiServer } from "../dist/server/index.js";
import {
  assertNoSecretMaterial,
  serviceLassoSecretLeakSentinels,
} from "../dist/testing/secretLeakHarness.js";
import { makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";

async function writeSecretBearingRuntimeLog(serviceRoot) {
  const logPaths = getServiceRuntimeLogPaths(serviceRoot);
  await mkdir(path.dirname(logPaths.logPath), { recursive: true });
  await writeFile(
    logPaths.logPath,
    JSON.stringify({
      level: "stdout",
      message:
        "token=" +
        serviceLassoSecretLeakSentinels[0].value +
        " Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456",
    }) + "\n",
  );
}

test("diagnostics bundle exports baseline shape without secret material", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-diagnostics-");
  try {
    const { serviceRoot } = await writeExecutableFixtureService(servicesRoot, "alpha-service", {
      env: {
        SERVICE_TOKEN: serviceLassoSecretLeakSentinels[0].value,
      },
      globalenv: {
        SERVICE_PASSWORD: serviceLassoSecretLeakSentinels[1].value,
      },
      ports: {
        http: 17001,
      },
    });
    await writeSecretBearingRuntimeLog(serviceRoot);

    const bundle = await buildDiagnosticsBundle({
      servicesRoot,
      workspaceRoot: path.join(tempRoot, "workspace"),
      version: "test-version",
      generatedAt: "2026-05-22T00:00:00.000Z",
    });
    const outputPath = await writeDiagnosticsBundleFolder(bundle, path.join(tempRoot, "bundle"));
    const serialized = await readFile(path.join(outputPath, "manifest.json"), "utf8");

    assert.equal(bundle.scope.kind, "baseline");
    assert.equal(bundle.runtime.serviceCount, 1);
    assert.deepEqual(bundle.services[0].manifest.envKeys, ["FIXTURE_EXIT_CODE", "SERVICE_TOKEN"]);
    assert.deepEqual(bundle.services[0].manifest.globalenvKeys, ["SERVICE_PASSWORD"]);
    assert.match(serialized, /\[REDACTED\]/);
    assertNoSecretMaterial(bundle);
    assertNoSecretMaterial(serialized);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("diagnostics bundle can target a single service", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-diagnostics-single-");
  try {
    await writeExecutableFixtureService(servicesRoot, "alpha-service");
    await writeExecutableFixtureService(servicesRoot, "beta-service");

    const bundle = await buildDiagnosticsBundle({
      servicesRoot,
      workspaceRoot: path.join(tempRoot, "workspace"),
      serviceId: "beta-service",
      generatedAt: "2026-05-22T00:00:00.000Z",
    });

    assert.equal(bundle.scope.kind, "service");
    assert.equal(bundle.scope.serviceId, "beta-service");
    assert.deepEqual(bundle.services.map((service) => service.serviceId), ["beta-service"]);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("diagnostics bundle API returns redacted baseline evidence", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-diagnostics-api-");
  let apiServer;
  try {
    await writeExecutableFixtureService(servicesRoot, "api-service", {
      env: {
        SERVICE_TOKEN: serviceLassoSecretLeakSentinels[0].value,
      },
    });

    apiServer = await startApiServer({
      port: 0,
      servicesRoot,
      workspaceRoot: path.join(tempRoot, "workspace"),
      version: "test-version",
    });

    const response = await fetch(apiServer.url + "/api/diagnostics/bundle");
    assert.equal(response.status, 200);
    const body = await response.json();

    assert.equal(body.scope.kind, "baseline");
    assert.equal(body.runtime.serviceCount, 1);
    assertNoSecretMaterial(body);
  } finally {
    await apiServer?.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
