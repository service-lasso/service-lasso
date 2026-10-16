import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { decodeF25AstResponse, isF25AstRejection, f25ClosedFailureDiagnostic, validateF25AstClosure, observeF25AstFrame, collectF25AstChild, f25FailureHasOriginals } from './helpers/core1562-powershell-retention-source.mjs';

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
