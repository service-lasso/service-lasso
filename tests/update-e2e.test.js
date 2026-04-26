import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import AdmZip from "adm-zip";
import { startApiServer } from "../dist/server/index.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { readStoredState } from "../dist/runtime/state/readState.js";

const execFile = promisify(execFileCallback);
const oldTag = "2026.4.20-old";
const latestTag = "2026.4.24-new";
const defaultAssetName = "update-fixture.zip";
const brokenDownloadAssetName = "broken-download.zip";
const brokenInstallAssetName = "broken-install.zip";

async function makeTempRuntimeRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "service-lasso-update-e2e-"));
  const servicesRoot = path.join(root, "services");
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(servicesRoot, { recursive: true });
  await mkdir(workspaceRoot, { recursive: true });
  return { root, servicesRoot, workspaceRoot };
}

async function writeManifest(servicesRoot, serviceId, body) {
  const serviceRoot = path.join(servicesRoot, serviceId);
  await mkdir(serviceRoot, { recursive: true });
  await writeFile(path.join(serviceRoot, "service.json"), JSON.stringify(body, null, 2));
  return serviceRoot;
}

async function writeInstalledArtifact(serviceRoot, tag, assetName = defaultAssetName) {
  const stateRoot = path.join(serviceRoot, ".state");
  await mkdir(stateRoot, { recursive: true });
  await writeFile(
    path.join(stateRoot, "install.json"),
    JSON.stringify(
      {
        installed: true,
        artifact: {
          sourceType: "github-release",
          repo: "service-lasso/update-fixture",
          tag,
          assetName,
          archivePath: `active/${tag}/${assetName}`,
        },
      },
      null,
      2,
    ),
  );
}

function createValidUpdateArchive() {
  const zip = new AdmZip();
  zip.addFile(
    "runtime/update-fixture.mjs",
    Buffer.from('console.log("service-lasso update e2e candidate");\n', "utf8"),
  );
  return zip.toBuffer();
}

async function startFakeGitHubReleaseServer() {
  const downloads = new Map();
  const server = createServer((request, response) => {
    if (!request.url) {
      response.statusCode = 404;
      response.end();
      return;
    }

    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/repos/service-lasso/update-fixture/releases/latest") {
      const baseUrl = `http://127.0.0.1:${server.address().port}`;
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify({
        tag_name: latestTag,
        name: latestTag,
        html_url: `${baseUrl}/releases/${latestTag}`,
        published_at: "2026-04-24T00:00:00Z",
        assets: [
          {
            name: defaultAssetName,
            browser_download_url: `${baseUrl}/downloads/${defaultAssetName}`,
          },
          {
            name: brokenDownloadAssetName,
            browser_download_url: `${baseUrl}/downloads/${brokenDownloadAssetName}`,
          },
          {
            name: brokenInstallAssetName,
            browser_download_url: `${baseUrl}/downloads/${brokenInstallAssetName}`,
          },
        ],
      }));
      return;
    }

    if (url.pathname.startsWith("/downloads/")) {
      const assetName = path.basename(url.pathname);
      downloads.set(assetName, (downloads.get(assetName) ?? 0) + 1);

      if (assetName === brokenDownloadAssetName) {
        response.statusCode = 503;
        response.end("download unavailable");
        return;
      }

      if (assetName === brokenInstallAssetName) {
        response.statusCode = 200;
        response.end("not a zip archive");
        return;
      }

      response.statusCode = 200;
      response.end(createValidUpdateArchive());
      return;
    }

    response.statusCode = 404;
    response.end();
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    getDownloadCount: (assetName) => downloads.get(assetName) ?? 0,
    stop: async () => {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function fullInstallWindow() {
  return {
    start: "00:00",
    end: "00:00",
    timezone: "UTC",
  };
}

function outsideInstallWindow() {
  const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return {
    days: [days[(new Date().getUTCDay() + 1) % days.length]],
    start: "00:00",
    end: "00:01",
    timezone: "UTC",
  };
}

function createUpdateManifest(releaseServer, options = {}) {
  const {
    serviceId = "update-fixture",
    assetName = defaultAssetName,
    updates = {
      mode: "install",
      track: "latest",
      installWindow: fullInstallWindow(),
      runningService: "skip",
    },
  } = options;

  return {
    id: serviceId,
    name: serviceId,
    description: "Deterministic release-backed service used for update E2E tests.",
    version: oldTag,
    artifact: {
      kind: "archive",
      source: {
        type: "github-release",
        repo: "service-lasso/update-fixture",
        tag: oldTag,
        api_base_url: releaseServer.baseUrl,
      },
      platforms: {
        default: {
          assetName,
          archiveType: "zip",
          command: "node",
          args: ["runtime/update-fixture.mjs"],
        },
      },
    },
    updates,
  };
}

async function runCli(args, cwd = path.resolve(".")) {
  const cliPath = path.join(cwd, "dist", "cli.js");
  const result = await execFile(process.execPath, [cliPath, ...args], {
    cwd,
    env: {
      ...process.env,
      npm_package_version: "0.1.0-test",
    },
  });

  return result.stdout.trim();
}

async function getJson(url) {
  const response = await fetch(url);
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function postJson(url, body = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

test("update lifecycle E2E keeps CLI, API, update state, and install metadata in agreement", async () => {
  resetLifecycleState();
  const { root, servicesRoot, workspaceRoot } = await makeTempRuntimeRoot();
  const releaseServer = await startFakeGitHubReleaseServer();
  let apiServer = null;

  try {
    const oldServiceRoot = await writeManifest(servicesRoot, "installed-old", createUpdateManifest(releaseServer, {
      serviceId: "installed-old",
    }));
    await writeInstalledArtifact(oldServiceRoot, oldTag);

    const latestServiceRoot = await writeManifest(servicesRoot, "latest-installed", createUpdateManifest(releaseServer, {
      serviceId: "latest-installed",
    }));
    await writeInstalledArtifact(latestServiceRoot, latestTag);

    const cliCheck = JSON.parse(await runCli([
      "updates",
      "check",
      "--services-root",
      servicesRoot,
      "--workspace-root",
      workspaceRoot,
      "--json",
    ]));
    const checkedById = new Map(cliCheck.services.map((entry) => [entry.serviceId, entry]));
    assert.equal(checkedById.get("installed-old").result.status, "update_available");
    assert.equal(checkedById.get("installed-old").recommendedAction, "download");
    assert.equal(checkedById.get("latest-installed").result.status, "latest");
    assert.equal(checkedById.get("latest-installed").recommendedAction, "none");

    apiServer = await startApiServer({ port: 0, servicesRoot });
    const beforeInstall = await readStoredState(oldServiceRoot);
    const download = await postJson(`${apiServer.url}/api/services/installed-old/update/download`);
    const afterDownload = await readStoredState(oldServiceRoot);
    assert.equal(download.status, 200);
    assert.equal(download.body.update.state, "downloadedCandidate");
    assert.equal(afterDownload.updates.state, "downloadedCandidate");
    assert.equal(afterDownload.updates.downloadedCandidate.tag, latestTag);
    assert.deepEqual(afterDownload.install, beforeInstall.install);

    const install = await postJson(`${apiServer.url}/api/services/installed-old/update/install`);
    const afterInstall = await readStoredState(oldServiceRoot);
    assert.equal(install.status, 200);
    assert.equal(install.body.update.state, "installed");
    assert.equal(install.body.state.installArtifacts.artifact.tag, latestTag);
    assert.equal(afterInstall.updates.state, "installed");
    assert.equal(afterInstall.install.artifact.tag, latestTag);

    const list = await getJson(`${apiServer.url}/api/updates`);
    const listedById = new Map(list.body.services.map((entry) => [entry.serviceId, entry.update]));
    assert.equal(listedById.get("installed-old").state, "installed");
    assert.equal(listedById.get("latest-installed").state, "installed");
    assert.equal(releaseServer.getDownloadCount(defaultAssetName), 1);
  } finally {
    if (apiServer) {
      await apiServer.stop();
    }
    await releaseServer.stop();
    resetLifecycleState();
    await rm(root, { recursive: true, force: true });
  }
});

test("update lifecycle E2E persists download, install, and outside-window failure evidence", async () => {
  resetLifecycleState();
  const { root, servicesRoot } = await makeTempRuntimeRoot();
  const releaseServer = await startFakeGitHubReleaseServer();
  let apiServer = null;

  try {
    const downloadFailureRoot = await writeManifest(servicesRoot, "download-failure", createUpdateManifest(releaseServer, {
      serviceId: "download-failure",
      assetName: brokenDownloadAssetName,
      updates: {
        mode: "download",
        track: "latest",
      },
    }));
    await writeInstalledArtifact(downloadFailureRoot, oldTag, brokenDownloadAssetName);

    const installFailureRoot = await writeManifest(servicesRoot, "install-failure", createUpdateManifest(releaseServer, {
      serviceId: "install-failure",
      assetName: brokenInstallAssetName,
    }));
    await writeInstalledArtifact(installFailureRoot, oldTag, brokenInstallAssetName);

    const outsideWindowRoot = await writeManifest(servicesRoot, "outside-window", createUpdateManifest(releaseServer, {
      serviceId: "outside-window",
      updates: {
        mode: "install",
        track: "latest",
        installWindow: outsideInstallWindow(),
        runningService: "skip",
      },
    }));
    await writeInstalledArtifact(outsideWindowRoot, oldTag);

    apiServer = await startApiServer({ port: 0, servicesRoot });

    const downloadFailure = await postJson(`${apiServer.url}/api/services/download-failure/update/download`);
    const downloadFailureState = await readStoredState(downloadFailureRoot);
    assert.equal(downloadFailure.status, 500);
    assert.equal(downloadFailureState.updates.state, "failed");
    assert.equal(downloadFailureState.updates.failed.sourceStatus, "download_failed");
    assert.equal(downloadFailureState.install.artifact.tag, oldTag);

    const corruptDownload = await postJson(`${apiServer.url}/api/services/install-failure/update/download`);
    assert.equal(corruptDownload.status, 200);
    assert.equal(corruptDownload.body.update.state, "downloadedCandidate");

    const installFailure = await postJson(`${apiServer.url}/api/services/install-failure/update/install`);
    const installFailureState = await readStoredState(installFailureRoot);
    assert.equal(installFailure.status, 500);
    assert.equal(installFailureState.updates.state, "failed");
    assert.equal(installFailureState.updates.failed.sourceStatus, "install_failed");
    assert.equal(installFailureState.install.artifact.tag, oldTag);

    const outsideWindow = await postJson(`${apiServer.url}/api/services/outside-window/update/install`);
    const outsideWindowState = await readStoredState(outsideWindowRoot);
    assert.equal(outsideWindow.status, 500);
    assert.equal(outsideWindowState.updates.state, "installDeferred");
    assert.match(outsideWindowState.updates.installDeferred.reason, /outside updates\.installWindow/);
    assert.equal(outsideWindowState.install.artifact.tag, oldTag);
  } finally {
    if (apiServer) {
      await apiServer.stop();
    }
    await releaseServer.stop();
    resetLifecycleState();
    await rm(root, { recursive: true, force: true });
  }
});
