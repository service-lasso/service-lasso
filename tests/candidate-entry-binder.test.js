import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CANDIDATE_ENTRY_BINDER_HEADER_BYTES,
  CANDIDATE_ENTRY_BINDER_SECTION,
  computeCandidateEntryImageDigest,
  decodeCandidateEntryBinderImage,
  encodeCandidateEntryBinderImage,
} from '../dist/contracts/candidate-entry-binder.js';

const handoffLine = JSON.stringify({
  contract: 'service-lasso.candidate-entry-handoff.v1',
  lease: { leaseId: 'lease-original' },
});

function sections(overrides = {}) {
  const kinds = [
    CANDIDATE_ENTRY_BINDER_SECTION.CHARGE,
    CANDIDATE_ENTRY_BINDER_SECTION.SOURCE,
    CANDIDATE_ENTRY_BINDER_SECTION.DOMAIN,
    CANDIDATE_ENTRY_BINDER_SECTION.ACTORS,
    CANDIDATE_ENTRY_BINDER_SECTION.BASES,
    CANDIDATE_ENTRY_BINDER_SECTION.PUBLIC_INPUT,
    CANDIDATE_ENTRY_BINDER_SECTION.DEADLINE,
    CANDIDATE_ENTRY_BINDER_SECTION.ISSUER,
    CANDIDATE_ENTRY_BINDER_SECTION.CUSTODY,
  ];
  return kinds.map((kind) => ({
    kind,
    bytes: Buffer.from(`section-${kind}-${overrides[kind] ?? 'original'}`),
  }));
}

function encode(overrides = {}) {
  return encodeCandidateEntryBinderImage({ handoffLine, sections: sections(), ...overrides });
}

function reseal(image) {
  const copy = Buffer.from(image);
  copy.fill(0, 88, 120);
  const digest = computeCandidateEntryImageDigest(
    copy.subarray(0, CANDIDATE_ENTRY_BINDER_HEADER_BYTES),
    copy.subarray(CANDIDATE_ENTRY_BINDER_HEADER_BYTES),
  );
  Buffer.from(digest.slice(7), 'hex').copy(copy, 88);
  return copy;
}

function tableEntry(image, index) {
  return CANDIDATE_ENTRY_BINDER_HEADER_BYTES + index * 40;
}

test('binder image encodes and decodes exact sections', () => {
  const encoded = encode();
  assert.equal(encoded.ok, true);
  assert.match(encoded.value.imageSha256, /^sha256:[a-f0-9]{64}$/);
  assert.equal(encoded.value.flags, 0);
  assert.equal(encoded.value.views.length, 9);
  assert.deepEqual(
    encoded.value.views.map((view) => view.kind),
    sections().map((section) => section.kind),
  );
  assert.deepEqual(
    encoded.value.views.map((view) => Buffer.from(view.bytes).toString()),
    sections().map((section) => section.bytes.toString()),
  );

  const decoded = decodeCandidateEntryBinderImage({
    image: encoded.value.bytes,
    imageSha256: encoded.value.imageSha256,
    handoffLine,
  });
  assert.equal(decoded.ok, true);
  assert.equal(decoded.value.imageSha256, encoded.value.imageSha256);
  assert.equal(decoded.value.handoffDigest, encoded.value.handoffDigest);
  assert.deepEqual(
    decoded.value.views.map((view) => Buffer.from(view.bytes).toString()),
    sections().map((section) => section.bytes.toString()),
  );
});

test('optional sections are accepted once each', () => {
  const encoded = encode({
    sections: [
      ...sections(),
      { kind: CANDIDATE_ENTRY_BINDER_SECTION.CAPTURE, bytes: Buffer.from('capture') },
      { kind: CANDIDATE_ENTRY_BINDER_SECTION.OBSERVATION, bytes: Buffer.from('observation') },
    ],
  });
  assert.equal(encoded.ok, true);
  const decoded = decodeCandidateEntryBinderImage({ image: encoded.value.bytes, handoffLine });
  assert.equal(decoded.ok, true);
  assert.equal(decoded.value.views.length, 11);
});

test('production images reject the synthetic flag unless explicitly allowed', () => {
  const encoded = encode({ synthetic: true });
  assert.equal(encoded.ok, true);
  assert.equal(encoded.value.flags, 1);
  assert.deepEqual(
    decodeCandidateEntryBinderImage({ image: encoded.value.bytes, handoffLine }),
    { ok: false, code: 'binder_image_flags_unsupported' },
  );
  assert.equal(
    decodeCandidateEntryBinderImage({ image: encoded.value.bytes, handoffLine, allowSynthetic: true }).ok,
    true,
  );
});

test('handoff digest binds the exact received line bytes', () => {
  const encoded = encode();
  assert.equal(encoded.ok, true);
  const changed = `${handoffLine} `;
  assert.deepEqual(
    decodeCandidateEntryBinderImage({ image: encoded.value.bytes, handoffLine: changed }),
    { ok: false, code: 'binder_handoff_digest_mismatch' },
  );
});

test('image hash and digest mismatches are distinct refusals', () => {
  const encoded = encode();
  assert.equal(encoded.ok, true);
  assert.deepEqual(
    decodeCandidateEntryBinderImage({
      image: encoded.value.bytes,
      imageSha256: `sha256:${'0'.repeat(64)}`,
      handoffLine,
    }),
    { ok: false, code: 'binder_image_hash_mismatch' },
  );

  const tampered = Buffer.from(encoded.value.bytes);
  tampered[tampered.length - 1] ^= 0xff;
  assert.deepEqual(
    decodeCandidateEntryBinderImage({ image: tampered, handoffLine }),
    { ok: false, code: 'binder_image_digest_mismatch' },
  );
});

test('header magic, version, and size are refused before use', () => {
  const encoded = encode();
  assert.equal(encoded.ok, true);

  const magic = Buffer.from(encoded.value.bytes);
  magic[0] = 0;
  assert.deepEqual(
    decodeCandidateEntryBinderImage({ image: magic, handoffLine }),
    { ok: false, code: 'binder_image_magic_invalid' },
  );

  const version = Buffer.from(encoded.value.bytes);
  version.writeUInt16LE(2, 8);
  assert.deepEqual(
    decodeCandidateEntryBinderImage({ image: version, handoffLine }),
    { ok: false, code: 'binder_image_version_unsupported' },
  );

  const size = Buffer.from(encoded.value.bytes);
  size.writeBigUInt64LE(BigInt(size.length + 8), 16);
  assert.deepEqual(
    decodeCandidateEntryBinderImage({ image: size, handoffLine }),
    { ok: false, code: 'binder_image_size_invalid' },
  );
});

test('section table, duplicate, missing, unknown, and overlap classes are refused', () => {
  const encoded = encode();
  assert.equal(encoded.ok, true);

  const tableSize = Buffer.from(encoded.value.bytes);
  tableSize.writeBigUInt64LE(1n, 40);
  assert.deepEqual(
    decodeCandidateEntryBinderImage({ image: tableSize, handoffLine }),
    { ok: false, code: 'binder_section_table_invalid' },
  );

  const duplicate = Buffer.from(encoded.value.bytes);
  duplicate.writeUInt32LE(
    CANDIDATE_ENTRY_BINDER_SECTION.CHARGE,
    tableEntry(duplicate, 1),
  );
  assert.deepEqual(
    decodeCandidateEntryBinderImage({ image: reseal(duplicate), handoffLine }),
    { ok: false, code: 'binder_section_duplicate' },
  );

  const missing = Buffer.from(encoded.value.bytes);
  missing.writeUInt32LE(
    CANDIDATE_ENTRY_BINDER_SECTION.CAPTURE,
    tableEntry(missing, 0),
  );
  assert.deepEqual(
    decodeCandidateEntryBinderImage({ image: reseal(missing), handoffLine }),
    { ok: false, code: 'binder_section_missing' },
  );

  const unknown = Buffer.from(encoded.value.bytes);
  unknown.writeUInt32LE(99, tableEntry(unknown, 0));
  assert.deepEqual(
    decodeCandidateEntryBinderImage({ image: reseal(unknown), handoffLine }),
    { ok: false, code: 'binder_section_unknown' },
  );

  const overlap = Buffer.from(encoded.value.bytes);
  const firstOffset = overlap.readBigUInt64LE(tableEntry(overlap, 0) + 8);
  overlap.writeBigUInt64LE(firstOffset, tableEntry(overlap, 1) + 8);
  assert.deepEqual(
    decodeCandidateEntryBinderImage({ image: reseal(overlap), handoffLine }),
    { ok: false, code: 'binder_section_overlap' },
  );
});

test('section alignment, bounds, and limits are refused', () => {
  const encoded = encode();
  assert.equal(encoded.ok, true);

  const alignment = Buffer.from(encoded.value.bytes);
  alignment.writeBigUInt64LE(4n, tableEntry(alignment, 0) + 24);
  assert.deepEqual(
    decodeCandidateEntryBinderImage({ image: reseal(alignment), handoffLine }),
    { ok: false, code: 'binder_section_alignment' },
  );

  const bounds = Buffer.from(encoded.value.bytes);
  bounds.writeBigUInt64LE(1n << 40n, tableEntry(bounds, 0) + 16);
  assert.deepEqual(
    decodeCandidateEntryBinderImage({ image: reseal(bounds), handoffLine }),
    { ok: false, code: 'binder_section_bounds' },
  );

  const large = encode({
    sections: sections().map((section) => ({
      ...section,
      bytes:
        section.kind === CANDIDATE_ENTRY_BINDER_SECTION.CHARGE
          ? Buffer.alloc(256 * 1024, 1)
          : section.kind === CANDIDATE_ENTRY_BINDER_SECTION.SOURCE ||
              section.kind === CANDIDATE_ENTRY_BINDER_SECTION.PUBLIC_INPUT
            ? Buffer.alloc(1024 * 1024, 1)
            : section.bytes,
    })),
  });
  assert.equal(large.ok, true);
  const limit = Buffer.from(large.value.bytes);
  limit.writeBigUInt64LE(BigInt(256 * 1024 + 1), tableEntry(limit, 0) + 16);
  assert.deepEqual(
    decodeCandidateEntryBinderImage({ image: reseal(limit), handoffLine }),
    { ok: false, code: 'binder_section_limit' },
  );
});

test('encoder refuses missing and duplicate required sections', () => {
  assert.deepEqual(encode({ sections: sections().slice(0, 8) }), {
    ok: false,
    code: 'binder_section_missing',
  });
  assert.deepEqual(encode({ sections: [...sections(), sections()[0]] }), {
    ok: false,
    code: 'binder_section_duplicate',
  });
});

test('encoder refuses an image over the total limit', () => {
  const encoded = encode({
    sections: [
      ...sections().map((section) => ({
        ...section,
        bytes: Buffer.alloc(
          section.kind === CANDIDATE_ENTRY_BINDER_SECTION.SOURCE ||
            section.kind === CANDIDATE_ENTRY_BINDER_SECTION.PUBLIC_INPUT
            ? 1024 * 1024
            : 256 * 1024,
          1,
        ),
      })),
      { kind: CANDIDATE_ENTRY_BINDER_SECTION.CAPTURE, bytes: Buffer.alloc(256 * 1024, 1) },
      { kind: CANDIDATE_ENTRY_BINDER_SECTION.OBSERVATION, bytes: Buffer.alloc(256 * 1024, 1) },
    ],
  });
  assert.deepEqual(encoded, { ok: false, code: 'binder_image_too_large' });
});
