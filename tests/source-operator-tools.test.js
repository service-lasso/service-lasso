import assert from 'node:assert/strict';
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { buildEnvironment, main, prepareTool, run, sourceClientInvocation, sourceTools } from '../scripts/source-operator-tools.mjs';

// SPEC-002 AC-4CG.1977: source convenience cannot weaken release admission.
test('source pins are fixed reviewed official source identities', async () => {
  assert.deepEqual(sourceTools, {
    cli: { url: 'https://github.com/service-lasso/service-lasso-cli.git', commit: 'b6383e1b125bdf1626ce380f9a36ffdd8bc001ae' },
  });
  assert.ok(Object.isFrozen(sourceTools.cli));
  await assert.rejects(prepareTool('https://example.invalid/tool'), /Choose cli/);
  await assert.rejects(main(['setup', 'unexpected']), /Usage/);
});

test('child argv remains literal, including shell syntax and whitespace', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'source-operator-argv-'));
  try {
    const args = ['$(touch SHOULD_NOT_EXIST)', '`touch OTHER_FILE`', '; exit 91', 'with spaces', '"quoted"'];
    const output = await run(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', ...args], cwd, { capture: true });
    assert.deepEqual(JSON.parse(output), args);
    await assert.rejects(readFile(path.join(cwd, 'SHOULD_NOT_EXIST')), { code: 'ENOENT' });
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test('missing prerequisite and failed child produce safe failures with real exit status', async () => {
  await assert.rejects(run('service-lasso-nonexistent-test-executable', [], process.cwd()), /Install the documented prerequisite/);
  await assert.rejects(run(process.execPath, ['-e', 'process.exit(23)'], process.cwd(), { capture: true }), error => error.exitCode === 23 && /exit 23/.test(error.message));
});


test('first-use acquisition failure cleans only its own staging and unlocks retry', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'source-operator-failure-'));
  try {
    await mkdir(path.join(cwd, 'scripts'));
    await copyFile(new URL('../scripts/source-operator-tools.mjs', import.meta.url), path.join(cwd, 'scripts/source-operator-tools.mjs'));
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = spawnSync(process.execPath, ['scripts/source-operator-tools.mjs', 'cli', 'status'], {
        cwd, encoding: 'utf8', env: { ...process.env, PATH: path.join(cwd, 'missing-prerequisites') },
      });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Cannot run git/);
      assert.doesNotMatch(result.stderr, /Another cli setup/);
      assert.deepEqual(await readdir(path.join(cwd, '.operator-tools')), []);
    }
  } finally { await rm(cwd, { recursive: true, force: true }); }
});


test('acquisition and builds receive no Core or client credentials; launch retains inherited env', async () => {
  const environment = { PATH: '/tools', SERVICE_LASSO_LOCAL_ADMIN_TOKEN: 'private', SERVICE_LASSO_API_TOKEN: 'private', service_lasso_cli_local_admin_token: 'private', GOPATH: '/go' };
  const sanitized = buildEnvironment(environment);
  assert.deepEqual(sanitized, { PATH: '/tools', GOPATH: '/go' });
  const output = await run(process.execPath, ['-e', 'process.stdout.write(process.env.SERVICE_LASSO_API_TOKEN)'], process.cwd(), { capture: true, env: environment });
  assert.equal(output, 'private');
  assert.equal(environment.SERVICE_LASSO_API_TOKEN, 'private');
});


test('acquired wrong source identity fails before checkout or build', { skip: process.platform === 'win32' }, async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'source-operator-pin-'));
  try {
    await mkdir(path.join(cwd, 'scripts'));
    await mkdir(path.join(cwd, 'bin'));
    await copyFile(new URL('../scripts/source-operator-tools.mjs', import.meta.url), path.join(cwd, 'scripts/source-operator-tools.mjs'));
    const fakeGit = path.join(cwd, 'bin/git');
    await writeFile(fakeGit, '#!' + process.execPath + '\n' + `
      if (Object.keys(process.env).some(k => k.startsWith('SERVICE_LASSO_'))) process.exit(81);
      if (process.argv.includes('rev-parse')) process.stdout.write('0000000000000000000000000000000000000000');
      if (process.argv.includes('checkout')) process.exit(82);
    `);
    await chmod(fakeGit, 0o700);
    const result = spawnSync(process.execPath, ['scripts/source-operator-tools.mjs', 'cli', 'status'], {
      cwd, encoding: 'utf8', env: { ...process.env, PATH: path.join(cwd, 'bin'), SERVICE_LASSO_API_TOKEN: 'do-not-inherit' },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /source commit mismatch/);
    assert.doesNotMatch(result.stderr, /do-not-inherit|exit 81|exit 82/);
    assert.deepEqual(await readdir(path.join(cwd, '.operator-tools')), []);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});


test('checkout clients use the owned origin and preserve explicit connection selection', async () => {
  const local = 'http://127.0.0.1:48083';
  const selected = async () => local;
  const skip = async () => assert.fail('explicit and offline commands do not inspect the local workspace');
  assert.deepEqual(await sourceClientInvocation('cli', ['instance', 'status'], {}, selected), {
    args: ['instance', 'status'], env: { SERVICE_LASSO_CORE_URL: local },
  });
  for (const [name, args, env] of [
    ['cli', ['operator', 'services'], { SERVICE_LASSO_CONNECTION: 'ops' }],
    ['cli', ['--connection=ops', 'instance', 'status'], {}],
    ['cli', ['service', 'init', 'example', '--dry-run'], {}],
    ['cli', ['config', 'path'], {}],
  ]) {
    assert.deepEqual(await sourceClientInvocation(name, args, env, skip), {args, env});
  }
});

test('checkout clients never fall back to the default port after workspace lookup', async () => {
  const missing = async () => null;
  await assert.rejects(sourceClientInvocation('cli', ['instance', 'status'], {}, missing), /No running Core found for this checkout/);
  const failed = async () => { throw new Error('private workspace details'); };
  await assert.rejects(sourceClientInvocation('cli', ['instance', 'status'], {}, failed), (error) =>
    error.message.includes('Cannot verify the running Core') && !error.message.includes('private workspace details'));
});
