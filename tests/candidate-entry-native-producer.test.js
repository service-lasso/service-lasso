import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { decodeCandidateEntryBinderImage } from '../dist/contracts/candidate-entry-binder.js';
import { NativeProducerCandidateEntryBinderSource } from '../dist/runtime/entry/native-producer-candidate-entry-binder.js';

const fixture = fileURLToPath(new URL('./fixtures/candidate-entry-producer.mjs', import.meta.url));
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

function source(environment = {}) {
  return new NativeProducerCandidateEntryBinderSource({
    executable: process.execPath,
    args: [fixture],
    environment: { ...process.env, ...environment },
    allowSynthetic: true,
  });
}

test('native producer transport accepts a validated image', () => {
  const artifact = source().materialize(request);
  assert.equal(artifact.ok, true);
  assert.match(artifact.imageSha256, /^sha256:[a-f0-9]{64}$/);
  const decoded = decodeCandidateEntryBinderImage({
    image: artifact.image,
    imageSha256: artifact.imageSha256,
    handoffLine,
    allowSynthetic: true,
  });
  assert.equal(decoded.ok, true);
});

test('native producer transport refuses missing originals', () => {
  assert.deepEqual(source({ PRODUCER_REFUSE: '1' }).materialize(request), {
    ok: false,
    code: 'binder_originals_unavailable',
  });
});

test('native producer transport refuses an unavailable executable', () => {
  const value = new NativeProducerCandidateEntryBinderSource({
    executable: '/service-lasso-missing-producer',
  }).materialize(request);
  assert.equal(value.ok, false);
  assert.equal(value.code, 'binder_channel_closed');
});
