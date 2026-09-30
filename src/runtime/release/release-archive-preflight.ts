import { Inflate } from "fflate";
import { caseFold as unicodeCaseFold } from "unicode-case-folding";

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
  value = crc32Update(value, bytes);
  return (value ^ 0xffffffff) >>> 0;
}

function crc32Update(value: number, bytes: Uint8Array): number {
  for (const byte of bytes) value = (value >>> 8) ^ crcTable[(value ^ byte) & 0xff]!;
  return value;
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
  // unicode-case-folding@1.1.1 is the pinned, generated UCD full folding map.
  // It uses Default mappings, not the locale-specific Turkic mappings.
  return unicodeCaseFold(value);
}

function winTrim(value: string): string { return value.replace(/[ .]+$/u, ""); }
const dosDevice = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/iu;

interface PortablePath { key: string; components: string[]; }

interface NamespaceNode {
  kind?: "file" | "directory";
  children: Map<string, NamespaceNode>;
}

function portablePath(raw: string, limits: ReleaseArchiveLimits, directory: boolean): PortablePath {
  if (!raw || Buffer.byteLength(raw, "utf8") > 4096 || raw !== raw.normalize("NFC")) fail();
  if (raw.includes("\0") || raw.startsWith("/") || raw.startsWith("\\") || raw.includes("\\") || raw.includes(":")) fail();
  if (directory !== raw.endsWith("/")) fail();
  const body = directory ? raw.slice(0, -1) : raw;
  const components = body.split("/");
  if (!body || components.length > limits.maxDepth || components.some((part) => !part || part === "." || part === "..")) fail();
  for (const component of components) {
    if (/[\u0001-\u001f<>"|?*]/u.test(component)) fail();
    const trimmed = winTrim(component);
    if (!trimmed || trimmed !== component || dosDevice.test(trimmed)) fail();
  }
  const canonical = components.map(caseFold);
  return { key: canonical.join("/"), components: canonical };
}

function aliasesFor(component: string): Set<string> {
  const dot = component.lastIndexOf(".");
  const stem = dot > 0 ? component.slice(0, dot) : component;
  const extension = dot > 0 ? component.slice(dot) : "";
  const aliases = new Set<string>([component]);
  if (stem.length > 8 || extension.length > 4) aliases.add(`${stem.slice(0, 6)}~1${extension.slice(0, 4)}`);
  return aliases;
}

function registerPath(
  root: NamespaceNode,
  shortNamesByParent: Map<string, Map<string, string>>,
  raw: string,
  limits: ReleaseArchiveLimits,
  directory: boolean,
): void {
  const path = portablePath(raw, limits, directory);
  let node = root;
  let parentKey = "";
  for (let index = 0; index < path.components.length; index += 1) {
    if (node.kind === "file") fail();
    const component = path.components[index]!;
    let aliases = shortNamesByParent.get(parentKey);
    if (!aliases) { aliases = new Map<string, string>(); shortNamesByParent.set(parentKey, aliases); }
    for (const alias of aliasesFor(component)) {
      const previous = aliases.get(alias);
      if (previous !== undefined && previous !== component) fail();
      aliases.set(alias, component);
    }
    let child = node.children.get(component);
    if (!child) { child = { children: new Map() }; node.children.set(component, child); }
    node = child;
    parentKey = parentKey ? `${parentKey}/${component}` : component;
  }
  if (node.kind || !directory && node.children.size > 0) fail();
  node.kind = directory ? "directory" : "file";
}

function inflateAndDiscard(payload: Uint8Array, size: number, expectedCrc: number, limits: ReleaseArchiveLimits): void {
  let total = 0; let checksum = 0xffffffff;
  const inflater = new Inflate((chunk, final) => {
    for (const byte of chunk) checksum = (checksum >>> 8) ^ crcTable[(checksum ^ byte) & 0xff]!;
    total += chunk.length;
    if (total > size || total > limits.maxExpandedBytes) fail();
    if (final && (total !== size || ((checksum ^ 0xffffffff) >>> 0) !== expectedCrc)) fail();
  });
  try {
    for (let offset = 0; offset < payload.length; offset += 16 * 1024) inflater.push(payload.subarray(offset, Math.min(payload.length, offset + 16 * 1024)), offset + 16 * 1024 >= payload.length);
  } catch { fail(); }
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
  const namespace: NamespaceNode = { children: new Map() };
  const shortNamesByParent = new Map<string, Map<string, string>>();
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
    registerPath(namespace, shortNamesByParent, name, limits, directory);
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
    if (method === 0) {
      if (payload.length !== size || crc32(payload) !== crc) fail();
    } else inflateAndDiscard(payload, size, crc, limits);
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
interface PendingExtension { name?: string; pax?: { path?: string; size?: number }; }
class TarStreamValidator {
  private readonly namespace: NamespaceNode = { children: new Map() };
  private readonly shortNamesByParent = new Map<string, Map<string, string>>();
  private buffered = new Uint8Array(0);
  private payloadRemaining = 0;
  private paddingRemaining = 0;
  private extensionPayload: Uint8Array | undefined;
  private extensionOffset = 0;
  private extensionType = 0;
  private pending: PendingExtension | null = null;
  private firstEnd = false;
  private ended = false;
  headers = 0;
  extensions = 0;
  entries = 0;
  files = 0;
  directories = 0;
  expanded = 0;

  constructor(private readonly bytes: Uint8Array, private readonly limits: ReleaseArchiveLimits) {}

  write(chunk: Uint8Array): void {
    let cursor = 0;
    while (cursor < chunk.length) {
      if (this.ended) {
        if (!allZero(chunk.subarray(cursor))) fail();
        return;
      }
      if (this.payloadRemaining > 0) {
        const count = Math.min(this.payloadRemaining, chunk.length - cursor);
        if (this.extensionPayload) this.extensionPayload.set(chunk.subarray(cursor, cursor + count), this.extensionOffset);
        this.extensionOffset += count;
        this.payloadRemaining -= count;
        cursor += count;
        if (this.payloadRemaining === 0) this.finishPayload();
        continue;
      }
      if (this.paddingRemaining > 0) {
        const count = Math.min(this.paddingRemaining, chunk.length - cursor);
        if (!allZero(chunk.subarray(cursor, cursor + count))) fail();
        this.paddingRemaining -= count;
        cursor += count;
        continue;
      }
      const count = Math.min(512 - this.buffered.length, chunk.length - cursor);
      const next = new Uint8Array(this.buffered.length + count);
      next.set(this.buffered); next.set(chunk.subarray(cursor, cursor + count), this.buffered.length);
      this.buffered = next;
      cursor += count;
      if (this.buffered.length === 512) { const header = this.buffered; this.buffered = new Uint8Array(0); this.beginHeader(header); }
    }
  }

  finish(): ReleaseArchiveInventory {
    if (this.buffered.length !== 0 || this.payloadRemaining !== 0 || this.paddingRemaining !== 0 || !this.ended || this.pending) fail();
    return { archiveType: "tar.gz", entries: this.entries, regularFiles: this.files, directories: this.directories, expandedBytes: this.expanded };
  }

  private beginHeader(header: Uint8Array): void {
    if (allZero(header)) {
      if (!this.firstEnd) { this.firstEnd = true; return; }
      this.ended = true;
      return;
    }
    if (this.firstEnd) fail();
    this.headers += 1; if (this.headers > this.limits.maxHeaders || !tarChecksum(header)) fail();
    if (!equalBytes(header.subarray(257, 263), Buffer.from("ustar\0")) && !equalBytes(header.subarray(257, 263), Buffer.from("ustar "))) fail();
    if (!equalBytes(header.subarray(263, 265), Buffer.from("00")) && !equalBytes(header.subarray(263, 265), Buffer.from(" \0"))) fail();
    const mode = tarOctal(header, 100, 8, false); const size = tarOctal(header, 124, 12, true);
    tarOctal(header, 108, 8, false); tarOctal(header, 116, 8, false); tarOctal(header, 136, 12, false);
    if ((mode & 0o170000) !== 0 || (mode & 0o7000) !== 0 || tarOctal(header, 329, 8, false) !== 0 || tarOctal(header, 337, 8, false) !== 0 || size > this.limits.maxExpandedBytes || tarString(header, 157, 100)) fail();
    const type = header[156]!; const name = tarString(header, 0, 100); const prefix = tarString(header, 345, 155); const ordinary = prefix ? `${prefix}/${name}` : name;
    this.payloadRemaining = size; this.paddingRemaining = (512 - (size % 512)) % 512; this.extensionType = 0;
    if (type === 76 || type === 120) {
      if (this.pending || (type === 76 && (size < 2 || size > 4097)) || (type === 120 && (size < 1 || size > 8192))) fail();
      this.extensions += 1; if (this.extensions > this.limits.maxExtensions) fail();
      this.extensionPayload = new Uint8Array(size); this.extensionType = type; return;
    }
    if (type !== 0 && type !== 48 && type !== 53) fail();
    const directory = type === 53;
    if (directory && size !== 0 || this.pending?.name && this.pending.pax?.path) fail();
    const effective = this.pending?.name ?? this.pending?.pax?.path ?? ordinary;
    if (this.pending?.pax?.size !== undefined && (directory || this.pending.pax.size !== size)) fail();
    this.pending = null; this.entries += 1; if (this.entries > this.limits.maxEntries) fail();
    registerPath(this.namespace, this.shortNamesByParent, effective, this.limits, directory);
    if (directory) this.directories += 1;
    else { this.files += 1; this.expanded += size; if (!ratioAllowed(this.expanded, this.bytes.length, this.limits)) fail(); }
  }

  private finishPayload(): void {
    if (!this.extensionPayload) return;
    const payload = this.extensionPayload; this.extensionPayload = undefined;
    if (this.extensionType === 76) {
      if (payload[payload.length - 1] !== 0) fail();
      this.pending = { name: strictUtf8(payload.subarray(0, payload.length - 1)) };
    } else this.pending = paxRecords(payload);
    this.extensionOffset = 0; this.extensionType = 0;
  }
}

function streamGzipTar(bytes: Uint8Array, limits: ReleaseArchiveLimits): ReleaseArchiveInventory {
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
  const compressed = bytes.subarray(cursor, bytes.length - 8);
  const validator = new TarStreamValidator(bytes, limits); let expanded = 0; let checksum = 0xffffffff; let finalSeen = false;
  try {
    const inflater = new Inflate((chunk, final) => {
      expanded += chunk.length; checksum = crc32Update(checksum, chunk);
      if (expanded > limits.maxExpandedBytes) fail();
      validator.write(chunk); if (final) finalSeen = true;
    });
    for (let offset = 0; offset < compressed.length; offset += 16 * 1024) inflater.push(compressed.subarray(offset, Math.min(compressed.length, offset + 16 * 1024)), offset + 16 * 1024 >= compressed.length);
    const internals = inflater as unknown as { p: Uint8Array; s: { f?: number; p?: number } };
    // fflate retains the final, partially consumed DEFLATE byte. Its unused
    // padding bits must be zero; any additional byte is a trailing stream.
    if (!finalSeen || internals.s.f !== 1 || internals.p.length > 1 || (internals.p.length === 1 && (!(internals.s.p && internals.s.p > 0) || (internals.p[0]! >>> internals.s.p) !== 0))) fail();
  } catch { fail(); }
  if (((checksum ^ 0xffffffff) >>> 0) !== u32(bytes, bytes.length - 8) || (expanded >>> 0) !== u32(bytes, bytes.length - 4)) fail();
  return validator.finish();
}

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
  const inventory = streamGzipTar(bytes, limits);
  return { ...inventory, archiveType };
}

export function preflightReleaseArchive(input: ReleaseArchivePreflightInput): ReleaseArchivePreflightResult {
  try {
    if (!(input.bytes instanceof Uint8Array) || input.bytes.length === 0 || !["zip", "tar.gz", "tgz"].includes(input.archiveType)) fail();
    const limits = limitsFor(input); const bytes = input.bytes;
    const inventory = input.archiveType === "zip" ? validateZip(bytes, limits) : validateTar(bytes, limits, input.archiveType);
    return { ok: true, inventory };
  } catch { return UNSAFE; }
}
