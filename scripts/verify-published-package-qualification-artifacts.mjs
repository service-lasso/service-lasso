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
import { selectCurrentAttemptArtifacts } from "./published-package-qualification-reliability.mjs";

const PLATFORMS = Object.freeze(["linux", "win32", "darwin"]);

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
    { headers: githubHeaders(token), redirect: "error" },
  );
  if (!response.ok) throw new Error("Artifact API readback failed.");
  return response.json();
}

async function readJobApi(repo, runId, runAttempt, token) {
  const response = await fetch(
    `https://api.github.com/repos/${repo}/actions/runs/${runId}/attempts/${runAttempt}/jobs?per_page=100`,
    { headers: githubHeaders(token), redirect: "error" },
  );
  if (!response.ok) throw new Error("Terminal job API readback failed.");
  return response.json();
}

async function readOnlyFile(filePath, label) {
  const info = await lstat(filePath).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink() || info.size <= 0) {
    throw new Error(`${label} is missing, empty, or not a regular file.`);
  }
  return readFile(filePath, "utf8");
}

const repo = env("GITHUB_REPOSITORY", /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u);
const token = env("GITHUB_TOKEN");
const runId = String(requirePositiveInteger(env("GITHUB_RUN_ID", /^[1-9][0-9]*$/u), "GITHUB_RUN_ID"));
const runAttempt = String(
  requirePositiveInteger(env("GITHUB_RUN_ATTEMPT", /^[1-9][0-9]*$/u), "GITHUB_RUN_ATTEMPT"),
);
const workflowSha = requireSha(env("GITHUB_SHA"), "GITHUB_SHA");
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
  darwin: {
    asset: `service-lasso-${coreTag}-darwin.tar.gz`,
    sha256: requireSha256(env("CORE_DARWIN_SHA256"), "CORE_DARWIN_SHA256"),
  },
};

const [apiPayload, jobsPayload] = await Promise.all([
  readArtifactApi(repo, runId, token),
  readJobApi(repo, runId, runAttempt, token),
]);
const artifacts = Array.isArray(apiPayload.artifacts) ? apiPayload.artifacts : [];
const jobs = Array.isArray(jobsPayload.jobs) ? jobsPayload.jobs : [];
const selected = selectCurrentAttemptArtifacts(artifacts, runId, runAttempt);
if (!selected.currentComplete) {
  throw new Error("Artifact API did not return exactly three current-attempt qualification artifacts.");
}

for (const platform of PLATFORMS) {
  const artifactName = `published-package-qualification-${platform}-${runId}-${runAttempt}`;
  const artifact = selected.current.find(({ name }) => name === artifactName);
  validateRetainedArtifactMetadata(artifact, { name: artifactName, repo, runId, workflowSha });

  const artifactDirectory = path.join(artifactsRoot, artifactName);
  const entries = await readdir(artifactDirectory, { withFileTypes: true });
  const expectedFile = `published-package-qualification-${platform}.json`;
  if (entries.length !== 1 || !entries[0].isFile() || entries[0].isSymbolicLink() || entries[0].name !== expectedFile) {
    throw new Error(`Downloaded ${platform} artifact did not contain exactly one metadata evidence file.`);
  }
  const evidence = JSON.parse(
    await readOnlyFile(path.join(artifactDirectory, expectedFile), `${platform} retained evidence`),
  );
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
  validateRetainedEvidence(evidence, {
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
  if (evidence.retentionDays !== RETENTION_DAYS) {
    throw new Error(`${platform} retained evidence did not declare the 90-day policy.`);
  }
}

process.stdout.write("Exact three-platform artifact API readback and retained evidence verified.\n");
