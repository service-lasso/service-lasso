import test from "node:test";
import assert from "node:assert/strict";
import { digest, parseScopedJson, readSourceScope, scopeIdentity, sourceIdentity } from "../scripts/ga-platform-scope-lib.mjs";
import { createCandidate2Evidence, scopedArchiveNames, scopedReleaseAssetNames, validatePublishedEvidence4, verifyCandidate2Bytes, verifyFullReleaseBytes, wrapPublishedEvidence } from "../scripts/scoped-release-evidence-lib.mjs";
import { ADMIN_HARNESS_REVISION, ADMIN_RELEASE, BROKER_RELEASE, retainAdminTrustedUnlockReceipt, validateRetainedEvidence } from "../scripts/published-package-qualification-lib.mjs";
import { assertScopedPublicationCatalog, publishFullRelease, resolvePublicationTag, verifyImmutablePublicBytes, verifyPublicationQualification } from "../scripts/scoped-publication-lib.mjs";
import { MCP_PRODUCT_EVIDENCE_CONTRACT, MCP_PACKAGED_COVERAGE_KEYS } from "../scripts/mcp-product-acceptance-lib.mjs";
import { stageOperatorTools, validateRetainedOperatorToolBytes, verifyRetainedOperatorTools } from "../scripts/operator-tool-packaging-lib.mjs";
import { selectScopedCurrentAttemptArtifacts } from "../scripts/published-package-qualification-reliability.mjs";
import { createProtectedCliFixture, fixtureTar } from "./fixtures/protected-operator-cli.mjs";
import { verifyNpmOriginalToolBytes } from "../scripts/scoped-npm-original-bytes-lib.mjs";
import { verifyProtectedCliBytes } from "../scripts/operator-tool-cli-contract.mjs";
import { preflightScopedCoreTar } from "../scripts/scoped-core-archive-lib.mjs";
import { createBlockedTemplateEvidence, readTemplateEvidence, validateTemplateEvidence } from "../scripts/scoped-template-evidence-lib.mjs";
import { createReleaseArchive } from "../scripts/release-artifact-lib.mjs";
import { ZipArchive } from "../dist/runtime/files/safe-zip.js";
import { requireScopedTechnicalAuthority } from "../scripts/scoped-technical-authority-lib.mjs";
import { readOriginalMetadataArtifact } from "../scripts/scoped-metadata-artifact-lib.mjs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { gunzipSync, gzipSync } from "node:zlib";
import os from "node:os";
import path from "node:path";

// Finite source regression inputs only, authored UNEXECUTED. Eventual archive
// producer execution is compatibility evidence, never native/operator acceptance.
const source = sourceIdentity("1234567890123456789012345678901234567890");
const scope = scopeIdentity();

test("actual Template wrapper constructor retains both blocked roles and refuses invented catalog or gate success", () => {
  const templateSource = { repository: "service-lasso/service-template", commit: source.commit, ref: "refs/heads/develop" };
  const value = createBlockedTemplateEvidence(templateSource, scope, { id: 1, attempt: 1, workflowSha: source.commit });
  assert.deepEqual(readTemplateEvidence(Buffer.from(JSON.stringify(value)), templateSource), value);
  assert.throws(() => readTemplateEvidence(Buffer.from('{"schema":1,"schema":2}'), templateSource));
  assert.equal(value.outcome, "blocked");
  assert.equal(value.consumers[0].gates.length, 12);
  assert.equal(value.consumers[1].gates.length, 8);
  const failedPublication = structuredClone(value);
  failedPublication.publication = { repository: "service-lasso/service-template", releaseId: 1, tag: "template-v1.0.0-dev", targetCommit: source.commit, draft: true, prerelease: true, immutable: false, assets: [] };
  failedPublication.outcome = "failure";
  assert.equal(validateTemplateEvidence(failedPublication, templateSource).outcome, "failure");
  failedPublication.outcome = "blocked";
  assert.throws(() => validateTemplateEvidence(failedPublication, templateSource), /precedence/);
  for (const mutate of [v => v.consumers.pop(), v => v.consumers.reverse(), v => v.outcome = "success", v => v.consumers[1].catalogIdentity = "fixture-self-enrollment", v => v.consumers[1].gates[0].outcome = "success", v => v.consumers[0].repository = "caller/invented", v => { v.candidate.templateCommit = "a".repeat(40); v.candidate.templateVersion = "1.0.0-dev"; v.candidate.releaseTag = `template-v1.0.0-dev-${"a".repeat(40)}`; }]) {
    const altered = structuredClone(value); mutate(altered);
    assert.throws(() => validateTemplateEvidence(altered, templateSource));
  }
});

function nativeQualificationFixture() {
  const held = new Map(), jobs = [], receipts = [];
  for (const [index, platform] of ["win32", "linux"].entries()) {
    const body = {
      contractVersion: MCP_PRODUCT_EVIDENCE_CONTRACT, issue: 864, spec: "SPEC-006 AC-6G", repository: source.repository,
      workflowRunId: "42", workflowRunAttempt: "2", eventName: "workflow_dispatch", candidateSha: source.commit,
      platform, architecture: "x64", nodeVersion: "v22.23.2", packageVersion: "2026.10.4-1234567", packageArchiveSha256: "a".repeat(64),
      sdk: { packageName: "@modelcontextprotocol/sdk", version: "1.30.1", protocolVersion: "2025-11-25", supportedProtocolVersions: ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05", "2024-10-07"] },
      inspector: { packageName: "@modelcontextprotocol/inspector", version: "2.4.0", result: "passed", strictSchema: "passed" },
      packagedRuntime: { sourceCheckoutRequired: false, sourceCheckoutAccess: "denied-by-node-permission-model", moduleResolution: "fresh-consumer-node-modules", workingDirectory: "fresh-consumer", streamableHttp: "passed", stdio: "passed", operatingModes: ["read-only", "guarded"], identityInspectionPolicy: platform === "win32" ? "native-win32-product-default" : "product-default" },
      canonical: { discovery: "passed", representativeReads: "passed", guardedLifecycle: "passed", exactlyOnce: true, terminalState: "running" },
      coverage: Object.fromEntries(MCP_PACKAGED_COVERAGE_KEYS.map(key => [key, "passed"])), assertions: [...MCP_PACKAGED_COVERAGE_KEYS], generatedAt: "2026-10-04T00:00:00.000Z",
    };
    const name = `mcp-product-${platform}.json`, bytes = Buffer.from(`${JSON.stringify(body)}\n`), jobId = index + 1;
    held.set(name, bytes);
    receipts.push({ platform, jobId, runId: 42, runAttempt: 2, workflowSha: source.commit, name, sha256: digest(bytes), size: bytes.length });
    jobs.push({ id: jobId, name: `mcp-packaged (${platform})`, run_id: 42, run_attempt: 2, head_sha: source.commit, status: "completed", conclusion: "success", url: `https://api.github.com/repos/${source.repository}/actions/jobs/${jobId}`, run_url: `https://api.github.com/repos/${source.repository}/actions/runs/42`, html_url: `https://github.com/${source.repository}/actions/runs/42/job/${jobId}` });
  }
  return { held, jobs, receipts };
}
test("actual publication aggregate consumes complete native body grammar and exact provider jobs", () => {
  const { held, jobs, receipts } = nativeQualificationFixture();
  assert.doesNotThrow(() => verifyPublicationQualification(receipts, source, jobs, held, "mcp-packaged"));
  for (const mutate of [rows => rows[1].conclusion = "cancelled", rows => rows[1].run_attempt = 1, rows => rows[1].head_sha = "a".repeat(40), rows => rows.push(rows[0])]) {
    const changed = structuredClone(jobs); mutate(changed);
    assert.throws(() => verifyPublicationQualification(receipts, source, changed, held, "mcp-packaged"));
  }
  const changed = structuredClone(receipts); changed[1].platform = "darwin";
  assert.throws(() => verifyPublicationQualification(changed, source, jobs, held, "mcp-packaged"));
  const bytes = new Map(held); bytes.set(receipts[0].name, Buffer.from("substitution"));
  assert.throws(() => verifyPublicationQualification(receipts, source, jobs, bytes, "mcp-packaged"));
});
test("whole technical authority reader refuses legacy app/run/attempt and consumes original scoped aggregate bytes", async () => {
  const { held, jobs, receipts } = nativeQualificationFixture();
  const repo = source.repository, workflowPath = ".github/workflows/release-qualification-scoped.yml";
  const terminal = { ...jobs[0], id: 99, name: "qualify-release", url: `https://api.github.com/repos/${repo}/actions/jobs/99`, html_url: `https://github.com/${repo}/actions/runs/42/job/99` };
  const evidence = { schema: "service-lasso.release-qualification.v1", scope, source, run: { id: 42, attempt: 2, workflowSha: source.commit }, platforms: ["win32", "linux"], receipts, outcome: "success" };
  const archive = new ZipArchive();
  for (const [name, bytes] of held) archive.addFile(name, bytes);
  archive.addFile("qualification.json", Buffer.from(JSON.stringify(evidence)));
  const original = archive.toBuffer(), now = Date.now();
  const run = { id: 42, workflow_id: 8, path: workflowPath, head_sha: source.commit, head_branch: "develop", event: "workflow_dispatch", run_attempt: 2, status: "completed", conclusion: "success" };
  const artifact = { id: 7, name: "scoped-release-qualification-42-2", size_in_bytes: original.length, digest: `sha256:${digest(original)}`, expired: false, created_at: new Date(now - 1000).toISOString(), updated_at: new Date(now - 1000).toISOString(), expires_at: new Date(now - 1000 + 90 * 86400000).toISOString(), workflow_run: { id: 42, head_sha: source.commit }, archive_download_url: `https://api.github.com/repos/${repo}/actions/artifacts/7/zip` };
  const metadata = {
    [`/repos/${repo}/actions/workflows/release-qualification-scoped.yml`]: { id: 8, path: workflowPath, state: "active" },
    [`/repos/${repo}/actions/workflows/release-qualification-scoped.yml/runs?head_sha=${source.commit}&per_page=100`]: { total_count: 1, workflow_runs: [run] },
    [`/repos/${repo}/actions/runs/42`]: run,
    [`/repos/${repo}/actions/runs/42/attempts/2/jobs?per_page=100`]: { total_count: 3, jobs: [...jobs, terminal] },
    [`/repos/${repo}/actions/runs/42/artifacts?per_page=100`]: { total_count: 1, artifacts: [artifact] },
    [`/repos/${repo}/commits/${source.commit}/check-runs?per_page=100`]: { total_count: 1, check_runs: [{ id: 99, name: "qualify-release", app: { id: 15368 }, head_sha: source.commit, status: "completed", conclusion: "success", html_url: terminal.html_url }] },
  };
  const read = rows => requireScopedTechnicalAuthority({ source, readMetadata: async route => { assert.ok(Object.hasOwn(rows, route)); return rows[route]; }, readArtifact: async url => { assert.equal(url, artifact.archive_download_url); return original; } });
  assert.equal((await read(metadata)).terminalJobId, 99);
  for (const mutate of [rows => { rows[`/repos/${repo}/actions/runs/42`].path = ".github/workflows/release-qualification.yml"; }, rows => { rows[`/repos/${repo}/actions/runs/42`].run_attempt = 1; }, rows => { rows[`/repos/${repo}/actions/runs/42`].conclusion = "failure"; }, rows => { rows[`/repos/${repo}/commits/${source.commit}/check-runs?per_page=100`].check_runs[0].app.id = 1; }, rows => { rows[`/repos/${repo}/actions/runs/42/artifacts?per_page=100`].artifacts[0].name = "scoped-release-qualification-42-1"; }]) {
    const changed = structuredClone(metadata); mutate(changed); await assert.rejects(read(changed));
  }
  await assert.rejects(requireScopedTechnicalAuthority({ source, readMetadata: async route => metadata[route], readArtifact: async () => Buffer.from("public substitution") }), /body differs/);
});
test("original metadata ZIP inventory and allocation boundaries deny coherent header substitutions", () => {
  const archive = new ZipArchive();
  archive.addFile("mcp-product-win32.json", Buffer.from("original-win32"));
  archive.addFile("mcp-product-linux.json", Buffer.from("original-linux"));
  const bytes = archive.toBuffer(), names = ["mcp-product-win32.json", "mcp-product-linux.json"];
  assert.equal(readOriginalMetadataArtifact(bytes, names, `sha256:${digest(bytes)}`).size, 2);
  const end = bytes.length - 22, central = bytes.readUInt32LE(end + 16);
  for (const mutate of [value => value.writeUInt16LE(3, end + 10), value => value.writeUInt32LE(256 * 1024 * 1024 + 1, central + 24), value => value.writeUInt16LE(1, central + 8), value => value.writeUInt32LE(end, central + 42)]) {
    const changed = Buffer.from(bytes); mutate(changed);
    assert.throws(() => readOriginalMetadataArtifact(changed, names, `sha256:${digest(changed)}`));
  }
  assert.throws(() => readOriginalMetadataArtifact(bytes, [...names, "caller-extra.json"], `sha256:${digest(bytes)}`));
});
const clone = value => structuredClone(value);
const json = value => Buffer.from(`${JSON.stringify(value)}\n`);
const version = "2026.10.4-1234567";
function coreTarRows(rows) {
  const expanded = gunzipSync(fixtureTar(rows.map(row => [row.name, row.bytes ?? Buffer.alloc(0)])));
  let offset = 0;
  for (const row of rows) {
    const header = expanded.subarray(offset, offset + 512);
    header[156] = row.type === "Directory" ? 53 : row.type === "SymbolicLink" ? 50 : 48;
    if (row.target) header.write(row.target, 157);
    header.fill(32, 148, 156);
    header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0") + "\0 ", 148);
    offset += 512 + Math.ceil((row.bytes?.length ?? 0) / 512) * 512;
  }
  return gzipSync(expanded);
}
test("actual Core outer TAR producer remains compatible with scoped preflight", async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), "core-scoped-tar-fixture-")), rootName = "service-lasso-fixture";
  try {
    await mkdir(path.join(output, rootName));
    await writeFile(path.join(output, rootName, "identity.json"), json({ fixture: true }));
    const archive = await createReleaseArchive(output, rootName);
    const rows = await preflightScopedCoreTar(await readFile(archive), rootName);
    assert.equal(rows.get(`${rootName}/identity.json`).type, "File");
  } finally { await rm(output, { recursive: true, force: true }); }
});
test("actual outer TAR preflight rejects traversal, external links, alias descendants, cycles and duplicate names", async () => {
  const root = "service-lasso-fixture", directory = name => ({ name, type: "Directory" }), file = name => ({ name, type: "File", bytes: Buffer.from("original") });
  const base = [directory(root), file(`${root}/file`)];
  await assert.doesNotReject(preflightScopedCoreTar(coreTarRows([...base, { name: `${root}/link`, type: "SymbolicLink", target: "file" }]), root));
  for (const extras of [[file(`${root}/../escape`)], [{ name: `${root}/link`, type: "SymbolicLink", target: "../../outside" }], [directory(`${root}/real`), { name: `${root}/alias`, type: "SymbolicLink", target: "real" }, file(`${root}/alias/child`)], [{ name: `${root}/link`, type: "SymbolicLink", target: "link" }], [file(`${root}/file`)], [file(`${root}/FILE`)]]) await assert.rejects(preflightScopedCoreTar(coreTarRows([...base, ...extras]), root));
});
function candidate() {
  return createCandidate2Evidence(source, scope, new Map(scopedArchiveNames(`develop-${source.commit.slice(0, 12)}`, false).map(name => [name, Buffer.from(`original ${name}`)])));
}
function fullRelease() {
  const held = new Map(), archives = [];
  for (const name of scopedArchiveNames(version)) {
    const bytes = Buffer.from(`original ${name}`);
    held.set(name, bytes);
    const sbomName = `${name}.cdx.json`, sbomBytes = json({ bomFormat: "CycloneDX", specVersion: "1.6", metadata: { component: { name: "@service-lasso/service-lasso", version }, properties: [{ name: "service-lasso:archive-name", value: name }, { name: "service-lasso:archive-sha256", value: digest(bytes) }] }, components: [{ type: "library", name: "fixture-dependency", version: "1.0.0" }] });
    held.set(sbomName, sbomBytes);
    archives.push({ name, sha256: digest(bytes), size: bytes.length, sbom: { name: sbomName, sha256: digest(sbomBytes), size: sbomBytes.length } });
  }
  held.set("SHA256SUMS.txt", Buffer.from([...held.keys()].sort().map(name => `${digest(held.get(name))}  ${name}\n`).join("")));
  const checksum = held.get("SHA256SUMS.txt");
  const qualification = ["win32", "linux"].map((platform, index) => ({ platform, jobId: 101 + index, runId: 20, runAttempt: 2, workflowSha: source.commit, name: `${platform}.json`, sha256: digest(Buffer.from(platform)), size: platform.length }));
  return { held, evidence: { schema: "service-lasso.full-release-evidence.v1", scope, source, version, archives, checksumManifest: { name: "SHA256SUMS.txt", sha256: digest(checksum), size: checksum.length }, qualification } };
}
function publishedEvidence() {
  const platform = "linux", initialProjection = { schema: "service-lasso.qualification-first-custody-projection.v2", privateVersion: "v3", platform, candidate: { head: source.commit, tree: "b".repeat(40) }, run: { id: "20", attempt: "2" }, privateInitialReceiptSha256: "c".repeat(64), privateJournalSha256: "d".repeat(64), localValidatorAttestation: { schema: "service-lasso.qualification-local-validator-attestation.v2", validated: true } };
  const expected = { platform, initialProjection, runId: "20", runAttempt: "2", workflowSha: source.commit, coreReleaseId: "10", coreTag: version, coreRevision: source.commit, coreAsset: `service-lasso-${version}-linux.tar.gz`, coreSha256: "1".repeat(64), coreNpmVersion: version, coreNpmIntegrity: `sha512-${Buffer.from("fixture").toString("base64")}` };
  const evidence = { schema: "service-lasso.published-package-qualification.v3", retainedContent: "metadata_only", outcome: "success", platform, firstCustody: initialProjection, run: { id: 20, attempt: 2, jobId: 102, workflowSha: source.commit }, core: { releaseId: "10", tag: version, revision: source.commit, asset: expected.coreAsset, sha256: expected.coreSha256, npm: { name: "@service-lasso/service-lasso", version, integrity: expected.coreNpmIntegrity, distTag: "latest" } }, adminHarnessRevision: ADMIN_HARNESS_REVISION, harnessRevision: source.commit, retentionDays: 90, mutationRetry: false, acquisitionRetry: false, startupRetry: false, firstFailure: null, failurePhase: null, failureCode: null, mutations: { brokerRestart: 1, providerMigrationApply: 1 }, negativeProof: Object.fromEntries(["missingProvenance", "missingChecksum", "emptyPayload", "emptyChecksum", "malformedChecksum", "duplicateChecksum", "unexpectedChecksum", "mismatchedPayload", "redirectedChecksum", "redirectedProvenance", "wrongHeadProvenance"].map(id => [id, "success"])), scenarios: Object.fromEntries(["preMutationGuards", "releaseRuntime", "npmConsumer", "productionAcquisition", "firstRun", "comprehensiveLifecycle", "adminBrowser", "runtimeDashboardServices", "brokerContinuity", "trustedLifecycle", "providerReadiness", "migrationDryRun", "migrationApply", "rollback", "persistence", "durableAudit", "noLeak", "stoppedLifecycle", "cleanupConvergence"].map(id => [id, "success"])) };
  for (const [name, release] of [["admin", ADMIN_RELEASE], ["broker", BROKER_RELEASE]]) evidence[name] = { releaseId: release.id, tag: release.tag, revision: release.revision, asset: release.platforms[platform].asset, sha256: release.platforms[platform].sha256, checksumSource: "SHA256SUMS.txt" };
  evidence.adminTrustedUnlockReceipt = retainAdminTrustedUnlockReceipt(JSON.stringify({ schema: "service-lasso.admin-trusted-unlock-consumer.v1", outcome: "success", exitCode: 0, signal: null, trustedUnlock: { classification: "not_emitted" } }), { platform, coreRevision: source.commit, adminReleaseId: ADMIN_RELEASE.id, adminRevision: ADMIN_RELEASE.revision, adminHarnessRevision: ADMIN_HARNESS_REVISION });
  return { evidence, expected };
}
test("actual published reader preserves historical3 and requires complete closed scoped4", () => {
  const { evidence, expected } = publishedEvidence();
  assert.equal(validateRetainedEvidence(evidence, expected), evidence);
  const wrapper = wrapPublishedEvidence(evidence, scope);
  assert.equal(validatePublishedEvidence4(wrapper, expected), evidence);
  assert.throws(() => validatePublishedEvidence4(evidence, expected));
  for (const mutate of [value => { value.scope.policySha256 = "a".repeat(64); }, value => { value.evidence.schema = "service-lasso.published-package-qualification.v4"; }, value => { value.evidence.run.attempt = 1; }, value => { value.evidence.scenarios.cleanupConvergence = "blocked"; }, value => { value.evidence.mutationRetry = true; }, value => { value.evidence.privatePath = "forbidden"; }, value => { value.evidence.adminTrustedUnlockReceipt.consumerOutcome = "nonzero_exit"; value.evidence.adminTrustedUnlockReceipt.consumerExitCode = 7; }]) {
    const changed = clone(wrapper); mutate(changed); assert.throws(() => validatePublishedEvidence4(changed, expected));
  }
});
test("actual source policy bytes and duplicate-key rejection", async () => {
  assert.deepEqual(await readSourceScope(), scope);
  assert.throws(() => parseScopedJson(Buffer.from('{"schema":1,"schema":2}')), /duplicate/);
  assert.throws(() => parseScopedJson(Buffer.from([0xff])), /encoded|encoding|UTF/);
});
test("actual candidate producer output is accepted by actual consumer", () => {
  const { manifest, held } = candidate();
  assert.equal(held.size, 6);
  assert.deepEqual(verifyCandidate2Bytes(held, source), manifest);
  for (const mutation of [value => { value.scope.policySource.commit = "a".repeat(40); }, value => { value.source.commit = "b".repeat(40); }, value => { value.schemaVersion = 1; }, value => { value.archives[0].platform = "darwin"; }, value => { value.extra = true; }]) {
    const changed = clone(manifest); mutation(changed);
    const bytes = new Map(held); bytes.set("candidate-manifest.json", json(changed));
    assert.throws(() => verifyCandidate2Bytes(bytes, source));
  }
  const substituted = new Map(held); substituted.set(manifest.archives[0].name, Buffer.from("substituted"));
  assert.throws(() => verifyCandidate2Bytes(substituted, source), /byte/);
  const extra = new Map(held); extra.set("darwin.tar.gz", Buffer.from("extra"));
  assert.throws(() => verifyCandidate2Bytes(extra, source), /inventory/);
});
test("actual full release consumer binds thirteen held assets and twelve ASCII sums", () => {
  const { evidence, held } = fullRelease();
  assert.equal(scopedReleaseAssetNames(version).length, 13);
  assert.deepEqual(verifyFullReleaseBytes(evidence, source, held), evidence);
  for (const name of held.keys()) {
    const changed = new Map(held); changed.set(name, Buffer.from("substitution"));
    assert.throws(() => verifyFullReleaseBytes(evidence, source, changed), /byte/);
  }
  const mixed = clone(evidence); mixed.qualification[1].platform = "darwin";
  assert.throws(() => verifyFullReleaseBytes(mixed, source, held), /receipt/);
});
test("actual scoped stager and publisher fail before acquisition or provider write with empty production catalogs", async () => {
  let externalCalls = 0;
  await assert.rejects(stageOperatorTools({ scope, artifactRoot: "unused-fixture-root", fetchImpl: async () => { externalCalls++; throw new Error("must not acquire"); } }), /empty/);
  const { evidence, held } = fullRelease();
  await assert.rejects(publishFullRelease({ evidence, source, held, operatorManifest: { schemaVersion: "service-lasso.operator-tools.v3", scope, tools: [] }, jobs: [], qualificationBytes: new Map(), provider: { requireProtectedReleaseEnvironment: async () => { externalCalls++; }, createPrivateDraft: async () => { externalCalls++; } }, journal: async () => { externalCalls++; } }), /protected/);
  assert.equal(externalCalls, 0);
});
test("actual public npm tar reader checks opaque original tool and manifest buffers", async () => {
  const manifest = json({ schemaVersion: "service-lasso.operator-tools.v3", scope, tools: [] });
  const originals = new Map([["operator-tools/service-lassoctl/candidate.json", Buffer.from("held opaque tool bytes")]]);
  const entries = [["package/operator-tools/manifest.json", manifest], ...[...originals].map(([name, bytes]) => [`package/${name}`, bytes]), ["package/package.json", json({ name: "@service-lasso/service-lasso" })]];
  await assert.doesNotReject(verifyNpmOriginalToolBytes(fixtureTar(entries), manifest, originals));
  await assert.rejects(verifyNpmOriginalToolBytes(fixtureTar(entries.map(([name, bytes]) => [name, name.endsWith("candidate.json") ? Buffer.from("substitution") : bytes])), manifest, originals), /original operator bytes/);
  await assert.rejects(verifyNpmOriginalToolBytes(fixtureTar([...entries, ["package/operator-tools/undeclared", Buffer.from("extra")]]), manifest, originals), /inventory/);
  await assert.rejects(verifyNpmOriginalToolBytes(fixtureTar(entries.filter(([name]) => !name.endsWith("candidate.json"))), manifest, originals), /inventory/);
});
test("actual public readback binds asset IDs, metadata and headerless original buffers", async () => {
  const { held } = fullRelease();
  const metadata = { id: 10, name: version, tag_name: version, target_commitish: source.commit, draft: false, prerelease: false, immutable: true, assets: [...held].map(([name, bytes], index) => ({ id: index + 1, name, state: "uploaded", size: bytes.length, digest: `sha256:${digest(bytes)}`, url: `https://api.github.com/repos/${source.repository}/releases/assets/${index + 1}`, browser_download_url: `https://github.com/${source.repository}/releases/download/${version}/${name}` })) };
  const readMetadata = async () => ({ ref: `refs/tags/${version}`, object: { type: "commit", sha: source.commit } });
  const readPublicAsset = async url => held.get(metadata.assets.find(asset => asset.url === url).name);
  const input = { metadata, repository: source.repository, tag: version, sourceCommit: source.commit, held, readMetadata, readPublicAsset };
  const publication = await verifyImmutablePublicBytes(input);
  assert.equal(publication.assets.length, 13);
  assert.throws(() => assertScopedPublicationCatalog({ scope, publication }), /unapproved|empty/);
  for (const mutate of [row => { row.immutable = false; }, row => { row.target_commitish = "a".repeat(40); }, row => { row.assets[1].id = row.assets[0].id; }, row => { row.assets[0].size++; }, row => { row.assets[0].url = "https://example.invalid/body"; }, row => { row.assets.pop(); }]) {
    const changed = clone(metadata); mutate(changed);
    await assert.rejects(verifyImmutablePublicBytes({ ...input, metadata: changed }));
  }
  await assert.rejects(verifyImmutablePublicBytes({ ...input, readPublicAsset: async () => Buffer.from("same metadata, wrong public body") }), /public body/);
  await assert.rejects(resolvePublicationTag(async route => route.includes("/git/ref/") ? { ref: `refs/tags/${version}`, object: { type: "tag", sha: "a".repeat(40) } } : { sha: "a".repeat(40), object: { type: "tag", sha: "a".repeat(40) } }, source.repository, version, source.commit), /cyclic/);
});
test("current-attempt aggregate preserves old artifacts but refuses Darwin, duplicates and future attempts", () => {
  const rows = ["win32", "linux"].map(platform => ({ name: `published-package-qualification-${platform}-20-2` }));
  assert.equal(selectScopedCurrentAttemptArtifacts(rows, 20, 2).currentComplete, true);
  const prior = { name: "published-package-qualification-win32-20-1" };
  assert.deepEqual(selectScopedCurrentAttemptArtifacts([...rows, prior], 20, 2).retainedPriorAttempts, [prior]);
  for (const extra of [rows[0], { name: "published-package-qualification-darwin-20-2" }, { name: "published-package-qualification-linux-20-3" }]) assert.equal(selectScopedCurrentAttemptArtifacts([...rows, extra], 20, 2).currentComplete, false);
});
test("historical protected CLI reader remains byte compatible", () => {
  const fixture = createProtectedCliFixture();
  assert.doesNotThrow(() => verifyProtectedCliBytes(fixture.held, fixture.manifest.version, fixture.manifest.source.commit));
});
test("whole operator3 retained reader accepts exact CLI2/TUI3 bytes while empty catalogs deny eligibility", async () => {
  const fixture = createProtectedCliFixture(), held = new Map(fixture.held), manifest = clone(fixture.manifest);
  manifest.schemaVersion = 2; manifest.scope = scope;
  manifest.assets = manifest.assets.filter(asset => asset.target !== "darwin-arm64").sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  for (const name of held.keys()) if (name.includes("darwin-arm64")) held.delete(name);
  const portable = JSON.parse(held.get("candidate.json")); portable.schemaVersion = 2; portable.scope = scope;
  held.set("candidate.json", json(portable));
  const descriptor = manifest.assets.find(asset => asset.name === "candidate.json"); descriptor.sha256 = digest(held.get("candidate.json")); descriptor.size = held.get("candidate.json").length;
  manifest.checksums.entries = ["development-candidate.json", ...manifest.assets.map(asset => asset.name)].sort();
  held.set("development-candidate.json", json(manifest));
  held.set("SHA256SUMS.txt", Buffer.from(manifest.checksums.entries.map(name => `${digest(held.get(name))}  ${name}\n`).join("")));
  const ref = (name, command) => ({ name, sha256: digest(held.get(name)), relativePath: `operator-tools/${command}/${name}` });
  const cli = { command: "service-lassoctl", status: "available", receiptKind: "protected-immutable", mode: "caller-invoked", repository: manifest.source.repository, tag: manifest.candidateTag, targetCommit: manifest.source.commit, version: manifest.version, asset: portable.assets[0], checksumManifest: ref("SHA256SUMS.txt", "service-lassoctl"), candidateManifest: ref("candidate.json", "service-lassoctl"), developmentManifest: ref("development-candidate.json", "service-lassoctl"), supportedPlatforms: [...portable.platforms], assets: manifest.assets.map(asset => ({ ...asset, relativePath: `operator-tools/service-lassoctl/${asset.name}` })) };
  const tuiVersion = "2026.10.4-1234567", tuiHeld = new Map();
  const assets = ["linux-amd64", "win32-amd64"].map(platform => {
    const name = `service-lasso-tui-${tuiVersion}-${platform}.${platform.startsWith("win32") ? "zip" : "tar.gz"}`, bytes = Buffer.from(`opaque-${platform}`);
    tuiHeld.set(name, bytes);
    return { executable: platform.startsWith("win32") ? "service-lasso-tui.exe" : "service-lasso-tui", name, platform, sha256: digest(bytes) };
  });
  const sums = Buffer.from(assets.map(asset => `${asset.sha256}  ${asset.name}\n`).join(""));
  tuiHeld.set("SHA256SUMS.txt", sums);
  const tuiCandidate = { schemaVersion: 3, scope, assets, checksumManifest: { name: "SHA256SUMS.txt", sha256: digest(sums) }, corePackagingIssue: "service-lasso/service-lasso#1461", kind: "develop-prerelease-candidate", release: { draft: false, immutable: true, prerelease: true, tag: `candidate-${tuiVersion}` }, source: { commit: source.commit, ref: "refs/heads/develop", repository: "service-lasso/service-lasso-tui" }, version: tuiVersion };
  tuiHeld.set("candidate-manifest.json", json(tuiCandidate));
  const tuiRef = name => ({ name, sha256: digest(tuiHeld.get(name)), relativePath: `operator-tools/service-lasso-tui/${name}` });
  const tui = { command: "service-lasso-tui", status: "available", receiptKind: "protected-immutable", mode: "caller-attached-terminal", repository: tuiCandidate.source.repository, tag: tuiCandidate.release.tag, targetCommit: source.commit, checksumManifest: tuiRef("SHA256SUMS.txt"), candidateManifest: tuiRef("candidate-manifest.json"), assets: assets.map(asset => ({ ...asset, relativePath: `operator-tools/service-lasso-tui/${asset.name}` })) };
  const root = await mkdtemp(path.join(os.tmpdir(), "scoped-retained-source-regression-"));
  try {
    for (const [command, originals] of [["service-lassoctl", held], ["service-lasso-tui", tuiHeld]]) {
      await mkdir(path.join(root, "operator-tools", command), { recursive: true });
      for (const [name, bytes] of originals) await writeFile(path.join(root, "operator-tools", command, name), bytes);
    }
    const record = { schemaVersion: "service-lasso.operator-tools.v3", scope, tools: [cli, tui] };
    const manifestPath = path.join(root, "operator-tools/manifest.json"); await writeFile(manifestPath, json(record));
    assert.deepEqual((await validateRetainedOperatorToolBytes({ artifactRoot: root })).manifest, record);
    await assert.rejects(verifyRetainedOperatorTools({ artifactRoot: root, requireProtected: true }), /pins absent|catalog/);
    const mixed = clone(tuiCandidate); mixed.schemaVersion = 2; delete mixed.scope;
    await writeFile(path.join(root, tui.candidateManifest.relativePath), json(mixed));
    await assert.rejects(validateRetainedOperatorToolBytes({ artifactRoot: root }), /pinned release|checksum/);
    await writeFile(path.join(root, tui.candidateManifest.relativePath), json(tuiCandidate));
    const expandedSums = Buffer.concat([sums, Buffer.from(`${digest(tuiHeld.get("candidate-manifest.json"))}  candidate-manifest.json\n`)]);
    await writeFile(path.join(root, tui.checksumManifest.relativePath), expandedSums);
    await assert.rejects(validateRetainedOperatorToolBytes({ artifactRoot: root }), /checksum/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("scoped protected CLI reader accepts exactly protected2/portable2 and denies mixed versions", () => {
  const fixture = createProtectedCliFixture(), held = new Map(fixture.held), manifest = clone(fixture.manifest);
  manifest.schemaVersion = 2; manifest.scope = scope;
  manifest.assets = manifest.assets.filter(asset => asset.target !== "darwin-arm64").sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  for (const name of held.keys()) if (name.includes("darwin-arm64")) held.delete(name);
  const portable = JSON.parse(held.get("candidate.json")); portable.schemaVersion = 2; portable.scope = scope;
  held.set("candidate.json", json(portable));
  const descriptor = manifest.assets.find(asset => asset.name === "candidate.json");
  descriptor.sha256 = digest(held.get("candidate.json")); descriptor.size = held.get("candidate.json").length;
  manifest.checksums.entries = ["development-candidate.json", ...manifest.assets.map(asset => asset.name)].sort();
  function seal() {
    held.set("development-candidate.json", json(manifest));
    held.set("SHA256SUMS.txt", Buffer.from(manifest.checksums.entries.map(name => `${digest(held.get(name))}  ${name}\n`).join("")));
  }
  seal();
  assert.equal(held.size, 8);
  assert.equal(verifyProtectedCliBytes(held, manifest.version, manifest.source.commit).schemaVersion, 2);
  portable.schemaVersion = 1; delete portable.scope;
  held.set("candidate.json", json(portable));
  descriptor.sha256 = digest(held.get("candidate.json")); descriptor.size = held.get("candidate.json").length; seal();
  assert.throws(() => verifyProtectedCliBytes(held, manifest.version, manifest.source.commit), /mixed/);
  portable.schemaVersion = 2; portable.scope = scope;
  held.set("candidate.json", json(portable)); descriptor.sha256 = digest(held.get("candidate.json")); descriptor.size = held.get("candidate.json").length; seal();
  const originalHeld = new Map(held), originalManifest = clone(manifest);
  for (const mutate of [value => { value.tools.node = "22.0.0"; }, value => { value.sea.useCodeCache = true; }, value => { value.executable.architecture = "arm64"; }]) {
    const altered = clone(originalManifest), changed = new Map(originalHeld);
    const provenance = JSON.parse(fixture.held.get("provenance-win32-x64.json")); mutate(provenance);
    const provenanceBytes = json(provenance);
    changed.set("provenance-win32-x64.json", provenanceBytes);
    const archiveName = `service-lassoctl-${manifest.version}-win32-x64.tar.gz`;
    changed.set(archiveName, fixtureTar(fixture.nativeMembers.get("win32-x64").map(([name, bytes]) => [name, name === "provenance.json" ? provenanceBytes : bytes])));
    for (const name of [archiveName, "provenance-win32-x64.json"]) {
      const asset = altered.assets.find(row => row.name === name); asset.sha256 = digest(changed.get(name)); asset.size = changed.get(name).length;
    }
    changed.set("development-candidate.json", json(altered));
    changed.set("SHA256SUMS.txt", Buffer.from(altered.checksums.entries.map(name => `${digest(changed.get(name))}  ${name}\n`).join("")));
    assert.throws(() => verifyProtectedCliBytes(changed, manifest.version, manifest.source.commit), /tool\/SEA|forged identity/);
  }
});
