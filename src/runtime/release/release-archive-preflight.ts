import { inflateRawSync } from "node:zlib";

/**
 * release-archive-profile-v1 parser.  The caller supplies only Core-held bytes
 * and a server-resolved type.  This module intentionally has no I/O surface:
 * it neither locates, extracts, nor writes archive members.
 */
export type ReleaseArchiveType = "zip" | "tar.gz" | "tgz";

export interface ReleaseArchiveLimits {
  maxEntries: number;
  maxHeaders: number;
  maxExtensions: number;
  maxExpandedBytes: number;
  maxCompressionRatio: number;
  maxDepth: number;
}

export interface ReleaseArchiveInventory {
  archiveType: ReleaseArchiveType;
  entries: number;
  regularFiles: number;
  directories: number;
  expandedBytes: number;
}

export type ReleaseArchivePreflightResult =
  | { ok: true; inventory: ReleaseArchiveInventory }
  | { ok: false; error: { status: 409; code: "archive_unsafe" } };

export interface ReleaseArchivePreflightInput {
  /** Held immutable bytes, never a path, URL, stream, or caller-provided source. */
  readonly bytes: Uint8Array;
  /** Derived by the trusted release resolver, never selected by the client. */
  readonly archiveType: ReleaseArchiveType;
  /** Trusted server limits. Values may only reduce the profile defaults. */
  readonly limits?: Partial<ReleaseArchiveLimits>;
}

const DEFAULT_LIMITS: ReleaseArchiveLimits = Object.freeze({
  maxEntries: 1_024,
  maxHeaders: 2_048,
  maxExtensions: 1_024,
  maxExpandedBytes: 134_217_728,
  maxCompressionRatio: 20,
  maxDepth: 16,
});
const UNSAFE = Object.freeze({ ok: false as const, error: { status: 409 as const, code: "archive_unsafe" as const } });
const ZIP_LOCAL = 0x04034b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_EOCD = 0x06054b50;
const ZIP_DESCRIPTOR = 0x08074b50;
const ZIP64_EOCD = 0x06064b50;
const ZIP64_LOCATOR = 0x07064b50;

class UnsafeArchive extends Error {}
const fail = (): never => { throw new UnsafeArchive(); };

function limitsFor(input: ReleaseArchivePreflightInput): ReleaseArchiveLimits {
  const candidate = { ...DEFAULT_LIMITS, ...input.limits };
  for (const key of Object.keys(DEFAULT_LIMITS) as (keyof ReleaseArchiveLimits)[]) {
    const value = candidate[key];
    if (!Number.isSafeInteger(value) || value < 1 || value > DEFAULT_LIMITS[key]) fail();
  }
  return candidate;
}

function u16(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.length) fail();
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function u32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) fail();
  return (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index]! ^ right[index]!;
  return difference === 0;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = (value >>> 8) ^ crcTable[(value ^ byte) & 0xff]!;
  return (value ^ 0xffffffff) >>> 0;
}

function strictUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch { return fail(); }
}

function ascii(bytes: Uint8Array): string {
  for (const byte of bytes) if (byte > 0x7f) fail();
  return String.fromCharCode(...bytes);
}

function caseFold(value: string): string {
  // ECMAScript lowercasing supplies Unicode simple case mapping. These folds
  // cover the multi-character and final-sigma differences required by default
  // Unicode case folding without consulting the host filesystem.
  return value.toLowerCase().replace(/\u00df/gu, "ss").replace(/\u03c2/gu, "\u03c3");
}

function winTrim(value: string): string { return value.replace(/[ .]+$/u, ""); }
const dosDevice = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/iu;

function portablePath(raw: string, limits: ReleaseArchiveLimits, directory: boolean): { key: string; components: string[] } {
  if (!raw || Buffer.byteLength(raw, "utf8") > 4096 || raw !== raw.normalize("NFC")) fail();
  if (raw.includes("\0") || raw.startsWith("/") || raw.startsWith("\\") || raw.includes("\\") || raw.includes(":")) fail();
  if (directory !== raw.endsWith("/")) fail();
  const body = directory ? raw.slice(0, -1) : raw;
  const components = body.split("/");
  if (!body || components.length > limits.maxDepth || components.some((part) => !part || part === "." || part === "..")) fail();
  for (const component of components) {
    const trimmed = winTrim(component);
    if (!trimmed || dosDevice.test(trimmed)) fail();
  }
  return { key: caseFold(raw), components };
}

function registerPath(
  seen: Set<string>,
  shortNames: Map<string, string>,
  raw: string,
  limits: ReleaseArchiveLimits,
  directory: boolean,
): void {
  const path = portablePath(raw, limits, directory);
  if (seen.has(path.key)) fail();
  seen.add(path.key);
  // A literal DOS short name can alias a generated short name.  The complete
  // Win32 numbering algorithm is volume state, so reject ambiguous explicit
  // short-name forms rather than depending on host 8.3 settings.
  for (const component of path.components) {
    const trimmed = caseFold(winTrim(component));
    const alias = /^(.{1,6})~[1-9](\.[^.]{0,3})?$/u.exec(trimmed);
    if (alias && shortNames.has(trimmed)) fail();
    if (alias) shortNames.set(trimmed, component);
  }
}

function ratioAllowed(expanded: number, archiveLength: number, limits: ReleaseArchiveLimits): boolean {
  return expanded <= limits.maxExpandedBytes && expanded <= limits.maxCompressionRatio * Math.max(1, archiveLength);
}

interface ZipRecord { offset: number; end: number; name: string; directory: boolean; size: number; }

function zipFlagsAllowed(flags: number): boolean { return (flags & ~(0x0008 | 0x0800)) === 0; }

function zipName(bytes: Uint8Array, flags: number): string {
  if ((flags & 0x0800) === 0) {
    if (bytes.some((value) => value > 0x7f)) fail();
    return ascii(bytes);
  }
  return strictUtf8(bytes);
}

function validateZip(bytes: Uint8Array, limits: ReleaseArchiveLimits): ReleaseArchiveInventory {
  if (bytes.length < 22 || u32(bytes, 0) !== ZIP_LOCAL || bytes.some((_, index) => index + 4 <= bytes.length && (u32(bytes, index) === ZIP64_EOCD || u32(bytes, index) === ZIP64_LOCATOR))) fail();
  const candidates: number[] = [];
  for (let index = Math.max(0, bytes.length - 65_557); index <= bytes.length - 22; index += 1) {
    if (u32(bytes, index) === ZIP_EOCD && index + 22 + u16(bytes, index + 20) === bytes.length) candidates.push(index);
  }
  if (candidates.length !== 1) fail();
  const eocd = candidates[0]!;
  if (u16(bytes, eocd + 4) !== 0 || u16(bytes, eocd + 6) !== 0) fail();
  const entries = u16(bytes, eocd + 10);
  if (u16(bytes, eocd + 8) !== entries || entries > limits.maxEntries) fail();
  const centralLength = u32(bytes, eocd + 12);
  const centralOffset = u32(bytes, eocd + 16);
  if (centralOffset === 0 || centralOffset + centralLength !== eocd || centralOffset >= eocd) fail();
  const records: ZipRecord[] = [];
  const seen = new Set<string>();
  const shortNames = new Map<string, string>();
  let cursor = centralOffset;
  let expanded = 0;
  let regularFiles = 0;
  let directories = 0;
  for (let count = 0; count < entries; count += 1) {
    if (u32(bytes, cursor) !== ZIP_CENTRAL || cursor + 46 > centralOffset + centralLength) fail();
    const flags = u16(bytes, cursor + 8); const method = u16(bytes, cursor + 10);
    const crc = u32(bytes, cursor + 16); const compressed = u32(bytes, cursor + 20); const size = u32(bytes, cursor + 24);
    const nameLength = u16(bytes, cursor + 28); const extraLength = u16(bytes, cursor + 30); const commentLength = u16(bytes, cursor + 32);
    const disk = u16(bytes, cursor + 34); const attrs = u32(bytes, cursor + 38); const localOffset = u32(bytes, cursor + 42);
    const recordEnd = cursor + 46 + nameLength + extraLength + commentLength;
    if (!zipFlagsAllowed(flags) || method !== 0 && method !== 8 || extraLength !== 0 || disk !== 0 || recordEnd > centralOffset + centralLength) fail();
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = zipName(nameBytes, flags); const directory = name.endsWith("/");
    const host = u16(bytes, cursor + 4) >>> 8;
    const unixMode = attrs >>> 16;
    const dosAttributes = attrs & 0xffff;
    if (host === 3) {
      const expectedType = directory ? 0o040000 : 0o100000;
      if ((unixMode & 0o170000) !== expectedType || (unixMode & 0o7000) !== 0 || dosAttributes !== (directory ? 0x10 : 0)) fail();
    } else if (dosAttributes !== (directory ? 0x10 : 0) || unixMode !== 0) fail();
    if (directory ? compressed !== 0 || size !== 0 : false) fail();
    registerPath(seen, shortNames, name, limits, directory);
    if (!directory) { expanded += size; regularFiles += 1; if (!ratioAllowed(expanded, bytes.length, limits)) fail(); } else directories += 1;
    if (localOffset >= centralOffset || u32(bytes, localOffset) !== ZIP_LOCAL || localOffset + 30 > centralOffset) fail();
    const localFlags = u16(bytes, localOffset + 6); const localMethod = u16(bytes, localOffset + 8);
    const localCrc = u32(bytes, localOffset + 14); const localCompressed = u32(bytes, localOffset + 18); const localSize = u32(bytes, localOffset + 22);
    const localNameLength = u16(bytes, localOffset + 26); const localExtraLength = u16(bytes, localOffset + 28);
    const payloadStart = localOffset + 30 + localNameLength + localExtraLength;
    if (localFlags !== flags || localMethod !== method || localExtraLength !== 0 || !equalBytes(nameBytes, bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength)) || payloadStart + compressed > centralOffset) fail();
    let end = payloadStart + compressed;
    if ((flags & 0x0008) !== 0) {
      if (localCrc !== 0 || localCompressed !== 0 || localSize !== 0 || u32(bytes, end) !== ZIP_DESCRIPTOR || u32(bytes, end + 4) !== crc || u32(bytes, end + 8) !== compressed || u32(bytes, end + 12) !== size) fail();
      end += 16;
    } else if (localCrc !== crc || localCompressed !== compressed || localSize !== size) fail();
    if (end > centralOffset) fail();
    const payload = bytes.subarray(payloadStart, payloadStart + compressed);
    let content: Uint8Array = new Uint8Array();
    try { content = method === 0 ? payload : inflateRawSync(payload, { maxOutputLength: Math.max(1, Math.min(limits.maxExpandedBytes, size)) }); } catch { fail(); }
    if (content.length !== size || crc32(content) !== crc) fail();
    records.push({ offset: localOffset, end, name, directory, size });
    cursor = recordEnd;
  }
  if (cursor !== centralOffset + centralLength) fail();
  records.sort((left, right) => left.offset - right.offset);
  for (let index = 1; index < records.length; index += 1) if (records[index - 1]!.end > records[index]!.offset) fail();
  return { archiveType: "zip", entries, regularFiles, directories, expandedBytes: expanded };
}

function allZero(bytes: Uint8Array): boolean { return bytes.every((byte) => byte === 0); }
function tarString(header: Uint8Array, start: number, length: number): string {
  const field = header.subarray(start, start + length); const terminator = field.indexOf(0);
  if (terminator < 0 || !allZero(field.subarray(terminator))) fail();
  return strictUtf8(field.subarray(0, terminator));
}
function tarOctal(header: Uint8Array, start: number, length: number, required: boolean): number {
  const field = header.subarray(start, start + length); let terminator = -1;
  for (let index = 0; index < field.length; index += 1) if (field[index] === 0 || field[index] === 0x20) { terminator = index; break; }
  if (terminator < 0 || !field.subarray(terminator).every((byte) => byte === 0 || byte === 0x20)) fail();
  const digits = field.subarray(0, terminator);
  if ((required && digits.length === 0) || digits.some((byte) => byte < 0x30 || byte > 0x37)) fail();
  const value = digits.length ? Number.parseInt(ascii(digits), 8) : 0;
  if (!Number.isSafeInteger(value)) fail();
  return value;
}
function tarChecksum(header: Uint8Array): boolean {
  const expected = tarOctal(header, 148, 8, true); let sum = 0;
  for (let index = 0; index < 512; index += 1) sum += index >= 148 && index < 156 ? 0x20 : header[index]!;
  return expected === sum;
}
function readGzip(bytes: Uint8Array, limits: ReleaseArchiveLimits): Uint8Array {
  if (bytes.length < 18 || bytes[0] !== 0x1f || bytes[1] !== 0x8b || bytes[2] !== 8) fail();
  const flags = bytes[3]!; if ((flags & 0xe0) !== 0) fail(); let cursor = 10;
  const bounded = (terminated: boolean): void => {
    const start = cursor;
    if (terminated) { while (cursor < bytes.length && bytes[cursor] !== 0) cursor += 1; if (cursor >= bytes.length) fail(); cursor += 1; }
    else { if (cursor + 2 > bytes.length) fail(); const length = u16(bytes, cursor); cursor += 2 + length; }
    if (cursor > bytes.length - 8 || cursor - start > 4096) fail();
  };
  if ((flags & 4) !== 0) bounded(false); if ((flags & 8) !== 0) bounded(true); if ((flags & 16) !== 0) bounded(true);
  if ((flags & 2) !== 0) { if (cursor + 2 > bytes.length - 8 || cursor + 2 > 4096) fail(); if (u16(bytes, cursor) !== (crc32(bytes.subarray(0, cursor)) & 0xffff)) fail(); cursor += 2; }
  const compressed = bytes.subarray(cursor, bytes.length - 8); let inflated: Uint8Array = new Uint8Array();
  try {
    // Node exposes `info` at runtime before its ambient declarations did. The
    // consumed-byte count is necessary to reject a concatenated gzip member.
    const result = inflateRawSync(compressed, { maxOutputLength: limits.maxExpandedBytes, info: true } as never) as unknown as { buffer: Uint8Array; engine: { bytesWritten: number } };
    if (result.engine.bytesWritten !== compressed.length) fail(); inflated = result.buffer;
  } catch { fail(); }
  if (crc32(inflated) !== u32(bytes, bytes.length - 8) || (inflated.length >>> 0) !== u32(bytes, bytes.length - 4)) fail();
  return inflated;
}

interface PendingExtension { name?: string; pax?: { path?: string; size?: number }; }
function paxRecords(payload: Uint8Array): PendingExtension {
  if (payload.length < 1 || payload.length > 8192) fail(); const output: PendingExtension = {}; const keys = new Set<string>(); let cursor = 0; let count = 0;
  while (cursor < payload.length) {
    const space = payload.indexOf(0x20, cursor); if (space < 0) fail(); const lengthText = ascii(payload.subarray(cursor, space));
    if (!/^(0|[1-9][0-9]*)$/u.test(lengthText)) fail(); const length = Number(lengthText); const end = cursor + length;
    if (!Number.isSafeInteger(length) || end > payload.length || end <= space + 1 || payload[end - 1] !== 0x0a) fail();
    const record = payload.subarray(space + 1, end - 1); const equal = record.indexOf(0x3d); if (equal < 1) fail(); const key = ascii(record.subarray(0, equal)); const value = record.subarray(equal + 1);
    if (keys.has(key) || !["path", "size", "mtime"].includes(key)) fail(); keys.add(key); count += 1; if (count > 16) fail();
    if (key === "path") output.pax = { ...output.pax, path: strictUtf8(value) };
    if (key === "size") { const text = ascii(value); if (!/^(0|[1-9][0-9]*)$/u.test(text)) fail(); const size = Number(text); if (!Number.isSafeInteger(size) || size > 134_217_728) fail(); output.pax = { ...output.pax, size }; }
    if (key === "mtime" && !/^[0-9]+(?:\.[0-9]{1,9})?$/u.test(ascii(value)) || key === "mtime" && value.length > 20) fail();
    cursor = end;
  }
  return output;
}

function validateTar(bytes: Uint8Array, limits: ReleaseArchiveLimits, archiveType: "tar.gz" | "tgz"): ReleaseArchiveInventory {
  const tar = readGzip(bytes, limits); if (tar.length < 1024 || tar.length % 512 !== 0) fail();
  const seen = new Set<string>(); const shortNames = new Map<string, string>(); let headers = 0; let extensions = 0; let entries = 0; let files = 0; let directories = 0; let expanded = 0; let cursor = 0; let pending: PendingExtension | null = null; let ended = false;
  while (cursor < tar.length) {
    const header = tar.subarray(cursor, cursor + 512); cursor += 512;
    if (allZero(header)) { if (cursor + 512 > tar.length || !allZero(tar.subarray(cursor, cursor + 512))) fail(); cursor += 512; if (!allZero(tar.subarray(cursor))) fail(); ended = true; break; }
    if (ended || pending && false) fail(); headers += 1; if (headers > limits.maxHeaders || !tarChecksum(header)) fail();
    if (!equalBytes(header.subarray(257, 263), Buffer.from("ustar\0")) && !equalBytes(header.subarray(257, 263), Buffer.from("ustar "))) fail();
    if (!equalBytes(header.subarray(263, 265), Buffer.from("00")) && !equalBytes(header.subarray(263, 265), Buffer.from(" \0"))) fail();
    const mode = tarOctal(header, 100, 8, false); const size = tarOctal(header, 124, 12, true); tarOctal(header, 108, 8, false); tarOctal(header, 116, 8, false); tarOctal(header, 136, 12, false);
    if ((mode & 0o7000) !== 0 || tarOctal(header, 329, 8, false) !== 0 || tarOctal(header, 337, 8, false) !== 0 || size > limits.maxExpandedBytes) fail();
    const type = header[156]!; const name = tarString(header, 0, 100); const prefix = tarString(header, 345, 155); const ordinary = prefix ? `${prefix}/${name}` : name;
    const payloadEnd = cursor + size; const padding = (512 - (size % 512)) % 512; if (payloadEnd + padding > tar.length || !allZero(tar.subarray(payloadEnd, payloadEnd + padding))) fail();
    const payload = tar.subarray(cursor, payloadEnd); cursor = payloadEnd + padding;
    if (type === 76 || type === 120) {
      if (pending) fail(); extensions += 1; if (extensions > limits.maxExtensions) fail();
      if (type === 76) { if (size < 2 || size > 4097 || payload[size - 1] !== 0) fail(); pending = { name: strictUtf8(payload.subarray(0, size - 1)) }; }
      else pending = paxRecords(payload);
      continue;
    }
    if (type !== 0 && type !== 48 && type !== 53) fail();
    const directory = type === 53; if (directory && size !== 0) fail(); if (pending?.name && pending.pax?.path) fail();
    const effective = pending?.name ?? pending?.pax?.path ?? ordinary;
    if (pending?.pax?.size !== undefined && (directory || pending.pax.size !== size)) fail();
    pending = null; entries += 1; if (entries > limits.maxEntries) fail();
    registerPath(seen, shortNames, effective, limits, directory);
    if (directory) directories += 1; else { files += 1; expanded += size; if (!ratioAllowed(expanded, bytes.length, limits)) fail(); }
  }
  if (!ended || pending) fail();
  return { archiveType, entries, regularFiles: files, directories, expandedBytes: expanded };
}

export function preflightReleaseArchive(input: ReleaseArchivePreflightInput): ReleaseArchivePreflightResult {
  try {
    if (!(input.bytes instanceof Uint8Array) || input.bytes.length === 0 || !["zip", "tar.gz", "tgz"].includes(input.archiveType)) fail();
    const limits = limitsFor(input); const bytes = input.bytes;
    const inventory = input.archiveType === "zip" ? validateZip(bytes, limits) : validateTar(bytes, limits, input.archiveType);
    return { ok: true, inventory };
  } catch { return UNSAFE; }
}
