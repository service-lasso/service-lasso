import { createHash } from "node:crypto";
import { validateMcpProductEvidence } from "./mcp-product-acceptance-lib.mjs";
import { isDeepStrictEqual } from "node:util";
import { assertByteRef, assertScope, assertSource, closed, digest, parseScopedJson } from "./ga-platform-scope-lib.mjs";
import { assertNames, validateNpmPublicationEvidence, verifyFullReleaseBytes } from "./scoped-release-evidence-lib.mjs";
import { assertProtectedOperatorTools } from "./operator-tool-packaging-lib.mjs";
import { validateTerminalJobMetadata } from "./published-package-qualification-lib.mjs";

// A provider response is evidence only. Source pins remain the sole catalog
// authority. This object deliberately stays empty until a pins-only review.
export const APPROVED_SCOPED_PUBLICATIONS = Object.freeze([]);

export function assertScopedPublicationCatalog(identity) {
  assertScope(identity?.scope);
  if (!APPROVED_SCOPED_PUBLICATIONS.some(pin => isDeepStrictEqual(pin, identity))) throw new Error("scoped immutable publication catalog is empty or identity unapproved");
}
export function assertScopedCoreReleaseCatalog(metadata, scope, sourceCommit, expectedNames) {
  assertScope(scope);
  if (!Number.isSafeInteger(metadata?.id) || metadata.id < 1 || metadata.draft !== false || metadata.prerelease !== false || metadata.immutable !== true || metadata.target_commitish !== sourceCommit || metadata.name !== metadata.tag_name || !Array.isArray(metadata.assets)) throw new Error("scoped Core publication metadata differs");
  assertNames(metadata.assets.map(row => row.name), expectedNames);
  const ids = new Set();
  const assets = [...metadata.assets].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0).map(row => {
    if (!Number.isSafeInteger(row.id) || row.id < 1 || ids.has(row.id) || !Number.isSafeInteger(row.size) || row.size < 1 || !/^sha256:[a-f0-9]{64}$/u.test(row.digest) || row.state !== "uploaded" || row.url !== `https://api.github.com/repos/service-lasso/service-lasso/releases/assets/${row.id}` || row.browser_download_url !== `https://github.com/service-lasso/service-lasso/releases/download/${metadata.tag_name}/${row.name}`) throw new Error("scoped Core publication asset identity differs");
    ids.add(row.id);
    return { id: row.id, name: row.name, url: row.url, size: row.size, sha256: row.digest.slice(7) };
  });
  const identity = { scope, publication: { repository: "service-lasso/service-lasso", releaseId: metadata.id, tag: metadata.tag_name, targetCommit: sourceCommit, draft: false, prerelease: false, immutable: true, assets } };
  assertScopedPublicationCatalog(identity);
  return identity;
}

export function verifyPublicationQualification(refs, source, jobs, held, jobPrefix) {
  // Only source-owned producer/qualification job selectors are permitted.
  if (!["mcp-packaged", "published-package-qualification"].includes(jobPrefix)) throw new Error("unknown publication qualification selector");
  const runs = new Set();
  for (const ref of refs) {
    const matches = jobs.filter(job => job.id === ref.jobId && job.name === `${jobPrefix} (${ref.platform})`);
    if (matches.length !== 1) throw new Error("publication qualification job absent/duplicate");
    validateTerminalJobMetadata(matches[0], { repo: source.repository, name: matches[0].name, jobId: ref.jobId, runId: ref.runId, runAttempt: ref.runAttempt, workflowSha: ref.workflowSha });
    if (ref.workflowSha !== source.commit) throw new Error("publication qualification candidate differs");
    const bytes = held.get(ref.name);
    if (!Buffer.isBuffer(bytes) || bytes.length !== ref.size || digest(bytes) !== ref.sha256) throw new Error("publication qualification receipt bytes differ");
    const body = parseScopedJson(bytes, "publication native receipt");
    if (jobPrefix === "mcp-packaged") {
      validateMcpProductEvidence(body, { candidateSha: source.commit, platform: ref.platform });
      if (String(body.workflowRunId) !== String(ref.runId) || String(body.workflowRunAttempt) !== String(ref.runAttempt) || body.repository !== source.repository || body.architecture !== "x64") throw new Error("publication MCP receipt source/run/architecture differs");
    } else throw new Error("published receipts require the complete v4 aggregate validator");
    runs.add(`${ref.runId}:${ref.runAttempt}:${ref.workflowSha}`);
  }
  if (refs.length !== 2 || refs[0].platform !== "win32" || refs[1].platform !== "linux" || new Set(refs.map(ref => ref.jobId)).size !== 2 || runs.size !== 1) throw new Error("publication qualification aggregate differs");
}

export async function resolvePublicationTag(readMetadata, repository, tag, expectedCommit) {
  let ref = await readMetadata(`/repos/${repository}/git/ref/tags/${tag}`);
  if (ref?.ref !== `refs/tags/${tag}`) throw new Error("publication tag ref differs");
  let object = ref.object;
  const visited = new Set();
  for (let depth = 0; depth <= 16; depth++) {
    if (!object || !/^[a-f0-9]{40}$/u.test(object.sha) || !["commit", "tag"].includes(object.type) || visited.has(object.sha)) throw new Error("publication tag malformed/cyclic");
    visited.add(object.sha);
    if (object.type === "commit") {
      if (object.sha !== expectedCommit) throw new Error("publication tag commit differs");
      return;
    }
    if (depth === 16) throw new Error("publication tag depth exceeded");
    const row = await readMetadata(`/repos/${repository}/git/tags/${object.sha}`);
    if (row?.sha !== object.sha) throw new Error("publication annotated tag object differs");
    object = row.object;
  }
}

export async function verifyImmutablePublicBytes({ metadata, repository, tag, sourceCommit, held, readMetadata, readPublicAsset, prerelease = false }) {
  if (repository !== "service-lasso/service-lasso" || metadata?.tag_name !== tag || metadata.name !== tag || metadata.target_commitish !== sourceCommit || metadata.draft !== false || metadata.prerelease !== prerelease || metadata.immutable !== true || !Number.isSafeInteger(metadata.id) || metadata.id < 1) throw new Error("public immutable release identity differs");
  if (!Array.isArray(metadata.assets)) throw new Error("public release inventory missing");
  assertNames(metadata.assets.map(row => row.name), [...held.keys()]);
  await resolvePublicationTag(readMetadata, repository, tag, sourceCommit);
  const ids = new Set();
  const rows = [];
  for (const asset of [...metadata.assets].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const bytes = held.get(asset.name);
    if (!Buffer.isBuffer(bytes) || !Number.isSafeInteger(asset.id) || asset.id < 1 || ids.has(asset.id) || asset.state !== "uploaded" || asset.size !== bytes.length || asset.digest !== `sha256:${digest(bytes)}` || asset.url !== `https://api.github.com/repos/${repository}/releases/assets/${asset.id}` || asset.browser_download_url !== `https://github.com/${repository}/releases/download/${tag}/${asset.name}`) throw new Error("public release asset identity differs");
    ids.add(asset.id);
    const publicBytes = await readPublicAsset(asset.url);
    if (!Buffer.isBuffer(publicBytes) || !publicBytes.equals(bytes)) throw new Error("public body differs from held producer bytes");
    rows.push({ id: asset.id, name: asset.name, url: asset.url, size: bytes.length, sha256: digest(bytes) });
  }
  return { repository, releaseId: metadata.id, tag, targetCommit: sourceCommit, draft: false, prerelease, immutable: true, assets: rows };
}

export async function publishFullRelease({ evidence, source, held, operatorManifest, jobs, qualificationBytes, provider, journal }) {
  verifyFullReleaseBytes(evidence, source, held);
  assertProtectedOperatorTools(operatorManifest);
  if (operatorManifest.schemaVersion !== "service-lasso.operator-tools.v3") throw new Error("scoped publication requires operator3");
  assertScope(operatorManifest.scope);
  verifyPublicationQualification(evidence.qualification, source, jobs, qualificationBytes, "mcp-packaged");
  // Provider environment enforcement belongs to actual provider controls;
  // this callback only reads their protected preflight and never enables them.
  await provider.requireProtectedReleaseEnvironment(source);
  await journal({ phase: "verified", source, scope: evidence.scope });
  const draft = await provider.createPrivateDraft({ tag: evidence.version, targetCommit: source.commit });
  if (!Number.isSafeInteger(draft?.id) || draft.id < 1 || draft.draft !== true || draft.tag_name !== evidence.version || draft.target_commitish !== source.commit) throw new Error("private draft identity differs");
  await journal({ phase: "private_draft", releaseId: draft.id, source, scope: evidence.scope });
  for (const name of [...held.keys()].sort()) {
    await provider.requireProtectedReleaseEnvironment(source);
    await provider.uploadHeldAsset(draft.id, name, held.get(name));
  }
  await provider.verifyPrivateDraft(draft.id, held);
  await journal({ phase: "private_verified", releaseId: draft.id, source, scope: evidence.scope });
  await provider.requireProtectedReleaseEnvironment(source);
  const metadata = await provider.finalizeImmutable(draft.id);
  const publication = await verifyImmutablePublicBytes({ metadata, repository: source.repository, tag: evidence.version, sourceCommit: source.commit, held, readMetadata: provider.readMetadata, readPublicAsset: provider.readPublicAsset });
  await journal({ phase: "immutable_public_readback", publication, source, scope: evidence.scope });
  return { evidence, publication };
}

export function verifyNpmPublication({ evidence, source, metadata, distTags, tarball, operatorManifest, manifestBytes, originalToolBytes }) {
  validateNpmPublicationEvidence(evidence, source);
  if (!Buffer.isBuffer(manifestBytes) || digest(manifestBytes) !== evidence.operatorTools.manifestSha256 || !isDeepStrictEqual(parseScopedJson(manifestBytes, "npm original operator manifest"), operatorManifest)) throw new Error("npm original manifest parser/hash custody differs");
  assertProtectedOperatorTools(operatorManifest);
  if (operatorManifest.schemaVersion !== "service-lasso.operator-tools.v3" || !isDeepStrictEqual(operatorManifest.scope, evidence.scope)) throw new Error("npm retained operator scope differs");
  if (metadata?.name !== evidence.package.name || metadata.version !== evidence.version || metadata.gitHead !== source.commit || metadata.dist?.integrity !== evidence.package.integrity || distTags?.latest !== evidence.version || !Buffer.isBuffer(tarball) || tarball.length !== evidence.package.size || digest(tarball) !== evidence.package.tarballSha256 || `sha512-${createHash("sha512").update(tarball).digest("base64")}` !== evidence.package.integrity) throw new Error("actual npm registry/public bytes differ");
  const url = new URL(metadata.dist.tarball);
  if (url.protocol !== "https:" || url.hostname !== "registry.npmjs.org") throw new Error("npm public URL differs");
  assertNames([...originalToolBytes.keys()], evidence.operatorTools.assets.map(row => row.name));
  for (const row of evidence.operatorTools.assets) {
    assertByteRef(row);
    const bytes = originalToolBytes.get(row.name);
    if (!Buffer.isBuffer(bytes) || bytes.length !== row.size || digest(bytes) !== row.sha256) throw new Error("npm original operator bytes differ");
  }
  return evidence;
}

// Only the protected environment publisher receives this separate credential.
// Provider reads still prove permissions; a supplied token is not capability proof.
export function requireScopedPublisherCredential(env = process.env) {
  const token = env.DEVELOPMENT_CANDIDATE_TOKEN;
  if (typeof token !== "string" || token.trim().length === 0) throw new Error("scoped publisher environment credential missing");
  return token;
}
