import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CANDIDATE_ENTRY_HANDOFF_CONTRACT,
  CANDIDATE_ENTRY_LEASE_CONTRACT,
  CandidateEntryLeaseBook,
  encodeCandidateEntryHandoff,
  parseCandidateEntryHandoff,
  parseCandidateEntryLease,
} from '../dist/contracts/candidate-entry.js';

const consumer = {
  pid: 4242,
  startIdentity: 'start-original',
  executableIdentity: 'executable-original',
  domainIdentity: 'domain-original',
};

const publicInput = {
  argv: ['service-lasso-tui', '--status'],
  environment: ['LANG=C', 'PATH=/usr/bin'],
};

function lease(overrides = {}) {
  return structuredClone({
    contract: CANDIDATE_ENTRY_LEASE_CONTRACT,
    version: 1,
    leaseId: 'lease-original',
    attemptId: 'attempt-original',
    issuerId: 'issuer-original',
    reservationId: 'reservation-original',
    operationId: 'operation-original',
    consumer,
    publicInput,
    issuedAtMs: 1_000,
    expiresAtMs: 2_000,
    ...overrides,
  });
}

function observation(overrides = {}) {
  return structuredClone({ ...consumer, ...publicInput, ...overrides });
}

function issued(overrides = {}) {
  const book = new CandidateEntryLeaseBook();
  const result = book.issue(lease(overrides));
  assert.equal(result.ok, true);
  return book;
}

test('valid lease binds exactly once with the original identities', () => {
  const book = issued();
  const result = book.bind('lease-original', observation(), 1_500);
  assert.equal(result.ok, true);
  assert.equal(result.value.leaseId, 'lease-original');
  assert.equal(result.value.attemptId, 'attempt-original');
  assert.equal(result.value.issuerId, 'issuer-original');
  assert.equal(result.value.reservationId, 'reservation-original');
  assert.equal(result.value.operationId, 'operation-original');
  assert.equal(result.value.boundAtMs, 1_500);
});

test('duplicate lease identity is refused', () => {
  const book = issued();
  const result = book.issue(lease());
  assert.deepEqual(result, { ok: false, code: 'lease_duplicate' });
});

test('unknown lease is refused without creating one', () => {
  const book = new CandidateEntryLeaseBook();
  assert.deepEqual(book.bind('lease-missing', observation(), 1_500), {
    ok: false,
    code: 'lease_unknown',
  });
});

test('lease before its issued time is refused', () => {
  const book = issued();
  assert.deepEqual(book.bind('lease-original', observation(), 999), {
    ok: false,
    code: 'lease_not_yet_valid',
  });
});

test('expired lease is refused and remains expired', () => {
  const book = issued();
  assert.deepEqual(book.bind('lease-original', observation(), 2_000), {
    ok: false,
    code: 'lease_expired',
  });
  assert.deepEqual(book.bind('lease-original', observation(), 1_500), {
    ok: false,
    code: 'lease_expired',
  });
});

test('consumer identity mismatches are refused', () => {
  const cases = [
    [{ pid: 4243 }, 'consumer_pid_mismatch'],
    [{ startIdentity: 'start-substituted' }, 'consumer_start_mismatch'],
    [{ executableIdentity: 'executable-substituted' }, 'consumer_executable_mismatch'],
    [{ domainIdentity: 'domain-substituted' }, 'consumer_domain_mismatch'],
  ];
  for (const [override, code] of cases) {
    const book = issued();
    assert.deepEqual(book.bind('lease-original', observation(override), 1_500), {
      ok: false,
      code,
    });
  }
});

test('argv byte order and environment byte order are exact', () => {
  const argvBook = issued();
  assert.deepEqual(
    argvBook.bind('lease-original', observation({ argv: ['service-lasso-tui', '--verbose'] }), 1_500),
    { ok: false, code: 'public_argv_mismatch' },
  );

  const environmentBook = issued();
  assert.deepEqual(
    environmentBook.bind('lease-original', observation({ environment: ['PATH=/usr/bin', 'LANG=C'] }), 1_500),
    { ok: false, code: 'public_environment_mismatch' },
  );
});

test('a refused observation does not consume the lease', () => {
  const book = issued();
  assert.deepEqual(book.bind('lease-original', observation({ pid: 1 }), 1_500), {
    ok: false,
    code: 'consumer_pid_mismatch',
  });
  assert.equal(book.bind('lease-original', observation(), 1_500).ok, true);
});

test('a bound lease cannot be rebound', () => {
  const book = issued();
  assert.equal(book.bind('lease-original', observation(), 1_500).ok, true);
  assert.deepEqual(book.bind('lease-original', observation(), 1_600), {
    ok: false,
    code: 'lease_replayed',
  });
});

test('release is once-only and prevents later binding', () => {
  const book = issued();
  assert.deepEqual(book.release('lease-original', 1_500), {
    ok: true,
    value: { leaseId: 'lease-original', releasedAtMs: 1_500 },
  });
  assert.deepEqual(book.release('lease-original', 1_600), {
    ok: false,
    code: 'lease_release_replayed',
  });
  assert.deepEqual(book.bind('lease-original', observation(), 1_500), {
    ok: false,
    code: 'lease_released',
  });
});

test('unknown release is refused', () => {
  const book = new CandidateEntryLeaseBook();
  assert.deepEqual(book.release('lease-missing', 1_500), {
    ok: false,
    code: 'lease_unknown',
  });
});

test('lease shape is closed and versioned', () => {
  const cases = [
    lease({ extra: true }),
    lease({ version: 2 }),
    lease({ contract: 'service-lasso.candidate-entry-lease.v0' }),
    lease({ leaseId: '' }),
    lease({ issuedAtMs: 2_000, expiresAtMs: 2_000 }),
    lease({ publicInput: { argv: ['service-lasso-tui\0'], environment: [] } }),
  ];
  for (const value of cases) {
    assert.deepEqual(parseCandidateEntryLease(value), {
      ok: false,
      code: 'lease_shape_invalid',
    });
  }
});

test('consumer observation shape is closed', () => {
  const book = issued();
  assert.deepEqual(book.bind('lease-original', observation({ extra: true }), 1_500), {
    ok: false,
    code: 'consumer_observation_shape_invalid',
  });
});

test('non-finite or fractional clocks are refused', () => {
  const book = issued();
  for (const clock of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5]) {
    assert.deepEqual(book.bind('lease-original', observation(), clock), {
      ok: false,
      code: 'clock_invalid',
    });
    assert.deepEqual(book.release('lease-original', clock), {
      ok: false,
      code: 'clock_invalid',
    });
  }
});

test('an issued lease is frozen against later mutation', () => {
  const book = new CandidateEntryLeaseBook();
  const result = book.issue(lease());
  assert.equal(result.ok, true);
  assert.throws(() => result.value.publicInput.argv.push('tampered'), TypeError);
  assert.throws(() => {
    result.value.consumer.pid = 1;
  }, TypeError);
});

test('handoff is closed and versioned around the issued lease', () => {
  const book = new CandidateEntryLeaseBook();
  const result = book.issue(lease());
  assert.equal(result.ok, true);
  const encoded = encodeCandidateEntryHandoff(result.value);
  const value = JSON.parse(encoded);
  assert.equal(value.contract, CANDIDATE_ENTRY_HANDOFF_CONTRACT);
  assert.deepEqual(parseCandidateEntryHandoff(value), { ok: true, value });
});

test('handoff refuses a mismatched contract or lease shape', () => {
  const book = new CandidateEntryLeaseBook();
  const result = book.issue(lease());
  assert.equal(result.ok, true);
  const value = JSON.parse(encodeCandidateEntryHandoff(result.value));
  for (const candidate of [
    { ...value, contract: 'service-lasso.candidate-entry-handoff.v0' },
    { ...value, extra: true },
    { ...value, lease: { ...value.lease, version: 2 } },
    { ...value, lease: { ...value.lease, leaseId: '' } },
  ]) {
    assert.deepEqual(parseCandidateEntryHandoff(candidate), {
      ok: false,
      code: 'lease_shape_invalid',
    });
  }
});
