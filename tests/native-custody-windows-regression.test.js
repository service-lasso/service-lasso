import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { nativeHelperScript, samePath } from '../scripts/native-tool-journal-v4-lib.mjs';
import { bootstrapProtocolScript } from '../scripts/private-first-custody-v3-lib.mjs';

test('Windows native custody helper avoids the Get-History alias', () => {
  const script = nativeHelperScript('win32', 42, 7);
  assert.match(script, /function Get-HeldImageProof\(\[string\]\$p\)/u);
  assert.match(script, /Get-HeldImageProof \(\[string\]\$q\.ExecutablePath\)/u);
  assert.match(script, /Get-HeldImageProof \$library/u);
  assert.doesNotMatch(script, /function H\(/u);
  assert.doesNotMatch(script, /=H \(/u);
});

test('Windows custody ACLs construct SecurityIdentifier objects', () => {
  const script = bootstrapProtocolScript();
  assert.match(script, /New-Object Security\.Principal\.SecurityIdentifier\(\$_\)/u);
});

test('native custody path comparison is case-insensitive only on Windows', () => {
  if (process.platform === 'win32') {
    assert.equal(samePath('C:\\WINDOWS\\System32\\x.dll', 'C:\\Windows\\System32\\x.dll'), true);
    assert.equal(samePath('C:\\Windows\\A', 'C:\\Windows\\B'), false);
  } else {
    assert.equal(samePath('/opt/a/b', '/opt/a/b'), true);
    assert.equal(samePath('/OPT/a/b', '/opt/a/b'), false);
  }
});

test('native custody waits for both inherited pipes before publishing EOF', async () => {
  const source = await readFile(new URL('../scripts/native-tool-journal-v4-lib.mjs', import.meta.url), 'utf8');
  assert.match(source, /Promise\.all\(\[stdoutClosed, stderrClosed\]\)/u);
});
