import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import { parseCommandlineArgs } from "../dist/runtime/execution/commandline.js";
import { makeTempServicesRoot, writeManifest } from "./test-helpers.js";
import { getLifecycleState, resetLifecycleState, setLifecycleState } from "../dist/runtime/lifecycle/store.js";

async function postJson(url) {
  const response = await fetch(url, { method: "POST" });
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function waitFor(readinessCheck, timeoutMs = 2_000) {
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

test("parseCommandlineArgs preserves quoted spaces and Windows backslashes", () => {
  assert.deepEqual(
    parseCommandlineArgs(' --config="${SERVICE_ROOT}\\runtime\\dynamic.yml" --entryPoints.web.address=":${WEB_PORT}" --flag value'),
    [
      "--config=${SERVICE_ROOT}\\runtime\\dynamic.yml",
      "--entryPoints.web.address=:${WEB_PORT}",
      "--flag",
      "value",
    ],
  );
});

test("start uses installed artifact commands from the service root working directory", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-cwd-");

  try {
    const serviceId = "artifact-cwd-service";
    const serviceRoot = path.join(servicesRoot, serviceId);
    const runtimeRoot = path.join(serviceRoot, "runtime");
    const artifactRoot = path.join(serviceRoot, ".state", "extracted", "current");
    await mkdir(runtimeRoot, { recursive: true });
    await mkdir(artifactRoot, { recursive: true });

    const scriptPath = path.join(artifactRoot, "artifact-cwd-fixture.mjs");
    await writeFile(
      scriptPath,
      [
        "import { mkdir, writeFile } from 'node:fs/promises';",
        "import path from 'node:path';",
        "const outputPath = path.resolve(process.cwd(), 'runtime/cwd-output.json');",
        "await mkdir(path.dirname(outputPath), { recursive: true });",
        "await writeFile(outputPath, JSON.stringify({ cwd: process.cwd() }, null, 2));",
        "const heartbeat = setInterval(() => {}, 1000);",
        "function shutdown() { clearInterval(heartbeat); process.exit(0); }",
        "process.on('SIGINT', shutdown);",
        "process.on('SIGTERM', shutdown);",
        "",
      ].join("\n"),
      "utf8",
    );

    await writeManifest(servicesRoot, serviceId, {
      id: serviceId,
      name: "Artifact CWD Service",
      description: "Fixture proving installed artifact commands start from the service root.",
      healthcheck: {
        type: "process",
      },
    });

    const apiServer = await startApiServer({ port: 0, servicesRoot });

    try {
      setLifecycleState(serviceId, {
        ...getLifecycleState(serviceId),
        installed: true,
        configured: true,
        installArtifacts: {
          files: [],
          updatedAt: new Date().toISOString(),
          artifact: {
            sourceType: null,
            repo: null,
            channel: null,
            tag: null,
            assetName: null,
            assetUrl: null,
            archiveType: null,
            archivePath: null,
            extractedPath: artifactRoot,
            command: process.execPath,
            args: [scriptPath],
          },
        },
      });

      const start = await postJson(`${apiServer.url}/api/services/${serviceId}/start`);
      assert.equal(start.status, 200);

      const output = JSON.parse(
        await waitFor(async () => {
          try {
            return await readFile(path.join(runtimeRoot, "cwd-output.json"), "utf8");
          } catch (error) {
            if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
              return null;
            }
            throw error;
          }
        }),
      );

      assert.equal(path.resolve(output.cwd), path.resolve(serviceRoot));
      assert.equal((await postJson(`${apiServer.url}/api/services/${serviceId}/stop`)).status, 200);
    } finally {
      await apiServer.stop();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
    resetLifecycleState();
  }
});

test("start uses manifest commandline with resolved service variables instead of fallback args", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-commandline-");

  try {
    const serviceRoot = path.join(servicesRoot, "commandline-service");
    const runtimeRoot = path.join(serviceRoot, "runtime");
    await mkdir(runtimeRoot, { recursive: true });
    await writeFile(
      path.join(runtimeRoot, "commandline-fixture.mjs"),
      [
        "import { mkdir, writeFile } from 'node:fs/promises';",
        "import path from 'node:path';",
        "const outputPath = path.resolve(process.cwd(), process.env.OUTPUT_PATH);",
        "await mkdir(path.dirname(outputPath), { recursive: true });",
        "await writeFile(outputPath, JSON.stringify({ argv: process.argv.slice(2), servicePort: process.env.SERVICE_PORT }, null, 2));",
        "const heartbeat = setInterval(() => {}, 1000);",
        "function shutdown() { clearInterval(heartbeat); process.exit(0); }",
        "process.on('SIGINT', shutdown);",
        "process.on('SIGTERM', shutdown);",
        "",
      ].join("\n"),
      "utf8",
    );

    await writeManifest(servicesRoot, "commandline-service", {
      id: "commandline-service",
      name: "Commandline Service",
      description: "Fixture proving commandline execution.",
      executable: process.execPath,
      args: ["-e", "process.exit(42)"],
      commandline: {
        default: " runtime/commandline-fixture.mjs --port=${SERVICE_PORT} \"--message=hello command line\"",
      },
      env: {
        OUTPUT_PATH: "./runtime/commandline-output.json",
      },
      ports: {
        service: 43175,
      },
      healthcheck: {
        type: "process",
      },
    });

    const apiServer = await startApiServer({ port: 0, servicesRoot });

    try {
      assert.equal((await postJson(`${apiServer.url}/api/services/commandline-service/install`)).status, 200);
      assert.equal((await postJson(`${apiServer.url}/api/services/commandline-service/config`)).status, 200);
      const start = await postJson(`${apiServer.url}/api/services/commandline-service/start`);

      assert.equal(start.status, 200);
      assert.match(start.body.state.runtime.command, /commandline-fixture\.mjs --port=43175 "--message=hello command line"|commandline-fixture\.mjs --port=43175 --message=hello command line/);

      const output = JSON.parse(
        await waitFor(async () => {
          try {
            return await readFile(path.join(runtimeRoot, "commandline-output.json"), "utf8");
          } catch (error) {
            if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
              return null;
            }
            throw error;
          }
        }),
      );

      assert.deepEqual(output.argv, ["--port=43175", "--message=hello command line"]);
      assert.equal(output.servicePort, "43175");
      assert.equal((await postJson(`${apiServer.url}/api/services/commandline-service/stop`)).status, 200);
    } finally {
      await apiServer.stop();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
    resetLifecycleState();
  }
});
