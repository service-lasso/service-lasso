import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export const root = fileURLToPath(new URL('.', import.meta.url));
export const servicesRoot = path.join(root, 'workspace/services');
export const workspaceRoot = path.join(root, 'workspace/state');
export const cli = fileURLToPath(import.meta.resolve('@service-lasso/service-lasso/cli'));
export const roots = ['--services-root', servicesRoot, '--workspace-root', workspaceRoot];
export function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args, ...roots], { stdio: 'inherit', cwd: root });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Service Lasso exited ${code}`)));
  });
}
