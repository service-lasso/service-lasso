import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import AdmZip from "adm-zip";
import { startApiServer } from "../dist/server/index.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { readStoredState } from "../dist/runtime/state/readState.js";

async function makeTempServicesRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "service-lasso-acquire-"));
  const servicesRoot = path.join(root, "services");
  await mkdir(servicesRoot, { recursive: true });
  return { root, servicesRoot };
}

async function writeManifest(servicesRoot, serviceId, body) {
  const serviceRoot = path.join(servicesRoot, serviceId);
  await mkdir(serviceRoot, { recursive: true });
  await writeFile(path.join(serviceRoot, "service.json"), JSON.stringify(body, null, 2));
  return serviceRoot;
}

function createZipWithRuntimeScript() {
  const zip = new AdmZip();
  zip.addFile(
    "runtime/downloaded-service.mjs",
    Buffer.from([
      'const heartbeat = setInterval(() => {}, 1000);',
      'process.on("SIGTERM", () => { clearInterval(heartbeat); process.exit(0); });',
      'console.log("downloaded-service-started");',
    ].join("\n"), "utf8"),
  );
  return zip.toBuffer();
}

async function startFakeGitHubReleaseServer(assetName, assetBytes) {
  const server = createServer((request, response) => {
    if (!request.url) {
      response.statusCode = 404;
      response.end();
      return;
    }

    const url = new URL(request.url, "http://127.0.0.1");

    if (url.pathname === "/repos/service-lasso/acquire-fixture/releases/latest") {
      const baseUrl = `http://127.0.0.1:${server.address().port}`;
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify({
        tag_name: "2026.4.23-fixture",
        assets: [
          {
            name: assetName,
            browser_download_url: `${baseUrl}/downloads/${assetName}`,
          },
        ],
      }));
      return;
    }

    if (url.pathname === `/downloads/${assetName}`) {
      response.statusCode = 200;
      response.end(assetBytes);
      return;
    }

    response.statusCode = 404;
    response.end();
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    stop: async () => {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function postJson(url) {
  const response = await fetch(url, { method: "POST" });
  return {
    status: response.status,
    body: await response.json(),
  };
}

test("install can acquire and unpack a manifest-owned release artifact without starting the service", async () => {
  resetLifecycleState();
  const { root, servicesRoot } = await makeTempServicesRoot();
  const assetName = "downloaded-service.zip";
  const releaseServer = await startFakeGitHubReleaseServer(assetName, createZipWithRuntimeScript());
  const serviceRoot = await writeManifest(servicesRoot, "downloaded-service", {
    id: "downloaded-service",
    name: "Downloaded Service",
    description: "Service installed from manifest-owned release metadata.",
    artifact: {
      kind: "archive",
      source: {
        type: "github-release",
        repo: "service-lasso/acquire-fixture",
        channel: "latest",
        api_base_url: releaseServer.baseUrl,
      },
      platforms: {
        default: {
          assetName,
          archiveType: "zip",
          command: process.execPath,
          args: ["./runtime/downloaded-service.mjs"],
        },
      },
    },
    healthcheck: {
      type: "process",
    },
  });
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const install = await postJson(`${apiServer.url}/api/services/downloaded-service/install`);
    const stored = await readStoredState(serviceRoot);
    const extractedScript = path.join(serviceRoot, ".state", "extracted", "current", "runtime", "downloaded-service.mjs");

    assert.equal(install.status, 200);
    assert.equal(install.body.state.installed, true);
    assert.equal(install.body.state.running, false);
    assert.equal(install.body.state.installArtifacts.artifact.sourceType, "github-release");
    assert.equal(install.body.state.installArtifacts.artifact.repo, "service-lasso/acquire-fixture");
    assert.equal(install.body.state.installArtifacts.artifact.assetName, assetName);
    assert.equal(typeof install.body.state.installArtifacts.artifact.archivePath, "string");
    assert.equal(typeof install.body.state.installArtifacts.artifact.extractedPath, "string");
    await writeFile(path.join(serviceRoot, ".state", "assertion.touch"), "ok");
    assert.equal(typeof stored.install?.artifact?.archivePath, "string");
    assert.equal(typeof stored.install?.artifact?.extractedPath, "string");
    const scriptStat = await import("node:fs/promises").then(({ stat }) => stat(extractedScript));
    assert.equal(scriptStat.isFile(), true);
  } finally {
    await apiServer.stop();
    await releaseServer.stop();
    resetLifecycleState();
    await rm(root, { recursive: true, force: true });
  }
});

test("start can use the installed artifact command when the manifest has no checked-in executable", async () => {
  resetLifecycleState();
  const { root, servicesRoot } = await makeTempServicesRoot();
  const assetName = "downloaded-service.zip";
  const releaseServer = await startFakeGitHubReleaseServer(assetName, createZipWithRuntimeScript());
  await writeManifest(servicesRoot, "downloaded-service", {
    id: "downloaded-service",
    name: "Downloaded Service",
    description: "Service started from an installed artifact command.",
    artifact: {
      kind: "archive",
      source: {
        type: "github-release",
        repo: "service-lasso/acquire-fixture",
        channel: "latest",
        api_base_url: releaseServer.baseUrl,
      },
      platforms: {
        default: {
          assetName,
          archiveType: "zip",
          command: process.execPath,
          args: ["./runtime/downloaded-service.mjs"],
        },
      },
    },
    healthcheck: {
      type: "process",
    },
  });
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    await postJson(`${apiServer.url}/api/services/downloaded-service/install`);
    const config = await postJson(`${apiServer.url}/api/services/downloaded-service/config`);
    const start = await postJson(`${apiServer.url}/api/services/downloaded-service/start`);
    const stop = await postJson(`${apiServer.url}/api/services/downloaded-service/stop`);

    assert.equal(config.status, 200);
    assert.equal(start.status, 200);
    assert.equal(start.body.state.running, true);
    assert.equal(start.body.state.runtime.pid > 0, true);
    assert.match(start.body.state.runtime.command, /node|node\.exe/i);
    assert.equal(stop.status, 200);
    assert.equal(stop.body.state.running, false);
  } finally {
    await apiServer.stop();
    await releaseServer.stop();
    resetLifecycleState();
    await rm(root, { recursive: true, force: true });
  }
});
