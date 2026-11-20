import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { CandidateEntryLeaseBook } from '../dist/contracts/candidate-entry.js';
import {
  CANDIDATE_ENTRY_BINDER_SECTION,
  encodeCandidateEntryBinderImage,
} from '../dist/contracts/candidate-entry-binder.js';
import { launchCandidateEntry } from '../dist/runtime/entry/candidate-entry-launcher.js';

const linuxOnly = process.platform === 'linux' ? {} : { skip: 'Linux-only candidate entry launcher' };
const fixture = fileURLToPath(new URL('./fixtures/candidate-entry-consumer.mjs', import.meta.url));
const baseEnvironment = [`PATH=${process.env.PATH ?? ''}`, 'LANG=C', 'SERVICE_LASSO_TEST=1'];

function lease(overrides = {}) {
  const now = Date.now();
  return {
    leaseId: randomUUID(),
    attemptId: randomUUID(),
    issuerId: randomUUID(),
    reservationId: randomUUID(),
    operationId: randomUUID(),
    issuedAtMs: now - 1_000,
    expiresAtMs: now + 60_000,
    ...overrides,
  };
}

function request(overrides = {}) {
  return {
    executable: process.execPath,
    argv: [process.execPath, fixture],
    environment: [...baseEnvironment],
    lease: lease(),
    timeoutMs: 10_000,
    ...overrides,
  };
}

async function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  return await new Promise((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
}

test('Core launcher binds the exact originals and hands off once', linuxOnly, async () => {
  const input = request();
  const result = await launchCandidateEntry(new CandidateEntryLeaseBook(), input);
  assert.equal(result.ok, true);
  assert.equal(result.value.binding.leaseId, input.lease.leaseId);
  assert.equal(result.value.binding.consumer.pid, result.value.child.pid);
  assert.deepEqual(result.value.binding.publicInput.argv, input.argv);
  assert.deepEqual(result.value.binding.publicInput.environment, input.environment);
  assert.match(result.value.binding.consumer.startIdentity, /^linux-start-v1:\d+$/);
  assert.match(result.value.binding.consumer.executableIdentity, /^sha256:[a-f0-9]{64}$/);
  assert.match(result.value.binding.consumer.domainIdentity, /^linux-ns-v1:pid:\[\d+\]:mnt:\[\d+\]$/);
  assert.deepEqual(await waitForExit(result.value.child), { code: 0, signal: null });
  assert.equal(result.value.release().ok, true);
});

test('a direct unbound consumer is refused', linuxOnly, async () => {
  const child = spawn(process.execPath, [fixture], { stdio: ['ignore', 'ignore', 'ignore'] });
  assert.deepEqual(await waitForExit(child), { code: 2, signal: null });
});

test('a duplicate lease does not release the existing binding', linuxOnly, async () => {
  const book = new CandidateEntryLeaseBook();
  const first = request();
  const firstResult = await launchCandidateEntry(book, first);
  assert.equal(firstResult.ok, true);
  await waitForExit(firstResult.value.child);

  const duplicate = request({ lease: { ...first.lease } });
  const duplicateResult = await launchCandidateEntry(book, duplicate);
  assert.deepEqual(duplicateResult, { ok: false, code: 'lease_duplicate' });
  assert.equal(firstResult.value.release().ok, true);
});

test('consumer observation mismatches are refused', linuxOnly, async () => {
  const cases = [
    ['tamper-argv', 'public_argv_mismatch'],
    ['tamper-executable', 'consumer_executable_mismatch'],
    ['tamper-domain', 'consumer_domain_mismatch'],
    ['tamper-environment', 'public_environment_mismatch'],
  ];
  for (const [mode, code] of cases) {
    const result = await launchCandidateEntry(
      new CandidateEntryLeaseBook(),
      request({ argv: [process.execPath, fixture, mode] }),
    );
    assert.deepEqual(result, { ok: false, code });
  }
});

test('consumer refusal is closed and does not bind', linuxOnly, async () => {
  const result = await launchCandidateEntry(
    new CandidateEntryLeaseBook(),
    request({ argv: [process.execPath, fixture, 'refuse'] }),
  );
  assert.deepEqual(result, { ok: false, code: 'launch_consumer_refused' });
});

test('expired and not-yet-valid leases are refused before spawn', linuxOnly, async () => {
  const now = Date.now();
  const expired = request({
    lease: lease({ issuedAtMs: now - 2_000, expiresAtMs: now - 1_000 }),
  });
  assert.deepEqual(await launchCandidateEntry(new CandidateEntryLeaseBook(), expired), {
    ok: false,
    code: 'lease_expired',
  });

  const future = request({
    lease: lease({ issuedAtMs: now + 1_000, expiresAtMs: now + 2_000 }),
  });
  assert.deepEqual(await launchCandidateEntry(new CandidateEntryLeaseBook(), future), {
    ok: false,
    code: 'lease_not_yet_valid',
  });
});

test('missing executable is refused', linuxOnly, async () => {
  const result = await launchCandidateEntry(
    new CandidateEntryLeaseBook(),
    request({ executable: '/service-lasso-missing-candidate-entry' }),
  );
  assert.deepEqual(result, { ok: false, code: 'launch_executable_unavailable' });
});

test('handshake timeout kills the consumer', linuxOnly, async () => {
  const result = await launchCandidateEntry(
    new CandidateEntryLeaseBook(),
    request({ argv: [process.execPath, fixture, 'delay'], timeoutMs: 250 }),
  );
  assert.deepEqual(result, { ok: false, code: 'launch_timeout' });
});

test('invalid public input is refused before spawn', linuxOnly, async () => {
  for (const overrides of [
    { argv: [] },
    { argv: [process.execPath, `${fixture}\0`] },
    { environment: ['A=1', 'A=2'] },
    { environment: ['NOVALUE'] },
    { timeoutMs: 0 },
    { lease: lease({ leaseId: '' }) },
    { lease: lease({ issuedAtMs: 2, expiresAtMs: 2 }) },
  ]) {
    const result = await launchCandidateEntry(new CandidateEntryLeaseBook(), request(overrides));
    assert.deepEqual(result, { ok: false, code: 'launch_input_invalid' });
  }
});


function syntheticSections() {
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
  ].map((kind) => ({ kind, bytes: Buffer.from(`synthetic-section-${kind}`) }));
}

function syntheticBinderSource() {
  const released = [];
  return {
    released,
    materialize({ handoffLine }) {
      const image = encodeCandidateEntryBinderImage({
        handoffLine,
        sections: syntheticSections(),
        synthetic: true,
      });
      assert.equal(image.ok, true);
      return {
        ok: true,
        image: image.value.bytes,
        imageSha256: image.value.imageSha256,
      };
    },
    release(leaseId) {
      released.push(leaseId);
    },
  };
}

test('Core delivers a validated binder image before binding', linuxOnly, async () => {
  const input = request({ argv: [process.execPath, fixture, 'bind-image'] });
  const source = syntheticBinderSource();
  const result = await launchCandidateEntry(
    new CandidateEntryLeaseBook(),
    input,
    { binderSource: source },
  );
  assert.equal(result.ok, true);
  assert.equal(result.value.binding.leaseId, input.lease.leaseId);
  assert.match(result.value.imageSha256, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(await waitForExit(result.value.child), { code: 0, signal: null });
  assert.equal(result.value.release().ok, true);
  assert.deepEqual(source.released, [input.lease.leaseId]);
});

test('a production binder without originals refuses before native entry', linuxOnly, async () => {
  const released = [];
  const source = {
    materialize() {
      return { ok: false, code: 'binder_originals_unavailable' };
    },
    release(leaseId) {
      released.push(leaseId);
    },
  };
  const book = new CandidateEntryLeaseBook();
  const input = request({ argv: [process.execPath, fixture, 'bind-image'] });
  const result = await launchCandidateEntry(book, input, { binderSource: source });
  assert.deepEqual(result, { ok: false, code: 'binder_originals_unavailable' });
  assert.equal(released.length, 1);
  assert.deepEqual(book.bind(input.lease.leaseId, {}, Date.now()), {
    ok: false,
    code: 'lease_released',
  });
});

test('a binder image hash mismatch is refused before delivery', linuxOnly, async () => {
  const source = {
    materialize({ handoffLine }) {
      const image = encodeCandidateEntryBinderImage({
        handoffLine,
        sections: syntheticSections(),
        synthetic: true,
      });
      assert.equal(image.ok, true);
      return {
        ok: true,
        image: image.value.bytes,
        imageSha256: `sha256:${'0'.repeat(64)}`,
      };
    },
    release() {},
  };
  const result = await launchCandidateEntry(
    new CandidateEntryLeaseBook(),
    request({ argv: [process.execPath, fixture, 'bind-image'] }),
    { binderSource: source },
  );
  assert.deepEqual(result, { ok: false, code: 'binder_image_encoding_failed' });
});

test('a mismatched consumer ack fails the delivered lease', linuxOnly, async () => {
  const released = [];
  const source = syntheticBinderSource();
  source.release = (leaseId) => released.push(leaseId);
  const book = new CandidateEntryLeaseBook();
  const input = request({ argv: [process.execPath, fixture, 'bind-image-bad-ack'] });
  const result = await launchCandidateEntry(book, input, { binderSource: source });
  assert.deepEqual(result, { ok: false, code: 'binder_ack_mismatch' });
  assert.equal(released.length, 1);
  assert.deepEqual(book.bind(input.lease.leaseId, {}, Date.now()), {
    ok: false,
    code: 'lease_failed',
  });
});
