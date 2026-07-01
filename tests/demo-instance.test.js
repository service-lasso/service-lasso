import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

async function startFixtureServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function runNodeScript(script, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve("scripts", script), ...args], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("demo smoke script validates the bounded demo instance end to end", async () => {
  const demoScript = path.resolve("scripts", "demo-smoke.mjs");

  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [demoScript], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        SERVICE_LASSO_PORT: "0",
      },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });

  assert.equal(result.code, 0, `Expected demo smoke to pass.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  assert.match(result.stdout, /\[service-lasso demo] smoke passed/);
  assert.match(result.stdout, /echo-service, @node, node-sample-service/);
});

test("demo status reports canonical endpoint and lifecycle paths as JSON", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-demo-status-"));
  const runtime = await startFixtureServer((request, response) => {
    if (request.url === "/api/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }

    response.writeHead(404);
    response.end();
  });
  const admin = await startFixtureServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<!doctype html><title>Service Admin</title>");
  });

  try {
    const result = await runNodeScript("demo-status.mjs", [
      `--runtime-url=${runtime.url}`,
      `--admin-url=${admin.url}/`,
      `--workspace-root=${workspaceRoot}`,
      "--json",
    ]);

    assert.equal(result.code, 0, result.stderr);
    const status = JSON.parse(result.stdout);

    assert.equal(status.ok, true);
    assert.equal(status.classification, "healthy");
    assert.equal(status.endpoints.runtime.healthUrl, `${runtime.url}/api/health`);
    assert.equal(status.paths.workspaceRoot, workspaceRoot);
    assert.match(status.paths.lifecycleStatePath, /[\\/]\.service-lasso[\\/]demo-lifecycle\.json$/);
    assert.match(status.paths.demoLogRoot, /[\\/]\.demo-logs$/);
  } finally {
    await admin.close();
    await runtime.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("demo start exits cleanly and persists lifecycle state when canonical endpoints are already healthy", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-demo-start-"));
  const runtime = await startFixtureServer((request, response) => {
    if (request.url === "/api/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }

    response.writeHead(404);
    response.end();
  });
  const admin = await startFixtureServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<!doctype html><title>Service Admin</title>");
  });

  try {
    const result = await runNodeScript("demo-start.mjs", [
      `--runtime-url=${runtime.url}`,
      `--admin-url=${admin.url}/`,
      `--workspace-root=${workspaceRoot}`,
      "--json",
    ]);

    assert.equal(result.code, 0, result.stderr);
    const status = JSON.parse(result.stdout);
    const persisted = JSON.parse(await readFile(status.paths.lifecycleStatePath, "utf8"));

    assert.equal(status.ok, true);
    assert.equal(status.classification, "healthy");
    assert.equal(status.lifecycleState.phase, "already_healthy");
    assert.equal(persisted.phase, "already_healthy");
    assert.equal(persisted.classification, "healthy");
    assert.equal(persisted.owner.workspaceRoot, workspaceRoot);
    assert.equal(persisted.owner.runtimeUrl, runtime.url);
    assert.equal(persisted.owner.serviceAdminUrl, `${admin.url}/`);
  } finally {
    await admin.close();
    await runtime.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("demo verify canonical exits non-zero when a canonical endpoint is down", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-demo-verify-"));
  const runtime = await startFixtureServer((request, response) => {
    if (request.url === "/api/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }

    response.writeHead(404);
    response.end();
  });

  try {
    const result = await runNodeScript("demo-verify-canonical.mjs", [
      `--runtime-url=${runtime.url}`,
      "--admin-url=http://127.0.0.1:1/",
      `--workspace-root=${workspaceRoot}`,
      "--timeout-ms=250",
      "--json",
    ]);

    assert.equal(result.code, 1);
    const status = JSON.parse(result.stdout);

    assert.equal(status.ok, false);
    assert.equal(status.classification, "service_admin_down");
    assert.equal(status.endpoints.runtime.status, 200);
    assert.equal(status.endpoints.serviceAdmin.status, null);
  } finally {
    await runtime.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
