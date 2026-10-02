import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

const repositoryRoot = new URL('..', import.meta.url).pathname.slice(1);
const scriptPath = join(repositoryRoot, 'scripts', 'cancel-github-actions-runs.ps1');

function runPowerShell(args, env) {
  return spawnSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', scriptPath,
    ...args
  ], {
    encoding: 'utf8',
    env
  });
}

async function createGhMock() {
  const directory = await mkdtemp(join(tmpdir(), 'lasso-cancel-actions-'));
  const commandPath = join(directory, 'gh.cmd');
  const callLog = join(directory, 'gh-calls.log');
  await writeFile(callLog, '');
  await writeFile(commandPath, `@echo off\r\nsetlocal\r\nif /I "%1"=="auth" if /I "%2"=="status" exit /b 0\r\nif /I "%1"=="api" (echo [{"workflow_runs":[{"id":101,"status":"queued","name":"CI","display_title":"queued test","head_branch":"develop","created_at":"2026-10-02T00:00:00Z","html_url":"https://example.test/runs/101"}]}] & exit /b 0)\r\nif /I "%1"=="run" if /I "%2"=="cancel" if "%3"=="101" (echo run cancel 101 --repo %5 --force>>"%GH_CALL_LOG%" & exit /b 0)\r\necho unexpected gh invocation 1>&2\r\nexit /b 1\r\n`);
  return { callLog, directory };
}

test('bulk cancellation script stays read-only until execute mode is explicitly confirmed', async () => {
  const { callLog, directory } = await createGhMock();
  const env = {
    ...process.env,
    PATH: `${directory};${process.env.PATH}`,
    GH_CALL_LOG: callLog
  };

  try {
    const dryRun = runPowerShell([], env);
    assert.equal(dryRun.status, 0, dryRun.stderr);
    assert.match(dryRun.stdout, /Dry run only: no workflow run was cancelled\./);
    assert.equal(await readFile(callLog, 'utf8'), '');

    const rejected = runPowerShell(['-Execute', '-Confirmation', 'wrong value'], env);
    assert.notEqual(rejected.status, 0);
    assert.match(`${rejected.stdout}${rejected.stderr}`, /Cancellation was not requested/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('bulk cancellation script sends a force-cancel request only after exact confirmation', async () => {
  const { callLog, directory } = await createGhMock();
  const env = {
    ...process.env,
    PATH: `${directory};${process.env.PATH}`,
    GH_CALL_LOG: callLog
  };

  try {
    const result = runPowerShell([
      '-Execute',
      '-Confirmation',
      'CANCEL service-lasso/service-lasso'
    ], env);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Requested force cancellation for 1 active GitHub Actions run/);
    assert.match(await readFile(callLog, 'utf8'), /run cancel 101 --repo service-lasso\/service-lasso --force/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
