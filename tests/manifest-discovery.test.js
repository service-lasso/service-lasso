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

test("loadServiceManifest accepts bounded tcp healthchecks", async () => {
  const servicesRoot = await makeTempServicesRoot();
  const manifestPath = path.join(servicesRoot, "tcp-service", "service.json");

  try {
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(
      manifestPath,
      JSON.stringify({
        id: "tcp-service",
        name: "TCP Service",
        description: "Service with bounded tcp health.",
        healthcheck: {
          type: "tcp",
          address: "127.0.0.1:4012",
        },
      }),
    );

    const manifest = await loadServiceManifest(manifestPath);

    assert.deepEqual(manifest.healthcheck, {
      type: "tcp",
      address: "127.0.0.1:4012",
    });
  } finally {
    await rm(servicesRoot, { recursive: true, force: true });
  }
});

test("loadServiceManifest accepts bounded file healthchecks", async () => {
  const servicesRoot = await makeTempServicesRoot();
  const manifestPath = path.join(servicesRoot, "file-service", "service.json");

  try {
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(
      manifestPath,
      JSON.stringify({
        id: "file-service",
        name: "File Service",
        description: "Service with bounded file health.",
        healthcheck: {
          type: "file",
          file: "./runtime/ready.txt",
        },
      }),
    );

    const manifest = await loadServiceManifest(manifestPath);

    assert.deepEqual(manifest.healthcheck, {
      type: "file",
      file: "./runtime/ready.txt",
    });
  } finally {
    await rm(servicesRoot, { recursive: true, force: true });
  }
});

test("loadServiceManifest accepts bounded variable healthchecks", async () => {
  const servicesRoot = await makeTempServicesRoot();
  const manifestPath = path.join(servicesRoot, "variable-service", "service.json");

  try {
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(
      manifestPath,
      JSON.stringify({
        id: "variable-service",
        name: "Variable Service",
        description: "Service with bounded variable health.",
        healthcheck: {
          type: "variable",
          variable: "${ECHO_MESSAGE}",
        },
      }),
    );

    const manifest = await loadServiceManifest(manifestPath);

    assert.deepEqual(manifest.healthcheck, {
      type: "variable",
      variable: "${ECHO_MESSAGE}",
    });
  } finally {
    await rm(servicesRoot, { recursive: true, force: true });
  }
});

test("loadServiceManifest accepts donor-aligned readiness retry fields", async () => {
  const servicesRoot = await makeTempServicesRoot();

  try {
    await writeManifest(servicesRoot, "http-ready-service", {
      id: "http-ready-service",
      name: "HTTP Ready Service",
      description: "Manifest proving readiness retry parsing.",
      healthcheck: {
        type: "http",
        url: "http://127.0.0.1:18080/health",
        expected_status: 200,
        retries: 5,
        interval: 250,
        start_period: 100,
      },
    });

    const manifest = await loadServiceManifest(path.join(servicesRoot, "http-ready-service", "service.json"));

    assert.deepEqual(manifest.healthcheck, {
      type: "http",
      url: "http://127.0.0.1:18080/health",
      expected_status: 200,
      retries: 5,
      interval: 250,
      start_period: 100,
    });
  } finally {
    await rm(servicesRoot, { recursive: true, force: true });
  }
});

test("loadServiceManifest accepts bounded globalenv emission maps", async () => {
  const servicesRoot = await makeTempServicesRoot();
  const manifestPath = path.join(servicesRoot, "emitter-service", "service.json");

  try {
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(
      manifestPath,
      JSON.stringify({
        id: "emitter-service",
        name: "Emitter Service",
        description: "Service with bounded globalenv emission.",
        env: {
          ECHO_MESSAGE: "hello shared env",
        },
        globalenv: {
          SHARED_MESSAGE: "${ECHO_MESSAGE}",
        },
      }),
    );

    const manifest = await loadServiceManifest(manifestPath);

    assert.deepEqual(manifest.globalenv, {
      SHARED_MESSAGE: "${ECHO_MESSAGE}",
    });
  } finally {
    await rm(servicesRoot, { recursive: true, force: true });
  }
});

test("loadServiceManifest accepts bounded autostart flags", async () => {
  const servicesRoot = await makeTempServicesRoot();
  const manifestPath = path.join(servicesRoot, "autostart-service", "service.json");

  try {
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(
      manifestPath,
      JSON.stringify({
        id: "autostart-service",
        name: "Autostart Service",
        description: "Service opting into bounded autostart.",
        autostart: true,
      }),
    );

    const manifest = await loadServiceManifest(manifestPath);

    assert.equal(manifest.autostart, true);
  } finally {
    await rm(servicesRoot, { recursive: true, force: true });
  }
});

test("loadServiceManifest accepts bounded ports declarations", async () => {
  const servicesRoot = await makeTempServicesRoot();
  const manifestPath = path.join(servicesRoot, "port-service", "service.json");

  try {
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(
      manifestPath,
      JSON.stringify({
        id: "port-service",
        name: "Port Service",
        description: "Service with bounded port declarations.",
        ports: {
          service: 43100,
          ui: 0,
        },
      }),
    );

    const manifest = await loadServiceManifest(manifestPath);

    assert.deepEqual(manifest.ports, {
      service: 43100,
      ui: 0,
    });
  } finally {
    await rm(servicesRoot, { recursive: true, force: true });
  }
});

test("loadServiceManifest accepts bounded install/config file materialization", async () => {
  const servicesRoot = await makeTempServicesRoot();
  const manifestPath = path.join(servicesRoot, "materialized-service", "service.json");

  try {
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(
      manifestPath,
      JSON.stringify({
        id: "materialized-service",
        name: "Materialized Service",
        description: "Service with bounded install/config file outputs.",
        install: {
          files: [
            {
              path: "./runtime/install.txt",
              content: "installed ${SERVICE_ID}",
            },
          ],
        },
        config: {
          files: [
            {
              path: "./runtime/config.json",
              content: "{\"port\":\"${SERVICE_PORT}\"}",
            },
          ],
        },
      }),
    );

    const manifest = await loadServiceManifest(manifestPath);

    assert.deepEqual(manifest.install, {
      files: [
        {
          path: "./runtime/install.txt",
          content: "installed ${SERVICE_ID}",
        },
      ],
    });
    assert.deepEqual(manifest.config, {
      files: [
        {
          path: "./runtime/config.json",
          content: "{\"port\":\"${SERVICE_PORT}\"}",
        },
      ],
    });
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

test("runtime startup fails explicitly when a manifest is malformed", async () => {
  const servicesRoot = await makeTempServicesRoot();
  await writeManifest(servicesRoot, "broken-service", {
    id: "broken-service",
    description: "Missing name should fail",
  });

  await assert.rejects(() => startApiServer({ port: 0, servicesRoot }), /expected non-empty string for "name"/i);
  await rm(servicesRoot, { recursive: true, force: true });
});
