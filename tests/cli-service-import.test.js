import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";

const execFile = promisify(execFileCallback);

function releasedManifest(name = "Imported Dagu") {
  return {
    id: "dagu",
    name,
    description: "App-owned Dagu workflow service manifest.",
    artifact: {
      kind: "archive",
      source: {
        type: "github-release",
        repo: "service-lasso/lasso-dagu",
        tag: "2026.5.22-fixture",
      },
      platforms: {
        default: {
          assetName: "dagu.zip",
          archiveType: "zip",
        },
      },
    },
    healthcheck: {
      type: "http",
      url: "http://127.0.0.1:18088/health",
    },
  };
}

async function exists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function makeTempServicesRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "service-lasso-cli-service-import-"));
  return {
    root,
    servicesRoot: path.join(root, "services"),
  };
}

async function startFakeGitHubReleaseServer(manifest) {
  let manifestDownloadCount = 0;
  const server = createServer((request, response) => {
    if (!request.url) {
      response.statusCode = 404;
      response.end();
      return;
    }

    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/repos/service-lasso/lasso-dagu/releases/tags/2026.5.22-fixture") {
      const baseUrl = `http://127.0.0.1:${server.address().port}`;
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(
        JSON.stringify({
          tag_name: "2026.5.22-fixture",
          assets: [
            {
              name: "service.json",
              browser_download_url: `${baseUrl}/downloads/service.json`,
            },
          ],
        }),
      );
      return;
    }

    if (url.pathname === "/downloads/service.json") {
      manifestDownloadCount += 1;
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify(manifest));
      return;
    }

    response.statusCode = 404;
    response.end();
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    getManifestDownloadCount: () => manifestDownloadCount,
    stop: async () => {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function runCli(args, cwd = path.resolve(".")) {
  const cliPath = path.join(cwd, "dist", "cli.js");
  return execFile(process.execPath, [cliPath, ...args], {
    cwd,
    env: {
      ...process.env,
      npm_package_version: "0.1.0-test",
    },
  });
}

test("services import dry-run validates released manifest without writing it", async () => {
  const { root, servicesRoot } = await makeTempServicesRoot();
  const releaseServer = await startFakeGitHubReleaseServer(releasedManifest());
  const manifestPath = path.join(servicesRoot, "dagu", "service.json");

  try {
    const result = await runCli([
      "services",
      "import",
      "service-lasso/lasso-dagu",
      "--tag",
      "2026.5.22-fixture",
      "--services-root",
      servicesRoot,
      "--api-base-url",
      releaseServer.baseUrl,
      "--dry-run",
      "--json",
    ]);
    const payload = JSON.parse(result.stdout);

    assert.equal(payload.action, "importService");
    assert.equal(payload.dryRun, true);
    assert.equal(payload.wrote, false);
    assert.equal(payload.serviceId, "dagu");
    assert.equal(payload.targetPath, manifestPath);
    assert.equal(await exists(manifestPath), false);
    assert.equal(releaseServer.getManifestDownloadCount(), 1);
  } finally {
    await releaseServer.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("services import writes released manifest and keeps it discoverable", async () => {
  const { root, servicesRoot } = await makeTempServicesRoot();
  const releaseServer = await startFakeGitHubReleaseServer(releasedManifest());
  const manifestPath = path.join(servicesRoot, "dagu", "service.json");

  try {
    const result = await runCli([
      "services",
      "import",
      "service-lasso/lasso-dagu",
      "--tag",
      "2026.5.22-fixture",
      "--services-root",
      servicesRoot,
      "--api-base-url",
      releaseServer.baseUrl,
      "--json",
    ]);
    const payload = JSON.parse(result.stdout);
    const discovered = await discoverServices(servicesRoot);
    const written = JSON.parse(await readFile(manifestPath, "utf8"));

    assert.equal(payload.wrote, true);
    assert.equal(payload.overwritten, false);
    assert.equal(written.id, "dagu");
    assert.equal(discovered.length, 1);
    assert.equal(discovered[0].manifest.id, "dagu");
    assert.equal(discovered[0].manifestPath, manifestPath);
  } finally {
    await releaseServer.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("services import protects existing manifests unless forced", async () => {
  const { root, servicesRoot } = await makeTempServicesRoot();
  const firstServer = await startFakeGitHubReleaseServer(releasedManifest("Original Dagu"));
  const secondServer = await startFakeGitHubReleaseServer(releasedManifest("Replacement Dagu"));
  const manifestPath = path.join(servicesRoot, "dagu", "service.json");

  try {
    await runCli([
      "services",
      "import",
      "service-lasso/lasso-dagu",
      "--tag",
      "2026.5.22-fixture",
      "--services-root",
      servicesRoot,
      "--api-base-url",
      firstServer.baseUrl,
      "--json",
    ]);

    await assert.rejects(
      runCli([
        "services",
        "import",
        "service-lasso/lasso-dagu",
        "--tag",
        "2026.5.22-fixture",
        "--services-root",
        servicesRoot,
        "--api-base-url",
        secondServer.baseUrl,
        "--json",
      ]),
      /Refusing to overwrite existing manifest/,
    );

    const forced = await runCli([
      "services",
      "import",
      "service-lasso/lasso-dagu",
      "--tag",
      "2026.5.22-fixture",
      "--services-root",
      servicesRoot,
      "--api-base-url",
      secondServer.baseUrl,
      "--force",
      "--json",
    ]);
    const payload = JSON.parse(forced.stdout);
    const written = JSON.parse(await readFile(manifestPath, "utf8"));

    assert.equal(payload.overwritten, true);
    assert.equal(written.name, "Replacement Dagu");
  } finally {
    await firstServer.stop();
    await secondServer.stop();
    await rm(root, { recursive: true, force: true });
  }
});
