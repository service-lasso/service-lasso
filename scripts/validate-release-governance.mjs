#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.RELEASE_GOVERNANCE_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const files = {
  rule: '.governance/rules/gov-09-release-authority.mdc',
  trace: '.governance/project/RELEASE_TRACEABILITY.md',
  intent: '.governance/project/PROJECT_INTENT.md',
  spec: '.governance/specs/SPEC-007-secrets-capability-ledger.md',
  agents: 'AGENTS.md',
};
const errors = [];
for (const [key, file] of Object.entries(files)) {
  if (!fs.existsSync(path.join(root, file))) errors.push(`Missing ${file}`);
  else files[key] = read(file);
}
if (errors.length === 0) {
  const requireText = (value, re, label) => { if (!re.test(value)) errors.push(label); };
  const rule = files.rule, trace = files.trace;
  requireText(rule, /\.governance\/.*source of truth/i, 'Canonical release governance source missing');
  requireText(rule, /project owner\/release owner alone accepts residual risk, declares GA, and authorizes promotion or deployment/i, 'Sole release authority missing');
  requireText(rule, /Technically Ready for GA/, 'Technical readiness status missing');
  requireText(rule, /independent reviewer is optional unless the release owner explicitly makes independent review mandatory[^\n]*names the reviewer/i, 'Optional named-reviewer boundary missing');
  requireText(rule, /deferred independent review never blocks technical readiness or GA/i, 'Deferred review must not block GA');
  requireText(rule, /GitHub release tag, full 40-character commit SHA, published package version, and qualification evidence/i, 'Exact candidate fields missing');
  requireText(rule, /yyyy\.m\.d-<7-character-lowercase-git-sha>/, 'Version convention missing');
  requireText(rule, /GitHub tag, release name, npm package version, and version portion of every artifact filename must be identical/i, 'Shared version identity missing');
  for (const re of [/terminal Release Qualification/i, /immutable GitHub release assets with SHA-256 checksums/i, /publication identity verification/i])
    requireText(rule, re, `Required evidence missing: ${re}`);
  // AC-7F: a linked owner decision changes documentation applicability, never
  // qualification outcomes. Without one, the historical three-OS contract holds.
  const scopeName = '.governance/project/CURRENT_GA_PLATFORM_SCOPE.md';
  const scopePresent = fs.existsSync(path.join(root, scopeName));
  const currentDecision = /CURRENT_GA_PLATFORM_SCOPE\.md|Current GA platform applicability|current #1613 GA scope/i.test(rule);
  if (scopePresent || currentDecision) {
    if (!scopePresent) errors.push('Current GA scope decision missing');
    else {
      const scope = read(scopeName);
      const fields = new Map();
      for (const line of scope.split(/\r?\n/)) {
        const row = /^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/.exec(line);
        if (!row || row[1] === 'Decision field' || /^[- ]+$/.test(row[1])) continue;
        if (fields.has(row[1])) errors.push(`Duplicate current GA decision field: ${row[1]}`);
        fields.set(row[1], row[2]);
      }
      for (const [field, expected] of Object.entries({
        Authority: 'release owner',
        'Decision date': '2026-10-04',
        'Governing issue': '#1613',
        'Required qualification platforms': 'Windows, Linux',
        'macOS applicability': 'Deferred / Not applicable to this GA; never PASS',
      })) {
        if (fields.get(field) !== expected) errors.push(`Current GA decision field mismatch: ${field}`);
      }
      requireText(rule, /\[Current GA platform scope\]\(\.\.\/project\/CURRENT_GA_PLATFORM_SCOPE\.md\)/, 'Canonical current GA scope link missing');
      requireText(rule, /owner's 2026-10-04 instruction excludes macOS/, 'Current GA owner decision missing');
      requireText(rule, /published package[^\n]*Windows and Linux for the current #1613 GA scope, with macOS Deferred \/ Not applicable/i, 'Current GA published-package platform requirements missing');
      requireText(scope, /Windows and Linux must still prove every original Core, CLI, TUI, template, native and real operator requirement/, 'Current GA native/operator/product requirements missing');
      requireText(scope, /safe private evidence admission/, 'Current GA private evidence boundary missing');
      requireText(scope, /exactly matching checksum-bound published CLI\/TUI\/Core bytes/, 'Current GA same-byte publication requirement missing');
      requireText(scope, /Secure publication, immutable candidate identities, signatures\/provenance\/SBOMs, zero-known-vulnerability checks, asset inventory, protected provider controls, published npm identity and published-package native qualification remain required/, 'Current GA supply-chain/publication requirements missing');
      requireText(scope, /No missing or failed Windows\/Linux gate becomes a pass/, 'Current GA technical failure boundary missing');
      requireText(scope, /Retain macOS implementation, support source, assets, contracts, failures and historical three-platform promises/, 'Historical macOS contracts must be retained');
      requireText(scope, /no automatic host deployment, changed provider settings, branch-protection bypass, skipped assertions, relaxed deadlines or altered gate algorithms is authorized/i, 'Current GA protected authority boundary missing');
    }
  } else {
    requireText(rule, /published package.*Windows, Linux, and macOS/i, 'Historical published-package three-platform requirements missing');
  }
  requireText(rule, /Publication also requires the owner's explicit instruction and the protected release environment/i, 'Protected publication authority missing');
  requireText(rule, /Technical failures remain blockers; risk acceptance must never relabel a missing or failed required technical gate as a pass/i, 'Technical failure boundary missing');
  for (const term of ['blocking defect', 'accepted residual risk', 'deferred follow-up', 'not applicable'])
    requireText(rule, new RegExp(term, 'i'), `Investigation classification missing: ${term}`);
  for (const file of ['docs/release-asset-policy.md', '.github/workflows/release-qualification.yml', '.github/workflows/published-package-qualification.yml', 'docs/reference/release-1-ga-decision.md'])
    requireText(rule + trace, new RegExp(file.split('/').at(-1).replaceAll('.', '\\.'), 'i'), `Unlinked release procedure: ${file}`);
  requireText(files.agents, /gov-09-release-authority\.mdc/, 'Agent bootstrap omits release rule');
  requireText(files.intent, /gov-09-release-authority\.mdc/, 'Project intent omits release rule');
  requireText(files.spec, /gov-09-release-authority\.mdc/, 'SPEC-007 omits release rule');
  for (const [name, text] of Object.entries(files)) {
    if (/never declare GA|GA blocked: external security approval outstanding|requires? a named independent reviewer|fail-closed on independent security review/i.test(text))
      errors.push(`Contradictory release authority in ${name}`);
  }
}
if (errors.length) { for (const error of errors) console.error(error); process.exitCode = 1; }
else console.log('Release governance authority and exact-candidate contract validated');
