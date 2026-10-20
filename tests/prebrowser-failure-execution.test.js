import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { recordPrebrowserFailure } from "../scripts/record-admin-trusted-unlock-prebrowser-failure.mjs";
import { hostCustodyFixture } from "./helpers/host-custody-fixture.mjs";
import { verifyArtifacts } from "../scripts/verify-packaged-admin-lifecycle-artifacts.mjs";

const callerEstablishment = fileURLToPath(new URL("../scripts/establish-admin-trusted-unlock-receipt-caller.mjs", import.meta.url));
const publishedRecorder = fileURLToPath(new URL("../scripts/record-published-package-qualification.mjs", import.meta.url));
const packagedWorkflow = fileURLToPath(new URL("../.github/workflows/packaged-admin-lifecycle.yml", import.meta.url));
const publishedAggregate = fileURLToPath(new URL("../scripts/verify-published-package-qualification-artifacts.mjs", import.meta.url));
const runId = "431", runAttempt = "2";
const projectionMutations = [
  ["stale attempt", value => { value.run.attempt = "3"; }],
  ["wrong candidate", value => { value.candidate.head = "0".repeat(40); }],
  ["wrong platform", value => { value.platform = "foreign"; }],
  ["expanded attestation", value => { value.localValidatorAttestation.nativeFileCount = 19; }],
  ["unvalidated", value => { value.localValidatorAttestation.validated = false; }],
  ["invalid private digest", value => { value.privateInitialReceiptSha256 = "invalid"; }],
];
function run(script, environment) { return spawnSync(process.execPath, [script], { encoding: "utf8", shell: false, env: environment }); }
async function npmCli() {
  if (process.platform !== "win32") return { command: "npm", args: [] };
  const cli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  await access(cli); return { command: process.execPath, args: [cli] };
}
function selectedActionVersion(selected, environment) {
  const options = { encoding: "utf8", shell: false, env: environment };
  if (process.platform !== "win32") return spawnSync(selected, ["--version"], options);
  const commandProcessor = environment.ComSpec ?? environment.COMSPEC;
  assert.ok(commandProcessor, "Windows action fixture requires ComSpec");
  assert.doesNotMatch(selected, /[\r\n"%!^&|<>()]/u);
  return spawnSync(commandProcessor, ["/d", "/s", "/c", `""${selected}" --version"`], { ...options, windowsVerbatimArguments: true });
}
async function actionFixture(root, name = "pinned-action") {
  const actionRoot = path.join(root, name), actionHome = path.join(actionRoot, "node_modules", ".bin"), bin = path.join(actionHome, "bin");
  await mkdir(actionHome, { recursive: true });
  const npm = await npmCli();
  const installed = spawnSync(npm.command, [...npm.args, "install", "--prefix", actionRoot, "--ignore-scripts", "--no-save", "--package-lock=false", "--no-audit", "--no-fund", "pnpm@11.25.0"], { encoding: "utf8", shell: false });
  assert.equal(installed.status, 0, installed.stderr);
  const updated = spawnSync(process.execPath, [path.join(actionRoot, "node_modules", "pnpm", "bin", "pnpm.mjs"), "self-update", "10.34.5"], { encoding: "utf8", shell: false, env: { ...process.env, PNPM_HOME: actionHome } });
  assert.equal(updated.status, 0, updated.stderr);
  const selected = process.platform === "win32" ? path.join(bin, "pnpm.cmd") : path.join(bin, "pnpm");
  const version = selectedActionVersion(selected, { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` });
  assert.equal(version.status, 0, `${version.error?.message ?? ""}\n${version.stderr}`);
  assert.equal(version.stdout.trim(), "10.34.5");
  return { bin, selected };
}
async function producerEnvironment(root, fixture, extra = {}) {
  const custody = await hostCustodyFixture(root, runId, runAttempt);
  return { ...custody.env, ...extra, GITHUB_ENV: path.join(root, "github-env"), ADMIN_PNPM_PREFIX: path.join(root, "isolated-pnpm"), PNPM_ACTION_BIN_DEST: fixture?.bin, PATH: fixture ? `${fixture.bin}${path.delimiter}${process.env.PATH}` : process.env.PATH };
}
async function copyWithActualPackagedProducer(root, environment, source) {
  const workflow = await readFile(packagedWorkflow, "utf8");
  const match = workflow.match(/- name: Record metadata-only packaged acceptance evidence[\s\S]*?run: \|\r?\n([\s\S]*?)\r?\n      - name: Upload packaged Admin lifecycle evidence/);
  assert.ok(match, "packaged producer block must remain available");
  const script = match[1].split("\n").map((line) => line.startsWith("          ") ? line.slice(10) : line).join("\n");
  const result = spawnSync("pwsh", ["-NoLogo", "-NoProfile", "-Command", script], { cwd: root, encoding: "utf8", shell: false, env: { ...environment, ADMIN_TRUSTED_UNLOCK_PREBROWSER_FAILURE_PATH: source } });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await readdir(path.join(root, "artifacts")), ["admin-trusted-unlock-prebrowser-failure.json", "initial-projection.json"]);
}

for (const stage of ["action_binding", "fresh_prefix", "isolated_install", "package_identity"]) {
test(`AC-4BY.2 actual ${stage} guard retains host-native public custody through both workflow callers`, async () => {
  const source = await readFile(callerEstablishment, "utf8");
  assert.doesNotMatch(source, /SERVICE_LASSO_TEST_PREBROWSER_STAGE|NODE_ENV === "test"/);
    const root = await mkdtemp(path.join(tmpdir(), "prebrowser-execution-"));
    const fixture = await actionFixture(root);
    const environment = await producerEnvironment(root, fixture);
    if (stage === "action_binding") {
      const reported = await actionFixture(root, "pinned-action-reported-bin");
      assert.notEqual(await realpath(fixture.selected), await realpath(reported.selected));
      Object.assign(environment, { PNPM_ACTION_BIN_DEST: reported.bin, PATH: `${fixture.bin}${path.delimiter}${process.env.PATH}` });
    }
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
    const evidenceRoot = environment.QUALIFICATION_EVIDENCE_ROOT;
    const recorded = run(publishedRecorder, { ...environment, QUALIFICATION_EVIDENCE_ROOT: evidenceRoot, ADMIN_TRUSTED_UNLOCK_PREBROWSER_FAILURE_PATH: handoff.ADMIN_TRUSTED_UNLOCK_PREBROWSER_FAILURE_PATH });
    assert.equal(recorded.status, 0, recorded.stderr);
    assert.deepEqual(await readdir(evidenceRoot), ["admin-trusted-unlock-prebrowser-failure.json", "initial-projection.json"]);
    const retained = JSON.parse(await readFile(path.join(evidenceRoot, "admin-trusted-unlock-prebrowser-failure.json"), "utf8"));
    assert.deepEqual(retained, { schema: "service-lasso.admin-trusted-unlock-prebrowser-failure.v1", outcome: "failure", platform: process.platform, stage, run: { id: Number(runId), attempt: Number(runAttempt) } });
    assert.deepEqual(JSON.parse(await readFile(path.join(evidenceRoot, "initial-projection.json"), "utf8")), JSON.parse(await readFile(environment.QUALIFICATION_INITIAL_PROJECTION_PATH,"utf8")));
    assert.deepEqual(JSON.parse(await readFile(path.join(root,"artifacts","initial-projection.json"),"utf8")),JSON.parse(await readFile(environment.QUALIFICATION_INITIAL_PROJECTION_PATH,"utf8")));
    const original=JSON.parse(await readFile(environment.QUALIFICATION_INITIAL_PROJECTION_PATH,"utf8"));
    for(const [label,mutate] of projectionMutations) {
      const changed=structuredClone(original);mutate(changed);
      await writeFile(environment.QUALIFICATION_INITIAL_PROJECTION_PATH,JSON.stringify(changed));
      const rejected=run(publishedRecorder,{...environment,ADMIN_TRUSTED_UNLOCK_PREBROWSER_FAILURE_PATH:handoff.ADMIN_TRUSTED_UNLOCK_PREBROWSER_FAILURE_PATH});
      assert.notEqual(rejected.status,0,`${stage}/${label}`);
      assert.match(rejected.stderr,/Initial qualification projection custody is invalid/u);
    }
    await writeFile(environment.QUALIFICATION_INITIAL_PROJECTION_PATH,JSON.stringify(original));
    const missing=run(publishedRecorder,{...environment,QUALIFICATION_INITIAL_PROJECTION_PATH:path.join(root,"missing-projection.json"),ADMIN_TRUSTED_UNLOCK_PREBROWSER_FAILURE_PATH:handoff.ADMIN_TRUSTED_UNLOCK_PREBROWSER_FAILURE_PATH});
    assert.notEqual(missing.status,0);assert.match(missing.stderr,/Initial qualification projection custody is invalid/u);
});
}

test("AC-4BY.2 executes the published aggregate CLI readback for closed three-platform pre-browser failures", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "published-prebrowser-aggregate-"));
  const nativeRoot=await mkdtemp(path.join(tmpdir(),"prebrowser-native-custody-")),native=await hostCustodyFixture(nativeRoot,runId,runAttempt);
  const sha = native.projection.candidate.head, now = new Date(), later = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  // Host projection came from actual private validation above. Rebinding only
  // public platform tuples below is a consumer/API surrogate for non-host OSs;
  // it cannot prove their private provenance or successful preparation.
  for (const platform of ["linux", "win32", "darwin"]) {
    const directory = path.join(root, `published-package-qualification-${platform}-${runId}-${runAttempt}`);
    await mkdir(directory);
    await recordPrebrowserFailure({ output: path.join(directory, "admin-trusted-unlock-prebrowser-failure.json"), platform, stage: "package_identity", runId, runAttempt });
    await writeFile(path.join(directory, "initial-projection.json"), JSON.stringify({ ...native.projection, platform }));
  }
  const artifacts = { artifacts: ["linux", "win32", "darwin"].map((platform, index) => ({ id: index + 1, name: `published-package-qualification-${platform}-${runId}-${runAttempt}`, size_in_bytes: 1, expired: false, created_at: now.toISOString(), updated_at: now.toISOString(), expires_at: later.toISOString(), workflow_run: { id: Number(runId), head_sha: sha }, archive_download_url: `https://api.github.com/repos/service-lasso/service-lasso/actions/artifacts/${index + 1}/zip` })) };
  const jobs = { jobs: ["linux", "win32", "darwin"].map((platform, index) => ({ id: index + 1, name: `published-package-qualification (${platform})`, status: "completed", conclusion: "failure", run_id: Number(runId), run_attempt: Number(runAttempt) })) };
  const preload = path.join(root, "provider-readback.cjs");
  await writeFile(preload, `global.fetch=async(url)=>new Response(JSON.stringify(String(url).includes('/artifacts?')?${JSON.stringify(artifacts)}:${JSON.stringify(jobs)}),{status:200,headers:{'content-type':'application/json'}});`);
  const aggregateEnvironment = { ...process.env, NODE_OPTIONS: `--require=${preload}`, GITHUB_REPOSITORY: "service-lasso/service-lasso", GITHUB_TOKEN: "test-token", GITHUB_RUN_ID: runId, GITHUB_RUN_ATTEMPT: runAttempt, GITHUB_SHA: sha, QUALIFICATION_ARTIFACTS_ROOT: root, CORE_RELEASE_ID: "1", CORE_RELEASE_TAG: "2026.10.1-aaaaaaa", CORE_REVISION: sha, CORE_NPM_VERSION: "2026.10.1-aaaaaaa", CORE_NPM_INTEGRITY: "sha512-YQ==", CORE_LINUX_SHA256: "b".repeat(64), CORE_WIN32_SHA256: "c".repeat(64), CORE_DARWIN_SHA256: "d".repeat(64) };
  const result = run(publishedAggregate, aggregateEnvironment);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Exact three-platform artifact API readback/u);
  const publishedHostDirectory=path.join(root,`published-package-qualification-${process.platform}-${runId}-${runAttempt}`);
  for(const [label,mutate] of projectionMutations) {
    const changed=structuredClone(native.projection);mutate(changed);
    await writeFile(path.join(publishedHostDirectory,"initial-projection.json"),JSON.stringify(changed));
    const rejected=run(publishedAggregate,aggregateEnvironment);assert.notEqual(rejected.status,0,label);assert.match(rejected.stderr,/initial projection custody/u);
  }
  await rm(path.join(publishedHostDirectory,"initial-projection.json"));
  assert.notEqual(run(publishedAggregate,aggregateEnvironment).status,0,"missing public projection");
  await writeFile(path.join(publishedHostDirectory,"initial-projection.json"),JSON.stringify(native.projection));
  await writeFile(path.join(publishedHostDirectory,"unexpected-private-receipt.json"),"private inventory expansion sentinel");
  assert.notEqual(run(publishedAggregate,aggregateEnvironment).status,0,"expanded public inventory");
  await rm(path.join(publishedHostDirectory,"unexpected-private-receipt.json"));

  const packagedRoot=await mkdtemp(path.join(tmpdir(),"packaged-prebrowser-contract-"));
  const packagedJobs=jobs.jobs.map(job=>({...job,name:job.name.replace("published-package-qualification","packaged-admin-lifecycle")}));
  for(const platform of ["linux","win32","darwin"]) {
    const directory=path.join(packagedRoot,`packaged-admin-lifecycle-${platform}-${runId}-${runAttempt}`);await mkdir(directory);
    await recordPrebrowserFailure({output:path.join(directory,"admin-trusted-unlock-prebrowser-failure.json"),platform,stage:"package_identity",runId,runAttempt});
    await writeFile(path.join(directory,"initial-projection.json"),JSON.stringify({...native.projection,platform}));
  }
  const verifyPackaged=terminalJobs=>verifyArtifacts({root:packagedRoot,runId,runAttempt,candidateSha:sha,eventSha:sha,terminalJobs});
  await assert.doesNotReject(verifyPackaged(packagedJobs));
  const hostDirectory=path.join(packagedRoot,`packaged-admin-lifecycle-${process.platform}-${runId}-${runAttempt}`);
  for(const [label,mutate] of projectionMutations) {
    const changed=structuredClone(native.projection);mutate(changed);
    await writeFile(path.join(hostDirectory,"initial-projection.json"),JSON.stringify(changed));
    await assert.rejects(verifyPackaged(packagedJobs),/initial projection custody/u,label);
  }
  await writeFile(path.join(hostDirectory,"initial-projection.json"),JSON.stringify(native.projection));
  await rm(path.join(hostDirectory,"initial-projection.json"));
  await assert.rejects(verifyPackaged(packagedJobs),/artifact inventory/u);
  await writeFile(path.join(hostDirectory,"initial-projection.json"),JSON.stringify(native.projection));
  await writeFile(path.join(hostDirectory,"unexpected-private-receipt.json"),"private inventory expansion sentinel");
  await assert.rejects(verifyPackaged(packagedJobs),/artifact inventory/u);
  await rm(path.join(hostDirectory,"unexpected-private-receipt.json"));

  for (const mutate of [
    (job) => { job.id = 0; },
    (job) => { job.run_id = Number(runId) - 1; },
    (job) => { job.run_attempt = Number(runAttempt) + 1; },
    (job) => { job.status = "in_progress"; },
    (job) => { job.conclusion = "success"; },
    (_job, all) => all.push({ ...all[0], id: 99 }),
  ]) {
    const mutated = structuredClone(jobs);
    mutate(mutated.jobs[0], mutated.jobs);
    await writeFile(preload, `global.fetch=async(url)=>new Response(JSON.stringify(String(url).includes('/artifacts?')?${JSON.stringify(artifacts)}:${JSON.stringify(mutated)}),{status:200,headers:{'content-type':'application/json'}});`);
    const rejected = run(publishedAggregate, { ...process.env, NODE_OPTIONS: `--require=${preload}`, GITHUB_REPOSITORY: "service-lasso/service-lasso", GITHUB_TOKEN: "test-token", GITHUB_RUN_ID: runId, GITHUB_RUN_ATTEMPT: runAttempt, GITHUB_SHA: sha, QUALIFICATION_ARTIFACTS_ROOT: root, CORE_RELEASE_ID: "1", CORE_RELEASE_TAG: "2026.10.1-aaaaaaa", CORE_REVISION: sha, CORE_NPM_VERSION: "2026.10.1-aaaaaaa", CORE_NPM_INTEGRITY: "sha512-YQ==", CORE_LINUX_SHA256: "b".repeat(64), CORE_WIN32_SHA256: "c".repeat(64), CORE_DARWIN_SHA256: "d".repeat(64) });
    assert.notEqual(rejected.status, 0, rejected.stderr);
    assert.match(rejected.stderr, /pre-browser failure must bind one matching terminal failed job/u);
    const packagedMutated=structuredClone(packagedJobs);mutate(packagedMutated[0],packagedMutated);
    await assert.rejects(verifyPackaged(packagedMutated),/pre-browser failure must bind one matching terminal failed job/u);
  }
});
