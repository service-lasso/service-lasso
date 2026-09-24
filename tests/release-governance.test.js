import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const names = [
  '.governance/rules/gov-09-release-authority.mdc',
  '.governance/project/RELEASE_TRACEABILITY.md',
  '.governance/project/PROJECT_INTENT.md',
  '.governance/specs/SPEC-007-secrets-capability-ledger.md',
  'AGENTS.md',
];
const validator = path.join(root, 'scripts/validate-release-governance.mjs');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-governance-'));
  for (const name of names) {
    const target = path.join(dir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, name), target);
  }
  return dir;
}
function run(dir) {
  return spawnSync(process.execPath, [validator], {
    encoding: 'utf8',
    env: { ...process.env, RELEASE_GOVERNANCE_ROOT: dir },
  });
}
test('valid release authority contract passes', () => {
  const dir = fixture();
  try { assert.equal(run(dir).status, 0); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('missing exact candidate fields fail governance validation', () => {
  const dir = fixture();
  try {
    const file = path.join(dir, names[0]);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('full 40-character commit SHA, published package version, and qualification evidence', 'candidate reference'));
    assert.equal(run(dir).status, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('invented independent approval blocker fails governance validation', () => {
  const dir = fixture();
  try {
    fs.appendFileSync(path.join(dir, names[2]), '\nGA blocked: external security approval outstanding\n');
    assert.equal(run(dir).status, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
