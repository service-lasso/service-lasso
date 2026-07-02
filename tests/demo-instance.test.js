import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { defaultBaselineServiceIds, getDemoGateReport, resetDemoInstance } from "../scripts/demo-instance-lib.mjs";

async function startFixtureServer(handler, options = {}) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(options.port ?? 0, "127.0.0.1", resolve));
  const address = server.address();

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function getFreePort() {
  const server = http.createServer((request, response) => response.end());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

function dashboardSummaryBody(overrides = {}) {
  return {
    summary: {
      runtime: {
        status: "healthy",
        lastReloadedAt: "2026-07-02T00:00:00.000Z",
        warningCount: 0,
      },
      servicesTotal: 8,
      servicesRunning: 3,
      servicesStopped: 5,
      servicesDegraded: 0,
      networkExposureCount: 0,
      installedCount: 6,
      favorites: [],
      others: [],
      warnings: [],
      problemServices: [],
      ...overrides,
    },
  };
}

function writeDashboardSummary(response, overrides = {}) {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(dashboardSummaryBody(overrides)));
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
  assert.match(result.stdout, /@java, @localcert, @nginx, @traefik, @node, echo-service, @serviceadmin, node-sample-service/);
});

test("demo reset seeds documented baseline manifests into a dedicated services root", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-demo-seed-"));
  const servicesRoot = path.join(tempRoot, "canonical-services-root");
  const workspaceRoot = path.join(tempRoot, "workspace");

  try {
    await resetDemoInstance({ servicesRoot, workspaceRoot });

    for (const serviceId of [...defaultBaselineServiceIds, "node-sample-service"]) {
      const manifest = JSON.parse(await readFile(path.join(servicesRoot, serviceId, "service.json"), "utf8"));
      assert.equal(manifest.id, serviceId);
    }
    assert.match(await readFile(path.join(servicesRoot, "node-sample-service", "runtime", "server.mjs"), "utf8"), /node-sample-service/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
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
    if (request.url === "/api/dashboard") {
      writeDashboardSummary(response);
      return;
    }

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
    assert.equal(status.endpoints.serviceAdmin.dashboardUrl, `${admin.url}/api/dashboard`);
    assert.equal(status.endpoints.serviceAdmin.dashboardOk, true);
    assert.equal(status.endpoints.serviceAdmin.dashboardSummary.servicesTotal, 8);
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
    if (request.url === "/api/dashboard") {
      writeDashboardSummary(response);
      return;
    }

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

test("demo gate exits cleanly and persists lifecycle state when canonical endpoints are already healthy", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-demo-gate-"));
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
    if (request.url === "/api/dashboard") {
      writeDashboardSummary(response);
      return;
    }

    response.writeHead(200, { "content-type": "text/html" });
    response.end("<!doctype html><title>Service Admin</title>");
  });

  try {
    const result = await runNodeScript("demo-gate.mjs", [
      `--runtime-url=${runtime.url}`,
      `--admin-url=${admin.url}/`,
      `--workspace-root=${workspaceRoot}`,
      "--json",
    ]);

    assert.equal(result.code, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    const persisted = JSON.parse(await readFile(report.paths.lifecycleStatePath, "utf8"));

    assert.equal(report.ok, true);
    assert.equal(report.classification, "healthy");
    assert.equal(report.gate.phase, "gate_healthy");
    assert.equal(report.gate.runtimeListener.ok, true);
    assert.equal(persisted.phase, "gate_healthy");
    assert.equal(persisted.classification, "healthy");
  } finally {
    await admin.close();
    await runtime.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("demo gate reports a runtime port owner conflict when the listener is not Service Lasso health", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-demo-gate-conflict-"));
  const runtime = await startFixtureServer((request, response) => {
    if (request.url === "/api/health") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "not-service-lasso" }));
      return;
    }

    response.writeHead(404);
    response.end();
  });
  const admin = await startFixtureServer((request, response) => {
    if (request.url === "/api/dashboard") {
      writeDashboardSummary(response);
      return;
    }

    response.writeHead(200, { "content-type": "text/html" });
    response.end("<!doctype html><title>Service Admin</title>");
  });

  try {
    const result = await runNodeScript("demo-gate.mjs", [
      `--runtime-url=${runtime.url}`,
      `--admin-url=${admin.url}/`,
      `--workspace-root=${workspaceRoot}`,
      "--json",
    ]);

    assert.equal(result.code, 1);
    const report = JSON.parse(result.stdout);
    const persisted = JSON.parse(await readFile(report.paths.lifecycleStatePath, "utf8"));

    assert.equal(report.ok, false);
    assert.equal(report.classification, "runtime_port_owner_conflict");
    assert.equal(report.gate.sourceClassification, "runtime_down");
    assert.equal(report.gate.runtimeListener.ok, true);
    assert.equal(persisted.phase, "gate_blocked");
    assert.equal(persisted.classification, "runtime_port_owner_conflict");
  } finally {
    await admin.close();
    await runtime.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("demo gate attempts runtime recovery and reports recovered when endpoints become healthy", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-demo-gate-recovered-"));
  const runtimePort = await getFreePort();
  let runtime = null;
  const admin = await startFixtureServer((request, response) => {
    if (request.url === "/api/dashboard") {
      writeDashboardSummary(response);
      return;
    }

    response.writeHead(200, { "content-type": "text/html" });
    response.end("<!doctype html><title>Service Admin</title>");
  });

  try {
    const report = await getDemoGateReport({
      runtimeUrl: `http://127.0.0.1:${runtimePort}`,
      serviceAdminUrl: `${admin.url}/`,
      workspaceRoot,
      timeoutMs: 250,
      recoveryTimeoutMs: 2_000,
      startDetachedRuntime: async () => {
        runtime = await startFixtureServer((request, response) => {
          if (request.url === "/api/health") {
            response.writeHead(200, { "content-type": "application/json" });
            response.end(JSON.stringify({ status: "ok" }));
            return;
          }

          response.writeHead(404);
          response.end();
        }, { port: runtimePort });

        return {
          pid: 12345,
          command: "fixture-runtime",
          logPath: path.join(workspaceRoot, "fixture-runtime.log"),
          servicesRoot: path.resolve("services"),
          workspaceRoot,
          port: runtimePort,
        };
      },
    });
    const persisted = JSON.parse(await readFile(report.paths.lifecycleStatePath, "utf8"));

    assert.equal(report.ok, true);
    assert.equal(report.classification, "recovered");
    assert.equal(report.gate.phase, "gate_recovered");
    assert.equal(report.gate.recovery.attempted, true);
    assert.equal(report.gate.recovery.startedRuntime.pid, 12345);
    assert.equal(report.gate.sourceClassification, "runtime_down");
    assert.equal(persisted.phase, "gate_recovered");
    assert.equal(persisted.classification, "recovered");
  } finally {
    if (runtime) {
      await runtime.close();
    }
    await admin.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("demo gate reports service startup failure when recovery does not make endpoints healthy", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-demo-gate-failed-recovery-"));
  const runtimePort = await getFreePort();
  const admin = await startFixtureServer((request, response) => {
    if (request.url === "/api/dashboard") {
      writeDashboardSummary(response);
      return;
    }

    response.writeHead(200, { "content-type": "text/html" });
    response.end("<!doctype html><title>Service Admin</title>");
  });

  try {
    const report = await getDemoGateReport({
      runtimeUrl: `http://127.0.0.1:${runtimePort}`,
      serviceAdminUrl: `${admin.url}/`,
      workspaceRoot,
      timeoutMs: 100,
      recoveryTimeoutMs: 250,
      recoveryPollIntervalMs: 50,
      startDetachedRuntime: async () => ({
        pid: 12345,
        command: "fixture-runtime",
        logPath: path.join(workspaceRoot, "fixture-runtime.log"),
        servicesRoot: path.resolve("services"),
        workspaceRoot,
        port: runtimePort,
      }),
    });
    const persisted = JSON.parse(await readFile(report.paths.lifecycleStatePath, "utf8"));

    assert.equal(report.ok, false);
    assert.equal(report.classification, "service_startup_failure");
    assert.equal(report.gate.recovery.attempted, true);
    assert.match(report.gate.recovery.error, /Condition not met/);
    assert.equal(persisted.phase, "gate_blocked");
    assert.equal(persisted.classification, "service_startup_failure");
  } finally {
    await admin.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("demo watchdog exits cleanly through core lifecycle state when canonical endpoints are already healthy", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-demo-watchdog-"));
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
    if (request.url === "/api/dashboard") {
      writeDashboardSummary(response);
      return;
    }

    response.writeHead(200, { "content-type": "text/html" });
    response.end("<!doctype html><title>Service Admin</title>");
  });

  try {
    const result = await runNodeScript("demo-watchdog.mjs", [
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
    assert.equal(status.lifecycleState.phase, "watchdog_healthy");
    assert.equal(persisted.phase, "watchdog_healthy");
  } finally {
    await admin.close();
    await runtime.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("demo recycle exits cleanly through core lifecycle state when canonical endpoints are already healthy", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-demo-recycle-"));
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
    if (request.url === "/api/dashboard") {
      writeDashboardSummary(response);
      return;
    }

    response.writeHead(200, { "content-type": "text/html" });
    response.end("<!doctype html><title>Service Admin</title>");
  });

  try {
    const result = await runNodeScript("demo-recycle.mjs", [
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
    assert.equal(status.lifecycleState.phase, "recycle_verified_existing");
    assert.equal(persisted.phase, "recycle_verified_existing");
  } finally {
    await admin.close();
    await runtime.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("demo verify canonical exits non-zero when Service Admin returns HTML for the dashboard API", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-demo-verify-admin-html-"));
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
    const result = await runNodeScript("demo-verify-canonical.mjs", [
      `--runtime-url=${runtime.url}`,
      `--admin-url=${admin.url}/`,
      `--workspace-root=${workspaceRoot}`,
      "--json",
    ]);

    assert.equal(result.code, 1);
    const status = JSON.parse(result.stdout);

    assert.equal(status.ok, false);
    assert.equal(status.classification, "service_admin_api_non_json");
    assert.equal(status.endpoints.runtime.status, 200);
    assert.equal(status.endpoints.serviceAdmin.status, 200);
    assert.equal(status.endpoints.serviceAdmin.dashboardStatus, 200);
    assert.equal(status.endpoints.serviceAdmin.dashboardOk, false);
    assert.match(status.endpoints.serviceAdmin.dashboardError, /runtime JSON/);
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
