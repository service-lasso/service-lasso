import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import { resetLifecycleState, setLifecycleState, getLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { writeServiceUpdateState } from "../dist/runtime/updates/state.js";
import { appendServiceRecoveryHistoryEvents } from "../dist/runtime/recovery/history.js";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";

async function getJson(url) {
  const response = await fetch(url);
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function getDiscoveredService(servicesRoot, serviceId) {
  const services = await discoverServices(servicesRoot);
  const service = services.find((entry) => entry.manifest.id === serviceId);
  assert.ok(service, "Expected discovered service " + serviceId);
  return service;
}

test("operator notifications merge update recovery lifecycle health and diagnostic items safely", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-operator-notifications-");
  await writeExecutableFixtureService(servicesRoot, "update-fixture");
  await writeExecutableFixtureService(servicesRoot, "blocked-fixture", {
    monitoring: { enabled: true },
    restartPolicy: { enabled: true, onCrash: true, maxAttempts: 1 },
  });
  await writeExecutableFixtureService(servicesRoot, "crashed-fixture");
  const updateService = await getDiscoveredService(servicesRoot, "update-fixture");
  const blockedService = await getDiscoveredService(servicesRoot, "blocked-fixture");

  await writeServiceUpdateState(updateService, {
    serviceId: "update-fixture",
    state: "failed",
    updatedAt: "2026-05-20T00:00:00.000Z",
    lastCheck: {
      checkedAt: "2026-05-20T00:00:00.000Z",
      status: "check_failed",
      reason: "password=SECRET_VALUE should never leave update state",
      sourceRepo: "service-lasso/update-fixture",
      track: "latest",
      installedTag: "2026.5.1",
      manifestTag: "2026.5.1",
      latestTag: null,
    },
    available: null,
    downloadedCandidate: null,
    installDeferred: null,
    failed: {
      reason: "password=SECRET_VALUE should never leave update state",
      failedAt: "2026-05-20T00:00:00.000Z",
      sourceStatus: "check_failed",
    },
    hookResults: [],
  });

  await appendServiceRecoveryHistoryEvents(blockedService, [
    {
      kind: "monitor",
      serviceId: "blocked-fixture",
      action: "skip",
      reason: "max_attempts",
      message: "restart token SECRET_VALUE should not be serialized",
      at: "2026-05-20T00:01:00.000Z",
    },
    {
      kind: "monitor",
      serviceId: "blocked-fixture",
      action: "skip",
      reason: "max_attempts",
      message: "newer restart token SECRET_VALUE should not be serialized",
      at: "2026-05-20T00:03:00.000Z",
    },
    {
      kind: "hook",
      serviceId: "blocked-fixture",
      phase: "postInstall",
      ok: false,
      blocked: true,
      at: "2026-05-20T00:02:00.000Z",
      steps: [
        {
          phase: "postInstall",
          name: "blocked-step",
          command: "node safe-script.js",
          ok: false,
          exitCode: 1,
          timedOut: false,
          failurePolicy: "block",
          stdout: "SECRET_VALUE from stdout",
          stderr: "SECRET_VALUE from stderr",
          startedAt: "2026-05-20T00:02:00.000Z",
          finishedAt: "2026-05-20T00:02:01.000Z",
        },
      ],
    },
  ]);

  const crashedState = getLifecycleState("crashed-fixture");
  setLifecycleState("crashed-fixture", {
    ...crashedState,
    installed: true,
    configured: true,
    running: false,
    lastAction: "start",
    actionHistory: ["install", "config", "start"],
    runtime: {
      ...crashedState.runtime,
      exitCode: 7,
      finishedAt: "2026-05-20T00:04:00.000Z",
      lastTermination: "crashed",
      metrics: {
        ...crashedState.runtime.metrics,
        exitCount: 1,
        crashCount: 1,
      },
    },
  });

  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const response = await getJson(apiServer.url + "/api/operator/notifications");
    const serialized = JSON.stringify(response.body);

    assert.equal(response.status, 200);
    assert.equal(response.body.summary.total, response.body.notifications.length);
    assert.equal(response.body.summary.critical >= 2, true);
    assert.equal(serialized.includes("SECRET_VALUE"), false);
    assert.equal(serialized.includes("password="), false);
    assert.equal(serialized.includes("stdout"), false);
    assert.equal(serialized.includes("stderr"), false);

    const byKey = new Map(response.body.notifications.map((item) => [item.dedupeKey, item]));
    assert.equal(byKey.get("update_failed:update-fixture").message, "Update check or install failed for service \"update-fixture\".");
    assert.equal(byKey.get("blocked_start:blocked-fixture").firstSeenAt, "2026-05-20T00:01:00.000Z");
    assert.equal(byKey.get("blocked_start:blocked-fixture").lastSeenAt, "2026-05-20T00:03:00.000Z");
    assert.equal(byKey.get("recovery_review:blocked-fixture").relatedActionEndpoint, "/api/services/blocked-fixture/recovery");
    assert.equal(byKey.get("lifecycle_crashed:crashed-fixture").severity, "critical");
    assert.equal(byKey.get("health_unhealthy:crashed-fixture").kind, "health_unhealthy");
    assert.equal(byKey.get("diagnostic_warning:unhealthy-services").serviceId, null);

    const severities = response.body.notifications.map((item) => item.severity);
    const firstWarningIndex = severities.indexOf("warning");
    const lastCriticalIndex = severities.lastIndexOf("critical");
    assert.equal(firstWarningIndex === -1 || lastCriticalIndex < firstWarningIndex, true);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("operator notifications return update availability and install deferral action endpoints", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-operator-notifications-update-");
  await writeExecutableFixtureService(servicesRoot, "available-fixture");
  await writeExecutableFixtureService(servicesRoot, "deferred-fixture");
  const availableService = await getDiscoveredService(servicesRoot, "available-fixture");
  const deferredService = await getDiscoveredService(servicesRoot, "deferred-fixture");

  await writeServiceUpdateState(availableService, {
    serviceId: "available-fixture",
    state: "available",
    updatedAt: "2026-05-20T00:05:00.000Z",
    lastCheck: null,
    available: {
      tag: "2026.5.20",
      version: "2026.5.20",
      releaseUrl: "https://github.com/service-lasso/available-fixture/releases/tag/2026.5.20",
      publishedAt: "2026-05-20T00:00:00.000Z",
      assetName: "available-fixture.zip",
      assetUrl: "https://github.com/service-lasso/available-fixture/releases/download/2026.5.20/available-fixture.zip",
    },
    downloadedCandidate: null,
    installDeferred: null,
    failed: null,
    hookResults: [],
  });

  await writeServiceUpdateState(deferredService, {
    serviceId: "deferred-fixture",
    state: "installDeferred",
    updatedAt: "2026-05-20T00:06:00.000Z",
    lastCheck: null,
    available: null,
    downloadedCandidate: null,
    installDeferred: {
      reason: "outside maintenance window",
      deferredAt: "2026-05-20T00:06:00.000Z",
      nextEligibleAt: "2026-05-20T02:00:00.000Z",
    },
    failed: null,
    hookResults: [],
  });

  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const response = await getJson(apiServer.url + "/api/operator/notifications");
    const byKey = new Map(response.body.notifications.map((item) => [item.dedupeKey, item]));

    assert.equal(response.status, 200);
    assert.equal(byKey.get("update_available:available-fixture").severity, "info");
    assert.equal(byKey.get("update_available:available-fixture").relatedActionEndpoint, "/api/services/available-fixture/update/download");
    assert.equal(byKey.get("install_deferred:deferred-fixture").severity, "warning");
    assert.equal(byKey.get("install_deferred:deferred-fixture").relatedActionEndpoint, "/api/services/deferred-fixture/update/install");
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
