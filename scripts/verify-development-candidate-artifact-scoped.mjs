import { assertDevelopIdentity, assertPolicyEnvironment, parseScopedJson, readSourceScope } from "./ga-platform-scope-lib.mjs";
import { boundedProviderBody, readAuthenticatedArtifact } from "./scoped-provider-readback-lib.mjs";
import { validateRetainedArtifactMetadata, validateTerminalJobMetadata } from "./published-package-qualification-lib.mjs";
import { readOriginalMetadataArtifact } from "./scoped-metadata-artifact-lib.mjs";
import { scopedArchiveNames, verifyCandidate2Bytes, assertNames } from "./scoped-release-evidence-lib.mjs";
import path from "node:path";
import { lstat, readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export async function verifyDevelopmentCandidateArtifact() {
assertDevelopIdentity(); assertPolicyEnvironment(); await readSourceScope();
const repo = "service-lasso/service-lasso", sha = process.env.CANDIDATE_SHA, token = process.env.GH_TOKEN;
const runId = Number(process.env.GITHUB_RUN_ID), attempt = Number(process.env.GITHUB_RUN_ATTEMPT), id = Number(process.env.DEVELOPMENT_CANDIDATE_ARTIFACT_ID);
const name = `core-development-candidate-${sha}`, expectedDigest = process.env.DEVELOPMENT_CANDIDATE_ARTIFACT_DIGEST?.replace(/^sha256:/u, "");
if (process.env.GITHUB_REPOSITORY !== repo || process.env.GITHUB_SHA !== sha || process.env.DEVELOPMENT_CANDIDATE_DISPATCH_SHA !== sha || process.env.DEVELOPMENT_CANDIDATE_ARTIFACT_NAME !== name || !token || ![runId, attempt, id].every(value => Number.isSafeInteger(value) && value > 0) || !/^[a-f0-9]{64}$/u.test(expectedDigest ?? "")) throw new Error("scoped candidate artifact assertions differ");
async function api(route) {
  const response = await fetch(`https://api.github.com/repos/${repo}${route}`, { headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" }, redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("scoped candidate artifact readback failed");
  return parseScopedJson(await boundedProviderBody(response, 4 * 1024 * 1024));
}
const [run, artifact, jobs] = await Promise.all([api(`/actions/runs/${runId}`), api(`/actions/artifacts/${id}`), api(`/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`)]);
if (run.head_sha !== sha || run.run_attempt !== attempt || run.path !== ".github/workflows/core-development-candidate-scoped.yml" || jobs.total_count !== jobs.jobs?.length) throw new Error("scoped candidate artifact actual source/attempt differs");
const producerJobs = jobs.jobs.filter(job => job.name === "build-candidate");
if (producerJobs.length !== 1) throw new Error("scoped candidate actual producer absent/duplicate");
validateTerminalJobMetadata(producerJobs[0], { repo, name: "build-candidate", jobId: producerJobs[0].id, runId, runAttempt: attempt, workflowSha: sha });
validateRetainedArtifactMetadata(artifact, { repo, name, runId, workflowSha: sha });
if (artifact.id !== id || artifact.digest !== `sha256:${expectedDigest}`) throw new Error("scoped candidate upload identity differs");
const bytes = await readAuthenticatedArtifact(`https://api.github.com/repos/${repo}/actions/artifacts/${id}/zip`, repo, token);
const names = [...scopedArchiveNames(`develop-${sha.slice(0, 12)}`, false), "candidate-manifest.json", "SHA256SUMS.txt"];
const held = readOriginalMetadataArtifact(bytes, names, artifact.digest);
return held;
}

// Actual smoke caller: no detached checksum receipt or later filesystem reopen.
export async function readVerifiedDevelopmentCandidate(root) {
  const original = await verifyDevelopmentCandidateArtifact();
  return compareDownloadedCandidate(root, original, process.env.CANDIDATE_SHA);
}

export async function compareDownloadedCandidate(root, original, sha) {
  const entries = await readdir(root);
  assertNames(entries, [...original.keys()]);
  const held = new Map();
  for (const name of entries) {
    const location = path.join(root, name), info = await lstat(location);
    if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > 256 * 1024 * 1024) throw new Error("Candidate artifact entries must be bounded regular files.");
    const bytes = await readFile(location);
    if (bytes.length !== info.size || !bytes.equals(original.get(name))) throw new Error("downloaded candidate differs from original provider artifact body");
    held.set(name, bytes);
  }
  const manifest = verifyCandidate2Bytes(held, { repository: "service-lasso/service-lasso", commit: sha, ref: "refs/heads/develop" });
  return { held, manifest };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
await verifyDevelopmentCandidateArtifact();
process.stdout.write("Exact original candidate provider ZIP and six-member inventory verified.\n");
}
