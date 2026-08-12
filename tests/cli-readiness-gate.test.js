import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, rm } from "node:fs/promises";
import { makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";

const execFileAsync = promisify(execFile);
const cliPath = path.resolve("dist", "cli.js");

async function run(command, args, options = {}) {
  return execFileAsync(command, args, {
    ...options,
    windowsHide: true,
  });
}

async function initCleanGitWorkspace(root) {
  await run("git", ["init"], { cwd: root });
  await run("git", ["config", "user.email", "agent@example.test"], { cwd: root });
  await run("git", ["config", "user.name", "Service Lasso Agent"], { cwd: root });
  await run("git", ["add", "."], { cwd: root });
  await run("git", ["commit", "-m", "fixture"], { cwd: root });
}

async function runReadinessGate(fixture) {
  const result = await execFileAsync(
    process.execPath,
    [
      cliPath,
      "readiness",
      "gate",
      "--services-root",
      fixture.servicesRoot,
      "--workspace-root",
      fixture.workspaceRoot,
      "--json",
    ],
    {
      cwd: fixture.tempRoot,
      windowsHide: true,
    },
  );
  return JSON.parse(result.stdout);
}

test("CLI readiness gate reports ready baseline and provider state", async () => {
  const fixture = await makeTempServicesRoot("service-lasso-readiness-ready-");

  try {
    await writeExecutableFixtureService(fixture.servicesRoot, "@node", { role: "provider" });
    await writeExecutableFixtureService(fixture.servicesRoot, "app-service", { depend_on: ["@node"] });
    await initCleanGitWorkspace(fixture.tempRoot);

    const body = await runReadinessGate(fixture);

    assert.equal(body.action, "gate");
    assert.equal(body.ok, true);
    assert.equal(body.status, "ready");
    assert.equal(body.baseline.startPossible, true);
    assert.equal(body.baseline.enabledServices, 2);
    assert.deepEqual(body.providers.required, ["@node"]);
    assert.deepEqual(body.providers.missing, []);
    assert.equal(body.workspace.git.clean, true);
    assert.match(body.nextAction, /service-lasso start --json/);
  } finally {
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test("CLI readiness gate blocks when a required provider manifest is missing", async () => {
  const fixture = await makeTempServicesRoot("service-lasso-readiness-blocked-");

  try {
    await writeExecutableFixtureService(fixture.servicesRoot, "app-service", { depend_on: ["@missing"] });
    await initCleanGitWorkspace(fixture.tempRoot);

    await assert.rejects(
      execFileAsync(
        process.execPath,
        [
          cliPath,
          "readiness",
          "gate",
          "--services-root",
          fixture.servicesRoot,
          "--workspace-root",
          fixture.workspaceRoot,
          "--json",
        ],
        {
          cwd: fixture.tempRoot,
          windowsHide: true,
        },
      ),
      (error) => {
        const body = JSON.parse(error.stdout);
        assert.equal(body.ok, false);
        assert.equal(body.status, "blocked");
        assert.equal(body.baseline.startPossible, false);
        assert.deepEqual(body.providers.missing, ["@missing"]);
        assert.equal(body.blockers[0].id, "required_provider_missing");
        return true;
      },
    );
  } finally {
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test("CLI readiness gate reports partial state for warning-only workspace conditions", async () => {
  const fixture = await makeTempServicesRoot("service-lasso-readiness-partial-");

  try {
    await writeExecutableFixtureService(fixture.servicesRoot, "@node", { role: "provider" });
    await writeExecutableFixtureService(fixture.servicesRoot, "app-service", { depend_on: ["@node"] });
    await writeExecutableFixtureService(fixture.servicesRoot, "disabled-service", { enabled: false });
    await initCleanGitWorkspace(fixture.tempRoot);
    await writeFile(path.join(fixture.tempRoot, "local-note.txt"), "untracked");

    const body = await runReadinessGate(fixture);

    assert.equal(body.ok, true);
    assert.equal(body.status, "partial");
    assert.equal(body.baseline.startPossible, true);
    assert.equal(body.baseline.status, "partial");
    assert.equal(body.baseline.disabledServices, 1);
    assert.equal(body.workspace.git.clean, false);
    assert.ok(body.warnings.some((warning) => warning.id === "disabled_services_present"));
    assert.ok(body.warnings.some((warning) => warning.id === "git_dirty"));
  } finally {
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});
