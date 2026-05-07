import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
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

function createZipWithObservableRuntimeScript() {
  const zip = new AdmZip();
  zip.addFile(
    "runtime/downloaded-service.mjs",
    Buffer.from([
      'import { writeFileSync } from "node:fs";',
      'import path from "node:path";',
      'writeFileSync(path.join(process.cwd(), "artifact-cwd.txt"), process.cwd());',
      'const heartbeat = setInterval(() => {}, 1000);',
      'process.on("SIGTERM", () => { clearInterval(heartbeat); process.exit(0); });',
      'console.log("observable-artifact-started");',
    ].join("\n"), "utf8"),
  );
  return zip.toBuffer();
}

async function waitFor(readinessCheck, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const result = await readinessCheck();
      if (result) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw lastError ?? new Error(`Condition not met within ${timeoutMs}ms`);
}

async function startFakeGitHubReleaseServer(assetName, assetBytes, options = {}) {
  let requestCount = 0;
  const releaseAssetName = options.releaseAssetName ?? assetName;
  const downloadStatus = options.downloadStatus ?? 200;
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
            name: releaseAssetName,
            browser_download_url: `${baseUrl}/downloads/${releaseAssetName}`,
          },
        ],
      }));
      return;
    }

    if (url.pathname === `/downloads/${assetName}`) {
      requestCount += 1;
      response.statusCode = downloadStatus;
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
    getRequestCount: () => requestCount,
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

function createReleaseBackedManifest(releaseServer, assetName, description = "Service installed from manifest-owned release metadata.") {
  return {
    id: "downloaded-service",
    name: "Downloaded Service",
    description,
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
  };
}

test("install can acquire and unpack a manifest-owned release artifact without starting the service", async () => {
  resetLifecycleState();
  const { root, servicesRoot } = await makeTempServicesRoot();
  const assetName = "downloaded-service.zip";
  const releaseServer = await startFakeGitHubReleaseServer(assetName, createZipWithRuntimeScript());
  const serviceRoot = await writeManifest(servicesRoot, "downloaded-service", createReleaseBackedManifest(releaseServer, assetName));
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
  await writeManifest(
    servicesRoot,
    "downloaded-service",
    createReleaseBackedManifest(releaseServer, assetName, "Service started from an installed artifact command."),
  );
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

test("start prefers an installed artifact command over a checked-in fixture command", async () => {
  resetLifecycleState();
  const { root, servicesRoot } = await makeTempServicesRoot();
  const assetName = "downloaded-service.zip";
  const releaseServer = await startFakeGitHubReleaseServer(assetName, createZipWithObservableRuntimeScript());
  await writeManifest(servicesRoot, "downloaded-service", {
    ...createReleaseBackedManifest(releaseServer, assetName, "Service should run from the installed artifact."),
    executable: process.execPath,
    args: ["./runtime/local-fixture-should-not-run.mjs"],
  });
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const install = await postJson(`${apiServer.url}/api/services/downloaded-service/install`);
    const config = await postJson(`${apiServer.url}/api/services/downloaded-service/config`);
    const start = await postJson(`${apiServer.url}/api/services/downloaded-service/start`);
    const extractedPath = install.body.state.installArtifacts.artifact.extractedPath;
    const cwdProofPath = path.join(servicesRoot, "downloaded-service", "artifact-cwd.txt");
    const cwdProof = await waitFor(() => readFile(cwdProofPath, "utf8"));
    const stop = await postJson(`${apiServer.url}/api/services/downloaded-service/stop`);

    assert.equal(config.status, 200);
    assert.equal(start.status, 200);
    assert.equal(start.body.state.running, true);
    assert.equal(path.resolve(cwdProof), path.resolve(servicesRoot, "downloaded-service"));
    assert.equal(start.body.state.runtime.command.includes(path.join(extractedPath, "runtime", "downloaded-service.mjs")), true);
    assert.match(start.body.state.runtime.command, /downloaded-service\.mjs/);
    assert.doesNotMatch(start.body.state.runtime.command, /local-fixture-should-not-run/);
    assert.equal(stop.status, 200);
  } finally {
    await apiServer.stop();
    await releaseServer.stop();
    resetLifecycleState();
    await rm(root, { recursive: true, force: true });
  }
});

test("install reuses a preloaded archive without downloading it again", async () => {
  resetLifecycleState();
  const { root, servicesRoot } = await makeTempServicesRoot();
  const assetName = "downloaded-service.zip";
  const releaseServer = await startFakeGitHubReleaseServer(assetName, createZipWithRuntimeScript());
  const serviceRoot = await writeManifest(
    servicesRoot,
    "downloaded-service",
    createReleaseBackedManifest(releaseServer, assetName, "Service installed from a preloaded archive without redownloading it."),
  );
  const preloadedArchiveDir = path.join(serviceRoot, ".state", "artifacts", "2026.4.23-fixture");
  await mkdir(preloadedArchiveDir, { recursive: true });
  await writeFile(path.join(preloadedArchiveDir, assetName), createZipWithRuntimeScript());
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const install = await postJson(`${apiServer.url}/api/services/downloaded-service/install`);
    const stored = await readStoredState(serviceRoot);

    assert.equal(install.status, 200);
    assert.equal(stored.install?.artifact?.archivePath?.endsWith(assetName), true);
    assert.equal(releaseServer.getRequestCount(), 0);
  } finally {
    await apiServer.stop();
    await releaseServer.stop();
    resetLifecycleState();
    await rm(root, { recursive: true, force: true });
  }
});

test("install fails clearly when release metadata does not contain the requested artifact", async () => {
  resetLifecycleState();
  const { root, servicesRoot } = await makeTempServicesRoot();
  const assetName = "downloaded-service.zip";
  const releaseServer = await startFakeGitHubReleaseServer(assetName, createZipWithRuntimeScript(), {
    releaseAssetName: "other-service.zip",
  });
  const serviceRoot = await writeManifest(servicesRoot, "downloaded-service", createReleaseBackedManifest(releaseServer, assetName));
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const install = await postJson(`${apiServer.url}/api/services/downloaded-service/install`);
    const stored = await readStoredState(serviceRoot);

    assert.equal(install.status, 500);
    assert.equal(install.body.error, "internal_error");
    assert.match(install.body.message, /did not contain asset "downloaded-service\.zip"/);
    assert.equal(stored.install, null);
  } finally {
    await apiServer.stop();
    await releaseServer.stop();
    resetLifecycleState();
    await rm(root, { recursive: true, force: true });
  }
});

test("install fails clearly when the resolved artifact download URL is bad", async () => {
  resetLifecycleState();
  const { root, servicesRoot } = await makeTempServicesRoot();
  const assetName = "downloaded-service.zip";
  const releaseServer = await startFakeGitHubReleaseServer(assetName, createZipWithRuntimeScript(), {
    downloadStatus: 404,
  });
  const serviceRoot = await writeManifest(servicesRoot, "downloaded-service", createReleaseBackedManifest(releaseServer, assetName));
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const install = await postJson(`${apiServer.url}/api/services/downloaded-service/install`);
    const stored = await readStoredState(serviceRoot);

    assert.equal(install.status, 500);
    assert.equal(install.body.error, "internal_error");
    assert.match(install.body.message, /Failed to download service artifact/);
    assert.match(install.body.message, /404/);
    assert.equal(stored.install, null);
    assert.equal(releaseServer.getRequestCount(), 1);
  } finally {
    await apiServer.stop();
    await releaseServer.stop();
    resetLifecycleState();
    await rm(root, { recursive: true, force: true });
  }
});
