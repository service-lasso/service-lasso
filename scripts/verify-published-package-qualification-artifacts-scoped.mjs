import { assertDevelopIdentity, assertPolicyEnvironment, readSourceScope } from "./ga-platform-scope-lib.mjs";
import { validatePublishedEvidence4 } from "./scoped-release-evidence-lib.mjs";
assertDevelopIdentity(); assertPolicyEnvironment(); await readSourceScope();
import { validInitialProjection } from "./public-first-custody-projection-lib.mjs";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  RETENTION_DAYS,
  requirePattern,
  requirePositiveInteger,
  requireSha,
  requireSha256,
  validateRetainedArtifactMetadata,
  validateRetainedEvidence,
  validateTerminalJobMetadata,
} from "./published-package-qualification-lib.mjs";
import { selectScopedCurrentAttemptArtifacts as selectCurrentAttemptArtifacts } from "./published-package-qualification-reliability.mjs";
import { strictJson } from "./consume-admin-trusted-unlock-receipt.mjs";
import { parsePrebrowserFailure } from "./record-admin-trusted-unlock-prebrowser-failure.mjs";
import { boundedProviderBody } from "./scoped-provider-readback-lib.mjs";
import { parseScopedJson } from "./ga-platform-scope-lib.mjs";

const PLATFORMS = Object.freeze(["win32", "linux"]);

function env(name, pattern = /^.+$/u) {
  return requirePattern(process.env[name], pattern, name);
}

function githubHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "service-lasso-published-package-qualification",
  };
}

async function readArtifactApi(repo, runId, token) {
  const response = await fetch(
    `https://api.github.com/repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`,
    { headers: githubHeaders(token), redirect: "error", signal: AbortSignal.timeout(15_000) },
  );
  if (!response.ok) throw new Error("Artifact API readback failed.");
  return parseScopedJson(await boundedProviderBody(response, 4 * 1024 * 1024));
}

async function readJobApi(repo, runId, runAttempt, token) {
  const response = await fetch(
    `https://api.github.com/repos/${repo}/actions/runs/${runId}/attempts/${runAttempt}/jobs?per_page=100`,
    { headers: githubHeaders(token), redirect: "error", signal: AbortSignal.timeout(15_000) },
  );
  if (!response.ok) throw new Error("Terminal job API readback failed.");
  return parseScopedJson(await boundedProviderBody(response, 4 * 1024 * 1024));
}

async function readOnlyFile(filePath, label) {
  const info = await lstat(filePath).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink() || info.size <= 0) {
    throw new Error(`${label} is missing, empty, or not a regular file.`);
  }
  return readFile(filePath, "utf8");
}

function parseStrictJson(source, label) {
  if (!strictJson(source)) throw new Error(`${label} is malformed or has duplicate keys.`);
  try {
    return JSON.parse(source);
  } catch {
    throw new Error(`${label} is malformed or has duplicate keys.`);
  }
}

function requireTerminalPrebrowserJob(jobs, platform, runId, runAttempt) {
  const name = `published-package-qualification (${platform})`;
  const matches = jobs.filter((job) => job?.name === name);
  if (
    matches.length !== 1 ||
    !Number.isSafeInteger(matches[0]?.id) ||
    matches[0].id <= 0 ||
    String(matches[0]?.run_id) !== runId ||
    String(matches[0]?.run_attempt) !== runAttempt ||
    matches[0]?.status !== "completed" ||
    matches[0]?.conclusion !== "failure"
  ) {
    throw new Error(`${platform} pre-browser failure must bind one matching terminal failed job.`);
  }
}

const repo = env("GITHUB_REPOSITORY", /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u);
const token = env("GITHUB_TOKEN");
const runId = String(requirePositiveInteger(env("GITHUB_RUN_ID", /^[1-9][0-9]*$/u), "GITHUB_RUN_ID"));
const runAttempt = String(
  requirePositiveInteger(env("GITHUB_RUN_ATTEMPT", /^[1-9][0-9]*$/u), "GITHUB_RUN_ATTEMPT"),
);
const workflowSha = requireSha(env("GITHUB_SHA"), "GITHUB_SHA");
if (repo !== "service-lasso/service-lasso" || workflowSha !== process.env.QUALIFICATION_CANDIDATE_SHA) throw new Error("scoped aggregate source identity differs");
const artifactsRoot = path.resolve(env("QUALIFICATION_ARTIFACTS_ROOT"));
const coreReleaseId = env("CORE_RELEASE_ID", /^[1-9][0-9]*$/u);
const coreTag = env("CORE_RELEASE_TAG", /^20[0-9]{2}\.[1-9][0-9]*\.[1-9][0-9]*-[0-9a-f]{7}$/u);
const coreRevision = requireSha(env("CORE_REVISION"), "CORE_REVISION");
const coreNpmVersion = env("CORE_NPM_VERSION", /^20[0-9]{2}\.[1-9][0-9]*\.[1-9][0-9]*-[0-9a-f]{7}$/u);
const coreNpmIntegrity = env("CORE_NPM_INTEGRITY", /^sha512-[A-Za-z0-9+/]+={0,2}$/u);
const coreByPlatform = {
  linux: {
    asset: `service-lasso-${coreTag}-linux.tar.gz`,
    sha256: requireSha256(env("CORE_LINUX_SHA256"), "CORE_LINUX_SHA256"),
  },
  win32: {
    asset: `service-lasso-${coreTag}-win32.zip`,
    sha256: requireSha256(env("CORE_WIN32_SHA256"), "CORE_WIN32_SHA256"),
  },
};

const [apiPayload, jobsPayload] = await Promise.all([
  readArtifactApi(repo, runId, token),
  readJobApi(repo, runId, runAttempt, token),
]);
const artifacts = Array.isArray(apiPayload.artifacts) ? apiPayload.artifacts : [];
const jobs = Array.isArray(jobsPayload.jobs) ? jobsPayload.jobs : [];
if (apiPayload.total_count !== artifacts.length || jobsPayload.total_count !== jobs.length) throw new Error("scoped aggregate provider inventory incomplete");
const runResponse = await fetch(`https://api.github.com/repos/${repo}/actions/runs/${runId}`, { headers: githubHeaders(token), redirect: "error", signal: AbortSignal.timeout(15_000) });
if (!runResponse.ok) throw new Error("scoped aggregate run readback unavailable");
const actualRun = parseScopedJson(await boundedProviderBody(runResponse, 4 * 1024 * 1024));
if (actualRun.head_sha !== workflowSha || String(actualRun.run_attempt) !== runAttempt || actualRun.path !== ".github/workflows/published-package-qualification-scoped.yml") throw new Error("scoped aggregate actual run/attempt/workflow differs");
const selected = selectCurrentAttemptArtifacts(artifacts, runId, runAttempt);
if (!selected.currentComplete) {
  throw new Error("Artifact API did not return exactly two current-attempt qualification artifacts.");
}

for (const platform of PLATFORMS) {
  const artifactName = `published-package-qualification-${platform}-${runId}-${runAttempt}`;
  const artifact = selected.current.find(({ name }) => name === artifactName);
  validateRetainedArtifactMetadata(artifact, { name: artifactName, repo, runId, workflowSha });

  const artifactDirectory = path.join(artifactsRoot, artifactName);
  const entries = await readdir(artifactDirectory, { withFileTypes: true });
  const expectedFile = `published-package-qualification-${platform}.json`;
  const expectedReceipt = "admin-trusted-unlock-receipt.json";
  const initialReceiptName = "initial-projection.json";
  const prebrowserName = "admin-trusted-unlock-prebrowser-failure.json";
  if (entries.length === 2 && entries.every((entry) => entry.isFile() && !entry.isSymbolicLink()) && entries.some((entry) => entry.name === prebrowserName) && entries.some((entry) => entry.name === initialReceiptName)) {
    const initial = parseStrictJson(await readOnlyFile(path.join(artifactDirectory, initialReceiptName), `${platform} initial projection`), `${platform} initial projection`);
    if (!validInitialProjection(initial, platform, runId, runAttempt, workflowSha)) throw new Error(`${platform} initial projection custody is invalid.`);
    const prebrowser = parsePrebrowserFailure(await readOnlyFile(path.join(artifactDirectory, prebrowserName), `${platform} pre-browser failure`));
    if (!prebrowser || prebrowser.platform !== platform || String(prebrowser.run.id) !== runId || String(prebrowser.run.attempt) !== runAttempt) throw new Error(`${platform} pre-browser failure custody is invalid.`);
    requireTerminalPrebrowserJob(jobs, platform, runId, runAttempt);
    throw new Error("Scoped qualification retains classified pre-browser failure; it is never success.");
  }
  if (entries.length !== 3 || entries.some((entry) => !entry.isFile() || entry.isSymbolicLink()) || !entries.some((entry) => entry.name === expectedFile) || !entries.some((entry) => entry.name === expectedReceipt) || !entries.some((entry) => entry.name === initialReceiptName)) {
    throw new Error(`Downloaded ${platform} artifact did not contain its exact metadata evidence and trusted-unlock receipt.`);
  }
  const wrapper = parseStrictJson(
    await readOnlyFile(path.join(artifactDirectory, expectedFile), `${platform} retained evidence`),
    `${platform} retained evidence`,
  );
  const evidence = wrapper.evidence;
  const retainedReceipt = parseStrictJson(
    await readOnlyFile(path.join(artifactDirectory, expectedReceipt), `${platform} retained trusted-unlock receipt`),
    `${platform} retained trusted-unlock receipt`,
  );
  const initial = parseStrictJson(
    await readOnlyFile(path.join(artifactDirectory, initialReceiptName), `${platform} initial projection`),
    `${platform} initial projection`,
  );
  if (!validInitialProjection(initial, platform, runId, runAttempt, workflowSha)) {
    throw new Error(`${platform} initial projection custody is invalid.`);
  }
  const jobName = `published-package-qualification (${platform})`;
  const matchingJobs = jobs.filter(({ name }) => name === jobName);
  if (matchingJobs.length !== 1) throw new Error(`Terminal job API identity for ${platform} is not unique.`);
  validateTerminalJobMetadata(matchingJobs[0], {
    name: jobName,
    repo,
    jobId: evidence.run?.jobId,
    runId,
    runAttempt,
    workflowSha,
  });
  validatePublishedEvidence4(wrapper, {
    initialProjection: initial,
    platform,
    runId,
    runAttempt,
    workflowSha,
    coreReleaseId,
    coreTag,
    coreRevision,
    coreAsset: coreByPlatform[platform].asset,
    coreSha256: coreByPlatform[platform].sha256,
    coreNpmVersion,
    coreNpmIntegrity,
  });
  if (JSON.stringify(retainedReceipt) !== JSON.stringify(evidence.adminTrustedUnlockReceipt)) {
    throw new Error(`${platform} retained trusted-unlock receipt does not match terminal evidence.`);
  }
  if (evidence.retentionDays !== RETENTION_DAYS) {
    throw new Error(`${platform} retained evidence did not declare the 90-day policy.`);
  }
}

process.stdout.write("Exact two-platform artifact API readback and retained evidence verified.\n");
