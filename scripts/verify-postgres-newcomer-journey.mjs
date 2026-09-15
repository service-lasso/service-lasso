import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm, writeFile, cp, mkdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// SPEC-002 AC-4AJ.4 / #1280: qualify the documented locked consumer, not HEAD Core.
const root = process.cwd();
// Windows TEMP can use an 8.3 alias. Core deliberately rejects executable paths
// whose canonical identity differs, so prepare the consumer at its real path.
const temporaryRoot = await realpath(tmpdir());
const runRoot = await mkdtemp(path.join(temporaryRoot, 'service-lasso-postgres-journey-'));
const packaged = path.join(runRoot, 'package');
const servicesRoot = path.join(packaged, 'workspace', 'services');
const workspaceRoot = path.join(packaged, 'workspace', 'state');
const serviceRoot = path.join(servicesRoot, 'postgres');
const manifestPath = path.join(serviceRoot, 'service.json');
const evidencePath = path.resolve(process.env.POSTGRES_JOURNEY_EVIDENCE ?? 'artifacts/postgres-journey.json');
const env = { ...process.env,
  SERVICE_LASSO_INSTANCE_REGISTRY_PATH: path.join(runRoot, 'instances.json'),
  SERVICE_LASSO_HOST_PORT_REGISTRY_PATH: path.join(runRoot, 'ports.json'),
};
const release = '2026.5.3-ddd9e47';
const archiveDigests = {
  win32: ['lasso-postgres-15.17-win32.zip', '6f30eca488d26bc40f1ec9f3f8add237cc3774c31264e8c52a299f87d3372fdb'],
  linux: ['lasso-postgres-15.17-linux.tar.gz', '0fb496d797fb6a097411c5a23d4e859fafe802caa594caa6d8d4a3a1f4258584'],
  darwin: ['lasso-postgres-15.17-darwin.tar.gz', '5f928aba446b3f6990d683162eb459b5f9d532e61d6f60f0c48a42fa5275d689'],
};
const npmCommand = process.platform === 'win32' ? process.execPath : 'npm';
const npmPrefix = process.platform === 'win32'
  ? [path.join(path.dirname(execFileSync('where.exe', ['npm.cmd'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0]), 'node_modules', 'npm', 'bin', 'npm-cli.js')]
  : [];
const evidence = { schema: 'service-lasso.postgres-newcomer-journey.v2', outcome: 'failure',
  sourceSha: process.env.POSTGRES_JOURNEY_SOURCE_SHA ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  node: process.version, platform: process.platform, arch: process.arch,
  runtimeLane: 'documented-published-lockfile', outcomes: {},
};
let app, instance, failure, databasePort;
let commandExitUnconfirmed = false;
let appLog = '';
const ownedPids = new Set();
const digest = value => createHash('sha256').update(value).digest('hex');
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const samePath = (a, b) => process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);
function alive(pid) { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } }
async function command(executable, args, cwd = packaged, timeout = 300_000) {
  return new Promise((resolve, reject) => {
    let output = '';
    const child = spawn(executable, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      // Killing a wrapper does not prove descendant exit. Retain the entire
      // workspace and never claim cleanup convergence after this timeout.
      commandExitUnconfirmed = true;
      child.kill(); reject(new Error(`Command timeout: ${path.basename(executable)}`));
    }, timeout);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output = (output + chunk).slice(-128_000); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); code === 0 ? resolve(output) : reject(new Error(`Command failed (${code}): ${path.basename(executable)}\n${output.slice(-8000)}`)); });
  });
}
const npm = (args, cwd) => command(npmCommand, [...npmPrefix, ...args], cwd);
async function portFree(port) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}
async function until(check, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  let last;
  do { try { return await check(); } catch (error) { last = error; await delay(300); } } while (Date.now() < deadline);
  throw last;
}
async function ownedInstance() {
  assert(app && app.exitCode === null && app.signalCode === null, 'Owned app exited before identity verification');
  const response = await fetch('http://127.0.0.1:18550/api/runtime/instance', { signal: AbortSignal.timeout(2000) });
  assert(response.ok);
  const current = (await response.json()).instance;
  assert(current && samePath(current.servicesRoot, servicesRoot) && samePath(current.workspaceRoot, workspaceRoot), 'Runtime belongs to a different workspace');
  assert(Number.isInteger(current.pid) && current.pid > 0 && alive(current.pid));
  if (instance) {
    assert.equal(current.generationId, instance.generationId, 'Runtime generation changed');
    assert.equal(current.pid, instance.pid, 'Runtime process changed');
  } else {
    // app.mjs spawns the Core CLI: the API PID must be its direct child,
    // not app.pid itself or an unrelated server returning the same paths.
    let parentPid;
    if (process.platform === 'linux') {
      const statText = await readFile(`/proc/${current.pid}/stat`, 'utf8');
      parentPid = Number(statText.slice(statText.lastIndexOf(')') + 2).split(/\s+/)[1]);
    } else if (process.platform === 'darwin') {
      parentPid = Number((await command('ps', ['-o', 'ppid=', '-p', String(current.pid)], packaged, 15_000)).trim());
    } else {
      const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      parentPid = Number((await command(powershell, ['-NoProfile', '-NonInteractive', '-Command',
        `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${current.pid}').ParentProcessId`], packaged, 15_000)).trim());
    }
    assert.equal(parentPid, app.pid, 'Runtime is not a child of the owned app');
  }
  const local = await json(path.join(workspaceRoot, '.service-lasso', 'runtime-instance.json'));
  // Persisted schema may wrap the current record; the API roots plus isolated registry
  // bind identity without assuming a particular persistence version.
  assert(JSON.stringify(local).includes(current.instanceId), 'Instance missing from owned state');
  ownedPids.add(current.pid);
  return current;
}
async function appStatus(expected) {
  await ownedInstance();
  const response = await fetch('http://127.0.0.1:18552', { signal: AbortSignal.timeout(2000) });
  assert.equal(response.status, expected);
  const body = await response.json();
  assert.equal(body.database, expected === 200 ? 'connected' : 'unavailable');
}
async function action(name) {
  await ownedInstance();
  const response = await fetch(`http://127.0.0.1:18550/api/services/postgres/${name}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true }), signal: AbortSignal.timeout(60_000),
  });
  assert(response.ok && (await response.json()).ok, `${name} failed`);
}
async function recordDatabase() {
  const state = await json(path.join(serviceRoot, '.state', 'runtime.json'));
  assert(state.running && Number.isInteger(state.pid));
  ownedPids.add(state.pid);
  databasePort = state.ports.service;
  assert(Number.isInteger(databasePort));
}
try {
  assert(archiveDigests[process.platform], 'Unsupported platform');
  await mkdir(path.dirname(evidencePath), { recursive: true });
  // Refuse collisions before setup, and again immediately before launching.
  await portFree(18550); await portFree(18552);
  const staging = path.join(runRoot, 'staging');
  await cp(path.join(root, 'examples', 'postgres-app'), staging, { recursive: true,
    filter: source => !['workspace', 'node_modules'].includes(path.basename(source)),
  });
  const pack = JSON.parse(await npm(['pack', '--json', '--pack-destination', runRoot], staging))[0];
  const archive = path.join(runRoot, pack.filename);
  evidence.sourcePackageSha256 = digest(await readFile(archive));
  await command('tar', ['-xf', archive, '-C', runRoot], runRoot);
  const lock = await json(path.join(packaged, 'npm-shrinkwrap.json'));
  const dependency = lock.packages['node_modules/@service-lasso/service-lasso'];
  evidence.core = { version: dependency.version, integrity: dependency.integrity };
  evidence.lockSha256 = digest(await readFile(path.join(packaged, 'npm-shrinkwrap.json')));
  await npm(['ci']);
  await npm(['run', 'setup']);
  const installed = (await json(path.join(serviceRoot, '.state', 'install.json'))).artifact;
  const [asset, expected] = archiveDigests[process.platform];
  assert.equal(installed.tag, release); assert.equal(installed.assetName, asset);
  assert.equal(installed.repo, 'service-lasso/lasso-postgres');
  // The documented older Core release can leave checksum metadata null. The
  // harness independently verifies the actual installed bytes in either case.
  if (installed.checksum) {
    assert.equal(installed.checksum.expected, expected);
    assert.equal(installed.checksum.actual, expected);
  }
  const archivePath = await realpath(path.resolve(serviceRoot, installed.archivePath));
  const relative = path.relative(await realpath(runRoot), archivePath);
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Archive outside owned workspace');
  assert.equal(digest(await readFile(archivePath)), expected, 'Actual installed archive checksum mismatch');
  evidence.postgres = { tag: release, asset, sha256: expected };
  const manifest = await json(manifestPath);
  manifest.env.POSTGRES_MAX_CONNECTIONS = '120';
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  evidence.configuredManifestSha256 = digest(await readFile(manifestPath));
  await portFree(18550); await portFree(18552);
  const started = Date.now();
  // package.json start is exactly node app.mjs. Direct spawn retains the app PID.
  app = spawn(process.execPath, ['app.mjs'], { cwd: packaged, env, stdio: ['ignore', 'pipe', 'pipe'] });
  app.on('error', error => { appLog += error.message; });
  for (const stream of [app.stdout, app.stderr]) stream.on('data', chunk => { appLog = (appLog + chunk).slice(-128_000); });
  instance = await until(ownedInstance);
  await until(() => appStatus(200));
  evidence.readinessMs = Date.now() - started;
  await recordDatabase();
  const check = await npm(['run', 'check']);
  assert.match(check, /PASS: database write \+ read and app HTTP response\./);
  assert.match(check, /PostgreSQL max_connections: 120(?:\s|$)/);
  evidence.outcomes.freshPackageSqlAndConfiguration = 'success';
  await action('stop'); await until(() => appStatus(503));
  evidence.outcomes.dependencyFailure = 'success';
  await action('start'); await until(() => appStatus(200)); await recordDatabase();
  const recovery = await npm(['run', 'check']);
  assert.match(recovery, /PASS: database write \+ read and app HTTP response\./);
  assert.match(recovery, /PostgreSQL max_connections: 120(?:\s|$)/);
  evidence.outcomes.recovery = 'success';
} catch (error) { failure = error; }
try {
  if (app) {
    // Collect retained service ownership even when startup failed before the
    // first successful database observation. Never infer no children from an
    // already-exited app wrapper.
    const registry = await json(path.join(workspaceRoot, '.service-lasso', 'processes.json'));
    assert(samePath(registry.canonicalWorkspaceRoot, workspaceRoot), 'Unexpected process registry root');
    for (const entry of registry.entries) if (Number.isInteger(entry.pid) && entry.pid > 0) ownedPids.add(entry.pid);
    const databaseState = await json(path.join(serviceRoot, '.state', 'runtime.json'));
    databasePort ??= databaseState.ports?.service;
    assert(instance && ownedPids.size > 0, 'Early startup ownership was not established');
    // Never send stop to a runtime unless its live roots and generation match.
    if (app.exitCode === null && app.signalCode === null) {
      instance ??= await ownedInstance();
      await ownedInstance();
      await npm(['run', 'stop']);
    }
    await until(async () => { assert(app.exitCode !== null || app.signalCode !== null, 'App still running'); }, 30_000);
    for (const pid of ownedPids) await until(async () => { assert(!alive(pid), `Owned process ${pid} still running`); }, 30_000);
    await portFree(18550); await portFree(18552);
    if (databasePort) await portFree(databasePort);
  }
  assert(!commandExitUnconfirmed, 'A timed-out command tree has unconfirmed exit');
  evidence.outcomes.ownedCleanup = app ? 'success' : 'not_started';
} catch (error) { evidence.outcomes.ownedCleanup = 'failure'; failure ??= error; }
if (!failure) {
  // runRoot is the exact mkdtemp result; only successful owned cleanup allows removal.
  const relative = path.relative(temporaryRoot, runRoot);
  assert(relative.startsWith('service-lasso-postgres-journey-') && path.dirname(relative) === '.');
  await rm(runRoot, { recursive: true, force: true });
  evidence.outcome = 'success';
} else {
  // Logs remain private/local, not uploaded as public qualification evidence.
  await writeFile(path.join(runRoot, 'app.log'), appLog);
  let diagnosticText = appLog;
  for (const name of ['stderr.log', 'stdout.log']) {
    diagnosticText += await readFile(path.join(serviceRoot, 'logs', 'runtime', name), 'utf8').catch(() => '');
  }
  // Retain only fixed diagnostic categories in the uploaded metadata. These
  // distinguish native startup failures without publishing raw runtime logs.
  evidence.diagnostics = {
    missingFile: /ENOENT|No such file/i.test(diagnosticText),
    permissionDenied: /EACCES|Permission denied/i.test(diagnosticText),
    architectureMismatch: /bad CPU type|Exec format error|ENOEXEC/i.test(diagnosticText),
    missingDynamicLibrary: /Library not loaded|cannot open shared object file|dyld/i.test(diagnosticText),
    initializationFailed: /initialization failed|initdb: error/i.test(diagnosticText),
    readinessFailed: /readiness|did not become ready/i.test(diagnosticText),
    exampleRuntimeDeadlineExceeded: diagnosticText.includes('Example runtime did not become ready.'),
    exampleRuntimeExited: diagnosticText.includes('Example runtime exited. Check port 18550'),
    processSpawnFailed: /process spawn failed/i.test(diagnosticText),
    runtimeOwnedReadinessFailed: diagnosticText.includes('Runtime owned readiness failed'),
    nativeProcessInspectionFailed: diagnosticText.includes('Native Windows process-tree inspection failed'),
    runtimeOwnershipStatus: diagnosticText.match(/Runtime owned readiness failed with ownership status ([a-z_-]+)\./)?.[1] ?? null,
    appExitCode: app?.exitCode ?? null,
    appExitSignal: app?.signalCode ?? null,
    // This isolated example contains only disposable sample data. Limit uploaded
    // diagnostics to readiness/error lines and redact paths, URLs, and credentials.
    startupErrors: diagnosticText.split(/\r?\n/)
      .filter(line => /readiness|^Error:|^Postgres .*failed/i.test(line))
      .slice(-5).map(line => line
        .replace(/\u001b\[[0-9;]*m/g, '')
        .replaceAll(runRoot, '<owned-workspace>')
        .replace(/https?:\/\/\S+/g, '<url>')
        .replace(/(?:[A-Za-z]:\\|\/Users\/|\/home\/|\/tmp\/)\S+/g, '<path>')
        .replace(/(?:token|password|authorization|secret)\s*[:=]\s*\S+/gi, '<credential>')
        .slice(0, 500)),
    missingLibraries: [...new Set(diagnosticText.match(/lib[\w.+-]+\.dylib/g) ?? [])].slice(0, 20),
    serviceFailure: (diagnosticText.match(/Cannot start service "postgres"[^\r\n]*/)?.[0] ?? '')
      .replaceAll(runRoot, '<owned-workspace>').slice(0, 1000),
  };
  console.error(`Startup diagnostic categories: ${JSON.stringify(evidence.diagnostics)}`);
  evidence.failure = 'journey_or_cleanup_failed';
  console.error(`Journey failed; retained owned state at ${runRoot}: ${failure.message}`);
  process.exitCode = 1;
}
await mkdir(path.dirname(evidencePath), { recursive: true });
await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
