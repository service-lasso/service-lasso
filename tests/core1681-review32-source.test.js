// SPEC-002 AC-4DI.4/R3/C3/G1 F25. SOURCE_UNRUN; these static witnesses
// do not manufacture genuine native exceptions/allocation failures or admission.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertManagedClosureSourceConformance, assertAcquisitionRecordingSourceConformance } from './helpers/core1681-managed-closure-source-contract.mjs';

const sourcePaths = ['src/runtime/execution/windows-managed-launcher-native.cs', 'scripts/native/core1681-acquisition.cs',
  'scripts/native/core1681-msi.cs', 'scripts/native/core1681-trust.cs', 'scripts/verify-windows-managed-launcher-bootstrap.ps1'];
const sources = () => Promise.all(sourcePaths.map(path => readFile(path, 'utf8')));
function change(source, signature, needle, replacement) {
  const at = source.indexOf(signature);
  assert.ok(at >= 0 && source.slice(at).includes(needle), `actual owner ${signature}: ${needle}`);
  const result = source.slice(0, at) + source.slice(at).replace(needle, replacement);
  assert.notEqual(result, source); return result;
}

test('F25 managed recording failure cannot erase failure state, retry original wait or bypass independent releases', async () => {
  const [source] = await sources();
  assert.doesNotThrow(() => assertManagedClosureSourceConformance(source));
  for (const [signature, needle, replacement] of [
    ['internal void Observe(', 'Failed |= failed;', ''],
    ['internal void Observe(', 'UnrecordedException = exception;', 'UnrecordedException = recording;'],
    ['internal void Observe(', 'catch (Exception recording)', 'catch (InvalidOperationException recording)'],
    ['internal void Observe(', 'RecordingFailure = recording; Failed = true;', 'throw recording;'],
    ['internal void ObservePrimary(', 'catch (Exception recording)', 'catch (InvalidOperationException recording)'],
    ['internal static int RunManagedInvocation(', 'invocation.PrimaryWaitFailed = targetWait != WaitObject0;', 'invocation.PrimaryWaitFailed = false;'],
    ['private static void ContainManagedJobBeforeFileRelease(', ' || invocation.PrimaryWaitFailed', ''],
    ['internal static void FinishManagedReleases(', 'catch (Exception recording)', 'catch (InvalidOperationException recording)'],
    ['internal static void FinishManagedReleases(', 'invocation.RecordingFailure = recording; invocation.Failed = true;', 'RetainManagedInvocation(invocation);'],
    ['internal static void FinishDirectorySyncInvocation(', 'catch (Exception recording)', 'catch (InvalidOperationException recording)'],
    ['private static void ClearLaunchEnvironment(', 'invocation.RecordingFailure = recording; invocation.Failed = true;', 'throw recording;'],
    ['internal static void ClearTargetEnvironmentOverrides(', 'invocation.RecordingFailure = recording; invocation.Failed = true;', 'RetainManagedInvocation(invocation);'],
    ['internal static void ApplyTargetEnvironmentOverrides(', 'catch (Exception recording)', 'catch (InvalidOperationException recording)'],
    ['internal static int RunManagedInvocation(', 'boundFiles.Capacity = checked(boundFiles.Count + payload.approvedFiles.Length);', ''],
    ['private static int RunDirectorySyncLaunch(', 'invocation.Files.Capacity = 1;', ''],
  ]) {
    const mutant = change(source, signature, needle, replacement);
    assert.throws(() => assertManagedClosureSourceConformance(mutant), /managed closure/u);
    assert.throws(() => assertManagedClosureSourceConformance(`${mutant}\n/* inert original: ${needle} */\n`), /managed closure/u);
  }
  const positive = change(source, 'internal static void FinishManagedReleases(', 'invocation.RecordingFailure = recording; invocation.Failed = true;',
    '{ ; invocation.RecordingFailure = recording; invocation.Failed = true; ; }');
  assert.doesNotThrow(() => assertManagedClosureSourceConformance(positive));
});

test('F25 transitive actual acquisition/MSI/trust boundaries deny unguarded records, post-effect slots and finally bypasses', async () => {
  const [, acquisition, msi, trust] = await sources();
  const check = (a, m, t) => assertAcquisitionRecordingSourceConformance(a, m, t);
  assert.doesNotThrow(() => check(acquisition, msi, trust));
  const vectors = [
    [0, 'internal void Interrupted(', 'LastInterruptionException = original;', ''],
    [0, 'internal void Interrupted(', 'catch (Exception recording)', 'catch (InvalidOperationException recording)'],
    [0, 'internal void Interrupted(', 'RecordingFailure = recording;', 'throw recording;'],
    [0, 'internal static void Retain(', 'retained.CallbackCompleted = true;', 'retained.CallbackCompleted = false;'],
    [0, 'internal static void Retain(', 'retained.Interrupted(original);', 'throw original;'],
    [0, 'internal static void Retain(', 'GC.KeepAlive(retained.Owner);', 'return;'],
    [1, 'private void Retain(', 'CurrentRetention = preparedRetention;', 'CurrentRetention = new RetentionState(this, reason);'],
    [2, 'private void Retain(', 'CurrentRetention = preparedRetention;', 'CurrentRetention = new RetentionState(this, reason);'],
    [1, 'private T Call<T>(', 'pendingCall = originalCall;', ''],
    [1, 'private T Call<T>(', 'pendingException = original;', 'pendingException = null;'],
    [1, 'private T Call<T>(', 'catch (Exception recording)', 'catch (InvalidOperationException recording)'],
    [1, 'private NativeResource Reserve(', 'pendingResource = resource;', 'pendingResource = null;'],
    [1, 'private void Publish(', 'resource.Handle = handle;', 'resource.Handle = 0;'],
    [1, 'private void Publish(', 'resource.AcquisitionReturned = true;', 'resource.AcquisitionReturned = false;'],
    [1, 'private void Publish(', 'Retain("UNPUBLISHED_ORIGINAL_MSI_RESOURCE");', 'return;'],
    [1, 'private void CaptureOneExtendedError(', 'var fields = new List<MsiErrorField>();', ''],
    [1, 'private void CaptureOneExtendedError(', 'finally { Release(resource); }', 'finally { ; }'],
    [1, 'private string[] Info(', 'var resource = Reserve("column-info-" + kind);', ''],
    [1, 'private void ReadTable(', 'var resource = Reserve("view:" + name, true);', ''],
    [1, 'private void ReadTable(', 'Publish(resource, view, value);', ''],
    [1, 'private void Release(', 'if (pendingCall != null) Retain("PENDING_ORIGINAL_MSI_CALL");', ''],
    [1, 'private void Release(', 'catch (Exception recording)', 'catch (InvalidOperationException recording)'],
    [1, 'internal MsiReceipt Read(', 'catch (Exception observer)', 'catch (InvalidOperationException observer)'],
    [1, 'internal MsiReceipt Read(', 'if (pendingCall != null) Retain("PENDING_ORIGINAL_MSI_DATABASE_DEPENDENCIES");', ''],
    [2, 'private void ReportException(', 'receipt.ObserverException = observer;', 'throw observer;'],
  ];
  for (const [unit, signature, needle, replacement] of vectors) {
    const originals = [acquisition, msi, trust], mutant = [...originals];
    mutant[unit] = change(mutant[unit], signature, needle, replacement);
    assert.throws(() => check(...mutant), /managed closure/u);
    mutant[unit] += `\n/* inert original decoy: ${needle} */\n`;
    assert.throws(() => check(...mutant), /managed closure/u);
  }
  assert.doesNotThrow(() => check(acquisition.replace('LastInterruptionException = original;', '{ ; LastInterruptionException = original; ; }'), msi, trust));
});

test('F25 PowerShell owns raw initiating exceptions and shields every catch recording before its same-invocation barrier', async () => {
  const [, , , , compiler] = await sources();
  // Supplementary textual source assertions only. PowerShell's complete finite
  // frontend/native operator acceptance remain unimplemented/unqualified.
  assert.match(compiler, /function Add-OriginalToolError\([\s\S]*?\$owner\.lastOriginalError = \$original[\s\S]*?try \{ \$owner\.errors\.Add[\s\S]*?catch \{ \$owner\.recordingFailure = \$_\.Exception; \$owner\.recordingFailed = \$true \}/u);
  assert.doesNotMatch(compiler, /exception = \$_\.Exception\.ToString\(\)/u);
  assert.match(compiler, /try \{ foreach \(\$name in @\('stdout', 'stderr'\)\)[\s\S]*?catch \{ try \{ Add-OriginalToolError 'retention-copy-observation'/u);
  assert.match(compiler, /while \(\$true\) \{ try \{ \$owner\.gate\.Wait\(\) \} catch \{ try \{ Add-OriginalToolError 'custody-wait'[\s\S]*?catch \{ \$owner\.recordingFailure = \$_\.Exception; \$owner\.recordingFailed = \$true \}/u);
  assert.match(compiler, /if \(\$owner\.primaryError\) \{ throw \$owner\.primaryError \}/u);
  assert.match(compiler, /\$owner\.errors\.Count -eq 0 -and -not \$owner\.recordingFailed/u);
  assert.match(compiler, /if \(\$owner\.startAttempted -and -not \$owner\.settled\) \{ Retain-ActiveOriginalOwner \}/u);
  assert.match(compiler, /if \(\$releaseFailed\) \{ Retain-ActiveOriginalOwner \}/u);
});