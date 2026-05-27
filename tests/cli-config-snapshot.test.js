import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { writeManifest } from "./test-helpers.js";

const execFile = promisify(execFileCallback);

async function makeTempRuntime(prefix) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), prefix));
  const servicesRoot = path.join(tempRoot, "services");
  const workspaceRoot = path.join(tempRoot, "workspace");
  await mkdir(servicesRoot, { recursive: true });
  await mkdir(workspaceRoot, { recursive: true });
  return { tempRoot, servicesRoot, workspaceRoot };
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

async function writeVolatileState(serviceRoot) {
  const stateRoot = path.join(serviceRoot, ".state");
  await mkdir(stateRoot, { recursive: true });
  await writeFile(
    path.join(stateRoot, "runtime.json"),
    JSON.stringify({
      running: true,
      pid: 12345,
      stdoutPath: path.join(serviceRoot, "logs", "stdout.log"),
      credential: "runtime-raw-credential",
    }, null, 2),
  );
  await mkdir(path.join(serviceRoot, "logs"), { recursive: true });
  await writeFile(path.join(serviceRoot, "logs", "stdout.log"), "runtime log with raw-db-password");
}

test("CLI config-snapshot export writes redacted config snapshot without runtime state or machine-local paths", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempRuntime("service-lasso-config-snapshot-export-");
  const serviceRoot = await writeManifest(servicesRoot, "snapshot-fixture", {
    id: "snapshot-fixture",
    name: "Snapshot Fixture",
    description: "Fixture with raw config values that must not be exported.",
    version: "1.0.0",
    env: {
      DB_PASSWORD: "raw-db-password",
      PUBLIC_MODE: "local",
    },
    globalenv: {
      API_TOKEN: "raw-api-token",
    },
    config: {
      files: [
        {
          path: "runtime/app.conf",
          content: "password=raw-config-password\nmode=local\n",
        },
      ],
    },
  });
  await writeVolatileState(serviceRoot);

  try {
    const stdout = await runCli([
      "config-snapshot",
      "export",
      "--services-root",
      servicesRoot,
      "--workspace-root",
      workspaceRoot,
      "--json",
    ]);
    const payload = JSON.parse(stdout);
    const snapshotText = await readFile(payload.snapshotPath, "utf8");
    const snapshot = JSON.parse(snapshotText);
    const manifest = snapshot.services[0].manifest;

    assert.equal(payload.action, "export");
    assert.equal(payload.ok, true);
    assert.equal(snapshot.policy.runtimeState, "excluded");
    assert.equal(snapshot.policy.logs, "excluded");
    assert.equal(snapshot.policy.importDefault, "dry-run");
    assert.equal(snapshot.services[0].serviceRoot, "snapshot-fixture");
    assert.equal(snapshot.services[0].manifestPath, "snapshot-fixture/service.json");
    assert.equal(manifest.env.DB_PASSWORD, "[redacted]");
    assert.equal(manifest.env.PUBLIC_MODE, "[redacted]");
    assert.equal(manifest.globalenv.API_TOKEN, "[redacted]");
    assert.equal(manifest.config.files[0].content, "[redacted]");
    assert.doesNotMatch(snapshotText, /raw-db-password|raw-api-token|raw-config-password|runtime-raw-credential|runtime log/);
    assert.equal(snapshotText.includes(tempRoot), false);
    assert.equal(snapshotText.includes(".state"), false);
    assert.equal(snapshotText.includes("logs/stdout.log"), false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("CLI config-snapshot import defaults to dry-run and reports manifest diffs without mutating", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempRuntime("service-lasso-config-snapshot-import-");
  await writeManifest(servicesRoot, "snapshot-import-fixture", {
    id: "snapshot-import-fixture",
    name: "Snapshot Import Fixture",
    description: "Original snapshot fixture.",
    version: "1.0.0",
  });

  try {
    const exportOut = await runCli([
      "config-snapshot",
      "export",
      "--services-root",
      servicesRoot,
      "--workspace-root",
      workspaceRoot,
      "--json",
    ]);
    const snapshot = JSON.parse(exportOut);

    const serviceRoot = await writeManifest(servicesRoot, "snapshot-import-fixture", {
      id: "snapshot-import-fixture",
      name: "Snapshot Import Fixture",
      description: "Changed after export.",
      version: "2.0.0",
    });
    const manifestPath = path.join(serviceRoot, "service.json");
    const beforeImport = await readFile(manifestPath, "utf8");

    const importOut = await runCli([
      "config-snapshot",
      "import",
      snapshot.snapshotPath,
      "--services-root",
      servicesRoot,
      "--workspace-root",
      workspaceRoot,
      "--json",
    ]);
    const plan = JSON.parse(importOut);
    const afterImport = await readFile(manifestPath, "utf8");

    assert.equal(plan.action, "import");
    assert.equal(plan.dryRun, true);
    assert.equal(plan.mutated, false);
    assert.equal(plan.services[0].serviceId, "snapshot-import-fixture");
    assert.equal(plan.services[0].action, "would_update");
    assert.deepEqual(plan.services[0].reasons, ["version_mismatch", "manifest_diff", "dry_run_only"]);
    assert.equal(afterImport, beforeImport);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
