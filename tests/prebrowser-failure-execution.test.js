import test from "node:test";
import assert from "node:assert/strict";
import { appendFile, mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const prebrowserRecorder = fileURLToPath(new URL("../scripts/record-admin-trusted-unlock-prebrowser-failure.mjs", import.meta.url));
const publishedRecorder = fileURLToPath(new URL("../scripts/record-published-package-qualification.mjs", import.meta.url));
const runId = "431", runAttempt = "2";

function run(script, args, environment) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8", shell: false, env: environment });
}

test("AC-4BY.2 executes every pre-browser producer, GITHUB_ENV handoff, published recorder, and one-file upload inventory", async () => {
  for (const stage of ["action_binding", "fresh_prefix", "isolated_install", "package_identity"]) {
    const root = await mkdtemp(path.join(tmpdir(), "prebrowser-execution-"));
    const source = path.join(root, "admin-trusted-unlock-prebrowser-failure.json");
    const githubEnv = path.join(root, "github-env");
    const evidenceRoot = path.join(root, "uploaded");
    const environment = { ...process.env, QUALIFICATION_PLATFORM: "win32", GITHUB_RUN_ID: runId, GITHUB_RUN_ATTEMPT: runAttempt, GITHUB_ENV: githubEnv };
    const producer = run(prebrowserRecorder, ["--output", source, "--stage", stage], environment);
    assert.equal(producer.status, 0, producer.stderr);
    await appendFile(githubEnv, `ADMIN_TRUSTED_UNLOCK_PREBROWSER_FAILURE_PATH=${source}\n`, "utf8");
    const handoff = Object.fromEntries((await readFile(githubEnv, "utf8")).trim().split("\n").map((line) => line.split("=", 2)));
    const recorded = run(publishedRecorder, [], { ...environment, QUALIFICATION_EVIDENCE_ROOT: evidenceRoot, ADMIN_TRUSTED_UNLOCK_PREBROWSER_FAILURE_PATH: handoff.ADMIN_TRUSTED_UNLOCK_PREBROWSER_FAILURE_PATH });
    assert.equal(recorded.status, 0, recorded.stderr);
    assert.deepEqual(await readdir(evidenceRoot), ["admin-trusted-unlock-prebrowser-failure.json"]);
    const retained = JSON.parse(await readFile(path.join(evidenceRoot, "admin-trusted-unlock-prebrowser-failure.json"), "utf8"));
    assert.deepEqual(retained, { schema: "service-lasso.admin-trusted-unlock-prebrowser-failure.v1", outcome: "failure", platform: "win32", stage, run: { id: Number(runId), attempt: Number(runAttempt) } });
  }
});
