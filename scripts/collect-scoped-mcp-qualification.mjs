import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { readOriginalMetadataArtifact } from "./scoped-metadata-artifact-lib.mjs";
import { assertDevelopIdentity, assertPolicyEnvironment, digest, parseScopedJson, readSourceScope, REQUIRED_GA_PLATFORMS, sourceIdentity } from "./ga-platform-scope-lib.mjs";
import { validateRetainedArtifactMetadata, validateTerminalJobMetadata } from "./published-package-qualification-lib.mjs";
import { verifyPublicationQualification } from "./scoped-publication-lib.mjs";
import { validateTechnicalQualification } from "./scoped-release-evidence-lib.mjs";
import { boundedProviderBody, readAuthenticatedArtifact } from "./scoped-provider-readback-lib.mjs";

assertDevelopIdentity(); assertPolicyEnvironment();
const scope = await readSourceScope();
const repo = "service-lasso/service-lasso", source = sourceIdentity(process.env.CANDIDATE_SHA);
if (process.env.GITHUB_REPOSITORY !== repo) throw new Error("scoped producer repository differs");
const runId = Number(process.env.GITHUB_RUN_ID), attempt = Number(process.env.GITHUB_RUN_ATTEMPT);
if (![runId, attempt].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error("scoped workflow run invalid");
const routePrefixes = Object.freeze({
  "release-artifact-scoped.yml": "release-publish-mcp-product",
  "publish-package-scoped.yml": "publish-mcp-product",
  "release-qualification-scoped.yml": "release-mcp-product",
  "mcp-product-acceptance-scoped.yml": "mcp-product-acceptance",
});
const workflow = String(process.env.GITHUB_WORKFLOW_REF ?? "").split("/").at(-1)?.split("@")[0];
const prefix = routePrefixes[workflow];
if (!prefix) throw new Error("unknown source-owned scoped qualification route");
const token = process.env.GITHUB_TOKEN;
if (!token) throw new Error("scoped readback token missing");
async function api(route) {
  const response = await fetch(`https://api.github.com/repos/${repo}${route}`, { redirect: "error", signal: AbortSignal.timeout(15_000), headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" } });
  if (!response.ok) throw new Error("scoped qualification API readback failed");
  return parseScopedJson(await boundedProviderBody(response, 4 * 1024 * 1024), "scoped provider metadata");
}
const [run, jobsResponse, artifactResponse] = await Promise.all([api(`/actions/runs/${runId}`), api(`/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`), api(`/actions/runs/${runId}/artifacts?per_page=100`)]);
if (run.head_sha !== source.commit || run.run_attempt !== attempt || run.path !== `.github/workflows/${workflow}` || jobsResponse.total_count !== jobsResponse.jobs?.length || artifactResponse.total_count !== artifactResponse.artifacts?.length) throw new Error("scoped provider candidate/attempt/inventory differs");
const jobs = jobsResponse.jobs;
if (workflow === "release-qualification-scoped.yml") {
  for (const name of ["qualify-products", "broker-ipc (windows-latest)", "broker-ipc (ubuntu-latest)", "mcp-product-source"]) {
    const matches = jobs.filter(job => job.name === name);
    if (matches.length !== 1) throw new Error("complete technical qualification job absent/duplicate");
    validateTerminalJobMetadata(matches[0], { repo, name, jobId: matches[0].id, runId, runAttempt: attempt, workflowSha: source.commit });
  }
}
const artifacts = artifactResponse.artifacts.filter(row => row.name?.startsWith(`${prefix}-`));
for (const artifact of artifacts) {
  const match = new RegExp(`^${prefix}-(win32|linux)-([1-9][0-9]*)-([1-9][0-9]*)$`, "u").exec(artifact.name);
  if (!match || Number(match[2]) !== runId || Number(match[3]) > attempt) throw new Error("scoped MCP artifact selector expands or names a future attempt");
}
const current = artifacts.filter(row => row.name.endsWith(`-${runId}-${attempt}`));
const expected = REQUIRED_GA_PLATFORMS.map(platform => `${prefix}-${platform}-${runId}-${attempt}`);
if (current.length !== 2 || JSON.stringify(current.map(row => row.name).sort()) !== JSON.stringify([...expected].sort())) throw new Error("scoped MCP current artifact inventory differs");
const held = new Map(), receipts = [];
for (const platform of REQUIRED_GA_PLATFORMS) {
  const matches = jobs.filter(row => row.name === `mcp-packaged (${platform})`);
  if (matches.length !== 1) throw new Error("scoped native job selector differs");
  const artifact = current.find(row => row.name === `${prefix}-${platform}-${runId}-${attempt}`);
  validateRetainedArtifactMetadata(artifact, { repo, name: artifact.name, runId, workflowSha: source.commit });
  const archive = await readAuthenticatedArtifact(artifact.archive_download_url, repo, token);
  if (artifact.digest !== `sha256:${digest(archive)}`) throw new Error("scoped artifact body digest differs");
  const name = `mcp-product-${platform}.json`;
  const bytes = readOriginalMetadataArtifact(archive, [name], artifact.digest).get(name); held.set(name, bytes);
  receipts.push({ platform, jobId: matches[0].id, runId, runAttempt: attempt, workflowSha: source.commit, name, sha256: digest(bytes), size: bytes.length });
}
verifyPublicationQualification(receipts, source, jobs, held, "mcp-packaged");
const evidence = { schema: "service-lasso.release-qualification.v1", scope, source, run: { id: runId, attempt, workflowSha: source.commit }, platforms: [...REQUIRED_GA_PLATFORMS], receipts, outcome: "success" };
validateTechnicalQualification(evidence, source);
await mkdir("artifacts/scoped-qualification", { recursive: true });
for (const [name, bytes] of held) await writeFile(path.join("artifacts/scoped-qualification", name), bytes, { flag: "wx" });
await writeFile("artifacts/scoped-qualification/qualification.json", `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
