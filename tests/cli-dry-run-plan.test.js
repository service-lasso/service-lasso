import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";

const execFile = promisify(execFileCallback);

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
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

  return result.stdout;
}

test("CLI plan start returns structured dry-run without creating workspace state", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-cli-plan-start-");
  const workspaceRoot = path.join(tempRoot, "workspace");

  try {
    await rm(workspaceRoot, { recursive: true, force: true });
    await writeExecutableFixtureService(servicesRoot, "alpha-service");

    const stdout = await runCli([
      "plan",
      "start",
      "--services-root",
      servicesRoot,
      "--workspace-root",
      workspaceRoot,
      "--json",
    ]);
    const payload = JSON.parse(stdout);

    assert.equal(payload.action, "startAll");
    assert.equal(payload.dryRun, true);
    assert.equal(payload.steps[0].serviceId, "alpha-service");
    assert.equal(payload.steps[0].status, "blocked");
    assert.equal(payload.steps[0].reason, "not_installed");
    assert.deepEqual(payload.mutations, []);
    assert.equal(await pathExists(workspaceRoot), false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("CLI plan update-install reports blockers without writing update state", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-cli-plan-update-");
  const workspaceRoot = path.join(tempRoot, "workspace");

  try {
    const { serviceRoot } = await writeExecutableFixtureService(servicesRoot, "update-plan-service", {
      updates: {
        mode: "download",
        runningService: "require-stopped",
      },
    });
    const stateRoot = path.join(serviceRoot, ".state");
    await mkdir(stateRoot, { recursive: true });
    const updatesPath = path.join(stateRoot, "updates.json");
    const before = {
      serviceId: "update-plan-service",
      state: "downloadedCandidate",
      lastCheck: null,
      available: null,
      downloadedCandidate: {
        tag: "2026.5.1",
        assetName: "update-plan-service.zip",
        archivePath: "updates/update-plan-service.zip",
        downloadedAt: "2026-05-20T00:00:00.000Z",
      },
      installDeferred: null,
      failed: null,
      hookResults: [],
    };
    await writeFile(updatesPath, JSON.stringify(before, null, 2));

    const stdout = await runCli([
      "plan",
      "update-install",
      "update-plan-service",
      "--services-root",
      servicesRoot,
      "--workspace-root",
      workspaceRoot,
      "--json",
    ]);
    const payload = JSON.parse(stdout);
    const after = JSON.parse(await readFile(updatesPath, "utf8"));

    assert.equal(payload.action, "updateInstall");
    assert.equal(payload.dryRun, true);
    assert.equal(payload.steps[0].status, "blocked");
    assert.match(payload.steps[0].reason, /updates_mode_not_install/);
    assert.deepEqual(payload.mutations, []);
    assert.deepEqual(after, before);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("CLI plan import previews app-owned service import without copying manifest", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-cli-plan-import-");
  const sourceRoot = path.join(tempRoot, "source-service");
  const sourceManifestPath = path.join(sourceRoot, "service.json");
  const targetManifestPath = path.join(servicesRoot, "imported-service", "service.json");

  try {
    await mkdir(sourceRoot, { recursive: true });
    await writeFile(sourceManifestPath, JSON.stringify({
      id: "imported-service",
      name: "Imported Service",
      description: "Fixture service import plan.",
      executable: process.execPath,
      args: ["runtime/imported-service.mjs"],
      healthcheck: { type: "process" },
    }, null, 2));

    const stdout = await runCli([
      "plan",
      "import",
      sourceManifestPath,
      "--services-root",
      servicesRoot,
      "--json",
    ]);
    const payload = JSON.parse(stdout);

    assert.equal(payload.action, "importService");
    assert.equal(payload.dryRun, true);
    assert.equal(payload.ok, true);
    assert.equal(payload.steps[0].serviceId, "imported-service");
    assert.equal(payload.steps[0].status, "would_run");
    assert.equal(payload.steps[0].metadata.targetManifestPath, targetManifestPath);
    assert.deepEqual(payload.mutations, []);
    assert.equal(await pathExists(targetManifestPath), false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
