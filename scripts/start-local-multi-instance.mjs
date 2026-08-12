import { spawn } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "dist", "cli.js");
const sourceServicesRoot = path.join(repoRoot, "services");
const localRunRoot = path.join(repoRoot, ".tmp", "local-run");
const portStart = Number(process.env.SERVICE_LASSO_MULTI_PORT_START ?? 17880);
const portEnd = Number(process.env.SERVICE_LASSO_MULTI_PORT_END ?? 17980);
const baselineIds = ["@nginx", "@secretsbroker", "@serviceadmin", "@traefik", "echo-service"];
const keepTemp = process.argv.includes("--keep-temp");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function encodeServiceId(id) {
  return encodeURIComponent(id);
}

async function canBind(port) {
  const server = net.createServer();
  return new Promise((resolve) => {
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

async function assertPortFree(port) {
  assert(await canBind(port), `Port ${port} is already in use. Stop the existing local instance first, or choose another range.`);
}

async function waitForJson(url, timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      const body = await response.json().catch(() => null);
      if (response.ok) return body;
      lastError = new Error(`${url} returned ${response.status}: ${JSON.stringify(body)}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
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

function directReleaseAssetUrl(repo, tag, assetName) {
  return `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(assetName)}`;
}

async function injectDirectAssetUrls(servicesRoot) {
  async function walk(directory) {
    const entries = await import("node:fs/promises").then((fs) => fs.readdir(directory, { withFileTypes: true }));
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === ".state" || entry.name === "logs" || entry.name === "data") continue;
        await walk(fullPath);
      } else if (entry.name === "service.json") {
        const manifest = JSON.parse(await readFile(fullPath, "utf8"));
        const artifact = manifest.artifact;
        if (artifact?.kind !== "archive" || artifact.source?.type !== "github-release" || !artifact.source.repo || !artifact.source.tag) continue;
        for (const platform of Object.values(artifact.platforms ?? {})) {
          if (platform?.assetName && !platform.assetUrl) {
            platform.assetUrl = directReleaseAssetUrl(artifact.source.repo, artifact.source.tag, platform.assetName);
          }
        }
        await writeFile(fullPath, `${JSON.stringify(manifest, null, 2)}\n`);
      }
    }
  }
  await walk(servicesRoot);
}

function startInstance(instance) {
  const stdoutPath = path.join(instance.root, "service-lasso.stdout.log");
  const stderrPath = path.join(instance.root, "service-lasso.stderr.log");
  const child = spawn(process.execPath, [
    cliPath,
    "start",
    "--services-root",
    instance.servicesRoot,
    "--workspace-root",
    instance.workspaceRoot,
    "--port",
    String(instance.apiPort),
    "--json",
  ], {
    cwd: repoRoot,
    env: {
      ...process.env,
      SERVICE_LASSO_PORT_RANGE_START: String(instance.servicePortStart),
      SERVICE_LASSO_PORT_RANGE_END: String(instance.servicePortEnd),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: true,
  });

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout += chunk.toString();
    void writeFile(stdoutPath, stdout);
  });
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
    void writeFile(stderrPath, stderr);
  });
  child.unref();
  const closed = new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
  return { child, closed, stdoutPath, stderrPath, get stdout() { return stdout; }, get stderr() { return stderr; } };
}

async function createInstance(label, apiPort, servicePortStart, servicePortEnd) {
  const root = path.join(localRunRoot, label);
  const servicesRoot = path.join(root, "services");
  const workspaceRoot = path.join(root, ".workspace");
  await rm(root, { recursive: true, force: true });
  await mkdir(workspaceRoot, { recursive: true });
  await copyServices(servicesRoot);
  await injectDirectAssetUrls(servicesRoot);
  return { label, root, servicesRoot, workspaceRoot, apiPort, apiUrl: `http://127.0.0.1:${apiPort}`, servicePortStart, servicePortEnd, process: null };
}

async function verifyInstance(instance) {
  const health = await waitForJson(`${instance.apiUrl}/api/health`);
  assert(health.status === "ok", `${instance.label} API did not report ok.`);

  for (const id of baselineIds) {
    const detail = await waitForJson(`${instance.apiUrl}/api/services/${encodeServiceId(id)}`);
    assert(detail.service.lifecycle.installed === true, `${instance.label} ${id} is not installed.`);
    assert(detail.service.lifecycle.configured === true, `${instance.label} ${id} is not configured.`);
    assert(detail.service.lifecycle.running === true, `${instance.label} ${id} is not running.`);
    assert(detail.service.health.healthy === true, `${instance.label} ${id} is not healthy.`);

    for (const port of Object.values(detail.service.lifecycle.runtime.ports ?? {})) {
      assert(port >= instance.servicePortStart && port <= instance.servicePortEnd, `${instance.label} ${id} port ${port} escaped ${instance.servicePortStart}-${instance.servicePortEnd}.`);
    }
  }
}

assert(Number.isInteger(portStart) && Number.isInteger(portEnd) && portStart > 0 && portEnd >= portStart && portEnd <= 65535, `Invalid SERVICE_LASSO_MULTI_PORT_START/END: ${portStart}-${portEnd}`);
assert(portEnd - portStart >= 20, `Port range ${portStart}-${portEnd} is too small for two local instances.`);
await assertPortFree(portStart);
await assertPortFree(portStart + 1);
await mkdir(localRunRoot, { recursive: true });

const firstServicePort = portStart + 2;
const midpoint = Math.floor((firstServicePort + portEnd) / 2);
const instances = [
  await createInstance("a", portStart, firstServicePort, midpoint),
  await createInstance("b", portStart + 1, midpoint + 1, portEnd),
];

try {
  for (const instance of instances) instance.process = startInstance(instance);
  for (const instance of instances) await verifyInstance(instance);

  const rows = [];
  const usedPorts = [];
  for (const instance of instances) {
    usedPorts.push(instance.apiPort);
    const serviceRows = [];
    for (const id of baselineIds) {
      const detail = await waitForJson(`${instance.apiUrl}/api/services/${encodeServiceId(id)}`);
      const ports = detail.service.lifecycle.runtime.ports ?? {};
      usedPorts.push(...Object.values(ports));
      serviceRows.push({ id, ports });
    }
    rows.push({ label: instance.label, apiUrl: instance.apiUrl, servicePortRange: `${instance.servicePortStart}-${instance.servicePortEnd}`, services: serviceRows, stdout: instance.process.stdoutPath, stderr: instance.process.stderrPath });
  }

  const uniquePorts = new Set(usedPorts);
  assert(uniquePorts.size === usedPorts.length, `Expected unique ports across instances, got duplicates: ${usedPorts.join(", ")}`);
  for (const port of usedPorts) assert(port >= portStart && port <= portEnd, `Port ${port} escaped ${portStart}-${portEnd}.`);

  console.log(JSON.stringify({ ok: true, portRange: `${portStart}-${portEnd}`, localRunRoot, instances: rows }, null, 2));
  console.log("[service-lasso local] two local instances are running and healthy");
} catch (error) {
  for (const instance of instances) {
    if (instance.process) {
      console.error(`[${instance.label}] stdout log: ${instance.process.stdoutPath}`);
      console.error(instance.process.stdout);
      console.error(`[${instance.label}] stderr log: ${instance.process.stderrPath}`);
      console.error(instance.process.stderr);
    }
  }
  if (!keepTemp) {
    for (const instance of instances) await rm(instance.root, { recursive: true, force: true });
  }
  throw error;
}
