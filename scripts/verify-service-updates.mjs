import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "dist", "cli.js");
const oldEchoTag = "2026.4.20-4c2201a";
const echoRepo = "service-lasso/lasso-echoservice";

const platformArtifact = {
  win32: {
    assetName: "echo-service-win32.zip",
    archiveType: "zip",
    command: ".\\echo-service.exe",
  },
  linux: {
    assetName: "echo-service-linux.tar.gz",
    archiveType: "tar.gz",
    command: "./echo-service",
  },
  darwin: {
    assetName: "echo-service-darwin.tar.gz",
    archiveType: "tar.gz",
    command: "./echo-service",
  },
}[process.platform];

if (!platformArtifact) {
  throw new Error(`No Echo Service artifact fixture is configured for ${process.platform}.`);
}

async function runCli(args) {
  const result = await execFile(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      npm_package_version: "0.1.0-verify-service-updates",
    },
    maxBuffer: 1024 * 1024 * 10,
  });

  return result.stdout.trim();
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2));
}

async function main() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-verify-service-updates-"));
  const servicesRoot = path.join(tempRoot, "services");
  const workspaceRoot = path.join(tempRoot, "workspace");
  const serviceRoot = path.join(servicesRoot, "echo-service");

  try {
    await mkdir(serviceRoot, { recursive: true });
    await mkdir(workspaceRoot, { recursive: true });
    await writeJson(path.join(serviceRoot, "service.json"), {
      id: "echo-service",
      name: "Echo Service Update Verification",
      description: "Live release-backed Echo Service update verification fixture.",
      version: oldEchoTag,
      artifact: {
        kind: "archive",
        source: {
          type: "github-release",
          repo: echoRepo,
          tag: oldEchoTag,
        },
        platforms: {
          [process.platform]: platformArtifact,
        },
      },
      updates: {
        enabled: true,
        mode: "install",
        track: "latest",
        checkIntervalSeconds: 60,
        installWindow: {
          start: "00:00",
          end: "00:00",
          timezone: "UTC",
        },
        runningService: "skip",
      },
    });
    await writeJson(path.join(serviceRoot, ".state", "install.json"), {
      installed: true,
      artifact: {
        sourceType: "github-release",
        repo: echoRepo,
        tag: oldEchoTag,
        assetName: platformArtifact.assetName,
        archivePath: `active/${oldEchoTag}/${platformArtifact.assetName}`,
      },
    });

    const baseArgs = ["--services-root", servicesRoot, "--workspace-root", workspaceRoot, "--json"];
    const check = JSON.parse(await runCli(["updates", "check", "echo-service", ...baseArgs]));
    assert.equal(check.services[0].serviceId, "echo-service");
    assert.equal(check.services[0].result.status, "update_available");

    const latestTag = check.services[0].result.available.tag;
    assert.ok(latestTag && latestTag !== oldEchoTag, "expected a newer Echo Service release tag");

    const download = JSON.parse(await runCli(["updates", "download", "echo-service", ...baseArgs]));
    assert.equal(download.update.state, "downloadedCandidate");
    assert.equal(download.update.downloadedCandidate.tag, latestTag);

    const install = JSON.parse(await runCli(["updates", "install", "echo-service", ...baseArgs]));
    assert.equal(install.update.state, "installed");
    assert.equal(install.state.installArtifacts.artifact.tag, latestTag);

    const installState = JSON.parse(await readFile(path.join(serviceRoot, ".state", "install.json"), "utf8"));
    const updateState = JSON.parse(await readFile(path.join(serviceRoot, ".state", "updates.json"), "utf8"));
    assert.equal(installState.artifact.tag, latestTag);
    assert.equal(updateState.state, "installed");

    console.log("[service-lasso] live Echo Service update verification passed");
    console.log(`- previous tag: ${oldEchoTag}`);
    console.log(`- installed tag: ${latestTag}`);
    console.log(`- asset: ${platformArtifact.assetName}`);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

await main();
