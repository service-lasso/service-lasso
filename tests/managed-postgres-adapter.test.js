import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../examples/postgres-app/configure-managed-service.mjs', import.meta.url));
const create = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lasso-managed-pg-'));
  const manifest = { id: 'postgres', artifact: { source: { repo: 'service-lasso/lasso-postgres', channel: 'latest' }, platforms: { win32: { command: './bin/pg_ctl.exe' } } }, env: {}, ports: {} };
  await writeFile(path.join(root, 'service.json'), JSON.stringify(manifest));
  const run = async () => {
    const child = spawn(process.execPath, [script, root], { stdio: 'ignore', windowsHide: true });
    return (await once(child, 'close'))[0];
  };
  return { root, manifest, run };
};

test('explicit PostgreSQL adapter pins the imported provider, retains data and refuses duplicate replacement', async () => {
  const { root, run } = await create();
  try {
    await mkdir(path.join(root, 'data')); await writeFile(path.join(root, 'data', 'retained.txt'), 'keep');
    assert.equal(await run(), 0);
    const manifest = JSON.parse(await readFile(path.join(root, 'service.json'), 'utf8'));
    assert.equal(manifest.artifact.source.tag, '2026.5.3-ddd9e47');
    assert.equal(manifest.execservice, '@node');
    assert.equal(manifest.artifact.platforms.win32.command, './bin/pg_ctl.exe');
    assert.equal(await readFile(path.join(root, 'data', 'retained.txt'), 'utf8'), 'keep');
    const launcher = await readFile(path.join(root, 'tutorial-runtime', 'postgres-launch.mjs'), 'utf8');
    assert.notEqual(await run(), 0);
    assert.equal(await readFile(path.join(root, 'tutorial-runtime', 'postgres-launch.mjs'), 'utf8'), launcher);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('adapter refuses a running managed service before changing its manifest or files', async () => {
  const { root, manifest, run } = await create();
  try {
    await mkdir(path.join(root, '.state'));
    await writeFile(path.join(root, '.state', 'runtime.json'), JSON.stringify({ running: true, pid: process.pid }));
    assert.notEqual(await run(), 0);
    assert.deepEqual(JSON.parse(await readFile(path.join(root, 'service.json'), 'utf8')), manifest);
    await assert.rejects(access(path.join(root, 'tutorial-runtime')));
  } finally { await rm(root, { recursive: true, force: true }); }
});
