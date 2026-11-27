import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { buildEnvironment, main, prepareTool, run, sourceTools } from '../scripts/source-operator-tools.mjs';

// SPEC-002 AC-4CG.1977: source convenience cannot weaken release admission.
test('source pins are fixed reviewed official source identities', async () => {
  assert.deepEqual(sourceTools, {
    cli: { url: 'https://github.com/service-lasso/service-lasso-cli.git', commit: 'b6383e1b125bdf1626ce380f9a36ffdd8bc001ae' },
    tui: { url: 'https://github.com/service-lasso/service-lasso-tui.git', commit: 'dcce6f29e6d5ce313055cc5e9267d32588d27450' },
  });
  assert.ok(Object.isFrozen(sourceTools.cli));
  await assert.rejects(prepareTool('https://example.invalid/tool'), /Choose cli or tui/);
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
