import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertPowerShellOriginalRetention } from './helpers/core1562-powershell-retention-source.mjs';
const source = () => readFile('scripts/verify-windows-managed-launcher-bootstrap.ps1', 'utf8');
test('F25 selected actual PowerShell barrier consumes original rooted owner and complete shielded tail', async () => {
  const actual = await source();
  assert.doesNotThrow(() => assertPowerShellOriginalRetention(actual));
  assert.doesNotThrow(() => assertPowerShellOriginalRetention(actual.replace('while ($true) { try { [Threading.Thread]', '# inert comment\n      while ($true) { try { [Threading.Thread]')));
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
    ['$script:NativeToolOwners.Add($key, $owner)', ''],
    ['$script:NativeToolOwners.Add($key, $owner)', '$script:NativeToolOwners.Add($key, $owner); return'],
    ["Write-OriginalToolRecord 'ACTIVE-CUSTODY'", "Write-OriginalToolRecord 'OTHER'"],
  ];
  for (const [needle, replacement] of mutations) {
    assert.ok(actual.includes(needle), `actual mutation target: ${needle}`);
    const changed = actual.replace(needle, replacement);
    assert.notEqual(changed, actual);
    assert.throws(() => assertPowerShellOriginalRetention(changed));
  }
});
