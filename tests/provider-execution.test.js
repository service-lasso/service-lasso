import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { createServiceRegistry } from "../dist/runtime/manager/DependencyGraph.js";
import { resolveProviderExecution } from "../dist/runtime/providers/resolveProvider.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";

const servicesRoot = path.resolve("services");

async function postJson(url) {
  const response = await fetch(url, { method: "POST" });
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function makeTempServicesRoot() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-provider-"));
  const root = path.join(tempRoot, "services");
  await mkdir(root, { recursive: true });
  return { tempRoot, root };
}

async function writeManifest(servicesRoot, serviceId, body) {
  const serviceRoot = path.join(servicesRoot, serviceId);
  await mkdir(serviceRoot, { recursive: true });
  await writeFile(path.join(serviceRoot, "service.json"), JSON.stringify(body, null, 2));
}

test("provider resolution returns direct execution for standalone services", async () => {
  const discovered = await discoverServices(servicesRoot);
  const registry = createServiceRegistry(discovered);
  const nodeService = registry.getById("@node");

  assert.ok(nodeService);
  const plan = resolveProviderExecution(nodeService, registry);

  assert.equal(plan.provider, "direct");
  assert.equal(plan.executable, "node");
  assert.deepEqual(plan.args, ["--version"]);
});

test("provider resolution returns node execution for provider-backed services", async () => {
  const discovered = await discoverServices(servicesRoot);
  const registry = createServiceRegistry(discovered);
  const echoService = registry.getById("echo-service");

  assert.ok(echoService);
  const plan = resolveProviderExecution(echoService, registry);

  assert.equal(plan.provider, "node");
  assert.equal(plan.providerServiceId, "@node");
  assert.equal(plan.commandPreview, "node runtime/server.js");
});

test("provider resolution returns python execution for python-backed services", async () => {
  const { tempRoot, root } = await makeTempServicesRoot();

  try {
    await writeManifest(root, "@python", {
      id: "@python",
      name: "Python Runtime",
      description: "Python provider",
      executable: "python",
    });
    await writeManifest(root, "py-service", {
      id: "py-service",
      name: "Python Service",
      description: "Python-backed service",
      execservice: "@python",
      executable: "python",
      args: ["app.py"],
    });

    const discovered = await discoverServices(root);
    const registry = createServiceRegistry(discovered);
    const pyService = registry.getById("py-service");

    assert.ok(pyService);
    const plan = resolveProviderExecution(pyService, registry);

    assert.equal(plan.provider, "python");
    assert.equal(plan.providerServiceId, "@python");
    assert.equal(plan.commandPreview, "python app.py");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("provider-backed lifecycle action includes provider details in API responses", async () => {
  resetLifecycleState();
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    await postJson(`${apiServer.url}/api/services/echo-service/install`);
    await postJson(`${apiServer.url}/api/services/echo-service/config`);
    const start = await postJson(`${apiServer.url}/api/services/echo-service/start`);

    assert.equal(start.status, 200);
    assert.equal(start.body.provider.provider, "node");
    assert.equal(start.body.provider.commandPreview, "node runtime/server.js");

    const detail = await fetch(`${apiServer.url}/api/services/echo-service`);
    const detailBody = await detail.json();
    assert.equal(detailBody.service.provider.provider, "node");
  } finally {
    await apiServer.stop();
    resetLifecycleState();
  }
});

test("unknown provider ids fail explicitly", async () => {
  resetLifecycleState();
  const { tempRoot, root } = await makeTempServicesRoot();

  try {
    await writeManifest(root, "broken-service", {
      id: "broken-service",
      name: "Broken Service",
      description: "Invalid provider reference",
      execservice: "@missing",
      executable: "node",
      args: ["broken.js"],
    });

    const apiServer = await startApiServer({ port: 0, servicesRoot: root });

    try {
      const response = await fetch(`${apiServer.url}/api/services/broken-service`);
      const body = await response.json();

      assert.equal(response.status, 500);
      assert.equal(body.error, "internal_error");
      assert.match(body.message, /Unknown provider service id/i);
    } finally {
      await apiServer.stop();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
    resetLifecycleState();
  }
});
