import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { retainReceipt } from "../scripts/retain-packaged-admin-lifecycle-receipt.mjs";
import { consume } from "../scripts/consume-admin-trusted-unlock-receipt.mjs";
import { ADMIN_HARNESS_REVISION, ADMIN_RELEASE, BROKER_RELEASE } from "../scripts/published-package-qualification-lib.mjs";
import { recordPrebrowserFailure } from "../scripts/record-admin-trusted-unlock-prebrowser-failure.mjs";
import { readTerminalJobs, requireTerminalPrebrowserFailure, verifyArtifacts } from "../scripts/verify-packaged-admin-lifecycle-artifacts.mjs";

const script = new URL("../scripts/verify-packaged-admin-lifecycle-artifacts.mjs", import.meta.url);
const workflow = new URL("../.github/workflows/packaged-admin-lifecycle.yml", import.meta.url);
const runId = "431", runAttempt = "2", candidateSha = "a".repeat(40), eventSha = "b".repeat(40);
const terminalJobs = ["linux", "win32", "darwin"].map((platform, index) => ({ id: index + 1, name: `packaged-admin-lifecycle (${platform})`, status: "completed", conclusion: "failure", run_id: Number(runId), run_attempt: Number(runAttempt) }));
const receipt = { schema: "service-lasso.admin-trusted-unlock-consumer.v1", outcome: "nonzero_exit", exitCode: 1, signal: null, trustedUnlock: { classification: "closed", receipt: { schema: "service-admin.trusted-unlock-receipt.v1", status: "observed", present: true, verified: false, localRoot: false, loading: true, unavailable: false } } };
const observationFailureReceipt = { ...receipt, outcome: "observation_failure", exitCode: 0, streamFailure: "malformed_utf8" };
const unavailableReceipt = (classification) => ({ ...receipt, trustedUnlock: { classification } });
function evidenceFor(platform) {
  const release = (value) => ({ revision: value.revision, releaseId: value.id, tag: value.tag, asset: value.platforms[platform].asset, sha256: value.platforms[platform].sha256, checksumSource: "SHA256SUMS.txt" });
  return { schema: "service-lasso.packaged-admin-lifecycle.v1", retainedContent: "metadata_only", outcome: "failure", platform, core: { revision: candidateSha }, admin: release(ADMIN_RELEASE), adminHarness: { repository: "service-lasso/lasso-serviceadmin", revision: ADMIN_HARNESS_REVISION }, broker: release(BROKER_RELEASE), browser: { modes: platform === "win32" ? ["first_run", "comprehensive_lifecycle", "stopped_lifecycle", "local_operator_lockout"] : ["first_run", "comprehensive_lifecycle", "stopped_lifecycle"], mutationRetry: false, capturesRetained: false, sensitiveEvidenceRetained: false } };
}
async function fixture(mutator, source = receipt) {
  const root = await mkdtemp(path.join(tmpdir(), "packaged-custody-"));
  for (const platform of ["linux", "win32", "darwin"]) {
    const directory = path.join(root, `packaged-admin-lifecycle-${platform}-${runId}-${runAttempt}`);
    await mkdir(directory);
    const evidence = path.join(directory, `packaged-admin-lifecycle-${platform}.json`), retained = path.join(directory, "admin-trusted-unlock-receipt.json"), privateReceipt = path.join(await mkdtemp(path.join(tmpdir(), "packaged-private-")), "runner-private-receipt.json");
    await writeFile(path.join(directory, "initial-receipt.json"), JSON.stringify({ schema: "service-lasso.qualification-initial-receipt.v1", platform, run: { id: Number(runId), attempt: Number(runAttempt) } }));
    await writeFile(evidence, JSON.stringify(evidenceFor(platform)));
    await writeFile(privateReceipt, JSON.stringify(source));
    await retainReceipt({ receiptPath: privateReceipt, evidencePath: evidence, retainedPath: retained, runId, runAttempt, candidateSha, eventSha, platform });
  }
  await mutator?.(root); return root;
}
function verify(root) { return spawnSync(process.execPath, [fileURLToPath(script)], { env: { ...process.env, PACKAGED_ARTIFACTS_ROOT: root, GITHUB_RUN_ID: runId, GITHUB_RUN_ATTEMPT: runAttempt, QUALIFICATION_CANDIDATE_SHA: candidateSha, QUALIFICATION_EVENT_SHA: eventSha }, encoding: "utf8" }); }
async function actualConsumerReceipt(root, name, childSource) {
  const child = path.join(root, `${name}.mjs`), output = path.join(root, `${name}.json`);
  await writeFile(child, childSource);
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/consume-admin-trusted-unlock-receipt.mjs", import.meta.url)), "--receipt", output, "--", process.execPath, child], { encoding: "utf8" });
  assert.ok(Number.isInteger(result.status) && result.status >= 0 && result.status <= 255, result.stderr);
  return JSON.parse(await readFile(output, "utf8"));
}
test("AC-4BY.2 workflow binds every checkout and retained artifact to the PR head rather than its synthetic merge", async () => {
  const source = await readFile(workflow, "utf8");
  assert.match(source, /QUALIFICATION_CANDIDATE_SHA: \$\{\{ github\.event_name == 'pull_request' && github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
  assert.equal((source.match(/ref: \$\{\{ env\.QUALIFICATION_CANDIDATE_SHA \}\}/g) ?? []).length, 2);
  assert.match(source, /test "\$core_revision" = "\$QUALIFICATION_CANDIDATE_SHA"/);
  assert.match(source, /QUALIFICATION_EVENT_SHA: \$\{\{ github\.sha \}\}/);
  assert.match(source, /Verify exact aggregate candidate checkout/);
});
test("AC-4BY.2 aggregate validates executable three-platform failed-Cypress receipt custody", async () => { const result = verify(await fixture()); assert.equal(result.status, 0, result.stderr); });
test("AC-4BY.2 executes each finite pre-browser producer through the packaged aggregate and requires its matching terminal failed job", async () => {
  for (const stage of ["action_binding", "fresh_prefix", "isolated_install", "package_identity"]) {
    const root = await fixture(async (root) => {
      const platform = "win32", directory = path.join(root, `packaged-admin-lifecycle-${platform}-${runId}-${runAttempt}`);
      await Promise.all(["packaged-admin-lifecycle-win32.json", "admin-trusted-unlock-receipt.json"].map((name) => rm(path.join(directory, name))));
      await recordPrebrowserFailure({ output: path.join(directory, "admin-trusted-unlock-prebrowser-failure.json"), platform, stage, runId, runAttempt });
    });
    await assert.doesNotReject(verifyArtifacts({ root, runId, runAttempt, candidateSha, eventSha, terminalJobs }), stage);
    await assert.rejects(verifyArtifacts({ root, runId, runAttempt, candidateSha, eventSha }), /terminal job is unobserved/u, stage);
  }
});
test("AC-4BY.2 rejects missing, stale, and expanded initial receipt custody for both normal and pre-browser artifacts", async () => {
  for (const [label, mutate] of [
    ["missing", async (directory) => rm(path.join(directory, "initial-receipt.json"))],
    ["stale", async (directory) => writeFile(path.join(directory, "initial-receipt.json"), JSON.stringify({ schema: "service-lasso.qualification-initial-receipt.v1", platform: "win32", run: { id: Number(runId) - 1, attempt: Number(runAttempt) } }))],
    ["expanded", async (directory) => writeFile(path.join(directory, "initial-receipt.json"), JSON.stringify({ schema: "service-lasso.qualification-initial-receipt.v1", platform: "win32", run: { id: Number(runId), attempt: Number(runAttempt) }, private: true }))],
  ]) {
    const normal = await fixture(async (root) => mutate(path.join(root, `packaged-admin-lifecycle-win32-${runId}-${runAttempt}`)));
    await assert.rejects(verifyArtifacts({ root: normal, runId, runAttempt, candidateSha, eventSha }), /(?:initial receipt custody|artifact inventory)/u, `normal ${label}`);
    const prebrowser = await fixture(async (root) => {
      const directory = path.join(root, `packaged-admin-lifecycle-win32-${runId}-${runAttempt}`);
      await Promise.all(["packaged-admin-lifecycle-win32.json", "admin-trusted-unlock-receipt.json"].map((name) => rm(path.join(directory, name))));
      await recordPrebrowserFailure({ output: path.join(directory, "admin-trusted-unlock-prebrowser-failure.json"), platform: "win32", stage: "package_identity", runId, runAttempt });
      await mutate(directory);
    });
    await assert.rejects(verifyArtifacts({ root: prebrowser, runId, runAttempt, candidateSha, eventSha, terminalJobs }), /(?:initial receipt custody|artifact inventory)/u, `pre-browser ${label}`);
  }
});
test("AC-4BY.2 public terminal-job read is bounded, unauthenticated, and fails closed for unavailable or malformed provider payloads", async () => {
  const valid = { jobs: [terminalJobs[1]] };
  const route = await readTerminalJobs({ repository: "service-lasso/service-lasso", runId, runAttempt, fetchImpl: async (_url, options) => {
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.redirect, "error");
    assert.ok(options.signal);
    return new Response(JSON.stringify(valid), { status: 200, headers: { "content-length": String(Buffer.byteLength(JSON.stringify(valid))) } });
  } });
  assert.deepEqual(route, valid.jobs);
  for (const response of [
    new Response("", { status: 503 }),
    new Response("{", { status: 200 }),
    new Response(JSON.stringify({ jobs: null }), { status: 200 }),
    new Response('{"jobs":[],"jobs":[]}', { status: 200 }),
    new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(262145)); } }), { status: 200 }),
    new Response(new ReadableStream({ start() {} }), { status: 200 }),
  ]) await assert.rejects(readTerminalJobs({ repository: "service-lasso/service-lasso", runId, runAttempt, timeoutMs: 1, fetchImpl: async () => response }));
  let oversizedCancelled = false;
  const oversized = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(262145)); },
    cancel() { oversizedCancelled = true; return new Promise(() => {}); },
  }), { status: 200 });
  await assert.rejects(readTerminalJobs({ repository: "service-lasso/service-lasso", runId, runAttempt, timeoutMs: 1, fetchImpl: async () => oversized }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(oversizedCancelled, true);
  let stalledCancelled = false;
  const stalled = new Response(new ReadableStream({
    start() {},
    cancel() { stalledCancelled = true; throw new Error("fixture cancellation failure"); },
  }), { status: 200 });
  await assert.rejects(readTerminalJobs({ repository: "service-lasso/service-lasso", runId, runAttempt, timeoutMs: 1, fetchImpl: async () => stalled }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stalledCancelled, true);
});
test("AC-4BY.2 terminal pre-browser job binding rejects incomplete, mismatched, nonterminal, and duplicate provider identities", () => {
  for (const mutation of [
    (job) => { delete job.id; },
    (job) => { job.run_id = 999; },
    (job) => { job.run_attempt = 1; },
    (job) => { job.status = "in_progress"; },
    (job) => { job.conclusion = "success"; },
    (job, jobs) => jobs.push({ ...job, id: 99 }),
  ]) {
    const jobs = [{ ...terminalJobs[1] }];
    mutation(jobs[0], jobs);
    assert.throws(() => requireTerminalPrebrowserFailure(jobs, "win32", runId, runAttempt));
  }
});
test("AC-4BY.2 aggregate validates an executable successful no-failure consumer receipt", async () => {
  const success = { schema: "service-lasso.admin-trusted-unlock-consumer.v1", outcome: "success", exitCode: 0, signal: null, trustedUnlock: { classification: "not_emitted" } };
  const result = verify(await fixture(undefined, success));
  assert.equal(result.status, 0, result.stderr);
});
test("AC-4BY.2 aggregate preserves an executable observation-failure mechanism without qualifying it", async () => {
  const result = verify(await fixture(undefined, observationFailureReceipt));
  assert.equal(result.status, 0, result.stderr);
});
test("AC-4BY.2 retains typed missing and invalid failed-consumer diagnostics without qualifying either", async () => {
  for (const classification of ["missing", "invalid"]) {
    const retained = verify(await fixture(undefined, unavailableReceipt(classification)));
    assert.equal(retained.status, 0, retained.stderr);
    const rejectedAsSuccess = verify(await fixture(async (root) => {
      for (const platform of ["linux", "win32", "darwin"]) {
        const evidence = path.join(root, `packaged-admin-lifecycle-${platform}-${runId}-${runAttempt}`, `packaged-admin-lifecycle-${platform}.json`);
        const value = JSON.parse(await readFile(evidence, "utf8"));
        value.outcome = "success";
        await writeFile(evidence, JSON.stringify(value));
      }
    }, unavailableReceipt(classification)));
    assert.notEqual(rejectedAsSuccess.status, 0, `${classification} must not qualify`);
  }
});
test("AC-4BY.2 round-trips actual consumer outcomes through retention and aggregate custody", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "packaged-consumer-roundtrip-"));
  const valid = JSON.stringify(receipt.trustedUnlock.receipt);
  const cases = [
    ["success-not-emitted", "process.exit(0);", "success"],
    ["nonzero-closed", `process.stderr.write(${JSON.stringify(`${valid}\n`)}, () => process.exit(7));`, "nonzero_exit"],
    ["nonzero-missing", "process.exit(7);", "nonzero_exit"],
    ["nonzero-invalid", `process.stderr.write(${JSON.stringify(`${valid.slice(0, -1)},"private":true}\n`)}, () => process.exit(7));`, "nonzero_exit"],
    ["private", `process.stderr.write(${JSON.stringify(`${valid.slice(0, -1)},"private":true}\n`)}, () => process.exit(7));`, "nonzero_exit"],
    ["utf8", "process.stderr.write(Buffer.from([0xc3, 0x28]), () => process.exit(0));", "observation_failure"],
    ["budget", "process.stderr.write(Buffer.alloc(65537, 0x78), () => process.exit(0));", "observation_failure"],
    ["duplicate", `process.stderr.write(${JSON.stringify(`${valid}\n${valid}\n`)}, () => process.exit(7));`, "nonzero_exit"],
  ];
  for (const [name, childSource, outcome] of cases) {
    const source = await actualConsumerReceipt(root, name, childSource);
    assert.equal(source.outcome, outcome, name);
    const result = verify(await fixture(undefined, source));
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
  }
  const stalled = path.join(root, "timeout-child.mjs");
  await writeFile(stalled, "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);");
  const timed = await consume(process.execPath, [stalled], { timeoutMs: 25, pipeCloseTimeoutMs: 100 });
  const timeoutReceipt = { schema: "service-lasso.admin-trusted-unlock-consumer.v1", outcome: "observation_failure", exitCode: timed.code, signal: timed.signal, executionFailure: timed.executionFailure, trustedUnlock: timed.trustedUnlock };
  assert.equal(timeoutReceipt.executionFailure, "execution_timeout");
  const timeoutResult = verify(await fixture(undefined, timeoutReceipt));
  assert.equal(timeoutResult.status, 0, timeoutResult.stderr);
});
for (const [label, source] of [
  ["missing read file", null],
  ["truncated duplicate source", '{"schema":"service-lasso.admin-trusted-unlock-consumer.v1","outcome":"nonzero_exit","outcome":"nonzero_exit"}'],
  ["expanded private source", { ...receipt, private: true }],
  ["contradictory success classification", { ...receipt, outcome: "success", exitCode: 0 }],
  ["contradictory failed classification", { ...receipt, trustedUnlock: { classification: "not_emitted" } }],
]) test(`AC-4BY.2 recorder rejects ${label}`, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "packaged-recorder-"));
  const evidence = path.join(root, "evidence.json"), retained = path.join(root, "retained.json"), receiptPath = path.join(root, "receipt.json");
  await writeFile(evidence, JSON.stringify(evidenceFor("linux")));
  if (source !== null) await writeFile(receiptPath, typeof source === "string" ? source : JSON.stringify(source));
  await assert.rejects(retainReceipt({ receiptPath, evidencePath: evidence, retainedPath: retained, runId, runAttempt, candidateSha, eventSha, platform: "linux" }));
});
for (const [label, source] of [
  ["contradictory exit and signal", { ...receipt, exitCode: 7, signal: "SIGTERM" }],
  ["observation failure without mechanism", { ...receipt, outcome: "observation_failure", exitCode: 0 }],
  ["observation failure with dual mechanisms", { ...observationFailureReceipt, executionFailure: "spawn_failed" }],
  ["private source", { ...receipt, private: true }],
  ["duplicate source", JSON.stringify(receipt).replace('"outcome":"nonzero_exit",', '"outcome":"nonzero_exit","outcome":"nonzero_exit",')],
  ["missing source", null],
]) test(`AC-4BY.2 recorder rejects ${label} for every platform before artifact retention`, async () => {
  for (const platform of ["linux", "win32", "darwin"]) {
    const root = await mkdtemp(path.join(tmpdir(), `packaged-recorder-${platform}-`));
    const evidence = path.join(root, "evidence.json"), retained = path.join(root, "retained.json"), receiptPath = path.join(root, "receipt.json");
    await writeFile(evidence, JSON.stringify(evidenceFor(platform)));
    if (source !== null) await writeFile(receiptPath, typeof source === "string" ? source : JSON.stringify(source));
    await assert.rejects(retainReceipt({ receiptPath, evidencePath: evidence, retainedPath: retained, runId, runAttempt, candidateSha, eventSha, platform }));
  }
});
for (const [label, mutate] of [
  ["missing", async (root) => writeFile(path.join(root, `packaged-admin-lifecycle-linux-${runId}-${runAttempt}`, "admin-trusted-unlock-receipt.json"), "")],
  ["private", async (root) => writeFile(path.join(root, `packaged-admin-lifecycle-linux-${runId}-${runAttempt}`, "admin-trusted-unlock-receipt.json"), JSON.stringify({ ...receipt, secret: "x" }))],
  ["malformed", async (root) => writeFile(path.join(root, `packaged-admin-lifecycle-linux-${runId}-${runAttempt}`, "admin-trusted-unlock-receipt.json"), "{")],
  ["truncated duplicate", async (root) => writeFile(path.join(root, `packaged-admin-lifecycle-linux-${runId}-${runAttempt}`, "admin-trusted-unlock-receipt.json"), JSON.stringify(receipt).replace('"outcome":"nonzero_exit",', '"outcome":"nonzero_exit","outcome":"nonzero_exit",'))],
  ["expanded private source", async (root) => writeFile(path.join(root, `packaged-admin-lifecycle-linux-${runId}-${runAttempt}`, "admin-trusted-unlock-receipt.json"), JSON.stringify({ ...receipt, private: true }))],
  ["success without explicit no-failure classification", async (root) => writeFile(path.join(root, `packaged-admin-lifecycle-linux-${runId}-${runAttempt}`, "admin-trusted-unlock-receipt.json"), JSON.stringify({ ...receipt, outcome: "success", exitCode: 0, trustedUnlock: null }))],
  ["stale", async (root) => { const file = path.join(root, `packaged-admin-lifecycle-linux-${runId}-${runAttempt}`, "packaged-admin-lifecycle-linux.json"); const value = JSON.parse(await readFile(file)); value.run.id = "430"; await writeFile(file, JSON.stringify(value)); }],
  ["attempt mismatch", async (root) => { const file = path.join(root, `packaged-admin-lifecycle-linux-${runId}-${runAttempt}`, "packaged-admin-lifecycle-linux.json"); const value = JSON.parse(await readFile(file)); value.run.attempt = "1"; await writeFile(file, JSON.stringify(value)); }],
  ["wrong Core candidate", async (root) => { const file = path.join(root, `packaged-admin-lifecycle-linux-${runId}-${runAttempt}`, "packaged-admin-lifecycle-linux.json"); const value = JSON.parse(await readFile(file)); value.core.revision = "b".repeat(40); await writeFile(file, JSON.stringify(value)); }],
  ["wrong frozen candidate identity", async (root) => { const file = path.join(root, `packaged-admin-lifecycle-linux-${runId}-${runAttempt}`, "packaged-admin-lifecycle-linux.json"); const value = JSON.parse(await readFile(file)); value.run.candidateSha = "c".repeat(40); await writeFile(file, JSON.stringify(value)); }],
  ["wrong synthetic merge identity", async (root) => { const file = path.join(root, `packaged-admin-lifecycle-linux-${runId}-${runAttempt}`, "packaged-admin-lifecycle-linux.json"); const value = JSON.parse(await readFile(file)); value.run.eventSha = "c".repeat(40); await writeFile(file, JSON.stringify(value)); }],
  ["wrong Admin release", async (root) => { const file = path.join(root, `packaged-admin-lifecycle-linux-${runId}-${runAttempt}`, "packaged-admin-lifecycle-linux.json"); const value = JSON.parse(await readFile(file)); value.admin.releaseId = "1"; await writeFile(file, JSON.stringify(value)); }],
  ["wrong Admin revision", async (root) => { const file = path.join(root, `packaged-admin-lifecycle-linux-${runId}-${runAttempt}`, "packaged-admin-lifecycle-linux.json"); const value = JSON.parse(await readFile(file)); value.admin.revision = "b".repeat(40); await writeFile(file, JSON.stringify(value)); }],
  ["wrong Admin checksum", async (root) => { const file = path.join(root, `packaged-admin-lifecycle-linux-${runId}-${runAttempt}`, "packaged-admin-lifecycle-linux.json"); const value = JSON.parse(await readFile(file)); value.admin.sha256 = "b".repeat(64); await writeFile(file, JSON.stringify(value)); }],
  ["wrong Admin harness", async (root) => { const file = path.join(root, `packaged-admin-lifecycle-linux-${runId}-${runAttempt}`, "packaged-admin-lifecycle-linux.json"); const value = JSON.parse(await readFile(file)); value.adminHarness.revision = "b".repeat(40); await writeFile(file, JSON.stringify(value)); }],
  ["expanded evidence", async (root) => { const file = path.join(root, `packaged-admin-lifecycle-linux-${runId}-${runAttempt}`, "packaged-admin-lifecycle-linux.json"); const value = JSON.parse(await readFile(file)); value.private = true; await writeFile(file, JSON.stringify(value)); }],
  ["extra material", async (root) => writeFile(path.join(root, `packaged-admin-lifecycle-linux-${runId}-${runAttempt}`, "extra.json"), "{}")],
]) test(`AC-4BY.2 aggregate rejects ${label} receipt custody`, async () => { assert.notEqual(verify(await fixture(mutate)).status, 0); });
for (const [label, source] of [
  ["contradictory exit and signal", { ...receipt, exitCode: 7, signal: "SIGTERM" }],
  ["private", { ...receipt, private: true }],
  ["duplicate", JSON.stringify(receipt).replace('"outcome":"nonzero_exit",', '"outcome":"nonzero_exit","outcome":"nonzero_exit",')],
  ["missing", ""],
]) test(`AC-4BY.2 aggregate rejects ${label} retained receipt across all three platform artifacts`, async () => {
  const result = verify(await fixture(async (root) => {
    for (const platform of ["linux", "win32", "darwin"]) await writeFile(path.join(root, `packaged-admin-lifecycle-${platform}-${runId}-${runAttempt}`, "admin-trusted-unlock-receipt.json"), typeof source === "string" ? source : JSON.stringify(source));
  }));
  assert.notEqual(result.status, 0);
});
