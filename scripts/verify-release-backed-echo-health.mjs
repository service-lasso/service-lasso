import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { startApiServer } from "../dist/server/index.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";

const ECHO_SERVICE_ID = "echo-service";
const ECHO_RELEASE_VERSION = "2026.4.20-a417abd";
const ECHO_RELEASE_BASE =
  `https://github.com/service-lasso/lasso-echoservice/releases/download/${ECHO_RELEASE_VERSION}`;

function platformArchive() {
  switch (process.platform) {
    case "win32":
      return {
        assetName: "echo-service-win32.zip",
        assetUrl: `${ECHO_RELEASE_BASE}/echo-service-win32.zip`,
        archiveType: "zip",
        command: "./echo-service.exe",
      };
    case "darwin":
      return {
        assetName: "echo-service-darwin.tar.gz",
        assetUrl: `${ECHO_RELEASE_BASE}/echo-service-darwin.tar.gz`,
        archiveType: "tar.gz",
        command: "./echo-service",
      };
    default:
      return {
        assetName: "echo-service-linux.tar.gz",
        assetUrl: `${ECHO_RELEASE_BASE}/echo-service-linux.tar.gz`,
        archiveType: "tar.gz",
        command: "./echo-service",
      };
  }
}

async function getFreePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  if (!port) {
    throw new Error("Failed to allocate a free local TCP port.");
  }
  return port;
}

async function writeEchoManifest(servicesRoot, healthcheck, ports) {
  const serviceRoot = path.join(servicesRoot, ECHO_SERVICE_ID);
  await mkdir(serviceRoot, { recursive: true });
  const archive = platformArchive();
  const manifest = {
    id: ECHO_SERVICE_ID,
    name: "Echo Service",
    description: "Release-backed Echo Service health verification harness.",
    version: ECHO_RELEASE_VERSION,
    enabled: true,
    artifact: {
      kind: "archive",
      source: {
        type: "github-release",
        repo: "service-lasso/lasso-echoservice",
        tag: ECHO_RELEASE_VERSION,
        serviceManifestAssetUrl: `${ECHO_RELEASE_BASE}/service.json`,
      },
      platforms: {
        [process.platform]: {
          ...archive,
          args: [],
        },
      },
    },
    env: {
      ECHO_MESSAGE: "release-backed health verification",
      ECHO_PORT: String(ports.ui),
      ECHO_HTTP_HEALTH_PORT: String(ports.http),
      ECHO_TCP_PORT: String(ports.tcp),
      ECHO_LOG_PATH: "./runtime/echo.log",
      ECHO_STATE_PATH: "./runtime/state.json",
      ECHO_DB_PATH: "./runtime/echo.sqlite",
      SERVICE_LASSO_GLOBAL_ENV_JSON: "{\"ECHO_ENV_CHANNEL\":\"release-health\"}",
    },
    urls: [
      {
        label: "ui",
        url: `http://127.0.0.1:${ports.ui}/`,
        kind: "local",
      },
    ],
    healthcheck,
  };

  await writeFile(path.join(serviceRoot, "service.json"), JSON.stringify(manifest, null, 2));
  return serviceRoot;
}

async function postJson(url, body = undefined) {
  const response = await fetch(url, {
    method: "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const responseBody = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`POST ${url} failed with ${response.status}: ${JSON.stringify(responseBody)}`);
  }

  return responseBody;
}

async function getJson(url) {
  const response = await fetch(url);
  const responseBody = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`GET ${url} failed with ${response.status}: ${JSON.stringify(responseBody)}`);
  }

  return responseBody;
}

async function waitFor(description, predicate, timeoutMs = 20_000) {
  const startedAt = Date.now();
  let lastValue;

  while (Date.now() - startedAt < timeoutMs) {
    lastValue = await predicate();
    if (lastValue) {
      return lastValue;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for ${description}. Last value: ${JSON.stringify(lastValue)}`);
}

async function runScenario(healthcheck, exercise) {
  resetLifecycleState();
  const root = await mkdtemp(path.join(tmpdir(), "service-lasso-echo-health-"));
  const servicesRoot = path.join(root, "services");
  const workspaceRoot = path.join(root, "workspace");
  const ports = {
    api: await getFreePort(),
    ui: await getFreePort(),
    http: await getFreePort(),
    tcp: await getFreePort(),
  };
  await mkdir(servicesRoot, { recursive: true });
  await mkdir(workspaceRoot, { recursive: true });
  await writeEchoManifest(servicesRoot, healthcheck(ports), ports);
  const apiServer = await startApiServer({ port: ports.api, servicesRoot, workspaceRoot });

  try {
    await postJson(`${apiServer.url}/api/services/${ECHO_SERVICE_ID}/install`);
    await postJson(`${apiServer.url}/api/services/${ECHO_SERVICE_ID}/config`);
    const start = await postJson(`${apiServer.url}/api/services/${ECHO_SERVICE_ID}/start`);

    if (!start.ok || !start.state.running) {
      throw new Error(`Echo Service did not start: ${JSON.stringify(start)}`);
    }

    const result = await exercise({ apiUrl: apiServer.url, echoUrl: `http://127.0.0.1:${ports.ui}`, ports });
    await postJson(`${apiServer.url}/api/services/${ECHO_SERVICE_ID}/stop`);
    return result;
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(root, { recursive: true, force: true });
  }
}

async function readRuntimeHealth(apiUrl) {
  const body = await getJson(`${apiUrl}/api/services/${ECHO_SERVICE_ID}/health`);
  return body.health;
}

async function verifyHttpHealth() {
  return await runScenario(
    (ports) => ({
      type: "http",
      url: `http://127.0.0.1:${ports.http}/health`,
      expected_status: 200,
      interval: 250,
      retries: 40,
    }),
    async ({ apiUrl, echoUrl }) => {
      const initial = await waitFor("runtime-observed HTTP health to become healthy", async () => {
        const health = await readRuntimeHealth(apiUrl);
        return health.type === "http" && health.healthy ? health : false;
      });

      await postJson(`${echoUrl}/action/http-health`, {
        mode: "error",
        message: "release readiness forced HTTP error",
      });

      const error = await waitFor("runtime-observed HTTP health to become unhealthy", async () => {
        const health = await readRuntimeHealth(apiUrl);
        return health.type === "http" && !health.healthy && health.detail.includes("500") ? health : false;
      });

      await postJson(`${echoUrl}/action/http-health`, {
        mode: "healthy",
        message: "release readiness restored HTTP health",
      });

      const recovered = await waitFor("runtime-observed HTTP health to recover", async () => {
        const health = await readRuntimeHealth(apiUrl);
        return health.type === "http" && health.healthy ? health : false;
      });

      return { initial, error, recovered };
    },
  );
}

async function verifyTcpHealth() {
  return await runScenario(
    (ports) => ({
      type: "tcp",
      address: `127.0.0.1:${ports.tcp}`,
      interval: 250,
      retries: 40,
    }),
    async ({ apiUrl, echoUrl }) => {
      const initial = await waitFor("runtime-observed TCP health to become healthy", async () => {
        const health = await readRuntimeHealth(apiUrl);
        return health.type === "tcp" && health.healthy ? health : false;
      });

      await postJson(`${echoUrl}/action/tcp-health`, {
        mode: "stopped",
        message: "release readiness stopped TCP health listener",
      });

      const stopped = await waitFor("runtime-observed TCP health to become unreachable", async () => {
        const health = await readRuntimeHealth(apiUrl);
        return health.type === "tcp" && !health.healthy ? health : false;
      });

      await postJson(`${echoUrl}/action/tcp-health`, {
        mode: "healthy",
        message: "release readiness restored TCP health listener",
      });

      const recovered = await waitFor("runtime-observed TCP health to recover", async () => {
        const health = await readRuntimeHealth(apiUrl);
        return health.type === "tcp" && health.healthy ? health : false;
      });

      return { initial, stopped, recovered };
    },
  );
}

const http = await verifyHttpHealth();
const tcp = await verifyTcpHealth();

console.log(JSON.stringify({
  ok: true,
  serviceId: ECHO_SERVICE_ID,
  releaseVersion: ECHO_RELEASE_VERSION,
  scenarios: {
    http,
    tcp,
  },
  note: "TCP health currently proves listener reachability/unreachability; HTTP health proves status-code error and recovery.",
}, null, 2));
