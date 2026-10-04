import { readOriginalMetadataArtifact } from "./scoped-metadata-artifact-lib.mjs";
import { assertSource, digest, parseScopedJson } from "./ga-platform-scope-lib.mjs";
import { assertNames, validateTechnicalQualification } from "./scoped-release-evidence-lib.mjs";
import { verifyPublicationQualification } from "./scoped-publication-lib.mjs";
import { validateRetainedArtifactMetadata, validateTerminalJobMetadata } from "./published-package-qualification-lib.mjs";

// The source-selected scoped workflow is the only current technical authority.
// A legacy check with the same context, or an older passing attempt/run, cannot
// substitute for the latest actual scoped run on this exact candidate.
export async function requireScopedTechnicalAuthority({ source, readMetadata, readArtifact }) {
  const repo = "service-lasso/service-lasso", file = "release-qualification-scoped.yml";
  assertSource(source, { repository: repo, commit: source.commit, ref: "refs/heads/develop" });
  const workflow = await readMetadata(`/repos/${repo}/actions/workflows/${file}`);
  if (!Number.isSafeInteger(workflow.id) || workflow.id < 1 || workflow.path !== `.github/workflows/${file}` || workflow.state !== "active") throw new Error("scoped technical authority workflow differs");
  const response = await readMetadata(`/repos/${repo}/actions/workflows/${file}/runs?head_sha=${source.commit}&per_page=100`);
  if (response.total_count !== response.workflow_runs?.length || response.workflow_runs.length === 0) throw new Error("complete scoped technical run inventory absent");
  for (const row of response.workflow_runs) if (!Number.isSafeInteger(row.id) || row.id < 1 || row.head_sha !== source.commit || row.workflow_id !== workflow.id || row.path !== workflow.path) throw new Error("scoped technical run source differs");
  const selected = [...response.workflow_runs].sort((a, b) => b.id - a.id)[0];
  const run = await readMetadata(`/repos/${repo}/actions/runs/${selected.id}`);
  if (run.id !== selected.id || run.workflow_id !== workflow.id || run.path !== workflow.path || run.head_sha !== source.commit || run.head_branch !== "develop" || run.event !== "workflow_dispatch" || !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1 || run.status !== "completed" || run.conclusion !== "success") throw new Error("latest exact scoped technical run is not terminal success");
  const [jobResponse, artifacts, checks] = await Promise.all([
    readMetadata(`/repos/${repo}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`),
    readMetadata(`/repos/${repo}/actions/runs/${run.id}/artifacts?per_page=100`),
    readMetadata(`/repos/${repo}/commits/${source.commit}/check-runs?per_page=100`),
  ]);
  if (jobResponse.total_count !== jobResponse.jobs?.length || artifacts.total_count !== artifacts.artifacts?.length || checks.total_count !== checks.check_runs?.length) throw new Error("scoped technical provider inventory incomplete");
  const terminal = jobResponse.jobs.filter(job => job.name === "qualify-release");
  if (terminal.length !== 1) throw new Error("scoped technical terminal context absent/duplicate");
  validateTerminalJobMetadata(terminal[0], { repo, name: "qualify-release", jobId: terminal[0].id, runId: run.id, runAttempt: run.run_attempt, workflowSha: source.commit });
  const actual = checks.check_runs.filter(check => check.id === terminal[0].id);
  if (actual.length !== 1 || actual[0].name !== "qualify-release" || actual[0].app?.id !== 15368 || actual[0].head_sha !== source.commit || actual[0].status !== "completed" || actual[0].conclusion !== "success" || actual[0].html_url !== terminal[0].html_url) throw new Error("same-candidate qualify-release app15368 binding differs");
  const prefix = "scoped-release-qualification-";
  const retained = artifacts.artifacts.filter(row => row.name?.startsWith(prefix));
  const currentName = `${prefix}${run.id}-${run.run_attempt}`;
  for (const row of retained) {
    const match = /^scoped-release-qualification-([1-9][0-9]*)-([1-9][0-9]*)$/u.exec(row.name);
    if (!match || Number(match[1]) !== run.id || Number(match[2]) > run.run_attempt) throw new Error("scoped technical artifact selector differs/future");
  }
  const current = retained.filter(row => row.name === currentName);
  if (current.length !== 1) throw new Error("scoped technical current aggregate absent/duplicate");
  validateRetainedArtifactMetadata(current[0], { repo, name: currentName, runId: run.id, workflowSha: source.commit });
  const original = await readArtifact(current[0].archive_download_url);
  if (!Buffer.isBuffer(original) || current[0].digest !== `sha256:${digest(original)}`) throw new Error("scoped technical original aggregate body differs");
  const held = readOriginalMetadataArtifact(original, ["qualification.json", "mcp-product-win32.json", "mcp-product-linux.json"], current[0].digest);
  const evidence = validateTechnicalQualification(parseScopedJson(held.get("qualification.json")), source);
  if (evidence.run.id !== run.id || evidence.run.attempt !== run.run_attempt) throw new Error("scoped technical wrapper actual run differs");
  held.delete("qualification.json");
  verifyPublicationQualification(evidence.receipts, source, jobResponse.jobs, held, "mcp-packaged");
  return { evidence, artifactId: current[0].id, artifactSha256: digest(original), terminalJobId: terminal[0].id };
}
