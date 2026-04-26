import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import AdmZip from "adm-zip";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { createServiceRegistry } from "../dist/runtime/manager/DependencyGraph.js";
import { readStoredState } from "../dist/runtime/state/readState.js";
import { startApiServer } from "../dist/server/index.js";
import { createRuntimeUpdateScheduler } from "../dist/runtime/updates/scheduler.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";

async function makeTempServicesRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "service-lasso-update-scheduler-"));
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
  let releaseRequests = 0;
  let downloadRequests = 0;
  const delayMs = options.delayMs ?? 0;
  const releaseTag = options.releaseTag ?? "2026.4.24-new";
  const assetName = "update-fixture.zip";
  const server = createServer(async (request, response) => {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    if (!request.url) {
      response.statusCode = 404;
      response.end();
      return;
    }

    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/repos/service-lasso/update-fixture/releases/latest") {
      releaseRequests += 1;
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
    getReleaseRequests: () => releaseRequests,
    getDownloadRequests: () => downloadRequests,
    stop: async () => {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function createUpdateManifest(releaseServer, updates) {
  return {
    id: "update-fixture",
    name: "Update Fixture",
    description: "Release-backed service used for update scheduler tests.",
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

async function prepareRegistry(servicesRoot) {
  const discovered = await discoverServices(servicesRoot);
  return createServiceRegistry(discovered);
}

test("update scheduler skips disabled services without release calls", async () => {
  const { root, servicesRoot } = await makeTempServicesRoot();
  const releaseServer = await startFakeGitHubReleaseServer();

  try {
    await writeManifest(servicesRoot, "update-fixture", createUpdateManifest(releaseServer, {
      mode: "disabled",
      track: "pinned",
      pinnedVersion: "1.0.0",
    }));
    const registry = await prepareRegistry(servicesRoot);
    const scheduler = createRuntimeUpdateScheduler({
      registry,
      logger: { log: () => undefined, warn: () => undefined },
    });

    const events = await scheduler.runOnce({ force: true });

    assert.equal(events[0].action, "skip");
    assert.equal(events[0].reason, "updates_disabled");
    assert.equal(releaseServer.getReleaseRequests(), 0);
  } finally {
    await releaseServer.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("update scheduler notify mode records available updates and respects interval", async () => {
  const { root, servicesRoot } = await makeTempServicesRoot();
  const releaseServer = await startFakeGitHubReleaseServer();

  try {
    const serviceRoot = await writeManifest(servicesRoot, "update-fixture", createUpdateManifest(releaseServer, {
      mode: "notify",
      track: "latest",
      checkIntervalSeconds: 60,
    }));
    await writeInstalledArtifact(serviceRoot);
    const registry = await prepareRegistry(servicesRoot);
    const scheduler = createRuntimeUpdateScheduler({
      registry,
      logger: { log: () => undefined, warn: () => undefined },
    });

    const first = await scheduler.runOnce();
    const second = await scheduler.runOnce();
    const stored = await readStoredState(serviceRoot);

    assert.equal(first[0].action, "check");
    assert.equal(first[0].reason, "update_available");
    assert.equal(second[0].action, "skip");
    assert.equal(second[0].reason, "interval_not_elapsed");
    assert.equal(stored.updates.state, "available");
  } finally {
    await releaseServer.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("update scheduler download mode downloads candidates", async () => {
  const { root, servicesRoot } = await makeTempServicesRoot();
  const releaseServer = await startFakeGitHubReleaseServer();

  try {
    const serviceRoot = await writeManifest(servicesRoot, "update-fixture", createUpdateManifest(releaseServer, {
      mode: "download",
      track: "latest",
    }));
    await writeInstalledArtifact(serviceRoot);
    const registry = await prepareRegistry(servicesRoot);
    const scheduler = createRuntimeUpdateScheduler({
      registry,
      logger: { log: () => undefined, warn: () => undefined },
    });

    const events = await scheduler.runOnce({ force: true });
    const stored = await readStoredState(serviceRoot);

    assert.equal(events[0].action, "download");
    assert.equal(events[0].reason, "downloaded");
    assert.equal(stored.updates.state, "downloadedCandidate");
    assert.equal(releaseServer.getDownloadRequests(), 1);
  } finally {
    await releaseServer.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("update scheduler install mode installs candidates", async () => {
  resetLifecycleState();
  const { root, servicesRoot } = await makeTempServicesRoot();
  const releaseServer = await startFakeGitHubReleaseServer();

  try {
    const serviceRoot = await writeManifest(servicesRoot, "update-fixture", createUpdateManifest(releaseServer, {
      mode: "install",
      track: "latest",
      installWindow: {
        start: "00:00",
        end: "23:59",
      },
      runningService: "restart",
    }));
    await writeInstalledArtifact(serviceRoot);
    const registry = await prepareRegistry(servicesRoot);
    const scheduler = createRuntimeUpdateScheduler({
      registry,
      logger: { log: () => undefined, warn: () => undefined },
    });

    const events = await scheduler.runOnce({ force: true });
    const stored = await readStoredState(serviceRoot);

    assert.equal(events[0].action, "install");
    assert.equal(events[0].reason, "installed");
    assert.equal(stored.install.artifact.tag, "2026.4.24-new");
    assert.equal(stored.updates.state, "installed");
  } finally {
    resetLifecycleState();
    await releaseServer.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("update scheduler suppresses duplicate in-flight work", async () => {
  const { root, servicesRoot } = await makeTempServicesRoot();
  const releaseServer = await startFakeGitHubReleaseServer({ delayMs: 100 });

  try {
    const serviceRoot = await writeManifest(servicesRoot, "update-fixture", createUpdateManifest(releaseServer, {
      mode: "notify",
      track: "latest",
    }));
    await writeInstalledArtifact(serviceRoot);
    const registry = await prepareRegistry(servicesRoot);
    const scheduler = createRuntimeUpdateScheduler({
      registry,
      logger: { log: () => undefined, warn: () => undefined },
    });

    const [first, second] = await Promise.all([
      scheduler.runOnce({ force: true }),
      scheduler.runOnce({ force: true }),
    ]);

    assert.equal(first[0].reason, "update_available");
    assert.equal(second[0].reason, "in_flight");
  } finally {
    await releaseServer.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("API server can start and stop the opt-in update scheduler cleanly", async () => {
  const { root, servicesRoot } = await makeTempServicesRoot();
  const apiServer = await startApiServer({
    port: 0,
    servicesRoot,
    updateScheduler: true,
    updateSchedulerIntervalMs: 10,
  });

  try {
    assert.ok(apiServer.updateScheduler);
  } finally {
    await apiServer.stop();
    await rm(root, { recursive: true, force: true });
  }
});
