import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { deflateRawSync, gzipSync } from "node:zlib";
import { preflightReleaseArchive } from "../dist/runtime/release/release-archive-preflight.js";

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function u16(value) { const bytes = Buffer.alloc(2); bytes.writeUInt16LE(value); return bytes; }
function u32(value) { const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value >>> 0); return bytes; }

function zip(entries, { descriptor = false } = {}) {
  const locals = []; const central = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8"); const content = Buffer.from(entry.content ?? "");
    const method = entry.method ?? 0; const payload = entry.compressedPayload ?? (method === 8 ? deflateRawSync(content) : content);
    const flags = 0x0800 | (descriptor ? 8 : 0); const crc = crc32(content); const directory = entry.name.endsWith("/");
    const local = Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), u16(20), u16(flags), u16(method), u16(0), u16(0), u32(descriptor ? 0 : crc), u32(descriptor ? 0 : payload.length), u32(descriptor ? 0 : content.length), u16(name.length), u16(0), name, payload, ...(descriptor ? [Buffer.from([0x50, 0x4b, 7, 8]), u32(crc), u32(payload.length), u32(content.length)] : [])]);
    locals.push(local);
    central.push(Buffer.concat([Buffer.from([0x50, 0x4b, 1, 2]), u16(20), u16(20), u16(flags), u16(method), u16(0), u16(0), u32(crc), u32(payload.length), u32(content.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(directory ? 0x10 : 0), u32(offset), name]));
    offset += local.length;
  }
  const directory = Buffer.concat(central); const end = Buffer.concat([Buffer.from([0x50, 0x4b, 5, 6]), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(directory.length), u32(offset), u16(0)]);
  return Buffer.concat([...locals, directory, end]);
}

function octal(value, length) {
  const field = Buffer.alloc(length); Buffer.from(value.toString(8).padStart(length - 1, "0") + "\0").copy(field); return field;
}
function tarHeader({ name, size, type = "0", mode = 0o644 }) {
  const header = Buffer.alloc(512); Buffer.from(name).copy(header, 0); octal(mode, 8).copy(header, 100); octal(0, 8).copy(header, 108); octal(0, 8).copy(header, 116); octal(size, 12).copy(header, 124); octal(0, 12).copy(header, 136); header.fill(0x20, 148, 156); Buffer.from(type).copy(header, 156); Buffer.from("ustar\0").copy(header, 257); Buffer.from("00").copy(header, 263);
  let sum = 0; for (const byte of header) sum += byte; Buffer.from(sum.toString(8).padStart(6, "0") + "\0 ").copy(header, 148); return header;
}
function tar(entries) {
  const parts = [];
  for (const entry of entries) { const content = Buffer.from(entry.content ?? ""); parts.push(tarHeader({ name: entry.name, size: content.length, type: entry.type, mode: entry.mode }), content, Buffer.alloc((512 - (content.length % 512)) % 512)); }
  parts.push(Buffer.alloc(1024)); return gzipSync(Buffer.concat(parts));
}
function pax(fields) {
  return Buffer.concat(Object.entries(fields).map(([key, value]) => {
    const payload = `${key}=${value}\n`; let length = Buffer.byteLength(payload) + 3;
    for (;;) { const record = `${length} ${payload}`; if (Buffer.byteLength(record) === length) return Buffer.from(record); length = Buffer.byteLength(record); }
  })).toString();
}
function gzipWithExtraAndHeaderCrc(archive) {
  const header = Buffer.from(archive.subarray(0, 10)); header[3] = 0x06;
  const extra = Buffer.from([2, 0, 0xaa, 0x55]);
  const crc = crc32(Buffer.concat([header, extra]));
  return Buffer.concat([header, extra, Buffer.from([crc & 0xff, crc >>> 8]), archive.subarray(10)]);
}
function unsafe(result) { assert.deepEqual(result, { ok: false, error: { status: 409, code: "archive_unsafe" } }); }

test("release archive profile inventories stored, deflated, and descriptor ZIP members without extraction", () => {
  const archive = zip([{ name: "app/", content: "" }, { name: "app/service.json", content: "{\"id\":\"demo\"}", method: 8 }], { descriptor: true });
  const result = preflightReleaseArchive({ bytes: archive, archiveType: "zip" });
  assert.deepEqual(result, { ok: true, inventory: { archiveType: "zip", entries: 2, regularFiles: 1, directories: 1, expandedBytes: 13 } });
});

test("ZIP validation rejects CRC corruption, pathname collisions, and unsupported structural flags with one safe public error", () => {
  const corrupted = zip([{ name: "app.txt", content: "safe" }]); corrupted[14] ^= 1; unsafe(preflightReleaseArchive({ bytes: corrupted, archiveType: "zip" }));
  unsafe(preflightReleaseArchive({ bytes: zip([{ name: "Readme", content: "a" }, { name: "README", content: "b" }]), archiveType: "zip" }));
  const encrypted = zip([{ name: "safe.txt", content: "a" }]); encrypted[6] |= 1; unsafe(preflightReleaseArchive({ bytes: encrypted, archiveType: "zip" }));
  unsafe(preflightReleaseArchive({ bytes: zip([{ name: "longfilename.txt", content: "a" }, { name: "longfi~1.txt", content: "b" }]), archiveType: "zip" }));
  unsafe(preflightReleaseArchive({ bytes: zip([{ name: "longfilename.abcdef", content: "a" }, { name: "longfi~1.abc", content: "b" }]), archiveType: "zip" }));
  unsafe(preflightReleaseArchive({ bytes: zip([{ name: "\u0149.txt", content: "a" }, { name: "\u02bcn.txt", content: "b" }]), archiveType: "zip" }));
});

test("ZIP has one portable filesystem namespace and full default Unicode folding", () => {
  for (const entries of [
    [{ name: "dir/", content: "" }, { name: "dir/file", content: "x" }],
    [{ name: "dir/file", content: "x" }, { name: "dir/", content: "" }],
  ]) assert.equal(preflightReleaseArchive({ bytes: zip(entries), archiveType: "zip" }).ok, true);
  for (const entries of [
    [{ name: "dir", content: "x" }, { name: "dir/file", content: "x" }],
    [{ name: "dir/file", content: "x" }, { name: "dir", content: "x" }],
    [{ name: "dir", content: "x" }, { name: "dir/", content: "" }],
    [{ name: "dir/", content: "" }, { name: "dir", content: "x" }],
    [{ name: "\ufb00.txt", content: "x" }, { name: "ff.txt", content: "x" }],
    [{ name: "\u03a3.txt", content: "x" }, { name: "\u03c2.txt", content: "x" }],
    [{ name: "\u00df.txt", content: "x" }, { name: "ss.txt", content: "x" }],
  ]) unsafe(preflightReleaseArchive({ bytes: zip(entries), archiveType: "zip" }));
  assert.equal(preflightReleaseArchive({ bytes: zip([
    { name: "one/longfilename.abcdef", content: "x" }, { name: "two/longfi~1.abc", content: "x" },
    { name: "I.txt", content: "x" }, { name: "\u0131.txt", content: "x" },
  ]), archiveType: "zip" }).ok, true, "default folding must not use a Turkic locale mapping");
  for (const character of ["\u0001", "<", ">", "\"", "|", "?", "*"]) unsafe(preflightReleaseArchive({ bytes: zip([{ name: `safe${character}.txt`, content: "x" }]), archiveType: "zip" }));
});

test("ZIP bounds are enforced before a caller can observe parser detail", () => {
  unsafe(preflightReleaseArchive({ bytes: zip([{ name: "one", content: "1" }, { name: "two", content: "2" }]), archiveType: "zip", limits: { maxEntries: 1 } }));
  unsafe(preflightReleaseArchive({ bytes: zip([{ name: "large", content: "0".repeat(4096), method: 8 }]), archiveType: "zip", limits: { maxCompressionRatio: 1 } }));
});

test("ZIP method-8 payloads consume every declared compressed byte", () => {
  const content = Buffer.from("x");
  const paddedFinalBlock = Buffer.from([0xab, 0x00, 0x00]);
  assert.equal(preflightReleaseArchive({ bytes: zip([{ name: "padded.txt", content, method: 8, compressedPayload: paddedFinalBlock }]), archiveType: "zip" }).ok, true, "a final block may leave unused bits in its terminal byte");

  const complete = deflateRawSync(content);
  for (const descriptor of [false, true]) {
    unsafe(preflightReleaseArchive({ bytes: zip([{ name: "trailing.txt", content, method: 8, compressedPayload: Buffer.concat([complete, Buffer.from([0xde, 0xad, 0xbe, 0xef])]) }], { descriptor }), archiveType: "zip" }));
    unsafe(preflightReleaseArchive({ bytes: zip([{ name: "truncated.txt", content, method: 8, compressedPayload: complete.subarray(0, -1) }], { descriptor }), archiveType: "zip" }));
  }
});

test("gzip TAR validates USTAR framing and returns only inventory", () => {
  const archive = tar([{ name: "bundle/", type: "5" }, { name: "bundle/service.json", content: "{}" }]);
  assert.deepEqual(preflightReleaseArchive({ bytes: archive, archiveType: "tar.gz" }), { ok: true, inventory: { archiveType: "tar.gz", entries: 2, regularFiles: 1, directories: 1, expandedBytes: 2 } });
});

test("TAR rejects concatenated gzip members, links, malformed PAX size, and portable-name collisions", () => {
  const member = tar([{ name: "one", content: "x" }]); unsafe(preflightReleaseArchive({ bytes: Buffer.concat([member, member]), archiveType: "tgz" }));
  unsafe(preflightReleaseArchive({ bytes: tar([{ name: "link", type: "2" }]), archiveType: "tar.gz" }));
  unsafe(preflightReleaseArchive({ bytes: tar([{ name: "pax", type: "x", content: pax({ size: "1" }) }, { name: "next", content: "xx" }]), archiveType: "tar.gz" }));
  unsafe(preflightReleaseArchive({ bytes: tar([{ name: "pax", type: "x", content: pax({ size: "3" }) }, { name: "next", content: "xx" }]), archiveType: "tar.gz" }));
  unsafe(preflightReleaseArchive({ bytes: tar([{ name: "Case", content: "a" }, { name: "case", content: "b" }]), archiveType: "tar.gz" }));
  unsafe(preflightReleaseArchive({ bytes: tar([{ name: "safe", content: "x", mode: 0o120644 }]), archiveType: "tar.gz" }));
});

test("TAR applies the same namespace, alias, and full Unicode folding rules in every order", () => {
  for (const entries of [
    [{ name: "bundle/", type: "5" }, { name: "bundle/file", content: "x" }],
    [{ name: "bundle/file", content: "x" }, { name: "bundle/", type: "5" }],
  ]) assert.equal(preflightReleaseArchive({ bytes: tar(entries), archiveType: "tar.gz" }).ok, true);
  for (const entries of [
    [{ name: "bundle", content: "x" }, { name: "bundle/file", content: "x" }],
    [{ name: "bundle/file", content: "x" }, { name: "bundle", content: "x" }],
    [{ name: "bundle", content: "x" }, { name: "bundle/", type: "5" }],
    [{ name: "bundle/", type: "5" }, { name: "bundle", content: "x" }],
    [{ name: "\ufb00", content: "x" }, { name: "ff", content: "x" }],
    [{ name: "\u03a3", content: "x" }, { name: "\u03c2", content: "x" }],
    [{ name: "\u00df", content: "x" }, { name: "ss", content: "x" }],
    [{ name: "\u0149", content: "x" }, { name: "\u02bcn", content: "x" }],
  ]) unsafe(preflightReleaseArchive({ bytes: tar(entries), archiveType: "tar.gz" }));
  assert.equal(preflightReleaseArchive({ bytes: tar([
    { name: "one/longfilename.abcdef", content: "x" }, { name: "two/longfi~1.abc", content: "x" },
    { name: "I", content: "x" }, { name: "\u0131", content: "x" },
  ]), archiveType: "tar.gz" }).ok, true);
});

test("TAR PAX equal size and path are validation-only metadata, never physical framing authority", () => {
  const archive = tar([{ name: "pax", type: "x", content: pax({ path: "bundle/renamed.txt", size: "2", mtime: "0.1" }) }, { name: "ignored", content: "ok" }]);
  assert.deepEqual(preflightReleaseArchive({ bytes: archive, archiveType: "tgz" }), { ok: true, inventory: { archiveType: "tgz", entries: 1, regularFiles: 1, directories: 0, expandedBytes: 2 } });
});

test("TAR GNU longname is immediately bound to one following regular member", () => {
  const longName = `bundle/${"long-".repeat(20)}payload.txt`;
  const archive = tar([{ name: "gnu-longname", type: "L", content: `${longName}\0` }, { name: "ignored", content: "ok" }]);
  assert.deepEqual(preflightReleaseArchive({ bytes: archive, archiveType: "tar.gz" }), { ok: true, inventory: { archiveType: "tar.gz", entries: 1, regularFiles: 1, directories: 0, expandedBytes: 2 } });
});

test("TAR streams large members in bounded chunks and rejects gzip truncation, trailer corruption, and trailing DEFLATE bytes", () => {
  const content = randomBytes(64 * 1024);
  const archive = tar([{ name: "bundle/payload.bin", content }]);
  assert.ok(archive.length > 16 * 1024, "fixture must cross the parser input chunk boundary");
  assert.deepEqual(preflightReleaseArchive({ bytes: archive, archiveType: "tar.gz" }), { ok: true, inventory: { archiveType: "tar.gz", entries: 1, regularFiles: 1, directories: 0, expandedBytes: content.length } });
  unsafe(preflightReleaseArchive({ bytes: archive, archiveType: "tar.gz", limits: { maxExpandedBytes: 1024 } }));
  const corruptTrailer = Buffer.from(archive); corruptTrailer[corruptTrailer.length - 8] ^= 1;
  unsafe(preflightReleaseArchive({ bytes: corruptTrailer, archiveType: "tar.gz" }));
  unsafe(preflightReleaseArchive({ bytes: archive.subarray(0, -1), archiveType: "tar.gz" }));
  const trailingDeflate = Buffer.concat([archive.subarray(0, -8), Buffer.from([0]), archive.subarray(-8)]);
  unsafe(preflightReleaseArchive({ bytes: trailingDeflate, archiveType: "tar.gz" }));
});

test("TAR refuses a compressed expansion bomb before a member can become observable", () => {
  const archive = tar([{ name: "bundle/repeated.txt", content: "0".repeat(64 * 1024) }]);
  assert.ok(archive.length * 20 < 64 * 1024);
  unsafe(preflightReleaseArchive({ bytes: archive, archiveType: "tgz" }));
});

test("TAR verifies bounded gzip extra fields and header CRC before accepting compressed framing", () => {
  const archive = gzipWithExtraAndHeaderCrc(tar([{ name: "bundle/service.json", content: "{}" }]));
  assert.deepEqual(preflightReleaseArchive({ bytes: archive, archiveType: "tar.gz" }), { ok: true, inventory: { archiveType: "tar.gz", entries: 1, regularFiles: 1, directories: 0, expandedBytes: 2 } });
  const corruptHeaderCrc = Buffer.from(archive); corruptHeaderCrc[15] ^= 1;
  unsafe(preflightReleaseArchive({ bytes: corruptHeaderCrc, archiveType: "tar.gz" }));
  const reservedFlags = Buffer.from(archive); reservedFlags[3] |= 0x20;
  unsafe(preflightReleaseArchive({ bytes: reservedFlags, archiveType: "tar.gz" }));
});
