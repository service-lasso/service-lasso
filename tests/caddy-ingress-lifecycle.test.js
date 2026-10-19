import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { readFile, rm, writeFile } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import { resetCaddyIngressRegistrations } from "../dist/runtime/ingress/caddy.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { stopService } from "../dist/runtime/lifecycle/actions.js";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import {
  makeTempServicesRoot,
  writeExecutableFixtureService,
  writeManifest,
} from "./test-helpers.js";

function postJson(url) {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  }).then(async (response) => ({
    status: response.status,
    body: await response.json().catch(() => null),
  }));
}

test("starting a service registers ingress with @caddy and stopping unregisters it", async () => {
  resetCaddyIngressRegistrations();
  resetLifecycleState();

  const requests = [];
  const admin = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      requests.push({ url: req.url, body: body ? JSON.parse(body) : null });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "success" }));
    });
  });
  await new Promise((resolve) => admin.listen(0, "127.0.0.1", resolve));
  const adminPort = admin.address().port;

  let apiServer = null;
  let tempRoot = null;
  const previousRegistryPath = process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH;

  try {
    const temp = await makeTempServicesRoot("service-lasso-caddy-lifecycle-");
    tempRoot = temp.tempRoot;
    const { servicesRoot } = temp;
    process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH = path.join(tempRoot, "host-registry", "instances.json");

    // A discovered @caddy provides the shared admin address and ingress port.
    await writeManifest(servicesRoot, "@caddy", {
      id: "@caddy",
      name: "Caddy",
      description: "test caddy provider",
      enabled: true,
      role: "provider",
      globalenv: {
        CADDY_ADMIN_ADDR: `127.0.0.1:${adminPort}`,
        CADDY_HTTP_PORT: "18090",
      },
    });

    const { serviceRoot: consumerRoot } = await writeExecutableFixtureService(
      servicesRoot,
      "ingress-consumer",
      { ports: { service: 45123 } },
    );
    const manifestPath = path.join(consumerRoot, "service.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.ingress = [
      {
        domain: "ingress-consumer.servicelasso.localhost",
        proxy: { type: "http", endpoint: "service" },
      },
    ];
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    apiServer = await startApiServer({ port: 0, servicesRoot });

    let result = await postJson(`${apiServer.url}/api/services/ingress-consumer/install`);
    assert.equal(result.status, 200, `install: ${JSON.stringify(result.body)}`);
    result = await postJson(`${apiServer.url}/api/services/ingress-consumer/config`);
    assert.equal(result.status, 200, `config: ${JSON.stringify(result.body)}`);
    result = await postJson(`${apiServer.url}/api/services/ingress-consumer/start`);
    assert.equal(result.status, 200, `start: ${JSON.stringify(result.body)}`);

    const register = requests.find((request) => request.url === "/service-lasso/register");
    assert.ok(register, `expected a register call, got ${JSON.stringify(requests)}`);
    assert.equal(register.body.id, "ingress-consumer");
    assert.equal(register.body.domain, "ingress-consumer.servicelasso.localhost");
    assert.equal(register.body.type, "http");
    assert.equal(register.body.ingress_port, 18090);
    assert.match(register.body.target, /^127\.0\.0\.1:\d+$/);

    const consumer = (await discoverServices(servicesRoot)).find(
      (service) => service.manifest.id === "ingress-consumer",
    );
    assert.ok(consumer, "ingress-consumer should be discoverable");
    await stopService(consumer);

    const unregister = requests.find((request) => request.url === "/service-lasso/unregister");
    assert.ok(unregister, `expected an unregister call, got ${JSON.stringify(requests)}`);
    assert.deepEqual(unregister.body, { id: "ingress-consumer" });
  } finally {
    if (apiServer) {
      await apiServer.stop();
    }
    if (previousRegistryPath === undefined) {
      delete process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH;
    } else {
      process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH = previousRegistryPath;
    }
    resetCaddyIngressRegistrations();
    resetLifecycleState();
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
    admin.closeAllConnections?.();
    await new Promise((resolve) => admin.close(resolve));
  }
});
