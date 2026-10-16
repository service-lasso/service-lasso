import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertPowerShellOriginalRetention, assertPowerShellRecorderReleaseRetention, isF25AstRejection } from './helpers/core1562-powershell-retention-source.mjs';
const source = () => readFile('scripts/verify-windows-managed-launcher-bootstrap.ps1', 'utf8');

test('F25 committed complete definition and command-binding adversary roster', async () => {
  const actual = await source();
  const signature = 'function Get-Sha256Hex([byte[]]$bytes) {';
  const start = actual.indexOf(signature);
  const next = actual.indexOf('function Get-NormalizedNativePeBytes', start);
  assert.ok(start >= 0 && next > start);
  const definition = actual.slice(start, next);
  const closing = definition.lastIndexOf('}');
  assert.ok(closing > signature.length);
  const body = definition.slice(signature.length, closing);
  const initCall = "Invoke-RetainedNativeTool $cmdImage @() $childEnvironment 'initialize' $cmdArguments";
  const invokeSignature = 'function Invoke-RetainedNativeTool(';
  const releaseGate = 'if ($releaseFailed -or $owner.recordingFailed) { Retain-ActiveOriginalOwner }';
  for (const needle of [initCall, invokeSignature, releaseGate]) assert.ok(actual.includes(needle));
  const mutants = [
    actual.replace(signature, 'function Get-Sha256Hex([ValidateNotNull()][byte[]]$bytes) {'),
    actual.replace(signature, 'function Get-Sha256Hex([byte[]]$bytes = $(Write-Output changed)) {'),
    actual.replace(signature, 'function Get-Sha256Hex([byte[]]$bytes, $extra) {'),
    actual.replace('[string]$nativeArguments = $null', '[string]$nativeArguments = $(Write-Output changed)'),
    actual.replace(signature, `${signature} trap { continue };`),
    actual.replace(definition, definition + definition),
    actual.replace(definition, '') + '\n' + definition,
    actual.replace(signature, `Set-Alias Get-Sha256Hex Write-Output\n${signature}`),
    actual.replace('Get-Sha256Hex $sourceBytes', "& 'Get-Sha256Hex' $sourceBytes"),
    actual.replace(signature, `Get-Sha256Hex ([byte[]]@())\n${signature}`),
    actual.replace(initCall, `& 'Invoke-RetainedNativeTool' $cmdImage @() $childEnvironment 'initialize' $cmdArguments`),
    actual.replace(initCall, '').replace(invokeSignature, `${initCall}\n${invokeSignature}`),
    actual.replace(releaseGate, '').replace('$script:NativeToolOwners.Add($key, $owner)', `${releaseGate}\n$script:NativeToolOwners.Add($key, $owner)`),
    actual.replace('function Add-OriginalToolError([string]$phase, $original)', 'function Add-OriginalToolError([ValidateNotNull()][string]$phase, $original)'),
    actual.replace("Add-OriginalToolError 'custody-wait' $_.Exception", "Add-OriginalToolError 'custody-wait' $_::Exception"),
    actual.replace("Add-OriginalToolError 'custody-wait' $_.Exception", "Add-OriginalToolError 'custody-wait' ${_}?.Exception"),
    actual.replace("Add-OriginalToolError 'custody-wait' $_.Exception", "Add-OriginalToolError 'custody-wait' $_.('Exception')"),
    actual.replace("Add-OriginalToolError 'custody-wait' $_.Exception", "Add-OriginalToolError 'custody-wait' $global:_.Exception"),
  ];
  for (const block of ['process', 'dynamicparam']) {
    mutants.push(actual.replace(definition, `${signature}\n${block} { Write-Output changed }\nend {${body}}\n}\n`));
  }
  mutants.push(actual.replace(definition, `${signature}\nend {${body}}\nclean { Write-Output changed }\n}\n`));
  for (const mutant of mutants) {
    assert.notEqual(mutant, actual, 'mutation must alter an actual source definition/operand');
    await assert.rejects(() => assertPowerShellOriginalRetention(mutant), isF25AstRejection);
  }
});

test('F25 real AST rejects generic method binding and script requirement effects', async () => {
  const actual = await source();
  await assert.doesNotReject(() => assertPowerShellOriginalRetention(actual));
  for (const [needle, replacement] of [
    ['$script:NativeToolOwners.Add($key, $owner)', '$script:NativeToolOwners.Add[int]($key, $owner)'],
    ['[Threading.Thread]::Sleep([Threading.Timeout]::Infinite)', '[Threading.Thread]::Sleep[int]([Threading.Timeout]::Infinite)'],
    ['$owner.process.Dispose()', '$owner.process.Dispose[int]()'],
    ['$owner.copies.$name.source.Dispose()', '$owner.copies.$name.source.Dispose[int]()'],
    ['$stream.Dispose()', '$stream.Dispose[int]()'],
  ]) {
    assert.ok(actual.includes(needle));
    await assert.rejects(() => assertPowerShellOriginalRetention(actual.replace(needle, replacement)), isF25AstRejection);
  }
  for (const requirement of ['#requires -Modules F25ChangedImport', '#requires -Version 999.0', '#requires -RunAsAdministrator']) {
    await assert.rejects(() => assertPowerShellOriginalRetention(`${requirement}\n${actual}`), isF25AstRejection);
  }
});
test('F25 selected actual PowerShell barrier consumes original rooted owner and complete shielded tail', async () => {
  const actual = await source();
  await assert.doesNotReject(() => assertPowerShellOriginalRetention(actual));
  await assert.doesNotReject(() => assertPowerShellOriginalRetention(actual.replace('while ($true) { try { [Threading.Thread]', '# inert comment\n      while ($true) { try { [Threading.Thread]')));
  await assert.doesNotReject(() => assertPowerShellOriginalRetention(actual.replace(
    "Add-OriginalToolError 'custody-wait' $_.Exception",
    "Add-OriginalToolError `\n 'custody-wait' $_.Exception")));
});

test('F25 complete enclosing definitions and actual caller context reject semantic escapes', async () => {
  const actual = await source();
  const cases = [
    ['[CmdletBinding()]', '[CmdletBinding(SupportsShouldProcess)]'],
    ['[switch]$Update,', '[switch]$Update = $(Write-Output changed),'],
    ['$script:NativeToolOwners.Add($key, $owner)', '$script:NativeToolOwners.Add($key, $owner); return'],
    ['$script:NativeToolOwners.Add($key, $owner)', '$script:NativeToolOwners.Add($key, $owner); $script:NativeToolOwners = $null'],
    ['function Retain-ActiveOriginalOwner', 'Set-Alias Retain-ActiveOriginalOwner Write-Output; function Retain-ActiveOriginalOwner'],
    ['[StringComparer]::Ordinal', '[StringComparer]::OrdinalIgnoreCase'],
    ['if ($releaseFailed -or $owner.recordingFailed) { Retain-ActiveOriginalOwner }', ''],
  ];
  for (const [needle, replacement] of cases) {
    assert.ok(actual.includes(needle), `actual enclosing mutation target: ${needle}`);
    await assert.rejects(() => assertPowerShellOriginalRetention(actual.replace(needle, replacement)), isF25AstRejection);
  }
  const namedBlocks = actual.replace('$ErrorActionPreference = "Stop"',
    'begin { Write-Output changed }\nend {\n$ErrorActionPreference = "Stop"') + '\n}\n';
  await assert.rejects(() => assertPowerShellOriginalRetention(namedBlocks), isF25AstRejection);
  const assignment = '$owner.recordingFailure = $_.Exception; $owner.recordingFailed = $true';
  assert.ok(actual.split(assignment).length > 3);
  for (const boundary of ['\n', ' # split original member\n']) {
    // Mutate each actual shield separately so another malformed occurrence
    // cannot mask a missed original-error assignment.
    for (let offset = actual.indexOf(assignment); offset !== -1; offset = actual.indexOf(assignment, offset + assignment.length)) {
      const changed = actual.slice(0, offset) + `$owner.recordingFailure = $_${boundary}.Exception; $owner.recordingFailed = $true` + actual.slice(offset + assignment.length);
      await assert.rejects(() => assertPowerShellOriginalRetention(changed), isF25AstRejection);
    }
  }
});
test('F25 finite, escaping, unshielded, unrooted and unreachable-copy mutations deny', async () => {
  const actual = await source();
  const barrier = 'while ($true) { try { [Threading.Thread]::Sleep([Threading.Timeout]::Infinite) } catch { try { Add-OriginalToolError \'custody-wait\' $_.Exception } catch { $owner.recordingFailure = $_.Exception; $owner.recordingFailed = $true } } }';
  const mutations = [
    ...['0', '1', '$duration'].map(value => [barrier, barrier.replace('[Threading.Timeout]::Infinite', value)]),
    [barrier, barrier.replace('while ($true)', 'while ($false)')],
    [barrier, barrier.slice('while ($true) { '.length, -2)],
    ...['return', 'break', 'throw $_.Exception'].map(value => [barrier, `${value}; ${barrier}`]),
    ...['return', 'break', 'throw $_.Exception'].map(value => [barrier, barrier.replace(' } catch', `; ${value} } catch`)]),
    [barrier, `${barrier}; return`],
    [barrier, "while ($true) { [Threading.Thread]::Sleep([Threading.Timeout]::Infinite) }"],
    [barrier, barrier.replace("catch { try { Add-OriginalToolError 'custody-wait' $_.Exception } catch { $owner.recordingFailure = $_.Exception; $owner.recordingFailed = $true } }", 'catch { throw }')],
    [barrier, barrier.replace('$owner.recordingFailure = $_.Exception;', '')],
    [barrier, barrier.replace('$owner.recordingFailed = $true', '$owner.recordingFailed = $false')],
    [barrier, barrier.replace("'custody-wait' $_.Exception", "'custody-wait' $replacement")],
    [barrier, `if ($false) { ${barrier} }`],
    [barrier, `return; function UnreachableCopy { ${barrier} }`],
    ['$script:NativeToolOwners.Add($key, $owner)', 'return; $script:NativeToolOwners.Add($key, $owner)'],
    ['$script:NativeToolOwners.Add($key, $owner)', ''],
    ['$script:NativeToolOwners.Add($key, $owner)', '$script:NativeToolOwners.Add($key, $owner); return'],
    ["Write-OriginalToolRecord 'ACTIVE-CUSTODY'", "Write-OriginalToolRecord 'OTHER'"],
  ];
  for (const [needle, replacement] of mutations) {
    assert.ok(actual.includes(needle), `actual mutation target: ${needle}`);
    const changed = actual.replace(needle, replacement);
    assert.notEqual(changed, actual);
    await assert.rejects(() => assertPowerShellOriginalRetention(changed), isF25AstRejection);
  }
});

test('F25 either release or recorder failure retains the original invocation', async () => {
  const actual = await source();
  const gate = 'if ($releaseFailed -or $owner.recordingFailed) { Retain-ActiveOriginalOwner }';
  assert.ok(actual.includes(gate));
  await assert.doesNotReject(() => assertPowerShellRecorderReleaseRetention(actual));
  for (const changedGate of [gate.replace('-or', '-and'), 'if ($releaseFailed) { Retain-ActiveOriginalOwner }',
    'if ($owner.recordingFailed) { Retain-ActiveOriginalOwner }', '']) {
    await assert.rejects(() => assertPowerShellRecorderReleaseRetention(actual.replace(gate, changedGate)), isF25AstRejection);
  }
});
test('F25 all original recorder operands preserve actual command-line boundaries', async () => {
  const actual = await source();
  for (const phase of ['retention-copy-observation', 'custody-record', 'custody-wait']) {
    const call = `Add-OriginalToolError '${phase}' $_.Exception`;
    assert.ok(actual.includes(call));
    for (const separator of ['\n', '\r\n', ' # original operand moved to next command\n']) {
      for (const boundary of [`Add-OriginalToolError '${phase}'`, 'Add-OriginalToolError']) {
        const modified = call.replace(`${boundary} `, `${boundary}${separator}`);
        assert.notEqual(modified, call);
        await assert.rejects(() => assertPowerShellOriginalRetention(actual.replace(call, modified)), isF25AstRejection);
      }
    }
  }
});
