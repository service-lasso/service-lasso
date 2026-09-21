import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, access, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { postgresChildEnvironment } from '../examples/postgres-app/postgres-environment.mjs';

test('Linux PostgreSQL children use their owned artifact libraries without changing parent environment', () => {
  const env = Object.freeze({ PATH: '/usr/bin', LD_LIBRARY_PATH: '/ambient/lib', POSTGRES_PORT: '21261' });
  const result = postgresChildEnvironment('/owned folder/postgres/current', env, 'linux');
  assert.deepEqual(result, { ...env, LD_LIBRARY_PATH: '/owned folder/postgres/current/lib' });
  assert.equal(env.LD_LIBRARY_PATH, '/ambient/lib');
  assert.notEqual(result, env);
});

test('Linux PostgreSQL library lookup needs no ambient library path', () => {
  assert.deepEqual(postgresChildEnvironment('/owned/artifact', {}, 'linux'), { LD_LIBRARY_PATH: '/owned/artifact/lib' });
});

test('Windows and macOS preserve their existing child environment', () => {
  const env = Object.freeze({ PATH: 'existing path', LD_LIBRARY_PATH: 'existing libraries' });
  for (const platform of ['win32', 'darwin']) {
    const result = postgresChildEnvironment('owned artifact', env, platform);
    assert.deepEqual(result, env);
    assert.notEqual(result, env);
  }
});

test('Linux foreground launcher passes owned libraries to initdb and postgres, including restart', { skip: process.platform !== 'linux' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lasso-postgres-launcher-'));
  try {
    const artifact = path.join(root, 'artifact with spaces');
    const data = path.join(root, 'database');
    await mkdir(path.join(artifact, 'bin'), { recursive: true });
    for (const kind of ['initdb', 'postgres']) {
      await writeFile(path.join(artifact, 'bin', kind), `#!/usr/bin/env node\nconsole.log(JSON.stringify({ kind: '${kind}', library: process.env.LD_LIBRARY_PATH }));\n`, { mode: 0o700 });
    }
    const env = { ...process.env, SERVICE_ARTIFACT_ROOT: artifact, POSTGRES_DATA_DIR: data, POSTGRES_USER: 'fixture', POSTGRES_PASSWORD: 'disposable-fixture', POSTGRES_PORT: '23456', LD_LIBRARY_PATH: '/ambient/not-used' };
    const launch = () => spawnSync(process.execPath, [fileURLToPath(new URL('../examples/postgres-app/postgres-launch.mjs', import.meta.url))], { env, encoding: 'utf8' });
    const first = launch();
    assert.equal(first.status, 0, first.stderr);
    assert.deepEqual(first.stdout.trim().split('\n').map(line => JSON.parse(line)), ['initdb', 'postgres'].map(kind => ({ kind, library: path.join(artifact, 'lib') })));
    await assert.rejects(access(path.join(root, 'tutorial-init.password')), { code: 'ENOENT' });
    await mkdir(data);
    await writeFile(path.join(data, 'PG_VERSION'), '15');
    const restart = launch();
    assert.equal(restart.status, 0, restart.stderr);
    assert.deepEqual(JSON.parse(restart.stdout), { kind: 'postgres', library: path.join(artifact, 'lib') });
    assert.equal(env.LD_LIBRARY_PATH, '/ambient/not-used');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
