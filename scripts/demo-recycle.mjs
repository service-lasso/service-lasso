import { spawn } from "node:child_process";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import { resolveDemoOptions, runDemoRecycle } from "./demo-instance-lib.mjs";

const options = resolveDemoOptions();

async function commandOutput(command, args) {
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.once("close", (code) => resolve(code === 0 ? stdout.trim() : ""));
    child.once("error", () => resolve(""));
  });
}

const endpointsFor = (apiUrl = `http://127.0.0.1:${options.port}`) => ({
  runtimeApiHealth: `${apiUrl}/api/health`,
  serviceAdminRoot: "http://127.0.0.1:17700/",
  serviceAdminHealth: "http://127.0.0.1:17700/health",
  secretsBrokerHealth: "http://127.0.0.1:17890/health",
  echoHealth: "http://127.0.0.1:4011/health",
  runtimeServices: `${apiUrl}/api/services`,
});

async function waitForEndpoint(url, timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (response.status >= 200 && response.status < 300) {
        return response.status;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`${url} did not become reachable: ${lastError || "timeout"}`);
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function getGitSummary() {
  const [branch, commit] = await Promise.all([
    commandOutput("git", ["branch", "--show-current"]),
    commandOutput("git", ["rev-parse", "--short=12", "HEAD"]),
  ]);

  return {
    branch: branch || "unknown",
    commit: commit || "unknown",
  };
}

async function waitForLiveDemo() {
  const endpoints = endpointsFor();
  const statuses = {};

  for (const [name, url] of Object.entries(endpoints)) {
    statuses[name] = {
      url,
      status: await waitForEndpoint(url),
    };
  }

  return statuses;
}

async function getLiveServiceSummary(apiUrl) {
  const result = await fetchJson(`${apiUrl}/api/services`);
  if (result.status !== 200 || !Array.isArray(result.body.services)) {
    return [];
  }

  return result.body.services
    .filter((service) => ["@serviceadmin", "@secretsbroker", "echo-service", "@node", "node-sample-service"].includes(service.id))
    .map((service) => ({
      id: service.id,
      running: service.lifecycle?.running === true,
      healthy: service.health?.healthy === true,
    }));
}

function sameResolvedPath(left, right) {
  const leftResolved = path.resolve(String(left ?? ""));
  const rightResolved = path.resolve(String(right ?? ""));
  return process.platform === "win32"
    ? leftResolved.toLowerCase() === rightResolved.toLowerCase()
    : leftResolved === rightResolved;
}

async function assertLiveRuntimeOwnedByChild(apiUrl, childPid) {
  const result = await fetchJson(`${apiUrl}/api/runtime/instance`);
  const instance = result.body.instance;
  const mismatches = [];

  if (result.status !== 200 || !instance) {
    throw new Error(`Detached demo recycle could not verify runtime ownership at ${apiUrl}/api/runtime/instance.`);
  }
  if (instance.pid !== childPid) {
    mismatches.push(`pid expected ${childPid}, got ${instance.pid ?? "missing"}`);
  }
  if (instance.apiPort !== options.port) {
    mismatches.push(`apiPort expected ${options.port}, got ${instance.apiPort ?? "missing"}`);
  }
  if (!sameResolvedPath(instance.servicesRoot, options.servicesRoot)) {
    mismatches.push(`servicesRoot expected ${options.servicesRoot}, got ${instance.servicesRoot ?? "missing"}`);
  }
  if (!sameResolvedPath(instance.workspaceRoot, options.workspaceRoot)) {
    mismatches.push(`workspaceRoot expected ${options.workspaceRoot}, got ${instance.workspaceRoot ?? "missing"}`);
  }

  if (mismatches.length > 0) {
    throw new Error(
      `Detached demo recycle produced stale runtime ownership: ${mismatches.join("; ")}. The live endpoints are not owned by the newly spawned foreground worker.`,
    );
  }

  return instance;
}

function printResult(result) {
  console.log("[service-lasso demo] recycle passed");
  console.log(`- api: ${result.apiUrl}`);
  console.log(`- serviceAdmin: ${result.serviceAdminUrl}`);
  console.log(`- servicesRoot: ${result.servicesRoot}`);
  console.log(`- workspaceRoot: ${result.workspaceRoot}`);
  console.log(`- git: ${result.git.branch}@${result.git.commit}`);
  console.log(`- services: ${result.services.map((service) => `${service.id}:running=${service.running}:healthy=${service.healthy}`).join(", ")}`);
  console.log("- endpoints:");
  for (const [name, endpoint] of Object.entries(result.endpoints)) {
    console.log(`  - ${name}: ${endpoint.status} ${endpoint.url}`);
  }
}

async function runForegroundWorker() {
  const result = await runDemoRecycle({ ...options, preserve: true, keepAlive: true });
  printResult(result);

  await new Promise((resolve) => {
    const shutdown = () => resolve();
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}

async function runDetachedRecycle() {
  const logsRoot = path.join(process.cwd(), ".demo-logs");
  await mkdir(logsRoot, { recursive: true });

  const stdout = await open(path.join(logsRoot, "demo-recycle.out.log"), "a");
  const stderr = await open(path.join(logsRoot, "demo-recycle.err.log"), "a");
  const args = [
    path.resolve("scripts", "demo-recycle.mjs"),
    "--foreground",
    "--preserve",
    `--services-root=${options.servicesRoot}`,
    `--workspace-root=${options.workspaceRoot}`,
    `--port=${options.port}`,
  ];

  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    detached: true,
    stdio: ["ignore", stdout.fd, stderr.fd],
    windowsHide: true,
    env: {
      ...process.env,
      SERVICE_LASSO_PORT: String(options.port),
    },
  });

  child.unref();

  try {
    const apiUrl = `http://127.0.0.1:${options.port}`;
    const endpoints = await waitForLiveDemo();
    const instance = await assertLiveRuntimeOwnedByChild(apiUrl, child.pid);
    const [git, services] = await Promise.all([
      getGitSummary(),
      getLiveServiceSummary(apiUrl),
    ]);
    console.log("[service-lasso demo] recycle passed");
    console.log(`- api: ${apiUrl}`);
    console.log("- serviceAdmin: http://127.0.0.1:17700");
    console.log(`- servicesRoot: ${options.servicesRoot}`);
    console.log(`- workspaceRoot: ${options.workspaceRoot}`);
    console.log(`- git: ${git.branch}@${git.commit}`);
    console.log("- mode: detached live demo");
    console.log(`- pid: ${child.pid}`);
    console.log(`- runtimeOwner: ${instance.instanceId} pid=${instance.pid}`);
    console.log(`- logs: ${logsRoot}`);
    console.log(`- services: ${services.map((service) => `${service.id}:running=${service.running}:healthy=${service.healthy}`).join(", ")}`);
    console.log("- endpoints:");
    for (const [name, endpoint] of Object.entries(endpoints)) {
      console.log(`  - ${name}: ${endpoint.status} ${endpoint.url}`);
    }
  } catch (error) {
    child.kill("SIGTERM");
    throw error;
  } finally {
    await stdout.close();
    await stderr.close();
  }
}

if (options.foreground) {
  await runForegroundWorker();
} else {
  await runDetachedRecycle();
}
