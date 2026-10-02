import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  ADMIN_HARNESS_REVISION,
  ADMIN_RELEASE,
  BROKER_RELEASE,
  CORE_HARNESS_FILES,
  PACKAGE_NAME,
  QUALIFICATION_SCHEMA,
  QualificationError,
  coreReleaseAssets,
  parseChecksumManifest,
  parseCoreInstallOutput,
  releaseServiceAssets,
  validateNpmMetadata,
  validateRelease,
  validateRetainedArtifactMetadata,
  retainAdminTrustedUnlockReceipt,
  validateRetainedAdminTrustedUnlockReceipt,
  validateRetainedEvidence,
  validateTerminalJobMetadata,
  verifyFileSha256,
  verifyNpmTarballIntegrity,
} from "../scripts/published-package-qualification-lib.mjs";

const core = {
  repo: "service-lasso/service-lasso",
  id: "12345",
  tag: "2026.8.27-abcdef0",
  revision: "abcdef0abcdef0abcdef0abcdef0abcdef0abcde",
};
const execFileAsync = promisify(execFile);
const initialProjection = (platform, runId = "99") => ({
  schema: "service-lasso.qualification-first-custody-projection.v2", privateVersion: "v3",
  platform, candidate: { head: core.revision, tree: "b".repeat(40) },
  run: { id: runId, attempt: "1" }, privateInitialReceiptSha256: "c".repeat(64),
  privateJournalSha256: "d".repeat(64),
  localValidatorAttestation: { schema: "service-lasso.qualification-local-validator-attestation.v2", validated: true },
});

test("AC-4BZ.1 release-tree harness includes its dependency-free TLS certificate generator", () => {
  assert.ok(
    CORE_HARNESS_FILES.includes(
      "tests/fixtures/real-admin-browser-certificate.mjs",
    ),
  );
});

test("published Core install parsing accepts one complete pretty-printed JSON document", () => {
  const payload = { action: "install", serviceId: "@serviceadmin", ok: true };
  assert.deepEqual(
    parseCoreInstallOutput(JSON.stringify(payload, null, 2), "@serviceadmin"),
    payload,
  );
  for (const invalid of [
    "}",
    `progress\n${JSON.stringify(payload)}`,
    `${JSON.stringify(payload)}\n${JSON.stringify(payload)}`,
    "[]",
  ]) {
    assert.throws(
      () => parseCoreInstallOutput(invalid, "@serviceadmin"),
      (error) =>
        error instanceof QualificationError &&
        error.code === "core_install_contract_invalid",
    );
  }
});

function releasePayload(expected, names) {
  return {
    id: Number(expected.id),
    tag_name: expected.tag,
    name: expected.tag,
    target_commitish: expected.revision,
    draft: false,
    prerelease: false,
    assets: names.map((name, index) => ({
      id: 1000 + index,
      name,
      size: 100 + index,
      state: "uploaded",
      digest: `sha256:${String(index + 1).padStart(64, "0")}`,
      url: `https://api.github.com/repos/${expected.repo}/releases/assets/${1000 + index}`,
      browser_download_url: `https://github.com/${expected.repo}/releases/download/${expected.tag}/${name}`,
    })),
  };
}

function expectCode(code, operation) {
  assert.throws(
    operation,
    (error) => error instanceof QualificationError && error.code === code,
  );
}

test("AC-4BZ.1 requires an exact final Core release with archives, SBOMs, and checksums", () => {
  const names = coreReleaseAssets(core.tag);
  const assets = validateRelease(releasePayload(core, names), core, names);
  assert.equal(assets.size, 17);

  const missing = releasePayload(core, names.slice(1));
  expectCode("release_asset_inventory_mismatch", () =>
    validateRelease(missing, core, names),
  );

  const wrongHead = releasePayload(core, names);
  wrongHead.target_commitish = "0".repeat(40);
  expectCode("release_revision_mismatch", () =>
    validateRelease(wrongHead, core, names),
  );

  const redirected = releasePayload(core, names);
  redirected.assets[0].browser_download_url = "https://example.invalid/archive";
  expectCode("redirected_asset_metadata", () =>
    validateRelease(redirected, core, names),
  );
});

test("AC-4BZ.1 checksum parser rejects empty, malformed, duplicate, unexpected, missing, and redirected entries", () => {
  const names = ["one.zip", "two.tar.gz"];
  const valid = `${"1".repeat(64)}  one.zip\n${"2".repeat(64)}  two.tar.gz\n`;
  assert.deepEqual(
    [...parseChecksumManifest(valid, names)],
    [
      ["one.zip", "1".repeat(64)],
      ["two.tar.gz", "2".repeat(64)],
    ],
  );

  expectCode("empty_checksum_manifest", () => parseChecksumManifest("", names));
  expectCode("malformed_checksum_manifest", () =>
    parseChecksumManifest("bad", names),
  );
  expectCode("duplicate_checksum_entry", () =>
    parseChecksumManifest(`${valid}${"1".repeat(64)}  one.zip\n`, names),
  );
  expectCode("unexpected_checksum_entry", () =>
    parseChecksumManifest(`${valid}${"3".repeat(64)}  three.zip\n`, names),
  );
  expectCode("missing_checksum_entry", () =>
    parseChecksumManifest(`${"1".repeat(64)}  one.zip\n`, names),
  );
  expectCode("redirected_checksum_entry", () =>
    parseChecksumManifest(`${"1".repeat(64)}  ../one.zip\n`, names),
  );
});

test("AC-4BZ.1 verifies downloaded bytes and exact npm latest identity before use", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "published-package-qualification-"),
  );
  try {
    const file = path.join(root, "payload.bin");
    await writeFile(file, "published bytes");
    const sha256 =
      "79917366a2d55364e0380eba79304f6c4aad8dfcfdc30a968dacaa1f9f9a78f3";
    const integrity =
      "sha512-6xEJhEThBkgxo2bPVe/qXHDvEzQUL+ntKlNJvGXD6QT7JG2II0OXnw+RC3r6r5d7EpP8ZbQ+8XMIgQtZMZUe3g==";
    assert.equal(
      (await verifyFileSha256(file, sha256, "payload")).sha256,
      sha256,
    );
    assert.equal(
      (await verifyNpmTarballIntegrity(file, integrity)).integrity,
      integrity,
    );

    const metadata = {
      name: PACKAGE_NAME,
      version: core.tag,
      dist: {
        integrity,
        tarball: `https://registry.npmjs.org/${PACKAGE_NAME}/-/service-lasso-${core.tag}.tgz`,
      },
    };
    assert.match(
      validateNpmMetadata(metadata, { latest: core.tag }, core.tag, integrity),
      /^https:\/\/registry\.npmjs\.org\//u,
    );
    expectCode("npm_latest_mismatch", () =>
      validateNpmMetadata(metadata, { latest: "older" }, core.tag, integrity),
    );
    expectCode("npm_tarball_redirected", () =>
      validateNpmMetadata(
        {
          ...metadata,
          dist: {
            ...metadata.dist,
            tarball: "https://example.invalid/core.tgz",
          },
        },
        { latest: core.tag },
        core.tag,
        integrity,
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("AC-4BZ.1 retained evidence requires terminal scenarios and rejects sensitive fields", () => {
  const platform = "linux";
  const expected = {
    platform,
    initialProjection: initialProjection(platform),
    runId: "99",
    runAttempt: "1",
    workflowSha: core.revision,
    coreReleaseId: core.id,
    coreTag: core.tag,
    coreRevision: core.revision,
    coreAsset: `service-lasso-${core.tag}-linux.tar.gz`,
    coreSha256: "1".repeat(64),
    coreNpmVersion: core.tag,
    coreNpmIntegrity: `sha512-${Buffer.from("integrity").toString("base64")}`,
  };
  const evidence = {
    firstCustody: initialProjection(platform),
    schema: QUALIFICATION_SCHEMA,
    retainedContent: "metadata_only",
    outcome: "success",
    platform,
    run: { id: 99, attempt: 1, jobId: 101, workflowSha: core.revision },
    core: {
      releaseId: core.id,
      tag: core.tag,
      revision: core.revision,
      asset: expected.coreAsset,
      sha256: expected.coreSha256,
      npm: {
        name: PACKAGE_NAME,
        version: core.tag,
        integrity: expected.coreNpmIntegrity,
        distTag: "latest",
      },
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
    adminHarnessRevision: ADMIN_HARNESS_REVISION,
    adminTrustedUnlockReceipt: retainAdminTrustedUnlockReceipt(
      JSON.stringify({
        schema: "service-lasso.admin-trusted-unlock-consumer.v1",
        outcome: "nonzero_exit",
        exitCode: 7,
        signal: null,
        trustedUnlock: {
          classification: "closed",
          receipt: {
            schema: "service-admin.trusted-unlock-receipt.v1",
            status: "observed",
            present: true,
            verified: false,
            localRoot: false,
            loading: true,
            unavailable: false,
          },
        },
      }),
      {
        platform,
        coreRevision: core.revision,
        adminReleaseId: ADMIN_RELEASE.id,
        adminRevision: ADMIN_RELEASE.revision,
        adminHarnessRevision: ADMIN_HARNESS_REVISION,
      },
    ),
    retentionDays: 90,
    mutationRetry: false,
    acquisitionRetry: false,
    startupRetry: false,
    firstFailure: null,
    negativeProof: Object.fromEntries(
      [
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
      ].map((name) => [name, "success"]),
    ),
    mutations: { brokerRestart: 1, providerMigrationApply: 1 },
    scenarios: Object.fromEntries(
      [
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
      ].map((name) => [name, "success"]),
    ),
  };
  assert.equal(validateRetainedEvidence(evidence, expected), evidence);

  const incomplete = structuredClone(evidence);
  incomplete.scenarios.cleanupConvergence = "blocked";
  expectCode("evidence_scenario_incomplete", () =>
    validateRetainedEvidence(incomplete, expected),
  );

  const wrongAdminHarness = structuredClone(evidence);
  wrongAdminHarness.adminHarnessRevision = "0".repeat(40);
  expectCode("evidence_admin_harness_mismatch", () =>
    validateRetainedEvidence(wrongAdminHarness, expected),
  );

  const unsafe = structuredClone(evidence);
  unsafe.runtimePath = "redacted-but-forbidden";
  expectCode("unsafe_evidence", () =>
    validateRetainedEvidence(unsafe, expected),
  );

  const privateReceipt = structuredClone(evidence);
  privateReceipt.adminTrustedUnlockReceipt.trustedUnlock.receipt.private = true;
  expectCode("evidence_admin_trusted_unlock_receipt_mismatch", () =>
    validateRetainedEvidence(privateReceipt, expected),
  );
});

test("AC-4BY.2 retains only observed consumer receipts and never upgrades a failed Cypress consumer", () => {
  const expected = {
    platform: "linux",
    coreRevision: core.revision,
    adminReleaseId: ADMIN_RELEASE.id,
    adminRevision: ADMIN_RELEASE.revision,
    adminHarnessRevision: ADMIN_HARNESS_REVISION,
  };
  expectCode("invalid_retained_trusted_unlock_receipt", () => retainAdminTrustedUnlockReceipt(null, expected));
  const raw = JSON.stringify({
    schema: "service-lasso.admin-trusted-unlock-consumer.v1",
    outcome: "nonzero_exit",
    exitCode: 7,
    signal: null,
    trustedUnlock: {
      classification: "closed",
      receipt: {
        schema: "service-admin.trusted-unlock-receipt.v1",
        status: "observed",
        present: true,
        verified: false,
        localRoot: false,
        loading: true,
        unavailable: false,
      },
    },
  });
  const retained = retainAdminTrustedUnlockReceipt(raw, expected);
  assert.equal(retained.consumerOutcome, "nonzero_exit");
  assert.equal(retained.consumerExitCode, 7);
  assert.equal(retained.trustedUnlock.classification, "closed");
  assert.doesNotMatch(JSON.stringify(retained), /stdout|stderr|token|path|url/iu);
  assert.equal(
    (() => { try { retainAdminTrustedUnlockReceipt(raw.replace('"loading":true', '"loading":true,"private":true'), expected); } catch (error) { return error.code; } })(),
    "invalid_retained_trusted_unlock_receipt",
  );
  const success = retainAdminTrustedUnlockReceipt(JSON.stringify({ schema: "service-lasso.admin-trusted-unlock-consumer.v1", outcome: "success", exitCode: 0, signal: null, trustedUnlock: { classification: "not_emitted" } }), expected);
  assert.deepEqual(success.trustedUnlock, { classification: "not_emitted", reason: "no_failure" });
  const observationFailure = retainAdminTrustedUnlockReceipt(JSON.stringify({ schema: "service-lasso.admin-trusted-unlock-consumer.v1", outcome: "observation_failure", exitCode: 0, signal: null, streamFailure: "malformed_utf8", trustedUnlock: { classification: "closed", receipt: JSON.parse(raw).trustedUnlock.receipt } }), expected);
  assert.deepEqual(observationFailure.consumerFailure, { source: "stream", classification: "malformed_utf8" });
  assert.deepEqual(validateRetainedAdminTrustedUnlockReceipt(observationFailure, expected), observationFailure);
  for (const classification of ["missing", "invalid"]) {
    const unavailable = retainAdminTrustedUnlockReceipt(JSON.stringify({ schema: "service-lasso.admin-trusted-unlock-consumer.v1", outcome: "nonzero_exit", exitCode: 7, signal: null, trustedUnlock: { classification } }), expected);
    assert.deepEqual(unavailable.trustedUnlock, { classification });
    assert.deepEqual(validateRetainedAdminTrustedUnlockReceipt(unavailable, expected), unavailable);
  }
  for (const failure of [
    { source: "stream", classification: "unknown" },
    { source: "execution", classification: "spawn_failed", extra: true },
    { source: "stream", classification: "pipe_hang", executionFailure: "spawn_failed" },
  ]) expectCode("invalid_retained_trusted_unlock_receipt", () => validateRetainedAdminTrustedUnlockReceipt({ ...observationFailure, consumerFailure: failure }, expected));
});

test("AC-4BY.2 preparation rejects a stale Admin harness pin before any mutation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "published-package-stale-pin-"));
  try {
    const mutationRoot = path.join(root, "service-lasso-published-mutation-1-1-linux");
    const environment = {
      ...process.env,
      QUALIFICATION_PLATFORM: "linux",
      GITHUB_TOKEN: "test-token",
      GITHUB_WORKSPACE: root,
      RUNNER_TEMP: root,
      CORE_RELEASE_ID: "1",
      CORE_RELEASE_TAG: "2026.1.1-abcdef0",
      CORE_REVISION: core.revision,
      CORE_NPM_VERSION: "2026.1.1-abcdef0",
      CORE_RELEASE_ASSET: "service-lasso-2026.1.1-abcdef0-linux.tar.gz",
      CORE_RELEASE_SHA256: "1".repeat(64),
      CORE_NPM_INTEGRITY: `sha512-${Buffer.from("integrity").toString("base64")}`,
      ADMIN_HARNESS_REVISION: "66ea0a5be70a8b3f3f73e4132d92b50ff6d45784",
      QUALIFICATION_SAFE_STATE_PATH: path.join(root, "state.json"),
      QUALIFICATION_PRIVATE_STATE_PATH: path.join(root, "private.json"),
      GITHUB_RUN_ID: "1",
      GITHUB_RUN_ATTEMPT: "1",
      GITHUB_SHA: core.revision,
      GITHUB_ENV: path.join(root, "github-env"),
    };
    await assert.rejects(execFileAsync(process.execPath, [fileURLToPath(new URL("../scripts/prepare-published-package-qualification.mjs", import.meta.url))], { env: environment }));
    await assert.rejects(readdir(mutationRoot));
    await assert.rejects(readFile(path.join(root, "state.json"), "utf8"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("AC-4BZ.1 artifact and job API metadata must be nonempty, unexpired, 90-day, terminal-green, and wrong-head safe", () => {
  const now = Date.parse("2026-08-27T00:05:00Z");
  const artifactExpected = {
    name: "published-package-qualification-linux-99-1",
    repo: core.repo,
    runId: "99",
    workflowSha: core.revision,
  };
  const artifact = {
    id: 123,
    name: artifactExpected.name,
    size_in_bytes: 456,
    expired: false,
    created_at: "2026-08-27T00:00:00Z",
    updated_at: "2026-08-27T00:01:00Z",
    expires_at: "2026-11-25T00:00:00Z",
    workflow_run: { id: 99, head_sha: core.revision },
    archive_download_url: `https://api.github.com/repos/${core.repo}/actions/artifacts/123/zip`,
  };
  assert.equal(
    validateRetainedArtifactMetadata(artifact, artifactExpected, now),
    artifact,
  );
  for (const [field, value] of [
    ["size_in_bytes", 0],
    ["expired", true],
    ["expires_at", "2026-08-27T00:01:00Z"],
  ]) {
    expectCode("invalid_retained_artifact", () =>
      validateRetainedArtifactMetadata(
        { ...artifact, [field]: value },
        artifactExpected,
        now,
      ),
    );
  }
  expectCode("invalid_retained_artifact", () =>
    validateRetainedArtifactMetadata(
      {
        ...artifact,
        workflow_run: { ...artifact.workflow_run, head_sha: "0".repeat(40) },
      },
      artifactExpected,
      now,
    ),
  );

  const jobExpected = {
    name: "published-package-qualification (linux)",
    jobId: 321,
    runId: "99",
    runAttempt: "1",
    workflowSha: core.revision,
    repo: core.repo,
  };
  const job = {
    name: jobExpected.name,
    id: 321,
    run_id: 99,
    run_attempt: 1,
    head_sha: core.revision,
    status: "completed",
    conclusion: "success",
    url: `https://api.github.com/repos/${core.repo}/actions/jobs/321`,
    run_url: `https://api.github.com/repos/${core.repo}/actions/runs/99`,
    html_url: `https://github.com/${core.repo}/actions/runs/99/job/321`,
  };
  assert.equal(validateTerminalJobMetadata(job, jobExpected), job);
  expectCode("invalid_terminal_job", () =>
    validateTerminalJobMetadata({ ...job, status: "in_progress" }, jobExpected),
  );
  expectCode("invalid_terminal_job", () =>
    validateTerminalJobMetadata({ ...job, conclusion: "failure" }, jobExpected),
  );
  expectCode("invalid_terminal_job", () =>
    validateTerminalJobMetadata(
      { ...job, head_sha: "0".repeat(40) },
      jobExpected,
    ),
  );
});

test("AC-4BZ.1 cleanup refuses targets outside its exact runner-temp ownership boundary", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "published-package-cleanup-"),
  );
  try {
    const runnerTemp = path.join(root, "runner-temp");
    const outside = path.join(root, "outside-target");
    const safeStatePath = path.join(root, "safe-state.json");
    const privateStatePath = path.join(root, "private-state.json");
    await mkdir(runnerTemp);
    await mkdir(outside);
    await writeFile(path.join(outside, "sentinel.txt"), "preserve");
    await writeFile(
      safeStatePath,
      `${JSON.stringify({
        schema: QUALIFICATION_SCHEMA,
        retainedContent: "metadata_only",
        outcome: "failure",
        scenarios: {},
      })}\n`,
    );
    await writeFile(
      privateStatePath,
      `${JSON.stringify({
        downloadRoot: outside,
        mutationRoot: path.join(
          runnerTemp,
          "service-lasso-published-mutation-test",
        ),
      })}\n`,
    );

    await assert.rejects(
      execFileAsync(
        process.execPath,
        [
          fileURLToPath(
            new URL(
              "../scripts/cleanup-published-package-qualification.mjs",
              import.meta.url,
            ),
          ),
        ],
        {
          env: {
            ...process.env,
            RUNNER_TEMP: runnerTemp,
            QUALIFICATION_PRIVATE_STATE_PATH: privateStatePath,
            QUALIFICATION_SAFE_STATE_PATH: safeStatePath,
          },
        },
      ),
    );
    assert.equal(
      await readFile(path.join(outside, "sentinel.txt"), "utf8"),
      "preserve",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("published dependency releases retain exact eight-asset checksum and SBOM inventories", () => {
  assert.deepEqual(
    releaseServiceAssets(ADMIN_RELEASE).sort(),
    [
      "@serviceadmin-darwin.tar.gz",
      "@serviceadmin-linux.tar.gz",
      "@serviceadmin-win32.zip",
      "SHA256SUMS.txt",
      "serviceadmin-darwin.cdx.json",
      "serviceadmin-linux.cdx.json",
      "serviceadmin-win32.cdx.json",
      "service.json",
    ].sort(),
  );
  assert.deepEqual(
    releaseServiceAssets(BROKER_RELEASE).sort(),
    [
      "SHA256SUMS.txt",
      "secretsbroker-darwin.cdx.json",
      "secretsbroker-darwin.tar.gz",
      "secretsbroker-linux.cdx.json",
      "secretsbroker-linux.tar.gz",
      "secretsbroker-win32.cdx.json",
      "secretsbroker-win32.zip",
      "service.json",
    ].sort(),
  );
});

test("BR-008 actual normal prepare/record/aggregate callers preserve public-v2 custody linkage", async () => {
  // Offline metadata contract fixture, not native custody or product qualification.
  // Preparation is observed through its real initializer and a classified release
  // failure. Product success metadata below is fixture input to normal retention;
  // the full successful acquisition remains the protected three-OS workflow gate.
  const root = await mkdtemp(path.join(os.tmpdir(), "published-normal-custody-"));
  const platforms = ["linux", "win32", "darwin"];
  const runId = "99", attempt = "1", repo = core.repo;
  const integrity = `sha512-${Buffer.from("integrity").toString("base64")}`;
  const artifactsRoot = path.join(root, "artifacts");
  const preload = path.join(root, "api-fixture.mjs");
  const apiFile = path.join(root, "api.json");
  const prepared = new Map();
  const baseEnv = { ...process.env, GITHUB_REPOSITORY: repo, GITHUB_TOKEN: "offline-fixture",
    GITHUB_RUN_ID: runId, GITHUB_RUN_ATTEMPT: attempt, GITHUB_SHA: core.revision,
    QUALIFICATION_CANDIDATE_SHA: core.revision, CORE_RELEASE_ID: core.id,
    CORE_RELEASE_TAG: core.tag, CORE_REVISION: core.revision, CORE_NPM_VERSION: core.tag,
    CORE_NPM_INTEGRITY: integrity, ADMIN_HARNESS_REVISION,
    GITHUB_WORKSPACE: root, RUNNER_TEMP: root, GITHUB_ENV: path.join(root, "github-env") };
  delete baseEnv.ADMIN_TRUSTED_UNLOCK_PREBROWSER_FAILURE_PATH;
  delete baseEnv.NODE_OPTIONS;
  const invoke = (name, env) => execFileAsync(process.execPath,
    ["--import", preload, fileURLToPath(new URL(`../scripts/${name}.mjs`, import.meta.url))], { env });
  try {
    await writeFile(preload, `import { readFile } from "node:fs/promises";
const fixture = JSON.parse(await readFile(${JSON.stringify(apiFile)}, "utf8"));
globalThis.fetch = async url => {
  const value = String(url);
  if (value.endsWith("/artifacts?per_page=100")) return { ok: true, json: async () => ({ artifacts: fixture.artifacts }) };
  if (value.endsWith("/attempts/1/jobs?per_page=100")) return { ok: true, json: async () => ({ jobs: fixture.jobs }) };
  if (value.includes("/releases/") || value.startsWith("https://registry.npmjs.org/")) return { ok: true, json: async () => ({}) };
  throw new Error("Unexpected offline request");
};\n`);
    const now = Date.now();
    const jobs = platforms.map((platform, i) => ({ name: `published-package-qualification (${platform})`,
      id: 101 + i, run_id: Number(runId), run_attempt: 1, head_sha: core.revision,
      status: "completed", conclusion: "success", url: `https://api.github.com/repos/${repo}/actions/jobs/${101 + i}`,
      run_url: `https://api.github.com/repos/${repo}/actions/runs/${runId}`,
      html_url: `https://github.com/${repo}/actions/runs/${runId}/job/${101 + i}` }));
    const artifacts = platforms.map((platform, i) => ({ id: 201 + i,
      name: `published-package-qualification-${platform}-${runId}-${attempt}`, size_in_bytes: 100,
      expired: false, created_at: new Date(now - 60000).toISOString(), updated_at: new Date(now - 30000).toISOString(),
      expires_at: new Date(now - 60000 + 90 * 86400000).toISOString(),
      workflow_run: { id: Number(runId), head_sha: core.revision },
      archive_download_url: `https://api.github.com/repos/${repo}/actions/artifacts/${201 + i}/zip` }));
    await writeFile(apiFile, JSON.stringify({ artifacts, jobs }));
    for (const platform of platforms) {
      const directory = path.join(artifactsRoot, `published-package-qualification-${platform}-${runId}-${attempt}`);
      await mkdir(directory, { recursive: true });
      const projectionFile = path.join(directory, "initial-projection.json");
      const stateFile = path.join(root, `state-${platform}.json`);
      const consumerFile = path.join(root, `consumer-${platform}.json`);
      await writeFile(projectionFile, JSON.stringify(initialProjection(platform)));
      await writeFile(consumerFile, JSON.stringify({ schema: "service-lasso.admin-trusted-unlock-consumer.v1",
        outcome: "success", exitCode: 0, signal: null, trustedUnlock: { classification: "not_emitted" } }));
      const env = { ...baseEnv, QUALIFICATION_PLATFORM: platform, QUALIFICATION_INITIAL_PROJECTION_PATH: projectionFile,
        QUALIFICATION_EVIDENCE_ROOT: directory, QUALIFICATION_SAFE_STATE_PATH: stateFile,
        QUALIFICATION_PRIVATE_STATE_PATH: path.join(root, `private-${platform}.json`),
        CORE_RELEASE_ASSET: `service-lasso-${core.tag}-${platform === "win32" ? "win32.zip" : `${platform}.tar.gz`}`,
        CORE_RELEASE_SHA256: "1".repeat(64), ADMIN_TRUSTED_UNLOCK_RECEIPT_PATH: consumerFile,
        QUALIFICATION_JOB_NAME: `published-package-qualification (${platform})`, PREPARE_OUTCOME: "success",
        QUALIFICATION_OUTCOME: "success", CLEANUP_OUTCOME: "success", QUALIFICATION_FIRST_RUN: "success",
        QUALIFICATION_LIFECYCLE: "success", QUALIFICATION_STOPPED_LIFECYCLE: "success", QUALIFICATION_LOCKOUT: "success" };
      // Canonical pin must reach the next real gate; wrong pin must not create state.
      await assert.rejects(invoke("prepare-published-package-qualification", { ...env,
        ADMIN_HARNESS_REVISION: "0".repeat(40) }), /Admin browser harness revision is not canonical/u);
      await assert.rejects(readFile(stateFile), { code: "ENOENT" });
      for (const mutate of [
        value => value.candidate.head = "0".repeat(40),
        value => value.run.id = "100",
        value => value.run.attempt = "2",
        value => value.localValidatorAttestation.extra = true,
        value => value.localValidatorAttestation.validated = false,
        value => value.privateJournalSha256 = "invalid",
      ]) {
        const invalid = initialProjection(platform); mutate(invalid);
        await writeFile(projectionFile, JSON.stringify(invalid));
        await assert.rejects(invoke("prepare-published-package-qualification", env), /Initial qualification projection custody is invalid/u);
        await assert.rejects(readFile(stateFile), { code: "ENOENT" });
      }
      await assert.rejects(invoke("prepare-published-package-qualification", { ...env,
        QUALIFICATION_INITIAL_PROJECTION_PATH: path.join(root, "missing-projection.json") }));
      await assert.rejects(readFile(stateFile), { code: "ENOENT" });
      await writeFile(projectionFile, JSON.stringify(initialProjection(platform)));
      await assert.rejects(invoke("prepare-published-package-qualification", env));
      const actualPrepared = JSON.parse(await readFile(stateFile, "utf8"));
      assert.deepEqual(actualPrepared.firstCustody, initialProjection(platform));
      assert.notEqual(actualPrepared.failureCode, "admin_harness_revision_mismatch");
      // Keep actual failure separate. The following is explicit fixture metadata.
      await writeFile(path.join(root, `actual-preparation-failure-${platform}.json`), JSON.stringify(actualPrepared));
      const state = structuredClone(actualPrepared);
      state.firstFailure = null; state.failurePhase = null; state.failureCode = null;
      state.negativeProof = Object.fromEntries(["missingProvenance", "missingChecksum", "emptyPayload", "emptyChecksum",
        "malformedChecksum", "duplicateChecksum", "unexpectedChecksum", "mismatchedPayload", "redirectedChecksum",
        "redirectedProvenance", "wrongHeadProvenance"].map(name => [name, "success"]));
      for (const name of ["preMutationGuards", "releaseRuntime", "npmConsumer", "productionAcquisition", "cleanupConvergence"]) state.scenarios[name] = "success";
      prepared.set(platform, { env, state, directory, projectionFile, stateFile });
      await writeFile(stateFile, JSON.stringify(state));
      await invoke("record-published-package-qualification", env);
      const recorded = JSON.parse(await readFile(path.join(directory, `published-package-qualification-${platform}.json`), "utf8"));
      assert.equal(recorded.outcome, "success");
      assert.deepEqual(recorded.firstCustody, actualPrepared.firstCustody);
      assert.equal(recorded.adminHarnessRevision, ADMIN_HARNESS_REVISION);
      assert.equal(recorded.admin.revision, ADMIN_RELEASE.revision);
      await assert.rejects(invoke("record-published-package-qualification", { ...env, ADMIN_HARNESS_REVISION: "0".repeat(40) }), /not canonical/u);
    }
    const aggregateEnv = { ...baseEnv, QUALIFICATION_ARTIFACTS_ROOT: artifactsRoot,
      CORE_LINUX_SHA256: "1".repeat(64), CORE_WIN32_SHA256: "1".repeat(64), CORE_DARWIN_SHA256: "1".repeat(64) };
    const aggregate = () => invoke("verify-published-package-qualification-artifacts", aggregateEnv);
    assert.match((await aggregate()).stdout, /Exact three-platform artifact API readback/u);
    const f = prepared.get("linux");
    const expandedState = path.join(f.directory, "qualification-state.json");
    await writeFile(expandedState, JSON.stringify(f.state));
    await assert.rejects(aggregate(), /exact metadata evidence/u);
    await rm(expandedState);
    const evidenceFile = path.join(f.directory, "published-package-qualification-linux.json");
    const validEvidence = JSON.parse(await readFile(evidenceFile, "utf8"));
    const mutateCases = [
      value => delete value.firstCustody,
      value => value.firstCustody.schema = "service-lasso.qualification-first-custody-projection.v1",
      value => value.firstCustody.candidate.head = "0".repeat(40),
      value => value.firstCustody.candidate.tree = "0".repeat(40),
      value => value.firstCustody.run.id = "100",
      value => value.firstCustody.run.attempt = "2",
      value => value.firstCustody.privateInitialReceiptSha256 = "0".repeat(64),
      value => value.firstCustody.privateJournalSha256 = "0".repeat(64),
      value => value.firstCustody.localValidatorAttestation.extra = true,
      value => value.firstCustody.localValidatorAttestation.validated = false,
    ];
    for (const mutate of mutateCases) {
      const state = structuredClone(f.state); mutate(state);
      await writeFile(f.stateFile, JSON.stringify(state));
      await assert.rejects(invoke("record-published-package-qualification", f.env), /Prepared first-custody projection/u);
      const evidence = structuredClone(validEvidence); mutate(evidence);
      await writeFile(evidenceFile, JSON.stringify(evidence));
      await assert.rejects(aggregate(), /first-custody closure is invalid/u);
      await writeFile(evidenceFile, JSON.stringify(validEvidence));
    }
    // A separately valid but stale hash/tree projection must fail cross-file equality.
    for (const key of ["privateInitialReceiptSha256", "privateJournalSha256"]) {
      const stale = initialProjection("linux"); stale[key] = "0".repeat(64);
      await writeFile(f.projectionFile, JSON.stringify(stale));
      await assert.rejects(aggregate(), /first-custody closure is invalid/u);
    }
    await writeFile(f.projectionFile, JSON.stringify(initialProjection("linux")));
    for (const mutate of [
      value => value.candidate.head = "0".repeat(40),
      value => value.run.id = "100",
      value => value.run.attempt = "2",
      value => value.localValidatorAttestation.extra = true,
      value => value.localValidatorAttestation.validated = false,
    ]) {
      const invalid = initialProjection("linux"); mutate(invalid);
      await writeFile(f.projectionFile, JSON.stringify(invalid));
      await assert.rejects(aggregate(), /initial projection custody is invalid/u);
    }
    // Exact downloaded inventory and missing initial file remain mandatory.
    await rm(f.projectionFile);
    await assert.rejects(aggregate(), /exact metadata evidence/u);
    await writeFile(f.projectionFile, JSON.stringify(initialProjection("linux")));
    await writeFile(f.stateFile, JSON.stringify(f.state));
    await invoke("record-published-package-qualification", f.env);
    assert.match((await aggregate()).stdout, /Exact three-platform artifact API readback/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});
