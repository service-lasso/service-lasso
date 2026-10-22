// Committed normative roster, SOURCE_UNRUN. Target programs are parsed only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertPowerShellOriginalRetention, isF25AstRejection } from './helpers/core1562-powershell-retention-source.mjs';
const source = async () => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
  .decode(await readFile('scripts/verify-windows-managed-launcher-bootstrap.ps1'));

async function rejectRows(t, actual, rows) {
  for (const { id, mutate } of rows) {
    await t.test(id, async () => {
      const changed = mutate(actual);
      assert.equal(typeof changed, 'string');
      assert.notEqual(changed, actual, `${id}: actual mutation must be reachable`);
      await assert.rejects(() => assertPowerShellOriginalRetention(changed), isF25AstRejection);
    });
  }
}
const replace = (id, needle, replacement) => ({ id, mutate(actual) {
  assert.ok(actual.includes(needle), `${id}: actual source target is mandatory`);
  return actual.replace(needle, replacement);
} });

test('F25 normative enclosing context and both actual native calls', async t => {
  const actual = await source();
  const definition = 'function Invoke-RetainedNativeTool(';
  const registry = '$script:NativeToolOwners = [Collections.Generic.Dictionary[string,object]]::new([StringComparer]::Ordinal)';
  const root = '$script:NativeToolOwners.Add($key, $owner)';
  const gate = 'if ($releaseFailed -or $owner.recordingFailed) { Retain-ActiveOriginalOwner }';
  const remove = '$script:NativeToolOwners.Remove($key)';
  const calls = {
    initialize: "Invoke-RetainedNativeTool $cmdImage @() $childEnvironment 'initialize' $cmdArguments",
    compile: `Invoke-RetainedNativeTool $cl @('/nologo', '/TC', '/O2', '/GS', '/MT', '/W4', $sourcePath, "/Fo:$objectPath", "/Fe:$compiledPath", '/link', '/Brepro', 'bcrypt.lib') $initialized "compile"`,
  };
  const rows = [
    replace('CTX.tool-alias', definition, `Set-Alias Invoke-RetainedNativeTool Write-Output\n${definition}`),
    replace('CTX.retention-alias', definition, `Set-Alias Retain-ActiveOriginalOwner Write-Output\n${definition}`),
    replace('CTX.command', definition, `Write-Output changed\n${definition}`),
    replace('CTX.provider', definition, `New-PSDrive -Name F25 -PSProvider FileSystem -Root C:\\ \n${definition}`),
    replace('CTX.module', definition, `Import-Module F25ChangedImport\n${definition}`),
    replace('CTX.hook', definition, `Set-PSBreakpoint -Command Retain-ActiveOriginalOwner -Action { Write-Output changed }\n${definition}`),
    replace('CTX.callback', definition, `& { Set-Alias Invoke-RetainedNativeTool Write-Output }\n${definition}`),
    replace('REG.type', registry, registry.replace('Dictionary[string,object]', 'Dictionary[string,string]')),
    replace('REG.comparer', registry, registry.replace('::Ordinal)', '::OrdinalIgnoreCase)')),
    replace('REG.default-constructor', registry, registry.replace('([StringComparer]::Ordinal)', '()')),
    replace('REG.factory', registry, '$script:NativeToolOwners = New-Object Collections.Generic.Dictionary[string,object]'),
    replace('REG.scope', registry, registry.replace('$script:', '$global:')),
    replace('REG.replace-before-definition', definition, `$script:NativeToolOwners = @{}\n${definition}`),
    replace('REG.replace-after-definition', calls.initialize, `$script:NativeToolOwners = @{}\n${calls.initialize}`),
    replace('ROOT.conditional', root, `if ($true) { ${root} }`),
    replace('ROOT.trap', root, `trap { continue }; ${root}`),
    ...['return', 'exit', 'break', 'continue', 'throw'].map(command => replace(`ROOT.${command}`, root, `${command}; ${root}`)),
    ...[['owner', '$owner = @{}'], ['key', "$key = 'different'"], ['start', '$start = [Diagnostics.ProcessStartInfo]::new()'],
      ['registry', '$script:NativeToolOwners = @{}']].map(([name, assignment]) => replace(`ROOT.${name}-rebind`, root, `${root}; ${assignment}`)),
    { id: 'GATE.before-root', mutate(value) {
      for (const needle of [gate, root]) assert.ok(value.includes(needle));
      return value.replace(gate, '').replace(root, `${gate}\n${root}`);
    } },
    { id: 'GATE.after-remove', mutate(value) {
      for (const needle of [gate, remove]) assert.ok(value.includes(needle));
      return value.replace(gate, '').replace(remove, `${remove}\n${gate}`);
    } },
  ];
  for (const [name, call] of Object.entries(calls)) {
    rows.push(replace(`CALL.${name}.indirect`, call, call.replace('Invoke-RetainedNativeTool', "& 'Invoke-RetainedNativeTool'")));
    rows.push({ id: `CALL.${name}.before-definition`, mutate(value) {
      for (const needle of [call, definition]) assert.ok(value.includes(needle));
      return value.replace(call, '').replace(definition, `${call}\n${definition}`);
    } });
  }
  await rejectRows(t, actual, rows);
});

test('F25 normative signatures, named blocks and each selected nested definition', async t => {
  const actual = await source();
  const signature = 'function Get-Sha256Hex([byte[]]$bytes) {';
  const at = actual.indexOf(signature), end = actual.indexOf('function Get-NormalizedNativePeBytes', at);
  assert.ok(at >= 0 && end > at);
  const original = actual.slice(at, end), closing = original.lastIndexOf('}');
  assert.ok(closing > signature.length);
  const body = original.slice(signature.length, closing);
  const rows = [
    replace('DEF.default', signature, 'function Get-Sha256Hex([byte[]]$bytes = $(Write-Output changed)) {'),
    replace('DEF.parameter-attribute', signature, 'function Get-Sha256Hex([ValidateNotNull()][byte[]]$bytes) {'),
    replace('DEF.extra-parameter', signature, 'function Get-Sha256Hex([byte[]]$bytes, $extra) {'),
    replace('DEF.body-paramblock', signature, `${signature} param($extra)`),
    replace('DEF.filter', signature, signature.replace('function', 'filter')),
    replace('DEF.workflow', signature, signature.replace('function', 'workflow')),
    replace('BLOCK.trap', signature, `${signature} trap { continue };`),
    replace('BLOCK.named-end', original, `${signature}\nend {${body}}\n}\n`),
    replace('BLOCK.clean', original, `${signature}\nend {${body}}\nclean { Write-Output changed }\n}\n`),
    ...['begin', 'process', 'dynamicparam'].map(name => replace(`BLOCK.${name}`, original,
      `${signature}\n${name} { Write-Output changed }\nend {${body}}\n}\n`)),
  ];
  const helpers = [
    ['Add-OriginalToolError', 'function Add-OriginalToolError(', 'function Write-OriginalToolRecord('],
    ['Write-OriginalToolRecord', 'function Write-OriginalToolRecord(', 'function Observe-OriginalCopy('],
    ['Observe-OriginalCopy', 'function Observe-OriginalCopy(', 'function Retain-ActiveOriginalOwner {'],
    ['Retain-ActiveOriginalOwner', 'function Retain-ActiveOriginalOwner {', '    try {\n      $owner.stdoutRaw ='],
  ];
  for (const [name, first, next] of helpers) {
    const start = actual.indexOf(first);
    // Preserve original CRLF: marker choice is explicit, not source repair.
    let stop = actual.indexOf(next, start);
    if (stop < 0 && next.includes('\n')) stop = actual.indexOf(next.replaceAll('\n', '\r\n'), start);
    assert.ok(start >= 0 && stop > start, `${name}: actual whole selected definition`);
    const helper = actual.slice(start, stop);
    rows.push(replace(`DEF.duplicate.${name}`, helper, helper + helper));
    rows.push({ id: `DEF.relocated.${name}`, mutate(value) {
      assert.ok(value.includes(helper));
      const without = value.replace(helper, '');
      const rooting = '$script:NativeToolOwners.Add($key, $owner)';
      assert.ok(without.includes(rooting));
      return without.replace(rooting, `${helper}\n${rooting}`);
    } });
  }
  await rejectRows(t, actual, rows);
});

test('F25 normative every original recorder operand and every inner shield', async t => {
  const actual = await source();
  const rows = [];
  for (const phase of ['retention-copy-observation', 'custody-record', 'custody-wait']) {
    const call = `Add-OriginalToolError '${phase}' $_.Exception`;
    const operands = { errorrecord: '$_', copied: '$copiedError', 'other-member': '$_.Other', PSItem: '$PSItem.Exception',
      scope: '$global:_.Exception', static: '$_::Exception', nullconditional: '${_}?.Exception', computed: "$_.('Exception')",
      expandable: '$_."$member"', invoke: '$_.Exception()', conversion: '[Exception]$_.Exception' };
    rows.push(replace(`REC.${phase}.command`, call, call.replace('Add-OriginalToolError', 'Write-Output')));
    rows.push(replace(`REC.${phase}.phase`, call, call.replace(`'${phase}'`, "'different'")));
    rows.push(replace(`REC.${phase}.extra`, call, `${call} $extra`));
    rows.push(replace(`REC.${phase}.redirection`, call, `${call} > $null`));
    rows.push(replace(`REC.${phase}.indirect`, call, `& 'Add-OriginalToolError' '${phase}' $_.Exception`));
    rows.push(replace(`REC.${phase}.pipeline`, call, `${call} | Out-Null`));
    rows.push(replace(`REC.${phase}.wrapper`, call, call.replace('$_.Exception', '($_.Exception)')));
    for (const [name, operand] of Object.entries(operands)) rows.push(replace(`REC.${phase}.${name}`, call, call.replace('$_.Exception', operand)));
  }
  const assignment = '$owner.recordingFailure = $_.Exception; $owner.recordingFailed = $true';
  const replacements = { errorrecord: assignment.replace('$_.Exception', '$_'), copied: assignment.replace('$_.Exception', '$copiedError'),
    'other-member': assignment.replace('$_.Exception', '$_.Other'), 'missing-flag': '$owner.recordingFailure = $_.Exception;',
    'false-flag': assignment.replace('$true', '$false'), command: `${assignment}; Write-Output changed`,
    throw: `${assignment}; throw`, return: `${assignment}; return`, wrapper: assignment.replace('$_.Exception', '($_.Exception)') };
  let occurrence = 0;
  for (let offset = actual.indexOf(assignment); offset !== -1; offset = actual.indexOf(assignment, offset + assignment.length)) {
    occurrence++;
    for (const [name, replacement] of Object.entries(replacements)) {
      const position = offset;
      rows.push({ id: `SHIELD.${occurrence}.${name}`, mutate(value) {
        assert.equal(value.slice(position, position + assignment.length), assignment);
        return value.slice(0, position) + replacement + value.slice(position + assignment.length);
      } });
    }
  }
  assert.equal(occurrence, 18, 'all eighteen actual original shielding catches must be selected');
  await rejectRows(t, actual, rows);
});
