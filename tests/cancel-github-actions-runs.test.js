import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const scriptPath = join(repositoryRoot, 'scripts', 'cancel-github-actions-runs.ps1');

function runPowerShell(args, env) {
  return spawnSync(process.platform === 'win32' ? 'powershell.exe' : 'pwsh', [
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
  const commandPath = join(directory, process.platform === 'win32' ? 'gh.cmd' : 'gh');
  const callLog = join(directory, 'gh-calls.log');
  await writeFile(callLog, '');
  await writeFile(commandPath, `@echo off\r\nsetlocal\r\nif /I "%1"=="auth" if /I "%2"=="status" exit /b 0\r\nif /I "%1"=="api" (echo [{"workflow_runs":[{"id":101,"status":"queued","name":"CI","display_title":"queued test","head_branch":"develop","created_at":"2026-10-02T00:00:00Z","html_url":"https://example.test/runs/101"}]}] & exit /b 0)\r\nif /I "%1"=="run" if /I "%2"=="cancel" if "%3"=="101" if "%4"=="--repo" if "%5"=="service-lasso/service-lasso" if "%6"=="--force" if "%7"=="" (echo run cancel 101 --repo %5 --force>>"%GH_CALL_LOG%" & exit /b 0)\r\necho unexpected gh invocation 1>&2\r\nexit /b 1\r\n`);
  if (process.platform !== 'win32') {
    await writeFile(commandPath, `#!/bin/sh
if [ "$1" = auth ] && [ "$2" = status ]; then exit 0; fi
if [ "$1" = api ]; then printf '%s\\n' '[{"workflow_runs":[{"id":101,"status":"queued","name":"CI","display_title":"queued test","head_branch":"develop","created_at":"2026-10-02T00:00:00Z","html_url":"https://example.test/runs/101"}]}]'; exit 0; fi
if [ "$1" = run ] && [ "$2" = cancel ] && [ "$3" = 101 ] && [ "$4" = --repo ] && [ "$5" = service-lasso/service-lasso ] && [ "$6" = --force ] && [ "$#" = 6 ]; then printf '%s\\n' 'run cancel 101 --repo service-lasso/service-lasso --force' >> "$GH_CALL_LOG"; exit 0; fi
printf '%s\\n' 'unexpected gh invocation' >&2
exit 1
`);
    await chmod(commandPath, 0o700);
  }
  return { callLog, directory };
}

function mockEnvironment(directory, callLog) {
  // Windows treats environment names case-insensitively; avoid inherited Path
  // winning over a second PATH key and accidentally selecting the real gh.
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toLowerCase() !== 'path'));
  const inheritedPath = Object.entries(process.env).find(([name]) => name.toLowerCase() === 'path')?.[1] ?? '';
  return { ...env, PATH: `${directory}${delimiter}${inheritedPath}`, GH_CALL_LOG: callLog };
}

test('bulk cancellation script stays read-only until execute mode is explicitly confirmed', async () => {
  const { callLog, directory } = await createGhMock();
  const env = mockEnvironment(directory, callLog);

  try {
    const dryRun = runPowerShell([], env);
    assert.equal(dryRun.error, undefined);
    assert.equal(dryRun.status, 0, dryRun.stderr);
    assert.match(dryRun.stdout, /Dry run only: no workflow run was cancelled\./);
    assert.equal(await readFile(callLog, 'utf8'), '');

    const rejected = runPowerShell(['-Execute', '-Confirmation', 'wrong value'], env);
    assert.equal(rejected.error, undefined);
    assert.notEqual(rejected.status, 0);
    assert.match(`${rejected.stdout}${rejected.stderr}`, /Cancellation was not requested/);
    assert.equal(await readFile(callLog, 'utf8'), '');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('bulk cancellation script sends a force-cancel request only after exact confirmation', async () => {
  const { callLog, directory } = await createGhMock();
  const env = mockEnvironment(directory, callLog);

  try {
    const result = runPowerShell([
      '-Execute',
      '-Confirmation',
      'CANCEL service-lasso/service-lasso'
    ], env);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Requested force cancellation for 1 active GitHub Actions run/);
    assert.match(await readFile(callLog, 'utf8'), /run cancel 101 --repo service-lasso\/service-lasso --force/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
