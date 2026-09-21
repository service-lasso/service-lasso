import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { postgresChildEnvironment } from './postgres-environment.mjs';
const data = process.env.POSTGRES_DATA_DIR;
const artifact = process.env.SERVICE_ARTIFACT_ROOT;
if (!data || !artifact) throw new Error('Run through Service Lasso so database and artifact paths are explicit.');
const childEnv = postgresChildEnvironment(artifact);
const executable = name => path.join(artifact, 'bin', name + (process.platform === 'win32' ? '.exe' : ''));
if (!existsSync(path.join(data, 'PG_VERSION'))) {
  mkdirSync(path.dirname(data), { recursive: true });
  const passwordFile = path.join(path.dirname(data), 'tutorial-init.password');
  writeFileSync(passwordFile, process.env.POSTGRES_PASSWORD + '\n', { mode: 0o600 });
  try {
    const initialized = spawnSync(executable('initdb'), ['-D', data, '-U', process.env.POSTGRES_USER, '--encoding', 'UTF8', '--pwfile', passwordFile, '--auth-host=scram-sha-256'], { stdio: 'inherit', env: childEnv });
    if (initialized.error) throw initialized.error;
    if (initialized.status !== 0) throw new Error('PostgreSQL initialization failed; preserve the directory and inspect its logs.');
  } finally { unlinkSync(passwordFile); }
}
// Keep the real database process beneath the managed launcher. The pinned release's
// pg_ctl launcher detaches it during first boot, making ownership readiness race.
const child = spawn(executable('postgres'), ['-D', data, '-h', '127.0.0.1', '-p', process.env.POSTGRES_PORT, '-c', `max_connections=${process.env.POSTGRES_MAX_CONNECTIONS ?? '100'}`], { stdio: 'inherit', env: childEnv });
child.once('error', error => { console.error(error.message); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 1; });
process.once('SIGINT', () => child.kill('SIGINT'));
process.once('SIGTERM', () => child.kill('SIGTERM'));
