import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const json = value => Buffer.from(JSON.stringify(value));
// Real finite USTAR/gzip byte fixtures, never executable qualification evidence.
export function fixtureTar(entries) {
  const parts = [];
  for (const [name, value] of entries) {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const header = Buffer.alloc(512);
    header.write(name); header.write("0000755\0", 100); header.write("0000000\0", 108); header.write("0000000\0", 116);
    header.write(bytes.length.toString(8).padStart(11, "0") + "\0", 124); header.write("00000000000\0", 136);
    header.fill(32, 148, 156); header[156] = 48; header.write("ustar\0", 257); header.write("00", 263);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148);
    parts.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...parts, Buffer.alloc(1024)]));
}
export function createProtectedCliFixture({ version = "0.1.0-dev.1234567", sourceSha = "1234567890123456789012345678901234567890", entrypoint = 'console.log("fixture");\n' } = {}) {
  const tag = `cli-v${version}-candidate-${sourceSha.slice(0, 7)}`;
  const held = new Map(), nativeMembers = new Map();
  const portableName = `service-lassoctl-${version}.tgz`;
  held.set(portableName, fixtureTar([
    ["package/package.json", json({ name: "@service-lasso/cli", version, type: "module", engines: { node: ">=22.12.0" }, bin: { "service-lassoctl": "./dist/index.js" } })],
    ["package/README.md", "Fixture only"], ["package/dist/index.js", entrypoint],
  ]));
  const portableAsset = { name: portableName, sha256: hash(held.get(portableName)), size: held.get(portableName).length };
  held.set("candidate.json", json({ schemaVersion: 1, candidateTag: tag, version, source: { repository: "service-lasso/service-lasso-cli", commit: sourceSha }, package: { name: "@service-lasso/cli", command: "service-lassoctl", entrypoint: "dist/index.js", node: ">=22.12.0" }, platforms: ["win32", "linux", "darwin"], assets: [portableAsset] }));
  const descriptors = [{ name: portableName, kind: "portable", target: null }, { name: "candidate.json", kind: "portable-record", target: null }];
  for (const [platform, architecture] of [["win32", "x64"], ["linux", "x64"], ["darwin", "arm64"]]) {
    const target = `${platform}-${architecture}`, executable = platform === "win32" ? "service-lassoctl.exe" : "service-lassoctl", writer = platform === "win32" ? "service-lasso-confined-scaffold.exe" : "service-lasso-confined-scaffold";
    const executableBytes = Buffer.from(`fixture-executable-${target}`), writerBytes = Buffer.from(`fixture-writer-${target}`), darwinBytes = Buffer.from("fixture-darwin-helper");
    const provenance = { schemaVersion: 1, candidate: { tag, version }, command: "service-lassoctl", source: { commit: sourceSha }, executable: { name: executable, platform, architecture, version, sha256: hash(executableBytes) }, confinedWriter: { name: writer, platform, architecture, sha256: hash(writerBytes), sourceSha256: hash("fixture-writer-source") }, sea: { mainFormat: "commonjs", useCodeCache: false, execArgvExtension: "none" }, tools: { node: "22.23.2", esbuild: "0.28.2", postject: "1.0.0-alpha.6" } };
    if (platform === "darwin") provenance.darwinImmutableHelper = { name: "service-lasso-darwin-immutable-helper", platform, architecture, sha256: hash(darwinBytes), sourceSha256: hash("fixture-helper-source") };
    const provenanceBytes = json(provenance);
    const acceptance = { schemaVersion: 1, sourceSha, version, platform, architecture, executableSha256: hash(executableBytes), nodeAbsentFromPath: true, status: "passed", evidenceDigest: hash(Buffer.from(`service-lasso-native-acceptance-v1\n${sourceSha}\n${version}\n${platform}\n${architecture}\n${hash(executableBytes)}\nnode-absent\npassed\n`)) };
    const members = [[executable, executableBytes], [writer, writerBytes], ["provenance.json", provenanceBytes], ["ci-context.json", json({ schemaVersion: 1, eventName: "workflow_dispatch", sourceSha, testedBaseSha: null, mergeContextSha: sourceSha })], ["host-acceptance.json", json(acceptance)]];
    if (platform === "darwin") members.push(["service-lasso-darwin-immutable-helper", darwinBytes]);
    const archive = `service-lassoctl-${version}-${target}.tar.gz`, sidecar = `provenance-${target}.json`;
    nativeMembers.set(target, members);
    held.set(archive, fixtureTar(members)); held.set(sidecar, provenanceBytes);
    descriptors.push({ name: archive, kind: "native", target }, { name: sidecar, kind: "provenance", target });
  }
  const assets = descriptors.map(asset => ({ ...asset, sha256: hash(held.get(asset.name)), size: held.get(asset.name).length }));
  const manifest = { schemaVersion: 1, candidateTag: tag, version, source: { repository: "service-lasso/service-lasso-cli", commit: sourceSha }, checksums: { algorithm: "sha256", file: "SHA256SUMS.txt", entries: ["development-candidate.json", ...assets.map(asset => asset.name)].sort() }, assets };
  held.set("development-candidate.json", json(manifest));
  held.set("SHA256SUMS.txt", Buffer.from([{ name: "development-candidate.json", sha256: hash(held.get("development-candidate.json")) }, ...assets].sort((a, b) => a.name.localeCompare(b.name)).map(asset => `${asset.sha256}  ${asset.name}\n`).join("")));
  const pin = name => ({ name, sha256: hash(held.get(name)) });
  const cliRelease = { repository: "service-lasso/service-lasso-cli", tag, version, targetCommit: sourceSha, supportedPlatforms: ["win32", "linux", "darwin"], asset: portableAsset, candidateManifest: pin("candidate.json"), developmentManifest: pin("development-candidate.json"), checksumManifest: pin("SHA256SUMS.txt"), assets };
  return { cliRelease, held, manifest, nativeMembers };
}
