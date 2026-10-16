import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Closed actual-tool adversaries. These are fixed trusted witness mutations,
// never supplied target source, an executable selector or a denial issuer.
const cases = Object.freeze([
  ['bootstrap_setup', 'bootstrap_setup'],
  ['missing_witness', 'witness_invocation'], ['invalid_witness', 'witness_invocation'],
  ['missing_exit', 'witness_exit'], ['unexpected_exit', 'witness_exit'],
  ['source_read', 'source_read', '[Console]::OpenStandardInput()', '[IO.File]::OpenRead([IO.Path]::Combine($PSScriptRoot,\'absent-input\'))'],
  ['source_decode', 'source_decode', '$text=$utf8.GetString($raw.ToArray())', '$text=$utf8.MissingGetString($raw.ToArray())'],
  ['source_frame', 'source_frame', '$inputDoc=[Text.Json.JsonDocument]::Parse($text)', '$inputDoc=[Text.Json.JsonDocument]::MissingParse($text)'],
  ['source_integrity', 'source_integrity', '[Security.Cryptography.SHA256]::HashData($bytes)', '[Security.Cryptography.SHA256]::MissingHashData($bytes)'],
  ['missing_catalogue', 'catalogue_read'], ['invalid_catalogue', 'catalogue_decode'], ['wrong_catalogue_schema', 'catalogue_shape'],
  ['target_parse', 'target_parse', '[Parser]::ParseInput($source,$file,[ref]$tokens,[ref]$errors)', '[Parser]::MissingParseInput($source,$file,[ref]$tokens,[ref]$errors)'],
  ['semantic_match', 'semantic_match', 'Body $ast $catalogue.body', 'MissingFixedBody $ast $catalogue.body'],
  ['response_encode', 'response_encode', '$output=$utf8.GetBytes($response)', '$output=$utf8.MissingGetBytes($response)'],
  ['response_open', 'response_open', '$stream=[Console]::OpenStandardOutput()', '$stream=[Console]::MissingOpenStandardOutput()'],
  ['response_write', 'response_write', '$stream.Write($output,0,$output.Length)', '$stream.MissingWrite($output,0,$output.Length)'],
  // The original result was already written: this must fail as a mixed frame,
  // not be reported as a clean single negative observation.
  ['response_flush_mixed', undefined, '$stream.Flush()', '$stream.MissingFlush()'],
].map(row => Object.freeze(row)));
export const F25_INFRASTRUCTURE_CASES = Object.freeze(cases.map(([name, operation]) => Object.freeze({ name, operation })));

export async function prepareF25InfrastructureFixture(root, name) {
  const row = cases.find(candidate => candidate[0] === name);
  if (!row) throw new Error('Unknown fixed F25 infrastructure fixture.');
  let bootstrap = await readFile(new URL('./core1562-powershell-retention-bootstrap.ps1', import.meta.url));
  let witness = await readFile(new URL('./core1562-powershell-retention-ast.ps1', import.meta.url), 'utf8');
  let catalogue = await readFile(new URL('./core1562-f25-semantic-roles.json', import.meta.url));
  if (name === 'bootstrap_setup') {
    const text = bootstrap.toString('utf8'), marker = '[IO.Path]::Combine';
    if (text.split(marker).length !== 2) throw new Error('Fixed bootstrap setup site is not unique.');
    bootstrap = Buffer.from(text.replace(marker, '[IO.Path]::MissingCombine'));
  }
  if (row[2]) {
    if (witness.split(row[2]).length !== 2) throw new Error('Fixed F25 fixture work site is not unique.');
    witness = witness.replace(row[2], row[3]);
  }
  if (name === 'invalid_witness') witness = 'function FixedBroken {\n';
  if (name === 'missing_exit') witness = '# Fixed witness with no explicit exit.\n';
  if (name === 'unexpected_exit') witness = 'exit 7\n';
  if (name === 'invalid_catalogue') catalogue = Buffer.from('{');
  if (name === 'wrong_catalogue_schema') {
    const text = catalogue.toString('utf8'), marker = 'core1562.f25.semantic-roles.v1';
    if (text.split(marker).length !== 2) throw new Error('Fixed catalogue schema site is not unique.');
    catalogue = Buffer.from(text.replace(marker, 'core1562.f25.semantic-roles.invalid'));
  }
  const files = [['core1562-powershell-retention-bootstrap.ps1', bootstrap]];
  if (name !== 'missing_witness') files.push(['core1562-powershell-retention-ast.ps1', Buffer.from(witness)]);
  if (name !== 'missing_catalogue') files.push(['core1562-f25-semantic-roles.json', catalogue]);
  for (const [leaf, bytes] of files) {
    const destination = path.join(root, leaf);
    await writeFile(destination, bytes, { flag: 'wx', mode: 0o600 });
    const readback = await readFile(destination);
    if (!readback.equals(bytes)) throw new Error('Fixed F25 fixture readback failed.');
  }
  return path.join(root, 'core1562-powershell-retention-bootstrap.ps1');
}
