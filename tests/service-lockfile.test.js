import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import AdmZip from "adm-zip";

const execFile = promisify(execFileCallback);

async function makeTempRuntime(prefix = "service-lasso-lockfile-") {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
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
        "const heartbeat = setInterval(() => {}, 1000);",
        "process.on(\"SIGTERM\", () => { clearInterval(heartbeat); process.exit(0); });",
        "console.log(\"downloaded-service-started\");",
      ].join("\n"),
      "utf8",
    ),
  );
  return zip.toBuffer();
}

async function startFakeGitHubReleaseServer(assetName, assetBytes, tag = "2026.1.1-fixture") {
  let releaseRequestCount = 0;
  let downloadRequestCount = 0;
  const server = createServer((request, response) => {
    if (!request.url) {
      response.statusCode = 404;
      response.end();
      return;
    }

    const url = new URL(request.url, "http://127.0.0.1");

    if (url.pathname === "/repos/service-lasso/acquire-fixture/releases/tags/" + encodeURIComponent(tag)) {
      releaseRequestCount += 1;
      const baseUrl = "http://127.0.0.1:" + server.address().port;
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(
        JSON.stringify({
          tag_name: tag,
          assets: [
            {
              name: assetName,
              browser_download_url: baseUrl + "/downloads/" + assetName,
            },
          ],
        }),
      );
      return;
    }

    if (url.pathname === "/downloads/" + assetName) {
      downloadRequestCount += 1;
      response.statusCode = 200;
      response.end(assetBytes);
      return;
    }

    response.statusCode = 404;
    response.end();
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: "http://127.0.0.1:" + server.address().port,
    getReleaseRequestCount: () => releaseRequestCount,
    getDownloadRequestCount: () => downloadRequestCount,
    stop: async () => {
      await new Promise((resolve) => server.close(resolve));
    },
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

async function runCliFailure(args, cwd = path.resolve(".")) {
  try {
    await runCli(args, cwd);
  } catch (error) {
    return error;
  }
  throw new Error("Expected CLI command to fail.");
}

function releaseBackedManifest(releaseServer, assetName, checksumSha256, overrides = {}) {
  return {
    id: "downloaded-service",
    name: "Downloaded Service",
    description: "Service installed from manifest-owned release metadata.",
    depend_on: ["base-service"],
    artifact: {
      kind: "archive",
      source: {
        type: "github-release",
        repo: "service-lasso/acquire-fixture",
        tag: "2026.1.1-fixture",
        api_base_url: releaseServer.baseUrl,
      },
      platforms: {
        default: {
          assetName,
          archiveType: "zip",
          sha256: checksumSha256,
          command: process.execPath,
          args: ["./runtime/downloaded-service.mjs"],
        },
      },
    },
    healthcheck: {
      type: "process",
    },
    ...overrides,
  };
}

test("CLI lockfile generate records pinned artifact resolution and verify accepts a matching lockfile", async () => {
  const { root, servicesRoot, workspaceRoot } = await makeTempRuntime();
  const assetBytes = createZipWithRuntimeScript();
  const assetName = "downloaded-service.zip";
  const checksumSha256 = crypto.createHash("sha256").update(assetBytes).digest("hex");
  const releaseServer = await startFakeGitHubReleaseServer(assetName, assetBytes);

  try {
    await writeManifest(servicesRoot, "base-service", {
      id: "base-service",
      name: "Base Service",
      description: "Non-release dependency.",
    });
    await writeManifest(servicesRoot, "downloaded-service", releaseBackedManifest(releaseServer, assetName, checksumSha256));

    const generated = JSON.parse(await runCli([
      "lockfile",
      "generate",
      "--services-root",
      servicesRoot,
      "--workspace-root",
      workspaceRoot,
      "--json",
    ]));
    assert.equal(generated.action, "generate");
    assert.equal(generated.lockfile.services.length, 1);
    assert.deepEqual(generated.lockfile.services[0], {
      serviceId: "downloaded-service",
      sourceType: "github-release",
      sourceRepo: "service-lasso/acquire-fixture",
      releaseTag: "2026.1.1-fixture",
      channel: null,
      platform: "default",
      assetName,
      assetUrl: null,
      archiveType: "zip",
      checksumSha256,
      dependencies: ["base-service"],
    });

    const verify = JSON.parse(await runCli([
      "lockfile",
      "verify",
      "--services-root",
      servicesRoot,
      "--workspace-root",
      workspaceRoot,
      "--json",
    ]));
    assert.equal(verify.ok, true);
    assert.deepEqual(verify.issues, []);
  } finally {
    await releaseServer.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI lockfile verify reports stale manifest drift", async () => {
  const { root, servicesRoot, workspaceRoot } = await makeTempRuntime();
  const assetBytes = createZipWithRuntimeScript();
  const assetName = "downloaded-service.zip";
  const checksumSha256 = crypto.createHash("sha256").update(assetBytes).digest("hex");
  const releaseServer = await startFakeGitHubReleaseServer(assetName, assetBytes);

  try {
    await writeManifest(servicesRoot, "downloaded-service", releaseBackedManifest(releaseServer, assetName, checksumSha256));
    await runCli(["lockfile", "generate", "--services-root", servicesRoot, "--workspace-root", workspaceRoot, "--json"]);
    await writeManifest(
      servicesRoot,
      "downloaded-service",
      releaseBackedManifest(releaseServer, "downloaded-service-v2.zip", checksumSha256),
    );

    const failure = await runCliFailure([
      "lockfile",
      "verify",
      "--services-root",
      servicesRoot,
      "--workspace-root",
      workspaceRoot,
      "--json",
    ]);
    const result = JSON.parse(failure.stdout.trim());
    assert.equal(result.ok, false);
    assert.equal(result.issues[0].serviceId, "downloaded-service");
    assert.equal(result.issues[0].status, "stale");
  } finally {
    await releaseServer.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI install honors service lockfile entries and verifies locked checksums", async () => {
  const { root, servicesRoot, workspaceRoot } = await makeTempRuntime();
  const assetBytes = createZipWithRuntimeScript();
  const assetName = "downloaded-service.zip";
  const checksumSha256 = crypto.createHash("sha256").update(assetBytes).digest("hex");
  const releaseServer = await startFakeGitHubReleaseServer(assetName, assetBytes);

  try {
    await writeManifest(servicesRoot, "base-service", {
      id: "base-service",
      name: "Base Service",
      description: "Non-release dependency.",
    });
    await writeManifest(servicesRoot, "downloaded-service", releaseBackedManifest(releaseServer, assetName, checksumSha256));
    await runCli(["lockfile", "generate", "--services-root", servicesRoot, "--workspace-root", workspaceRoot, "--json"]);

    const install = JSON.parse(await runCli([
      "install",
      "downloaded-service",
      "--services-root",
      servicesRoot,
      "--workspace-root",
      workspaceRoot,
      "--json",
    ]));
    assert.equal(install.ok, true);
    assert.equal(install.state.installArtifacts.artifact.tag, "2026.1.1-fixture");
    assert.equal(install.state.installArtifacts.artifact.assetName, assetName);
    assert.equal(releaseServer.getReleaseRequestCount(), 1);
    assert.equal(releaseServer.getDownloadRequestCount(), 1);

    const lockfilePath = path.join(servicesRoot, "service-lasso.lock.json");
    const lockfile = JSON.parse(await readFile(lockfilePath, "utf8"));
    lockfile.services[0].checksumSha256 = "0".repeat(64);
    await writeFile(lockfilePath, JSON.stringify(lockfile, null, 2));
    await writeManifest(servicesRoot, "downloaded-service", releaseBackedManifest(releaseServer, assetName, "0".repeat(64)));

    const failure = await runCliFailure([
      "install",
      "downloaded-service",
      "--services-root",
      servicesRoot,
      "--workspace-root",
      workspaceRoot,
      "--json",
    ]);
    assert.match(failure.stderr, /checksum did not match/);
  } finally {
    await releaseServer.stop();
    await rm(root, { recursive: true, force: true });
  }
});
