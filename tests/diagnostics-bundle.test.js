import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import {
  buildDiagnosticsBundle,
  writeDiagnosticsBundleFolder,
} from "../dist/runtime/diagnostics/bundle.js";
import { getServiceRuntimeLogPaths } from "../dist/runtime/operator/logs.js";
import { getServiceStatePaths } from "../dist/runtime/state/paths.js";
import { startApiServer } from "../dist/server/index.js";
import {
  assertNoSecretMaterial,
  serviceLassoSecretLeakSentinels,
} from "../dist/testing/secretLeakHarness.js";
import { makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";

const execFile = promisify(execFileCallback);

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

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function runCli(args, cwd = path.resolve(".")) {
  const cliPath = path.join(cwd, "dist", "cli.js");
  const result = await execFile(process.execPath, [cliPath, ...args], {
    cwd,
    env: {
      ...process.env,
      npm_package_version: "0.1.0-test",
    },
  });

  return result.stdout.trim();
}

async function writeHealthHistory(serviceRoot, serviceId, transitions) {
  const statePaths = getServiceStatePaths(serviceRoot);
  await mkdir(statePaths.stateRoot, { recursive: true });
  await writeFile(
    statePaths.health,
    JSON.stringify({
      serviceId,
      updatedAt: "2026-05-22T00:04:00.000Z",
      transitions,
    }, null, 2),
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

test("diagnostics bundle includes compact health regression summary", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-diagnostics-health-");
  try {
    const { serviceRoot: alphaRoot } = await writeExecutableFixtureService(servicesRoot, "alpha-service");
    const { serviceRoot: betaRoot } = await writeExecutableFixtureService(servicesRoot, "beta-service");

    await writeHealthHistory(alphaRoot, "alpha-service", [
      {
        serviceId: "alpha-service",
        status: "healthy",
        checkType: "process",
        observed: { type: "process" },
        reason: "healthcheck_passed",
        detail: "started",
        at: "2026-05-22T00:00:00.000Z",
      },
      {
        serviceId: "alpha-service",
        status: "unhealthy",
        checkType: "http",
        observed: { type: "http", url: "https://user:secret@example.invalid/health?token=keep-out" },
        reason: "healthcheck_failed",
        detail: "failed with SERVICE_LASSO_FAKE_SECRET_SENTINEL_ALPHA_DO_NOT_USE",
        at: "2026-05-22T00:01:00.000Z",
      },
      {
        serviceId: "alpha-service",
        status: "healthy",
        checkType: "http",
        observed: { type: "http", url: "https://example.invalid/health" },
        reason: "healthcheck_passed",
        detail: "recovered",
        at: "2026-05-22T00:02:00.000Z",
      },
    ]);
    await writeHealthHistory(betaRoot, "beta-service", [
      {
        serviceId: "beta-service",
        status: "healthy",
        checkType: "process",
        observed: { type: "process" },
        reason: "healthcheck_passed",
        detail: "stable",
        at: "2026-05-22T00:03:00.000Z",
      },
    ]);

    const bundle = await buildDiagnosticsBundle({
      servicesRoot,
      workspaceRoot: path.join(tempRoot, "workspace"),
      generatedAt: "2026-05-22T00:05:00.000Z",
    });

    assert.equal(bundle.healthRegression.serviceCount, 2);
    assert.deepEqual(bundle.healthRegression.impactedServiceIds, ["alpha-service"]);
    assert.equal(bundle.healthRegression.flappingCount, 2);
    assert.equal(bundle.healthRegression.firstFailure?.serviceId, "alpha-service");
    assert.equal(bundle.healthRegression.firstFailure?.observed.url, "https://example.invalid/health");
    assert.equal(bundle.healthRegression.latestState?.serviceId, "beta-service");

    const alphaSummary = bundle.services.find((service) => service.serviceId === "alpha-service")?.healthRegression;
    assert.equal(alphaSummary?.transitionCount, 3);
    assert.equal(alphaSummary?.flappingCount, 2);
    assert.equal(alphaSummary?.impacted, true);
    assert.equal(alphaSummary?.latestState?.status, "healthy");
    assertNoSecretMaterial(bundle.healthRegression);
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

test("CLI diagnostics bundle preview reports scope decisions without writing bundle or leaking secrets", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-diagnostics-cli-preview-");
  const workspaceRoot = path.join(tempRoot, "workspace");
  try {
    const { serviceRoot } = await writeExecutableFixtureService(servicesRoot, "alpha-service", {
      env: {
        SERVICE_TOKEN: serviceLassoSecretLeakSentinels[0].value,
      },
      globalenv: {
        SERVICE_PASSWORD: serviceLassoSecretLeakSentinels[1].value,
      },
    });
    await writeSecretBearingRuntimeLog(serviceRoot);

    const stdout = await runCli([
      "diagnostics",
      "bundle",
      "baseline",
      "--preview",
      "--services-root",
      servicesRoot,
      "--workspace-root",
      workspaceRoot,
      "--json",
    ]);
    const preview = JSON.parse(stdout);
    const serialized = JSON.stringify(preview);

    assert.equal(preview.action, "bundle-preview");
    assert.equal(preview.mutated, false);
    assert.equal(preview.output.wouldWriteBundle, false);
    assert.deepEqual(preview.output.files.map((file) => file.path), [
      "manifest.json",
      "services/alpha-service/summary.json",
      "services/alpha-service/logs.json",
    ]);
    assert.equal(preview.services[0].includedFields.includes("manifest.envKeys"), true);
    assert.equal(preview.services[0].redactions.some((entry) => entry.surface === "manifest.env" && entry.action === "keys-only"), true);
    assert.equal(preview.services[0].logSegments.some((entry) => entry.type === "service" && entry.includedLines === 1), true);
    assert.equal(await pathExists(path.join(tempRoot, "bundle")), false);
    assertNoSecretMaterial(preview);
    assert.doesNotMatch(serialized, /abcdefghijklmnopqrstuvwxyz123456|SERVICE_LASSO_FAKE_SECRET_SENTINEL/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
