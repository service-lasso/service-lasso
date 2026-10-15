import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const validator = path.join(root, 'scripts/check-staged-service-transfer-contract.mjs');
const sources = [
  '.governance/specs/SPEC-002-core-standalone-runtime.md',
  'docs/api/staged-service-transfer.md',
];

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'staged-transfer-contract-'));
  for (const source of sources) {
    const target = path.join(dir, source);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, source), target);
  }
  return dir;
}

function run(dir) {
  return spawnSync(process.execPath, [validator], {
    encoding: 'utf8',
    env: { ...process.env, STAGED_TRANSFER_CONTRACT_ROOT: dir },
  });
}

test('staged-transfer PAX framing contract agrees with SPEC-002 AC-4CH.2', () => {
  const dir = fixture();
  try {
    assert.equal(run(dir).status, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('no-path PAX size cannot regain framing authority', () => {
  const dir = fixture();
  try {
    const contract = path.join(dir, 'docs/api/staged-service-transfer.md');
    const original = fs.readFileSync(contract, 'utf8');
    fs.writeFileSync(
      contract,
      original.replace(
        'its `size` remains an equal redundant declaration\n  only and never controls that member\'s framing, accounting, or padding',
        'its `size` controls that member\'s framing',
      ),
    );
    assert.equal(run(dir).status, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
