import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { access, readFile, rm } from "node:fs/promises";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(scriptDir, "..");
export const defaultDemoServicesRoot = path.join(repoRoot, "services");
export const defaultDemoWorkspaceRoot = path.join(repoRoot, "workspace", "demo-instance");
export const demoServiceIds = ["echo-service", "@node", "node-sample-service"];

function parseFlag(args, name) {
  const prefix = `--${name}=`;
  const match = args.find((value) => value.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

export function resolveDemoOptions(args = process.argv.slice(2)) {
  return {
    servicesRoot: path.resolve(parseFlag(args, "services-root") ?? defaultDemoServicesRoot),
    workspaceRoot: path.resolve(parseFlag(args, "workspace-root") ?? defaultDemoWorkspaceRoot),
    port: Number(parseFlag(args, "port") ?? process.env.SERVICE_LASSO_PORT ?? 18080),
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

    const echoHealth = await getJson(`${runtime.apiServer.url}/api/services/echo-service/health`);
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
    assertCondition(nodeProviderMetrics.body.metrics.process.launchCount >= 1, "Expected @node dependency to have launch evidence.");
    assertCondition(
      nodeProviderMetrics.body.metrics.process.lastTermination === "exited"
        || nodeProviderMetrics.body.metrics.process.running === true,
      "Expected @node dependency to show bounded launch or running evidence.",
    );
    assertCondition(
      aggregateMetrics.body.services.some((service) => service.serviceId === "echo-service"),
      "Expected aggregate metrics to include echo-service.",
    );

    const stopAll = await getJson(`${runtime.apiServer.url}/api/runtime/actions/stopAll`, "POST");
    assertCondition(stopAll.status === 200, "Expected stopAll to return 200.");
    assertCondition(
      stopAll.body.results.some((result) => result.serviceId === "echo-service"),
      "Expected stopAll to include echo-service.",
    );
    assertCondition(
      stopAll.body.results.some((result) => result.serviceId === "node-sample-service"),
      "Expected stopAll to include node-sample-service.",
    );

    const stoppedEchoMetrics = await getJson(`${runtime.apiServer.url}/api/services/echo-service/metrics`);
    const stoppedProviderMetrics = await getJson(`${runtime.apiServer.url}/api/services/node-sample-service/metrics`);

    assertCondition(stoppedEchoMetrics.body.metrics.process.running === false, "Expected echo-service to be stopped.");
    assertCondition(stoppedEchoMetrics.body.metrics.process.stopCount >= 1, "Expected echo-service stop count.");
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
