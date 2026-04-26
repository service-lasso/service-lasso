import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import { rm } from "node:fs/promises";
import { makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";

const execFile = promisify(execFileCallback);

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

test("CLI recovery doctor records history readable by recovery status", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-cli-recovery-");
  await writeExecutableFixtureService(servicesRoot, "recovery-fixture", {
    doctor: {
      enabled: true,
      failurePolicy: "warn",
      steps: [
        {
          name: "doctor-warn",
          command: process.execPath,
          args: ["-e", "process.exit(9)"],
        },
      ],
    },
  });

  try {
    const doctorOut = await runCli([
      "recovery",
      "doctor",
      "recovery-fixture",
      "--services-root",
      servicesRoot,
      "--workspace-root",
      workspaceRoot,
      "--json",
    ]);
    const doctor = JSON.parse(doctorOut);

    assert.equal(doctor.action, "doctor");
    assert.equal(doctor.doctor.ok, true);
    assert.equal(doctor.doctor.steps[0].ok, false);
    assert.equal(doctor.recovery.events[0].kind, "doctor");

    const statusOut = await runCli([
      "recovery",
      "status",
      "recovery-fixture",
      "--services-root",
      servicesRoot,
      "--workspace-root",
      workspaceRoot,
      "--json",
    ]);
    const status = JSON.parse(statusOut);

    assert.equal(status.action, "status");
    assert.equal(status.services[0].serviceId, "recovery-fixture");
    assert.equal(status.services[0].recovery.events[0].steps[0].name, "doctor-warn");

    const humanOut = await runCli([
      "recovery",
      "status",
      "recovery-fixture",
      "--services-root",
      servicesRoot,
      "--workspace-root",
      workspaceRoot,
    ]);

    assert.match(humanOut, /\[service-lasso\] recovery status/);
    assert.match(humanOut, /recovery-fixture: 1 events, last doctor ok=true/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

