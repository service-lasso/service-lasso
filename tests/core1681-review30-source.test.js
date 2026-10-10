// SPEC-002 AC-4DI.4/R3/C3/G1 F21-F22. SOURCE_UNRUN; prospective source
// conformance only, never original interop failure or native custody proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertManagedClosureSourceConformance } from './helpers/core1681-managed-closure-source-contract.mjs';

const current = () => readFile('src/runtime/execution/windows-managed-launcher-native.cs', 'utf8');
function change(source, signature, needle, replacement) {
  const at = source.indexOf(signature);
  assert.ok(at >= 0 && source.slice(at).includes(needle), `actual owner ${signature}: ${needle}`);
  const mutant = source.slice(0, at) + source.slice(at).replace(needle, replacement);
  assert.notEqual(mutant, source);
  return mutant;
}
function denied(source, label) {
  assert.throws(() => assertManagedClosureSourceConformance(source), /managed closure/u, label);
}

test('F21 actual original primary wait has pending-before-issuance and observation-before-resolution', async () => {
  const source = await current();
  assert.doesNotThrow(() => assertManagedClosureSourceConformance(source));
  const caller = 'internal static int RunManagedInvocation(';
  const containment = 'private static void ContainManagedJobBeforeFileRelease(';
  const vectors = [
    ['missing pending before original call', caller, 'invocation.PrimaryWaitPending = true;', ''],
    ['pending falsely known', caller, 'invocation.PrimaryWaitPending = true;', 'invocation.PrimaryWaitPending = false;'],
    ['resolution omitted', caller, 'invocation.PrimaryWaitPending = false;', ''],
    ['resolution before original observation', caller, 'invocation.Observe("target-primary-wait", targetWaitError, targetWait != WaitObject0, null);', 'invocation.PrimaryWaitPending = false; invocation.Observe("target-primary-wait", targetWaitError, targetWait != WaitObject0, null);'],
    ['unavailable-return disposition cleared on throw', caller, 'if (invocation.PrimaryWaitPending)', 'invocation.PrimaryWaitPending = false; if (invocation.PrimaryWaitPending)'],
    ['unavailable original exception discarded', caller, 'invocation.Observe("target-primary-wait-unavailable", 0, true, primary);', 'invocation.Observe("target-primary-wait-unavailable", 0, true, null);'],
    ['unrelated earlier exception made wait attempt', caller, 'ValidateNativeLayouts();', 'invocation.PrimaryWaitPending = true; ValidateNativeLayouts();'],
    ['pending invocation reaches replacement containment wait', containment, ' || invocation.PrimaryWaitPending)', ')'],
    ['pending owner returns rather than retains', containment, 'RetainManagedInvocation(invocation);', 'return;'],
    ['original wait retried before pending guard', containment, '// An unavailable create return', 'WaitForSingleObject(processHandle, Infinite); // An unavailable create return'],
    ['termination retry before pending guard', containment, '// An unavailable create return', 'TerminateJobObject(jobHandle, 1); // An unavailable create return'],
    ['dependent release before pending guard', containment, '// An unavailable create return', 'invocation.Release(ref jobHandle, "managed-job-release", 0); // An unavailable create return'],
    ['transitive finisher bypasses original containment', caller, 'try { ContainManagedJobBeforeFileRelease(', 'FinishManagedReleases(invocation, ref threadHandle, ref processHandle); try { ContainManagedJobBeforeFileRelease('],
  ];
  for (const [label, signature, needle, replacement] of vectors) {
    const mutant = change(source, signature, needle, replacement);
    denied(mutant, label);
    denied(`${mutant}\n/* inert original decoy: ${needle} */\n`, label);
  }
  const needle = 'invocation.PrimaryWaitPending = true;';
  assert.doesNotThrow(() => assertManagedClosureSourceConformance(change(source, caller, needle, `{ ; ${needle} ; }`)));
});

test('F22 every CSharp newline exposes early return in all original owning paths', async () => {
  const source = await current();
  const owners = [
    ['internal bool ReleaseFile(', 'return true;'],
    ['internal static void RetainManagedInvocation(', 'return;'],
    ['private static void RetireEnvironmentName(', 'return;'],
  ];
  for (const newline of ['\r', '\n', '\r\n', '\u0085', '\u2028', '\u2029']) {
    for (const [signature, statement] of owners) {
      const at = source.indexOf(signature), open = source.indexOf('{', at);
      assert.ok(at >= 0 && open > at);
      denied(source.slice(0, open + 1) + `// inert${newline}${statement}\n` + source.slice(open + 1), `${signature}:${JSON.stringify(newline)}`);
      assert.doesNotThrow(() => assertManagedClosureSourceConformance(source.slice(0, open + 1) + `// inert${newline}; /* inert return; */` + source.slice(open + 1)));
    }
  }
});

test('F22 whole guard supports genuine CSharp trivia and verbatim literals but denies repaired separators and ordinary newlines', async () => {
  const source = await current();
  assert.doesNotThrow(() => assertManagedClosureSourceConformance(`\ufeff${source}`));
  for (const space of ['\t', '\v', '\f', ' ', '\u00a0', '\u1680',
    ...Array.from({ length: 11 }, (_, at) => String.fromCharCode(0x2000 + at)), '\u202f', '\u205f', '\u3000']) {
    assert.doesNotThrow(() => assertManagedClosureSourceConformance(source.replace('internal bool ReleaseFile', `internal${space}bool${space}ReleaseFile`)));
  }
  for (const character of ['\ufeff', '\u200b', '\u2060', '\u0000']) {
    denied(source.replace('internal bool ReleaseFile', `internal${character}bool ReleaseFile`), 'unsupported separator');
    denied(source + character, 'unsupported raw EOF character');
  }
  // An unused value-only constant is inside the actual outer type; it cannot
  // supply a callee/owner role. These cases exercise whole-source literal intake.
  const header = 'public static class ServiceLassoManagedLauncherNative';
  const open = source.indexOf('{', source.indexOf(header));
  const withLiteral = literal => source.slice(0, open + 1) + `private const string FixtureLiteral = ${literal};` + source.slice(open + 1);
  for (const newline of ['\r', '\n', '\r\n', '\u0085', '\u2028', '\u2029']) {
    assert.doesNotThrow(() => assertManagedClosureSourceConformance(withLiteral(`@"a${newline}b""c"`)));
    denied(withLiteral(`"a${newline}b"`), 'raw ordinary string newline');
    denied(withLiteral(`"a\\${newline}b"`), 'escaped raw ordinary newline');
    denied(withLiteral(`'${newline}'`), 'raw ordinary char newline');
  }
  for (const literal of ['@"unclosed', '"\\q"', "'ab'", '"unclosed']) denied(withLiteral(literal), 'unsupported literal');
  denied(source + '/* unclosed', 'unclosed comment');
});
