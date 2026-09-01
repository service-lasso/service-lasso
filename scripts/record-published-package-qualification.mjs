import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  ADMIN_HARNESS_REVISION,
  ADMIN_RELEASE,
  BROKER_RELEASE,
  PACKAGE_NAME,
  QUALIFICATION_SCHEMA,
  RETENTION_DAYS,
  assertMetadataOnlyEvidence,
  requirePattern,
  requirePositiveInteger,
  requireSha,
  requireSha256,
} from "./published-package-qualification-lib.mjs";

function env(name, pattern = /^.*$/u) {
  return requirePattern(process.env[name], pattern, name);
}

async function findCurrentJobId({ repo, runId, runAttempt, jobName, token }) {
  const response = await fetch(
    `https://api.github.com/repos/${repo}/actions/runs/${runId}/attempts/${runAttempt}/jobs?per_page=100`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "service-lasso-published-package-qualification",
      },
    },
  );
  if (!response.ok) throw new Error("Current job API readback failed.");
  const payload = await response.json();
  const matches = (payload.jobs ?? []).filter((job) => job.name === jobName);
  if (matches.length !== 1 || !Number.isSafeInteger(matches[0].id) || matches[0].id <= 0) {
    throw new Error("Current job API identity was not unique.");
  }
  return matches[0].id;
}

const platform = env("QUALIFICATION_PLATFORM", /^(?:win32|linux|darwin)$/u);
const safeStatePath = path.resolve(env("QUALIFICATION_SAFE_STATE_PATH", /^.+$/u));
const evidenceRoot = path.resolve(env("QUALIFICATION_EVIDENCE_ROOT", /^.+$/u));
const repo = env("GITHUB_REPOSITORY", /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u);
const token = env("GITHUB_TOKEN", /^.+$/u);
const runId = String(requirePositiveInteger(env("GITHUB_RUN_ID", /^[1-9][0-9]*$/u), "GITHUB_RUN_ID"));
const runAttempt = String(
  requirePositiveInteger(env("GITHUB_RUN_ATTEMPT", /^[1-9][0-9]*$/u), "GITHUB_RUN_ATTEMPT"),
);
const workflowSha = requireSha(env("GITHUB_SHA"), "GITHUB_SHA");
const coreReleaseId = env("CORE_RELEASE_ID", /^[1-9][0-9]*$/u);
const coreTag = env("CORE_RELEASE_TAG", /^20[0-9]{2}\.[1-9][0-9]*\.[1-9][0-9]*-[0-9a-f]{7}$/u);
const coreRevision = requireSha(env("CORE_REVISION"), "CORE_REVISION");
const coreAsset = env(
  "CORE_RELEASE_ASSET",
  /^service-lasso-20[0-9]{2}\.[1-9][0-9]*\.[1-9][0-9]*-[0-9a-f]{7}-(?:win32\.zip|linux\.tar\.gz|darwin\.tar\.gz)$/u,
);
const coreSha256 = requireSha256(env("CORE_RELEASE_SHA256"), "CORE_RELEASE_SHA256");
const coreNpmVersion = env("CORE_NPM_VERSION", /^20[0-9]{2}\.[1-9][0-9]*\.[1-9][0-9]*-[0-9a-f]{7}$/u);
const coreNpmIntegrity = env("CORE_NPM_INTEGRITY", /^sha512-[A-Za-z0-9+/]+={0,2}$/u);
const adminHarnessRevision = requireSha(
  env("ADMIN_HARNESS_REVISION"),
  "ADMIN_HARNESS_REVISION",
);
if (adminHarnessRevision !== ADMIN_HARNESS_REVISION) {
  throw new Error("Admin browser harness revision is not canonical.");
}

let evidence;
try {
  evidence = JSON.parse(await readFile(safeStatePath, "utf8"));
} catch {
  evidence = {
    schema: QUALIFICATION_SCHEMA,
    retainedContent: "metadata_only",
    outcome: "failure",
    platform,
    core: {
      releaseId: coreReleaseId,
      tag: coreTag,
      revision: coreRevision,
      asset: coreAsset,
      sha256: coreSha256,
      npm: { name: PACKAGE_NAME, version: coreNpmVersion, integrity: coreNpmIntegrity, distTag: "latest" },
    },
    admin: {
      releaseId: ADMIN_RELEASE.id,
      tag: ADMIN_RELEASE.tag,
      revision: ADMIN_RELEASE.revision,
      asset: ADMIN_RELEASE.platforms[platform].asset,
      sha256: ADMIN_RELEASE.platforms[platform].sha256,
      checksumSource: "SHA256SUMS.txt",
    },
    broker: {
      releaseId: BROKER_RELEASE.id,
      tag: BROKER_RELEASE.tag,
      revision: BROKER_RELEASE.revision,
      asset: BROKER_RELEASE.platforms[platform].asset,
      sha256: BROKER_RELEASE.platforms[platform].sha256,
      checksumSource: "SHA256SUMS.txt",
    },
    adminHarnessRevision,
    harnessRevision: workflowSha,
    retentionDays: RETENTION_DAYS,
    mutationRetry: false,
    failureCode: "preparation_state_missing",
    negativeProof: {},
    scenarios: {},
  };
}

let jobId = 0;
try {
  jobId = await findCurrentJobId({
    repo,
    runId,
    runAttempt,
    jobName: env("QUALIFICATION_JOB_NAME", /^published-package-qualification \((?:win32|linux|darwin)\)$/u),
    token,
  });
} catch {
  evidence.failureCode = "job_api_readback_failed";
}

evidence.run = {
  id: Number(runId),
  attempt: Number(runAttempt),
  jobId,
  workflowSha,
};
evidence.scenarios ??= {};
evidence.scenarios.firstRun = process.env.QUALIFICATION_FIRST_RUN === "success" ? "success" : "blocked";
const lifecycleOutcome = process.env.QUALIFICATION_LIFECYCLE === "success" ? "success" : "blocked";
for (const scenario of [
  "comprehensiveLifecycle",
  "adminBrowser",
  "runtimeDashboardServices",
  "brokerContinuity",
  "trustedLifecycle",
  "providerReadiness",
  "migrationDryRun",
  "migrationApply",
  "rollback",
  "persistence",
  "durableAudit",
  "noLeak",
]) {
  evidence.scenarios[scenario] = lifecycleOutcome;
}
evidence.scenarios.stoppedLifecycle =
  process.env.QUALIFICATION_STOPPED_LIFECYCLE === "success" ? "success" : "blocked";
if (platform === "win32") {
  evidence.scenarios.localOperatorLockout =
    process.env.QUALIFICATION_LOCKOUT === "success" ? "success" : "blocked";
}
evidence.mutations = {
  brokerRestart: process.env.QUALIFICATION_LIFECYCLE === "success" ? 1 : 0,
  providerMigrationApply: process.env.QUALIFICATION_LIFECYCLE === "success" ? 1 : 0,
};

const requiredScenarios = [
  "preMutationGuards",
  "releaseRuntime",
  "npmConsumer",
  "productionAcquisition",
  "firstRun",
  "comprehensiveLifecycle",
  "adminBrowser",
  "runtimeDashboardServices",
  "brokerContinuity",
  "trustedLifecycle",
  "providerReadiness",
  "migrationDryRun",
  "migrationApply",
  "rollback",
  "persistence",
  "durableAudit",
  "noLeak",
  "stoppedLifecycle",
  "cleanupConvergence",
];
if (platform === "win32") requiredScenarios.push("localOperatorLockout");
const stepsSucceeded =
  process.env.PREPARE_OUTCOME === "success" &&
  process.env.QUALIFICATION_OUTCOME === "success" &&
  process.env.CLEANUP_OUTCOME === "success";
const scenariosSucceeded = requiredScenarios.every((name) => evidence.scenarios[name] === "success");
evidence.outcome = stepsSucceeded && scenariosSucceeded && jobId > 0 ? "success" : "failure";
if (evidence.outcome === "success") evidence.failureCode = null;
else evidence.failureCode ??= "qualification_incomplete";

try {
  assertMetadataOnlyEvidence(evidence);
} catch {
  evidence = {
    schema: QUALIFICATION_SCHEMA,
    retainedContent: "metadata_only",
    outcome: "failure",
    platform,
    run: { id: Number(runId), attempt: Number(runAttempt), jobId, workflowSha },
    core: {
      releaseId: coreReleaseId,
      tag: coreTag,
      revision: coreRevision,
      asset: coreAsset,
      sha256: coreSha256,
      npm: { name: PACKAGE_NAME, version: coreNpmVersion, integrity: coreNpmIntegrity, distTag: "latest" },
    },
    admin: {
      releaseId: ADMIN_RELEASE.id,
      tag: ADMIN_RELEASE.tag,
      revision: ADMIN_RELEASE.revision,
      asset: ADMIN_RELEASE.platforms[platform].asset,
      sha256: ADMIN_RELEASE.platforms[platform].sha256,
      checksumSource: "SHA256SUMS.txt",
    },
    broker: {
      releaseId: BROKER_RELEASE.id,
      tag: BROKER_RELEASE.tag,
      revision: BROKER_RELEASE.revision,
      asset: BROKER_RELEASE.platforms[platform].asset,
      sha256: BROKER_RELEASE.platforms[platform].sha256,
      checksumSource: "SHA256SUMS.txt",
    },
    adminHarnessRevision,
    retentionDays: RETENTION_DAYS,
    mutationRetry: false,
    failureCode: "unsafe_evidence_rejected",
    scenarios: {},
  };
}

await mkdir(evidenceRoot, { recursive: true });
await writeFile(
  path.join(evidenceRoot, `published-package-qualification-${platform}.json`),
  `${JSON.stringify(evidence, null, 2)}\n`,
);
