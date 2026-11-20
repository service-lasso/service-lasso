import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CANDIDATE_ENTRY_BINDER_SECTION,
  decodeCandidateEntryBinderImage,
} from '../dist/contracts/candidate-entry-binder.js';
import { RetainedCandidateEntryBinderSource } from '../dist/runtime/entry/retained-candidate-entry-binder.js';

const handoffLine = Buffer.from(
  JSON.stringify({
    contract: 'service-lasso.candidate-entry-handoff.v1',
    lease: { leaseId: 'lease-a' },
  }),
  'utf8',
);
const request = {
  lease: { leaseId: 'lease-a' },
  observation: {},
  handoffLine,
};

function sections() {
  return [
    CANDIDATE_ENTRY_BINDER_SECTION.CHARGE,
    CANDIDATE_ENTRY_BINDER_SECTION.SOURCE,
    CANDIDATE_ENTRY_BINDER_SECTION.DOMAIN,
    CANDIDATE_ENTRY_BINDER_SECTION.ACTORS,
    CANDIDATE_ENTRY_BINDER_SECTION.BASES,
    CANDIDATE_ENTRY_BINDER_SECTION.PUBLIC_INPUT,
    CANDIDATE_ENTRY_BINDER_SECTION.DEADLINE,
    CANDIDATE_ENTRY_BINDER_SECTION.ISSUER,
    CANDIDATE_ENTRY_BINDER_SECTION.CUSTODY,
  ].map((kind) => ({ kind, bytes: Buffer.from(`retained-${kind}`) }));
}

test('retained originals materialize a production image', () => {
  const source = new RetainedCandidateEntryBinderSource({
    sections: (seen) => {
      assert.equal(seen.lease.leaseId, 'lease-a');
      return sections();
    },
    release() {},
  });
  const artifact = source.materialize(request);
  assert.equal(artifact.ok, true);
  assert.match(artifact.imageSha256, /^sha256:[a-f0-9]{64}$/);
  const decoded = decodeCandidateEntryBinderImage({
    image: artifact.image,
    imageSha256: artifact.imageSha256,
    handoffLine,
  });
  assert.equal(decoded.ok, true);
  assert.equal(decoded.value.flags, 0);
  assert.equal(decoded.value.views.length, 9);
});

test('missing or throwing originals refuse without synthesis', () => {
  for (const originals of [
    { sections: () => null, release() {} },
    {
      sections: () => {
        throw new Error('private originals unavailable');
      },
      release() {},
    },
  ]) {
    assert.deepEqual(new RetainedCandidateEntryBinderSource(originals).materialize(request), {
      ok: false,
      code: 'binder_originals_unavailable',
    });
  }
});

test('incomplete originals refuse with the section code', () => {
  const source = new RetainedCandidateEntryBinderSource({
    sections: () => sections().slice(0, 8),
    release() {},
  });
  assert.deepEqual(source.materialize(request), {
    ok: false,
    code: 'binder_section_missing',
  });
});

test('release reaches the retained originals owner', () => {
  const released = [];
  const source = new RetainedCandidateEntryBinderSource({
    sections: () => sections(),
    release(leaseId) {
      released.push(leaseId);
    },
  });
  source.release('lease-a');
  assert.deepEqual(released, ['lease-a']);
});
