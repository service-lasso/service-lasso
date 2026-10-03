import { assertDevelopIdentity, assertPolicyEnvironment, digest, parseScopedJson, readSourceScope } from "./ga-platform-scope-lib.mjs";
import { boundedProviderBody, readAuthenticatedArtifact } from "./scoped-provider-readback-lib.mjs";
import { validateRetainedArtifactMetadata } from "./published-package-qualification-lib.mjs";
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
const producer = producerJobs[0];
if (!Number.isSafeInteger(producer.id) || producer.id < 1 || producer.status !== "in_progress" || producer.conclusion !== null || String(producer.run_id) !== String(runId) || String(producer.run_attempt) !== String(attempt) || producer.head_sha !== sha || producer.url !== `https://api.github.com/repos/${repo}/actions/jobs/${producer.id}` || producer.run_url !== `https://api.github.com/repos/${repo}/actions/runs/${runId}` || producer.html_url !== `https://github.com/${repo}/actions/runs/${runId}/job/${producer.id}`) throw new Error("scoped upload current producer transport identity differs");
validateRetainedArtifactMetadata(artifact, { repo, name, runId, workflowSha: sha });
if (artifact.id !== id || artifact.digest !== `sha256:${expectedDigest}`) throw new Error("scoped candidate upload identity differs");
const bytes = await readAuthenticatedArtifact(`https://api.github.com/repos/${repo}/actions/artifacts/${id}/zip`, repo, token);
if (digest(bytes) !== expectedDigest) throw new Error("scoped candidate uploaded original bytes differ");
process.stdout.write(`${JSON.stringify({ candidateSha: sha, runId, runAttempt: attempt, artifactId: id, artifactName: name, downloadDigestVerified: true })}\n`);
