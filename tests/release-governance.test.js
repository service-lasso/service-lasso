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
  '.governance/project/CURRENT_GA_PLATFORM_SCOPE.md',
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

// SPEC-007 AC-7F / #1613. Exercise the actual documentation validator;
// these fixtures confer no product, native or released-candidate acceptance.
const scopeName = names.at(-1);
function mutate(dir, name, before, after) {
  const file = path.join(dir, name);
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.includes(before), `fixture mutation target missing: ${before}`);
  fs.writeFileSync(file, text.replace(before, after));
}

test('historical contract without a current decision retains three required platforms', () => {
  const dir = fixture();
  try {
    const ruleFile = path.join(dir, names[0]);
    const rule = fs.readFileSync(ruleFile, 'utf8')
      .replace(/## Current GA platform applicability\r?\n[\s\S]*?(?=## Authority and distinct decisions)/, '')
      .replace('on the required platforms: Windows and Linux for the current #1613 GA scope, with macOS Deferred / Not applicable. Historical/default three-platform procedures remain preserved and require explicit propagation as described above.', 'on Windows, Linux, and macOS.');
    assert.ok(!rule.includes('CURRENT_GA_PLATFORM_SCOPE.md'));
    assert.ok(!rule.includes('current #1613 GA scope'));
    fs.writeFileSync(ruleFile, rule);
    fs.rmSync(path.join(dir, scopeName));
    assert.equal(run(dir).status, 0);
    mutate(dir, names[0], 'on Windows, Linux, and macOS.', 'on Windows and Linux.');
    const result = run(dir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Historical published-package three-platform requirements missing/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a referenced current decision cannot disappear into historical fallback', () => {
  const dir = fixture();
  try {
    fs.rmSync(path.join(dir, scopeName));
    const result = run(dir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Current GA scope decision missing/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

for (const [field, before, after] of [
  ['Authority', '| Authority | release owner |', '| Authority | agent |'],
  ['Decision date', '| Decision date | 2026-10-04 |', '| Decision date | 2026-10-03 |'],
  ['Governing issue', '| Governing issue | #1613 |', '| Governing issue | #1151 |'],
  ['Required qualification platforms', '| Required qualification platforms | Windows, Linux |', '| Required qualification platforms | Windows |'],
  ['Required qualification platforms', '| Required qualification platforms | Windows, Linux |', '| Required qualification platforms | Windows, Linux, macOS |'],
  ['macOS applicability', '| macOS applicability | Deferred / Not applicable to this GA; never PASS |', '| macOS applicability | PASS |'],
]) {
  test(`current decision rejects inconsistent ${field}: ${after}`, () => {
    const dir = fixture();
    try {
      mutate(dir, scopeName, before, after);
      const result = run(dir);
      assert.equal(result.status, 1);
      assert.ok(result.stderr.includes(`Current GA decision field mismatch: ${field}`));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}

test('duplicate decision fields cannot override platform authority', () => {
  const dir = fixture();
  try {
    fs.appendFileSync(path.join(dir, scopeName), '\n| Required qualification platforms | Windows, Linux |\n');
    const result = run(dir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Duplicate current GA decision field: Required qualification platforms/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

for (const [name, before, after, diagnostic] of [
  [names[0], '../project/CURRENT_GA_PLATFORM_SCOPE.md', '../project/OTHER.md', 'Canonical current GA scope link missing'],
  [names[0], "owner's 2026-10-04 instruction excludes macOS", "agent's instruction excludes macOS", 'Current GA owner decision missing'],
  [names[0], 'Windows and Linux for the current #1613 GA scope, with macOS Deferred / Not applicable', 'Windows for the current #1613 GA scope, with macOS PASS', 'Current GA published-package platform requirements missing'],
  [scopeName, 'Windows and Linux must still prove every original Core, CLI, TUI, template, native and real operator requirement', 'Source builds suffice', 'Current GA native/operator/product requirements missing'],
  [scopeName, 'safe private evidence admission', 'unrestricted evidence', 'Current GA private evidence boundary missing'],
  [scopeName, 'exactly matching checksum-bound published CLI/TUI/Core bytes', 'approximately matching bytes', 'Current GA same-byte publication requirement missing'],
  [scopeName, 'protected provider controls', 'unprotected provider controls', 'Current GA supply-chain/publication requirements missing'],
  [scopeName, 'No missing or failed Windows/Linux gate becomes a pass', 'Missing Windows/Linux gates are waived', 'Current GA technical failure boundary missing'],
  [scopeName, 'Retain macOS implementation, support source, assets, contracts, failures and historical three-platform promises', 'Delete historical macOS contracts', 'Historical macOS contracts must be retained'],
  [scopeName, 'no automatic host deployment, changed provider settings, branch-protection bypass, skipped assertions, relaxed deadlines or altered gate algorithms is authorized', 'branch-protection bypass is authorized', 'Current GA protected authority boundary missing'],
  [names[0], "Publication also requires the owner's explicit instruction and the protected release environment", 'Publication is automatic', 'Protected publication authority missing'],
  [names[0], 'Technical failures remain blockers; risk acceptance must never relabel a missing or failed required technical gate as a pass', 'Risk acceptance converts technical failures to PASS', 'Technical failure boundary missing'],
  [names[0], 'immutable GitHub release assets with SHA-256 checksums', 'mutable release assets', 'Required evidence missing'],
]) {
  test(`current applicability preserves required boundary: ${diagnostic}`, () => {
    const dir = fixture();
    try {
      mutate(dir, name, before, after);
      const result = run(dir);
      assert.equal(result.status, 1);
      assert.ok(result.stderr.includes(diagnostic));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
