// F26/F27 prospective SOURCE_UNRUN regression witnesses. Native cases separately
// require genuine original results and independently observed secondary failures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertManagedClosureSourceConformance, assertAcquisitionRecordingSourceConformance } from './helpers/core1681-managed-closure-source-contract.mjs';

const paths = ['src/runtime/execution/windows-managed-launcher-native.cs', 'scripts/native/core1681-acquisition.cs',
  'scripts/native/core1681-msi.cs', 'scripts/native/core1681-trust.cs'];
const sources = () => Promise.all(paths.map(path => readFile(path, 'utf8')));
function change(source, signature, needle, replacement) {
  const at = source.indexOf(signature);
  assert.ok(at >= 0 && source.slice(at).includes(needle), `${signature}: owning anchor`);
  const result = source.slice(0, at) + source.slice(at).replace(needle, replacement);
  assert.notEqual(result, source); return result;
}

test('F26 original known failures settle before diagnostic allocation and survive secondary catch', async () => {
  const [source] = await sources();
  assert.doesNotThrow(() => assertManagedClosureSourceConformance(source));
  for (const [signature, needle, replacement] of [
    ['internal static int RunManagedInvocation(', 'invocation.PrimaryNativeStatus = targetCreationError;', ''],
    ['internal static int RunManagedInvocation(', 'invocation.KnownPrimaryFailure = true;', 'invocation.KnownPrimaryFailure = false;'],
    ['internal static int RunManagedInvocation(', 'invocation.ChildIssuanceUnresolved = false;', ''],
    ['internal static int RunManagedInvocation(', 'if (!invocation.KnownPrimaryFailure) invocation.PrimaryResult = failureExitCode;', 'invocation.PrimaryResult = failureExitCode;'],
    ['internal static int RunManagedInvocation(', 'invocation.PrimaryNativeStatus = targetExitError;', ''],
    ['internal static bool ObserveDirectorySyncChildExit(', 'invocation.PrimaryResult = DirectorySyncLaunchChildFailed;', 'invocation.PrimaryResult = DirectorySyncLaunchBindingInvalid;'],
    ['internal static bool ObserveDirectorySyncChildExit(', 'invocation.KnownPrimaryFailure = true;', ''],
    ['private static int RunDirectorySyncLaunch(', 'invocation.PrimaryNativeStatus = createError;', ''],
    ['private static int RunDirectorySyncLaunch(', 'if (!invocation.KnownPrimaryFailure) invocation.PrimaryResult = DirectorySyncLaunchBindingInvalid;', 'invocation.PrimaryResult = DirectorySyncLaunchBindingInvalid;'],
  ]) {
    const mutant = change(source, signature, needle, replacement);
    assert.throws(() => assertManagedClosureSourceConformance(mutant), /managed closure/u);
    assert.throws(() => assertManagedClosureSourceConformance(`${mutant}\n/* inert original: ${needle} */`), /managed closure/u);
  }
});

test('F27 prerequisite authority remains before original close and successful close survives failed recording', async () => {
  const [, acquisition, msi, trust] = await sources();
  const check = source => assertAcquisitionRecordingSourceConformance(acquisition, source, trust);
  assert.doesNotThrow(() => check(msi));
  for (const [signature, needle, replacement] of [
    ['private void Release(', 'Before("MsiViewClose", resource.Ordinal.ToString());', ''],
    ['private void Release(', 'Before("MsiCloseHandle", resource.Ordinal.ToString());', ''],
    ['private void Release(', 'resource.ViewCloseStatus = viewStatus;', ''],
    ['private void Release(', 'ObserveCloseResult("MsiViewClose", viewStatus);', 'Observe("MsiViewClose", viewStatus);'],
    ['private void Release(', 'ObserveCloseResult("MsiCloseHandle", status);', 'Observe("MsiCloseHandle", status);'],
    ['private void ObserveCloseResult(', 'receipt.RecordingFailure = recording;', 'receipt.RecordingFailure = recording; receipt.OriginalException = recording;'],
    ['private void ObserveCloseResult(', 'receipt.Eligibility = "UNQUALIFIED_INPUT";', 'throw recording;'],
    ['private void ObserveCloseResult(', 'receipt.CloseObservationFailed = true;', ''],
    ['internal MsiReceipt Read(', 'if (!receipt.CloseObservationFailed)', 'if (true)'],
    ['internal MsiReceipt Read(', 'if (receipt.OriginalException == null) receipt.OriginalException = original;', 'receipt.OriginalException = original;'],
  ]) {
    const mutant = change(msi, signature, needle, replacement);
    assert.throws(() => check(mutant), /managed closure/u);
    assert.throws(() => check(`${mutant}\n/* inert original: ${needle} */`), /managed closure/u);
  }
  assert.throws(() => assertAcquisitionRecordingSourceConformance(acquisition.replace(
    'internal uint? ViewCloseStatus;', 'internal uint? ViewCloseStatus { get; set; }'), msi, trust), /managed closure/u);
  assert.throws(() => check(msi.replace('internal bool CloseObservationFailed;',
    'internal bool CloseObservationFailed { get; set; }')), /managed closure/u);
});

test('F26/F27 safe braces and inert trivia preserve original settlement and observation protection', async () => {
  const [source, acquisition, msi, trust] = await sources();
  assert.doesNotThrow(() => assertManagedClosureSourceConformance(source.replace(
    'invocation.PrimaryNativeStatus = targetCreationError;', '{ ; invocation.PrimaryNativeStatus = targetCreationError; ; }')));
  assert.doesNotThrow(() => assertAcquisitionRecordingSourceConformance(acquisition, msi.replace(
    'resource.ViewCloseStatus = viewStatus;', '{ ; resource.ViewCloseStatus = viewStatus; ; }'), trust));
});
