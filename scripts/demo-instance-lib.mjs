import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { closeSync, openSync } from "node:fs";
import { spawn } from "node:child_process";
import { createConnection } from "node:net";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(scriptDir, "..");
export const defaultDemoServicesRoot = path.join(repoRoot, "services");
export const defaultDemoWorkspaceRoot = path.join(repoRoot, "workspace", "demo-instance");
export const defaultDemoLogRoot = path.join(repoRoot, ".demo-logs");
export const demoServiceIds = ["echo-service", "@node", "node-sample-service"];

function parseFlag(args, name) {
  const prefix = `--${name}=`;
  const match = args.find((value) => value.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

function parseNpmConfig(name) {
  return process.env[`npm_config_${name.replaceAll("-", "_")}`];
}

function parseOption(args, name) {
  return parseFlag(args, name) ?? parseNpmConfig(name);
}

export function resolveDemoOptions(args = process.argv.slice(2)) {
  const port = Number(parseOption(args, "port") ?? process.env.SERVICE_LASSO_PORT ?? 18080);

  return {
    servicesRoot: path.resolve(parseOption(args, "services-root") ?? defaultDemoServicesRoot),
    workspaceRoot: path.resolve(parseOption(args, "workspace-root") ?? defaultDemoWorkspaceRoot),
    port,
    runtimeUrl: parseOption(args, "runtime-url") ?? process.env.SERVICE_LASSO_RUNTIME_URL ?? `http://127.0.0.1:${port}`,
    serviceAdminUrl: parseOption(args, "admin-url") ?? process.env.SERVICE_LASSO_ADMIN_URL ?? "http://127.0.0.1:17700/",
    demoLogRoot: path.resolve(parseOption(args, "demo-log-root") ?? defaultDemoLogRoot),
    timeoutMs: Number(parseOption(args, "timeout-ms") ?? process.env.SERVICE_LASSO_DEMO_TIMEOUT_MS ?? 5_000),
    json: args.includes("--json") || parseNpmConfig("json") === "true",
    preserve: args.includes("--preserve"),
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

function joinUrl(baseUrl, pathname) {
  return new URL(pathname, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).href;
}

async function fetchStatus(url, timeoutMs, parseJson = false) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    let body = text;

    if (parseJson && text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      body,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function readOptionalJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function getDemoLifecyclePaths(workspaceRoot) {
  const lifecycleRoot = path.join(workspaceRoot, ".service-lasso");

  return {
    lifecycleRoot,
    lifecycleStatePath: path.join(lifecycleRoot, "demo-lifecycle.json"),
  };
}

function classifyDemoStatus(runtimeProbe, serviceAdminProbe) {
  const runtimeHealthy =
    runtimeProbe.ok
    && runtimeProbe.status === 200
    && typeof runtimeProbe.body === "object"
    && runtimeProbe.body !== null
    && runtimeProbe.body.status === "ok";
  const serviceAdminHealthy = serviceAdminProbe.ok && serviceAdminProbe.status === 200;

  if (runtimeHealthy && serviceAdminHealthy) {
    return "healthy";
  }

  if (!runtimeHealthy && !serviceAdminHealthy) {
    return "canonical_endpoints_down";
  }

  return runtimeHealthy ? "service_admin_down" : "runtime_down";
}

async function probeTcpListener(targetUrl, timeoutMs) {
  let parsedUrl;

  try {
    parsedUrl = new URL(targetUrl);
  } catch (error) {
    return {
      ok: false,
      host: null,
      port: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const port = Number(parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80));
  const host = parsedUrl.hostname;

  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve({ ok: false, host, port, error: "connect timeout" });
    }, timeoutMs);

    socket.once("connect", () => {
      clearTimeout(timeout);
      socket.end();
      resolve({ ok: true, host, port, error: null });
    });

    socket.once("error", (error) => {
      clearTimeout(timeout);
      resolve({
        ok: false,
        host,
        port,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });
}

function readLockUpdatedAt(recoveryLock) {
  if (!recoveryLock || typeof recoveryLock !== "object") {
    return null;
  }

  for (const key of ["updatedAt", "startedAt", "createdAt", "checkedAt"]) {
    const value = recoveryLock[key];
    if (typeof value !== "string") {
      continue;
    }

    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) {
      return timestamp;
    }
  }

  return null;
}

function hasWrongWorkspaceOwner(status) {
  const ownerWorkspaceRoot = status.lifecycleState?.owner?.workspaceRoot;
  return typeof ownerWorkspaceRoot === "string" && path.resolve(ownerWorkspaceRoot) !== status.paths.workspaceRoot;
}

function classifyDemoGate(status, runtimeListener, staleRecoveryLockMs) {
  if (status.ok) {
    return "healthy";
  }

  if (hasWrongWorkspaceOwner(status)) {
    return "wrong_workspace_owner";
  }

  if (status.recoveryLock) {
    const lockUpdatedAt = readLockUpdatedAt(status.recoveryLock);
    if (lockUpdatedAt && Date.now() - lockUpdatedAt > staleRecoveryLockMs) {
      return "stale_recovery_lock";
    }

    return "recovery_in_progress";
  }

  if (!status.endpoints.runtime.ok && runtimeListener.ok) {
    return "runtime_port_owner_conflict";
  }

  return status.classification;
}

function getGateNextSafeAction(classification) {
  switch (classification) {
    case "healthy":
      return "Continue with issue selection or validation.";
    case "recovered":
      return "Continue with issue selection or validation; the gate recovered the canonical runtime.";
    case "wrong_workspace_owner":
      return "Inspect lifecycle state owner and reconcile the demo workspace before starting a new runtime.";
    case "stale_recovery_lock":
      return "Inspect the recovery lock and demo logs, then remove or refresh stale recovery state only after confirming no recovery process is active.";
    case "recovery_in_progress":
      return "Wait for the active recovery owner to finish, or inspect the recovery lock if it is not progressing.";
    case "runtime_port_owner_conflict":
      return "Inspect the process listening on the runtime port before recycling the canonical demo.";
    case "service_admin_down":
      return "Recover or restart Service Admin, then run demo:gate again.";
    case "runtime_down":
      return "Start or recycle the canonical runtime, then run demo:gate again.";
    case "canonical_endpoints_down":
      return "Recover the canonical runtime and Service Admin endpoints, then run demo:gate again.";
    case "service_startup_failure":
      return "Inspect the detached runtime log and lifecycle state before retrying demo recovery.";
    default:
      return "Inspect the reported endpoint and lifecycle evidence before manual recovery.";
  }
}

function isRecoverableGateClassification(classification) {
  return classification === "runtime_down" || classification === "canonical_endpoints_down";
}

function createLogTimestamp(date = new Date()) {
  return date.toISOString().replaceAll(":", "").replaceAll(".", "-");
}

export async function startDetachedDemoRuntime(options = {}) {
  const servicesRoot = path.resolve(options.servicesRoot ?? defaultDemoServicesRoot);
  const workspaceRoot = path.resolve(options.workspaceRoot ?? defaultDemoWorkspaceRoot);
  const demoLogRoot = path.resolve(options.demoLogRoot ?? defaultDemoLogRoot);
  const port = options.port ?? Number(process.env.SERVICE_LASSO_PORT ?? 18080);
  const runtimeEntry = path.join(repoRoot, "dist", "index.js");
  const logPath = path.join(demoLogRoot, `demo-runtime-${createLogTimestamp()}.log`);

  await mkdir(demoLogRoot, { recursive: true });

  const outputFd = openSync(logPath, "a");
  try {
    const child = spawn(process.execPath, ["--enable-source-maps", runtimeEntry], {
      cwd: repoRoot,
      detached: true,
      env: {
        ...process.env,
        SERVICE_LASSO_PORT: String(port),
        SERVICE_LASSO_SERVICES_ROOT: servicesRoot,
        SERVICE_LASSO_WORKSPACE_ROOT: workspaceRoot,
      },
      stdio: ["ignore", outputFd, outputFd],
      windowsHide: true,
    });

    child.unref();

    return {
      pid: child.pid ?? null,
      command: `${process.execPath} --enable-source-maps ${runtimeEntry}`,
      logPath,
      servicesRoot,
      workspaceRoot,
      port,
    };
  } finally {
    closeSync(outputFd);
  }
}

export async function getDemoStatus(options = {}) {
  const servicesRoot = path.resolve(options.servicesRoot ?? defaultDemoServicesRoot);
  const workspaceRoot = path.resolve(options.workspaceRoot ?? defaultDemoWorkspaceRoot);
  const port = options.port ?? Number(process.env.SERVICE_LASSO_PORT ?? 18080);
  const runtimeUrl = options.runtimeUrl ?? `http://127.0.0.1:${port}`;
  const serviceAdminUrl = options.serviceAdminUrl ?? "http://127.0.0.1:17700/";
  const demoLogRoot = path.resolve(options.demoLogRoot ?? defaultDemoLogRoot);
  const timeoutMs = options.timeoutMs ?? 5_000;
  const { lifecycleRoot, lifecycleStatePath } = getDemoLifecyclePaths(workspaceRoot);
  const recoveryLockPath = path.join(demoLogRoot, "demo-watchdog.lock.json");
  const runtimeHealthUrl = joinUrl(runtimeUrl, "/api/health");
  const [runtimeProbe, serviceAdminProbe, lifecycleState, recoveryLock] = await Promise.all([
    fetchStatus(runtimeHealthUrl, timeoutMs, true),
    fetchStatus(serviceAdminUrl, timeoutMs),
    readOptionalJson(lifecycleStatePath),
    readOptionalJson(recoveryLockPath),
  ]);
  const classification = classifyDemoStatus(runtimeProbe, serviceAdminProbe);

  return {
    ok: classification === "healthy",
    classification,
    checkedAt: new Date().toISOString(),
    endpoints: {
      runtime: {
        url: runtimeUrl,
        healthUrl: runtimeHealthUrl,
        ok: runtimeProbe.ok,
        status: runtimeProbe.status,
        health: typeof runtimeProbe.body === "object" && runtimeProbe.body !== null ? runtimeProbe.body.status : null,
        error: runtimeProbe.error ?? null,
      },
      serviceAdmin: {
        url: serviceAdminUrl,
        ok: serviceAdminProbe.ok,
        status: serviceAdminProbe.status,
        error: serviceAdminProbe.error ?? null,
      },
    },
    paths: {
      servicesRoot,
      workspaceRoot,
      lifecycleRoot,
      lifecycleStatePath,
      demoLogRoot,
      recoveryLockPath,
    },
    lifecycleState,
    recoveryLock,
  };
}

export async function getDemoGateReport(options = {}) {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const status = await getDemoStatus(options);
  const runtimeListener = await probeTcpListener(status.endpoints.runtime.url, timeoutMs);
  const classification = classifyDemoGate(status, runtimeListener, options.staleRecoveryLockMs ?? 10 * 60 * 1_000);
  const shouldRecover = options.recover !== false && isRecoverableGateClassification(classification);
  const recovery = {
    attempted: false,
    startedRuntime: null,
    error: null,
  };

  if (shouldRecover) {
    recovery.attempted = true;

    try {
      const startRuntime = options.startDetachedRuntime ?? startDetachedDemoRuntime;
      recovery.startedRuntime = await startRuntime(options);
      const recoveredStatus = await waitFor(async () => {
        const nextStatus = await getDemoStatus(options);
        return nextStatus.ok ? nextStatus : null;
      }, options.recoveryTimeoutMs ?? Math.max(timeoutMs, 5_000), options.recoveryPollIntervalMs ?? 250);
      const recoveredListener = await probeTcpListener(recoveredStatus.endpoints.runtime.url, timeoutMs);
      const gate = {
        ok: true,
        classification: "recovered",
        sourceClassification: status.classification,
        checkedAt: new Date().toISOString(),
        phase: "gate_recovered",
        runtimeListener: recoveredListener,
        recovery,
        nextSafeAction: getGateNextSafeAction("recovered"),
      };
      const lifecycleState = await writeDemoLifecycleState(recoveredStatus, {
        phase: gate.phase,
        classification: "recovered",
        gate,
      });

      return {
        ...recoveredStatus,
        ok: true,
        classification: "recovered",
        gate,
        lifecycleState,
      };
    } catch (error) {
      recovery.error = error instanceof Error ? error.message : String(error);
    }
  }

  const finalStatus = recovery.attempted ? await getDemoStatus(options) : status;
  const finalRuntimeListener = recovery.attempted
    ? await probeTcpListener(finalStatus.endpoints.runtime.url, timeoutMs)
    : runtimeListener;
  const finalGateClassification = recovery.attempted
    ? classifyDemoGate(finalStatus, finalRuntimeListener, options.staleRecoveryLockMs ?? 10 * 60 * 1_000)
    : classification;
  const finalClassification = recovery.attempted && isRecoverableGateClassification(finalGateClassification)
    ? "service_startup_failure"
    : finalGateClassification;
  const ok = finalClassification === "healthy";
  const gate = {
    ok,
    classification: finalClassification,
    sourceClassification: status.classification,
    checkedAt: new Date().toISOString(),
    phase: ok ? "gate_healthy" : "gate_blocked",
    runtimeListener: finalRuntimeListener,
    recovery,
    nextSafeAction: getGateNextSafeAction(finalClassification),
  };
  const lifecycleState = await writeDemoLifecycleState(finalStatus, {
    phase: gate.phase,
    classification: finalClassification,
    gate,
  });

  return {
    ...finalStatus,
    ok,
    classification: finalClassification,
    gate,
    lifecycleState,
  };
}

function summarizePreviousLifecycleState(lifecycleState) {
  if (!lifecycleState || typeof lifecycleState !== "object") {
    return null;
  }

  return {
    schemaVersion: lifecycleState.schemaVersion ?? null,
    updatedAt: lifecycleState.updatedAt ?? null,
    phase: lifecycleState.phase ?? null,
    classification: lifecycleState.classification ?? null,
    owner: lifecycleState.owner ?? null,
    gate: lifecycleState.gate ?? null,
  };
}

export async function writeDemoLifecycleState(status, updates = {}) {
  const lifecycleStatePath = status.paths.lifecycleStatePath;
  const nextState = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    phase: updates.phase ?? (status.ok ? "healthy" : "blocked"),
    classification: updates.classification ?? status.classification,
    owner: {
      pid: process.pid,
      command: path.basename(process.argv[1] ?? "node"),
      workspaceRoot: status.paths.workspaceRoot,
      servicesRoot: status.paths.servicesRoot,
      runtimeUrl: status.endpoints.runtime.url,
      serviceAdminUrl: status.endpoints.serviceAdmin.url,
    },
    endpoints: status.endpoints,
    paths: status.paths,
    previousState: summarizePreviousLifecycleState(status.lifecycleState),
    ...updates,
  };

  await mkdir(path.dirname(lifecycleStatePath), { recursive: true });
  await writeFile(lifecycleStatePath, `${JSON.stringify(nextState, null, 2)}\n`, "utf8");

  return nextState;
}

export function printDemoStatus(status) {
  console.log(`[service-lasso demo] status ${status.classification}`);
  console.log(`- ok: ${status.ok ? "yes" : "no"}`);
  console.log(`- runtime: ${status.endpoints.runtime.healthUrl} -> ${status.endpoints.runtime.status ?? status.endpoints.runtime.error}`);
  console.log(`- serviceAdmin: ${status.endpoints.serviceAdmin.url} -> ${status.endpoints.serviceAdmin.status ?? status.endpoints.serviceAdmin.error}`);
  console.log(`- servicesRoot: ${status.paths.servicesRoot}`);
  console.log(`- workspaceRoot: ${status.paths.workspaceRoot}`);
  console.log(`- lifecycleState: ${status.paths.lifecycleStatePath}`);
  console.log(`- demoLogs: ${status.paths.demoLogRoot}`);
}

export function printDemoGateReport(report) {
  console.log(`[service-lasso demo] gate ${report.classification}`);
  console.log(`- ok: ${report.ok ? "yes" : "no"}`);
  console.log(`- runtime: ${report.endpoints.runtime.healthUrl} -> ${report.endpoints.runtime.status ?? report.endpoints.runtime.error}`);
  console.log(`- runtimeListener: ${report.gate.runtimeListener.host}:${report.gate.runtimeListener.port} -> ${report.gate.runtimeListener.ok ? "open" : report.gate.runtimeListener.error}`);
  console.log(`- serviceAdmin: ${report.endpoints.serviceAdmin.url} -> ${report.endpoints.serviceAdmin.status ?? report.endpoints.serviceAdmin.error}`);
  console.log(`- servicesRoot: ${report.paths.servicesRoot}`);
  console.log(`- workspaceRoot: ${report.paths.workspaceRoot}`);
  console.log(`- lifecycleState: ${report.paths.lifecycleStatePath}`);
  console.log(`- recoveryLock: ${report.paths.recoveryLockPath}`);
  if (report.gate.recovery?.attempted) {
    console.log(`- recoveryRuntimeLog: ${report.gate.recovery.startedRuntime?.logPath ?? report.gate.recovery.error}`);
  }
  console.log(`- nextSafeAction: ${report.gate.nextSafeAction}`);
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

async function getJson(url, method = "GET") {
  const response = await fetch(url, { method });
  return {
    status: response.status,
    body: await response.json(),
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
