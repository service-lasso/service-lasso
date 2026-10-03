import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertDevelopIdentity, assertPolicyEnvironment, digest, parseScopedJson, readSourceScope, REQUIRED_GA_PLATFORMS, sourceIdentity } from "./ga-platform-scope-lib.mjs";
import { verifyScopedArtifacts } from "./verify-packaged-admin-lifecycle-artifacts.mjs";
import { validateRetainedArtifactMetadata, validateTerminalJobMetadata } from "./published-package-qualification-lib.mjs";
import { validateTechnicalQualification } from "./scoped-release-evidence-lib.mjs";
assertDevelopIdentity(); assertPolicyEnvironment();
const scope = await readSourceScope(), repo = "service-lasso/service-lasso", source = sourceIdentity(process.env.QUALIFICATION_CANDIDATE_SHA);
const runId = Number(process.env.GITHUB_RUN_ID), attempt = Number(process.env.GITHUB_RUN_ATTEMPT), root = process.env.PACKAGED_ARTIFACTS_ROOT;
if (process.env.GITHUB_REPOSITORY !== repo || !root || ![runId, attempt].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error("scoped Admin provider context invalid");
async function api(route) {
  const response = await fetch(`https://api.github.com/repos/${repo}${route}`, { redirect: "error", headers: { accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error("scoped Admin provider readback failed");
  return parseScopedJson(Buffer.from(await response.arrayBuffer()));
}
const [run, jobsPayload, artifactsPayload] = await Promise.all([api(`/actions/runs/${runId}`), api(`/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`), api(`/actions/runs/${runId}/artifacts?per_page=100`)]);
if (run.head_sha !== source.commit || run.run_attempt !== attempt || run.path !== ".github/workflows/packaged-admin-lifecycle-scoped.yml" || jobsPayload.total_count !== jobsPayload.jobs?.length || artifactsPayload.total_count !== artifactsPayload.artifacts?.length) throw new Error("scoped Admin run candidate/attempt/inventory differs");
const artifacts = artifactsPayload.artifacts.filter(row => row.name?.startsWith("packaged-admin-lifecycle-") && row.name.endsWith(`-${runId}-${attempt}`));
if (artifacts.length !== 2) throw new Error("scoped Admin artifact set differs");
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
