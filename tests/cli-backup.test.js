import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import AdmZip from "adm-zip";
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

async function writeRuntimeState(serviceRoot) {
  const stateRoot = path.join(serviceRoot, ".state");
  await mkdir(stateRoot, { recursive: true });
  await writeFile(
    path.join(stateRoot, "config.json"),
    JSON.stringify({
      configured: true,
      files: [
        {
          path: "runtime/config.json",
          content: "super-secret-config",
        },
      ],
    }, null, 2),
  );
  await writeFile(
    path.join(stateRoot, "runtime.json"),
    JSON.stringify({
      running: false,
      pid: null,
      logs: {
        stdoutPath: path.join(serviceRoot, "logs", "stdout.log"),
        stderrPath: path.join(serviceRoot, "logs", "stderr.log"),
      },
      brokerIdentity: {
        id: "identity-1",
        credential: "raw-credential-value",
      },
    }, null, 2),
  );
  await mkdir(path.join(serviceRoot, "logs"), { recursive: true });
  await writeFile(path.join(serviceRoot, "logs", "stdout.log"), "raw log body with super-secret-config");
}

function zipText(zip) {
  return zip.getEntries()
    .filter((entry) => !entry.isDirectory)
    .map((entry) => entry.getData().toString("utf8"))
    .join("\n");
}

test("CLI backup create writes redacted manifest and state without log contents", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempRuntime("service-lasso-cli-backup-");
  const serviceRoot = await writeManifest(servicesRoot, "backup-fixture", {
    id: "backup-fixture",
    name: "Backup Fixture",
    description: "Fixture with values that must not be copied raw into backups.",
    version: "1.0.0",
    env: {
      DB_PASSWORD: "raw-db-password",
    },
    globalenv: {
      API_TOKEN: "raw-api-token",
    },
  });
  await writeRuntimeState(serviceRoot);

  try {
    const stdout = await runCli([
      "backup",
      "create",
      "--services-root",
      servicesRoot,
      "--workspace-root",
      workspaceRoot,
      "--json",
    ]);
    const payload = JSON.parse(stdout);
    const zip = new AdmZip(payload.archivePath);
    const redactedManifest = JSON.parse(zip.getEntry("services/backup-fixture/manifest.redacted.json").getData().toString("utf8"));
    const redactedConfig = JSON.parse(zip.getEntry("services/backup-fixture/state/config.json").getData().toString("utf8"));
    const logMetadata = JSON.parse(zip.getEntry("services/backup-fixture/logs.metadata.json").getData().toString("utf8"));
    const allText = zipText(zip);

    assert.equal(payload.action, "create");
    assert.equal(payload.ok, true);
    assert.equal(payload.manifest.policy.logContents, "excluded");
    assert.equal(redactedManifest.env.DB_PASSWORD, "[redacted]");
    assert.equal(redactedManifest.globalenv.API_TOKEN, "[redacted]");
    assert.equal(redactedConfig.files[0].content, "[redacted]");
    assert.equal(logMetadata.files[0].path, "logs/stdout.log");
    assert.doesNotMatch(allText, /raw-db-password|raw-api-token|raw-credential-value|super-secret-config|raw log body/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("CLI backup restore-plan reports version mismatches without mutating state", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempRuntime("service-lasso-cli-restore-plan-");
  const serviceRoot = await writeManifest(servicesRoot, "restore-fixture", {
    id: "restore-fixture",
    name: "Restore Fixture",
    description: "Fixture used for restore plan checks.",
    version: "1.0.0",
  });
  await writeRuntimeState(serviceRoot);

  try {
    const createOut = await runCli([
      "backup",
      "create",
      "--services-root",
      servicesRoot,
      "--workspace-root",
      workspaceRoot,
      "--json",
    ]);
    const backup = JSON.parse(createOut);
    const beforeState = await readFile(path.join(serviceRoot, ".state", "config.json"), "utf8");

    await writeManifest(servicesRoot, "restore-fixture", {
      id: "restore-fixture",
      name: "Restore Fixture",
      description: "Fixture used for restore plan checks.",
      version: "2.0.0",
    });

    const planOut = await runCli([
      "backup",
      "restore-plan",
      backup.archivePath,
      "--services-root",
      servicesRoot,
      "--workspace-root",
      workspaceRoot,
      "--json",
    ]);
    const plan = JSON.parse(planOut);
    const afterState = await readFile(path.join(serviceRoot, ".state", "config.json"), "utf8");

    assert.equal(plan.action, "restore-plan");
    assert.equal(plan.mutated, false);
    assert.equal(plan.services[0].serviceId, "restore-fixture");
    assert.equal(plan.services[0].currentVersion, "2.0.0");
    assert.equal(plan.services[0].backupVersion, "1.0.0");
    assert.deepEqual(plan.services[0].reasons, ["version_mismatch"]);
    assert.equal(afterState, beforeState);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
