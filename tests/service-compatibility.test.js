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
