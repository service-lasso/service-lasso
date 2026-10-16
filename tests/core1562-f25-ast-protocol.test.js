import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { decodeF25AstResponse, isF25AstRejection, f25ClosedFailureDiagnostic, validateF25AstClosure, observeF25AstFrame, collectF25AstChild, f25FailureHasOriginals,
  F25_INFRASTRUCTURE_OPERATIONS, F25_STDOUT_LIMIT, F25_STDERR_LIMIT, f25TransportFailureObservation, observeF25InfrastructureFixture } from './helpers/core1562-powershell-retention-source.mjs';
import { F25_INFRASTRUCTURE_CASES } from './helpers/core1562-f25-infrastructure-fixtures.mjs';
import { readFile } from 'node:fs/promises';

const digest = 'a'.repeat(64);
const frame = status => `${JSON.stringify({ schema: 'core1562.f25.ast-result.v1', status,
  sourceSha256: digest, reason: status === 'conformant' ? 'none' : 'shape_mismatch' })}\n`;

function surrogate() {
  const child = new EventEmitter();
  child.stdin = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  let delivery, delivered = false;
  child.stdin.end = (bytes, callback) => { assert.equal(Buffer.isBuffer(bytes), true); delivery = callback; };
  return { child, delivered(error) { delivered = true; delivery(error); },
    complete({ code = 0, signal = null } = {}) {
      if (!delivered) { delivered = true; delivery(); }
      child.stdin.emit('finish'); child.stdout.emit('end'); child.stderr.emit('end'); child.emit('exit', code, signal);
    } };
}

test('F25 transport SURROGATE drives actual collector and retains all original error identities until close', async () => {
  for (const stage of ['spawn', 'stdin', 'stdout', 'stderr', 'stdin_end']) {
    const s = surrogate();
    // Throwing getters ensure neither the collector nor identity assertions
    // classify or stringify a raw error. EPIPE remains the original object.
    const first = stage === 'stdin' ? Object.assign(new Error('private EPIPE'), { code: 'EPIPE' }) :
      new Proxy({}, { get() { throw new Error('private getter'); } });
    const second = new Proxy({}, { get() { throw new Error('independent private getter'); } });
    const pending = collectF25AstChild(s.child, Buffer.from('private input'), digest);
    let settled = false;
    const observed = pending.then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
    if (stage === 'stdin_end') s.delivered(first);
    else if (stage === 'spawn') s.child.emit('error', first);
    else s.child[stage].emit('error', first);
    s.child.stderr.emit('error', second);
    await Promise.resolve(); assert.equal(settled, false, 'error must not settle before real child close');
    s.child.stdout.emit('data', Buffer.from(frame('conformant')));
    s.complete();
    await Promise.resolve(); assert.equal(settled, false, 'valid frame and exit are insufficient without close');
    s.child.emit('close', 0, null);
    const result = await observed;
    assert.ok(result.error); assert.equal(isF25AstRejection(result.error), false);
    assert.equal(f25FailureHasOriginals(result.error, [first, second], stage === 'stdin_end'), true);
    assert.deepEqual(f25ClosedFailureDiagnostic(result.error).stages, [stage, 'stderr', ...(stage === 'stdin_end' ? ['closure'] : [])]);
    assert.equal(Object.hasOwn(result.error, 'cause'), false);
  }
});

test('F25 transport SURROGATE preserves null, undefined and repeated independent opaque originals', async () => {
  for (const first of [null, undefined]) {
    const s = surrogate();
    const second = new Proxy({}, { get() { throw new Error('must remain private'); } });
    const pending = collectF25AstChild(s.child, Buffer.from('input'), digest);
    const observed = pending.catch(error => error);
    s.child.emit('error', first); s.child.emit('error', second);
    s.child.stdout.emit('data', Buffer.from(frame('conformant'))); s.complete(); s.child.emit('close', 0, null);
    const failure = await observed;
    assert.equal(f25FailureHasOriginals(failure, [first, second]), true);
    assert.equal(isF25AstRejection(failure), false);
    assert.deepEqual(f25ClosedFailureDiagnostic(failure).stages, ['spawn', 'spawn']);
  }
  const s = surrogate();
  const first = new Proxy({}, { get() { throw new Error('private late stream error'); } });
  const pending = collectF25AstChild(s.child, Buffer.from('input'), digest);
  const observed = pending.catch(error => error);
  s.child.stdout.emit('data', Buffer.from(frame('conformant'))); s.complete();
  // A stream failure after a valid frame, stream ends and process exit still
  // owns failure before actual close; valid output cannot erase it.
  s.child.stdout.emit('error', first); s.child.emit('close', 0, null);
  const failure = await observed;
  assert.equal(f25FailureHasOriginals(failure, [first]), true);
  assert.equal(isF25AstRejection(failure), false);
});

test('F25 transport SURROGATE requires channel completion, expected exit and actual close event order', async () => {
  for (const missing of ['delivery', 'finish', 'stdout_end', 'stderr_end', 'exit', 'signal', 'code', 'extra_stderr', 'partial']) {
    const s = surrogate();
    const pending = collectF25AstChild(s.child, Buffer.from('input'), digest);
    let settled = false;
    const observed = pending.then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
    s.child.stdout.emit('data', Buffer.from(missing === 'partial' ? frame('conformant').slice(0, -3) : frame('conformant')));
    if (missing !== 'delivery') s.delivered();
    if (missing !== 'finish') s.child.stdin.emit('finish');
    if (missing !== 'stdout_end') s.child.stdout.emit('end');
    if (missing === 'extra_stderr') s.child.stderr.emit('data', Buffer.from('private stderr'));
    if (missing !== 'stderr_end') s.child.stderr.emit('end');
    const code = missing === 'code' ? 1 : 0, signal = missing === 'signal' ? 'SIGTERM' : null;
    if (missing !== 'exit') s.child.emit('exit', code, signal);
    await Promise.resolve(); assert.equal(settled, false);
    s.child.emit('close', code, signal);
    const result = await observed;
    assert.ok(result.error); assert.equal(isF25AstRejection(result.error), false);
  }
  const s = surrogate();
  const pending = collectF25AstChild(s.child, Buffer.from('input'), digest);
  let settled = false; const observed = pending.then(value => { settled = true; return value; });
  s.child.stdout.emit('data', Buffer.from(frame('conformant')));
  // Exit can precede the remaining stream ends; settle only after all of them
  // and the actual close event have occurred.
  s.child.emit('exit', 0, null); s.delivered(); s.child.stdin.emit('finish');
  s.child.stdout.emit('end'); s.child.stderr.emit('end');
  await Promise.resolve(); assert.equal(settled, false);
  s.child.emit('close', 0, null);
  assert.equal((await observed).status, 'conformant');
});
test('F25 closure requires every real transport completion and expected normal exit', () => {
  const complete = { delivered: true, stdinFinish: true, stdoutEnd: true, stderrEnd: true,
    exitObserved: true, exitCode: 0, exitSignal: null, code: 0, signal: null, stderr: Buffer.alloc(0) };
  assert.doesNotThrow(() => validateF25AstClosure(complete));
  for (const key of ['delivered', 'stdinFinish', 'stdoutEnd', 'stderrEnd', 'exitObserved']) {
    assert.throws(() => validateF25AstClosure({ ...complete, [key]: false }), error => !isF25AstRejection(error));
  }
  for (const change of [{ exitCode: 2 }, { code: 3, exitCode: 3 }, { signal: 'SIGTERM', exitSignal: 'SIGTERM' },
    { stderr: Buffer.from('private original diagnostic') }, { exitSignal: 'SIGTERM' }]) {
    assert.throws(() => validateF25AstClosure({ ...complete, ...change }), error => !isF25AstRejection(error));
  }
});
test('F25 child protocol accepts only complete canonical expected outcome frames', () => {
  assert.equal(decodeF25AstResponse(Buffer.from(frame('conformant')), digest, 0).status, 'conformant');
  assert.equal(decodeF25AstResponse(Buffer.from(frame('rejected')), digest, 2).status, 'rejected');
  const good = frame('rejected');
  for (const bytes of [
    Buffer.from(''), Buffer.from(good.slice(0, -1)), Buffer.from(good.slice(0, -4)),
    Buffer.from(`${good}${good}`), Buffer.from(`${good} `), Buffer.from(`\ufeff${good}`),
    Buffer.from(good.replace('"status":', '"status":"rejected","status":')),
    Buffer.from(good.replace('"reason":', '"extra":null,"reason":')),
    Buffer.from(good.replace('shape_mismatch', 'unknown')), Buffer.from(good.replace(digest, 'b'.repeat(64))),
    Buffer.concat([Buffer.from([0xff]), Buffer.from(good)]),
  ]) {
    assert.throws(() => decodeF25AstResponse(bytes, digest, 2), error => !isF25AstRejection(error));
  }
  for (const code of [null, 0, 1, 3]) {
    assert.throws(() => decodeF25AstResponse(Buffer.from(good), digest, code), error => !isF25AstRejection(error));
  }
  assert.equal(isF25AstRejection({ message: 'F25 selected source rejected: shape_mismatch' }), false);
});

test('F25 invalid UTF8 retains original failure privately behind a closed diagnostic', () => {
  let failure;
  try { decodeF25AstResponse(Buffer.from([0xff]), digest, 2); } catch (error) { failure = error; }
  assert.ok(failure);
  assert.deepEqual(f25ClosedFailureDiagnostic(failure), {
    schema: 'core1562.f25.transport-failure.v1', stages: ['response_decode'], count: 1,
  });
  assert.equal(Object.hasOwn(failure, 'cause'), false);
  assert.equal(isF25AstRejection(failure), false);
});

test('F25 actual child rejects malformed input as infrastructure rather than source evidence', async () => {
  const source = Buffer.from('$x = 1');
  const sha = createHash('sha256').update(source).digest('hex');
  const input = { schema: 'core1562.f25.ast-input.v1',
    sourceFile: 'scripts/verify-windows-managed-launcher-bootstrap.ps1',
    sourceByteLength: source.length, sourceSha256: sha, sourceBase64: source.toString('base64') };
  const good = `${JSON.stringify(input)}\n`;
  const frames = ['', good.slice(0, -3), good.slice(0, -1), `${good}${good}`, `\ufeff${good}`,
    good.replace('"schema":', '"schema":"duplicate","schema":'),
    good.replace('"schema":', '"extra":null,"schema":'),
    ...[{ sourceFile: 'other.ps1' }, { sourceByteLength: source.length + 1 },
      { sourceSha256: 'b'.repeat(64) }, { sourceBase64: `${input.sourceBase64}\n` },
      { sourceBase64: '/w==', sourceByteLength: 1, sourceSha256: createHash('sha256').update(Buffer.from([255])).digest('hex') },
    ].map(change => `${JSON.stringify({ ...input, ...change })}\n`)];
  for (const frame of frames) {
    await assert.rejects(() => observeF25AstFrame(Buffer.from(frame), sha), error => {
      assert.equal(isF25AstRejection(error), false);
      // A closed receipt with unexpected child exit is expected. Missing tool,
      // spawn or early transport failures must not satisfy this framing case.
      const diagnostic = f25ClosedFailureDiagnostic(error);
      assert.deepEqual(diagnostic?.stages, ['closure']);
      assert.deepEqual(diagnostic.closure, { code: 3, signal: null, delivered: true, stdinFinish: true,
        stdoutEnd: true, stderrEnd: true, exitObserved: true, stdoutBytes: 0, stderrBytes: 0 });
      return true;
    });
  }
});

for (const operation of F25_INFRASTRUCTURE_OPERATIONS) for (const stderrFirst of [false, true])
  test(`F25 ${operation} ${stderrFirst ? 'stderr-first' : 'frame-first'} transport SURROGATE is settled negative correspondence only`, async () => {
    const s = surrogate();
    const pending = collectF25AstChild(s.child, Buffer.from('input'), digest).then(value => ({ value }), error => ({ error }));
    if (stderrFirst) s.child.stderr.emit('data', Buffer.from('PRIVATE'));
    const negative = `F25I1|${operation}\n`;
    s.child.stdout.emit('data', Buffer.from(negative.slice(0, 4)));
    s.child.stdout.emit('data', Buffer.from(negative.slice(4)));
    if (!stderrFirst) s.child.stderr.emit('data', Buffer.from('PRIVATE'));
    s.complete({ code: 3 });
    let settled = false; void pending.then(() => { settled = true; });
    await Promise.resolve(); assert.equal(settled, false);
    s.child.emit('close', 3, null);
    const { error } = await pending;
    assert.deepEqual(f25TransportFailureObservation(error), { firstReason: 'stderr_present', childOperation: operation });
    assert.equal(f25ClosedFailureDiagnostic(error).childOperation, undefined, 'Fake child cannot mint an actual-child observation.');
    assert.equal(isF25AstRejection(error), false); assert.equal(Object.hasOwn(error, 'cause'), false);
  });

test('F25 negative correspondence SURROGATE requires exact one bounded frame and complete matching closure', async () => {
  const valid = 'F25I1|target_parse\n';
  for (const text of ['', valid.slice(0, -1), valid + valid, valid + 'extra', valid + frame('conformant'),
    frame('conformant') + valid, 'F25I1|unknown\n', 'F25I1|TARGET_PARSE\n', 'F25I1|target_parse|extra\n',
    '\ufeff' + valid, valid + '\r', valid + '\0', valid + 'é', valid + 'x'.repeat(F25_STDOUT_LIMIT)]) {
    const s = surrogate(), pending = collectF25AstChild(s.child, Buffer.from('input'), digest).catch(error => ({ error }));
    s.child.stderr.emit('data', Buffer.from('PRIVATE')); s.child.stdout.emit('data', Buffer.from(text));
    s.complete({ code: 3 }); s.child.emit('close', 3, null);
    const { error } = await pending;
    assert.equal(f25TransportFailureObservation(error).childOperation, undefined);
    assert.equal(f25TransportFailureObservation(error).firstReason, 'stderr_present');
    assert.equal(isF25AstRejection(error), false);
  }
  for (const missing of ['delivery', 'finish', 'stdout_end', 'stderr_end', 'exit', 'signal', 'mismatch', 'wrong_code', 'stdout_error']) {
    const s = surrogate(), pending = collectF25AstChild(s.child, Buffer.from('input'), digest).catch(error => ({ error }));
    s.child.stdout.emit('data', Buffer.from(valid));
    if (missing !== 'delivery') s.delivered();
    if (missing !== 'finish') s.child.stdin.emit('finish');
    if (missing !== 'stdout_end') s.child.stdout.emit('end');
    if (missing !== 'stderr_end') s.child.stderr.emit('end');
    const code = missing === 'wrong_code' ? 1 : 3, signal = missing === 'signal' ? 'SIGTERM' : null;
    if (missing !== 'exit') s.child.emit('exit', code, signal);
    if (missing === 'stdout_error') s.child.stdout.emit('error', new Proxy({}, { get() { assert.fail('Private stream error stays opaque.'); } }));
    s.child.emit('close', missing === 'mismatch' ? 2 : code, signal);
    assert.equal(f25TransportFailureObservation((await pending).error).childOperation, undefined);
  }
});

test('F25 bounded transport SURROGATE retains first null/undefined and later opaque originals without denial authority', async () => {
  for (const first of [null, undefined]) {
    const s = surrogate(), pending = collectF25AstChild(s.child, Buffer.from('input'), digest).catch(error => ({ error }));
    const later = new Proxy({}, { get() { assert.fail('Later original getter.'); } });
    s.child.emit('error', first); s.child.stderr.emit('error', later);
    s.child.stdout.emit('data', Buffer.from('F25I1|witness_invocation\n')); s.complete({ code: 3 }); s.child.emit('close', 3, null);
    const { error } = await pending;
    assert.equal(f25FailureHasOriginals(error, [first, later], true), true);
    assert.deepEqual(f25TransportFailureObservation(error), { firstReason: 'spawn', childOperation: 'witness_invocation' });
    assert.equal(f25ClosedFailureDiagnostic(error).childOperation, undefined); assert.equal(isF25AstRejection(error), false);
  }
  for (const channel of ['stdout', 'stderr']) {
    const s = surrogate(), pending = collectF25AstChild(s.child, Buffer.from('input'), digest).catch(error => ({ error }));
    const limit = channel === 'stdout' ? F25_STDOUT_LIMIT : F25_STDERR_LIMIT;
    s.child[channel].emit('data', Buffer.alloc(limit + 20, 65)); s.complete(); s.child.emit('close', 0, null);
    const { error } = await pending, diagnostic = f25ClosedFailureDiagnostic(error);
    assert.equal(diagnostic.closure[`${channel}Bytes`], limit);
    assert.equal(f25TransportFailureObservation(error).childOperation, undefined);
    assert.equal(isF25AstRejection(error), false);
  }
});

test('F25 fixed bootstrap SOURCE witness retains file context, explicit exits and source-as-data boundary', async () => {
  const source = await readFile(new URL('./helpers/core1562-powershell-retention-bootstrap.ps1', import.meta.url), 'utf8');
  const witness = await readFile(new URL('./helpers/core1562-powershell-retention-ast.ps1', import.meta.url), 'utf8');
  const adapter = await readFile(new URL('./helpers/core1562-powershell-retention-source.mjs', import.meta.url), 'utf8');
  const temp = await readFile(new URL('./helpers/core1562-f25-private-temp.mjs', import.meta.url), 'utf8');
  assert.match(source, /Combine\(\$PSScriptRoot,'core1562-powershell-retention-ast\.ps1'\)/);
  assert.match(source, /\$global:LASTEXITCODE=\$null\s*& \$fixedWitness\s*\$forwarded=\$global:LASTEXITCODE/);
  assert.match(source, /\$forwarded -isnot \[int\] -or \$forwarded -notin @\(0,2,3\)/);
  assert.match(source, /exit \$forwarded/);
  assert.doesNotMatch(source + witness, /Invoke-Expression|GetScriptBlock|ScriptBlock\]::Create|& \$source/);
  assert.match(witness, /\[Parser\]::ParseInput\(\$source,\$file,/);
  assert.match(source, /\$owner\.Originals\.Add\(\$original\)[\s\S]*-not \$owner\.Recorded[\s\S]*Same-F25Original/);
  assert.match(source, /\$null -ne \$leftException -and \[object\]::ReferenceEquals\(\$leftException,\$rightException\)/);
  for (const operation of F25_INFRASTRUCTURE_OPERATIONS)
    assert.match(source + witness, new RegExp(`Fail-F25Infrastructure '${operation}'`));
  assert.match(adapter, /core1562-powershell-retention-bootstrap\.ps1/);
  assert.doesNotMatch(adapter, /process\.env|setTimeout|\.kill\(|f25-ast-runtime/);
  assert.match(temp, /new URL\('\.\.\/\.\.\/\.tmp', import\.meta\.url\)/);
  assert.match(temp, /mkdtemp\(path\.join\(parent, 'f25-ast-'\)\)/);
  assert.match(temp, /O_DIRECTORY \| constants\.O_NOFOLLOW/);
  assert.match(temp, /createPrivateDiagnosticDirectory\(parent, 'f25-ast-'/);
  assert.doesNotMatch(temp, /tmpdir|process\.env|\bmkdir\s*\(|\bchmod\s*\(|\bchown\s*\(|Set-Acl/);
  assert.equal(F25_STDOUT_LIMIT, 4096); assert.equal(F25_STDERR_LIMIT, 16384);
});

test('F25 transport SURROGATE exercises every first-rejection branch without raw-original inspection', async () => {
  const rows = ['spawn', 'stdin', 'stdin_end', 'stdout_error', 'stderr_error', 'stdout_overflow', 'stderr_present',
    'stdin_delivery_missing', 'stdin_finish_missing', 'stdout_end_missing', 'stderr_end_missing', 'exit_missing',
    'exit_mismatch', 'exit_signal', 'exit_unexpected', 'frame_decode', 'frame_shape'];
  for (const branch of rows) {
    const s = surrogate(), pending = collectF25AstChild(s.child, Buffer.from('input'), digest).catch(error => ({ error }));
    const opaque = new Proxy({}, { get() { assert.fail('Branch original must remain opaque.'); } });
    if (branch === 'spawn') s.child.emit('error', opaque);
    if (branch === 'stdin') s.child.stdin.emit('error', opaque);
    if (branch === 'stdout_error') s.child.stdout.emit('error', opaque);
    if (branch === 'stderr_error') s.child.stderr.emit('error', opaque);
    if (branch === 'stderr_present') s.child.stderr.emit('data', Buffer.from('PRIVATE'));
    const output = branch === 'stdout_overflow' ? Buffer.alloc(F25_STDOUT_LIMIT + 1, 65) :
      branch === 'frame_decode' ? Buffer.from([255]) : branch === 'frame_shape' ? Buffer.from('{}\n') : Buffer.from(frame('conformant'));
    s.child.stdout.emit('data', output);
    if (branch !== 'stdin_delivery_missing') s.delivered(branch === 'stdin_end' ? opaque : undefined);
    if (branch !== 'stdin_finish_missing') s.child.stdin.emit('finish');
    if (branch !== 'stdout_end_missing') s.child.stdout.emit('end');
    if (branch !== 'stderr_end_missing') s.child.stderr.emit('end');
    const code = branch === 'exit_unexpected' ? 3 : 0, signal = branch === 'exit_signal' ? 'SIGTERM' : null;
    if (branch !== 'exit_missing') s.child.emit('exit', code, signal);
    s.child.emit('close', branch === 'exit_mismatch' ? 1 : code, signal);
    const { error } = await pending;
    assert.ok(error); assert.equal(isF25AstRejection(error), false);
    assert.equal(f25TransportFailureObservation(error).firstReason, branch === 'stdin_delivery_missing' ? 'stdin_end' : branch);
  }
  const s = surrogate(), pending = collectF25AstChild(s.child, Buffer.from('input'), digest).catch(error => ({ error }));
  s.child.stderr.emit('data', Buffer.alloc(F25_STDERR_LIMIT + 1, 65));
  s.child.stdout.emit('data', Buffer.from(frame('conformant'))); s.complete(); s.child.emit('close', 0, null);
  const { error } = await pending;
  assert.equal(f25TransportFailureObservation(error).firstReason, 'stderr_present', 'ANY stderr rejects before overflow classification.');
  assert.ok(f25ClosedFailureDiagnostic(error).stages.includes('stderr_overflow'));
});

test('F25 negative transport SURROGATE owns frame bytes and rejects repeated input callbacks', async () => {
  const s = surrogate(), pending = collectF25AstChild(s.child, Buffer.from('input'), digest).catch(error => ({ error }));
  const bytes = Buffer.from('F25I1|target_parse\n'); s.child.stdout.emit('data', bytes); bytes.fill(0);
  s.complete({ code: 3 }); s.child.emit('close', 3, null);
  assert.equal(f25TransportFailureObservation((await pending).error).childOperation, 'target_parse');
  const duplicate = surrogate(), repeated = collectF25AstChild(duplicate.child, Buffer.from('input'), digest).catch(error => ({ error }));
  duplicate.delivered(); duplicate.delivered(); duplicate.child.stdout.emit('data', Buffer.from(frame('conformant')));
  duplicate.complete(); duplicate.child.emit('close', 0, null);
  assert.equal(f25TransportFailureObservation((await repeated).error).firstReason, 'stdin_end');
});

for (const fixture of F25_INFRASTRUCTURE_CASES)
  test(`F25 actual fixed bootstrap infrastructure ${fixture.name} preserves failed outcome and private original boundary`, async () => {
    const source = await readFile(new URL('../scripts/verify-windows-managed-launcher-bootstrap.ps1', import.meta.url));
    const sha = createHash('sha256').update(source).digest('hex');
    const framed = Buffer.from(`${JSON.stringify({ schema: 'core1562.f25.ast-input.v1',
      sourceFile: 'scripts/verify-windows-managed-launcher-bootstrap.ps1', sourceByteLength: source.length,
      sourceSha256: sha, sourceBase64: source.toString('base64') })}\n`);
    // Before-input-read failures use natural empty stdin EOF, ensuring an
    // expected EPIPE cannot masquerade as the required complete operation frame.
    const beforeInput = ['bootstrap_setup', 'missing_witness', 'invalid_witness', 'missing_exit', 'unexpected_exit',
      'source_read', 'source_decode', 'source_frame'].includes(fixture.name);
    await assert.rejects(() => observeF25InfrastructureFixture(fixture.name, beforeInput ? Buffer.alloc(0) : framed, sha), error => {
      assert.equal(isF25AstRejection(error), false); assert.equal(Object.hasOwn(error, 'cause'), false);
      const actual = f25ClosedFailureDiagnostic(error);
      assert.ok(actual); assert.equal(actual.closure?.code, 3); assert.equal(actual.closure?.signal, null);
      assert.equal(actual.closure?.delivered, true); assert.equal(actual.closure?.stdinFinish, true);
      assert.equal(actual.closure?.stdoutEnd, true); assert.equal(actual.closure?.stderrEnd, true);
      assert.equal(actual.closure?.exitObserved, true);
      assert.equal(actual.childOperation, fixture.operation);
      return true;
    });
  });

test('F25 negative SURROGATE invalidates bytes after either EOF before actual close', async () => {
  for (const stream of ['stdout', 'stderr']) {
    const s = surrogate(), pending = collectF25AstChild(s.child, Buffer.from('input'), digest).catch(error => ({ error }));
    s.child.stdout.emit('data', Buffer.from('F25I1|target_parse\n')); s.delivered(); s.child.stdin.emit('finish');
    s.child.stdout.emit('end'); s.child.stderr.emit('end'); s.child[stream].emit('data', Buffer.from('late'));
    s.child.emit('exit', 3, null); s.child.emit('close', 3, null);
    assert.equal(f25TransportFailureObservation((await pending).error).childOperation, undefined);
  }
});
