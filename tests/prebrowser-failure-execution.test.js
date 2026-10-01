import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { recordPrebrowserFailure } from "../scripts/record-admin-trusted-unlock-prebrowser-failure.mjs";

const callerEstablishment = fileURLToPath(new URL("../scripts/establish-admin-trusted-unlock-receipt-caller.mjs", import.meta.url));
const publishedRecorder = fileURLToPath(new URL("../scripts/record-published-package-qualification.mjs", import.meta.url));
const packagedWorkflow = fileURLToPath(new URL("../.github/workflows/packaged-admin-lifecycle.yml", import.meta.url));
const publishedAggregate = fileURLToPath(new URL("../scripts/verify-published-package-qualification-artifacts.mjs", import.meta.url));
const runId = "431", runAttempt = "2";
function run(script, environment) { return spawnSync(process.execPath, [script], { encoding: "utf8", shell: false, env: environment }); }
async function npmCli() {
  if (process.platform !== "win32") return { command: "npm", args: [] };
  const cli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  await access(cli); return { command: process.execPath, args: [cli] };
}
async function actionFixture(root) {
  const actionRoot = path.join(root, "pinned-action"), actionHome = path.join(actionRoot, "node_modules", ".bin"), bin = path.join(actionHome, "bin");
  await mkdir(actionHome, { recursive: true });
  const npm = await npmCli();
  const installed = spawnSync(npm.command, [...npm.args, "install", "--prefix", actionRoot, "--ignore-scripts", "--no-save", "--package-lock=false", "--no-audit", "--no-fund", "pnpm@11.25.0"], { encoding: "utf8", shell: false });
  assert.equal(installed.status, 0, installed.stderr);
  const updated = spawnSync(process.execPath, [path.join(actionRoot, "node_modules", "pnpm", "bin", "pnpm.mjs"), "self-update", "10.34.5"], { encoding: "utf8", shell: false, env: { ...process.env, PNPM_HOME: actionHome } });
  assert.equal(updated.status, 0, updated.stderr);
  return { bin };
}
async function producerEnvironment(root, fixture, extra = {}) {
  const githubEnv = path.join(root, "github-env");
  return { ...process.env, ...extra, QUALIFICATION_PLATFORM: "win32", GITHUB_RUN_ID: runId, GITHUB_RUN_ATTEMPT: runAttempt, RUNNER_TEMP: root, GITHUB_ENV: githubEnv, ADMIN_PNPM_PREFIX: path.join(root, "isolated-pnpm"), PNPM_ACTION_BIN_DEST: fixture?.bin, PATH: fixture ? `${fixture.bin}${path.delimiter}${process.env.PATH}` : process.env.PATH };
}
async function copyWithActualPackagedProducer(root, environment, source) {
  const workflow = await readFile(packagedWorkflow, "utf8");
  const match = workflow.match(/- name: Record metadata-only packaged acceptance evidence[\s\S]*?run: \|\r?\n([\s\S]*?)\r?\n      - name: Upload packaged Admin lifecycle evidence/);
  assert.ok(match, "packaged producer block must remain available");
  const script = match[1].split("\n").map((line) => line.startsWith("          ") ? line.slice(10) : line).join("\n");
  const result = spawnSync("pwsh", ["-NoLogo", "-NoProfile", "-Command", script], { cwd: root, encoding: "utf8", shell: false, env: { ...environment, ADMIN_TRUSTED_UNLOCK_PREBROWSER_FAILURE_PATH: source } });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await readdir(path.join(root, "artifacts")), ["admin-trusted-unlock-prebrowser-failure.json"]);
}

test("AC-4BY.2 executes actual pre-browser guards, GITHUB_ENV handoff, published recorder, and one-file upload inventory", async () => {
  const source = await readFile(callerEstablishment, "utf8");
  assert.doesNotMatch(source, /SERVICE_LASSO_TEST_PREBROWSER_STAGE|NODE_ENV === "test"/);
  for (const stage of ["action_binding", "fresh_prefix", "isolated_install", "package_identity"]) {
    const root = await mkdtemp(path.join(tmpdir(), "prebrowser-execution-"));
    const fixture = stage === "action_binding" ? null : await actionFixture(root);
    const environment = await producerEnvironment(root, fixture);
    if (stage === "fresh_prefix") await mkdir(environment.ADMIN_PNPM_PREFIX);
    if (stage === "isolated_install") Object.assign(environment, { npm_config_offline: "true", npm_config_cache: path.join(root, "empty-npm-cache") });
    if (stage === "package_identity") {
      const watcher = path.join(root, "corrupt-entrypoint.cjs");
      const entrypoint = path.join(environment.ADMIN_PNPM_PREFIX, "node_modules", "pnpm", "bin", "pnpm.cjs");
      await writeFile(watcher, `const fs=require('node:fs');const target=process.env.SERVICE_LASSO_TEST_CORRUPT_ENTRYPOINT;const timer=setInterval(()=>{try{if(fs.existsSync(target)){fs.unlinkSync(target);clearInterval(timer)}}catch{}},1);timer.unref();`);
      Object.assign(environment, { NODE_OPTIONS: `--require=${watcher}`, SERVICE_LASSO_TEST_CORRUPT_ENTRYPOINT: entrypoint });
    }
    const producer = run(callerEstablishment, environment);
    assert.notEqual(producer.status, 0, `${stage}: ${producer.stderr}`);
    const handoff = Object.fromEntries((await readFile(environment.GITHUB_ENV, "utf8")).trim().split("\n").map((line) => line.split("=", 2)));
    assert.equal(handoff.ADMIN_TRUSTED_UNLOCK_PREBROWSER_FAILURE_PATH, path.join(await realpath(root), "admin-trusted-unlock-prebrowser-failure.json"));
    await copyWithActualPackagedProducer(root, environment, handoff.ADMIN_TRUSTED_UNLOCK_PREBROWSER_FAILURE_PATH);
    const evidenceRoot = path.join(root, "uploaded");
    const recorded = run(publishedRecorder, { ...environment, QUALIFICATION_EVIDENCE_ROOT: evidenceRoot, ADMIN_TRUSTED_UNLOCK_PREBROWSER_FAILURE_PATH: handoff.ADMIN_TRUSTED_UNLOCK_PREBROWSER_FAILURE_PATH });
    assert.equal(recorded.status, 0, recorded.stderr);
    assert.deepEqual(await readdir(evidenceRoot), ["admin-trusted-unlock-prebrowser-failure.json"]);
    const retained = JSON.parse(await readFile(path.join(evidenceRoot, "admin-trusted-unlock-prebrowser-failure.json"), "utf8"));
    assert.deepEqual(retained, { schema: "service-lasso.admin-trusted-unlock-prebrowser-failure.v1", outcome: "failure", platform: "win32", stage, run: { id: Number(runId), attempt: Number(runAttempt) } });
  }
});

test("AC-4BY.2 executes the published aggregate CLI readback for closed three-platform pre-browser failures", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "published-prebrowser-aggregate-"));
  const sha = "a".repeat(40), now = new Date(), later = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  for (const platform of ["linux", "win32", "darwin"]) {
    const directory = path.join(root, `published-package-qualification-${platform}-${runId}-${runAttempt}`);
    await mkdir(directory);
    await recordPrebrowserFailure({ output: path.join(directory, "admin-trusted-unlock-prebrowser-failure.json"), platform, stage: "package_identity", runId, runAttempt });
  }
  const artifacts = { artifacts: ["linux", "win32", "darwin"].map((platform, index) => ({ id: index + 1, name: `published-package-qualification-${platform}-${runId}-${runAttempt}`, size_in_bytes: 1, expired: false, created_at: now.toISOString(), updated_at: now.toISOString(), expires_at: later.toISOString(), workflow_run: { id: Number(runId), head_sha: sha }, archive_download_url: `https://api.github.com/repos/service-lasso/service-lasso/actions/artifacts/${index + 1}/zip` })) };
  const jobs = { jobs: ["linux", "win32", "darwin"].map((platform, index) => ({ id: index + 1, name: `published-package-qualification (${platform})`, status: "completed", conclusion: "failure", run_id: Number(runId), run_attempt: Number(runAttempt) })) };
  const preload = path.join(root, "provider-readback.cjs");
  await writeFile(preload, `global.fetch=async(url)=>new Response(JSON.stringify(String(url).includes('/artifacts?')?${JSON.stringify(artifacts)}:${JSON.stringify(jobs)}),{status:200,headers:{'content-type':'application/json'}});`);
  const result = run(publishedAggregate, { ...process.env, NODE_OPTIONS: `--require=${preload}`, GITHUB_REPOSITORY: "service-lasso/service-lasso", GITHUB_TOKEN: "test-token", GITHUB_RUN_ID: runId, GITHUB_RUN_ATTEMPT: runAttempt, GITHUB_SHA: sha, QUALIFICATION_ARTIFACTS_ROOT: root, CORE_RELEASE_ID: "1", CORE_RELEASE_TAG: "2026.10.1-aaaaaaa", CORE_REVISION: sha, CORE_NPM_VERSION: "2026.10.1-aaaaaaa", CORE_NPM_INTEGRITY: "sha512-YQ==", CORE_LINUX_SHA256: "b".repeat(64), CORE_WIN32_SHA256: "c".repeat(64), CORE_DARWIN_SHA256: "d".repeat(64) });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Exact three-platform artifact API readback/u);
});
