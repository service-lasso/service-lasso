import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    retentionDays: 90,
    mutationRetry: false,
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
