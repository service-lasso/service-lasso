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
  for (const re of [/terminal Release Qualification/i, /immutable GitHub release assets with SHA-256 checksums/i, /publication identity verification/i, /published package.*Windows, Linux, and macOS/i])
    requireText(rule, re, `Required evidence missing: ${re}`);
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
