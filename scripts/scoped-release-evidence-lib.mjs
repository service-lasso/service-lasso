import { isDeepStrictEqual } from "node:util";
import { assertByteRef, assertReceiptRefs, assertRun, assertScope, assertSource, closed, digest, parseScopedJson, REQUIRED_GA_PLATFORMS } from "./ga-platform-scope-lib.mjs";
import { validateRetainedEvidence, validateTerminalJobMetadata } from "./published-package-qualification-lib.mjs";

function assertCoreSource(source) {
  assertSource(source, { repository: "service-lasso/service-lasso", commit: source?.commit, ref: "refs/heads/develop" });
}

export function scopedArchiveNames(version, generic = true) {
  if (!/^(?:develop-[a-f0-9]{12}|20[0-9]{2}\.[1-9][0-9]*\.[1-9][0-9]*-[a-f0-9]{7})$/u.test(version)) throw new Error("invalid scoped version");
  return [ ...(generic ? [`service-lasso-${version}.tar.gz`, `service-lasso-bundled-${version}.tar.gz`] : []), ...["", "bundled-"].flatMap(kind => [`service-lasso-${kind}${version}-win32.zip`, `service-lasso-${kind}${version}-linux.tar.gz`]) ];
}
export function scopedReleaseAssetNames(version) {
  const names = scopedArchiveNames(version);
  return [...names, ...names.map(name => `${name}.cdx.json`), "SHA256SUMS.txt"];
}
export function assertNames(actual, expected) {
  if (!Array.isArray(actual) || actual.length !== expected.length || !isDeepStrictEqual([...actual].sort(), [...expected].sort())) throw new Error("scoped inventory mismatch");
}
export function validateCandidate2(value, source) {
  assertCoreSource(source);
  closed(value, ["schemaVersion", "kind", "source", "nonGoals", "archives", "scope"], "candidate2");
  assertScope(value.scope);
  closed(value.source, ["repository", "commit", "ref"], "candidate source");
  if (!isDeepStrictEqual(value.source, { ...source, ref: "develop" }) || value.schemaVersion !== 2 || value.kind !== "core-development-candidate" || !isDeepStrictEqual(value.nonGoals, ["github-release", "npm-publication", "deployment", "promotion", "release-environment", "ga"])) throw new Error("candidate2 identity mismatch");
  const names = scopedArchiveNames(`develop-${source.commit.slice(0, 12)}`, false).sort();
  assertNames(value.archives?.map(row => row.name), names);
  if (!isDeepStrictEqual(value.archives.map(row => row.name), names)) throw new Error("candidate2 archive order mismatch");
  for (const row of value.archives) {
    closed(row, ["artifact", "platform", "name", "sha256"], "candidate archive");
    if (!REQUIRED_GA_PLATFORMS.includes(row.platform) || !["bundled", "unbundled"].includes(row.artifact) || row.name !== `service-lasso-${row.artifact === "bundled" ? "bundled-" : ""}develop-${source.commit.slice(0, 12)}-${row.platform}${row.platform === "win32" ? ".zip" : ".tar.gz"}` || !/^[a-f0-9]{64}$/u.test(row.sha256)) throw new Error("candidate2 archive mapping mismatch");
  }
  return value;
}
export function createCandidate2Evidence(source, scope, archiveBytes) {
  assertScope(scope);
  const names = scopedArchiveNames(`develop-${source.commit.slice(0, 12)}`, false).sort();
  assertNames([...archiveBytes.keys()], names);
  const manifest = { schemaVersion: 2, scope, kind: "core-development-candidate", source: { ...source, ref: "develop" }, nonGoals: ["github-release", "npm-publication", "deployment", "promotion", "release-environment", "ga"], archives: names.map(name => {
    const bytes = archiveBytes.get(name);
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error("candidate producer original archive bytes missing");
    return { artifact: name.startsWith("service-lasso-bundled-") ? "bundled" : "unbundled", platform: name.endsWith("-win32.zip") ? "win32" : "linux", name, sha256: digest(bytes) };
  }) };
  validateCandidate2(manifest, source);
  const held = new Map(archiveBytes);
  held.set("candidate-manifest.json", Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
  held.set("SHA256SUMS.txt", Buffer.from([...held.keys()].sort().map(name => `${digest(held.get(name))}  ${name}\n`).join("")));
  verifyCandidate2Bytes(held, source);
  return { manifest, held };
}
export function verifyCandidate2Bytes(held, source) {
  const manifest = validateCandidate2(parseScopedJson(held.get("candidate-manifest.json")), source);
  const names = [...manifest.archives.map(row => row.name), "candidate-manifest.json", "SHA256SUMS.txt"];
  assertNames([...held.keys()], names);
  for (const row of manifest.archives) if (digest(held.get(row.name)) !== row.sha256) throw new Error("candidate2 byte mismatch");
  const sums = names.filter(name => name !== "SHA256SUMS.txt").sort().map(name => `${digest(held.get(name))}  ${name}\n`).join("");
  if (held.get("SHA256SUMS.txt").toString("utf8") !== sums) throw new Error("candidate2 checksum mismatch");
  return manifest;
}
export function validateTechnicalQualification(value, source) {
  assertCoreSource(source);
  closed(value, ["schema", "scope", "source", "run", "platforms", "receipts", "outcome"], "technical qualification");
  if (value.schema !== "service-lasso.release-qualification.v1" || value.outcome !== "success" || !isDeepStrictEqual(value.platforms, REQUIRED_GA_PLATFORMS)) throw new Error("technical qualification is not exact success");
  assertScope(value.scope); assertSource(value.source, source); assertRun(value.run); assertReceiptRefs(value.receipts);
  if (value.receipts.some(row => row.runId !== value.run.id || row.runAttempt !== value.run.attempt || row.workflowSha !== value.run.workflowSha) || value.run.workflowSha !== source.commit) throw new Error("technical qualification run mismatch");
  return value;
}
export function verifyQualificationReceipts(value, source, jobs, held) {
  validateTechnicalQualification(value, source);
  assertNames([...held.keys()], value.receipts.map(row => row.name));
  for (const row of value.receipts) {
    const matches = jobs.filter(job => job.id === row.jobId);
    if (matches.length !== 1 || matches[0].name !== `published-package-qualification (${row.platform})`) throw new Error("qualification receipt job mismatch");
    validateTerminalJobMetadata(matches[0], { name: matches[0].name, repo: source.repository, jobId: row.jobId, runId: row.runId, runAttempt: row.runAttempt, workflowSha: row.workflowSha });
    const bytes = held.get(row.name);
    if (!Buffer.isBuffer(bytes) || bytes.length !== row.size || digest(bytes) !== row.sha256) throw new Error("qualification receipt bytes mismatch");
  }
  return value;
}
export function wrapPublishedEvidence(evidence, scope) {
  assertScope(scope);
  if (evidence?.schema !== "service-lasso.published-package-qualification.v3" || !REQUIRED_GA_PLATFORMS.includes(evidence.platform)) throw new Error("published wrapper body version/target mismatch");
  return { schema: "service-lasso.published-package-qualification.v4", scope, evidence };
}
export function validatePublishedEvidence4(wrapper, expected) {
  closed(wrapper, ["schema", "scope", "evidence"], "published qualification4");
  if (wrapper.schema !== "service-lasso.published-package-qualification.v4") throw new Error("published qualification downgrade");
  assertScope(wrapper.scope);
  if (!REQUIRED_GA_PLATFORMS.includes(expected.platform)) throw new Error("published platform outside policy");
  closed(wrapper.evidence, ["schema", "retainedContent", "outcome", "platform", "firstCustody", "core", "admin", "broker", "adminHarnessRevision", "harnessRevision", "retentionDays", "mutationRetry", "acquisitionRetry", "startupRetry", "firstFailure", "failurePhase", "failureCode", "negativeProof", "scenarios", "run", "adminTrustedUnlockReceipt", "mutations"], "published4 retained success body");
  closed(wrapper.evidence.run, ["id", "attempt", "jobId", "workflowSha"], "published4 run");
  closed(wrapper.evidence.core, ["releaseId", "tag", "revision", "asset", "sha256", "npm"], "published4 Core");
  closed(wrapper.evidence.core.npm, ["name", "version", "integrity", "distTag"], "published4 npm");
  for (const name of ["admin", "broker"]) closed(wrapper.evidence[name], ["releaseId", "tag", "revision", "asset", "sha256", "checksumSource"], `published4 ${name}`);
  closed(wrapper.evidence.mutations, ["brokerRestart", "providerMigrationApply"], "published4 mutations");
  if (wrapper.evidence.adminTrustedUnlockReceipt?.consumerOutcome !== "success" || wrapper.evidence.adminTrustedUnlockReceipt.consumerExitCode !== 0 || wrapper.evidence.adminTrustedUnlockReceipt.consumerSignal !== null || wrapper.evidence.adminTrustedUnlockReceipt.consumerFailure !== null) throw new Error("published4 observed Admin consumer failure is not success");
  if (wrapper.evidence.harnessRevision !== expected.workflowSha || wrapper.evidence.failureCode !== null || wrapper.evidence.failurePhase !== null && wrapper.evidence.failurePhase !== wrapper.evidence.firstFailure?.phase) throw new Error("published4 source/first-failure binding differs");
  validateRetainedEvidence(wrapper.evidence, expected);
  return wrapper.evidence;
}
export function validateFullReleaseEvidence(value, source) {
  assertCoreSource(source);
  closed(value, ["schema", "scope", "source", "version", "archives", "checksumManifest", "qualification"], "full release evidence");
  if (value.schema !== "service-lasso.full-release-evidence.v1") throw new Error("full release evidence schema mismatch");
  assertScope(value.scope); assertSource(value.source, source); assertReceiptRefs(value.qualification);
  if (value.qualification.some(row => row.workflowSha !== source.commit || row.runId !== value.qualification[0].runId || row.runAttempt !== value.qualification[0].runAttempt)) throw new Error("full release qualification source/attempt differs");
  const names = scopedArchiveNames(value.version);
  if (!isDeepStrictEqual(value.archives?.map(row => row.name), names)) throw new Error("full release semantic archive order mismatch");
  for (const row of value.archives) {
    closed(row, ["name", "sha256", "size", "sbom"], "full release archive");
    assertByteRef({ name: row.name, sha256: row.sha256, size: row.size }); assertByteRef(row.sbom);
    if (row.sbom.name !== `${row.name}.cdx.json`) throw new Error("archive SBOM binding mismatch");
  }
  assertByteRef(value.checksumManifest);
  if (value.checksumManifest.name !== "SHA256SUMS.txt" || !value.version.endsWith(source.commit.slice(0, 7))) throw new Error("full release source/version mismatch");
  return value;
}

export function verifyFullReleaseBytes(value, source, held) {
  validateFullReleaseEvidence(value, source);
  assertNames([...held.keys()], scopedReleaseAssetNames(value.version));
  const refs = [...value.archives.flatMap(row => [{ name: row.name, sha256: row.sha256, size: row.size }, row.sbom]), value.checksumManifest];
  for (const row of refs) {
    const bytes = held.get(row.name);
    if (!Buffer.isBuffer(bytes) || bytes.length !== row.size || digest(bytes) !== row.sha256) throw new Error("full release held byte substitution");
  }
  for (const row of value.archives) {
    const sbom = parseScopedJson(held.get(row.sbom.name), "archive SBOM");
    const properties = sbom?.metadata?.properties;
    if (sbom.bomFormat !== "CycloneDX" || sbom.specVersion !== "1.6" || sbom.metadata?.component?.name !== "@service-lasso/service-lasso" || sbom.metadata?.component?.version !== value.version || !Array.isArray(sbom.components) || sbom.components.length === 0 || !Array.isArray(properties) || properties.filter(item => item.name === "service-lasso:archive-name").length !== 1 || properties.find(item => item.name === "service-lasso:archive-name")?.value !== row.name || properties.filter(item => item.name === "service-lasso:archive-sha256").length !== 1 || properties.find(item => item.name === "service-lasso:archive-sha256")?.value !== row.sha256) throw new Error("full release SBOM archive binding mismatch");
  }
  const sums = refs.filter(row => row.name !== "SHA256SUMS.txt").sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0).map(row => `${row.sha256}  ${row.name}\n`).join("");
  if (held.get("SHA256SUMS.txt").toString("utf8") !== sums) throw new Error("full release checksum inventory mismatch");
  return value;
}
export function validateNpmPublicationEvidence(value, source) {
  assertCoreSource(source);
  closed(value, ["schema", "scope", "source", "version", "package", "operatorTools", "qualification"], "npm publication");
  if (value.schema !== "service-lasso.npm-publication-evidence.v1") throw new Error("npm publication schema mismatch");
  assertScope(value.scope); assertSource(value.source, source); assertReceiptRefs(value.qualification);
  if (value.qualification.some(row => row.workflowSha !== source.commit || row.runId !== value.qualification[0].runId || row.runAttempt !== value.qualification[0].runAttempt)) throw new Error("npm qualification source/attempt differs");
  closed(value.package, ["name", "version", "gitHead", "integrity", "distTag", "tarballSha256", "size"], "npm package");
  if (value.package.name !== "@service-lasso/service-lasso" || value.package.version !== value.version || value.package.gitHead !== source.commit || value.package.distTag !== "latest" || !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(value.package.integrity) || !value.version.endsWith(source.commit.slice(0, 7))) throw new Error("npm publication identity mismatch");
  assertByteRef({ name: "package.tgz", sha256: value.package.tarballSha256, size: value.package.size });
  closed(value.operatorTools, ["schemaVersion", "manifestSha256", "assets"], "npm operator tools");
  if (value.operatorTools.schemaVersion !== "service-lasso.operator-tools.v3" || !/^[a-f0-9]{64}$/u.test(value.operatorTools.manifestSha256) || !Array.isArray(value.operatorTools.assets) || value.operatorTools.assets.length === 0) throw new Error("npm operator tools identity mismatch");
  for (const row of value.operatorTools.assets) assertByteRef(row);
  const names = value.operatorTools.assets.map(row => row.name);
  if (new Set(names).size !== names.length || !isDeepStrictEqual(names, [...names].sort())) throw new Error("npm operator tools byte inventory mismatch");
  return value;
}
