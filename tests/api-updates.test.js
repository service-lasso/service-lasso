import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import AdmZip from "adm-zip";
import { startApiServer } from "../dist/server/index.js";
import { readStoredState } from "../dist/runtime/state/readState.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";

async function makeTempServicesRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "service-lasso-api-updates-"));
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

async function writeInstalledArtifact(serviceRoot, tag = "2026.4.20-old") {
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
          assetName: "update-fixture.zip",
          archivePath: `active/${tag}/update-fixture.zip`,
        },
      },
      null,
      2,
    ),
  );
}

function createZipWithRuntimeScript() {
  const zip = new AdmZip();
  zip.addFile("runtime/update-fixture.mjs", Buffer.from('console.log("updated");\n', "utf8"));
  return zip.toBuffer();
}

async function startFakeGitHubReleaseServer(options = {}) {
  let downloadRequests = 0;
  const latestStatus = options.latestStatus ?? 200;
  const releaseTag = options.releaseTag ?? "2026.4.24-new";
  const assetName = "update-fixture.zip";
  const server = createServer((request, response) => {
    if (!request.url) {
      response.statusCode = 404;
      response.end();
      return;
    }

    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/repos/service-lasso/update-fixture/releases/latest") {
      response.statusCode = latestStatus;
      if (latestStatus !== 200) {
        response.end("failed");
        return;
      }

      const baseUrl = `http://127.0.0.1:${server.address().port}`;
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify({
        tag_name: releaseTag,
        name: releaseTag,
        html_url: `${baseUrl}/releases/${releaseTag}`,
        published_at: "2026-04-24T00:00:00Z",
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
      downloadRequests += 1;
      response.statusCode = 200;
      response.end(createZipWithRuntimeScript());
      return;
    }

    response.statusCode = 404;
    response.end();
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    getDownloadRequests: () => downloadRequests,
    stop: async () => {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function createUpdateManifest(releaseServer, updates = { mode: "notify", track: "latest" }) {
  return {
    id: "update-fixture",
    name: "Update Fixture",
    description: "Release-backed service used for update API tests.",
    version: "2026.4.20-old",
    artifact: {
      kind: "archive",
      source: {
        type: "github-release",
        repo: "service-lasso/update-fixture",
        tag: "2026.4.20-old",
        api_base_url: releaseServer.baseUrl,
      },
      platforms: {
        default: {
          assetName: "update-fixture.zip",
          archiveType: "zip",
          command: "node",
          args: ["runtime/update-fixture.mjs"],
        },
      },
    },
    updates,
  };
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

test("update API checks and returns persisted update status", async () => {
  resetLifecycleState();
  const { root, servicesRoot } = await makeTempServicesRoot();
  const releaseServer = await startFakeGitHubReleaseServer();
  const serviceRoot = await writeManifest(servicesRoot, "update-fixture", createUpdateManifest(releaseServer));
  await writeInstalledArtifact(serviceRoot);
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const check = await postJson(`${apiServer.url}/api/updates/check`, { serviceId: "update-fixture" });
    const single = await getJson(`${apiServer.url}/api/services/update-fixture/updates`);
    const all = await getJson(`${apiServer.url}/api/updates`);

    assert.equal(check.status, 200);
    assert.equal(check.body.action, "check");
    assert.equal(check.body.services[0].result.status, "update_available");
    assert.equal(single.status, 200);
    assert.equal(single.body.update.state, "available");
    assert.equal(single.body.update.available.tag, "2026.4.24-new");
    assert.equal(all.status, 200);
    assert.equal(all.body.services[0].serviceId, "update-fixture");
  } finally {
    await apiServer.stop();
    await releaseServer.stop();
    resetLifecycleState();
    await rm(root, { recursive: true, force: true });
  }
});

test("update API downloads a candidate without changing active install metadata", async () => {
  resetLifecycleState();
  const { root, servicesRoot } = await makeTempServicesRoot();
  const releaseServer = await startFakeGitHubReleaseServer();
  const serviceRoot = await writeManifest(servicesRoot, "update-fixture", createUpdateManifest(releaseServer, {
    mode: "download",
    track: "latest",
  }));
  await writeInstalledArtifact(serviceRoot);
  const before = await readStoredState(serviceRoot);
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const download = await postJson(`${apiServer.url}/api/services/update-fixture/update/download`);
    const after = await readStoredState(serviceRoot);

    assert.equal(download.status, 200);
    assert.equal(download.body.action, "download");
    assert.equal(download.body.update.state, "downloadedCandidate");
    assert.equal(releaseServer.getDownloadRequests(), 1);
    assert.deepEqual(after.install, before.install);
  } finally {
    await apiServer.stop();
    await releaseServer.stop();
    resetLifecycleState();
    await rm(root, { recursive: true, force: true });
  }
});

test("update API install blocks without force and installs with force", async () => {
  resetLifecycleState();
  const { root, servicesRoot } = await makeTempServicesRoot();
  const releaseServer = await startFakeGitHubReleaseServer();
  const serviceRoot = await writeManifest(servicesRoot, "update-fixture", createUpdateManifest(releaseServer, {
    mode: "download",
    track: "latest",
  }));
  await writeInstalledArtifact(serviceRoot);
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const blocked = await postJson(`${apiServer.url}/api/services/update-fixture/update/install`);
    const forced = await postJson(`${apiServer.url}/api/services/update-fixture/update/install`, { force: true });
    const stored = await readStoredState(serviceRoot);

    assert.equal(blocked.status, 500);
    assert.match(blocked.body.message, /blocked by policy/i);
    assert.equal(forced.status, 200);
    assert.equal(forced.body.action, "install");
    assert.equal(forced.body.forced, true);
    assert.equal(forced.body.state.installArtifacts.artifact.tag, "2026.4.24-new");
    assert.equal(stored.install.artifact.tag, "2026.4.24-new");
  } finally {
    await apiServer.stop();
    await releaseServer.stop();
    resetLifecycleState();
    await rm(root, { recursive: true, force: true });
  }
});

test("update API uses explicit error responses for invalid body and unknown services", async () => {
  resetLifecycleState();
  const { root, servicesRoot } = await makeTempServicesRoot();
  const releaseServer = await startFakeGitHubReleaseServer();
  await writeManifest(servicesRoot, "update-fixture", createUpdateManifest(releaseServer));
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const invalid = await postJson(`${apiServer.url}/api/services/update-fixture/update/install`, { force: "yes" });
    const missing = await getJson(`${apiServer.url}/api/services/missing/updates`);

    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error, "invalid_body");
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error, "not_found");
  } finally {
    await apiServer.stop();
    await releaseServer.stop();
    resetLifecycleState();
    await rm(root, { recursive: true, force: true });
  }
});
