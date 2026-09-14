import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targetArg = process.argv.find(arg => arg.startsWith('--target='));
if (!targetArg) throw new Error('Usage: node scripts/export-admin-help.mjs --target=/path/to/admin [--check]');
const target = path.resolve(targetArg.slice(9));
const packageJson = JSON.parse(await readFile(path.join(target, 'package.json'), 'utf8'));
if (packageJson.name !== '@service-lasso/service-admin') throw new Error('Target must be a Service Admin checkout.');
const inventory = JSON.parse(await readFile(path.join(root, 'docs/components/documentation-inventory.json'), 'utf8'));
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const files = [];
for (const item of inventory.filter(item => item.repo === 'lasso-serviceadmin' && item.target && item.source.startsWith('docs/help/'))) {
  if (!/^docs\/help\/[a-z0-9-]+\.md$/.test(item.source) || !/^docs\/(components\/service-admin|operator-ui)\/[a-z0-9-]+\.md$/.test(item.target)) throw new Error('Unexpected help inventory path.');
  const canonical = (await readFile(path.join(root, item.target), 'utf8')).replace(/\r\n/g, '\n');
  // Offline article content remains bundled; relative links resolve to canonical docs.
  const content = canonical.replace(/\]\((?!https?:|#|mailto:)([^)]+)\)/g, (_, link) => {
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(item.target), link));
    return `](https://github.com/service-lasso/service-lasso/blob/develop/${resolved})`;
  });
  const output = `${content.trimEnd()}\n\n<!-- Generated from service-lasso/${item.target}. Edit the canonical page, then export. -->\n`;
  const destination = path.join(target, item.source);
  if (process.argv.includes('--check')) {
    if (await readFile(destination, 'utf8') !== output) throw new Error(`Packaged help differs: ${item.source}`);
  } else {
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, output);
  }
  files.push({ source: item.target, destination: item.source, sha256: createHash('sha256').update(output).digest('hex') });
}
if (!process.argv.includes('--check')) await writeFile(path.join(target, 'docs/help-source.json'), JSON.stringify({ repository: 'service-lasso/service-lasso', revision, files }, null, 2) + '\n');
console.log(`${process.argv.includes('--check') ? 'Verified' : 'Exported'} ${files.length} canonical Help Center articles.`);
