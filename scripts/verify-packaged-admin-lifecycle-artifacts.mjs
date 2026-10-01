import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { hasObservedConsumerReceipt, isRetainableConsumerReceipt, parseConsumerReceipt, strictJson } from "./consume-admin-trusted-unlock-receipt.mjs";
import { ADMIN_HARNESS_REVISION, ADMIN_RELEASE, BROKER_RELEASE } from "./published-package-qualification-lib.mjs";
const platforms = ["linux", "win32", "darwin"];
function required(name, pattern = /^.+$/u) { const value = process.env[name]; if (!value || !pattern.test(value)) throw new Error(`Invalid ${name}.`); return value; }
async function regular(file, label) { const info = await lstat(file).catch(() => null); if (!info?.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > 16384) throw new Error(`${label} is missing, private, or invalid.`); return readFile(file, "utf8"); }
function exactKeys(value, keys) { return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join(",") === [...keys].sort().join(","); }
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
export async function verifyArtifacts({ root, runId, runAttempt, candidateSha, eventSha }) {
  const expected = new Set(platforms.map((platform) => `packaged-admin-lifecycle-${platform}-${runId}-${runAttempt}`));
  const directories = await readdir(root, { withFileTypes: true });
  if (directories.length !== expected.size || directories.some((entry) => !entry.isDirectory() || !expected.has(entry.name))) throw new Error("Downloaded artifacts are not the exact current attempt.");
  for (const platform of platforms) {
    const name = `packaged-admin-lifecycle-${platform}-${runId}-${runAttempt}`, directory = path.join(root, name), files = await readdir(directory, { withFileTypes: true });
    const evidenceName = `packaged-admin-lifecycle-${platform}.json`, receiptName = "admin-trusted-unlock-receipt.json";
    if (files.length !== 2 || files.some((entry) => !entry.isFile() || entry.isSymbolicLink()) || !files.some((entry) => entry.name === evidenceName) || !files.some((entry) => entry.name === receiptName)) throw new Error(`${platform} artifact inventory is invalid.`);
    const evidenceSource = await regular(path.join(directory, evidenceName), `${platform} evidence`);
    const receipt = parseConsumerReceipt(await regular(path.join(directory, receiptName), `${platform} receipt`));
    const retained = validateEvidence(evidenceSource, platform, runId, runAttempt, candidateSha, eventSha);
    if (!receipt || !isRetainableConsumerReceipt(receipt) || !sameValue(retained, receipt)) throw new Error(`${platform} retained receipt custody validation failed.`);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) await verifyArtifacts({ root: required("PACKAGED_ARTIFACTS_ROOT"), runId: required("GITHUB_RUN_ID", /^[1-9][0-9]*$/u), runAttempt: required("GITHUB_RUN_ATTEMPT", /^[1-9][0-9]*$/u), candidateSha: required("QUALIFICATION_CANDIDATE_SHA", /^[0-9a-f]{40}$/u), eventSha: required("QUALIFICATION_EVENT_SHA", /^[0-9a-f]{40}$/u) });
