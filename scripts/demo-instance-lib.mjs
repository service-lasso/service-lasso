import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { access, readFile, rm } from "node:fs/promises";
import net from "node:net";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(scriptDir, "..");
export const defaultDemoServicesRoot = path.join(repoRoot, "services");
export const defaultDemoWorkspaceRoot = path.join(repoRoot, "workspace", "demo-instance");
export const demoRequiredServiceIds = ["@archive", "@java", "@localcert", "@nginx", "@traefik", "@node", "@secretsbroker", "echo-service", "@serviceadmin"];
export const demoServiceIds = [...demoRequiredServiceIds, "node-sample-service"];
export const demoProviderServiceIds = new Set(["@archive", "@java", "@localcert", "@node"]);
export const demoFixedPortChecks = [
  { serviceId: "@serviceadmin", portName: "ui", host: "127.0.0.1", port: 17700 },
  { serviceId: "@secretsbroker", portName: "service", host: "127.0.0.1", port: 17890 },
  { serviceId: "@nginx", portName: "http", host: "127.0.0.1", port: 18080 },
  { serviceId: "@traefik", portName: "admin", host: "127.0.0.1", port: 19081 },
  { serviceId: "echo-service", portName: "health", host: "127.0.0.1", port: 4011 },
];

function parseFlag(args, name) {
  const prefix = `--${name}=`;
  const match = args.find((value) => value.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

function parseOption(args, name, envName) {
  return parseFlag(args, name) ?? process.env[`npm_config_${name.replaceAll("-", "_")}`] ?? process.env[envName];
}

export function resolveDemoOptions(args = process.argv.slice(2)) {
  return {
    servicesRoot: path.resolve(parseOption(args, "services-root", "SERVICE_LASSO_SERVICES_ROOT") ?? defaultDemoServicesRoot),
    workspaceRoot: path.resolve(parseOption(args, "workspace-root", "SERVICE_LASSO_WORKSPACE_ROOT") ?? defaultDemoWorkspaceRoot),
    port: Number(parseOption(args, "port", "SERVICE_LASSO_PORT") ?? 18080),
    preserve: args.includes("--preserve"),
    foreground: args.includes("--foreground"),
  };
}

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessExit(pid, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processExists(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !processExists(pid);
}

async function waitForCommandExit(command, args) {
  await new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("close", () => resolve());
    child.once("error", () => resolve());
  });
}

async function commandOutput(command, args, options = {}) {
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    let stdout = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.once("close", (code) => resolve(code === 0 ? stdout.trim() : ""));
    child.once("error", () => resolve(""));
  });
}

async function terminateProcessTree(pid, label) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid || !processExists(pid)) {
    return { label, pid, stopped: false, reason: "not_running" };
  }

  if (process.platform === "win32") {
    await waitForCommandExit("taskkill", ["/pid", String(pid), "/t", "/f"]);
    return { label, pid, stopped: !processExists(pid), reason: processExists(pid) ? "still_running" : "terminated" };
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return { label, pid, stopped: true, reason: "terminated" };
  }

  if (!(await waitForProcessExit(pid))) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Process exited between checks.
    }
  }

  return { label, pid, stopped: !processExists(pid), reason: processExists(pid) ? "still_running" : "terminated" };
}

async function canBindPort(host, port) {
  const server = net.createServer();

  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => resolve());
    });
    return true;
  } catch {
    return false;
  } finally {
    if (server.listening) {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }).catch(() => undefined);
    }
  }
}

function sameResolvedPath(left, right) {
  const leftResolved = path.resolve(String(left ?? ""));
  const rightResolved = path.resolve(String(right ?? ""));
  return process.platform === "win32"
    ? leftResolved.toLowerCase() === rightResolved.toLowerCase()
    : leftResolved === rightResolved;
}

function runtimeInstanceMatchesDemoRoots(runtimeInstance, { servicesRoot, workspaceRoot }) {
  return Boolean(
    runtimeInstance
      && sameResolvedPath(runtimeInstance.servicesRoot, servicesRoot)
      && sameResolvedPath(runtimeInstance.workspaceRoot, workspaceRoot),
  );
}

async function getProcessCommandEvidence(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return {};
  }

  if (process.platform === "win32") {
    const raw = await commandOutput("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" | Select-Object -First 1 ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress`,
    ]);
    if (!raw) {
      return {};
    }
    try {
      const parsed = JSON.parse(raw);
      return {
        executablePath: typeof parsed.ExecutablePath === "string" ? parsed.ExecutablePath : undefined,
        commandLine: typeof parsed.CommandLine === "string" ? parsed.CommandLine : undefined,
      };
    } catch {
      return {};
    }
  }

  const commandLine = await commandOutput("ps", ["-p", String(pid), "-o", "command="]);
  return commandLine ? { commandLine } : {};
}

async function getListeningPortEvidence(port) {
  if (!Number.isInteger(port) || port <= 0) {
    return [];
  }

  if (process.platform === "win32") {
    const netstat = await commandOutput("netstat", ["-ano", "-p", "tcp"]);
    const pids = new Set();
    for (const line of netstat.split(/\r?\n/)) {
      const columns = line.trim().split(/\s+/);
      if (columns.length < 5 || columns[0].toUpperCase() !== "TCP" || columns[3].toUpperCase() !== "LISTENING") {
        continue;
      }
      const localAddress = columns[1];
      if (localAddress.endsWith(`:${port}`) || localAddress.endsWith(`]:${port}`)) {
        const pid = Number(columns[4]);
        if (Number.isInteger(pid) && pid > 0) {
          pids.add(pid);
        }
      }
    }

    return await Promise.all(
      [...pids].map(async (pid) => ({
        pid,
        ...(await getProcessCommandEvidence(pid)),
      })),
    );
  }

  const lsof = await commandOutput("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]);
  const pids = new Set();
  for (const line of lsof.split(/\r?\n/).slice(1)) {
    const columns = line.trim().split(/\s+/);
    const pid = Number(columns[1]);
    if (Number.isInteger(pid) && pid > 0) {
      pids.add(pid);
    }
  }

  return await Promise.all(
    [...pids].map(async (pid) => ({
      pid,
      ...(await getProcessCommandEvidence(pid)),
    })),
  );
}

function truncateEvidence(value, maxLength = 260) {
  if (typeof value !== "string" || value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}

function formatListeningPortEvidence(evidence) {
  if (!evidence.length) {
    return "process evidence unavailable";
  }

  return evidence
    .map((entry) => {
      const details = [`pid=${entry.pid}`];
      if (entry.executablePath) {
        details.push(`exe=${JSON.stringify(truncateEvidence(entry.executablePath))}`);
      }
      if (entry.commandLine) {
        details.push(`command=${JSON.stringify(truncateEvidence(entry.commandLine))}`);
      }
      return details.join(" ");
    })
    .join("; ");
}

export async function assertDemoRecycleOwnership(options = {}) {
  const servicesRoot = path.resolve(options.servicesRoot ?? defaultDemoServicesRoot);
  const workspaceRoot = path.resolve(options.workspaceRoot ?? defaultDemoWorkspaceRoot);
  const port = options.port ?? Number(process.env.SERVICE_LASSO_PORT ?? 18080);
  const runtimeInstancePath = path.join(workspaceRoot, ".service-lasso", "runtime-instance.json");
  const runtimeInstance = await readJsonIfPresent(runtimeInstancePath);

  if (runtimeInstanceMatchesDemoRoots(runtimeInstance, { servicesRoot, workspaceRoot })) {
    return;
  }

  if (await canBindPort("127.0.0.1", port)) {
    return;
  }

  const metadataState = runtimeInstance
    ? `runtime-instance.json points at servicesRoot=${JSON.stringify(runtimeInstance.servicesRoot ?? null)} workspaceRoot=${JSON.stringify(runtimeInstance.workspaceRoot ?? null)}`
    : "runtime-instance.json is missing";
  const evidence = await getListeningPortEvidence(port);

  throw new Error(
    `Demo recycle blocked by stale/orphan runtime ownership for workspace ${workspaceRoot}: ${metadataState} while runtime-api http 127.0.0.1:${port} is already listening. Process evidence: ${formatListeningPortEvidence(evidence)}. Recovery: wait for any scheduled demo:watchdog recovery to finish, then stop only the verified stale foreground demo process or choose a different demo port before retrying.`,
  );
}

export async function assertDemoPortsAvailable({ port, workspaceRoot, fixedPortChecks = demoFixedPortChecks } = {}) {
  const checks = [
    { serviceId: "runtime-api", portName: "http", host: "127.0.0.1", port },
    ...fixedPortChecks,
  ].filter((entry) => Number.isInteger(entry.port) && entry.port > 0);
  const blocked = [];

  for (const check of checks) {
    if (!(await canBindPort(check.host, check.port))) {
      blocked.push(check);
    }
  }

  if (blocked.length > 0) {
    const details = blocked
      .map((entry) => `${entry.serviceId} ${entry.portName} ${entry.host}:${entry.port}`)
      .join(", ");
    const workspaceHint = workspaceRoot ? ` for workspace ${path.resolve(workspaceRoot)}` : "";
    throw new Error(
      `Demo recycle blocked by live non-managed listener(s)${workspaceHint}: ${details}. Stop the external preview/process or choose a different demo port before retrying.`,
    );
  }
}

function commandLooksServiceOwned(command, serviceRoot) {
  return typeof command === "string" && command.includes(path.resolve(serviceRoot));
}

async function stopRuntimeServices(runtimeInstance) {
  const apiUrl = runtimeInstance?.apiUrl ?? (
    Number.isInteger(runtimeInstance?.apiPort)
      ? `http://127.0.0.1:${runtimeInstance.apiPort}`
      : null
  );
  if (!apiUrl) {
    return { label: "runtime-api-stopAll", stopped: false, reason: "missing_runtime_api_url" };
  }

  try {
    const result = await getJson(`${apiUrl}/api/runtime/actions/stopAll`, "POST", 15_000);
    return {
      label: "runtime-api-stopAll",
      stopped: result.status === 200,
      reason: result.status === 200 ? "stop_all_requested" : `http_${result.status}`,
    };
  } catch (error) {
    return {
      label: "runtime-api-stopAll",
      stopped: false,
      reason: `stop_all_failed:${error.message}`,
    };
  }
}

export async function stopDemoManagedProcesses(options = {}) {
  const servicesRoot = path.resolve(options.servicesRoot ?? defaultDemoServicesRoot);
  const workspaceRoot = path.resolve(options.workspaceRoot ?? defaultDemoWorkspaceRoot);
  const stopped = [];
  const skipped = [];
  const runtimeInstance = await readJsonIfPresent(path.join(workspaceRoot, ".service-lasso", "runtime-instance.json"));

  if (runtimeInstanceMatchesDemoRoots(runtimeInstance, { servicesRoot, workspaceRoot })) {
    stopped.push(await stopRuntimeServices(runtimeInstance));
    stopped.push(await terminateProcessTree(runtimeInstance.pid, "runtime-api"));
  }

  for (const serviceId of demoServiceIds) {
    const serviceRoot = path.join(servicesRoot, serviceId);
    const runtimeState = await readJsonIfPresent(path.join(serviceRoot, ".state", "runtime.json"));
    if (!runtimeState || !processExists(runtimeState.pid)) {
      continue;
    }

    if (!commandLooksServiceOwned(runtimeState.command, serviceRoot)) {
      skipped.push({
        serviceId,
        pid: runtimeState.pid,
        reason: "runtime_state_command_not_owned_by_service_root",
      });
      continue;
    }

    stopped.push(await terminateProcessTree(runtimeState.pid, serviceId));
  }

  return { stopped, skipped };
}

async function removeManifestDeclaredFiles(serviceRoot) {
  const manifestPath = path.join(serviceRoot, "service.json");
  if (!(await pathExists(manifestPath))) {
    return;
  }

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const declaredFiles = [
    ...(manifest.install?.files ?? []),
    ...(manifest.config?.files ?? []),
  ]
    .map((entry) => (typeof entry?.path === "string" ? entry.path : null))
    .filter((entry) => entry);

  await Promise.all(
    declaredFiles.map((relativePath) =>
      rm(path.resolve(serviceRoot, relativePath), { force: true, recursive: true }),
    ),
  );
}

export async function resetDemoInstance(options = {}) {
  const servicesRoot = path.resolve(options.servicesRoot ?? defaultDemoServicesRoot);
  const workspaceRoot = path.resolve(options.workspaceRoot ?? defaultDemoWorkspaceRoot);

  await rm(workspaceRoot, { recursive: true, force: true });

  await Promise.all(
    demoServiceIds.map(async (serviceId) => {
      const serviceRoot = path.join(servicesRoot, serviceId);
      await Promise.all([
        rm(path.join(serviceRoot, ".state"), { recursive: true, force: true }),
        rm(path.join(serviceRoot, "logs"), { recursive: true, force: true }),
      ]);
      await removeManifestDeclaredFiles(serviceRoot);
    }),
  );
}

async function importDistModule(relativePath) {
  return import(pathToFileURL(path.join(repoRoot, "dist", relativePath)).href);
}

export async function startDemoRuntime(options = {}) {
  const { startRuntimeApp } = await importDistModule(path.join("runtime", "app.js"));
  const servicesRoot = path.resolve(options.servicesRoot ?? defaultDemoServicesRoot);
  const workspaceRoot = path.resolve(options.workspaceRoot ?? defaultDemoWorkspaceRoot);
  const port = options.port ?? Number(process.env.SERVICE_LASSO_PORT ?? 18080);

  return startRuntimeApp({
    servicesRoot,
    workspaceRoot,
    port,
    version: process.env.npm_package_version ?? "0.1.0",
  });
}

async function getJson(url, method = "GET", timeoutMs = 30_000) {
  const response = await fetch(url, { method, signal: AbortSignal.timeout(timeoutMs) });
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function getText(url, timeoutMs = 30_000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  return {
    status: response.status,
    body: await response.text(),
  };
}

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function waitFor(check, timeoutMs = 2_000, intervalMs = 50) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Condition not met within ${timeoutMs}ms.`);
}

async function postServiceAction(apiUrl, serviceId, action) {
  const result = await getJson(`${apiUrl}/api/services/${encodeURIComponent(serviceId)}/${action}`, "POST");
  assertCondition(
    result.status === 200,
    `Expected ${serviceId} ${action} to return 200, got ${result.status}: ${JSON.stringify(result.body)}`,
  );
  return result.body;
}

async function waitForHttpOk(url, label, timeoutMs = 300_000) {
  return await waitFor(async () => {
    try {
      const result = await getText(url, 10_000);
      return result.status >= 200 && result.status < 300 ? result : null;
    } catch {
      return null;
    }
  }, timeoutMs, 500).catch((error) => {
    throw new Error(`${label} did not become reachable at ${url}: ${error.message}`);
  });
}

async function waitForServiceState(apiUrl, serviceId, expected, timeoutMs = 300_000) {
  const wantsHealthy = Object.hasOwn(expected, "healthy") ? expected.healthy : true;
  return await waitFor(async () => {
    const result = await getJson(`${apiUrl}/api/services/${encodeURIComponent(serviceId)}`);
    if (result.status !== 200 || result.body.service?.id !== serviceId) {
      return null;
    }

    const service = result.body.service;
    if (
      service.lifecycle?.installed === true
      && service.lifecycle?.configured === true
      && service.lifecycle?.running === expected.running
      && (wantsHealthy === undefined || service.health?.healthy === wantsHealthy)
    ) {
      return service;
    }
    return null;
  }, timeoutMs, 500).catch((error) => {
    throw new Error(`${serviceId} did not reach running=${expected.running} healthy=${wantsHealthy ?? "any"}: ${error.message}`);
  });
}

async function getGitSummary() {
  const [branch, commit] = await Promise.all([
    commandOutput("git", ["branch", "--show-current"], { cwd: repoRoot }),
    commandOutput("git", ["rev-parse", "--short=12", "HEAD"], { cwd: repoRoot }),
  ]);

  return {
    branch: branch || "unknown",
    commit: commit || "unknown",
  };
}

export async function runDemoRecycle(options = {}) {
  const servicesRoot = path.resolve(options.servicesRoot ?? defaultDemoServicesRoot);
  const workspaceRoot = path.resolve(options.workspaceRoot ?? defaultDemoWorkspaceRoot);
  const port = options.port ?? Number(process.env.SERVICE_LASSO_PORT ?? 18080);
  const preserve = options.preserve === true;
  const keepAlive = options.keepAlive === true;
  await assertDemoRecycleOwnership({ servicesRoot, workspaceRoot, port });
  const stopped = await stopDemoManagedProcesses({ servicesRoot, workspaceRoot });

  await assertDemoPortsAvailable({ port, workspaceRoot });
  await resetDemoInstance({ servicesRoot, workspaceRoot });

  const runtime = await startDemoRuntime({ servicesRoot, workspaceRoot, port });
  let servicesStopped = false;
  let runtimeKeptAlive = false;

  try {
    const apiUrl = runtime.apiServer.url;
    const apiHealth = await getJson(`${apiUrl}/api/health`);
    assertCondition(apiHealth.status === 200 && apiHealth.body.status === "ok", "Expected runtime API health to report ok.");

    const previousRuntimeApiBaseUrl = process.env.SERVICE_LASSO_RUNTIME_API_BASE_URL;
    const previousApiBaseUrl = process.env.SERVICE_LASSO_API_BASE_URL;
    process.env.SERVICE_LASSO_RUNTIME_API_BASE_URL = apiUrl;
    process.env.SERVICE_LASSO_API_BASE_URL = apiUrl;

    try {
      for (const serviceId of demoRequiredServiceIds) {
        await postServiceAction(apiUrl, serviceId, "install");
        await postServiceAction(apiUrl, serviceId, "config");
      }

      for (const serviceId of demoRequiredServiceIds.filter((serviceId) => !demoProviderServiceIds.has(serviceId))) {
        await postServiceAction(apiUrl, serviceId, "start");
      }
    } finally {
      if (previousRuntimeApiBaseUrl === undefined) {
        delete process.env.SERVICE_LASSO_RUNTIME_API_BASE_URL;
      } else {
        process.env.SERVICE_LASSO_RUNTIME_API_BASE_URL = previousRuntimeApiBaseUrl;
      }
      if (previousApiBaseUrl === undefined) {
        delete process.env.SERVICE_LASSO_API_BASE_URL;
      } else {
        process.env.SERVICE_LASSO_API_BASE_URL = previousApiBaseUrl;
      }
    }

    const serviceStates = [];
    for (const serviceId of demoRequiredServiceIds) {
      const expected = demoProviderServiceIds.has(serviceId)
        ? { running: false, healthy: undefined }
        : { running: true, healthy: true };
      serviceStates.push(await waitForServiceState(apiUrl, serviceId, expected));
    }

    const serviceAdminUrl = "http://127.0.0.1:17700";
    const secretsBrokerHealthUrl = "http://127.0.0.1:17890/health";
    const nginxHealthUrl = "http://127.0.0.1:18080/health";
    const traefikHealthUrl = "http://127.0.0.1:19081/ping";
    const echoHealthUrl = "http://127.0.0.1:4011/health";

    const serviceAdminRoot = await waitForHttpOk(`${serviceAdminUrl}/`, "Service Admin UI");
    const serviceAdminHealth = await waitForHttpOk(`${serviceAdminUrl}/health`, "Service Admin health");
    const secretsBrokerHealth = await waitForHttpOk(secretsBrokerHealthUrl, "Secrets Broker health");
    const nginxHealth = await waitForHttpOk(nginxHealthUrl, "NGINX health");
    const traefikHealth = await waitForHttpOk(traefikHealthUrl, "Traefik health");
    const echoHealth = await waitForHttpOk(echoHealthUrl, "Echo Service health");
    const services = await getJson(`${apiUrl}/api/services`);
    assertCondition(services.status === 200, "Expected runtime /api/services to return 200.");

    const git = await getGitSummary();

    const result = {
      apiUrl,
      serviceAdminUrl,
      servicesRoot,
      workspaceRoot,
      git,
      stopped,
      endpoints: {
        runtimeApiHealth: { url: `${apiUrl}/api/health`, status: apiHealth.status },
        serviceAdminRoot: { url: `${serviceAdminUrl}/`, status: serviceAdminRoot.status },
        serviceAdminHealth: { url: `${serviceAdminUrl}/health`, status: serviceAdminHealth.status },
        secretsBrokerHealth: { url: secretsBrokerHealthUrl, status: secretsBrokerHealth.status },
        nginxHealth: { url: nginxHealthUrl, status: nginxHealth.status },
        traefikHealth: { url: traefikHealthUrl, status: traefikHealth.status },
        echoHealth: { url: echoHealthUrl, status: echoHealth.status },
        runtimeServices: { url: `${apiUrl}/api/services`, status: services.status },
      },
      services: serviceStates.map((service) => ({
        id: service.id,
        running: service.lifecycle?.running === true,
        healthy: service.health?.healthy === true,
      })),
    };

    if (keepAlive) {
      runtimeKeptAlive = true;
    }

    return result;
  } catch (error) {
    try {
      await getJson(`${runtime.apiServer.url}/api/runtime/actions/stopAll`, "POST");
      servicesStopped = true;
    } catch {}
    throw error;
  } finally {
    if (!preserve && !runtimeKeptAlive) {
      if (!servicesStopped) {
        try {
          await getJson(`${runtime.apiServer.url}/api/runtime/actions/stopAll`, "POST");
        } catch {}
      }
      await resetDemoInstance({ servicesRoot, workspaceRoot });
    }
    if (!runtimeKeptAlive) {
      await runtime.apiServer.stop();
    }
  }
}

export async function runDemoSmoke(options = {}) {
  const servicesRoot = path.resolve(options.servicesRoot ?? defaultDemoServicesRoot);
  const workspaceRoot = path.resolve(options.workspaceRoot ?? defaultDemoWorkspaceRoot);
  const port = options.port ?? 0;
  const preserve = options.preserve === true;

  await resetDemoInstance({ servicesRoot, workspaceRoot });

  const runtime = await startDemoRuntime({ servicesRoot, workspaceRoot, port });

  try {
    const health = await getJson(`${runtime.apiServer.url}/api/health`);
    const services = await getJson(`${runtime.apiServer.url}/api/services`);
    const runtimeSummary = await getJson(`${runtime.apiServer.url}/api/runtime`);
    const dependencies = await getJson(`${runtime.apiServer.url}/api/dependencies`);

    assertCondition(health.status === 200, "Expected /api/health to return 200.");
    assertCondition(services.status === 200, "Expected /api/services to return 200.");
    assertCondition(runtimeSummary.status === 200, "Expected /api/runtime to return 200.");
    assertCondition(dependencies.status === 200, "Expected /api/dependencies to return 200.");
    assertCondition(
      services.body.services.some((service) => service.id === "echo-service"),
      "Expected echo-service in demo services list.",
    );
    assertCondition(
      services.body.services.some((service) => service.id === "node-sample-service"),
      "Expected node-sample-service in demo services list.",
    );

    for (const action of ["install", "config", "start"]) {
      const result = await getJson(`${runtime.apiServer.url}/api/services/echo-service/${action}`, "POST");
      assertCondition(result.status === 200, `Expected echo-service ${action} to return 200.`);
    }

    const echoHealth = await waitFor(async () => {
      const result = await getJson(`${runtime.apiServer.url}/api/services/echo-service/health`);
      if (result.body.health.healthy === true) {
        return result;
      }
      return null;
    });
    const echoLogs = await waitFor(async () => {
      const result = await getJson(`${runtime.apiServer.url}/api/services/echo-service/logs`);
      if (result.body.logs.entries.length > 0) {
        return result;
      }
      return null;
    });
    const echoMetrics = await getJson(`${runtime.apiServer.url}/api/services/echo-service/metrics`);
    const echoState = JSON.parse(await readFile(path.join(servicesRoot, "echo-service", ".state", "runtime.json"), "utf8"));

    assertCondition(echoHealth.body.health.healthy === true, "Expected echo-service health to be healthy after start.");
    assertCondition(echoLogs.body.logs.logPath.endsWith(path.join("echo-service", "logs", "runtime", "service.log")), "Expected echo-service runtime log path.");
    assertCondition(echoMetrics.body.metrics.process.launchCount === 1, "Expected echo-service launch count to be 1.");
    assertCondition(echoMetrics.body.metrics.process.running === true, "Expected echo-service metrics to report running.");
    assertCondition(echoState.running === true, "Expected echo-service persisted runtime state to report running.");

    for (const serviceId of ["@node", "node-sample-service"]) {
      for (const action of ["install", "config"]) {
        const result = await getJson(`${runtime.apiServer.url}/api/services/${encodeURIComponent(serviceId)}/${action}`, "POST");
        assertCondition(result.status === 200, `Expected ${serviceId} ${action} to return 200.`);
      }
    }

    const providerStart = await getJson(`${runtime.apiServer.url}/api/services/node-sample-service/start`, "POST");
    assertCondition(providerStart.status === 200, "Expected node-sample-service start to return 200.");
    assertCondition(providerStart.body.provider.provider === "node", "Expected node-sample-service provider to resolve to node.");

    const providerDetail = await getJson(`${runtime.apiServer.url}/api/services/node-sample-service`);
    const providerMetrics = await getJson(`${runtime.apiServer.url}/api/services/node-sample-service/metrics`);
    const nodeProviderDetail = await getJson(`${runtime.apiServer.url}/api/services/%40node`);
    const nodeProviderMetrics = await getJson(`${runtime.apiServer.url}/api/services/%40node/metrics`);
    const aggregateMetrics = await getJson(`${runtime.apiServer.url}/api/metrics`);

    assertCondition(providerDetail.body.service.lifecycle.running === true, "Expected node-sample-service to be running.");
    assertCondition(providerMetrics.body.metrics.process.provider === "node", "Expected node-sample-service metrics provider.");
    assertCondition(providerMetrics.body.metrics.process.launchCount === 1, "Expected node-sample-service launch count to be 1.");
    assertCondition(nodeProviderDetail.body.service.id === "@node", "Expected @node provider detail to be available.");
    assertCondition(nodeProviderDetail.body.service.lifecycle.installed === true, "Expected @node provider to be installed.");
    assertCondition(nodeProviderDetail.body.service.lifecycle.configured === true, "Expected @node provider to be configured.");
    assertCondition(nodeProviderDetail.body.service.lifecycle.running === false, "Expected @node provider not to run as a daemon.");
    assertCondition(nodeProviderDetail.body.service.health.healthy === true, "Expected @node provider health to be ready.");
    assertCondition(nodeProviderDetail.body.service.health.type === "provider", "Expected @node provider health type.");
    assertCondition(nodeProviderMetrics.body.metrics.process.launchCount === 0, "Expected @node provider to have no daemon launch evidence.");
    assertCondition(
      aggregateMetrics.body.services.some((service) => service.serviceId === "echo-service"),
      "Expected aggregate metrics to include echo-service.",
    );

    const stopAll = await getJson(`${runtime.apiServer.url}/api/runtime/actions/stopAll`, "POST");
    assertCondition(stopAll.status === 200, "Expected stopAll to return 200.");
    const stopAllHandledEcho =
      stopAll.body.results.some((result) => result.serviceId === "echo-service")
      || stopAll.body.skipped?.some(
        (result) => result.serviceId === "echo-service" && result.reason === "not_running",
      );
    const stopAllHandledNodeSample =
      stopAll.body.results.some((result) => result.serviceId === "node-sample-service")
      || stopAll.body.skipped?.some(
        (result) => result.serviceId === "node-sample-service" && result.reason === "not_running",
      );
    assertCondition(
      stopAllHandledEcho,
      "Expected stopAll to include or explicitly skip echo-service.",
    );
    assertCondition(
      stopAllHandledNodeSample,
      "Expected stopAll to include or explicitly skip node-sample-service.",
    );

    const stoppedEchoMetrics = await getJson(`${runtime.apiServer.url}/api/services/echo-service/metrics`);
    const stoppedProviderMetrics = await getJson(`${runtime.apiServer.url}/api/services/node-sample-service/metrics`);
    const echoSkipNotRunning = stopAll.body.skipped?.some(
      (result) => result.serviceId === "echo-service" && result.reason === "not_running",
    );

    assertCondition(stoppedEchoMetrics.body.metrics.process.running === false, "Expected echo-service to be stopped.");
    assertCondition(
      stoppedEchoMetrics.body.metrics.process.stopCount >= 1 || echoSkipNotRunning,
      "Expected echo-service stop evidence.",
    );
    assertCondition(stoppedProviderMetrics.body.metrics.process.running === false, "Expected node-sample-service to be stopped.");

    return {
      url: runtime.apiServer.url,
      servicesRoot,
      workspaceRoot,
      summary: {
        health: health.body.status,
        runtimeServices: runtimeSummary.body.runtime.totalServices,
        demoServicesExercised: ["echo-service", "@node", "node-sample-service"],
      },
    };
  } finally {
    await runtime.apiServer.stop();

    if (!preserve) {
      await resetDemoInstance({ servicesRoot, workspaceRoot });
    }
  }
}
