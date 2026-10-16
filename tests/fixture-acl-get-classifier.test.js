import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { encodeGuardianCommand } from './fixture-diagnostic-hold-protocol.js';

const originals = new WeakMap();
const runFixed = (source, expected) => new Promise((resolve, reject) => {
  const executable = process.platform === 'win32' ? 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'
    : '/opt/microsoft/powershell/7/pwsh';
  const retained = [], chunks = []; let bytes = 0, stderrBytes = 0, stdoutEof = false, stderrEof = false;
  let exit, stdinFinished = false, stdinCallback = false, overflow = false;
  let child;
  try {
    child = spawn(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodeGuardianCommand(source)],
      { cwd: process.cwd(), env: { ...process.env }, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (original) {
    const failure = new Error('Fixed CLR classifier child unavailable; private original retained.');
    originals.set(failure, { original }); reject(failure); return;
  }
  child.on('error', original => { retained.push(original); });
  for (const stream of [child.stdin, child.stdout, child.stderr]) stream.on('error', original => { retained.push(original); });
  child.stdout.on('data', chunk => {
    if (bytes + chunk.length <= 16384) chunks.push(Buffer.from(chunk)); else overflow = true;
    bytes += chunk.length;
  });
  child.stderr.on('data', chunk => { stderrBytes += chunk.length; });
  child.stdout.on('end', () => { stdoutEof = true; }); child.stderr.on('end', () => { stderrEof = true; });
  child.stdin.on('finish', () => { stdinFinished = true; });
  child.on('exit', (code, signal) => { exit = { code, signal }; });
  child.once('close', (code, signal) => {
    const stdout = Buffer.concat(chunks);
    if (retained.length || overflow || stderrBytes || !stdoutEof || !stderrEof || !stdinFinished || !stdinCallback ||
        !exit || exit.code !== 0 || exit.signal !== null || code !== exit.code || signal !== exit.signal || !stdout.equals(Buffer.from(expected))) {
      const failure = new Error('Fixed CLR classifier fixture failed; private originals retained.');
      originals.set(failure, { child, retained, stdout, stderrBytes, exit, close: { code, signal } }); reject(failure); return;
    }
    resolve();
  });
  try { child.stdin.end(original => { stdinCallback = true; if (original !== undefined && original !== null) retained.push(original); }); }
  catch (original) { retained.push(original); }
});
const prefix = `$ErrorActionPreference='Stop'
$originals=[System.Collections.Generic.List[object]]::new()
function Remember-Original($original) { $script:originals.Add($original) }
`;
const normal = `
$direct=[System.Management.Automation.CommandNotFoundException]::new('fixture')
$other=[System.IO.IOException]::new('fixture')
$wrapped=[System.InvalidOperationException]::new('fixture',$direct)
foreach($row in @(@($direct,'owner_read_acl_command_lookup'),@($other,'owner_read_acl_other'),@($wrapped,'owner_read_acl_other'))) {
  $record=[System.Management.Automation.ErrorRecord]::new($row[0],'fixture',[System.Management.Automation.ErrorCategory]::NotSpecified,$null)
  Remember-Original $record
  $operation=Classify-AclGetFailure $record
  if($operation -cne $row[1] -or -not [object]::ReferenceEquals($script:originals[$script:originals.Count-1],$record) -or -not [object]::ReferenceEquals($record.Exception,$row[0])) { throw 'Fixture classification or original identity failed' }
}
if((Classify-AclGetFailure $null) -cne 'owner_read_acl_get' -or $script:originals.Count -ne 3) { throw 'Fixture null fallback failed' }
[Console]::Out.Write('ACLCLR1|normal|4'); [Console]::Out.Flush()
`;
const failed = `
$exception=[System.IO.IOException]::new('fixture')
$record=[System.Management.Automation.ErrorRecord]::new($exception,'fixture',[System.Management.Automation.ErrorCategory]::NotSpecified,$null)
Remember-Original $record
$operation=Classify-AclGetFailure $record
if($operation -cne 'owner_read_acl_get' -or $script:originals.Count -ne 2 -or -not [object]::ReferenceEquals($script:originals[0],$record) -or [object]::ReferenceEquals($script:originals[1],$record) -or $script:originals[1] -isnot [System.Management.Automation.ErrorRecord]) { throw 'Fixture failed-observation originals or fallback failed' }
[Console]::Out.Write('ACLCLR1|failed|1'); [Console]::Out.Flush()
`;

test('genuine CLR shared classifier distinguishes direct, other, wrapped and null without acquisition authority', async () => {
  const classifier = await readFile(new URL('./fixture-acl-get-classifier.ps1', import.meta.url), 'utf8');
  await runFixed(prefix + classifier + normal, 'ACLCLR1|normal|4');
});
test('genuine CLR fixed observation-failure mutant preserves first and independent later originals', async () => {
  const classifier = await readFile(new URL('./fixture-acl-get-classifier.ps1', import.meta.url), 'utf8');
  const work = '$exception=$original.Exception';
  assert.equal(classifier.split(work).length - 1, 1);
  const mutant = classifier.replace(work, '$exception=[System.Math]::Abs([int]::MinValue)');
  assert.notEqual(mutant, classifier);
  await runFixed(prefix + mutant + failed, 'ACLCLR1|failed|1');
});
