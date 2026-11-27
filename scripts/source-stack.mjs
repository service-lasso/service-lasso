import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Delegate all process ownership, first-run, and baseline decisions to Core.
export function stackInvocation(action, flags = [], environment = process.env) {
  if (!['start', 'stop', 'restart', 'status'].includes(action)) {
    throw new Error(`Unknown stack action: ${action}`);
  }
  const command = action === 'status' ? 'instance'
    : action === 'start' && flags.includes('--noautostart') ? 'serve' : action;
  const args = [path.join(repositoryRoot, 'dist', 'cli.js'), command,
    '--services-root', environment.SERVICE_LASSO_SERVICES_ROOT || path.join(repositoryRoot, 'services'),
    '--workspace-root', environment.SERVICE_LASSO_WORKSPACE_ROOT || path.join(repositoryRoot, 'workspace')];
  if (['start', 'restart', 'serve'].includes(command)) {
    args.push('--port', environment.SERVICE_LASSO_PORT || '17883', '--port-policy', 'fixed');
  }
  args.push(...flags);
  return { args, env: { ...environment, SERVICE_LASSO_HOST: environment.SERVICE_LASSO_HOST || '127.0.0.1' } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const invocation = stackInvocation(process.argv[2], process.argv.slice(3));
  const child = spawn(process.execPath, ['--enable-source-maps', ...invocation.args], {
    cwd: repositoryRoot, env: invocation.env, stdio: 'inherit',
  });
  // Also support stop signals sent to the wrapper alone, outside a terminal group.
  const forward = (signal) => { if (child.exitCode === null) child.kill(signal); };
  const interrupt = () => forward('SIGINT');
  const terminate = () => forward('SIGTERM');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', (code, signal) => {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}
