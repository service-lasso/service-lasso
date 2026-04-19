import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { loadServiceManifest } from "../dist/runtime/discovery/loadManifest.js";
import { startApiServer } from "../dist/server/index.js";

async function makeTempServicesRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "service-lasso-services-"));
  return root;
}

async function writeManifest(servicesRoot, serviceId, body) {
  const serviceRoot = path.join(servicesRoot, serviceId);
  await mkdir(serviceRoot, { recursive: true });
  await writeFile(path.join(serviceRoot, "service.json"), JSON.stringify(body, null, 2));
}

test("discoverServices loads valid service manifests from a services root", async () => {
  const servicesRoot = await makeTempServicesRoot();

  try {
    await writeManifest(servicesRoot, "@node", {
      id: "@node",
      name: "Node Runtime",
      description: "Runtime provider",
    });
    await writeManifest(servicesRoot, "echo-service", {
      id: "echo-service",
      name: "Echo Service",
      description: "Sample service",
    });

    const discovered = await discoverServices(servicesRoot);

    assert.equal(discovered.length, 2);
    assert.deepEqual(
      discovered.map((service) => service.manifest.id),
      ["@node", "echo-service"],
    );
  } finally {
    await rm(servicesRoot, { recursive: true, force: true });
  }
});

test("loadServiceManifest fails explicitly for malformed manifests", async () => {
  const servicesRoot = await makeTempServicesRoot();
  const manifestPath = path.join(servicesRoot, "broken", "service.json");

  try {
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(
      manifestPath,
      JSON.stringify({
        id: "broken",
        description: "Missing name should fail",
      }),
    );

    await assert.rejects(
      () => loadServiceManifest(manifestPath),
      /expected non-empty string for "name"/i,
    );
  } finally {
    await rm(servicesRoot, { recursive: true, force: true });
  }
});

test("GET /api/services returns manifest-backed data from the configured services root", async () => {
  const servicesRoot = await makeTempServicesRoot();
  const apiServer = await (async () => {
    await writeManifest(servicesRoot, "echo-service", {
      id: "echo-service",
      name: "Echo Service",
      description: "Sample service",
    });
    await writeManifest(servicesRoot, "@python", {
      id: "@python",
      name: "Python Runtime",
      description: "Runtime provider",
    });

    return startApiServer({ port: 0, servicesRoot, version: "test-version" });
  })();

  try {
    const response = await fetch(`${apiServer.url}/api/services`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.services.length, 2);
    assert.deepEqual(
      body.services.map((service) => service.id),
      ["@python", "echo-service"],
    );
    assert.equal(body.services[0].source, "manifest");
    assert.ok(body.services[0].manifestPath);
  } finally {
    await apiServer.stop();
    await rm(servicesRoot, { recursive: true, force: true });
  }
});

test("GET /api/services returns explicit error when a manifest is malformed", async () => {
  const servicesRoot = await makeTempServicesRoot();
  await writeManifest(servicesRoot, "broken-service", {
    id: "broken-service",
    description: "Missing name should fail",
  });

  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const response = await fetch(`${apiServer.url}/api/services`);
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.equal(body.error, "internal_error");
    assert.match(body.message, /expected non-empty string for "name"/i);
  } finally {
    await apiServer.stop();
    await rm(servicesRoot, { recursive: true, force: true });
  }
});
