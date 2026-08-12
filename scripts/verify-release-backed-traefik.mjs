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

function endpointPortDefaults() {
  return Object.fromEntries(
    (coreTraefikManifest.endpoints ?? [])
      .filter((endpoint) => endpoint.kind === "network")
      .map((endpoint) => [endpoint.id, endpoint.port?.default ?? 0]),
  );
}

function endpointsWithPorts(ports) {
  return (coreTraefikManifest.endpoints ?? []).map((endpoint) => {
    if (endpoint.kind !== "network") {
      return endpoint;
    }

    return {
      ...endpoint,
      port: {
        ...endpoint.port,
        default: ports[endpoint.id],
      },
    };
  });
}

function renderExpectedText(value, ports) {
  const networkEndpoints = new Map(
    (coreTraefikManifest.endpoints ?? [])
      .filter((endpoint) => endpoint.kind === "network")
      .map((endpoint) => [
        endpoint.id,
        {
          bind: endpoint.bind ?? "127.0.0.1",
          port: ports[endpoint.id],
          protocol: endpoint.protocol ?? "tcp",
        },
      ]),
  );
  const urlEndpoints = new Map();
  for (const endpoint of coreTraefikManifest.endpoints ?? []) {
    if (endpoint.kind !== "url") {
      continue;
    }
    const target = networkEndpoints.get(endpoint.target);
    if (!target) {
      continue;
    }
    const renderedUrl = String(endpoint.url ?? "")
      .replace(/\$\{endpoint\.([^}]+)\.bind\}/g, (_match, id) => networkEndpoints.get(id)?.bind ?? "")
      .replace(/\$\{endpoint\.([^}]+)\.port\}/g, (_match, id) => String(networkEndpoints.get(id)?.port ?? ""));
    urlEndpoints.set(endpoint.id, renderedUrl || `${target.protocol}://${target.bind}:${target.port}/`);
  }

  return String(value)
    .replace(/\$\{endpoint\.([^}]+)\.bind\}/g, (_match, id) => networkEndpoints.get(id)?.bind ?? "")
    .replace(/\$\{endpoint\.([^}]+)\.port\}/g, (_match, id) => String(networkEndpoints.get(id)?.port ?? ""))
    .replace(/\$\{endpoint\.([^}]+)\.url\}/g, (_match, id) => urlEndpoints.get(id) ?? "");
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
        ...coreTraefikManifest,
        version: releaseVersion,
        depend_on: coreTraefikManifest.depend_on,
        endpoints: endpointsWithPorts(ports),
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
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function writeDependencyManifest(servicesRoot, serviceId) {
  await mkdir(path.join(servicesRoot, serviceId), { recursive: true });
  await writeFile(
    path.join(servicesRoot, serviceId, "service.json"),
    `${JSON.stringify(
      {
        id: serviceId,
        name: serviceId,
        description: `Traefik dependency fixture for ${serviceId}.`,
        role: "provider",
        enabled: true,
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
for (const key of Object.keys(endpointPortDefaults())) {
  ports[key] = await reserveLoopbackPort();
}

await mkdir(servicesRoot, { recursive: true });
await mkdir(workspaceRoot, { recursive: true });
await writeDependencyManifest(servicesRoot, "@localcert");
await writeDependencyManifest(servicesRoot, "@nginx");
await writeTraefikManifest(serviceRoot, ports);

const api = await startApiServer({ port: ports.api, servicesRoot, workspaceRoot });

try {
  for (const dependencyId of coreTraefikManifest.depend_on ?? []) {
    const dependencyInstall = await postJson(`${api.url}/api/services/${encodeURIComponent(dependencyId)}/install`);
    if (!dependencyInstall.ok || !dependencyInstall.state.installed) {
      throw new Error(`${dependencyId} install failed: ${JSON.stringify(dependencyInstall)}`);
    }

    const dependencyConfig = await postJson(`${api.url}/api/services/${encodeURIComponent(dependencyId)}/config`);
    if (!dependencyConfig.ok || !dependencyConfig.state.configured) {
      throw new Error(`${dependencyId} config failed: ${JSON.stringify(dependencyConfig)}`);
    }
  }

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
  if (!start.state.runtime.command.includes("--providers.file.filename=")) {
    throw new Error(`Traefik did not start with manifest commandline: ${start.state.runtime.command}`);
  }
  if (start.state.runtime.command.includes("--configFile=runtime/traefik.yml")) {
    throw new Error(`Traefik unexpectedly used fallback artifact args: ${start.state.runtime.command}`);
  }

  await waitForOk(`http://127.0.0.1:${ports.admin}/ping`);
  const health = await getJson(`${api.url}/api/services/${encodeURIComponent(serviceId)}/health`);
  if (health.health?.type !== "http" || health.health?.healthy !== true) {
    throw new Error(`Traefik runtime health did not report healthy HTTP: ${JSON.stringify(health)}`);
  }
  const globalEnv = await getJson(`${api.url}/api/globalenv`);
  const expectedGlobalEnv = Object.fromEntries(
    Object.entries(coreTraefikManifest.globalenv ?? {}).map(([key, value]) => [
      key,
      renderExpectedText(value, ports),
    ]),
  );
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

  const endpoints = new Map((network.network?.endpoints ?? []).map((endpoint) => [endpoint.id, endpoint]));
  for (const [key, value] of Object.entries(ports).filter(([key]) => key !== "api")) {
    if (endpoints.get(key)?.port !== value) {
      throw new Error(`Traefik endpoint ${key} port mismatch: ${JSON.stringify(network.network?.endpoints)}`);
    }
  }
  for (const endpoint of coreTraefikManifest.endpoints ?? []) {
    if (endpoint.kind !== "url") {
      continue;
    }
    const expectedUrl = renderExpectedText(endpoint.url, ports);
    if (endpoints.get(endpoint.id)?.url !== expectedUrl) {
      throw new Error(`Traefik endpoint ${endpoint.id} URL mismatch: ${JSON.stringify(network.network?.endpoints)}`);
    }
  }

  await postJson(`${api.url}/api/services/${encodeURIComponent(serviceId)}/stop`);
  console.log(JSON.stringify({
    ok: true,
    serviceId,
    releaseVersion,
    dependencies: coreTraefikManifest.depend_on ?? [],
    commandline: start.state.runtime.command,
    health: health.health,
    globalenv: expectedGlobalEnv,
  }, null, 2));
} finally {
  await api.stop();
  resetLifecycleState();
  await rm(tempRoot, { recursive: true, force: true });
}
