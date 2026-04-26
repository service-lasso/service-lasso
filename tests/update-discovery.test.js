import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { loadServiceManifest } from "../dist/runtime/discovery/loadManifest.js";
import {
  checkServiceUpdate,
  compareTimestampedReleaseTags,
} from "../dist/runtime/updates/check.js";

async function makeTempServicesRoot() {
  return await mkdtemp(path.join(os.tmpdir(), "service-lasso-updates-"));
}

async function writeManifest(servicesRoot, serviceId, body) {
  const serviceRoot = path.join(servicesRoot, serviceId);
  await mkdir(serviceRoot, { recursive: true });
  await writeFile(path.join(serviceRoot, "service.json"), JSON.stringify(body, null, 2));
  return serviceRoot;
}

async function writeInstalledArtifact(serviceRoot, artifact) {
  const stateRoot = path.join(serviceRoot, ".state");
  await mkdir(stateRoot, { recursive: true });
  await writeFile(
    path.join(stateRoot, "install.json"),
    JSON.stringify(
      {
        installed: true,
        artifact,
      },
      null,
      2,
    ),
  );
}

function createUpdateManifest(releaseServer, overrides = {}) {
  return {
    id: "update-fixture",
    name: "Update Fixture",
    description: "Release-backed service used for update discovery tests.",
    version: "2026.4.20-old",
    artifact: {
      kind: "archive",
      source: {
        type: "github-release",
        repo: "service-lasso/update-fixture",
        tag: "2026.4.20-old",
        api_base_url: releaseServer?.baseUrl,
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
    ...overrides,
  };
}

async function startFakeGitHubReleaseServer(options = {}) {
  let releaseRequests = 0;
  const latestStatus = options.latestStatus ?? 200;
  const releaseTag = options.releaseTag ?? "2026.4.24-new";
  const assetName = options.assetName ?? "update-fixture.zip";
  const server = createServer((request, response) => {
    if (!request.url) {
      response.statusCode = 404;
      response.end();
      return;
    }

    const url = new URL(request.url, "http://127.0.0.1");
    if (
      url.pathname === "/repos/service-lasso/update-fixture/releases/latest" ||
      url.pathname === `/repos/service-lasso/update-fixture/releases/tags/${encodeURIComponent(releaseTag)}`
    ) {
      releaseRequests += 1;
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

    response.statusCode = 404;
    response.end();
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    getReleaseRequests: () => releaseRequests,
    stop: async () => {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

test("loadServiceManifest accepts explicit update policies", async () => {
  const servicesRoot = await makeTempServicesRoot();
  const releaseServer = { baseUrl: "http://127.0.0.1:1" };

  try {
    await writeManifest(
      servicesRoot,
      "update-fixture",
      createUpdateManifest(releaseServer, {
        updates: {
          enabled: true,
          mode: "install",
          track: "latest",
          checkIntervalSeconds: 3600,
          installWindow: {
            days: ["mon", "wed", "fri"],
            start: "02:00",
            end: "04:00",
            timezone: "Australia/Sydney",
          },
          runningService: "restart",
        },
      }),
    );

    const manifest = await loadServiceManifest(path.join(servicesRoot, "update-fixture", "service.json"));

    assert.deepEqual(manifest.updates, {
      enabled: true,
      mode: "install",
      track: "latest",
      checkIntervalSeconds: 3600,
      installWindow: {
        days: ["mon", "wed", "fri"],
        start: "02:00",
        end: "04:00",
        timezone: "Australia/Sydney",
      },
      runningService: "restart",
    });
  } finally {
    await rm(servicesRoot, { recursive: true, force: true });
  }
});

test("loadServiceManifest rejects unsafe or ambiguous update policies", async () => {
  const servicesRoot = await makeTempServicesRoot();
  const releaseServer = { baseUrl: "http://127.0.0.1:1" };

  try {
    await writeManifest(servicesRoot, "no-artifact", {
      id: "no-artifact",
      name: "No Artifact",
      description: "Invalid update policy without release metadata.",
      updates: {
        mode: "notify",
        track: "latest",
      },
    });
    await writeManifest(servicesRoot, "pinned-active", createUpdateManifest(releaseServer, {
      updates: {
        mode: "download",
        track: "pinned",
      },
    }));
    await writeManifest(servicesRoot, "install-no-window", createUpdateManifest(releaseServer, {
      updates: {
        mode: "install",
        track: "latest",
        runningService: "restart",
      },
    }));
    await writeManifest(servicesRoot, "disabled-moving", createUpdateManifest(releaseServer, {
      updates: {
        enabled: false,
        mode: "disabled",
        track: "latest",
      },
    }));

    await assert.rejects(
      () => loadServiceManifest(path.join(servicesRoot, "no-artifact", "service.json")),
      /active updates require manifest "artifact"/i,
    );
    await assert.rejects(
      () => loadServiceManifest(path.join(servicesRoot, "pinned-active", "service.json")),
      /active updates require "updates\.track"/i,
    );
    await assert.rejects(
      () => loadServiceManifest(path.join(servicesRoot, "install-no-window", "service.json")),
      /install-mode updates require both/i,
    );
    await assert.rejects(
      () => loadServiceManifest(path.join(servicesRoot, "disabled-moving", "service.json")),
      /disabled updates cannot track/i,
    );
  } finally {
    await rm(servicesRoot, { recursive: true, force: true });
  }
});

test("update discovery reports pinned manifests without calling the release API", async () => {
  const servicesRoot = await makeTempServicesRoot();
  const releaseServer = await startFakeGitHubReleaseServer();

  try {
    await writeManifest(servicesRoot, "update-fixture", createUpdateManifest(releaseServer));
    const [service] = await discoverServices(servicesRoot);

    const result = await checkServiceUpdate(service);

    assert.equal(result.status, "pinned");
    assert.equal(result.current.manifestTag, "2026.4.20-old");
    assert.equal(result.available, null);
    assert.equal(releaseServer.getReleaseRequests(), 0);
  } finally {
    await releaseServer.stop();
    await rm(servicesRoot, { recursive: true, force: true });
  }
});

test("update discovery reports update_available for a newer tracked release", async () => {
  const servicesRoot = await makeTempServicesRoot();
  const releaseServer = await startFakeGitHubReleaseServer();

  try {
    const serviceRoot = await writeManifest(servicesRoot, "update-fixture", createUpdateManifest(releaseServer, {
      updates: {
        mode: "notify",
        track: "latest",
      },
    }));
    await writeInstalledArtifact(serviceRoot, {
      sourceType: "github-release",
      repo: "service-lasso/update-fixture",
      tag: "2026.4.20-old",
      assetName: "update-fixture.zip",
    });
    const [service] = await discoverServices(servicesRoot);

    const result = await checkServiceUpdate(service);

    assert.equal(result.status, "update_available");
    assert.equal(result.current.installedTag, "2026.4.20-old");
    assert.equal(result.available.tag, "2026.4.24-new");
    assert.equal(result.available.releaseUrl.endsWith("/releases/2026.4.24-new"), true);
    assert.deepEqual(result.available.assetNames, ["update-fixture.zip"]);
    assert.equal(result.available.matchedAssetName, "update-fixture.zip");
  } finally {
    await releaseServer.stop();
    await rm(servicesRoot, { recursive: true, force: true });
  }
});

test("update discovery reports latest when installed tag matches the tracked release", async () => {
  const servicesRoot = await makeTempServicesRoot();
  const releaseServer = await startFakeGitHubReleaseServer();

  try {
    const serviceRoot = await writeManifest(servicesRoot, "update-fixture", createUpdateManifest(releaseServer, {
      updates: {
        mode: "notify",
        track: "latest",
      },
    }));
    await writeInstalledArtifact(serviceRoot, {
      sourceType: "github-release",
      repo: "service-lasso/update-fixture",
      tag: "2026.4.24-new",
      assetName: "update-fixture.zip",
    });
    const [service] = await discoverServices(servicesRoot);

    const result = await checkServiceUpdate(service);

    assert.equal(result.status, "latest");
    assert.equal(result.available.tag, "2026.4.24-new");
  } finally {
    await releaseServer.stop();
    await rm(servicesRoot, { recursive: true, force: true });
  }
});

test("update discovery reports unavailable when the tracked release is missing the configured asset", async () => {
  const servicesRoot = await makeTempServicesRoot();
  const releaseServer = await startFakeGitHubReleaseServer({ assetName: "other.zip" });

  try {
    await writeManifest(servicesRoot, "update-fixture", createUpdateManifest(releaseServer, {
      updates: {
        mode: "notify",
        track: "latest",
      },
    }));
    const [service] = await discoverServices(servicesRoot);

    const result = await checkServiceUpdate(service);

    assert.equal(result.status, "unavailable");
    assert.match(result.reason, /did not contain expected asset "update-fixture\.zip"/);
    assert.deepEqual(result.available.assetNames, ["other.zip"]);
  } finally {
    await releaseServer.stop();
    await rm(servicesRoot, { recursive: true, force: true });
  }
});

test("update discovery returns check_failed for release API failures", async () => {
  const servicesRoot = await makeTempServicesRoot();
  const releaseServer = await startFakeGitHubReleaseServer({ latestStatus: 500 });

  try {
    await writeManifest(servicesRoot, "update-fixture", createUpdateManifest(releaseServer, {
      updates: {
        mode: "notify",
        track: "latest",
      },
    }));
    const [service] = await discoverServices(servicesRoot);

    const result = await checkServiceUpdate(service);

    assert.equal(result.status, "check_failed");
    assert.match(result.reason, /500/);
    assert.equal(result.available, null);
  } finally {
    await releaseServer.stop();
    await rm(servicesRoot, { recursive: true, force: true });
  }
});

test("timestamped release tags compare conservatively by date", () => {
  assert.equal(compareTimestampedReleaseTags("2026.4.20-aaaaaaa", "2026.4.24-bbbbbbb"), 1);
  assert.equal(compareTimestampedReleaseTags("2026.4.24-bbbbbbb", "2026.4.20-aaaaaaa"), -1);
  assert.equal(compareTimestampedReleaseTags("2026.4.24-bbbbbbb", "2026.4.24-bbbbbbb"), 0);
  assert.equal(compareTimestampedReleaseTags("2026.4.24-aaaaaaa", "2026.4.24-bbbbbbb"), null);
  assert.equal(compareTimestampedReleaseTags("v1.0.0", "2026.4.24-bbbbbbb"), null);
});
