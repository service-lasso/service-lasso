import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import AdmZip from "adm-zip";
import { readStoredState } from "../dist/runtime/state/readState.js";

const execFile = promisify(execFileCallback);

async function makeTempServicesRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "service-lasso-cli-updates-"));
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
    description: "Release-backed service used for update CLI tests.",
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

test("CLI updates check prints human update-available output", async () => {
  const { root, servicesRoot, workspaceRoot } = await makeTempServicesRoot();
  const releaseServer = await startFakeGitHubReleaseServer();

  try {
    const serviceRoot = await writeManifest(servicesRoot, "update-fixture", createUpdateManifest(releaseServer));
    await writeInstalledArtifact(serviceRoot);

    const stdout = await runCli(["updates", "check", "--services-root", servicesRoot, "--workspace-root", workspaceRoot]);

    assert.match(stdout, /\[service-lasso\] update check completed/);
    assert.match(stdout, /update-fixture: update available 2026\.4\.20-old -> 2026\.4\.24-new/);
  } finally {
    await releaseServer.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI updates check returns JSON with recommended action", async () => {
  const { root, servicesRoot, workspaceRoot } = await makeTempServicesRoot();
  const releaseServer = await startFakeGitHubReleaseServer();

  try {
    const serviceRoot = await writeManifest(servicesRoot, "update-fixture", createUpdateManifest(releaseServer));
    await writeInstalledArtifact(serviceRoot);

    const stdout = await runCli(["updates", "check", "update-fixture", "--services-root", servicesRoot, "--workspace-root", workspaceRoot, "--json"]);
    const payload = JSON.parse(stdout);

    assert.equal(payload.action, "check");
    assert.equal(payload.services[0].serviceId, "update-fixture");
    assert.equal(payload.services[0].result.status, "update_available");
    assert.equal(payload.services[0].recommendedAction, "download");
  } finally {
    await releaseServer.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI updates list reads persisted update state", async () => {
  const { root, servicesRoot, workspaceRoot } = await makeTempServicesRoot();
  const releaseServer = await startFakeGitHubReleaseServer();

  try {
    const serviceRoot = await writeManifest(servicesRoot, "update-fixture", createUpdateManifest(releaseServer));
    await writeInstalledArtifact(serviceRoot);
    await runCli(["updates", "check", "update-fixture", "--services-root", servicesRoot, "--workspace-root", workspaceRoot, "--json"]);

    const stdout = await runCli(["updates", "list", "--services-root", servicesRoot, "--workspace-root", workspaceRoot]);

    assert.match(stdout, /update-fixture: update available 2026\.4\.20-old -> 2026\.4\.24-new/);
  } finally {
    await releaseServer.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI updates download stores a candidate without changing active install metadata", async () => {
  const { root, servicesRoot, workspaceRoot } = await makeTempServicesRoot();
  const releaseServer = await startFakeGitHubReleaseServer();

  try {
    const serviceRoot = await writeManifest(servicesRoot, "update-fixture", createUpdateManifest(releaseServer, {
      mode: "download",
      track: "latest",
    }));
    await writeInstalledArtifact(serviceRoot);
    const before = await readStoredState(serviceRoot);

    const stdout = await runCli(["updates", "download", "update-fixture", "--services-root", servicesRoot, "--workspace-root", workspaceRoot, "--json"]);
    const payload = JSON.parse(stdout);
    const after = await readStoredState(serviceRoot);

    assert.equal(payload.action, "download");
    assert.equal(payload.update.state, "downloadedCandidate");
    assert.equal(payload.update.downloadedCandidate.tag, "2026.4.24-new");
    assert.equal(releaseServer.getDownloadRequests(), 1);
    assert.deepEqual(after.install, before.install);
  } finally {
    await releaseServer.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI updates install blocks when policy is not install mode", async () => {
  const { root, servicesRoot, workspaceRoot } = await makeTempServicesRoot();
  const releaseServer = await startFakeGitHubReleaseServer();

  try {
    const serviceRoot = await writeManifest(servicesRoot, "update-fixture", createUpdateManifest(releaseServer, {
      mode: "download",
      track: "latest",
    }));
    await writeInstalledArtifact(serviceRoot);

    await assert.rejects(
      () => runCli(["updates", "install", "update-fixture", "--services-root", servicesRoot, "--workspace-root", workspaceRoot, "--json"]),
      /blocked by policy/i,
    );
    const stored = await readStoredState(serviceRoot);
    assert.equal(stored.updates.state, "installDeferred");
    assert.match(stored.updates.installDeferred.reason, /updates\.mode/);
  } finally {
    await releaseServer.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI updates install --force installs a resolvable candidate", async () => {
  const { root, servicesRoot, workspaceRoot } = await makeTempServicesRoot();
  const releaseServer = await startFakeGitHubReleaseServer();

  try {
    const serviceRoot = await writeManifest(servicesRoot, "update-fixture", createUpdateManifest(releaseServer, {
      mode: "download",
      track: "latest",
    }));
    await writeInstalledArtifact(serviceRoot);

    const stdout = await runCli(["updates", "install", "update-fixture", "--services-root", servicesRoot, "--workspace-root", workspaceRoot, "--force", "--json"]);
    const payload = JSON.parse(stdout);
    const stored = await readStoredState(serviceRoot);

    assert.equal(payload.action, "install");
    assert.equal(payload.forced, true);
    assert.equal(payload.state.installArtifacts.artifact.tag, "2026.4.24-new");
    assert.equal(stored.install.artifact.tag, "2026.4.24-new");
    assert.equal(stored.updates.state, "installed");
  } finally {
    await releaseServer.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI updates check returns JSON check_failed status", async () => {
  const { root, servicesRoot, workspaceRoot } = await makeTempServicesRoot();
  const releaseServer = await startFakeGitHubReleaseServer({ latestStatus: 500 });

  try {
    await writeManifest(servicesRoot, "update-fixture", createUpdateManifest(releaseServer));

    const stdout = await runCli(["updates", "check", "update-fixture", "--services-root", servicesRoot, "--workspace-root", workspaceRoot, "--json"]);
    const payload = JSON.parse(stdout);

    assert.equal(payload.services[0].result.status, "check_failed");
    assert.equal(payload.services[0].recommendedAction, "inspect");
  } finally {
    await releaseServer.stop();
    await rm(root, { recursive: true, force: true });
  }
});
