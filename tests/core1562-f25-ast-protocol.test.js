import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { decodeF25AstResponse, isF25AstRejection, f25ClosedFailureDiagnostic, validateF25AstClosure, observeF25AstFrame } from './helpers/core1562-powershell-retention-source.mjs';

const digest = 'a'.repeat(64);
const frame = status => `${JSON.stringify({ schema: 'core1562.f25.ast-result.v1', status,
  sourceSha256: digest, reason: status === 'conformant' ? 'none' : 'shape_mismatch' })}\n`;
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
