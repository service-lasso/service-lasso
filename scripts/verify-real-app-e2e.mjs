import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startApiServer } from "../dist/server/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "dist", "cli.js");
const sourceServicesRoot = path.join(repoRoot, "services");
const baselineServiceIds = ["@java", "@localcert", "@nginx", "@node", "@secretsbroker", "@serviceadmin", "@traefik", "echo-service"];
const providerServiceIds = new Set(["@java", "@localcert", "@node"]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const allocatedLoopbackPorts = new Set();
const testPortStart = Number(process.env.SERVICE_LASSO_E2E_PORT_START ?? 17880);
const testPortEnd = Number(process.env.SERVICE_LASSO_E2E_PORT_END ?? 17980);
let nextLoopbackPort = testPortStart;

async function hasLoopbackListener(port) {
  const { createConnection } = await import("node:net");
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => socket.destroy() && resolve(true));
    socket.once("error", () => resolve(false));
    socket.setTimeout(500, () => socket.destroy() && resolve(false));
  });
}

async function canBindLoopbackPort(port) {
  if (await hasLoopbackListener(port)) return false;
  const { createServer } = await import("node:net");
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "0.0.0.0", () => {
      server.close(() => resolve(true));
    });
  });
}

async function reserveLoopbackPort() {
  if (!Number.isInteger(testPortStart) || !Number.isInteger(testPortEnd) || testPortStart <= 0 || testPortEnd < testPortStart) {
    throw new Error(`Invalid SERVICE_LASSO_E2E_PORT_START/END range: ${testPortStart}-${testPortEnd}`);
  }

  for (let port = nextLoopbackPort; port <= testPortEnd; port += 1) {
    if (allocatedLoopbackPorts.has(port)) continue;
    if (!(await canBindLoopbackPort(port))) continue;
    allocatedLoopbackPorts.add(port);
    nextLoopbackPort = port + 1;
    return port;
  }

  throw new Error(`No free loopback ports remained in Service Lasso E2E range ${testPortStart}-${testPortEnd}.`);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 30_000) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
}

async function waitForJson(url, timeoutMs = 300_000) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetchWithTimeout(url, {}, 10_000);
      const text = await response.text().catch(() => "");
      const body = text ? JSON.parse(text) : null;
      if (response.ok && body && typeof body === "object") {
        return body;
      }
      lastError = new Error(`GET ${url} failed with ${response.status} or non-JSON/empty body: ${text.slice(0, 500)}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }

  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

async function waitForText(url, timeoutMs = 300_000) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetchWithTimeout(url, {}, 10_000);
      const body = await response.text().catch(() => "");
      if (response.ok) {
        return body;
      }
      lastError = new Error(`GET ${url} failed with ${response.status}: ${body.slice(0, 500)}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }

  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

async function postJson(url) {
  const response = await fetchWithTimeout(url, {
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

function startCli({ servicesRoot, workspaceRoot, port, servicePortStart }) {
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
      env: {
        ...process.env,
        SERVICE_LASSO_PORT_RANGE_START: String(servicePortStart),
        SERVICE_LASSO_PORT_RANGE_END: String(testPortEnd),
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
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

  const closed = new Promise((resolve) => {
    child.once("close", (code, signal) => resolve({ code, signal }));
  });

  return { child, closed, get stdout() { return stdout; }, get stderr() { return stderr; } };
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  const closed = new Promise((resolve) => child.once("close", resolve));
  child.kill("SIGTERM");
  const terminated = await Promise.race([
    closed.then(() => true),
    sleep(5_000).then(() => false),
  ]);

  if (!terminated && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await Promise.race([closed, sleep(5_000)]);
  }
}

async function copyCheckedInServices(targetServicesRoot) {
  await mkdir(targetServicesRoot, { recursive: true });
  await cp(sourceServicesRoot, targetServicesRoot, {
    recursive: true,
    filter: (source) => {
      const normalized = source.replaceAll(path.sep, "/");
      return !normalized.includes("/.state") && !normalized.includes("/logs") && !normalized.includes("/data");
    },
  });
}

async function rebaseManifestPorts(targetServicesRoot) {
  for (const serviceId of baselineServiceIds) {
    const manifestPath = path.join(targetServicesRoot, serviceId, "service.json");
    const manifest = await readJson(manifestPath);
    if (!manifest.ports || typeof manifest.ports !== "object" || Array.isArray(manifest.ports)) {
      continue;
    }

    const rebasedPorts = {};
    for (const portName of Object.keys(manifest.ports)) {
      rebasedPorts[portName] = await reserveLoopbackPort();
    }
    manifest.ports = rebasedPorts;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }
}

async function readTextIfPresent(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function printRuntimeLogs(servicesRoot, serviceId) {
  const logsRoot = path.join(servicesRoot, serviceId, "logs", "runtime");
  console.error(`[service-lasso e2e] ${serviceId} stdout:`);
  console.error(await readTextIfPresent(path.join(logsRoot, "stdout.log")));
  console.error(`[service-lasso e2e] ${serviceId} stderr:`);
  console.error(await readTextIfPresent(path.join(logsRoot, "stderr.log")));
  console.error(`[service-lasso e2e] ${serviceId} service log:`);
  console.error(await readTextIfPresent(path.join(logsRoot, "service.log")));
}

async function waitForHealthyHttp(url, label, timeoutMs = 300_000) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetchWithTimeout(url, {}, 10_000);
      if (response.ok) {
        return;
      }
      const body = await response.text().catch(() => "");
      lastError = new Error(`${label} endpoint ${url} returned ${response.status}: ${body.slice(0, 500)}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }

  throw lastError ?? new Error(`Timed out waiting for ${label} endpoint ${url}`);
}

async function waitForServiceState(apiUrl, serviceId, expected, timeoutMs = 300_000) {
  const { running } = expected;
  const healthy = Object.hasOwn(expected, "healthy") ? expected.healthy : true;
  console.error(`[service-lasso e2e] waiting for ${serviceId} running=${running} healthy=${healthy ?? "any"}`);
  const startedAt = Date.now();
  let lastService = null;

  while (Date.now() - startedAt < timeoutMs) {
    const detail = await waitForJson(`${apiUrl}/api/services/${encodeURIComponent(serviceId)}`);
    const service = detail.service;
    assert(service?.id === serviceId, `${serviceId} detail returned the wrong service.`);
    lastService = service;

    if (
      service.lifecycle?.installed === true &&
      service.lifecycle?.configured === true &&
      service.lifecycle?.running === running &&
      (healthy === undefined || service.health?.healthy === healthy)
    ) {
      console.error(`[service-lasso e2e] ${serviceId} reached expected state`);
      return service;
    }

    await sleep(500);
  }

  throw new Error(`${serviceId} did not reach installed/configured/running=${running}/healthy=${healthy ?? "any"}. Last service state: ${JSON.stringify(lastService)}`);
}

const e2eTempParent = path.join(repoRoot, ".tmp", "e2e");
await mkdir(e2eTempParent, { recursive: true });
const tempRoot = await mkdtemp(path.join(e2eTempParent, "real-app-"));
const servicesRoot = path.join(tempRoot, "services");
const workspaceRoot = path.join(tempRoot, "workspace");
const apiPort = await reserveLoopbackPort();
const apiUrl = `http://127.0.0.1:${apiPort}`;
let cli = null;
let apiServer = null;
let servicesStopped = false;

try {
  console.error(`[service-lasso e2e] temp root ${tempRoot}`);
  await copyCheckedInServices(servicesRoot);
  await rebaseManifestPorts(servicesRoot);
  const serviceAdminManifest = await readJson(path.join(servicesRoot, "@serviceadmin", "service.json"));
  const secretsBrokerManifest = await readJson(path.join(servicesRoot, "@secretsbroker", "service.json"));
  const nginxManifest = await readJson(path.join(servicesRoot, "@nginx", "service.json"));
  const traefikManifest = await readJson(path.join(servicesRoot, "@traefik", "service.json"));
  const echoManifest = await readJson(path.join(servicesRoot, "echo-service", "service.json"));

  cli = startCli({ servicesRoot, workspaceRoot, port: apiPort, servicePortStart: apiPort + 1 });

  let health = null;
  const apiDeadline = Date.now() + 300_000;
  while (Date.now() < apiDeadline && !health) {
    const closed = await Promise.race([cli.closed, sleep(250).then(() => null)]);
    if (closed) {
      if (closed.code !== 0) {
        throw new Error(`dist/cli.js start exited with code ${closed.code ?? "null"} signal ${closed.signal ?? "null"}. stderr: ${cli.stderr}`);
      }
      apiServer = await startApiServer({ servicesRoot, workspaceRoot, port: apiPort });
      break;
    }

    try {
      health = await waitForJson(`${apiUrl}/api/health`, 250);
    } catch {}
  }

  health ??= await waitForJson(`${apiUrl}/api/health`);
  assert(health.status === "ok" && health.api?.status === "up", "Core API health did not report ok/up.");

  const services = await waitForJson(`${apiUrl}/api/services`);
  const serviceIds = services.services.map((service) => service.id).sort();
  for (const serviceId of baselineServiceIds) {
    assert(serviceIds.includes(serviceId), `Real app service list is missing ${serviceId}.`);
  }

  for (const serviceId of baselineServiceIds) {
    const isProvider = providerServiceIds.has(serviceId);
    await waitForServiceState(apiUrl, serviceId, { running: !isProvider, healthy: isProvider ? undefined : true });
  }

  console.error("[service-lasso e2e] baseline services reached expected state");
  const dashboard = await waitForJson(`${apiUrl}/api/dashboard`);
  assert(dashboard.summary?.servicesTotal >= baselineServiceIds.length, "Dashboard summary did not include baseline services.");
  assert(dashboard.summary?.servicesRunning >= baselineServiceIds.length - providerServiceIds.size, "Dashboard running count is lower than expected baseline daemons.");

  const dashboardServices = await waitForJson(`${apiUrl}/api/dashboard/services`);
  const dashboardIds = new Set(dashboardServices.services.map((service) => service.id));
  for (const serviceId of baselineServiceIds) {
    assert(dashboardIds.has(serviceId), `Dashboard service list is missing ${serviceId}.`);
  }
  for (const serviceId of providerServiceIds) {
    const service = dashboardServices.services.find((entry) => entry.id === serviceId);
    assert(service?.status === "available", `${serviceId} provider utility did not report Available status.`);
    assert(service?.runtimeHealth?.state === "available", `${serviceId} provider runtime state did not report Available.`);
  }

  await waitForHealthyHttp(`http://127.0.0.1:${serviceAdminManifest.ports.ui}/`, "Service Admin UI");
  await waitForHealthyHttp(`http://127.0.0.1:${serviceAdminManifest.ports.ui}/health`, "Service Admin health");
  await waitForHealthyHttp(`http://127.0.0.1:${secretsBrokerManifest.ports.service}/health`, "Secrets Broker health");
  await waitForHealthyHttp(`http://127.0.0.1:${nginxManifest.ports.http}/health`, "NGINX health");
  await waitForHealthyHttp(`http://127.0.0.1:${echoManifest.ports.service}/health`, "Echo Service health");
  await waitForHealthyHttp(`http://127.0.0.1:${traefikManifest.ports.admin}/ping`, "Traefik ping");

  const serviceAdminHtml = await waitForText(`http://127.0.0.1:${serviceAdminManifest.ports.ui}/`);
  assert(/Service Lasso|service-lasso|root/i.test(serviceAdminHtml), "Service Admin UI root did not return recognizable app content.");

  const stopBroker = await postJson(`${apiUrl}/api/services/${encodeURIComponent("@secretsbroker")}/stop`);
  assert(stopBroker.ok === true, "Stopping @secretsbroker did not return ok=true.");
  await waitForServiceState(apiUrl, "@secretsbroker", { running: false, healthy: undefined });

  const startBroker = await postJson(`${apiUrl}/api/services/${encodeURIComponent("@secretsbroker")}/start`);
  assert(startBroker.ok === true, "Starting @secretsbroker did not return ok=true.");
  await waitForServiceState(apiUrl, "@secretsbroker", { running: true });
  await waitForHealthyHttp(`http://127.0.0.1:${secretsBrokerManifest.ports.service}/health`, "Secrets Broker health after restart");

  await postJson(`${apiUrl}/api/runtime/actions/stopAll`);
  servicesStopped = true;
  console.log("[service-lasso e2e] real app baseline state gate passed");
} catch (error) {
  if (cli) {
    console.error("[service-lasso e2e] CLI stdout:");
    console.error(cli.stdout);
    console.error("[service-lasso e2e] CLI stderr:");
    console.error(cli.stderr);
  }
  for (const serviceId of baselineServiceIds) {
    await printRuntimeLogs(servicesRoot, serviceId);
  }
  throw error;
} finally {
  if (!servicesStopped) {
    try {
      await postJson(`${apiUrl}/api/runtime/actions/stopAll`);
      servicesStopped = true;
    } catch {}
  }
  if (apiServer) {
    await apiServer.stop();
  }
  if (cli) {
    await stopChild(cli.child);
  }
  await rm(tempRoot, { recursive: true, force: true });
}
