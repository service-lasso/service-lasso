import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "dist", "cli.js");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForJson(url, timeoutMs = 30_000) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return await response.json();
      }
      lastError = new Error(`Unexpected status ${response.status} from ${url}`);
    } catch (error) {
      lastError = error;
    }

    await sleep(250);
  }

  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

async function waitForCliSummary(cli, timeoutMs = 5_000) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      return JSON.parse(cli.stdout);
    } catch (error) {
      lastError = error;
      await sleep(100);
    }
  }

  throw lastError ?? new Error("Timed out waiting for CLI JSON summary.");
}

async function postJson(url) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(`POST ${url} failed with ${response.status}: ${JSON.stringify(body)}`);
  }

  return body;
}

async function reserveLoopbackPort() {
  const { createServer } = await import("node:net");
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to reserve loopback port.")));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeLongRunningService(servicesRoot, serviceId, options = {}) {
  const serviceRoot = path.join(servicesRoot, serviceId);
  const runtimeRoot = path.join(serviceRoot, "runtime");
  await mkdir(runtimeRoot, { recursive: true });
  const scriptPath = path.join(runtimeRoot, "service.mjs");
  await writeFile(
    scriptPath,
    [
      "const heartbeat = setInterval(() => {}, 1000);",
      "function shutdown() { clearInterval(heartbeat); process.exit(0); }",
      "process.on('SIGINT', shutdown);",
      "process.on('SIGTERM', shutdown);",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeJson(path.join(serviceRoot, "service.json"), {
    id: serviceId,
    name: serviceId,
    description: `Baseline smoke fixture for ${serviceId}.`,
    enabled: true,
    executable: process.execPath,
    args: [path.relative(serviceRoot, scriptPath)],
    depend_on: options.depend_on,
    healthcheck: { type: "process" },
    install: {
      files: [{ path: "./runtime/install.txt", content: "installed ${SERVICE_ID}\n" }],
    },
    config: {
      files: [{ path: "./runtime/config.txt", content: "configured ${SERVICE_ID}\n" }],
    },
  });
}

async function writeHttpService(servicesRoot, serviceId, portName, options = {}) {
  const serviceRoot = path.join(servicesRoot, serviceId);
  const runtimeRoot = path.join(serviceRoot, "runtime");
  await mkdir(runtimeRoot, { recursive: true });
  const scriptPath = path.join(runtimeRoot, "server.mjs");
  await writeFile(
    scriptPath,
    [
      "import { createServer } from 'node:http';",
      `const port = Number(process.env.${portName.toUpperCase()}_PORT ?? process.env.SERVICE_PORT ?? process.env.UI_PORT);`,
      "const server = createServer((request, response) => {",
      "  if (request.url === '/health') {",
      "    response.setHeader('content-type', 'application/json');",
      `    response.end(JSON.stringify({ ok: true, serviceId: ${JSON.stringify(serviceId)} }));`,
      "    return;",
      "  }",
      "  response.setHeader('content-type', 'text/plain; charset=utf-8');",
      `  response.end(${JSON.stringify(`${serviceId} ready`)});`,
      "});",
      "server.listen(port, '127.0.0.1');",
      "function shutdown() { server.close(() => process.exit(0)); }",
      "process.on('SIGINT', shutdown);",
      "process.on('SIGTERM', shutdown);",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeJson(path.join(serviceRoot, "service.json"), {
    id: serviceId,
    name: serviceId,
    description: `Baseline smoke HTTP fixture for ${serviceId}.`,
    enabled: true,
    executable: process.execPath,
    args: [path.relative(serviceRoot, scriptPath)],
    depend_on: options.depend_on,
    ports: options.ports,
    urls: options.urls,
    healthcheck: { type: "http", url: options.healthUrl, expected_status: 200, retries: 20, interval: 250 },
    install: {
      files: [{ path: "./runtime/install.txt", content: "installed ${SERVICE_ID}\n" }],
    },
    config: {
      files: [{ path: "./runtime/config.txt", content: "configured ${SERVICE_ID}\n" }],
    },
  });
}

function startCli({ servicesRoot, workspaceRoot, port }) {
  const child = spawn(
    process.execPath,
    [
      cliPath,
      "start",
      "--services-root",
      servicesRoot,
      "--workspace-root",
      workspaceRoot,
      "--port",
      String(port),
      "--json",
    ],
    {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  return { child, get stdout() { return stdout; }, get stderr() { return stderr; } };
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("close", resolve)),
    sleep(5_000).then(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }),
  ]);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-baseline-start-smoke-"));
const servicesRoot = path.join(tempRoot, "services");
const workspaceRoot = path.join(tempRoot, "workspace");
const apiPort = await reserveLoopbackPort();
const echoPort = await reserveLoopbackPort();
const adminPort = await reserveLoopbackPort();
let cli = null;
let servicesStopped = false;

try {
  await mkdir(servicesRoot, { recursive: true });
  await writeLongRunningService(servicesRoot, "@node");
  await writeLongRunningService(servicesRoot, "@traefik", { depend_on: ["@node"] });
  await writeHttpService(servicesRoot, "echo-service", "service", {
    depend_on: ["@node", "@traefik"],
    ports: { service: echoPort },
    urls: [{ label: "ui", url: "http://127.0.0.1:${SERVICE_PORT}/", kind: "local" }],
    healthUrl: `http://127.0.0.1:${echoPort}/health`,
  });
  await writeHttpService(servicesRoot, "service-admin", "ui", {
    depend_on: ["@node"],
    ports: { ui: adminPort },
    urls: [{ label: "ui", url: "http://127.0.0.1:${UI_PORT}/", kind: "local" }],
    healthUrl: `http://127.0.0.1:${adminPort}/health`,
  });

  cli = startCli({ servicesRoot, workspaceRoot, port: apiPort });
  const health = await waitForJson(`http://127.0.0.1:${apiPort}/api/health`);
  assert(health.status === "ok" && health.api?.status === "up", "API health did not report status=ok/api=up.");
  const cliSummary = await waitForCliSummary(cli);
  for (const service of cliSummary.services) {
    assert(service.state.installed === true, `${service.serviceId} was not installed in CLI summary.`);
    assert(service.state.configured === true, `${service.serviceId} was not configured in CLI summary.`);
    assert(service.state.running === true, `${service.serviceId} was not running in CLI summary.`);
  }

  const services = await waitForJson(`http://127.0.0.1:${apiPort}/api/services`);
  const serviceIds = services.services.map((service) => service.id).sort();
  assert(
    JSON.stringify(serviceIds) === JSON.stringify(["@node", "@traefik", "echo-service", "service-admin"]),
    `Unexpected service list: ${JSON.stringify(serviceIds)}`,
  );

  for (const serviceId of serviceIds) {
    const detail = await waitForJson(`http://127.0.0.1:${apiPort}/api/services/${encodeURIComponent(serviceId)}`);
    const service = detail.service;
    assert(service?.lifecycle?.installed === true, `${serviceId} was not installed.`);
    assert(service.lifecycle?.configured === true, `${serviceId} was not configured.`);
    assert(service.lifecycle?.running === true, `${serviceId} was not running.`);
    assert(service.health?.healthy === true, `${serviceId} health did not report healthy.`);
  }

  const echo = await fetch(`http://127.0.0.1:${echoPort}/health`);
  assert(echo.ok, "Echo Service health surface was not reachable.");
  const admin = await fetch(`http://127.0.0.1:${adminPort}/health`);
  assert(admin.ok, "Service Admin health surface was not reachable.");

  await postJson(`http://127.0.0.1:${apiPort}/api/runtime/actions/stopAll`);
  servicesStopped = true;
  console.log("[service-lasso baseline] start smoke passed");
} catch (error) {
  if (cli) {
    console.error("[service-lasso baseline] CLI stdout:");
    console.error(cli.stdout);
    console.error("[service-lasso baseline] CLI stderr:");
    console.error(cli.stderr);
  }
  throw error;
} finally {
  if (cli) {
    if (!servicesStopped) {
      try {
        await postJson(`http://127.0.0.1:${apiPort}/api/runtime/actions/stopAll`);
      } catch {}
    }
    await stopChild(cli.child);
  }
  await rm(tempRoot, { recursive: true, force: true });
}
