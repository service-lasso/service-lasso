import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { gunzipSync, gzipSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import { scopeIdentity } from "../scripts/ga-platform-scope-lib.mjs";
import { assertExactToolRelease, tuiPairRelease, validateRetainedOperatorToolBytes, verifyRetainedOperatorTools,
  SCOPED_TOOL_RELEASES } from "../scripts/operator-tool-packaging-lib.mjs";
import { assertCoreNativeOwnerArchiveSize, assertCoreNativeOwnerAsset, assertNativeOwnerManifest, assertNativeOwnerMemberReferences,
  createNativeOwnerArchive, nativeOwnerLayout, nativeOwnerMemberInventory, verifyNativeOwnerArchive } from "../scripts/operator-tool-tui-pair-contract.mjs";
import { extractTuiPair, settleTuiPairResources } from "../scripts/operator-tool-tui-pair-extraction.mjs";
import { createProtectedCliFixture } from "./fixtures/protected-operator-cli.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const json = value => Buffer.from(JSON.stringify(value));
const clone = value => structuredClone(value);
const scope = scopeIdentity(), commit = "1234567890123456789012345678901234567890", version = "2026.10.4-1234567";
// Synthetic header fixtures exercise source correspondence only. Never loaded,
// executed, published or treated as native owner/profile evidence.
function image(platform, marker) {
  const bytes = Buffer.alloc(128); bytes[127] = marker;
  if (platform === "linux-amd64") {
    bytes.write("7f454c46", 0, "hex"); bytes[4] = 2; bytes[5] = 1; bytes.writeUInt16LE(62, 18);
  } else {
    bytes.write("MZ"); bytes.writeUInt32LE(64, 60); bytes.writeUInt32LE(0x4550, 64);
    bytes.writeUInt16LE(0x8664, 68); bytes.writeUInt16LE(0x20b, 88);
  }
  return bytes;
}
function pair(platform) {
  const members = nativeOwnerLayout(platform).map((member, index) => ({ ...member, bytes: image(platform, index + 1) }));
  const archive = createNativeOwnerArchive(platform, members);
  const asset = { platform, name: `service-lasso-tui-${version}-${platform}.${platform === "win32-amd64" ? "zip" : "tar.gz"}`,
    sha256: hash(archive), executable: members[0].path, members: nativeOwnerMemberInventory(platform, members) };
  return { members, archive, asset };
}
function candidateFixture() {
  const pairs = [pair("linux-amd64"), pair("win32-amd64")], assets = pairs.map(row => row.asset);
  const sums = Buffer.from(assets.map(asset => `${asset.sha256}  ${asset.name}\n`).join(""));
  const candidate = { assets, checksumManifest: { name: "SHA256SUMS.txt", sha256: hash(sums) },
    corePackagingIssue: "service-lasso/service-lasso#1461", kind: "develop-prerelease-candidate",
    release: { tag: `candidate-${version}`, draft: false, prerelease: true, immutable: true }, schemaVersion: 4,
    source: { repository: "service-lasso/service-lasso-tui", ref: "refs/heads/develop", commit }, version, scope };
  const identity = { sourceRef: "refs/heads/develop", sourceCommit: commit, version, tag: `candidate-${version}` };
  const release = { repository: candidate.source.repository, tag: identity.tag, targetCommit: commit, scope,
    checksumManifest: candidate.checksumManifest, candidateManifest: { name: "candidate-manifest.json", sha256: hash(json(candidate)) }, assets };
  return { pairs, sums, candidate, identity, release };
}

test("TUI4 source inventory is a complete ordered pair and cannot activate protected catalogs", () => {
  const { release, candidate, identity } = candidateFixture();
  assertExactToolRelease(release); assert.equal(tuiPairRelease(release), true); assertNativeOwnerManifest(candidate, identity);
  assert.deepEqual(SCOPED_TOOL_RELEASES, { cli: null, tui: null });
  for (const mutate of [row => delete row.scope, row => delete row.assets[0].members, row => row.assets.reverse(),
    row => row.assets[0].members.reverse(), row => row.assets[0].members.pop(), row => row.assets[0].members[1].path = "../outside",
    row => row.assets[0].members[1].role = "native-owner", row => row.assets[0].members[1].extra = true,
    row => row.assets[0].members[1].size = 0, row => row.assets[0].members[1].size = 1.5,
    row => row.assets[0].members[1].sha256 = "f".repeat(63)]) {
    const changed = clone(release); mutate(changed); assert.throws(() => assertExactToolRelease(changed));
  }
  for (const mutate of [row => row.schemaVersion = 3, row => row.extra = true, row => delete row.scope,
    row => row.source.commit = "a".repeat(40), row => row.assets.reverse(), row => row.assets[0].members.reverse(),
    row => row.assets[0].members[1].path = row.assets[0].members[0].path, row => row.release.immutable = false]) {
    const changed = clone(candidate); mutate(changed); assert.throws(() => assertNativeOwnerManifest(changed, identity));
  }
  assert.equal(assertCoreNativeOwnerArchiveSize(256 * 1024 * 1024), 256 * 1024 * 1024);
  for (const size of [0, -1, 1.5, NaN, Infinity, 256 * 1024 * 1024 + 1]) assert.throws(() => assertCoreNativeOwnerArchiveSize(size));
  const asset = clone(release.assets[0]); asset.members[0].size = 256 * 1024 * 1024; asset.members[1].size = 1;
  assert.throws(() => assertNativeOwnerMemberReferences(asset));
});

for (const platform of ["linux-amd64", "win32-amd64"]) test(`TUI4 ${platform} checks BOTH bodies and exact archive framing`, () => {
  const { asset, archive, members } = pair(platform);
  assert.deepEqual(assertCoreNativeOwnerAsset(asset, archive), members);
  for (const index of [0, 1]) {
    const changed = members.map(member => ({ ...member, bytes: Buffer.from(member.bytes) })); changed[index].bytes[127]++;
    const replacement = createNativeOwnerArchive(platform, changed);
    const recomputedOuter = { ...asset, sha256: hash(replacement) };
    assert.throws(() => assertCoreNativeOwnerAsset(recomputedOuter, replacement));
    const badImage = members.map(member => ({ ...member, bytes: Buffer.from(member.bytes) })); badImage[index].bytes[0] = 0;
    assert.throws(() => createNativeOwnerArchive(platform, badImage));
  }
  for (const changed of [members.slice(0, 1), members.slice(1), [...members].reverse(),
    [...members, members[1]], members.map((member, index) => ({ ...member, path: index ? "../outside" : member.path }))])
    assert.throws(() => createNativeOwnerArchive(platform, changed));
  for (const changed of [Buffer.concat([archive, Buffer.from([0])]), Buffer.concat([archive, archive]), archive.subarray(0, -1)])
    assert.throws(() => verifyNativeOwnerArchive(platform, changed));
  if (platform === "linux-amd64") {
    for (const [offset, value] of [[156, 50], [0, 46], [100, 49], [512 + 128, 1]]) {
      const body = gunzipSync(archive); body[offset] = value;
      assert.throws(() => verifyNativeOwnerArchive(platform, gzipSync(body)));
    }
  } else {
    for (const offset of [6, 14, 26, archive.length - 6, archive.length - 1]) {
      const bytes = Buffer.from(archive); bytes[offset] ^= 1; assert.throws(() => verifyNativeOwnerArchive(platform, bytes));
    }
    const linked = Buffer.from(archive), central = archive.readUInt32LE(archive.length - 6);
    linked.writeUInt32LE(0xa1ff0000, central + 38); // Unix symlink external attributes.
    assert.throws(() => verifyNativeOwnerArchive(platform, linked));
  }
});

for (const platform of ["linux-amd64", "win32-amd64"]) test(`TUI4 ${platform} exclusive extraction retains BOTH readbacks until settlement`, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tui-pair-source-")); let extracted;
  try {
    const { archive, asset, members } = pair(platform), archivePath = path.join(root, "archive"); await writeFile(archivePath, archive);
    const destination = path.join(root, "pair");
    extracted = await extractTuiPair({ archivePath, asset, root: destination });
    assert.equal(extracted.executable, path.join(destination, members[0].path)); await extracted.verifyReadbacks();
    await assert.rejects(extractTuiPair({ archivePath, asset, root: destination }));
    for (const member of members) {
      const memberPath = path.join(destination, member.path);
      assert.deepEqual(await readFile(memberPath), member.bytes);
      const changed = Buffer.from(member.bytes); changed[127]++;
      await writeFile(memberPath, changed); await assert.rejects(extracted.verifyReadbacks());
      await writeFile(memberPath, member.bytes); await extracted.verifyReadbacks();
    }
    await writeFile(path.join(destination, ".service-lasso-tui", "extra"), "unlisted");
    await assert.rejects(extracted.verifyReadbacks());
    await rm(path.join(destination, ".service-lasso-tui", "extra"));
    const privateRoot = path.join(destination, ".service-lasso-tui"), displaced = path.join(root, "displaced");
    const outside = path.join(root, "outside"); await mkdir(outside);
    const outsideFile = path.join(outside, path.posix.basename(members[1].path)); await writeFile(outsideFile, members[1].bytes);
    await rename(privateRoot, displaced);
    await symlink(outside, privateRoot, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(extracted.verifyReadbacks());
    assert.deepEqual(await readFile(outsideFile), members[1].bytes);
    await rm(privateRoot); await rename(displaced, privateRoot);
    await extracted.close(); await assert.rejects(extracted.verifyReadbacks());
  } finally { await extracted?.close(); await rm(root, { recursive: true, force: true }); }
});

test("TUI pair descriptor-settlement SURROGATE preserves first and independent later opaque failures", async () => {
  const opaque = new Proxy({}, { get() { assert.fail("opaque settlement original observed"); } });
  const failures = [null, undefined, opaque], called = [];
  const actual = await settleTuiPairResources(failures.map((original, index) => ({ async close() { called.push(index); throw original; } })));
  assert.deepEqual(called, [0, 1, 2]); actual.forEach((original, index) => assert.strictEqual(original, failures[index]));
});

test("TUI4 retained reader verifies actual pair bytes without protected eligibility", async () => {
  const { candidate, pairs, sums } = candidateFixture();
  const fixture = createProtectedCliFixture(), held = new Map(fixture.held), cliManifest = clone(fixture.manifest);
  cliManifest.schemaVersion = 2; cliManifest.scope = scope;
  cliManifest.assets = cliManifest.assets.filter(asset => asset.target !== "darwin-arm64").sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  for (const name of held.keys()) if (name.includes("darwin-arm64")) held.delete(name);
  const portable = JSON.parse(held.get("candidate.json")); portable.schemaVersion = 2; portable.scope = scope; held.set("candidate.json", json(portable));
  const descriptor = cliManifest.assets.find(asset => asset.name === "candidate.json"); descriptor.sha256 = hash(held.get("candidate.json")); descriptor.size = held.get("candidate.json").length;
  cliManifest.checksums.entries = ["development-candidate.json", ...cliManifest.assets.map(asset => asset.name)].sort();
  held.set("development-candidate.json", json(cliManifest)); held.set("SHA256SUMS.txt", Buffer.from(cliManifest.checksums.entries.map(name => `${hash(held.get(name))}  ${name}\n`).join("")));
  const ref = (name, command, bytes) => ({ name, sha256: hash(bytes), relativePath: `operator-tools/${command}/${name}` });
  const cli = { command: "service-lassoctl", status: "available", receiptKind: "protected-immutable", mode: "caller-invoked", repository: cliManifest.source.repository,
    tag: cliManifest.candidateTag, targetCommit: cliManifest.source.commit, version: cliManifest.version, asset: portable.assets[0],
    checksumManifest: ref("SHA256SUMS.txt", "service-lassoctl", held.get("SHA256SUMS.txt")), candidateManifest: ref("candidate.json", "service-lassoctl", held.get("candidate.json")),
    developmentManifest: ref("development-candidate.json", "service-lassoctl", held.get("development-candidate.json")), supportedPlatforms: [...portable.platforms],
    assets: cliManifest.assets.map(asset => ({ ...asset, relativePath: `operator-tools/service-lassoctl/${asset.name}` })) };
  const tui = { command: "service-lasso-tui", status: "available", receiptKind: "protected-immutable", mode: "caller-attached-terminal",
    repository: candidate.source.repository, tag: candidate.release.tag, targetCommit: commit,
    checksumManifest: ref("SHA256SUMS.txt", "service-lasso-tui", sums), candidateManifest: ref("candidate-manifest.json", "service-lasso-tui", json(candidate)),
    assets: candidate.assets.map(asset => ({ ...asset, relativePath: `operator-tools/service-lasso-tui/${asset.name}` })) };
  const record = { schemaVersion: "service-lasso.operator-tools.v3", scope, tools: [cli, tui] };
  const root = await mkdtemp(path.join(os.tmpdir(), "tui-pair-retained-source-"));
  try {
    for (const [command, originals] of [["service-lassoctl", held], ["service-lasso-tui", new Map([
      ...pairs.map(row => [row.asset.name, row.archive]), ["SHA256SUMS.txt", sums], ["candidate-manifest.json", json(candidate)]])]]) {
      await mkdir(path.join(root, "operator-tools", command), { recursive: true });
      for (const [name, bytes] of originals) await writeFile(path.join(root, "operator-tools", command, name), bytes);
    }
    const seal = () => writeFile(path.join(root, "operator-tools", "manifest.json"), json(record)); await seal();
    assert.deepEqual((await validateRetainedOperatorToolBytes({ artifactRoot: root })).manifest, record);
    await assert.rejects(verifyRetainedOperatorTools({ artifactRoot: root, requireProtected: true }), /pins absent|catalog/);
    // Coherently replace outer archive hashes/checksums/candidate reference while
    // keeping the reviewed inner member ref: the actual private payload must deny.
    const changedMembers = pairs[0].members.map(member => ({ ...member, bytes: Buffer.from(member.bytes) })); changedMembers[1].bytes[127]++;
    const changedArchive = createNativeOwnerArchive("linux-amd64", changedMembers);
    tui.assets[0].sha256 = hash(changedArchive); candidate.assets[0].sha256 = hash(changedArchive);
    const changedSums = Buffer.from(candidate.assets.map(asset => `${asset.sha256}  ${asset.name}\n`).join(""));
    candidate.checksumManifest.sha256 = hash(changedSums); tui.checksumManifest.sha256 = hash(changedSums); tui.candidateManifest.sha256 = hash(json(candidate));
    await writeFile(path.join(root, tui.assets[0].relativePath), changedArchive);
    await writeFile(path.join(root, tui.checksumManifest.relativePath), changedSums);
    await writeFile(path.join(root, tui.candidateManifest.relativePath), json(candidate)); await seal();
    await assert.rejects(validateRetainedOperatorToolBytes({ artifactRoot: root }), /native owner package denied/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("both scoped terminal callers gate actual owner execution on BOTH readbacks and settle before cleanup", async () => {
  for (const name of ["verify-operator-tui-pty-scoped.mjs", "verify-operator-tui-conpty-scoped.mjs"]) {
    const source = await readFile(new URL(`../scripts/${name}`, import.meta.url), "utf8");
    assert.match(source, /if \(asset\.members\) \{\s*pairExtraction = await extractTuiPair/);
    const checks = [...source.matchAll(/await pairExtraction\?\.verifyReadbacks\(\);/g)];
    assert.equal(checks.length, name.includes("conpty") ? 2 : 1);
    for (const check of checks) assert.match(source.slice(check.index), /^await pairExtraction\?\.verifyReadbacks\(\);\s*const (?:probe|safeProbe|connectedProbe) = await (?:runCommand|runConptyHelper)/);
    assert.ok(source.indexOf("() => pairExtraction?.close()") < source.indexOf("() => extractedCoreArchive?.cleanup()"));
    assert.match(source, /primaryFailureRecorded/);
  }
});
