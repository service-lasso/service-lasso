// Source transfer: TUI2a04f075 native-owner-package.mjs; import paths adapted only.
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { crc32, createNativeArchive, verifyNativeArchive } from "./operator-tool-tui-native-framing.mjs";
import { assertScope } from "./ga-platform-scope-lib.mjs";

// Selected packaging B. These paths describe bytes; they confer no native,
// loaded-image, endpoint, family, runtime-disposition or publication authority.
const LIMIT = 256 * 1024 * 1024;
export const NATIVE_OWNER_CORE_ARCHIVE_LIMIT=LIMIT;
export function assertCoreNativeOwnerArchiveSize(size){
  if(!Number.isSafeInteger(size)||size<=0||size>NATIVE_OWNER_CORE_ARCHIVE_LIMIT)denied();
  return size;
}
const denied = () => { throw new Error("native owner package denied"); };
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const exact = (value, keys) => {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) denied();
};
export function nativeOwnerLayout(platform) {
  if (!["linux-amd64", "win32-amd64"].includes(platform)) denied();
  const suffix = platform === "win32-amd64" ? ".exe" : "";
  return Object.freeze([
    Object.freeze({ path: `service-lasso-tui${suffix}`, role: "native-owner" }),
    Object.freeze({ path: `.service-lasso-tui/service-lasso-tui-go${suffix}`, role: "go-payload" }),
  ]);
}
export function assertNativeOwnerMemberReferences(asset) {
  const layout = nativeOwnerLayout(asset.platform);
  if (!Array.isArray(asset.members) || asset.members.length !== 2 || asset.executable !== layout[0].path) denied();
  let total = 0;
  for (const [index, member] of asset.members.entries()) {
    exact(member, ["path", "role", "sha256", "size"]);
    if (member.path !== layout[index].path || member.role !== layout[index].role ||
        typeof member.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(member.sha256) ||
        !Number.isSafeInteger(member.size) || member.size <= 0 || member.size > LIMIT) denied();
    total += member.size; if (total > LIMIT) denied();
  }
  return asset.members;
}
function validateBodies(platform, members) {
  const layout = nativeOwnerLayout(platform);
  if (!Array.isArray(members) || members.length !== layout.length) denied();
  let total = 0;
  for (const [index, member] of members.entries()) {
    exact(member, ["path", "role", "bytes"]);
    if (member.path !== layout[index].path || member.role !== layout[index].role ||
        !Buffer.isBuffer(member.bytes) || !member.bytes.length || member.bytes.length > LIMIT) denied();
    total += member.bytes.length;
    if (total > LIMIT) denied();
    // Reuse the existing exact platform image framing check for BOTH bodies.
    // This does not authenticate a kernel interpreter or loaded executable.
    verifyNativeArchive(platform, createNativeArchive(platform, member.bytes));
  }
  return members;
}
function tarHeader(name, size) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "ascii");
  const put = (start, length, value) => header.write(value.toString(8).padStart(length - 1, "0") + "\0", start, length, "ascii");
  put(100, 8, 0o755); put(108, 8, 0); put(116, 8, 0); put(124, 12, size); put(136, 12, 0);
  header.fill(32, 148, 156); header[156] = 48; header.write("ustar\0", 257); header.write("00", 263);
  header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");
  return header;
}
function archiveTar(members) {
  const pieces = [];
  for (const member of members) pieces.push(tarHeader(member.path, member.bytes.length), member.bytes, Buffer.alloc((512 - member.bytes.length % 512) % 512));
  pieces.push(Buffer.alloc(1024));
  const result = gzipSync(Buffer.concat(pieces), { mtime: 0 }); result[9] = 3; return result;
}
function archiveZip(members) {
  const localPieces = [], centralPieces = []; let offset = 0;
  for (const member of members) {
    const name = Buffer.from(member.path, "ascii"), checksum = crc32(member.bytes);
    const local = Buffer.alloc(30), central = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(33, 12);
    local.writeUInt32LE(checksum, 14); local.writeUInt32LE(member.bytes.length, 18); local.writeUInt32LE(member.bytes.length, 22); local.writeUInt16LE(name.length, 26);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(33, 14);
    central.writeUInt32LE(checksum, 16); central.writeUInt32LE(member.bytes.length, 20); central.writeUInt32LE(member.bytes.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    localPieces.push(local, name, member.bytes); centralPieces.push(central, name);
    offset += local.length + name.length + member.bytes.length;
  }
  const central = Buffer.concat(centralPieces), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(members.length, 8); end.writeUInt16LE(members.length, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localPieces, central, end]);
}
export function createNativeOwnerArchive(platform, members) {
  validateBodies(platform, members);
  const archive = platform === "linux-amd64" ? archiveTar(members) : archiveZip(members);
  if (archive.length > LIMIT + 65536) denied();
  return archive;
}
export function verifyNativeOwnerArchive(platform, archive) {
  const layout = nativeOwnerLayout(platform);
  if (!Buffer.isBuffer(archive) || !archive.length || archive.length > LIMIT + 65536) denied();
  const members = []; let offset = 0, total = 0;
  if (platform === "linux-amd64") {
    const body = gunzipSync(archive, { maxOutputLength: LIMIT + 4096 });
    for (const item of layout) {
      if (offset + 512 > body.length) denied();
      const field = body.subarray(offset + 124, offset + 136).toString("ascii");
      if (!/^[0-7]{11}\0$/u.test(field)) denied();
      const size = parseInt(field.slice(0, -1), 8); total += size;
      if (!size || total > LIMIT || offset + 512 + size > body.length ||
          !body.subarray(offset, offset + 512).equals(tarHeader(item.path, size))) denied();
      const end = offset + 512 + size, padded = offset + 512 + Math.ceil(size / 512) * 512;
      if (padded > body.length || body.subarray(end, padded).some(byte => byte !== 0)) denied();
      members.push({ ...item, bytes: body.subarray(offset + 512, end) }); offset = padded;
    }
    if (body.length !== offset + 1024 || body.subarray(offset).some(byte => byte !== 0)) denied();
  } else {
    for (const item of layout) {
      if (offset + 30 > archive.length || archive.readUInt32LE(offset) !== 0x04034b50) denied();
      const size = archive.readUInt32LE(offset + 18), name = Buffer.from(item.path, "ascii"); total += size;
      const start = offset + 30 + name.length, end = start + size;
      if (!size || total > LIMIT || end > archive.length ||
          archive.readUInt16LE(offset + 26) !== name.length || !archive.subarray(offset + 30, start).equals(name)) denied();
      members.push({ ...item, bytes: archive.subarray(start, end) }); offset = end;
    }
  }
  validateBodies(platform, members);
  // Exact reconstruction verifies every remaining central/header/mode/CRC/
  // offset/framing field, rejecting links, extras and concatenated/trailing data.
  if (!createNativeOwnerArchive(platform, members).equals(archive)) denied();
  return members;
}
export function nativeOwnerMemberInventory(platform, members) {
  return validateBodies(platform, members).map(member => ({ path: member.path, role: member.role, sha256: digest(member.bytes), size: member.bytes.length }));
}
export function assertNativeOwnerAsset(asset, archive) {
  exact(asset, ["platform", "name", "sha256", "executable", "members"]);
  const layout = nativeOwnerLayout(asset.platform);
  if (asset.executable !== layout[0].path || typeof asset.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(asset.sha256) ||
      !Array.isArray(asset.members) || asset.members.length !== 2 || digest(archive) !== asset.sha256) denied();
  const members = verifyNativeOwnerArchive(asset.platform, archive);
  for (const [index, member] of asset.members.entries()) {
    exact(member, ["path", "role", "sha256", "size"]);
    if (member.path !== layout[index].path || member.role !== layout[index].role ||
        member.size !== members[index].bytes.length || member.sha256 !== digest(members[index].bytes)) denied();
  }
  return members;
}
// Intersection with the current Core boundedProviderBody receiving limit.
// The archive format's existing extra framing allowance is not enlarged or
// removed; a publishable/receivable pair must ALSO satisfy this actual bound.
export function assertCoreNativeOwnerAsset(asset,archive){
  if(!Buffer.isBuffer(archive))denied();
  assertCoreNativeOwnerArchiveSize(archive.length);
  return assertNativeOwnerAsset(asset,archive);
}
export function assertNativeOwnerManifest(manifest, identity) {
  exact(identity, ["sourceRef", "sourceCommit", "version", "tag"]);
  if (identity.sourceRef !== "refs/heads/develop" || typeof identity.sourceCommit !== "string" || !/^[a-f0-9]{40}$/u.test(identity.sourceCommit) ||
      typeof identity.version !== "string" || !/^\d{4}\.\d{1,2}\.\d{1,2}-[a-f0-9]{7}$/u.test(identity.version) ||
      identity.version.slice(-7) !== identity.sourceCommit.slice(0, 7) || identity.tag !== `candidate-${identity.version}`) denied();
  exact(manifest, ["assets", "checksumManifest", "corePackagingIssue", "kind", "release", "schemaVersion", "source", "version", "scope"]);
  if (manifest.schemaVersion !== 4 || manifest.kind !== "develop-prerelease-candidate" || manifest.version !== identity.version) denied();
  exact(manifest.source, ["repository", "ref", "commit"]);
  if (manifest.source.repository !== "service-lasso/service-lasso-tui" || manifest.source.ref !== identity.sourceRef || manifest.source.commit !== identity.sourceCommit) denied();
  exact(manifest.release, ["tag", "draft", "prerelease", "immutable"]);
  if (manifest.release.tag !== identity.tag || manifest.release.draft !== false || manifest.release.prerelease !== true || manifest.release.immutable !== true ||
      manifest.corePackagingIssue !== "service-lasso/service-lasso#1461") denied();
  exact(manifest.checksumManifest, ["name", "sha256"]);
  if (manifest.checksumManifest.name !== "SHA256SUMS.txt" || typeof manifest.checksumManifest.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(manifest.checksumManifest.sha256)) denied();
  assertScope(manifest.scope);
  if (!Array.isArray(manifest.assets) || manifest.assets.length !== 2) denied();
  for (const [index, platform] of ["linux-amd64", "win32-amd64"].entries()) {
    const asset = manifest.assets[index], layout = nativeOwnerLayout(platform);
    exact(asset, ["platform", "name", "sha256", "executable", "members"]);
    if (asset.platform !== platform || asset.executable !== layout[0].path ||
        asset.name !== `service-lasso-tui-${identity.version}-${platform}.${platform === "linux-amd64" ? "tar.gz" : "zip"}` ||
        typeof asset.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(asset.sha256) || !Array.isArray(asset.members) || asset.members.length !== 2) denied();
    let total = 0;
    for (const [memberIndex, member] of asset.members.entries()) {
      exact(member, ["path", "role", "sha256", "size"]);
      if (member.path !== layout[memberIndex].path || member.role !== layout[memberIndex].role ||
          typeof member.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(member.sha256) || !Number.isSafeInteger(member.size) || member.size <= 0 || member.size > LIMIT) denied();
      total += member.size; if (total > LIMIT) denied();
    }
  }
  return manifest;
}
