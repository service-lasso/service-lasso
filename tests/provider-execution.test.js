import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { createServiceRegistry } from "../dist/runtime/manager/DependencyGraph.js";
import { resolveProviderExecution } from "../dist/runtime/providers/resolveProvider.js";
import { getLifecycleState, resetLifecycleState, setLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { readStoredState } from "../dist/runtime/state/readState.js";

const servicesRoot = path.resolve("services");

async function postJson(url) {
  const response = await fetch(url, { method: "POST" });
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function waitFor(readinessCheck, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await readinessCheck();
    if (result) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Condition not met within ${timeoutMs}ms`);
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

test("provider resolution returns direct execution for the local echo fixture service", async () => {
  const discovered = await discoverServices(servicesRoot);
  const registry = createServiceRegistry(discovered);
  const echoService = registry.getById("echo-service");

  assert.ok(echoService);
  const plan = resolveProviderExecution(echoService, registry);

  assert.equal(plan.provider, "direct");
  assert.equal(plan.executable, "node");
  assert.deepEqual(plan.args, ["runtime/fixture-harness.mjs"]);
});

test("provider resolution returns node execution for provider-backed services", async () => {
  resetLifecycleState();
  const discovered = await discoverServices(servicesRoot);
  const registry = createServiceRegistry(discovered);
  const nodeSampleService = registry.getById("node-sample-service");

  assert.ok(nodeSampleService);
  const plan = resolveProviderExecution(nodeSampleService, registry);

  assert.equal(plan.provider, "node");
  assert.equal(plan.providerServiceId, "@node");
  assert.equal(plan.commandPreview, "node runtime/server.mjs");
  assert.equal(plan.providerEnv.NODE_ENV, "development");
});

test("provider resolution prefers an installed provider artifact command", async () => {
  resetLifecycleState();
  const discovered = await discoverServices(servicesRoot);
  const registry = createServiceRegistry(discovered);
  const nodeSampleService = registry.getById("node-sample-service");
  const providerState = getLifecycleState("@node");

  setLifecycleState("@node", {
    ...providerState,
    installed: true,
    installArtifacts: {
      ...providerState.installArtifacts,
      artifact: {
        ...providerState.installArtifacts.artifact,
        sourceType: "github-release",
        repo: "service-lasso/lasso-node",
        tag: "2026.4.27-13573bd",
        assetName: "lasso-node-v24.15.0-win32.zip",
        archiveType: "zip",
        extractedPath: path.join("provider-root"),
        command: ".\\node.exe",
        args: ["--version"],
      },
    },
  });

  try {
    assert.ok(nodeSampleService);
    const plan = resolveProviderExecution(nodeSampleService, registry);

    assert.equal(plan.provider, "node");
    assert.equal(plan.executable, ".\\node.exe");
    assert.deepEqual(plan.args, ["runtime/server.mjs"]);
    assert.equal(plan.commandRoot, path.join("provider-root"));
  } finally {
    resetLifecycleState();
  }
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
    assert.equal(plan.providerEnv.NODE_ENV, undefined);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("provider resolution returns java execution for java-backed services", async () => {
  const { tempRoot, root } = await makeTempServicesRoot();

  try {
    await writeManifest(root, "@java", {
      id: "@java",
      name: "Java Runtime",
      description: "Java provider",
      executable: "java",
      env: {
        JAVA_HOME: "local-java-home",
      },
    });
    await writeManifest(root, "java-service", {
      id: "java-service",
      name: "Java Service",
      description: "Java-backed service",
      execservice: "@java",
      args: ["-jar", "app.jar"],
    });

    const discovered = await discoverServices(root);
    const registry = createServiceRegistry(discovered);
    const javaService = registry.getById("java-service");

    assert.ok(javaService);
    const plan = resolveProviderExecution(javaService, registry);

    assert.equal(plan.provider, "java");
    assert.equal(plan.providerServiceId, "@java");
    assert.equal(plan.commandPreview, "java -jar app.jar");
    assert.equal(plan.providerEnv.JAVA_HOME, "local-java-home");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("provider-backed lifecycle action includes provider details in API responses", async () => {
  resetLifecycleState();
  const { tempRoot, root } = await makeTempServicesRoot();

  try {
    const serviceRoot = path.join(root, "node-sample-service");
    await mkdir(path.join(serviceRoot, "runtime"), { recursive: true });
    await writeFile(
      path.join(serviceRoot, "runtime", "server.mjs"),
      [
        "import { mkdir, writeFile } from 'node:fs/promises';",
        "import path from 'node:path';",
        "const envPath = process.env.NODE_SAMPLE_ENV_PATH;",
        "if (envPath) {",
        "  await mkdir(path.dirname(envPath), { recursive: true });",
        "  await writeFile(envPath, JSON.stringify({ NODE_ENV: process.env.NODE_ENV, SERVICE_PORT: process.env.SERVICE_PORT, NODE_SAMPLE_PORT: process.env.NODE_SAMPLE_PORT }, null, 2));",
        "}",
        "const heartbeat = setInterval(() => {}, 1000);",
        "function shutdown() { clearInterval(heartbeat); process.exit(0); }",
        "process.on('SIGINT', shutdown);",
        "process.on('SIGTERM', shutdown);",
        "",
      ].join("\n"),
      "utf8",
    );

    await writeManifest(root, "@node", {
      id: "@node",
      name: "Node Runtime",
      description: "Node provider shim for lifecycle proof",
      role: "provider",
      executable: process.execPath,
      args: ["--version"],
      env: {
        NODE_ENV: "development",
      },
    });
    await writeManifest(root, "node-sample-service", {
      id: "node-sample-service",
      name: "Node Sample Service",
      description: "Bounded Node-provider lifecycle proof.",
      depend_on: ["@node"],
      execservice: "@node",
      args: ["runtime/server.mjs"],
      env: {
        NODE_SAMPLE_ENV_PATH: "./.state/provider-env.json",
        NODE_SAMPLE_PORT: "${SERVICE_PORT}",
      },
      ports: {
        service: 4020,
      },
      healthcheck: {
        type: "process",
      },
    });

    const apiServer = await startApiServer({ port: 0, servicesRoot: root });

    try {
      await postJson(`${apiServer.url}/api/services/@node/install`);
      await postJson(`${apiServer.url}/api/services/@node/config`);
      await postJson(`${apiServer.url}/api/services/node-sample-service/install`);
      await postJson(`${apiServer.url}/api/services/node-sample-service/config`);
      const start = await postJson(`${apiServer.url}/api/services/node-sample-service/start`);

      assert.equal(start.status, 200);
      assert.equal(start.body.provider.provider, "node");
      assert.match(start.body.provider.commandPreview, /runtime\/server\.mjs/);
      assert.equal(start.body.state.runtime.provider, "node");
      assert.equal(start.body.state.runtime.providerServiceId, "@node");
      assert.match(start.body.state.runtime.command, /runtime\/server\.mjs/);

      const detail = await fetch(`${apiServer.url}/api/services/node-sample-service`);
      const detailBody = await detail.json();
      assert.equal(detailBody.service.provider.provider, "node");
      assert.equal(detailBody.service.lifecycle.runtime.provider, "node");
      assert.equal(detailBody.service.lifecycle.runtime.providerServiceId, "@node");

      const providerEnvSnapshot = JSON.parse(
        await waitFor(async () => {
          try {
            return await readFile(path.join(serviceRoot, ".state", "provider-env.json"), "utf8");
          } catch (error) {
            if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
              return null;
            }
            throw error;
          }
        }),
      );
      assert.equal(providerEnvSnapshot.NODE_ENV, "development");
      assert.equal(providerEnvSnapshot.SERVICE_PORT, "4020");
      assert.equal(providerEnvSnapshot.NODE_SAMPLE_PORT, "4020");
      const stored = await readStoredState(serviceRoot);
      assert.equal(stored.runtime.provider, "node");
      assert.equal(stored.runtime.providerServiceId, "@node");

      const stop = await postJson(`${apiServer.url}/api/services/node-sample-service/stop`);
      assert.equal(stop.status, 200);
    } finally {
      await apiServer.stop();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
    resetLifecycleState();
  }
});

test("java provider-backed lifecycle action records bounded provider evidence", async () => {
  resetLifecycleState();
  const { tempRoot, root } = await makeTempServicesRoot();

  try {
    const serviceRoot = path.join(root, "java-sample-service");
    await mkdir(path.join(serviceRoot, "runtime"), { recursive: true });
    await writeFile(
      path.join(serviceRoot, "runtime", "server.mjs"),
      [
        "import { mkdir, writeFile } from 'node:fs/promises';",
        "import path from 'node:path';",
        "const envPath = process.env.JAVA_SAMPLE_ENV_PATH;",
        "if (envPath) {",
        "  await mkdir(path.dirname(envPath), { recursive: true });",
        "  await writeFile(envPath, JSON.stringify({ JAVA_HOME: process.env.JAVA_HOME, SERVICE_PORT: process.env.SERVICE_PORT }, null, 2));",
        "}",
        "const heartbeat = setInterval(() => {}, 1000);",
        "function shutdown() { clearInterval(heartbeat); process.exit(0); }",
        "process.on('SIGINT', shutdown);",
        "process.on('SIGTERM', shutdown);",
        "",
      ].join("\n"),
      "utf8",
    );

    await writeManifest(root, "@java", {
      id: "@java",
      name: "Java Runtime",
      description: "Java provider shim for lifecycle proof",
      executable: process.execPath,
      env: {
        JAVA_HOME: "test-java-home",
      },
    });
    await writeManifest(root, "java-sample-service", {
      id: "java-sample-service",
      name: "Java Sample Service",
      description: "Bounded Java-provider lifecycle proof.",
      depend_on: ["@java"],
      execservice: "@java",
      args: ["runtime/server.mjs"],
      env: {
        JAVA_SAMPLE_ENV_PATH: "./.state/provider-env.json",
        JAVA_SAMPLE_PORT: "${SERVICE_PORT}",
      },
      ports: {
        service: 4140,
      },
      healthcheck: {
        type: "process",
      },
    });

    const apiServer = await startApiServer({ port: 0, servicesRoot: root });

    try {
      await postJson(`${apiServer.url}/api/services/@java/install`);
      await postJson(`${apiServer.url}/api/services/@java/config`);
      await postJson(`${apiServer.url}/api/services/java-sample-service/install`);
      await postJson(`${apiServer.url}/api/services/java-sample-service/config`);
      const start = await postJson(`${apiServer.url}/api/services/java-sample-service/start`);

      assert.equal(start.status, 200);
      assert.equal(start.body.provider.provider, "java");
      assert.equal(start.body.provider.providerServiceId, "@java");
      assert.equal(start.body.state.runtime.provider, "java");
      assert.equal(start.body.state.runtime.providerServiceId, "@java");
      assert.match(start.body.provider.commandPreview, /runtime\/server\.mjs/);

      const providerEnvSnapshot = JSON.parse(
        await waitFor(async () => {
          try {
            return await readFile(path.join(serviceRoot, ".state", "provider-env.json"), "utf8");
          } catch (error) {
            if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
              return null;
            }
            throw error;
          }
        }),
      );
      assert.equal(providerEnvSnapshot.JAVA_HOME, "test-java-home");
      assert.equal(providerEnvSnapshot.SERVICE_PORT, "4140");

      const stored = await readStoredState(serviceRoot);
      assert.equal(stored.runtime.provider, "java");
      assert.equal(stored.runtime.providerServiceId, "@java");

      const stop = await postJson(`${apiServer.url}/api/services/java-sample-service/stop`);
      assert.equal(stop.status, 200);
    } finally {
      await apiServer.stop();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
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
      assert.equal(body.statusCode, 500);
      assert.match(body.message, /Unknown provider service id/i);
    } finally {
      await apiServer.stop();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
    resetLifecycleState();
  }
});
