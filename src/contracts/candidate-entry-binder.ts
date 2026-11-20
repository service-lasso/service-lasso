import { createHash } from "node:crypto";

export const CANDIDATE_ENTRY_BINDER_MAGIC = Buffer.from("SLBIND1\0", "ascii");
export const CANDIDATE_ENTRY_BINDER_VERSION = 1;
export const CANDIDATE_ENTRY_BINDER_HEADER_BYTES = 128;
export const CANDIDATE_ENTRY_BINDER_SECTION_ENTRY_BYTES = 40;
export const CANDIDATE_ENTRY_BINDER_MAX_BYTES = 4 * 1024 * 1024;
export const CANDIDATE_ENTRY_BINDER_MAX_CONTROL_BYTES = 64 * 1024;
export const CANDIDATE_ENTRY_BINDER_FLAG_DEVELOPMENT_SYNTHETIC = 1;
export const CANDIDATE_ENTRY_HANDOFF_DIGEST_DOMAIN = Buffer.from(
  "service-lasso.candidate-entry-handoff.v1\0",
  "ascii",
);
export const CANDIDATE_ENTRY_IMAGE_DIGEST_DOMAIN = Buffer.from(
  "service-lasso.entry-binding.v1\0",
  "ascii",
);

export const CANDIDATE_ENTRY_BINDER_SECTION = {
  CHARGE: 1,
  SOURCE: 2,
  DOMAIN: 3,
  ACTORS: 4,
  BASES: 5,
  PUBLIC_INPUT: 6,
  DEADLINE: 7,
  ISSUER: 8,
  CUSTODY: 9,
  CAPTURE: 10,
  OBSERVATION: 11,
} as const;

export type CandidateEntryBinderSectionKind =
  (typeof CANDIDATE_ENTRY_BINDER_SECTION)[keyof typeof CANDIDATE_ENTRY_BINDER_SECTION];

export const CANDIDATE_ENTRY_BINDER_REQUIRED_SECTIONS: readonly CandidateEntryBinderSectionKind[] =
  Object.freeze([
    CANDIDATE_ENTRY_BINDER_SECTION.CHARGE,
    CANDIDATE_ENTRY_BINDER_SECTION.SOURCE,
    CANDIDATE_ENTRY_BINDER_SECTION.DOMAIN,
    CANDIDATE_ENTRY_BINDER_SECTION.ACTORS,
    CANDIDATE_ENTRY_BINDER_SECTION.BASES,
    CANDIDATE_ENTRY_BINDER_SECTION.PUBLIC_INPUT,
    CANDIDATE_ENTRY_BINDER_SECTION.DEADLINE,
    CANDIDATE_ENTRY_BINDER_SECTION.ISSUER,
    CANDIDATE_ENTRY_BINDER_SECTION.CUSTODY,
  ]);

const sectionLimit = (kind: CandidateEntryBinderSectionKind): number =>
  kind === CANDIDATE_ENTRY_BINDER_SECTION.SOURCE ||
  kind === CANDIDATE_ENTRY_BINDER_SECTION.PUBLIC_INPUT
    ? 1024 * 1024
    : 256 * 1024;

export type CandidateEntryBinderCoreRefusalCode =
  | "binder_originals_unavailable"
  | "binder_image_too_large"
  | "binder_image_encoding_failed"
  | "binder_message_invalid"
  | "binder_ack_mismatch"
  | "binder_lease_failed"
  | "binder_channel_closed"
  | "binder_timeout";

export type CandidateEntryBinderConsumerRefusalCode =
  | "binder_channel_absent"
  | "binder_image_missing"
  | "binder_image_hash_mismatch"
  | "binder_image_magic_invalid"
  | "binder_image_version_unsupported"
  | "binder_image_flags_unsupported"
  | "binder_image_size_invalid"
  | "binder_image_digest_mismatch"
  | "binder_handoff_digest_mismatch"
  | "binder_section_table_invalid"
  | "binder_section_unknown"
  | "binder_section_duplicate"
  | "binder_section_missing"
  | "binder_section_bounds"
  | "binder_section_overlap"
  | "binder_section_alignment"
  | "binder_section_limit"
  | "binder_seal_failed"
  | "binder_view_invalid"
  | "binder_native_abi_mismatch";

export type CandidateEntryBinderRefusalCode =
  | CandidateEntryBinderCoreRefusalCode
  | CandidateEntryBinderConsumerRefusalCode;

export type CandidateEntryBinderResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: CandidateEntryBinderRefusalCode };

export interface CandidateEntryBinderSection {
  kind: CandidateEntryBinderSectionKind;
  bytes: Uint8Array;
  itemCount?: number;
}

export interface CandidateEntryBinderImageInput {
  handoffLine: Uint8Array | string;
  sections: readonly CandidateEntryBinderSection[];
  synthetic?: boolean;
}

export interface CandidateEntryBinderDecodeInput {
  image: Uint8Array;
  handoffLine: Uint8Array | string;
  imageSha256?: string;
  allowSynthetic?: boolean;
}

export interface CandidateEntryBinderImageView {
  kind: CandidateEntryBinderSectionKind;
  flags: number;
  offset: number;
  length: number;
  alignment: number;
  itemCount: number;
  bytes: Uint8Array;
}

export interface CandidateEntryBinderImage {
  bytes: Uint8Array;
  imageSha256: string;
  handoffDigest: string;
  flags: number;
  views: readonly CandidateEntryBinderImageView[];
}

interface EncodedSection {
  kind: CandidateEntryBinderSectionKind;
  bytes: Uint8Array;
  itemCount: number;
  offset: number;
}

const refusal = <T>(code: CandidateEntryBinderRefusalCode): CandidateEntryBinderResult<T> => ({
  ok: false,
  code,
});

function align8(value: number): number {
  return (value + 7) & ~7;
}

function isSectionKind(value: number): value is CandidateEntryBinderSectionKind {
  return (
    Number.isInteger(value) &&
    value >= CANDIDATE_ENTRY_BINDER_SECTION.CHARGE &&
    value <= CANDIDATE_ENTRY_BINDER_SECTION.OBSERVATION
  );
}

function handoffBytes(value: Uint8Array | string): Uint8Array {
  if (typeof value === "string") return Buffer.from(value, "utf8");
  if (value instanceof Uint8Array) return value;
  throw new TypeError("Handoff line must be bytes or a string.");
}

function checkHandoffLine(value: Uint8Array | string): Uint8Array {
  const bytes = handoffBytes(value);
  for (const byte of bytes) {
    if (byte === 0 || byte === 0x0a || byte === 0x0d) {
      throw new TypeError("Handoff line must not contain NUL or line terminators.");
    }
  }
  return bytes;
}

function sha256Hex(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function digestBytes(domain: Uint8Array, ...parts: Uint8Array[]): Buffer {
  const hash = createHash("sha256").update(domain);
  for (const part of parts) hash.update(part);
  return hash.digest();
}

export function computeCandidateEntryHandoffDigest(value: Uint8Array | string): string {
  return `sha256:${digestBytes(CANDIDATE_ENTRY_HANDOFF_DIGEST_DOMAIN, checkHandoffLine(value)).toString("hex")}`;
}

export function computeCandidateEntryImageDigest(header: Uint8Array, body: Uint8Array): string {
  const zeroed = Buffer.from(header);
  zeroed.fill(0, 88, 120);
  return `sha256:${digestBytes(CANDIDATE_ENTRY_IMAGE_DIGEST_DOMAIN, zeroed, body).toString("hex")}`;
}

function validateSections(
  sections: readonly CandidateEntryBinderSection[],
): CandidateEntryBinderResult<EncodedSection[]> {
  if (!Array.isArray(sections) || sections.length === 0) {
    return refusal("binder_image_encoding_failed");
  }
  const seen = new Set<number>();
  const encoded: EncodedSection[] = [];
  for (const section of sections) {
    if (!section || typeof section !== "object") {
      return refusal("binder_image_encoding_failed");
    }
    const kind = section.kind;
    if (!isSectionKind(kind)) return refusal("binder_section_unknown");
    if (seen.has(kind)) return refusal("binder_section_duplicate");
    seen.add(kind);
    if (!(section.bytes instanceof Uint8Array)) {
      return refusal("binder_image_encoding_failed");
    }
    if (section.bytes.length === 0) return refusal("binder_section_bounds");
    if (section.bytes.length > sectionLimit(kind)) {
      return refusal("binder_section_limit");
    }
    const itemCount = section.itemCount ?? 1;
    if (!Number.isSafeInteger(itemCount) || itemCount <= 0 || itemCount > section.bytes.length) {
      return refusal("binder_image_encoding_failed");
    }
    encoded.push({ kind, bytes: section.bytes, itemCount, offset: 0 });
  }
  for (const required of CANDIDATE_ENTRY_BINDER_REQUIRED_SECTIONS) {
    if (!seen.has(required)) return refusal("binder_section_missing");
  }
  return { ok: true, value: encoded };
}

export function encodeCandidateEntryBinderImage(
  input: CandidateEntryBinderImageInput,
): CandidateEntryBinderResult<CandidateEntryBinderImage> {
  try {
    if (!input || typeof input !== "object") return refusal("binder_image_encoding_failed");
    const handoff = checkHandoffLine(input.handoffLine);
    const sections = validateSections(input.sections);
    if (!sections.ok) return sections;

    const tableBytes = sections.value.length * CANDIDATE_ENTRY_BINDER_SECTION_ENTRY_BYTES;
    let cursor = align8(CANDIDATE_ENTRY_BINDER_HEADER_BYTES + tableBytes);
    const placements: EncodedSection[] = [];
    for (const section of sections.value) {
      cursor = align8(cursor);
      placements.push({ ...section, offset: cursor });
      cursor += section.bytes.length;
      if (cursor > CANDIDATE_ENTRY_BINDER_MAX_BYTES) {
        return refusal("binder_image_too_large");
      }
    }
    const imageBytes = align8(cursor);
    if (imageBytes > CANDIDATE_ENTRY_BINDER_MAX_BYTES) {
      return refusal("binder_image_too_large");
    }

    const image = Buffer.alloc(imageBytes);
    CANDIDATE_ENTRY_BINDER_MAGIC.copy(image, 0);
    image.writeUInt16LE(CANDIDATE_ENTRY_BINDER_VERSION, 8);
    image.writeUInt16LE(CANDIDATE_ENTRY_BINDER_HEADER_BYTES, 10);
    const flags = input.synthetic ? CANDIDATE_ENTRY_BINDER_FLAG_DEVELOPMENT_SYNTHETIC : 0;
    image.writeUInt32LE(flags, 12);
    image.writeBigUInt64LE(BigInt(imageBytes), 16);
    image.writeBigUInt64LE(BigInt(placements.length), 24);
    image.writeBigUInt64LE(BigInt(CANDIDATE_ENTRY_BINDER_HEADER_BYTES), 32);
    image.writeBigUInt64LE(BigInt(tableBytes), 40);
    image.writeBigUInt64LE(BigInt(CANDIDATE_ENTRY_BINDER_SECTION_ENTRY_BYTES), 48);
    digestBytes(CANDIDATE_ENTRY_HANDOFF_DIGEST_DOMAIN, handoff).copy(image, 56);

    placements.forEach((section, index) => {
      const at = CANDIDATE_ENTRY_BINDER_HEADER_BYTES + index * CANDIDATE_ENTRY_BINDER_SECTION_ENTRY_BYTES;
      image.writeUInt32LE(section.kind, at);
      image.writeUInt32LE(0, at + 4);
      image.writeBigUInt64LE(BigInt(section.offset), at + 8);
      image.writeBigUInt64LE(BigInt(section.bytes.length), at + 16);
      image.writeBigUInt64LE(8n, at + 24);
      image.writeBigUInt64LE(BigInt(section.itemCount), at + 32);
      image.set(section.bytes, section.offset);
    });

    const digest = digestBytes(
      CANDIDATE_ENTRY_IMAGE_DIGEST_DOMAIN,
      image.subarray(0, CANDIDATE_ENTRY_BINDER_HEADER_BYTES),
      image.subarray(CANDIDATE_ENTRY_BINDER_HEADER_BYTES),
    );
    digest.copy(image, 88);

    const views: CandidateEntryBinderImageView[] = placements.map((section) => ({
      kind: section.kind,
      flags: 0,
      offset: section.offset,
      length: section.bytes.length,
      alignment: 8,
      itemCount: section.itemCount,
      bytes: Uint8Array.from(section.bytes),
    }));
    Object.freeze(views);
    const value: CandidateEntryBinderImage = {
      bytes: Uint8Array.from(image),
      imageSha256: `sha256:${sha256Hex(image)}`,
      handoffDigest: `sha256:${digestBytes(CANDIDATE_ENTRY_HANDOFF_DIGEST_DOMAIN, handoff).toString("hex")}`,
      flags,
      views,
    };
    return { ok: true, value: Object.freeze(value) };
  } catch {
    return refusal("binder_image_encoding_failed");
  }
}

function readSafeU64(value: bigint, code: CandidateEntryBinderRefusalCode): number | CandidateEntryBinderRefusalCode {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) return code;
  return Number(value);
}

export function decodeCandidateEntryBinderImage(
  input: CandidateEntryBinderDecodeInput,
): CandidateEntryBinderResult<CandidateEntryBinderImage> {
  if (!input || typeof input !== "object" || !(input.image instanceof Uint8Array)) {
    return refusal("binder_image_missing");
  }
  if (input.image.length < CANDIDATE_ENTRY_BINDER_HEADER_BYTES) {
    return refusal("binder_image_size_invalid");
  }
  if (
    input.imageSha256 !== undefined &&
    !/^sha256:[a-f0-9]{64}$/u.test(input.imageSha256)
  ) {
    return refusal("binder_image_hash_mismatch");
  }
  if (input.imageSha256 !== undefined && input.imageSha256 !== `sha256:${sha256Hex(input.image)}`) {
    return refusal("binder_image_hash_mismatch");
  }

  const image = Buffer.from(input.image);
  if (!image.subarray(0, 8).equals(CANDIDATE_ENTRY_BINDER_MAGIC)) {
    return refusal("binder_image_magic_invalid");
  }
  if (image.readUInt16LE(8) !== CANDIDATE_ENTRY_BINDER_VERSION) {
    return refusal("binder_image_version_unsupported");
  }
  if (image.readUInt16LE(10) !== CANDIDATE_ENTRY_BINDER_HEADER_BYTES) {
    return refusal("binder_image_size_invalid");
  }

  const flags = image.readUInt32LE(12);
  if (flags !== 0) {
    if (!(input.allowSynthetic && flags === CANDIDATE_ENTRY_BINDER_FLAG_DEVELOPMENT_SYNTHETIC)) {
      return refusal("binder_image_flags_unsupported");
    }
  }

  const imageBytes = readSafeU64(image.readBigUInt64LE(16), "binder_image_size_invalid");
  if (typeof imageBytes !== "number" || imageBytes !== image.length) {
    return refusal("binder_image_size_invalid");
  }
  if (imageBytes > CANDIDATE_ENTRY_BINDER_MAX_BYTES) {
    return refusal("binder_image_size_invalid");
  }
  for (let index = 120; index < CANDIDATE_ENTRY_BINDER_HEADER_BYTES; index += 1) {
    if (image[index] !== 0) return refusal("binder_image_size_invalid");
  }

  const sectionCount = readSafeU64(image.readBigUInt64LE(24), "binder_section_table_invalid");
  if (typeof sectionCount !== "number" || sectionCount <= 0 || sectionCount > 11) {
    return refusal("binder_section_table_invalid");
  }
  const tableOffset = readSafeU64(image.readBigUInt64LE(32), "binder_section_table_invalid");
  const tableBytes = readSafeU64(image.readBigUInt64LE(40), "binder_section_table_invalid");
  const entryBytes = readSafeU64(image.readBigUInt64LE(48), "binder_section_table_invalid");
  if (
    typeof tableOffset !== "number" ||
    typeof tableBytes !== "number" ||
    typeof entryBytes !== "number" ||
    tableOffset < CANDIDATE_ENTRY_BINDER_HEADER_BYTES ||
    tableOffset % 8 !== 0 ||
    entryBytes !== CANDIDATE_ENTRY_BINDER_SECTION_ENTRY_BYTES ||
    tableBytes !== sectionCount * CANDIDATE_ENTRY_BINDER_SECTION_ENTRY_BYTES ||
    tableOffset + tableBytes > imageBytes
  ) {
    return refusal("binder_section_table_invalid");
  }

  let handoff: Uint8Array;
  try {
    handoff = checkHandoffLine(input.handoffLine);
  } catch {
    return refusal("binder_message_invalid");
  }
  const handoffDigest = digestBytes(CANDIDATE_ENTRY_HANDOFF_DIGEST_DOMAIN, handoff);
  if (!image.subarray(56, 88).equals(handoffDigest)) {
    return refusal("binder_handoff_digest_mismatch");
  }
  const digestHeader = Buffer.from(image.subarray(0, CANDIDATE_ENTRY_BINDER_HEADER_BYTES));
  digestHeader.fill(0, 88, 120);
  const imageDigest = digestBytes(
    CANDIDATE_ENTRY_IMAGE_DIGEST_DOMAIN,
    digestHeader,
    image.subarray(CANDIDATE_ENTRY_BINDER_HEADER_BYTES),
  );
  if (!image.subarray(88, 120).equals(imageDigest)) {
    return refusal("binder_image_digest_mismatch");
  }

  const tableEnd = tableOffset + tableBytes;
  const seen = new Set<number>();
  const sections: Array<{
    kind: CandidateEntryBinderSectionKind;
    flags: number;
    offset: number;
    length: number;
    alignment: number;
    itemCount: number;
  }> = [];
  for (let index = 0; index < sectionCount; index += 1) {
    const at = tableOffset + index * entryBytes;
    const kind = image.readUInt32LE(at);
    if (!isSectionKind(kind)) return refusal("binder_section_unknown");
    if (seen.has(kind)) return refusal("binder_section_duplicate");
    seen.add(kind);
    const sectionFlags = image.readUInt32LE(at + 4);
    if (sectionFlags !== 0) return refusal("binder_section_table_invalid");
    const offset = readSafeU64(image.readBigUInt64LE(at + 8), "binder_section_bounds");
    const length = readSafeU64(image.readBigUInt64LE(at + 16), "binder_section_bounds");
    const alignment = readSafeU64(image.readBigUInt64LE(at + 24), "binder_section_alignment");
    const itemCount = readSafeU64(image.readBigUInt64LE(at + 32), "binder_section_bounds");
    if (
      typeof offset !== "number" ||
      typeof length !== "number" ||
      typeof alignment !== "number" ||
      typeof itemCount !== "number" ||
      length <= 0 ||
      itemCount <= 0
    ) {
      return refusal("binder_section_bounds");
    }
    if (alignment !== 8 || offset % 8 !== 0) {
      return refusal("binder_section_alignment");
    }
    if (offset < tableEnd || offset + length > imageBytes) {
      return refusal("binder_section_bounds");
    }
    if (length > sectionLimit(kind)) {
      return refusal("binder_section_limit");
    }
    if (itemCount > length) return refusal("binder_section_bounds");
    sections.push({ kind, flags: sectionFlags, offset, length, alignment, itemCount });
  }

  for (const required of CANDIDATE_ENTRY_BINDER_REQUIRED_SECTIONS) {
    if (!seen.has(required)) return refusal("binder_section_missing");
  }

  const ordered = [...sections].sort((left, right) => left.offset - right.offset);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (previous.offset + previous.length > current.offset) {
      return refusal("binder_section_overlap");
    }
  }

  const views: CandidateEntryBinderImageView[] = sections.map((section) => ({
    ...section,
    bytes: Uint8Array.from(image.subarray(section.offset, section.offset + section.length)),
  }));
  Object.freeze(views);
  const value: CandidateEntryBinderImage = {
    bytes: Uint8Array.from(image),
    imageSha256: `sha256:${sha256Hex(image)}`,
    handoffDigest: `sha256:${handoffDigest.toString("hex")}`,
    flags,
    views,
  };
  return { ok: true, value: Object.freeze(value) };
}
