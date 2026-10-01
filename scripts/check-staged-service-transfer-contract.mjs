import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.STAGED_TRANSFER_CONTRACT_ROOT
  ? path.resolve(process.env.STAGED_TRANSFER_CONTRACT_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const spec = read('.governance/specs/SPEC-002-core-standalone-runtime.md');
const contract = read('docs/api/staged-service-transfer.md');

function section(source, heading) {
  const start = source.indexOf(heading);
  if (start === -1) throw new Error(`Missing contract section: ${heading}`);
  const end = source.indexOf('\n## ', start + heading.length);
  return source.slice(start, end === -1 ? undefined : end);
}

function requireMatch(source, expression, description) {
  if (!expression.test(source)) throw new Error(`Staged-transfer contract mismatch: ${description}`);
}

const acceptance = section(spec, '  - `AC-4CH.2`');
const archiveProfile = section(contract, '## Versioned archive parser profile and TAR qualification gate');
const paxStart = contract.indexOf('* A POSIX `x` record');
const paxEnd = contract.indexOf('\nThese rules admit ordinary USTAR members', paxStart);
if (paxStart === -1 || paxEnd === -1) {
  throw new Error('Missing POSIX PAX rules in staged-transfer contract');
}
const paxRules = contract.slice(paxStart, paxEnd);

requireMatch(
  acceptance,
  /PAX `size` is accepted only when exactly equal to the following strict-octal regular header size; it cannot become a second framing authority/i,
  'SPEC-002 AC-4CH.2 must retain PAX equality and single framing authority',
);
requireMatch(
  archiveProfile,
  /PAX\n+`size` is accepted only as an equal redundant declaration, never as a second\n+physical framing authority\. The parser consumes exactly `headerSize`/i,
  'archive profile must frame regular members from headerSize alone',
);
requireMatch(
  paxRules,
  /`size` is ASCII decimal, at most 134,217,728, and is accepted\n+  only when equal to the following regular-file `headerSize`/i,
  'PAX size must remain equality-only',
);
requireMatch(
  paxRules,
  /A PAX record with no `path` is allowed only for an\n+  otherwise ordinary member; its `size` remains an equal redundant declaration\n+  only and never controls that member's framing, accounting, or padding/i,
  'no-path PAX size must remain non-authoritative for framing, accounting, and padding',
);

console.log('Staged-transfer PAX framing contract is consistent with SPEC-002 AC-4CH.2.');

