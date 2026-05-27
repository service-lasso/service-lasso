import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { createServiceRegistry } from "../dist/runtime/manager/DependencyGraph.js";
import { buildServiceCompatibilityReport } from "../dist/runtime/operator/catalog-compatibility.js";
import { startApiServer } from "../dist/server/index.js";

async function writeManifest(servicesRoot, serviceId, body) {
  const serviceRoot = path.join(servicesRoot, serviceId);
  await mkdir(serviceRoot, { recursive: true });
  await writeFile(path.join(serviceRoot, "service.json"), JSON.stringify(body, null, 2));
}

async function loadRegistry(servicesRoot) {
  const services = await discoverServices(servicesRoot);
  return { services, registry: createServiceRegistry(services) };
}

function createUpdateState(serviceId, lastCheck) {
  return {
    serviceId,
    state: lastCheck.status === "update_available" ? "available" : "installed",
    updatedAt: lastCheck.checkedAt,
    lastCheck,
    available: null,
    downloadedCandidate: null,
    installDeferred: null,
    failed: null,
    hookResults: [],
  };
}

test("service compatibility report classifies supported platform providers and ports", async () => {
  const servicesRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-compat-ok-"));

  try {
    await writeManifest(servicesRoot, "@node", {
      id: "@node",
      name: "Node Runtime",
      description: "Runtime provider",
      role: "provider",
    });
    await writeManifest(servicesRoot, "web-service", {
      id: "web-service",
      name: "Web Service",
      description: "Service with declared runtime requirements.",
      execservice: "@node",
      ports: {
        service: 43100,
      },
      artifact: {
        kind: "archive",
        source: {
          type: "github-release",
          repo: "service-lasso/web-service",
          tag: "2026.1.1-test",
        },
        platforms: {
          default: {
            assetName: "web-service.zip",
            archiveType: "zip",
          },
        },
      },
    });
    const { services, registry } = await loadRegistry(servicesRoot);
    const service = services.find((candidate) => candidate.manifest.id === "web-service");

    const report = buildServiceCompatibilityReport(service, registry, { hostPlatform: "linux" });

    assert.equal(report.status, "compatible");
    assert.deepEqual(report.supportedPlatforms, ["default"]);
    assert.deepEqual(report.requiredProviders, ["@node"]);
    assert.deepEqual(report.requiredPorts, [{ name: "service", port: 43100 }]);
    assert.ok(
      report.requirements.some((requirement) => requirement.kind === "provider" && requirement.status === "satisfied"),
    );
  } finally {
    await rm(servicesRoot, { recursive: true, force: true });
  }
});

test("service compatibility report identifies platform mismatch and missing providers", async () => {
  const servicesRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-compat-blocked-"));

  try {
    await writeManifest(servicesRoot, "blocked-service", {
      id: "blocked-service",
      name: "Blocked Service",
      description: "Service with unsupported host and missing provider.",
      execservice: "@python",
      artifact: {
        kind: "archive",
        source: {
          type: "github-release",
          repo: "service-lasso/blocked-service",
          tag: "2026.1.1-test",
        },
        platforms: {
          win32: {
            assetName: "blocked-service-win32.zip",
            archiveType: "zip",
          },
        },
      },
    });
    const { services, registry } = await loadRegistry(servicesRoot);

    const report = buildServiceCompatibilityReport(services[0], registry, { hostPlatform: "linux" });

    assert.equal(report.status, "unsupported");
    assert.ok(report.blockers.some((blocker) => blocker.includes("Host platform")));
    assert.ok(report.blockers.some((blocker) => blocker.includes("@python")));
    assert.ok(report.requirements.some((requirement) => requirement.kind === "provider" && requirement.status === "missing"));
  } finally {
    await rm(servicesRoot, { recursive: true, force: true });
  }
});

test("service compatibility report does not warn when pinned release metadata is current", async () => {
  const servicesRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-compat-release-current-"));

  try {
    await writeManifest(servicesRoot, "current-service", {
      id: "current-service",
      name: "Current Service",
      description: "Service pinned to the tracked release.",
      artifact: {
        kind: "archive",
        source: {
          type: "github-release",
          repo: "service-lasso/current-service",
          tag: "2026.5.20-current",
        },
        platforms: {
          default: {
            assetName: "current-service.zip",
            archiveType: "zip",
          },
        },
      },
    });
    const { services, registry } = await loadRegistry(servicesRoot);

    const report = buildServiceCompatibilityReport(services[0], registry, {
      updateState: createUpdateState("current-service", {
        checkedAt: "2026-05-20T00:00:00.000Z",
        status: "latest",
        reason: "Installed release tag matches the tracked release.",
        sourceRepo: "service-lasso/current-service",
        track: "latest",
        installedTag: null,
        manifestTag: "2026.5.20-current",
        latestTag: "2026.5.20-current",
      }),
    });

    assert.deepEqual(report.warnings, []);
  } finally {
    await rm(servicesRoot, { recursive: true, force: true });
  }
});

test("service compatibility report warns when catalog release metadata is stale", async () => {
  const servicesRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-compat-release-stale-"));

  try {
    await writeManifest(servicesRoot, "stale-service", {
      id: "stale-service",
      name: "Stale Service",
      description: "Service pinned behind the tracked release.",
      artifact: {
        kind: "archive",
        source: {
          type: "github-release",
          repo: "service-lasso/stale-service",
          tag: "2026.5.10-old",
        },
        platforms: {
          default: {
            assetName: "stale-service.zip",
            archiveType: "zip",
          },
        },
      },
    });
    const { services, registry } = await loadRegistry(servicesRoot);

    const report = buildServiceCompatibilityReport(services[0], registry, {
      updateState: createUpdateState("stale-service", {
        checkedAt: "2026-05-20T00:00:00.000Z",
        status: "update_available",
        reason: "Tracked release differs from the installed release tag.",
        sourceRepo: "service-lasso/stale-service",
        track: "latest",
        installedTag: null,
        manifestTag: "2026.5.10-old",
        latestTag: "2026.5.20-current",
      }),
    });

    assert.equal(report.status, "compatible");
    assert.equal(report.warnings.length, 1);
    assert.equal(report.warnings[0].kind, "release-stale");
    assert.equal(report.warnings[0].sourceRepo, "service-lasso/stale-service");
    assert.equal(report.warnings[0].manifestTag, "2026.5.10-old");
    assert.equal(report.warnings[0].latestTag, "2026.5.20-current");
  } finally {
    await rm(servicesRoot, { recursive: true, force: true });
  }
});

test("service compatibility report warns when latest release metadata is unavailable", async () => {
  const servicesRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-compat-release-unavailable-"));

  try {
    await writeManifest(servicesRoot, "unavailable-service", {
      id: "unavailable-service",
      name: "Unavailable Service",
      description: "Service with unavailable release metadata.",
      artifact: {
        kind: "archive",
        source: {
          type: "github-release",
          repo: "service-lasso/unavailable-service",
          tag: "2026.5.10-old",
        },
        platforms: {
          default: {
            assetName: "unavailable-service.zip",
            archiveType: "zip",
          },
        },
      },
    });
    const { services, registry } = await loadRegistry(servicesRoot);

    const report = buildServiceCompatibilityReport(services[0], registry, {
      updateState: createUpdateState("unavailable-service", {
        checkedAt: "2026-05-20T00:00:00.000Z",
        status: "check_failed",
        reason: "500 Internal Server Error",
        sourceRepo: "service-lasso/unavailable-service",
        track: "latest",
        installedTag: null,
        manifestTag: "2026.5.10-old",
        latestTag: null,
      }),
    });

    assert.equal(report.status, "compatible");
    assert.equal(report.warnings.length, 1);
    assert.equal(report.warnings[0].kind, "release-metadata-unavailable");
    assert.match(report.warnings[0].detail, /500 Internal Server Error/);
  } finally {
    await rm(servicesRoot, { recursive: true, force: true });
  }
});

test("GET /api/services includes read-only compatibility metadata", async () => {
  const servicesRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-compat-api-"));

  try {
    await writeManifest(servicesRoot, "api-service", {
      id: "api-service",
      name: "API Service",
      description: "Service exposed through the service catalog API.",
      ports: {
        api: 43110,
      },
    });
    const apiServer = await startApiServer({ port: 0, servicesRoot });

    try {
      const response = await fetch(`${apiServer.url}/api/services`);
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.services[0].compatibility.status, "compatible");
      assert.equal(body.services[0].compatibility.hostPlatform, process.platform);
      assert.deepEqual(body.services[0].compatibility.requiredPorts, [{ name: "api", port: 43110 }]);
      assert.deepEqual(body.services[0].compatibility.blockers, []);
    } finally {
      await apiServer.stop();
    }
  } finally {
    await rm(servicesRoot, { recursive: true, force: true });
  }
});
