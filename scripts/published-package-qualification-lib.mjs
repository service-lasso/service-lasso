import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, stat } from "node:fs/promises";
import path from "node:path";

export const QUALIFICATION_SCHEMA =
  "service-lasso.published-package-qualification.v1";
export const RETENTION_DAYS = 90;
export const PACKAGE_NAME = "@service-lasso/service-lasso";
export const ADMIN_HARNESS_REVISION =
  "f7abf981f8f0bbbbd7fdf352237fd84950d95ca3";

export const ADMIN_RELEASE = Object.freeze({
  repo: "service-lasso/lasso-serviceadmin",
  id: "380051618",
  tag: "2026.8.31-f015b44",
  revision: "f015b4445b0526546a309301270186a697588166",
  manifestSha256:
    "ccd0bd85cde734c1699294a821e381924726a735133c7009b35d49cd27f5f47a",
  checksumSha256:
    "5bb6911dde9c9cadda9b7c703de7736791c073ca6c2f7ab4340d2342b4c0e4c7",
  platforms: Object.freeze({
    win32: Object.freeze({
      asset: "@serviceadmin-win32.zip",
      sbom: "serviceadmin-win32.cdx.json",
      sha256:
        "fe5e5fe01d1202f3874097e6223652d634c94677c765c5f82d20e6d274c0161c",
      sbomSha256:
        "2b31de0f3113da920b55215d8bcd217a6d13f34164b406ab3e3930da3bf0ca97",
    }),
    linux: Object.freeze({
      asset: "@serviceadmin-linux.tar.gz",
      sbom: "serviceadmin-linux.cdx.json",
      sha256:
        "8f80b124967fa1e0efe9fa4c6c0d3aaa9f4f64ffdd15d1180359d2c6185d3e71",
      sbomSha256:
        "5f9109a5ce15f244efae2bef937005bf9ec79474ce2de17280fbaac58c5e830a",
    }),
    darwin: Object.freeze({
      asset: "@serviceadmin-darwin.tar.gz",
      sbom: "serviceadmin-darwin.cdx.json",
      sha256:
        "2b5cdd80861819a7eb6f92ed5743c208baae8b35e7f4232fd3df928f34bfcb81",
      sbomSha256:
        "cb37461f20f0a8174f7ce52c642f6252778861c12dfc3323fb5a88692181cc21",
    }),
  }),
});

export const BROKER_RELEASE = Object.freeze({
  repo: "service-lasso/lasso-secretsbroker",
  id: "379635299",
  tag: "2026.8.31-f340883",
  revision: "f340883056ec3cf74b535fb46490b39382e8c823",
  manifestSha256:
    "c738056d2a0afd1b1ff40bb2f0ed33fbee0ed4fa39b3903472acb4391167bd09",
  checksumSha256:
    "7dbbddee869ae7b8ce9b795d6822a0c6dfb3642006ade213561fcb604f8b76dd",
  platforms: Object.freeze({
    win32: Object.freeze({
      asset: "secretsbroker-win32.zip",
      sbom: "secretsbroker-win32.cdx.json",
      binary: "secretsbroker.exe",
      sha256:
        "e64ee6a85c053c6dd68e2713477dae0620a458496bbd41077b55cc4c2df3f966",
      sbomSha256:
        "8a24cf1f0304a300632b644aff7d9609fcf507ca538484ebe24f6496703722c2",
    }),
    linux: Object.freeze({
      asset: "secretsbroker-linux.tar.gz",
      sbom: "secretsbroker-linux.cdx.json",
      binary: "secretsbroker",
      sha256:
        "3466c9adf01d14b202fd084705bfda11fef627206587a0ad1f62dbb6a6a4f295",
      sbomSha256:
        "53a5cf142d2c31b04739b07c15e07c43ca118b786cf70888a01ca0df98c5b7f3",
    }),
    darwin: Object.freeze({
      asset: "secretsbroker-darwin.tar.gz",
      sbom: "secretsbroker-darwin.cdx.json",
      binary: "secretsbroker",
      sha256:
        "567b40bbd42881c5a4e12c2b8984ece9b5225d221ecf2d776fb541e330365ce5",
      sbomSha256:
        "3ce84fb0d59cc1c584b3844d7d3d0094b4a08d78e79864a690f11a698015782a",
    }),
  }),
});

export const CORE_HARNESS_FILES = Object.freeze([
  "tests/fixtures/real-admin-browser-runner.mjs",
  "tests/fixtures/real-admin-browser-certificate.mjs",
  "tests/fixtures/real-admin-browser-lockout.mjs",
  "tests/fixtures/real-admin-browser-rollback.mjs",
  "tests/fixtures/real-admin-browser-shutdown.mjs",
  "tests/test-helpers.js",
]);

export class QualificationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "QualificationError";
    this.code = code;
  }
}

export function fail(code, message) {
  throw new QualificationError(code, message);
}

export function parseCoreInstallOutput(value, serviceId) {
  try {
    const payload = JSON.parse(String(value ?? "").trim());
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new TypeError("Core install output is not an object.");
    }
    return payload;
  } catch {
    fail(
      "core_install_contract_invalid",
      `Published Core install did not return JSON for ${serviceId}.`,
    );
  }
}

export function requirePattern(value, pattern, label, code = "invalid_input") {
  const normalized = String(value ?? "").trim();
  if (!pattern.test(normalized)) {
    fail(code, `${label} is invalid.`);
  }
  return normalized;
}

export function requireSha(value, label) {
  return requirePattern(value, /^[0-9a-f]{40}$/u, label, "invalid_revision");
}

export function requireSha256(value, label) {
  return requirePattern(value, /^[0-9a-f]{64}$/u, label, "invalid_digest");
}

export function requirePositiveInteger(value, label) {
  const normalized = requirePattern(
    value,
    /^[1-9][0-9]*$/u,
    label,
    "invalid_id",
  );
  return Number(normalized);
}

export function coreReleaseAssets(tag) {
  const bounded = `service-lasso-${tag}`;
  const bundled = `service-lasso-bundled-${tag}`;
  const archives = [
    `${bounded}.tar.gz`,
    `${bundled}.tar.gz`,
    `${bounded}-win32.zip`,
    `${bounded}-linux.tar.gz`,
    `${bounded}-darwin.tar.gz`,
    `${bundled}-win32.zip`,
    `${bundled}-linux.tar.gz`,
    `${bundled}-darwin.tar.gz`,
  ];
  return [
    ...archives,
    ...archives.map((name) => `${name}.cdx.json`),
    "SHA256SUMS.txt",
  ];
}

export function releaseServiceAssets(release) {
  return [
    ...Object.values(release.platforms).flatMap(({ asset, sbom }) => [
      asset,
      sbom,
    ]),
    "service.json",
    "SHA256SUMS.txt",
  ];
}

export function parseGithubDigest(value, label) {
  const match = /^sha256:([0-9a-f]{64})$/u.exec(String(value ?? "").trim());
  if (!match) {
    fail(
      "missing_release_digest",
      `${label} did not expose an exact SHA-256 digest.`,
    );
  }
  return match[1];
}

function assertAssetUrls(asset, repo, tag) {
  const apiUrl = `https://api.github.com/repos/${repo}/releases/assets/${asset.id}`;
  if (asset.url !== apiUrl) {
    fail(
      "redirected_asset_metadata",
      `Release asset ${asset.name} API identity is not canonical.`,
    );
  }

  let browserUrl;
  try {
    browserUrl = new URL(asset.browser_download_url);
  } catch {
    fail(
      "redirected_asset_metadata",
      `Release asset ${asset.name} download identity is invalid.`,
    );
  }
  const expectedPath = `/${repo}/releases/download/${tag}/${asset.name}`;
  if (
    browserUrl.protocol !== "https:" ||
    browserUrl.hostname !== "github.com" ||
    decodeURIComponent(browserUrl.pathname) !== expectedPath
  ) {
    fail(
      "redirected_asset_metadata",
      `Release asset ${asset.name} download identity is not canonical.`,
    );
  }
}

export function validateRelease(release, expected, expectedAssetNames) {
  if (String(release?.id ?? "") !== String(expected.id)) {
    fail(
      "release_id_mismatch",
      `Release ${expected.repo} did not match the expected release ID.`,
    );
  }
  if (release.tag_name !== expected.tag || release.name !== expected.tag) {
    fail(
      "release_tag_mismatch",
      `Release ${expected.repo} did not match the expected tag.`,
    );
  }
  if (release.target_commitish !== expected.revision) {
    fail(
      "release_revision_mismatch",
      `Release ${expected.repo} did not target the expected revision.`,
    );
  }
  if (release.draft === true || release.prerelease === true) {
    fail(
      "release_not_final",
      `Release ${expected.repo} is not a final published release.`,
    );
  }

  const assets = Array.isArray(release.assets) ? release.assets : [];
  const names = assets.map((asset) => asset?.name);
  const expectedNames = [...expectedAssetNames].sort();
  const observedNames = [...names].sort();
  if (JSON.stringify(observedNames) !== JSON.stringify(expectedNames)) {
    fail(
      "release_asset_inventory_mismatch",
      `Release ${expected.repo} asset inventory is not exact.`,
    );
  }
  if (new Set(names).size !== names.length) {
    fail(
      "duplicate_release_asset",
      `Release ${expected.repo} contains duplicate asset names.`,
    );
  }

  const byName = new Map();
  for (const asset of assets) {
    if (
      !Number.isSafeInteger(asset.id) ||
      asset.id <= 0 ||
      !Number.isSafeInteger(asset.size) ||
      asset.size <= 0
    ) {
      fail(
        "invalid_release_asset",
        `Release asset ${asset?.name ?? "unknown"} is empty or invalid.`,
      );
    }
    if (asset.state !== "uploaded") {
      fail(
        "invalid_release_asset",
        `Release asset ${asset.name} is not terminally uploaded.`,
      );
    }
    assertAssetUrls(asset, expected.repo, expected.tag);
    parseGithubDigest(asset.digest, `${expected.repo}/${asset.name}`);
    byName.set(asset.name, asset);
  }
  return byName;
}

export function requireAssetDigest(asset, expectedSha256, label) {
  const expected = requireSha256(expectedSha256, `${label} expected SHA-256`);
  const observed = parseGithubDigest(asset?.digest, label);
  if (observed !== expected) {
    fail(
      "release_digest_mismatch",
      `${label} API digest did not match the handed-off digest.`,
    );
  }
  return observed;
}

export function parseChecksumManifest(content, expectedNames) {
  const entries = new Map();
  const expected = new Set(expectedNames);
  const lines = String(content ?? "")
    .split(/\r?\n/u)
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    fail("empty_checksum_manifest", "Checksum manifest is empty.");
  }

  for (const line of lines) {
    const match = /^([0-9a-fA-F]{64})[ \t]+(?:\*)?([^\s].*)$/u.exec(line);
    if (!match) {
      fail(
        "malformed_checksum_manifest",
        "Checksum manifest contains a malformed entry.",
      );
    }
    const digest = match[1].toLowerCase();
    const name = match[2];
    if (
      name !== path.basename(name) ||
      name.includes("\\") ||
      name.includes("/")
    ) {
      fail(
        "redirected_checksum_entry",
        "Checksum manifest contains a redirected filename.",
      );
    }
    if (!expected.has(name)) {
      fail(
        "unexpected_checksum_entry",
        `Checksum manifest contains unexpected asset ${name}.`,
      );
    }
    if (entries.has(name)) {
      fail(
        "duplicate_checksum_entry",
        `Checksum manifest contains duplicate asset ${name}.`,
      );
    }
    entries.set(name, digest);
  }

  for (const name of expected) {
    if (!entries.has(name)) {
      fail(
        "missing_checksum_entry",
        `Checksum manifest is missing asset ${name}.`,
      );
    }
  }
  if (entries.size !== expected.size) {
    fail(
      "checksum_inventory_mismatch",
      "Checksum manifest inventory is not exact.",
    );
  }
  return entries;
}

export async function digestFile(
  filePath,
  algorithm = "sha256",
  encoding = "hex",
) {
  const hash = createHash(algorithm);
  await new Promise((resolve, reject) => {
    const input = createReadStream(filePath);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("error", reject);
    input.on("end", resolve);
  });
  return hash.digest(encoding);
}

export async function verifyFileSha256(filePath, expectedSha256, label) {
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile() || info.size <= 0) {
    fail("empty_download", `${label} download is missing or empty.`);
  }
  const expected = requireSha256(expectedSha256, `${label} expected SHA-256`);
  const actual = await digestFile(filePath, "sha256", "hex");
  if (actual !== expected) {
    fail(
      "download_digest_mismatch",
      `${label} download did not match its expected SHA-256.`,
    );
  }
  return { sha256: actual, size: info.size };
}

export function parseSha512Integrity(value) {
  const match = /^sha512-([A-Za-z0-9+/]+={0,2})$/u.exec(
    String(value ?? "").trim(),
  );
  if (!match) {
    fail(
      "invalid_npm_integrity",
      "npm package integrity is not exact SHA-512 SRI.",
    );
  }
  return match[1];
}

export function validateNpmMetadata(
  versionMetadata,
  distTags,
  expectedVersion,
  expectedIntegrity,
) {
  if (
    versionMetadata?.name !== PACKAGE_NAME ||
    versionMetadata?.version !== expectedVersion
  ) {
    fail(
      "npm_identity_mismatch",
      "npm package identity did not match the expected package and version.",
    );
  }
  if (distTags?.latest !== expectedVersion) {
    fail(
      "npm_latest_mismatch",
      "npm latest did not match the exact published Core version.",
    );
  }
  if (versionMetadata?.dist?.integrity !== expectedIntegrity) {
    fail(
      "npm_integrity_mismatch",
      "npm registry integrity did not match the handed-off integrity.",
    );
  }
  parseSha512Integrity(expectedIntegrity);

  let tarball;
  try {
    tarball = new URL(versionMetadata.dist.tarball);
  } catch {
    fail("npm_tarball_redirected", "npm tarball URL is invalid.");
  }
  if (
    tarball.protocol !== "https:" ||
    tarball.hostname !== "registry.npmjs.org"
  ) {
    fail(
      "npm_tarball_redirected",
      "npm tarball URL is not bound to the public npm registry.",
    );
  }
  return tarball.href;
}

export async function verifyNpmTarballIntegrity(filePath, expectedIntegrity) {
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile() || info.size <= 0) {
    fail("empty_npm_tarball", "npm tarball download is missing or empty.");
  }
  const expectedBase64 = parseSha512Integrity(expectedIntegrity);
  const actualBase64 = await digestFile(filePath, "sha512", "base64");
  if (actualBase64 !== expectedBase64) {
    fail(
      "npm_tarball_integrity_mismatch",
      "npm tarball bytes did not match registry integrity.",
    );
  }
  return { integrity: `sha512-${actualBase64}`, size: info.size };
}

export async function requireRegularFile(filePath, label) {
  const info = await lstat(filePath).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) {
    fail("unsafe_extracted_entry", `${label} is not a regular extracted file.`);
  }
  return filePath;
}

export async function readJsonFile(filePath, label) {
  await requireRegularFile(filePath, label);
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    fail("invalid_json", `${label} is not valid JSON.`);
  }
}

export function safeFailureCode(error) {
  if (
    error instanceof QualificationError &&
    /^[a-z0-9_]{1,64}$/u.test(error.code)
  ) {
    return error.code;
  }
  return "qualification_failed";
}

export function validateRetainedArtifactMetadata(
  artifact,
  expected,
  now = Date.now(),
) {
  const createdAt = Date.parse(artifact?.created_at);
  const updatedAt = Date.parse(artifact?.updated_at);
  const expiresAt = Date.parse(artifact?.expires_at);
  const retainedMilliseconds = expiresAt - createdAt;
  if (
    artifact?.name !== expected.name ||
    !Number.isSafeInteger(artifact?.id) ||
    artifact.id <= 0 ||
    !Number.isSafeInteger(artifact?.size_in_bytes) ||
    artifact.size_in_bytes <= 0 ||
    artifact.expired !== false ||
    !Number.isFinite(createdAt) ||
    !Number.isFinite(updatedAt) ||
    !Number.isFinite(expiresAt) ||
    updatedAt < createdAt ||
    updatedAt > now + 5 * 60 * 1000 ||
    expiresAt <= updatedAt ||
    expiresAt <= now ||
    retainedMilliseconds < 89 * 24 * 60 * 60 * 1000 ||
    retainedMilliseconds > 91 * 24 * 60 * 60 * 1000 ||
    String(artifact.workflow_run?.id) !== String(expected.runId) ||
    artifact.workflow_run?.head_sha !== expected.workflowSha ||
    artifact.archive_download_url !==
      `https://api.github.com/repos/${expected.repo}/actions/artifacts/${artifact.id}/zip`
  ) {
    fail(
      "invalid_retained_artifact",
      "Retained artifact is missing, empty, expired, wrong-head, or outside policy.",
    );
  }
  return artifact;
}

export function validateTerminalJobMetadata(job, expected) {
  if (
    job?.name !== expected.name ||
    job?.id !== expected.jobId ||
    String(job?.run_id) !== String(expected.runId) ||
    String(job?.run_attempt) !== String(expected.runAttempt) ||
    job?.head_sha !== expected.workflowSha ||
    job?.status !== "completed" ||
    job?.conclusion !== "success" ||
    job?.url !==
      `https://api.github.com/repos/${expected.repo}/actions/jobs/${job.id}` ||
    job?.run_url !==
      `https://api.github.com/repos/${expected.repo}/actions/runs/${expected.runId}` ||
    job?.html_url !==
      `https://github.com/${expected.repo}/actions/runs/${expected.runId}/job/${job.id}`
  ) {
    fail(
      "invalid_terminal_job",
      "Terminal job is missing, non-green, or wrong-head.",
    );
  }
  return job;
}

const FORBIDDEN_EVIDENCE_KEY =
  /(path|url|token|secret|credential|command|args|claim|environment|store|vault|ipc|endpoint|host|port)/iu;

export function assertMetadataOnlyEvidence(value, trail = "evidence") {
  if (
    value === null ||
    ["string", "number", "boolean"].includes(typeof value)
  ) {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertMetadataOnlyEvidence(entry, `${trail}[${index}]`),
    );
    return;
  }
  if (typeof value !== "object") {
    fail("unsafe_evidence", `${trail} contains an unsupported value.`);
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_EVIDENCE_KEY.test(key)) {
      fail("unsafe_evidence", `${trail} contains forbidden field ${key}.`);
    }
    assertMetadataOnlyEvidence(child, `${trail}.${key}`);
  }
}

export function validateRetainedEvidence(evidence, expected) {
  assertMetadataOnlyEvidence(evidence);
  if (
    evidence?.schema !== QUALIFICATION_SCHEMA ||
    evidence?.retainedContent !== "metadata_only"
  ) {
    fail("invalid_evidence_schema", "Retained evidence schema is invalid.");
  }
  if (
    evidence.outcome !== "success" ||
    evidence.platform !== expected.platform
  ) {
    fail(
      "qualification_not_successful",
      `Retained ${expected.platform} outcome is not successful.`,
    );
  }
  if (
    String(evidence.run?.id) !== String(expected.runId) ||
    String(evidence.run?.attempt) !== String(expected.runAttempt) ||
    !Number.isSafeInteger(evidence.run?.jobId) ||
    evidence.run.jobId <= 0 ||
    evidence.run?.workflowSha !== expected.workflowSha
  ) {
    fail(
      "evidence_run_mismatch",
      `Retained ${expected.platform} run identity is invalid.`,
    );
  }
  if (
    String(evidence.core?.releaseId) !== String(expected.coreReleaseId) ||
    evidence.core?.tag !== expected.coreTag ||
    evidence.core?.revision !== expected.coreRevision ||
    evidence.core?.asset !== expected.coreAsset ||
    evidence.core?.sha256 !== expected.coreSha256 ||
    evidence.core?.npm?.name !== PACKAGE_NAME ||
    evidence.core?.npm?.version !== expected.coreNpmVersion ||
    evidence.core?.npm?.integrity !== expected.coreNpmIntegrity ||
    evidence.core?.npm?.distTag !== "latest"
  ) {
    fail(
      "evidence_core_mismatch",
      `Retained ${expected.platform} Core identity is invalid.`,
    );
  }
  for (const [name, release] of [
    ["admin", ADMIN_RELEASE],
    ["broker", BROKER_RELEASE],
  ]) {
    const observed = evidence[name];
    const platform = release.platforms[expected.platform];
    if (
      String(observed?.releaseId) !== release.id ||
      observed?.tag !== release.tag ||
      observed?.revision !== release.revision ||
      observed?.asset !== platform.asset ||
      observed?.sha256 !== platform.sha256 ||
      observed?.checksumSource !== "SHA256SUMS.txt"
    ) {
      fail(
        "evidence_dependency_mismatch",
        `Retained ${expected.platform} ${name} identity is invalid.`,
      );
    }
  }
  if (evidence.adminHarnessRevision !== ADMIN_HARNESS_REVISION) {
    fail(
      "evidence_admin_harness_mismatch",
      `Retained ${expected.platform} Admin harness identity is invalid.`,
    );
  }
  if (
    evidence.retentionDays !== RETENTION_DAYS ||
    evidence.mutationRetry !== false
  ) {
    fail(
      "evidence_policy_mismatch",
      `Retained ${expected.platform} policy evidence is invalid.`,
    );
  }
  if (evidence.acquisitionRetry !== true && evidence.acquisitionRetry !== false) {
    fail(
      "evidence_policy_mismatch",
      `Retained ${expected.platform} acquisition-retry evidence is invalid.`,
    );
  }
  if (evidence.startupRetry !== true && evidence.startupRetry !== false) {
    fail(
      "evidence_policy_mismatch",
      `Retained ${expected.platform} startup-retry evidence is invalid.`,
    );
  }
  if (evidence.firstFailure == null) {
    if (evidence.acquisitionRetry === true || evidence.startupRetry === true) {
      fail(
        "evidence_policy_mismatch",
        `Retained ${expected.platform} retry evidence is missing its first failure.`,
      );
    }
  } else if (
    typeof evidence.firstFailure.phase !== "string" ||
    typeof evidence.firstFailure.failureCode !== "string" ||
    !/^[a-z0-9_]{1,64}$/u.test(evidence.firstFailure.failureCode) ||
    evidence.firstFailure.mutationCount !== 0 ||
    typeof evidence.firstFailure.classification !== "string"
  ) {
    fail(
      "evidence_policy_mismatch",
      `Retained ${expected.platform} first-failure evidence is invalid.`,
    );
  }
  if (evidence.acquisitionRetry === true && evidence.firstFailure?.phase !== "npm_acquisition") {
    fail(
      "evidence_policy_mismatch",
      `Retained ${expected.platform} npm retry is not bound to acquisition.`,
    );
  }
  if (
    evidence.startupRetry === true &&
    evidence.firstFailure?.phase !== "core_startup" &&
    evidence.firstFailure?.phase !== "admin_startup" &&
    evidence.firstFailure?.phase !== "broker_startup"
  ) {
    fail(
      "evidence_policy_mismatch",
      `Retained ${expected.platform} startup retry is not bound to a startup phase.`,
    );
  }
  const requiredNegativeProof = [
    "missingProvenance",
    "missingChecksum",
    "emptyPayload",
    "emptyChecksum",
    "malformedChecksum",
    "duplicateChecksum",
    "unexpectedChecksum",
    "mismatchedPayload",
    "redirectedChecksum",
    "redirectedProvenance",
    "wrongHeadProvenance",
  ];
  if (
    JSON.stringify(Object.keys(evidence.negativeProof ?? {}).sort()) !==
      JSON.stringify([...requiredNegativeProof].sort()) ||
    requiredNegativeProof.some(
      (name) => evidence.negativeProof[name] !== "success",
    )
  ) {
    fail(
      "evidence_negative_proof_incomplete",
      `Retained ${expected.platform} negative proof is incomplete.`,
    );
  }
  if (
    evidence.mutations?.brokerRestart !== 1 ||
    evidence.mutations?.providerMigrationApply !== 1
  ) {
    fail(
      "evidence_mutation_mismatch",
      `Retained ${expected.platform} mutation-count evidence is invalid.`,
    );
  }
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
  if (expected.platform === "win32")
    requiredScenarios.push("localOperatorLockout");
  for (const scenario of requiredScenarios) {
    if (evidence.scenarios?.[scenario] !== "success") {
      fail(
        "evidence_scenario_incomplete",
        `Retained ${expected.platform} scenario ${scenario} is incomplete.`,
      );
    }
  }
  return evidence;
}
