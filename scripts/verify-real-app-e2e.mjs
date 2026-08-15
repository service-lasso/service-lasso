import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildReachabilityTargets } from "./demo-verify-canonical.mjs";
import {
  discoverOwningRuntime,
  observeBoundedJsonObject,
  ownerExitFailure,
  requireRuntimeServicePort,
  RuntimeOwnerFailure,
  waitForBaselineCompletion,
} from "./runtime-owner.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "dist", "cli.js");
const sourceServicesRoot = path.join(repoRoot, "services");
const baselineServiceIds = ["@archive", "@java", "@localcert", "@nginx", "@node", "@secretsbroker", "@serviceadmin", "@traefik", "echo-service", "node-sample-service"];
const providerServiceIds = new Set(["@archive", "@java", "@localcert", "@node"]);

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
  const request = fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  if (!activeRuntimeOwner) return request;
  if (activeRuntimeOwner.exit) throw ownerExitFailure(activeRuntimeOwner, activeRuntimeIdentity?.record);
  const result = await Promise.race([
    request.then((response) => ({ response })),
    activeRuntimeOwner.closed.then(() => ({ ownerExited: true })),
  ]);
  if (result.ownerExited || activeRuntimeOwner.exit) {
    throw ownerExitFailure(activeRuntimeOwner, activeRuntimeIdentity?.record);
  }
  return result.response;
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
      if (error instanceof RuntimeOwnerFailure) throw error;
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
      if (error instanceof RuntimeOwnerFailure) throw error;
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

  const bootstrapOutput = observeBoundedJsonObject(child.stdout);
  let stderrBytes = 0;
  child.stderr?.on("data", (chunk) => {
    stderrBytes += chunk.length;
  });

  let exit = null;
  const closed = new Promise((resolve) => {
    child.once("close", (code, signal) => {
      exit = { code, signal };
      resolve(exit);
    });
  });

  return {
    child,
    closed,
    pid: child.pid,
    get exit() { return exit; },
    bootstrapOutput,
    get stdoutBytes() { return bootstrapOutput.bytes; },
    get stderrBytes() { return stderrBytes; },
  };
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
    let changed = false;

    if (manifest.ports && typeof manifest.ports === "object" && !Array.isArray(manifest.ports)) {
      const rebasedPorts = {};
      for (const portName of Object.keys(manifest.ports)) {
        rebasedPorts[portName] = await reserveLoopbackPort();
      }
      manifest.ports = rebasedPorts;
      changed = true;
    }

    if (Array.isArray(manifest.endpoints)) {
      for (const endpoint of manifest.endpoints) {
        if (endpoint?.kind !== "network" || !endpoint.port || typeof endpoint.port !== "object") {
          continue;
        }
        endpoint.port.default = await reserveLoopbackPort();
        changed = true;
      }
    }

    if (changed) {
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    }
  }
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
      if (error instanceof RuntimeOwnerFailure) throw error;
      lastError = error;
    }
    await sleep(250);
  }

  throw lastError ?? new Error(`Timed out waiting for ${label} endpoint ${url}`);
}

async function waitForReachableEndpoint(url, label, expectedStatus = 200, timeoutMs = 300_000) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetchWithTimeout(url, {}, 10_000);
      const body = await response.text().catch(() => "");
      if (response.status === expectedStatus) {
        console.error(`[service-lasso e2e] ${label} reachable: ${url} HTTP ${response.status}`);
        return body;
      }
      lastError = new Error(`GET ${url} failed with ${response.status}: ${body.slice(0, 500)}`);
    } catch (error) {
      if (error instanceof RuntimeOwnerFailure) throw error;
      lastError = error;
    }
    await sleep(250);
  }

  throw lastError ?? new Error(`Timed out waiting for ${label} endpoint ${url}`);
}

async function verifyAdvertisedReachability(servicesRoot, service) {
  const manifest = await readJson(path.join(servicesRoot, service.id, "service.json"));
  if (providerServiceIds.has(service.id)) {
    const providerTargets = buildReachabilityTargets(service.id, manifest, service.lifecycle?.runtime?.ports ?? manifest.ports ?? {});
    assert(providerTargets.length === 0, `${service.id} provider service should not advertise daemon URL reachability targets.`);
    console.error(`[service-lasso e2e] ${service.id} provider/non-daemon URL reachability not applicable`);
    return;
  }

  const targets = buildReachabilityTargets(service.id, manifest, service.lifecycle?.runtime?.ports ?? manifest.ports ?? {});
  for (const target of targets) {
    const body = await waitForReachableEndpoint(target.url, `${service.id} ${target.label}`, target.expectedStatus);
    assert(body.length > 0, `${service.id} ${target.label} returned an empty body.`);
  }
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
let apiUrl = null;
let cli = null;
let servicesStopped = false;
let activeRuntimeOwner = null;
let activeRuntimeIdentity = null;
let verificationStep = "prepare_fixture";
let verificationEvidence = null;

try {
  console.error(`[service-lasso e2e] temp root ${tempRoot}`);
  await mkdir(path.join(workspaceRoot, "vault"), { recursive: true });
  await writeFile(path.join(workspaceRoot, "vault", "vault.json"), "ready\n", "utf8");
  await copyCheckedInServices(servicesRoot);
  await rebaseManifestPorts(servicesRoot);
  verificationStep = "start_runtime";
  cli = startCli({ servicesRoot, workspaceRoot, port: apiPort, servicePortStart: apiPort + 1 });
  activeRuntimeIdentity = await discoverOwningRuntime({ owner: cli, servicesRoot, workspaceRoot });
  activeRuntimeOwner = cli;
  apiUrl = activeRuntimeIdentity.apiUrl;
  const health = activeRuntimeIdentity.health;
  console.error(`[service-lasso e2e] owning runtime generation ${activeRuntimeIdentity.generationId} pid ${activeRuntimeIdentity.ownerPid} selected API port ${new URL(apiUrl).port}`);
  assert(health.status === "ok" && health.api?.status === "up", "Core API health did not report ok/up.");
  verificationStep = "baseline_completion";
  await waitForBaselineCompletion({
    owner: cli,
    runtime: activeRuntimeIdentity,
    output: cli.bootstrapOutput,
    servicesRoot,
    workspaceRoot,
  });

  verificationStep = "service_catalog";
  const services = await waitForJson(`${apiUrl}/api/services`);
  const serviceIds = services.services.map((service) => service.id).sort();
  const missingServiceIds = baselineServiceIds.filter((serviceId) => !serviceIds.includes(serviceId));
  verificationEvidence = missingServiceIds.length > 0 ? { missingServiceIds } : null;
  for (const serviceId of baselineServiceIds) {
    assert(serviceIds.includes(serviceId), `Real app service list is missing ${serviceId}.`);
  }
  verificationEvidence = null;

  for (const action of ["install", "config", "start"]) {
    await postJson(`${apiUrl}/api/services/${encodeURIComponent("node-sample-service")}/${action}`);
  }

  const liveServices = new Map();
  for (const serviceId of baselineServiceIds) {
    const isProvider = providerServiceIds.has(serviceId);
    liveServices.set(
      serviceId,
      await waitForServiceState(apiUrl, serviceId, { running: !isProvider, healthy: isProvider ? undefined : true }),
    );
  }

  verificationStep = "dashboard_summary";
  console.error("[service-lasso e2e] baseline services reached expected state");
  const dashboard = await waitForJson(`${apiUrl}/api/dashboard`);
  assert(dashboard.summary?.servicesTotal >= baselineServiceIds.length, "Dashboard summary did not include baseline services.");
  assert(dashboard.summary?.servicesRunning >= baselineServiceIds.length - providerServiceIds.size, "Dashboard running count is lower than expected baseline daemons.");

  verificationStep = "dashboard_services";
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

  verificationStep = "baseline_reachability";
  const serviceAdminPort = requireRuntimeServicePort(liveServices.get("@serviceadmin"), "ui");
  await waitForHealthyHttp(`http://127.0.0.1:${serviceAdminPort}/`, "Service Admin UI");
  await waitForHealthyHttp(`http://127.0.0.1:${serviceAdminPort}/health`, "Service Admin health");
  await waitForHealthyHttp(`http://127.0.0.1:${requireRuntimeServicePort(liveServices.get("@nginx"), "http")}/health`, "NGINX health");
  await waitForHealthyHttp(`http://127.0.0.1:${requireRuntimeServicePort(liveServices.get("echo-service"), "health")}/health`, "Echo Service health");
  await waitForHealthyHttp(`http://127.0.0.1:${requireRuntimeServicePort(liveServices.get("@traefik"), "admin")}/ping`, "Traefik ping");

  verificationStep = "advertised_reachability";
  const liveAfterStart = await waitForJson(`${apiUrl}/api/services`);
  for (const service of liveAfterStart.services.filter((entry) => baselineServiceIds.includes(entry.id))) {
    await verifyAdvertisedReachability(servicesRoot, service);
  }

  verificationStep = "service_admin_content";
  const serviceAdminHtml = await waitForText(`http://127.0.0.1:${serviceAdminPort}/`);
  assert(/Service Lasso|service-lasso|root/i.test(serviceAdminHtml), "Service Admin UI root did not return recognizable app content.");

  verificationStep = "secrets_broker_restart";
  const stopBroker = await postJson(`${apiUrl}/api/services/${encodeURIComponent("@secretsbroker")}/stop`);
  assert(stopBroker.ok === true, "Stopping @secretsbroker did not return ok=true.");
  await waitForServiceState(apiUrl, "@secretsbroker", { running: false, healthy: undefined });

  const startBroker = await postJson(`${apiUrl}/api/services/${encodeURIComponent("@secretsbroker")}/start`);
  assert(startBroker.ok === true, "Starting @secretsbroker did not return ok=true.");
  await waitForServiceState(apiUrl, "@secretsbroker", { running: true });

  verificationStep = "reverse_cleanup";
  await postJson(`${apiUrl}/api/runtime/actions/stopAll`);
  servicesStopped = true;
  console.log("[service-lasso e2e] real app baseline state gate passed");
} catch (error) {
  if (!apiUrl && error instanceof RuntimeOwnerFailure && error.cleanupApiUrl) {
    apiUrl = error.cleanupApiUrl;
  }
  const failure = error instanceof RuntimeOwnerFailure
    ? error.diagnostic
    : {
        schema: "service-lasso.real-app-e2e-failure.v1",
        code: "real_app_verification_failed",
        observedAt: new Date().toISOString(),
        causeClass: error instanceof Error ? error.name : "unknown",
        phase: "verification",
        step: verificationStep,
        owner: cli ? {
          pid: cli.pid,
          exitCode: cli.exit?.code ?? null,
          signal: cli.exit?.signal ?? null,
          stdoutBytes: cli.stdoutBytes,
          stderrBytes: cli.stderrBytes,
        } : null,
        runtime: activeRuntimeIdentity ? {
          instanceId: activeRuntimeIdentity.instanceId,
          generationId: activeRuntimeIdentity.generationId,
          pid: activeRuntimeIdentity.ownerPid,
          apiPort: Number(new URL(activeRuntimeIdentity.apiUrl).port),
        } : null,
        ...(verificationEvidence ? { evidence: verificationEvidence } : {}),
      };
  console.error(`[service-lasso e2e] ${JSON.stringify(failure)}`);
  throw new Error(JSON.stringify(failure));
} finally {
  if (!servicesStopped && apiUrl && !cli?.exit) {
    try {
      // The isolated services/workspace roots are owned by this verification
      // transaction. stopAll uses the runtime dependency graph's shutdown order.
      await postJson(`${apiUrl}/api/runtime/actions/stopAll`);
      servicesStopped = true;
    } catch {}
  }
  if (cli) {
    await stopChild(cli.child);
  }
  await rm(tempRoot, { recursive: true, force: true });
}
