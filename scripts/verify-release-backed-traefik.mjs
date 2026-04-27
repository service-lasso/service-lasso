import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startApiServer } from "../dist/server/index.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const coreTraefikManifest = JSON.parse(
  await readFile(path.join(repoRoot, "services", "@traefik", "service.json"), "utf8"),
);
const serviceId = "@traefik";
const releaseVersion = coreTraefikManifest.artifact?.source?.tag;
if (!releaseVersion || coreTraefikManifest.version !== releaseVersion) {
  throw new Error("Core @traefik manifest version must match artifact.source.tag for release verification.");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function reserveLoopbackPort() {
  const { createServer } = await import("node:net");
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

function platformArtifact() {
  switch (process.platform) {
    case "win32":
      return {
        assetName: "lasso-traefik-win32.zip",
        archiveType: "zip",
        command: ".\\traefik.exe",
        args: ["--configFile=runtime/traefik.yml"],
      };
    case "darwin":
      return {
        assetName: "lasso-traefik-darwin.tar.gz",
        archiveType: "tar.gz",
        command: "./traefik",
        args: ["--configFile=runtime/traefik.yml"],
      };
    default:
      return {
        assetName: "lasso-traefik-linux.tar.gz",
        archiveType: "tar.gz",
        command: "./traefik",
        args: ["--configFile=runtime/traefik.yml"],
      };
  }
}

async function postJson(url) {
  const response = await fetch(url, {
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

async function getJson(url) {
  const response = await fetch(url);
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(`GET ${url} failed with ${response.status}: ${JSON.stringify(body)}`);
  }

  return body;
}

async function waitForOk(url, timeoutMs = 30_000) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }

  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

async function writeTraefikManifest(serviceRoot, ports) {
  await mkdir(serviceRoot, { recursive: true });
  await writeFile(
    path.join(serviceRoot, "service.json"),
    `${JSON.stringify(
      {
        id: serviceId,
        name: "Traefik Router",
        description: "Release-backed Traefik verification manifest.",
        version: releaseVersion,
        enabled: true,
        ports: Object.fromEntries(
          Object.keys(coreTraefikManifest.ports ?? {}).map((key) => [key, ports[key]]),
        ),
        env: coreTraefikManifest.env,
        globalenv: coreTraefikManifest.globalenv,
        artifact: {
          kind: "archive",
          source: {
            type: "github-release",
            repo: coreTraefikManifest.artifact.source.repo,
            tag: releaseVersion,
          },
          platforms: {
            [process.platform]: platformArtifact(),
          },
        },
        install: {
          files: [
            {
              path: "./runtime/dynamic.yml",
              content: "http:\n  routers: {}\n  services: {}\n",
            },
          ],
        },
        config: coreTraefikManifest.config,
        healthcheck: coreTraefikManifest.healthcheck,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

resetLifecycleState();
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-traefik-release-"));
const servicesRoot = path.join(tempRoot, "services");
const workspaceRoot = path.join(tempRoot, "workspace");
const serviceRoot = path.join(servicesRoot, serviceId);
const ports = {
  api: await reserveLoopbackPort(),
};
for (const key of Object.keys(coreTraefikManifest.ports ?? {})) {
  ports[key] = await reserveLoopbackPort();
}

await mkdir(servicesRoot, { recursive: true });
await mkdir(workspaceRoot, { recursive: true });
await writeTraefikManifest(serviceRoot, ports);

const api = await startApiServer({ port: ports.api, servicesRoot, workspaceRoot });

try {
  const install = await postJson(`${api.url}/api/services/${encodeURIComponent(serviceId)}/install`);
  if (!install.ok || !install.state.installed) {
    throw new Error(`Traefik install failed: ${JSON.stringify(install)}`);
  }

  const config = await postJson(`${api.url}/api/services/${encodeURIComponent(serviceId)}/config`);
  if (!config.ok || !config.state.configured) {
    throw new Error(`Traefik config failed: ${JSON.stringify(config)}`);
  }

  const start = await postJson(`${api.url}/api/services/${encodeURIComponent(serviceId)}/start`);
  if (!start.ok || !start.state.running) {
    throw new Error(`Traefik start failed: ${JSON.stringify(start)}`);
  }

  await waitForOk(`http://127.0.0.1:${ports.admin}/ping`);
  const health = await getJson(`${api.url}/api/services/${encodeURIComponent(serviceId)}/health`);
  if (health.health?.type !== "http" || health.health?.healthy !== true) {
    throw new Error(`Traefik runtime health did not report healthy HTTP: ${JSON.stringify(health)}`);
  }
  const globalEnv = await getJson(`${api.url}/api/globalenv`);
  const expectedGlobalEnv = {
    TRAEFIK_HTTP_PORT: String(ports.web),
    TRAEFIK_HTTPS_PORT: String(ports.websecure),
    TRAEFIK_INTERNAL_PORT: String(ports.admin),
    TRAEFIK_HTTPS_TRAEFIK_PORT: String(ports.https_traefik),
    TRAEFIK_HTTPS_NGINX_PORT: String(ports.https_nginx),
    TRAEFIK_HTTPS_CMS_PORT: String(ports.https_cms),
    TRAEFIK_HTTPS_FLOW_PORT: String(ports.https_flow),
    TRAEFIK_HTTPS_FLOWTMS_PORT: String(ports.https_flowtms),
    TRAEFIK_HTTPS_API_PORT: String(ports.https_api),
    TRAEFIK_HTTPS_FILES_PORT: String(ports.https_files),
    TRAEFIK_HTTPS_BPMN_PORT: String(ports.https_bpmn),
    TRAEFIK_MONGO_PORT: String(ports.mongo),
    TRAEFIK_TYPEDB_PORT: String(ports.typedb),
    TRAEFIK_WEB_URL: `http://127.0.0.1:${ports.web}/`,
    TRAEFIK_WEBSECURE_URL: `https://127.0.0.1:${ports.websecure}/`,
    TRAEFIK_DASHBOARD_URL: `http://127.0.0.1:${ports.admin}/dashboard/`,
    TRAEFIK_PING_URL: `http://127.0.0.1:${ports.admin}/ping`,
    TRAEFIK_TRAEFIK_URL: `http://127.0.0.1:${ports.admin}/dashboard/`,
    TRAEFIK_HOST_DOMAIN: "localhost",
    TRAEFIK_HOST_DOMAIN_URL: "localhost",
    TRAEFIK_HOST_DOMAIN_SUFFIX: "localhost",
  };
  for (const [key, value] of Object.entries(expectedGlobalEnv)) {
    if (globalEnv.globalenv?.[key] !== value) {
      throw new Error(`Traefik globalenv ${key} mismatch: ${JSON.stringify(globalEnv.globalenv)}`);
    }
  }
  const network = await getJson(`${api.url}/api/services/${encodeURIComponent(serviceId)}/network`);
  for (const [key, value] of Object.entries(ports).filter(([key]) => key !== "api")) {
    if (network.network?.ports?.[key] !== value) {
      throw new Error(`Traefik network port ${key} mismatch: ${JSON.stringify(network.network?.ports)}`);
    }
  }

  await postJson(`${api.url}/api/services/${encodeURIComponent(serviceId)}/stop`);
  console.log(JSON.stringify({ ok: true, serviceId, releaseVersion, health: health.health, globalenv: expectedGlobalEnv }, null, 2));
} finally {
  await api.stop();
  resetLifecycleState();
  await rm(tempRoot, { recursive: true, force: true });
}
