// SPEC-002 AC-4DI.4 C1-C3/R1-R4/G1. SOURCE_UNRUN. Actual source conformance
// is not direct Windows API, compiler, private-owner or native qualification.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertManagedClosureSourceConformance } from './helpers/core1681-managed-closure-source-contract.mjs';

test('F19 known failed effects preserve their primary while unknown issuance and failed retirement cannot escape', async () => {
  const source = await readFile('src/runtime/execution/windows-managed-launcher-native.cs', 'utf8');
  assert.doesNotThrow(() => assertManagedClosureSourceConformance(source));
  const vectors = [
    ['known FALSE made permanent retention', 'internal static int RunManagedInvocation(', 'invocation.ObservePrimary("target-original-create", targetCreationError, true, original);', 'invocation.Observe("target-original-create", targetCreationError, true, original);'],
    ['create pending observation omitted', 'internal static int RunManagedInvocation(', 'invocation.ChildIssuanceUnresolved = true;', ''],
    ['unknown throw falsely resolves issuance', 'internal static int RunManagedInvocation(', 'invocation.Observe("target-original-create-throw", 0, true, original);', 'invocation.ChildIssuanceUnresolved = false; invocation.Observe("target-original-create-throw", 0, true, original);'],
    ['invalid original process evidence admits release', 'internal static int RunManagedInvocation(', 'processHandle == IntPtr.Zero || threadHandle == IntPtr.Zero || processInformation.dwProcessId == 0', 'false'],
    ['unknown child passes containment', 'private static void ContainManagedJobBeforeFileRelease(', 'invocation.ChildIssuanceUnresolved || invocation.Outcomes.Exists', 'false || invocation.Outcomes.Exists'],
    ['failed original wait is retried', 'private static void ContainManagedJobBeforeFileRelease(', 'o.Site == "target-primary-wait" && o.Failed', 'o.Site == "target-primary-wait" && false'],
    ['known query failure made permanent retention', 'internal static bool ObserveDirectorySyncChildExit(', 'invocation.ObservePrimary(', 'invocation.Observe('],
    ['original query failure laundered to success', 'internal static bool ObserveDirectorySyncChildExit(', 'return exitKnown;', 'return true;'],
    ['original query error forgotten', 'internal static bool ObserveDirectorySyncChildExit(', 'if (!exitKnown) invocation.Primary = original;', ''],
    ['query lacks immediate original error', 'internal static bool ObserveDirectorySyncChildExit(', 'exitKnown ? 0 : Marshal.GetLastWin32Error()', '0'],
    ['directory unknown issuance uses zero handle as no child', 'internal static void FinishDirectorySyncInvocation(', 'invocation.ChildIssuanceUnresolved || (childProcess != IntPtr.Zero && !childClosed)', 'childProcess != IntPtr.Zero && !childClosed'],
    ['directory failed wait permits release', 'internal static void FinishDirectorySyncInvocation(', 'childProcess != IntPtr.Zero && !childClosed', 'false'],
    ['directory failed original release returns', 'internal static void FinishDirectorySyncInvocation(', 'if (invocation.Failed) RetainManagedInvocation(invocation);', ''],
    ['known failure ledger reset', 'internal void ObservePrimary(', 'Outcomes.Add(new OriginalObservation', 'Failed = false; Outcomes.Add(new OriginalObservation'],
    ['known failure observation discarded', 'internal void ObservePrimary(', 'NativeStatus = status, Failed = failed, Exception = exception', 'NativeStatus = 0, Failed = false, Exception = null'],
    ['directory create failure relabeled success', 'private static int RunDirectorySyncLaunch(', 'return DirectorySyncLaunchCreateFailed;', 'return 0;'],
    ['directory query failure relabeled success', 'private static int RunDirectorySyncLaunch(', '!exitKnown || exitCode != 0', 'false'],
    ['directory create pending omitted', 'private static int RunDirectorySyncLaunch(', 'invocation.ChildIssuanceUnresolved = true;', ''],
    ['directory TRUE missing terminal handles accepted', 'private static int RunDirectorySyncLaunch(', 'childProcess == IntPtr.Zero || childThread == IntPtr.Zero || processInformation.dwProcessId == 0', 'false'],
    ['directory helper released before wait', 'private static int RunDirectorySyncLaunch(', 'childClosed = ObserveDirectorySyncChildWait', 'helperHandle.Dispose(); childClosed = ObserveDirectorySyncChildWait'],
  ];
  for (const [label, signature, needle, replacement] of vectors) {
    const at = source.indexOf(signature);
    assert.ok(at >= 0 && source.slice(at).includes(needle), `${label}: original owning anchor`);
    const mutant = source.slice(0, at) + source.slice(at).replace(needle, replacement);
    assert.notEqual(mutant, source);
    assert.throws(() => assertManagedClosureSourceConformance(mutant), /managed closure/u, label);
    assert.throws(() => assertManagedClosureSourceConformance(`${mutant}\n/* original decoy: ${needle} */\n`), /managed closure/u, label);
  }
});

test('F19 safe braces and inert trivia retain original known failure settlement roles', async () => {
  const source = await readFile('src/runtime/execution/windows-managed-launcher-native.cs', 'utf8');
  for (const [needle, replacement] of [
    ['if (!exitKnown) invocation.Primary = original;', 'if (!exitKnown) { ; invocation.Primary = original; ; }'],
    ['return exitKnown;', '{ ; return exitKnown; ; }'],
    ['invocation.ChildIssuanceUnresolved = true;', '{ ; invocation.ChildIssuanceUnresolved = true; ; }'],
    ['invocation.ObservePrimary("directory-sync-child-exit-query", exitError, !exitKnown, original);', '/* original failed query remains failed */ invocation.ObservePrimary("directory-sync-child-exit-query", exitError, !exitKnown, original);'],
  ]) {
    assert.ok(source.includes(needle));
    assert.doesNotThrow(() => assertManagedClosureSourceConformance(source.replace(needle, replacement)));
  }
});
