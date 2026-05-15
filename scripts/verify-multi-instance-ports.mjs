import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "dist", "cli.js");
const sourceServicesRoot = path.join(repoRoot, "services");
const tempParent = path.join(repoRoot, ".tmp", "multi-instance");
const portStart = Number(process.env.SERVICE_LASSO_MULTI_PORT_START ?? 17880);
const portEnd = Number(process.env.SERVICE_LASSO_MULTI_PORT_END ?? 17980);
const baselineIds = ["@nginx", "@secretsbroker", "@serviceadmin", "@traefik", "echo-service"];
const allocated = new Set();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function hasLoopbackListener(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => socket.destroy() && resolve(true));
    socket.once("error", () => resolve(false));
    socket.setTimeout(500, () => socket.destroy() && resolve(false));
  });
}

async function canBind(port) {
  if (await hasLoopbackListener(port)) return false;
  const server = net.createServer();
  return new Promise((resolve) => {
    server.once("error", () => resolve(false));
    server.listen(port, "0.0.0.0", () => server.close(() => resolve(true)));
  });
}

async function reservePort() {
  for (let port = portStart; port <= portEnd; port += 1) {
    if (allocated.has(port)) continue;
    if (!(await canBind(port))) continue;
    allocated.add(port);
    return port;
  }
  throw new Error(`No free ports remain in ${portStart}-${portEnd}.`);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 30_000) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
}

async function waitForJson(url, timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetchWithTimeout(url, {}, 10_000);
      const text = await response.text().catch(() => "");
      const body = text ? JSON.parse(text) : null;
      if (response.ok && body && typeof body === "object") return body;
      lastError = new Error(`${url} returned ${response.status} with non-JSON/empty body: ${text.slice(0, 500)}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

async function postJson(url) {
  const response = await fetchWithTimeout(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`POST ${url} returned ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

function appendCapped(existing, chunk, maxLength = 200_000) {
  const next = existing + chunk.toString();
  return next.length > maxLength ? next.slice(next.length - maxLength) : next;
}

function startInstance({ servicesRoot, workspaceRoot, apiPort, servicePortStart, servicePortEnd }) {
  const child = spawn(process.execPath, [
    cliPath,
    "start",
    "--services-root",
    servicesRoot,
    "--workspace-root",
    workspaceRoot,
    "--port",
    String(apiPort),
    "--json",
  ], {
    cwd: repoRoot,
    env: {
      ...process.env,
      SERVICE_LASSO_PORT_RANGE_START: String(servicePortStart),
      SERVICE_LASSO_PORT_RANGE_END: String(servicePortEnd),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => { stdout = appendCapped(stdout, chunk); });
  child.stderr?.on("data", (chunk) => { stderr = appendCapped(stderr, chunk); });
  const closed = new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
  return { child, closed, get stdout() { return stdout; }, get stderr() { return stderr; } };
}

async function stopInstance(instance, apiUrl) {
  try { await postJson(`${apiUrl}/api/runtime/actions/stopAll`); } catch {}
  if (instance.child.exitCode === null && instance.child.signalCode === null) {
    const closed = new Promise((resolve) => instance.child.once("close", resolve));
    instance.child.kill("SIGTERM");
    if (!(await Promise.race([closed.then(() => true), sleep(5_000).then(() => false)]))) {
      instance.child.kill("SIGKILL");
      await Promise.race([closed, sleep(5_000)]);
    }
  }
}

async function copyServices(target) {
  await mkdir(target, { recursive: true });
  await cp(sourceServicesRoot, target, {
    recursive: true,
    filter: (source) => {
      const normalized = source.replaceAll(path.sep, "/");
      return !normalized.includes("/.state") && !normalized.includes("/logs") && !normalized.includes("/data");
    },
  });
}

async function createInstance(label, apiPort, servicePortStart, servicePortEnd) {
  const root = await mkdtemp(path.join(tempParent, `${label}-`));
  const servicesRoot = path.join(root, "services");
  const workspaceRoot = path.join(root, "workspace");
  await copyServices(servicesRoot);
  return { label, root, servicesRoot, workspaceRoot, apiPort, apiUrl: `http://127.0.0.1:${apiPort}`, servicePortStart, servicePortEnd, process: null };
}

async function verifyInstance(instance) {
  console.error(`[service-lasso multi-instance] verifying ${instance.label} API ${instance.apiUrl} with service ports ${instance.servicePortStart}-${instance.servicePortEnd}`);
  const health = await waitForJson(`${instance.apiUrl}/api/health`);
  assert(health && health.status === "ok", `${instance.label} API did not report ok: ${JSON.stringify(health)}`);
  const services = await waitForJson(`${instance.apiUrl}/api/services`);
  assert(Array.isArray(services?.services), `${instance.label} services response was invalid: ${JSON.stringify(services)}`);
  const ids = new Set(services.services.map((service) => service.id));
  for (const id of baselineIds) assert(ids.has(id), `${instance.label} is missing ${id}.`);
  for (const id of baselineIds) {
    const detail = await waitForJson(`${instance.apiUrl}/api/services/${encodeURIComponent(id)}`);
    assert(detail.service.lifecycle.installed === true, `${instance.label} ${id} was not installed.`);
    assert(detail.service.lifecycle.configured === true, `${instance.label} ${id} was not configured.`);
  }
  console.error(`[service-lasso multi-instance] ${instance.label} baseline services installed and configured`);
}

await mkdir(tempParent, { recursive: true });
const apiPorts = [await reservePort(), await reservePort()];
const firstServicePort = Math.max(...apiPorts) + 1;
assert(firstServicePort <= portEnd, `Port range ${portStart}-${portEnd} has no room for service ports after API ports ${apiPorts.join(", ")}.`);
const midpoint = Math.floor((firstServicePort + portEnd) / 2);
const instances = [
  await createInstance("a", apiPorts[0], firstServicePort, midpoint),
  await createInstance("b", apiPorts[1], midpoint + 1, portEnd),
];

try {
  console.error(`[service-lasso multi-instance] reserved API ports ${apiPorts.join(", ")}; service port ranges ${instances.map((instance) => `${instance.label}:${instance.servicePortStart}-${instance.servicePortEnd}`).join(", ")}`);
  for (const instance of instances) instance.process = startInstance(instance);
  for (const instance of instances) await verifyInstance(instance);

  const usedPorts = [];
  for (const instance of instances) {
    usedPorts.push(instance.apiPort);
    for (const id of baselineIds) {
      const detail = await waitForJson(`${instance.apiUrl}/api/services/${encodeURIComponent(id)}`);
      for (const port of Object.values(detail.service.lifecycle.runtime.ports ?? {})) usedPorts.push(port);
    }
  }

  const uniquePorts = new Set(usedPorts);
  assert(uniquePorts.size === usedPorts.length, `Expected unique ports across instances, got duplicates: ${usedPorts.join(", ")}`);
  for (const instance of instances) {
    const detailPorts = [];
    for (const id of baselineIds) {
      const detail = await waitForJson(`${instance.apiUrl}/api/services/${encodeURIComponent(id)}`);
      detailPorts.push(...Object.values(detail.service.lifecycle.runtime.ports ?? {}));
    }
    for (const port of detailPorts) {
      assert(port >= instance.servicePortStart && port <= instance.servicePortEnd, `${instance.label} service port ${port} escaped ${instance.servicePortStart}-${instance.servicePortEnd}.`);
    }
  }
  for (const port of usedPorts) assert(port >= portStart && port <= portEnd, `Port ${port} escaped ${portStart}-${portEnd}.`);

  console.log(`[service-lasso multi-instance] two instances passed in ${portStart}-${portEnd}`);
} catch (error) {
  for (const instance of instances) {
    if (instance.process) {
      console.error(`[${instance.label}] stdout:`);
      console.error(instance.process.stdout);
      console.error(`[${instance.label}] stderr:`);
      console.error(instance.process.stderr);
    }
  }
  throw error;
} finally {
  for (const instance of instances) {
    if (instance.process) await stopInstance(instance.process, instance.apiUrl);
  }
  for (const instance of instances) await rm(instance.root, { recursive: true, force: true });
}
