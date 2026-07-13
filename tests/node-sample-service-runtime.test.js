import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";

function waitForLine(lines, matcher, timeoutMs = 2_000) {
  const existing = lines.find((line) => matcher.test(line));
  if (existing) {
    return Promise.resolve(existing);
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${matcher}`));
    }, timeoutMs);

    const onLine = (line) => {
      if (matcher.test(line)) {
        cleanup();
        resolve(line);
      }
    };

    const cleanup = () => {
      clearTimeout(timeout);
      lines.listeners.delete(onLine);
    };

    lines.listeners.add(onLine);
  });
}

function makeLineCollector() {
  const lines = [];
  lines.listeners = new Set();
  lines.pushChunk = (chunk) => {
    for (const line of String(chunk).replace(/\r\n/g, "\n").split("\n")) {
      if (!line) {
        continue;
      }
      lines.push(line);
      for (const listener of lines.listeners) {
        listener(line);
      }
    }
  };
  return lines;
}

test("node sample service emits safe stdout, stderr, health, and metadata snapshot", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "node-sample-runtime-"));
  const runtimePath = path.resolve("services", "node-sample-service", "runtime", "server.mjs");
  const stdout = makeLineCollector();
  const stderr = makeLineCollector();
  const child = spawn(process.execPath, [runtimePath], {
    cwd: tempRoot,
    env: {
      ...process.env,
      NODE_ENV: "development",
      NODE_SAMPLE_PORT: "0",
      NODE_SAMPLE_HEARTBEAT_MS: "1000",
      NODE_SAMPLE_ENV_PATH: "./.state/provider-env.json",
      SERVICE_PORT: "0",
    },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => stdout.pushChunk(chunk));
  child.stderr.on("data", (chunk) => stderr.pushChunk(chunk));

  try {
    assert.match(await waitForLine(stdout, /node-sample-service starting/), /starting/);
    const listeningLine = await waitForLine(stdout, /node-sample-service listening on 127\.0\.0\.1:\d+/);
    const port = Number(listeningLine.match(/:(\d+)$/)?.[1]);
    assert.ok(port > 0);

    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).rawMaterialReturned, false);

    const logResponse = await fetch(`http://127.0.0.1:${port}/demo/log?message=${encodeURIComponent("alpha\nsecret-looking")}`);
    assert.equal(logResponse.status, 200);
    assert.equal((await logResponse.json()).message, "alpha secret-looking");
    assert.match(await waitForLine(stdout, /demo log message="alpha secret-looking"/), /alpha secret-looking/);

    const errorResponse = await fetch(`http://127.0.0.1:${port}/demo/error?message=${encodeURIComponent("beta\twarning")}`);
    assert.equal(errorResponse.status, 200);
    assert.equal((await errorResponse.json()).stream, "stderr");
    assert.match(await waitForLine(stderr, /demo error message="beta warning"/), /beta warning/);

    child.stdin.write("ping\n");
    assert.match(await waitForLine(stdout, /command pong/), /command pong/);
    assert.match(await waitForLine(stdout, /heartbeat count=1 uptimeMs=/, 2_500), /heartbeat count=1/);

    const snapshot = await waitFor(async () => {
      try {
        return JSON.parse(await readFile(path.join(tempRoot, ".state", "provider-env.json"), "utf8"));
      } catch {
        return null;
      }
    });
    assert.equal(snapshot.NODE_ENV, "development");
    assert.equal(snapshot.SERVICE_PORT, "0");
    assert.equal(snapshot.NODE_SAMPLE_PORT, "0");
    assert.equal(snapshot.port, port);
    assert.equal(snapshot.outputCounters.stderr, 1);
    assert.ok(snapshot.outputCounters.stdout >= 4);
    assert.equal(JSON.stringify(snapshot).includes("alpha"), false);
    assert.equal(JSON.stringify(snapshot).includes("beta"), false);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("close", resolve));
    await rm(tempRoot, { recursive: true, force: true });
  }
});

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

async function writeManifest(servicesRoot, serviceId, manifest) {
  const serviceRoot = path.join(servicesRoot, serviceId);
  await mkdir(serviceRoot, { recursive: true });
  await writeFile(path.join(serviceRoot, "service.json"), JSON.stringify(manifest, null, 2), "utf8");
  return serviceRoot;
}

test("runtime log API captures node sample normal and error validation output", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "node-sample-runtime-api-"));
  const servicesRoot = path.join(tempRoot, "services");
  await mkdir(servicesRoot, { recursive: true });

  try {
    await writeManifest(servicesRoot, "@node", {
      id: "@node",
      name: "Node Runtime",
      description: "Node provider shim for sample service log validation.",
      role: "provider",
      executable: process.execPath,
      env: {
        NODE_ENV: "development",
      },
    });

    const serviceRoot = await writeManifest(servicesRoot, "node-sample-service", {
      id: "node-sample-service",
      name: "Node Sample Service",
      description: "Node sample service runtime log validation target.",
      depend_on: ["@node"],
      execservice: "@node",
      args: ["runtime/server.mjs"],
      env: {
        NODE_SAMPLE_ENV_PATH: "./.state/provider-env.json",
        NODE_SAMPLE_HEARTBEAT_MS: "1000",
        NODE_SAMPLE_PORT: "${SERVICE_PORT}",
      },
      ports: {
        service: 0,
      },
      healthcheck: {
        type: "process",
      },
    });
    await mkdir(path.join(serviceRoot, "runtime"), { recursive: true });
    await writeFile(
      path.join(serviceRoot, "runtime", "server.mjs"),
      await readFile(path.resolve("services", "node-sample-service", "runtime", "server.mjs"), "utf8"),
      "utf8",
    );

    const apiServer = await startApiServer({ port: 0, servicesRoot });

    try {
      await postJson(`${apiServer.url}/api/services/@node/install`);
      await postJson(`${apiServer.url}/api/services/@node/config`);
      await postJson(`${apiServer.url}/api/services/node-sample-service/install`);
      await postJson(`${apiServer.url}/api/services/node-sample-service/config`);
      const start = await postJson(`${apiServer.url}/api/services/node-sample-service/start`);
      assert.equal(start.status, 200);

      const listeningEntry = await waitFor(async () => {
        const response = await fetch(`${apiServer.url}/api/services/node-sample-service/logs`);
        const body = await response.json();
        return body.logs.entries.find((entry) => /listening on 127\.0\.0\.1:\d+/.test(entry.message));
      });
      const port = Number(listeningEntry.message.match(/:(\d+)$/)?.[1]);
      assert.ok(port > 0);

      await fetch(`http://127.0.0.1:${port}/demo/log?message=${encodeURIComponent("runtime api normal")}`);
      await fetch(`http://127.0.0.1:${port}/demo/error?message=${encodeURIComponent("runtime api error")}`);

      const logs = await waitFor(async () => {
        const response = await fetch(`${apiServer.url}/api/services/node-sample-service/logs`);
        const body = await response.json();
        const messages = body.logs.entries.map((entry) => `${entry.level}:${entry.message}`);
        if (
          messages.some((message) => message.includes('stdout:node-sample-service demo log message="runtime api normal"')) &&
          messages.some((message) => message.includes('stderr:node-sample-service demo error message="runtime api error"'))
        ) {
          return body.logs;
        }
        return null;
      });

      assert.equal(logs.serviceId, "node-sample-service");
      assert.equal(JSON.stringify(logs).includes("ACTUAL_SECRET"), false);

      const snapshot = JSON.parse(await readFile(path.join(serviceRoot, ".state", "provider-env.json"), "utf8"));
      assert.equal(snapshot.outputCounters.stderr, 1);
    } finally {
      await postJson(`${apiServer.url}/api/services/node-sample-service/stop`).catch(() => null);
      await apiServer.stop();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
