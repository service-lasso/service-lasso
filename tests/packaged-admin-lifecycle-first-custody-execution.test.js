import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseDocument } from "yaml";

const workflowUrl = new URL("../.github/workflows/packaged-admin-lifecycle.yml", import.meta.url);

function run(command, args, environment) {
  return spawnSync(command, args, { encoding: "utf8", env: environment, shell: false });
}

async function firstCustodyStep() {
  const source = await readFile(workflowUrl, "utf8");
  const document = parseDocument(source, { uniqueKeys: true });
  assert.equal(document.errors.length, 0, document.errors.map(String).join("\n"));
  const job = document.toJS().jobs["packaged-admin-lifecycle"];
  const step = job.steps.find(({ name }) => name === "Establish unique qualification custody before dependencies");
  assert.equal(job.env.ADMIN_PLATFORM, "${{ matrix.admin_platform }}");
  assert.equal(step.shell, "bash");
  assert.match(step.run, /^set -euo pipefail$/m);
  return step.run;
}

function receiptPath(root, platform, attempt) {
  return path.join(root, `packaged-admin-lifecycle-431-packaged-admin-lifecycle-${attempt}-${platform}`, "evidence", "initial-receipt.json");
}

test("AC-4BY.2 executes the first custody step with matrix projection under Bash nounset on Linux and macOS", { skip: process.platform === "win32" }, async () => {
  const script = await firstCustodyStep();
  const root = await mkdtemp(path.join(tmpdir(), "packaged-first-custody-"));
  try {
    for (const platform of ["linux", "darwin"]) {
      const environment = {
        PATH: process.env.PATH,
        RUNNER_TEMP: root,
        GITHUB_RUN_ID: "431",
        GITHUB_JOB: "packaged-admin-lifecycle",
        GITHUB_RUN_ATTEMPT: "2",
        ADMIN_PLATFORM: platform,
        GITHUB_ENV: path.join(root, `${platform}.github-env`),
      };
      const result = run("bash", ["-c", script], environment);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(await readFile(receiptPath(root, platform, "2"), "utf8")), {
        schema: "service-lasso.qualification-initial-receipt.v1",
        platform,
        run: { id: "431", attempt: "2" },
      });
      const exported = await readFile(environment.GITHUB_ENV, "utf8");
      for (const name of ["QUALIFICATION_WORKSPACE_ROOT", "SERVICE_LASSO_INSTANCE_REGISTRY_PATH", "SERVICE_LASSO_HOST_PORT_REGISTRY_PATH", "QUALIFICATION_EVIDENCE_ROOT", "QUALIFICATION_INITIAL_RECEIPT_PATH"]) assert.match(exported, new RegExp(`^${name}=.+`, "m"));
    }
    const crossAttempt = run("bash", ["-c", script], {
      PATH: process.env.PATH,
      RUNNER_TEMP: root,
      GITHUB_RUN_ID: "431",
      GITHUB_JOB: "packaged-admin-lifecycle",
      GITHUB_RUN_ATTEMPT: "3",
      ADMIN_PLATFORM: "linux",
      GITHUB_ENV: path.join(root, "cross-attempt.github-env"),
    });
    assert.equal(crossAttempt.status, 0, crossAttempt.stderr);
    assert.deepEqual(JSON.parse(await readFile(receiptPath(root, "linux", "3"), "utf8")), {
      schema: "service-lasso.qualification-initial-receipt.v1",
      platform: "linux",
      run: { id: "431", attempt: "3" },
    });
    assert.notEqual(receiptPath(root, "linux", "2"), receiptPath(root, "linux", "3"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("AC-4BY.2 projects the Windows matrix environment into a real PowerShell process before custody", async () => {
  await firstCustodyStep();
  const projection = run("pwsh", ["-NoLogo", "-NoProfile", "-Command", "if ($env:ADMIN_PLATFORM -ne 'win32') { exit 1 }; [Console]::Write($env:ADMIN_PLATFORM)"], {
    PATH: process.env.PATH,
    ADMIN_PLATFORM: "win32",
  });
  assert.equal(projection.status, 0, projection.stderr);
  assert.equal(projection.stdout, "win32");
});

test("AC-4BY.2 fails closed when the first Bash custody step loses its matrix environment", { skip: process.platform === "win32" }, async () => {
  const script = await firstCustodyStep();
  const root = await mkdtemp(path.join(tmpdir(), "packaged-first-custody-missing-platform-"));
  try {
    const result = run("bash", ["-c", script], {
      PATH: process.env.PATH,
      RUNNER_TEMP: root,
      GITHUB_RUN_ID: "431",
      GITHUB_JOB: "packaged-admin-lifecycle",
      GITHUB_RUN_ATTEMPT: "2",
      GITHUB_ENV: path.join(root, "missing-platform.github-env"),
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ADMIN_PLATFORM/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
