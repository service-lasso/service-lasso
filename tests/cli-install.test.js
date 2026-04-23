import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import AdmZip from "adm-zip";
import { readStoredState } from "../dist/runtime/state/readState.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";

const execFile = promisify(execFileCallback);

async function makeTempServicesRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "service-lasso-cli-install-"));
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

function createZipWithRuntimeScript() {
  const zip = new AdmZip();
  zip.addFile(
    "runtime/downloaded-service.mjs",
    Buffer.from(
      [
        'const heartbeat = setInterval(() => {}, 1000);',
        'process.on("SIGTERM", () => { clearInterval(heartbeat); process.exit(0); });',
        'console.log("downloaded-service-started");',
      ].join("\n"),
      "utf8",
    ),
  );
  return zip.toBuffer();
}

async function startFakeGitHubReleaseServer(assetName, assetBytes) {
  let requestCount = 0;
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
      response.end(
        JSON.stringify({
          tag_name: "2026.4.23-fixture",
          assets: [
            {
              name: assetName,
              browser_download_url: `${baseUrl}/downloads/${assetName}`,
            },
          ],
        }),
      );
      return;
    }

    if (url.pathname === `/downloads/${assetName}`) {
      requestCount += 1;
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
    getRequestCount: () => requestCount,
    stop: async () => {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function runCli(args, cwd) {
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

test("CLI install acquires and unpacks a manifest-owned release artifact without starting the service", async () => {
  resetLifecycleState();
  const { root, servicesRoot, workspaceRoot } = await makeTempServicesRoot();
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

  try {
    const stdout = await runCli(
      ["install", "downloaded-service", "--services-root", servicesRoot, "--workspace-root", workspaceRoot, "--json"],
      path.resolve("."),
    );
    const payload = JSON.parse(stdout);
    const stored = await readStoredState(serviceRoot);

    assert.equal(payload.action, "install");
    assert.equal(payload.ok, true);
    assert.equal(payload.state.installed, true);
    assert.equal(payload.state.running, false);
    assert.equal(payload.servicesRoot, servicesRoot);
    assert.equal(payload.workspaceRoot, workspaceRoot);
    assert.equal(payload.state.installArtifacts.artifact.repo, "service-lasso/acquire-fixture");
    assert.equal(typeof stored.install?.artifact?.archivePath, "string");
    assert.equal(typeof stored.install?.artifact?.extractedPath, "string");
  } finally {
    await releaseServer.stop();
    resetLifecycleState();
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI install reuses an already downloaded archive instead of fetching it again", async () => {
  resetLifecycleState();
  const { root, servicesRoot, workspaceRoot } = await makeTempServicesRoot();
  const assetName = "downloaded-service.zip";
  const releaseServer = await startFakeGitHubReleaseServer(assetName, createZipWithRuntimeScript());
  await writeManifest(servicesRoot, "downloaded-service", {
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

  try {
    await runCli(
      ["install", "downloaded-service", "--services-root", servicesRoot, "--workspace-root", workspaceRoot, "--json"],
      path.resolve("."),
    );
    await runCli(
      ["install", "downloaded-service", "--services-root", servicesRoot, "--workspace-root", workspaceRoot, "--json"],
      path.resolve("."),
    );

    assert.equal(releaseServer.getRequestCount(), 1);
  } finally {
    await releaseServer.stop();
    resetLifecycleState();
    await rm(root, { recursive: true, force: true });
  }
});
