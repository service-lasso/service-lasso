import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";

const appRepos = [
  {
    name: "service-lasso-app-node",
    hostPortEnv: "SERVICE_LASSO_APP_NODE_HOST_PORT",
    adminDistEnv: "SERVICE_LASSO_APP_NODE_ADMIN_DIST_ROOT",
    sourceServicesEnv: "SERVICE_LASSO_APP_NODE_SOURCE_SERVICES_ROOT",
    proxyRuntimeServices: false,
  },
  {
    name: "service-lasso-app-web",
    hostPortEnv: "SERVICE_LASSO_APP_WEB_PORT",
    adminDistEnv: "SERVICE_LASSO_APP_WEB_ADMIN_DIST_ROOT",
    sourceServicesEnv: "SERVICE_LASSO_APP_WEB_SOURCE_SERVICES_ROOT",
    proxyRuntimeServices: true,
  },
  {
    name: "service-lasso-app-electron",
    hostPortEnv: "SERVICE_LASSO_APP_ELECTRON_PORT",
    adminDistEnv: "SERVICE_LASSO_APP_ELECTRON_ADMIN_DIST_ROOT",
    sourceServicesEnv: "SERVICE_LASSO_APP_ELECTRON_SOURCE_SERVICES_ROOT",
    proxyRuntimeServices: true,
  },
  {
    name: "service-lasso-app-tauri",
    hostPortEnv: "SERVICE_LASSO_APP_TAURI_PORT",
    adminDistEnv: "SERVICE_LASSO_APP_TAURI_ADMIN_DIST_ROOT",
    sourceServicesEnv: "SERVICE_LASSO_APP_TAURI_SOURCE_SERVICES_ROOT",
    proxyRuntimeServices: true,
  },
  {
    name: "service-lasso-app-packager-pkg",
    hostPortEnv: "SERVICE_LASSO_APP_PACKAGER_PKG_HOST_PORT",
    adminDistEnv: "SERVICE_LASSO_APP_PACKAGER_PKG_ADMIN_DIST_ROOT",
    sourceServicesEnv: "SERVICE_LASSO_APP_PACKAGER_PKG_SOURCE_SERVICES_ROOT",
    proxyRuntimeServices: false,
  },
];

const commandTimeoutMs = 180_000;
const requestTimeoutMs = 60_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function reserveLoopbackPort() {
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

function commandFor(bin) {
  return process.platform === "win32" ? `${bin}.cmd` : bin;
}

function windowsCommand(command, args) {
  return process.platform === "win32" && command.endsWith(".cmd")
    ? { command: "cmd.exe", args: ["/d", "/s", "/c", command, ...args] }
    : { command, args };
}

async function forceKillPid(pid) {
  if (!pid) {
    return;
  }

  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" });
      killer.once("close", resolve);
      killer.once("error", resolve);
    });
    return;
  }

  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
}

async function run(command, args, options = {}) {
  const resolved = windowsCommand(command, args);
  const child = spawn(resolved.command, resolved.args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  const startedAt = Date.now();

  child.stdout?.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  let timedOut = false;
  const exit = await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      timedOut = true;
      void forceKillPid(child.pid);
    }, options.timeoutMs ?? commandTimeoutMs);
    child.once("close", (code, signal) => resolve({ code, signal }));
    child.once("close", () => clearTimeout(timeout));
  });

  if (timedOut || exit.code !== 0) {
    throw new Error(
      [
        `${command} ${args.join(" ")} ${timedOut ? "timed out" : "failed"} after ${Date.now() - startedAt}ms with code ${exit.code} signal ${exit.signal}.`,
        stdout ? `stdout:\n${stdout}` : "",
        stderr ? `stderr:\n${stderr}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  return { stdout, stderr };
}

async function getText(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  try {
    const response = await fetch(url, { method: options.method ?? "GET", signal: controller.signal });
    const body = await response.text();
    return { response, body };
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForOk(url, timeoutMs = requestTimeoutMs) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await getText(url);
      if (result.response.ok) {
        return result;
      }
      lastError = new Error(`HTTP ${result.response.status} from ${url}: ${result.body.slice(0, 300)}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }

  throw lastError ?? new Error(`Timed out waiting for ${url}.`);
}

async function getJson(url) {
  const result = await waitForOk(url);
  return JSON.parse(result.body);
}

async function postJson(url) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(`POST ${url} failed with HTTP ${response.status}: ${text}`);
  }

  return body;
}

async function waitForJsonPredicate(url, predicate, message, timeoutMs = requestTimeoutMs) {
  const startedAt = Date.now();
  let lastBody = null;
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      lastBody = await getJson(url);
      if (predicate(lastBody)) {
        return lastBody;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }

  throw new Error(`${message}. Last body: ${JSON.stringify(lastBody)}. Last error: ${lastError?.message ?? "none"}`);
}

function startApp(repoRoot, env) {
  const resolved = windowsCommand(commandFor("npm"), ["start"]);
  const child = spawn(resolved.command, resolved.args, {
    cwd: repoRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  return {
    child,
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
  };
}

async function stopProcessTree(app) {
  if (!app || app.child.exitCode !== null || app.child.signalCode !== null) {
    return;
  }

  if (process.platform === "win32") {
    app.child.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => app.child.once("close", resolve)), sleep(3_000)]);
    if (app.child.exitCode === null && app.child.signalCode === null) {
      await run("taskkill", ["/pid", String(app.child.pid), "/t", "/f"], { timeoutMs: 10_000 }).catch(() => {});
    }
    return;
  }

  try {
    process.kill(-app.child.pid, "SIGTERM");
  } catch {
    app.child.kill("SIGTERM");
  }

  await Promise.race([new Promise((resolve) => app.child.once("close", resolve)), sleep(5_000)]);
  if (app.child.exitCode === null && app.child.signalCode === null) {
    try {
      process.kill(-app.child.pid, "SIGKILL");
    } catch {
      app.child.kill("SIGKILL");
    }
  }
}

async function waitForPortClosed(url, timeoutMs = 15_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (!response.ok) {
        return;
      }
    } catch {
      return;
    }
    await sleep(250);
  }

  throw new Error(`Expected ${url} to stop responding after cleanup.`);
}

async function writeAdminDist(root) {
  await mkdir(root, { recursive: true });
  await writeFile(
    path.join(root, "index.html"),
    [
      "<!doctype html>",
      '<html lang="en">',
      "<head>",
      '<meta charset="utf-8" />',
      "<title>Service Admin Smoke Fixture</title>",
      "</head>",
      "<body>",
      "<h1>Service Admin Smoke Fixture</h1>",
      "<p>This deterministic dist is mounted by the reference-app lifecycle smoke.</p>",
      "</body>",
      "</html>",
      "",
    ].join("\n"),
    "utf8",
  );
}

async function removeTempRoot(root) {
  if (process.platform === "win32") {
    console.warn(`[reference-app-smoke] warning: leaving temp clone root for OS cleanup: ${root}`);
    return;
  }

  let lastError = null;
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
      return;
    } catch (error) {
      lastError = error;
      await sleep(500);
    }
  }

  if (lastError?.code === "EBUSY" || lastError?.code === "EPERM" || lastError?.code === "ENOTEMPTY") {
    console.warn(`[reference-app-smoke] warning: temp cleanup was deferred by the OS: ${root}`);
    console.warn(`[reference-app-smoke] warning: ${lastError.message}`);
    return;
  }

  if (lastError) {
    throw lastError;
  }
}

async function patchEchoManifest(repoRoot, ports) {
  const manifestPath = path.join(repoRoot, "services", "echo-service", "service.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  manifest.env = {
    ...manifest.env,
    ECHO_PORT: String(ports.echo),
    ECHO_HTTP_HEALTH_PORT: String(ports.httpHealth),
    ECHO_TCP_PORT: String(ports.tcp),
  };
  manifest.urls = [
    { label: "ui", url: `http://127.0.0.1:${ports.echo}/`, kind: "local" },
    { label: "service", url: `http://127.0.0.1:${ports.echo}/health`, kind: "local" },
  ];

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function verifyOneApp(app, root) {
  const repoRoot = path.join(root, app.name);
  const adminDistRoot = path.join(root, "admin-dist");
  const workspaceRoot = path.join(root, "workspaces", app.name, "runtime");
  const servicesRoot = path.join(root, "workspaces", app.name, "services");
  const sourceServicesRoot = path.join(repoRoot, "services");
  const hostPort = await reserveLoopbackPort();
  const runtimePort = await reserveLoopbackPort();
  const echoPort = await reserveLoopbackPort();
  const echoHttpHealthPort = await reserveLoopbackPort();
  const echoTcpPort = await reserveLoopbackPort();
  let appProcess = null;
  let stoppedEcho = false;

  console.log(`[reference-app-smoke] cloning ${app.name}`);
  await run("git", ["clone", "--depth", "1", `https://github.com/service-lasso/${app.name}.git`, repoRoot], {
    cwd: root,
    timeoutMs: 240_000,
  });
  await patchEchoManifest(repoRoot, { echo: echoPort, httpHealth: echoHttpHealthPort, tcp: echoTcpPort });

  console.log(`[reference-app-smoke] installing ${app.name}`);
  await run(commandFor("npm"), ["ci"], { cwd: repoRoot, timeoutMs: 240_000 });

  const env = {
    ...process.env,
    NODE_ENV: "test",
    SERVICE_LASSO_API_PORT: String(runtimePort),
    SERVICE_LASSO_SERVICES_ROOT: servicesRoot,
    SERVICE_LASSO_WORKSPACE_ROOT: workspaceRoot,
    [app.hostPortEnv]: String(hostPort),
    [app.adminDistEnv]: adminDistRoot,
    [app.sourceServicesEnv]: sourceServicesRoot,
  };

  try {
    console.log(`[reference-app-smoke] starting ${app.name}`);
    appProcess = startApp(repoRoot, env);

    appProcess.child.once("exit", (code, signal) => {
      if (!stoppedEcho) {
        console.error(`[reference-app-smoke] ${app.name} exited early: code=${code} signal=${signal}`);
        console.error(appProcess.stdout);
        console.error(appProcess.stderr);
      }
    });

    await waitForOk(`http://127.0.0.1:${hostPort}/`);
    await waitForOk(`http://127.0.0.1:${hostPort}/admin/`);
    await waitForJsonPredicate(
      `http://127.0.0.1:${runtimePort}/api/health`,
      (body) => body.status === "ok" && body.api?.status === "up",
      `${app.name} runtime health did not become ready`,
    );

    const serviceList = await getJson(`http://127.0.0.1:${runtimePort}/api/services`);
    const serviceIds = new Set((serviceList.services ?? []).map((service) => service.id));
    assert(serviceIds.has("echo-service"), `${app.name} runtime did not list echo-service.`);
    assert(serviceIds.has("@serviceadmin"), `${app.name} runtime did not list @serviceadmin.`);

    if (app.proxyRuntimeServices) {
      const proxyList = await getJson(`http://127.0.0.1:${hostPort}/api/runtime-services`);
      const proxyIds = new Set((proxyList.services ?? []).map((service) => service.id));
      assert(proxyIds.has("echo-service"), `${app.name} host runtime proxy did not list echo-service.`);
      assert(proxyIds.has("@serviceadmin"), `${app.name} host runtime proxy did not list @serviceadmin.`);
    }

    for (const action of ["install", "config", "start"]) {
      const result = await postJson(`http://127.0.0.1:${runtimePort}/api/services/echo-service/${action}`);
      assert(result.ok !== false, `${app.name} echo-service ${action} returned ok=false.`);
    }

    await waitForJsonPredicate(
      `http://127.0.0.1:${runtimePort}/api/services/echo-service`,
      (body) => body.service?.lifecycle?.installed === true
        && body.service?.lifecycle?.configured === true
        && body.service?.lifecycle?.running === true,
      `${app.name} echo-service did not reach installed/configured/running state`,
    );
    await waitForOk(`http://127.0.0.1:${echoPort}/health`);

    const stop = await postJson(`http://127.0.0.1:${runtimePort}/api/services/echo-service/stop`);
    assert(stop.ok !== false, `${app.name} echo-service stop returned ok=false.`);
    stoppedEcho = true;

    await waitForJsonPredicate(
      `http://127.0.0.1:${runtimePort}/api/services/echo-service`,
      (body) => body.service?.lifecycle?.running === false,
      `${app.name} echo-service did not stop cleanly`,
    );
    await waitForPortClosed(`http://127.0.0.1:${echoPort}/health`);

    console.log(`[reference-app-smoke] ${app.name} passed`);
    return {
      app: app.name,
      hostPort,
      runtimePort,
      echoPort,
      services: [...serviceIds].sort(),
    };
  } catch (error) {
    if (appProcess) {
      console.error(`[reference-app-smoke] ${app.name} stdout:`);
      console.error(appProcess.stdout);
      console.error(`[reference-app-smoke] ${app.name} stderr:`);
      console.error(appProcess.stderr);
    }
    throw error;
  } finally {
    if (appProcess) {
      if (!stoppedEcho) {
        await postJson(`http://127.0.0.1:${runtimePort}/api/services/echo-service/stop`).catch(() => {});
        await postJson(`http://127.0.0.1:${runtimePort}/api/runtime/actions/stopAll`).catch(() => {});
      }
      await stopProcessTree(appProcess);
      await waitForPortClosed(`http://127.0.0.1:${hostPort}/`).catch(() => {});
      await waitForPortClosed(`http://127.0.0.1:${runtimePort}/api/health`).catch(() => {});
    }
  }
}

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-reference-app-smoke-"));
const summaries = [];
let succeeded = false;

try {
  await writeAdminDist(path.join(tempRoot, "admin-dist"));

  for (const app of appRepos) {
    summaries.push(await verifyOneApp(app, tempRoot));
  }

  console.log("[reference-app-smoke] all canonical reference apps passed");
  console.log(JSON.stringify({ apps: summaries }, null, 2));
  succeeded = true;
} finally {
  await removeTempRoot(tempRoot);
}

if (succeeded) {
  process.exit(0);
}
