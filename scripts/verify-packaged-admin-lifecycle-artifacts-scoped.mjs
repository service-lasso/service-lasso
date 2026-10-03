import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertDevelopIdentity, assertPolicyEnvironment, digest, parseScopedJson, readSourceScope, REQUIRED_GA_PLATFORMS, sourceIdentity } from "./ga-platform-scope-lib.mjs";
import { verifyScopedArtifacts } from "./verify-packaged-admin-lifecycle-artifacts.mjs";
import { validateRetainedArtifactMetadata, validateTerminalJobMetadata } from "./published-package-qualification-lib.mjs";
import { validateTechnicalQualification } from "./scoped-release-evidence-lib.mjs";
import { boundedProviderBody, readAuthenticatedArtifact } from "./scoped-provider-readback-lib.mjs";
import { readOriginalMetadataArtifact } from "./scoped-metadata-artifact-lib.mjs";
assertDevelopIdentity(); assertPolicyEnvironment();
const scope = await readSourceScope(), repo = "service-lasso/service-lasso", source = sourceIdentity(process.env.QUALIFICATION_CANDIDATE_SHA);
const runId = Number(process.env.GITHUB_RUN_ID), attempt = Number(process.env.GITHUB_RUN_ATTEMPT), root = process.env.PACKAGED_ARTIFACTS_ROOT;
if (process.env.GITHUB_REPOSITORY !== repo || !root || !process.env.GITHUB_TOKEN || ![runId, attempt].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error("scoped Admin provider context invalid");
async function api(route) {
  const response = await fetch(`https://api.github.com/repos/${repo}${route}`, { redirect: "error", headers: { accept: "application/vnd.github+json", authorization: `Bearer ${process.env.GITHUB_TOKEN}` }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error("scoped Admin provider readback failed");
  return parseScopedJson(await boundedProviderBody(response, 4 * 1024 * 1024));
}
const [run, jobsPayload, artifactsPayload] = await Promise.all([api(`/actions/runs/${runId}`), api(`/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`), api(`/actions/runs/${runId}/artifacts?per_page=100`)]);
if (run.head_sha !== source.commit || run.run_attempt !== attempt || run.path !== ".github/workflows/packaged-admin-lifecycle-scoped.yml" || jobsPayload.total_count !== jobsPayload.jobs?.length || artifactsPayload.total_count !== artifactsPayload.artifacts?.length) throw new Error("scoped Admin run candidate/attempt/inventory differs");
const artifacts = artifactsPayload.artifacts.filter(row => row.name?.startsWith("packaged-admin-lifecycle-") && row.name.endsWith(`-${runId}-${attempt}`));
if (artifacts.length !== 2) throw new Error("scoped Admin artifact set differs");
if (!process.env.GITHUB_TOKEN) throw new Error("scoped Admin original artifact readback token missing");
for (const artifact of artifacts) {
  const match = new RegExp(`^packaged-admin-lifecycle-(win32|linux)-${runId}-${attempt}$`, "u").exec(artifact.name);
  if (!match) throw new Error("scoped Admin original artifact selector differs");
  validateRetainedArtifactMetadata(artifact, { name: artifact.name, repo, runId, workflowSha: source.commit });
  const directory = path.join(root, artifact.name), entries = await readdir(directory);
  const names = entries.length === 2 && entries.includes("admin-trusted-unlock-prebrowser-failure.json") ? ["initial-projection.json", "admin-trusted-unlock-prebrowser-failure.json"] : [`packaged-admin-lifecycle-${match[1]}.json`, "admin-trusted-unlock-receipt.json", "initial-projection.json"];
  const original = await readAuthenticatedArtifact(artifact.archive_download_url, repo, process.env.GITHUB_TOKEN);
  const originals = readOriginalMetadataArtifact(original, names, artifact.digest);
  for (const [name, bytes] of originals) {
    const file = path.join(directory, name), info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > 256 * 1024 * 1024 || !bytes.equals(await readFile(file))) throw new Error("scoped Admin original metadata differs from downloaded files");
  }
}
await verifyScopedArtifacts({ root, runId: String(runId), runAttempt: String(attempt), candidateSha: source.commit, eventSha: source.commit, terminalJobs: jobsPayload.jobs }, scope);
const receipts = [];
for (const platform of REQUIRED_GA_PLATFORMS) {
  const name = `packaged-admin-lifecycle-${platform}-${runId}-${attempt}`;
  const matches = jobsPayload.jobs.filter(row => row.name === `packaged-admin-lifecycle (${platform})`);
  if (matches.length !== 1) throw new Error("scoped Admin job selector differs");
  validateTerminalJobMetadata(matches[0], { repo, name: matches[0].name, jobId: matches[0].id, runId, runAttempt: attempt, workflowSha: source.commit });
  const artifact = artifacts.find(row => row.name === name);
  validateRetainedArtifactMetadata(artifact, { name, repo, runId, workflowSha: source.commit });
  const fileName = `packaged-admin-lifecycle-${platform}.json`, file = path.join(root, name, fileName), info = await lstat(file), bytes = await readFile(file);
  if (!info.isFile() || info.isSymbolicLink() || bytes.length !== info.size) throw new Error("scoped Admin terminal held receipt changed");
  receipts.push({ platform, jobId: matches[0].id, runId, runAttempt: attempt, workflowSha: source.commit, name: fileName, sha256: digest(bytes), size: bytes.length });
}
const wrapper = { schema: "service-lasso.release-qualification.v1", scope, source, run: { id: runId, attempt, workflowSha: source.commit }, platforms: [...REQUIRED_GA_PLATFORMS], receipts, outcome: "success" };
validateTechnicalQualification(wrapper, source);
await writeFile(path.join(root, "scoped-admin-qualification.json"), `${JSON.stringify(wrapper, null, 2)}\n`, { flag: "wx" });
