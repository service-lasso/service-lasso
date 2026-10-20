import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createProtectedCliFixture, fixtureTar } from "./fixtures/protected-operator-cli.mjs";
import { createOperatorToolReleaseResponseFixture } from "./fixtures/operator-tool-release-response.mjs";
import { verifyProtectedCliBytes } from "../scripts/operator-tool-cli-contract.mjs";
import { assertProtectedOperatorTools, CURRENT_CLI_RELEASE, CURRENT_TUI_RELEASE, stageOperatorTools, validateRetainedOperatorToolBytes, verifyRetainedOperatorTools } from "../scripts/operator-tool-packaging-lib.mjs";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const encode = value => Buffer.from(JSON.stringify(value));
function rebound(fixture) {
  for (const asset of fixture.manifest.assets) { asset.sha256 = hash(fixture.held.get(asset.name)); asset.size = fixture.held.get(asset.name).length; }
  fixture.held.set("development-candidate.json", encode(fixture.manifest));
  fixture.held.set("SHA256SUMS.txt", Buffer.from([{ name: "development-candidate.json", sha256: hash(fixture.held.get("development-candidate.json")) }, ...fixture.manifest.assets].sort((a, b) => a.name.localeCompare(b.name)).map(asset => `${asset.sha256}  ${asset.name}\n`).join("")));
  return fixture;
}
const verify = fixture => verifyProtectedCliBytes(fixture.held, fixture.cliRelease.version, fixture.cliRelease.targetCommit);

test("AC-4CG / AC-7G entire current CLI producer-shaped inventory retains all native tuples", () => {
  const fixture = createProtectedCliFixture();
  assert.equal(fixture.held.size, 10);
  const manifest = verify(fixture);
  assert.equal(manifest.assets.length, 8);
  assert.equal(manifest.checksums.entries.length, 9);
  assert.deepEqual(manifest.assets.filter(asset => asset.kind === "native").map(asset => asset.target), ["win32-x64", "linux-x64", "darwin-arm64"]);
});

for (const [name, mutate, expectedError = /rejected/i] of [
  ["missing native archive", fixture => fixture.held.delete(fixture.manifest.assets.find(asset => asset.kind === "native").name)],
  ["extra published file", fixture => fixture.held.set("extra.json", encode({}))],
  ["checksum substitution", fixture => fixture.held.set("SHA256SUMS.txt", Buffer.from("not exact"))],
  ["source drift", fixture => { fixture.manifest.source.commit = "a".repeat(40); rebound(fixture); }],
  ["version drift", fixture => { fixture.manifest.version = "0.1.0-dev.aaaaaaa"; rebound(fixture); }],
  ["tag drift", fixture => { fixture.manifest.candidateTag = "latest"; rebound(fixture); }],
  ["wrong repository", fixture => { fixture.manifest.source.repository = "other/cli"; rebound(fixture); }],
  ["manifest schema drift without required scope", fixture => { fixture.manifest.schemaVersion = 2; rebound(fixture); }, { message: "scope: closed schema mismatch" }],
  ["unknown manifest schema", fixture => { fixture.manifest.schemaVersion = 3; rebound(fixture); }, { message: "Protected candidate rejected: unknown candidate schema" }],
  ["extra manifest field", fixture => { fixture.manifest.accepted = true; rebound(fixture); }],
  ["duplicate trusted JSON key", fixture => { const text = fixture.held.get("development-candidate.json").toString(); fixture.held.set("development-candidate.json", Buffer.from(text.replace('{"schemaVersion":1,', '{"schemaVersion":1,"schemaVersion":1,'))); }],
  ["checksum declaration incomplete", fixture => { fixture.manifest.checksums.entries.pop(); rebound(fixture); }],
  ["native sidecar substitution", fixture => { fixture.held.set("provenance-win32-x64.json", encode({ ...JSON.parse(fixture.held.get("provenance-win32-x64.json")), source: { commit: "a".repeat(40) } })); rebound(fixture); }],
]) test(`AC-7G rejects ${name}`, () => { const fixture = createProtectedCliFixture(); mutate(fixture); assert.throws(() => verify(fixture), expectedError); });

for (const [name, mutate] of [
  ["extra native member", members => members.push(["extra", Buffer.from("extra")])],
  ["native executable substitution", members => { members[0][1] = Buffer.from("substituted"); }],
  ["confined helper substitution", members => { members[1][1] = Buffer.from("substituted"); }],
  ["dispatch context drift", members => { const member = members.find(([name]) => name === "ci-context.json"); const context = JSON.parse(member[1]); context.eventName = "push"; member[1] = encode(context); }],
  ["unavailable no-Node proof", members => { const member = members.find(([name]) => name === "host-acceptance.json"); const record = JSON.parse(member[1]); record.nodeAbsentFromPath = false; member[1] = encode(record); }],
  ["acceptance digest substitution", members => { const member = members.find(([name]) => name === "host-acceptance.json"); const record = JSON.parse(member[1]); record.evidenceDigest = "a".repeat(64); member[1] = encode(record); }],
  ["archive traversal", members => { members[0][0] = "../service-lassoctl.exe"; }],
]) test(`AC-7G rejects repinned ${name}`, () => {
  const fixture = createProtectedCliFixture(), members = fixture.nativeMembers.get("win32-x64");
  mutate(members);
  fixture.held.set(`service-lassoctl-${fixture.cliRelease.version}-win32-x64.tar.gz`, fixtureTar(members));
  rebound(fixture);
  assert.throws(() => verify(fixture), /rejected/i);
});

for (const patch of [{ immutable: false }, { immutable: undefined }, { draft: true }, { prerelease: false }, { target_commitish: "a".repeat(40) }, { tag_name: "latest" }]) test(`AC-7F public candidate rejects ${JSON.stringify(patch)}`, async () => {
  const fixture = await createOperatorToolReleaseResponseFixture(), root = await mkdtemp(path.join(os.tmpdir(), "tool-contract-negative-"));
  try {
    const fetchImpl = async (url, options) => { const response = await fixture.fetchImpl(url, options); if (new URL(url).hostname !== "api.github.com") return response; return Response.json({ ...await response.json(), ...patch }); };
    await assert.rejects(stageOperatorTools({ artifactRoot: root, ...fixture, fetchImpl }), /identity/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const [name, mutate] of [
  ["old TUI schema", manifest => { manifest.schemaVersion = 1; }],
  ["wrong TUI source ref", manifest => { manifest.source.ref = "develop"; }],
  ["extra TUI field", manifest => { manifest.accepted = true; }],
  ["wrong TUI executable", manifest => { manifest.assets[0].executable = "other"; }],
  ["mutable TUI manifest", manifest => { manifest.release.immutable = false; }],
]) test(`AC-4CG rejects repinned ${name}`, async () => {
  const fixture = await createOperatorToolReleaseResponseFixture(), root = await mkdtemp(path.join(os.tmpdir(), "tui-contract-negative-"));
  try {
    const original = await fixture.fetchImpl(`https://github.com/${fixture.release.repository}/releases/download/${fixture.release.tag}/candidate-manifest.json`);
    const manifest = await original.json(); mutate(manifest); const bytes = encode(manifest);
    fixture.release.candidateManifest.sha256 = hash(bytes);
    const fetchImpl = async (url, options) => new URL(url).pathname.endsWith("/candidate-manifest.json") ? new Response(bytes) : fixture.fetchImpl(url, options);
    await assert.rejects(stageOperatorTools({ artifactRoot: root, release: fixture.release, cliRelease: null, fetchImpl }), /manifest|platform/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("AC-4CG retained full inventory validates then rejects native/provenance substitution and forged receipt kind", async () => {
  const fixture = await createOperatorToolReleaseResponseFixture(), root = await mkdtemp(path.join(os.tmpdir(), "tool-retained-contract-"));
  try {
    const manifest = await stageOperatorTools({ artifactRoot: root, ...fixture });
    await validateRetainedOperatorToolBytes({ artifactRoot: root });
    assert.throws(() => assertProtectedOperatorTools(manifest), /source-approved.*catalog/);
    await assert.rejects(verifyRetainedOperatorTools({ artifactRoot: root, requireProtected: true }), /source-approved.*catalog/);
    const cli = manifest.tools[0];
    assert.equal(cli.assets.length, 8);
    const provenance = cli.assets.find(asset => asset.kind === "provenance"), retainedPath = path.join(root, provenance.relativePath), original = await readFile(retainedPath);
    await writeFile(retainedPath, Buffer.from("substitution"));
    await assert.rejects(verifyRetainedOperatorTools({ artifactRoot: root }), /checksum/);
    await writeFile(retainedPath, original);
    manifest.tools[0].receiptKind = "historical-mutable";
    await writeFile(path.join(root, "operator-tools", "manifest.json"), encode(manifest));
    await assert.rejects(verifyRetainedOperatorTools({ artifactRoot: root }), /receipt kind/);
    assert.throws(() => assertProtectedOperatorTools(manifest), /historical/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("historical mutable admission is only the two source-owned exact catalog tuples", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "historical-catalog-contract-"));
  try {
    for (const [release, cli] of [[CURRENT_TUI_RELEASE, false], [CURRENT_CLI_RELEASE, true]]) {
      const inventory = cli ? [release.asset, release.candidateManifest, release.checksumManifest] : [...release.assets, release.candidateManifest, release.checksumManifest];
      let downloads = 0;
      const fetchImpl = async url => {
        if (new URL(url).hostname !== "api.github.com") { downloads++; return new Response("not historical bytes"); }
        if (new URL(url).pathname.includes("/git/ref/tags/")) return Response.json({ ref: `refs/tags/${release.tag}`, object: { type: "commit", sha: release.targetCommit } });
        return Response.json({ tag_name: release.tag, target_commitish: release.targetCommit, prerelease: true, draft: false, immutable: false, assets: inventory.map((asset, index) => ({ name: asset.name, digest: `sha256:${asset.sha256}`, url: `https://api.github.com/repos/${release.repository}/releases/assets/${index + 1}` })) });
      };
      // Exact catalog metadata reaches independently pinned byte verification.
      // These synthetic bytes are rejected, never claimed historical acceptance.
      await assert.rejects(stageOperatorTools({ artifactRoot: root, release: cli ? null : release, cliRelease: cli ? release : null, fetchImpl }), /checksum mismatch/);
      assert.equal(downloads, 1);
      const altered = { ...release, checksumManifest: { ...release.checksumManifest, sha256: "a".repeat(64) } };
      downloads = 0;
      await assert.rejects(stageOperatorTools({ artifactRoot: root, release: cli ? null : altered, cliRelease: cli ? altered : null, fetchImpl }), /identity|inventory/);
      assert.equal(downloads, 0);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
for (const [name, mutate] of [
  ["missing published native", metadata => { metadata.assets.splice(2, 1); }],
  ["extra published asset", metadata => { metadata.assets.push({ ...metadata.assets[0], name: "extra" }); }],
  ["cross-repository asset ID", metadata => { metadata.assets[0].url = metadata.assets[0].url.replace("service-lasso-cli", "service-lasso-tui"); }],
  ["provider digest drift", metadata => { metadata.assets[0].digest = `sha256:${"a".repeat(64)}`; }],
  ["duplicate published name", metadata => { metadata.assets[1].name = metadata.assets[0].name; }],
]) test(`AC-4CG rejects ${name} before CLI download`, async () => {
  const fixture = await createOperatorToolReleaseResponseFixture(), root = await mkdtemp(path.join(os.tmpdir(), "cli-inventory-negative-"));
  let downloads = 0;
  try {
    const fetchImpl = async (url, options) => {
      if (new URL(url).hostname !== "api.github.com") downloads++;
      const response = await fixture.fetchImpl(url, options);
      if (new URL(url).hostname !== "api.github.com" || !new URL(url).pathname.includes("/releases/tags/")) return response;
      const metadata = await response.json(); mutate(metadata); return Response.json(metadata);
    };
    await assert.rejects(stageOperatorTools({ artifactRoot: root, release: null, cliRelease: fixture.cliRelease, fetchImpl }), /inventory/);
    assert.equal(downloads, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("AC-7G rejects concatenated/prefixed gzip even when outer digests are repinned", () => {
  for (const substitute of [bytes => Buffer.concat([fixtureTar([]), bytes]), bytes => Buffer.concat([bytes, Buffer.from("suffix")]), bytes => bytes.subarray(0, -1)]) {
    const fixture = createProtectedCliFixture(), name = `service-lassoctl-${fixture.cliRelease.version}-win32-x64.tar.gz`;
    fixture.held.set(name, substitute(fixture.held.get(name))); rebound(fixture);
    assert.throws(() => verify(fixture), /rejected/i);
  }
});

test("AC-7G binds native current producer tools/SEA when archived and sidecar provenance are repinned together", () => {
  const fixture = createProtectedCliFixture(), members = fixture.nativeMembers.get("win32-x64"), member = members.find(([name]) => name === "provenance.json"), provenance = JSON.parse(member[1]);
  provenance.tools.node = "other"; member[1] = encode(provenance);
  fixture.held.set("provenance-win32-x64.json", member[1]);
  fixture.held.set(`service-lassoctl-${fixture.cliRelease.version}-win32-x64.tar.gz`, fixtureTar(members)); rebound(fixture);
  assert.throws(() => verify(fixture), /tool\/SEA/);
});

// Entire-review F1: every byte/digest is internally rebound, while independent
// production authority remains empty. These are observational inputs only.
test("AC-4CG.2 coherent invented full bundle cannot self-admit protected publication", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tool-full-forgery-"));
  try {
    const original = await createOperatorToolReleaseResponseFixture();
    const originalManifest = await stageOperatorTools({ artifactRoot: root, ...original });
    const forgery = await createOperatorToolReleaseResponseFixture({
      cliOptions: { sourceSha: "abcdef0123456789abcdef0123456789abcdef01", version: "0.1.0-dev.abcdef0", payloadMarker: "substituted", entrypoint: 'console.log("substituted");\n' },
      tuiPayload: platform => `substituted-${platform}`,
      tuiSourceSha: "fedcba9876543210fedcba9876543210fedcba98",
    });
    // Stage into a fresh root: no stale prior filenames can trigger denial.
    const forgedRoot = await mkdtemp(path.join(os.tmpdir(), "tool-coherent-forgery-"));
    try {
      const forged = await stageOperatorTools({ artifactRoot: forgedRoot, ...forgery });
      await validateRetainedOperatorToolBytes({ artifactRoot: forgedRoot });
      for (const tool of forged.tools) {
        const prior = originalManifest.tools.find(item => item.command === tool.command);
        assert.notEqual(tool.targetCommit, prior.targetCommit);
        for (const asset of tool.assets) {
          const priorAsset = prior.assets.find(item => tool.command === "service-lassoctl" ? item.kind === asset.kind && item.target === asset.target : item.platform === asset.platform);
          assert.ok(priorAsset); assert.notEqual(asset.sha256, priorAsset.sha256);
        }
        assert.notEqual(tool.candidateManifest.sha256, prior.candidateManifest.sha256);
        assert.notEqual(tool.checksumManifest.sha256, prior.checksumManifest.sha256);
      }
      assert.throws(() => assertProtectedOperatorTools(forged), /source-approved.*catalog/);
      await assert.rejects(verifyRetainedOperatorTools({ artifactRoot: forgedRoot, requireProtected: true }), /source-approved.*catalog/);
      // Extra caller-supplied authority fields cannot populate source authority.
      await assert.rejects(verifyRetainedOperatorTools({ artifactRoot: forgedRoot, requireProtected: true, approvedCatalog: forged.tools }), /source-approved.*catalog/);
    } finally { await rm(forgedRoot, { recursive: true, force: true }); }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("AC-4CG.2 historical tuples and forged protected labels cannot satisfy empty authority", () => {
  for (const receiptKind of ["historical-mutable", "protected-immutable"]) {
    const tools = [{ ...CURRENT_CLI_RELEASE, command: "service-lassoctl", status: "available", receiptKind }, { ...CURRENT_TUI_RELEASE, command: "service-lasso-tui", status: "available", receiptKind }];
    assert.throws(() => assertProtectedOperatorTools({ tools }), /historical|source-approved.*catalog/);
  }
});

function tagFixtureFetch(fixture, selected, ref, tags = new Map(), observations = []) {
  return async (url, options = {}) => {
    const parsed = new URL(url);
    observations.push({ url: String(url), options });
    const root = `/repos/${selected.repository}`;
    if (parsed.hostname === "api.github.com" && parsed.pathname === `${root}/git/ref/tags/${selected.tag}`) return ref === null ? new Response(null, { status: 404 }) : Response.json(ref);
    if (parsed.hostname === "api.github.com" && parsed.pathname.startsWith(`${root}/git/tags/`)) {
      const tag = tags.get(parsed.pathname.slice(`${root}/git/tags/`.length));
      return tag === undefined ? new Response(null, { status: 404 }) : Response.json(tag);
    }
    return fixture.fetchImpl(url, options);
  };
}

for (const command of ["service-lassoctl", "service-lasso-tui"]) {
  for (const depth of [0, 1, 16]) test(`AC-4CG.2 ${command} canonical tag depth ${depth} retains producer bytes and credential isolation`, async () => {
    const fixture = await createOperatorToolReleaseResponseFixture(), root = await mkdtemp(path.join(os.tmpdir(), "tool-tag-positive-"));
    const selected = command === "service-lassoctl" ? fixture.cliRelease : fixture.release;
    const tags = new Map(); let object = { type: "commit", sha: selected.targetCommit };
    for (let index = depth; index > 0; index--) {
      const sha = index.toString(16).padStart(40, "0"); tags.set(sha, { sha, object }); object = { type: "tag", sha };
    }
    const observations = [], fetchImpl = tagFixtureFetch(fixture, selected, { ref: `refs/tags/${selected.tag}`, object }, tags, observations);
    try {
      await stageOperatorTools({ artifactRoot: root, ...fixture, fetchImpl, releaseMetadataToken: "tag-only-read-token" });
      await validateRetainedOperatorToolBytes({ artifactRoot: root });
      assert.equal(observations.filter(item => new URL(item.url).pathname.startsWith(`/repos/${selected.repository}/git/tags/`)).length, depth);
      for (const { url, options } of observations) {
        if (new URL(url).hostname === "api.github.com") {
          assert.equal(options.redirect, "error"); assert.equal(options.headers.authorization, "Bearer tag-only-read-token");
          assert.match(new URL(url).pathname, /^\/repos\/service-lasso\/service-lasso-(?:cli|tui)\/(?:releases\/tags\/[A-Za-z0-9.-]+|git\/ref\/tags\/[A-Za-z0-9.-]+|git\/tags\/[a-f0-9]{40})$/);
        } else assert.equal(options.headers, undefined);
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  for (const variant of ["absent", "wrong-ref", "missing-object", "bad-sha", "bad-type", "wrong-commit", "wrong-annotated-commit", "wrong-object-identity", "missing-tag", "missing-tag-object", "cycle", "depth"]) test(`AC-4CG.2 ${command} rejects actual tag ${variant} despite correct release target`, async () => {
    const fixture = await createOperatorToolReleaseResponseFixture(), root = await mkdtemp(path.join(os.tmpdir(), "tool-tag-negative-"));
    const selected = command === "service-lassoctl" ? fixture.cliRelease : fixture.release, sha = "b".repeat(40), tags = new Map();
    let ref = { ref: `refs/tags/${selected.tag}`, object: { type: "commit", sha: selected.targetCommit } };
    if (variant === "absent") ref = null;
    if (variant === "wrong-ref") ref.ref = "refs/tags/other";
    if (variant === "missing-object") delete ref.object;
    if (variant === "bad-sha") ref.object.sha = "123";
    if (variant === "bad-type") ref.object.type = "tree";
    if (variant === "wrong-commit") ref.object.sha = sha;
    if (["wrong-annotated-commit", "wrong-object-identity", "missing-tag", "missing-tag-object", "cycle"].includes(variant)) {
      ref.object = { type: "tag", sha };
      if (variant !== "missing-tag") tags.set(sha, { sha: variant === "wrong-object-identity" ? "c".repeat(40) : sha, object: variant === "missing-tag-object" ? undefined : { type: variant === "cycle" ? "tag" : "commit", sha: variant === "cycle" || variant === "wrong-annotated-commit" ? sha : selected.targetCommit } });
    }
    if (variant === "depth") {
      let object = { type: "commit", sha: selected.targetCommit };
      for (let index = 17; index > 0; index--) { const id = index.toString(16).padStart(40, "0"); tags.set(id, { sha: id, object }); object = { type: "tag", sha: id }; }
      ref.object = object;
    }
    const observations = [], fetchImpl = tagFixtureFetch(fixture, selected, ref, tags, observations);
    try {
      await assert.rejects(stageOperatorTools({ artifactRoot: root, release: command === "service-lasso-tui" ? fixture.release : null, cliRelease: command === "service-lassoctl" ? fixture.cliRelease : null, fetchImpl }), /tag.*identity|metadata failed/);
      assert.equal(observations.some(item => new URL(item.url).hostname !== "api.github.com"), false);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}
