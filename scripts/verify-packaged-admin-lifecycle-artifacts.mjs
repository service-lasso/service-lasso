import { assertScope, REQUIRED_GA_PLATFORMS } from "./ga-platform-scope-lib.mjs";
import { validInitialProjection } from "./public-first-custody-projection-lib.mjs";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { hasObservedConsumerReceipt, isRetainableConsumerReceipt, parseConsumerReceipt, strictJson } from "./consume-admin-trusted-unlock-receipt.mjs";
import { ADMIN_HARNESS_REVISION, ADMIN_RELEASE, BROKER_RELEASE } from "./published-package-qualification-lib.mjs";
import { parsePrebrowserFailure } from "./record-admin-trusted-unlock-prebrowser-failure.mjs";
const platforms = ["linux", "win32", "darwin"];
const MAX_TERMINAL_JOBS_BYTES = 262_144;
const TERMINAL_JOBS_TIMEOUT_MS = 10_000;
function required(name, pattern = /^.+$/u) { const value = process.env[name]; if (!value || !pattern.test(value)) throw new Error(`Invalid ${name}.`); return value; }
async function regular(file, label) { const info = await lstat(file).catch(() => null); if (!info?.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > 16384) throw new Error(`${label} is missing, private, or invalid.`); return readFile(file, "utf8"); }
async function containsPrebrowserArtifact(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const files = await readdir(path.join(root, entry.name), { withFileTypes: true });
    if (files.some((file) => file.isFile() && !file.isSymbolicLink() && file.name === "admin-trusted-unlock-prebrowser-failure.json")) return true;
  }
  return false;
}
function exactKeys(value, keys) { return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join(",") === [...keys].sort().join(","); }
function validateInitialProjection(source, platform, runId, runAttempt, candidateSha) {
  if (!strictJson(source)) return false;
  return validInitialProjection(JSON.parse(source), platform, runId, runAttempt, candidateSha);
}
function sameValue(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object" || Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left)) return left.length === right.length && left.every((value, index) => sameValue(value, right[index]));
  const leftKeys = Object.keys(left).sort(), rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && sameValue(left[key], right[key]));
}
function expectedRelease(release, platform) {
  return { revision: release.revision, releaseId: release.id, tag: release.tag, asset: release.platforms[platform].asset, sha256: release.platforms[platform].sha256, checksumSource: "SHA256SUMS.txt" };
}
async function boundedBody(response, signal, timeoutMs) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Packaged pre-browser terminal job API response is invalid.");
  const chunks = [];
  let total = 0;
  let timeout;
  let complete = false;
  let rejectAbort;
  const aborted = new Promise((_, reject) => {
    rejectAbort = () => reject(new Error("Packaged pre-browser terminal job API readback timed out."));
    if (signal.aborted) rejectAbort();
    else signal.addEventListener("abort", rejectAbort, { once: true });
    timeout = setTimeout(rejectAbort, timeoutMs);
  });
  try {
    for (;;) {
      const next = await Promise.race([reader.read(), aborted]);
      if (next.done) { complete = true; break; }
      if (!(next.value instanceof Uint8Array)) throw new Error("Packaged pre-browser terminal job API response is invalid.");
      total += next.value.byteLength;
      if (total > MAX_TERMINAL_JOBS_BYTES) throw new Error("Packaged pre-browser terminal job API response is oversized.");
      chunks.push(next.value);
    }
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", rejectAbort);
    // A hostile or stalled stream must not make failure classification wait for
    // cancellation. Begin disposal and relinquish the reader without awaiting it.
    if (!complete) {
      try { void Promise.resolve(reader.cancel()).catch(() => {}); } catch {}
    }
    try { reader.releaseLock(); } catch {}
  }
  if (total === 0) throw new Error("Packaged pre-browser terminal job API response is invalid.");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
export async function readTerminalJobs({ repository, runId, runAttempt, fetchImpl = fetch, timeoutMs = TERMINAL_JOBS_TIMEOUT_MS }) {
  const signal = AbortSignal.timeout(timeoutMs);
  const response = await fetchImpl(`https://api.github.com/repos/${repository}/actions/runs/${runId}/attempts/${runAttempt}/jobs?per_page=100`, {
    // This repository is public. GitHub documents public workflow-job reads as
    // unauthenticated; retaining that route avoids widening this workflow's
    // permissions merely to classify an already-failed pre-browser job.
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "service-lasso-packaged-admin-lifecycle" },
    redirect: "error",
    signal,
  });
  if (!response.ok) throw new Error("Packaged pre-browser terminal job API readback failed.");
  const advertisedSize = Number(response.headers.get("content-length"));
  if ((Number.isFinite(advertisedSize) && advertisedSize > MAX_TERMINAL_JOBS_BYTES) || advertisedSize < 0) throw new Error("Packaged pre-browser terminal job API response is oversized.");
  const bytes = await boundedBody(response, signal, timeoutMs);
  let payload;
  try {
    const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!strictJson(source)) throw new Error("duplicate JSON keys");
    payload = JSON.parse(source);
  } catch { throw new Error("Packaged pre-browser terminal job API response is malformed."); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !Array.isArray(payload.jobs)) throw new Error("Packaged pre-browser terminal job API response is incomplete.");
  return payload.jobs;
}
export function requireTerminalPrebrowserFailure(jobs, platform, runId, runAttempt) {
  const matches = jobs.filter((job) => job?.name === `packaged-admin-lifecycle (${platform})`);
  if (matches.length !== 1 || !Number.isSafeInteger(matches[0]?.id) || matches[0].id <= 0 || matches[0]?.status !== "completed" || matches[0]?.conclusion !== "failure" || String(matches[0]?.run_id) !== String(runId) || String(matches[0]?.run_attempt) !== String(runAttempt)) throw new Error(`${platform} pre-browser failure must bind one matching terminal failed job.`);
}
function validateEvidence(source, platform, runId, runAttempt, candidateSha, eventSha) {
  if (!strictJson(source)) throw new Error(`${platform} evidence is malformed or has duplicate keys.`);
  const evidence = JSON.parse(source);
  if (!exactKeys(evidence, ["schema", "retainedContent", "outcome", "platform", "core", "admin", "adminHarness", "broker", "browser", "run", "consumer"]) || evidence.schema !== "service-lasso.packaged-admin-lifecycle.v1" || evidence.retainedContent !== "metadata_only" || !["success", "failure"].includes(evidence.outcome) || evidence.platform !== platform) throw new Error(`${platform} evidence schema is invalid.`);
  if (!exactKeys(evidence.core, ["revision"]) || evidence.core.revision !== candidateSha) throw new Error(`${platform} Core candidate custody validation failed.`);
  if (!exactKeys(evidence.admin, ["revision", "releaseId", "tag", "asset", "sha256", "checksumSource"]) || !sameValue(evidence.admin, expectedRelease(ADMIN_RELEASE, platform))) throw new Error(`${platform} Admin release custody validation failed.`);
  if (!exactKeys(evidence.broker, ["revision", "releaseId", "tag", "asset", "sha256", "checksumSource"]) || !sameValue(evidence.broker, expectedRelease(BROKER_RELEASE, platform))) throw new Error(`${platform} Broker release custody validation failed.`);
  if (!exactKeys(evidence.adminHarness, ["repository", "revision"]) || evidence.adminHarness.repository !== "service-lasso/lasso-serviceadmin" || evidence.adminHarness.revision !== ADMIN_HARNESS_REVISION) throw new Error(`${platform} Admin harness custody validation failed.`);
  const expectedModes = platform === "win32" ? ["first_run", "comprehensive_lifecycle", "stopped_lifecycle", "local_operator_lockout"] : ["first_run", "comprehensive_lifecycle", "stopped_lifecycle"];
  if (!exactKeys(evidence.browser, ["modes", "mutationRetry", "capturesRetained", "sensitiveEvidenceRetained"]) || !sameValue(evidence.browser.modes, expectedModes) || evidence.browser.mutationRetry !== false || evidence.browser.capturesRetained !== false || evidence.browser.sensitiveEvidenceRetained !== false) throw new Error(`${platform} browser evidence is invalid.`);
  if (!exactKeys(evidence.run, ["id", "attempt", "candidateSha", "eventSha"]) || evidence.run.id !== runId || evidence.run.attempt !== runAttempt || evidence.run.candidateSha !== candidateSha || evidence.run.eventSha !== eventSha) throw new Error(`${platform} run custody validation failed.`);
  if (!evidence.consumer || typeof evidence.consumer !== "object" || Array.isArray(evidence.consumer) || evidence.consumer.attempt !== "real_browser") throw new Error(`${platform} consumer custody validation failed.`);
  const { attempt: _attempt, ...consumerSource } = evidence.consumer;
  const receipt = parseConsumerReceipt(JSON.stringify(consumerSource));
  if (!receipt || !isRetainableConsumerReceipt(receipt) || !exactKeys(evidence.consumer, ["attempt", ...Object.keys(receipt)]) || !sameValue(receipt, consumerSource)) throw new Error(`${platform} receipt custody validation failed.`);
  if (evidence.outcome === "success" && !hasObservedConsumerReceipt(receipt)) throw new Error(`${platform} unobserved or failed consumer cannot qualify as success.`);
  return receipt;
}
async function verifyArtifactSet({ root, runId, runAttempt, candidateSha, eventSha, terminalJobs = null }, scope) {
  if (scope) assertScope(scope);
  const platforms = scope ? REQUIRED_GA_PLATFORMS : ["linux", "win32", "darwin"];
  const expected = new Set(platforms.map((platform) => `packaged-admin-lifecycle-${platform}-${runId}-${runAttempt}`));
  const directories = await readdir(root, { withFileTypes: true });
  if (directories.length !== expected.size || directories.some((entry) => !entry.isDirectory() || !expected.has(entry.name))) throw new Error("Downloaded artifacts are not the exact current attempt.");
  for (const platform of platforms) {
    const name = `packaged-admin-lifecycle-${platform}-${runId}-${runAttempt}`, directory = path.join(root, name), files = await readdir(directory, { withFileTypes: true });
    const evidenceName = `packaged-admin-lifecycle-${platform}.json`, receiptName = "admin-trusted-unlock-receipt.json", initialReceiptName = "initial-projection.json";
    const prebrowserName = "admin-trusted-unlock-prebrowser-failure.json";
    if (files.length === 2 && files.every((file) => file.isFile() && !file.isSymbolicLink()) && files.some((file) => file.name === prebrowserName) && files.some((file) => file.name === initialReceiptName)) {
      if (!validateInitialProjection(await regular(path.join(directory, initialReceiptName), `${platform} initial projection`), platform, runId, runAttempt, candidateSha)) throw new Error(`${platform} initial projection custody validation failed.`);
      const prebrowser = parsePrebrowserFailure(await regular(path.join(directory, prebrowserName), `${platform} pre-browser failure`));
      if (!prebrowser || prebrowser.platform !== platform || String(prebrowser.run.id) !== runId || String(prebrowser.run.attempt) !== runAttempt) throw new Error(`${platform} pre-browser failure custody validation failed.`);
      if (!terminalJobs) throw new Error(`${platform} pre-browser failure terminal job is unobserved.`);
      requireTerminalPrebrowserFailure(terminalJobs, platform, runId, runAttempt);
      if (scope) throw new Error("Scoped Admin prebrowser evidence retains failure and cannot qualify");
      continue;
    }
    if (files.length !== 3 || files.some((entry) => !entry.isFile() || entry.isSymbolicLink()) || !files.some((entry) => entry.name === evidenceName) || !files.some((entry) => entry.name === receiptName) || !files.some((entry) => entry.name === initialReceiptName)) throw new Error(`${platform} artifact inventory is invalid.`);
    if (!validateInitialProjection(await regular(path.join(directory, initialReceiptName), `${platform} initial projection`), platform, runId, runAttempt, candidateSha)) throw new Error(`${platform} initial projection custody validation failed.`);
    const evidenceSource = await regular(path.join(directory, evidenceName), `${platform} evidence`);
    const receipt = parseConsumerReceipt(await regular(path.join(directory, receiptName), `${platform} receipt`));
    const retained = validateEvidence(evidenceSource, platform, runId, runAttempt, candidateSha, eventSha);
    if (scope && (JSON.parse(evidenceSource).outcome !== "success" || !hasObservedConsumerReceipt(retained))) throw new Error("Scoped Admin evidence is not success");
    if (!receipt || !isRetainableConsumerReceipt(receipt) || !sameValue(retained, receipt)) throw new Error(`${platform} retained receipt custody validation failed.`);
  }
}
export function verifyArtifacts(input) { return verifyArtifactSet(input); }
export function verifyScopedArtifacts(input, scope) { assertScope(scope); return verifyArtifactSet(input, scope); }
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const runId = required("GITHUB_RUN_ID", /^[1-9][0-9]*$/u), runAttempt = required("GITHUB_RUN_ATTEMPT", /^[1-9][0-9]*$/u);
  const root = required("PACKAGED_ARTIFACTS_ROOT");
  const terminalJobs = await ((await containsPrebrowserArtifact(root)) ? readTerminalJobs({ repository: required("GITHUB_REPOSITORY", /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u), runId, runAttempt }) : Promise.resolve(null));
  await verifyArtifacts({ root, runId, runAttempt, candidateSha: required("QUALIFICATION_CANDIDATE_SHA", /^[0-9a-f]{40}$/u), eventSha: required("QUALIFICATION_EVENT_SHA", /^[0-9a-f]{40}$/u), terminalJobs });
}
