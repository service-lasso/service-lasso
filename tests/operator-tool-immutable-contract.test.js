import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createProtectedCliFixture, fixtureTar } from "./fixtures/protected-operator-cli.mjs";
import { createOperatorToolReleaseResponseFixture } from "./fixtures/operator-tool-release-response.mjs";
import { verifyProtectedCliBytes } from "../scripts/operator-tool-cli-contract.mjs";
import { assertProtectedOperatorTools, CURRENT_CLI_RELEASE, CURRENT_TUI_RELEASE, stageOperatorTools, verifyRetainedOperatorTools } from "../scripts/operator-tool-packaging-lib.mjs";
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

for (const [name, mutate] of [
  ["missing native archive", fixture => fixture.held.delete(fixture.manifest.assets.find(asset => asset.kind === "native").name)],
  ["extra published file", fixture => fixture.held.set("extra.json", encode({}))],
  ["checksum substitution", fixture => fixture.held.set("SHA256SUMS.txt", Buffer.from("not exact"))],
  ["source drift", fixture => { fixture.manifest.source.commit = "a".repeat(40); rebound(fixture); }],
  ["version drift", fixture => { fixture.manifest.version = "0.1.0-dev.aaaaaaa"; rebound(fixture); }],
  ["tag drift", fixture => { fixture.manifest.candidateTag = "latest"; rebound(fixture); }],
  ["wrong repository", fixture => { fixture.manifest.source.repository = "other/cli"; rebound(fixture); }],
  ["manifest schema drift", fixture => { fixture.manifest.schemaVersion = 2; rebound(fixture); }],
  ["extra manifest field", fixture => { fixture.manifest.accepted = true; rebound(fixture); }],
  ["duplicate trusted JSON key", fixture => { const text = fixture.held.get("development-candidate.json").toString(); fixture.held.set("development-candidate.json", Buffer.from(text.replace('{"schemaVersion":1,', '{"schemaVersion":1,"schemaVersion":1,'))); }],
  ["checksum declaration incomplete", fixture => { fixture.manifest.checksums.entries.pop(); rebound(fixture); }],
  ["native sidecar substitution", fixture => { fixture.held.set("provenance-win32-x64.json", encode({ ...JSON.parse(fixture.held.get("provenance-win32-x64.json")), source: { commit: "a".repeat(40) } })); rebound(fixture); }],
]) test(`AC-7G rejects ${name}`, () => { const fixture = createProtectedCliFixture(); mutate(fixture); assert.throws(() => verify(fixture), /rejected/i); });

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
    assertProtectedOperatorTools(manifest);
    await verifyRetainedOperatorTools({ artifactRoot: root, requireProtected: true });
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
      if (new URL(url).hostname !== "api.github.com") return response;
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
