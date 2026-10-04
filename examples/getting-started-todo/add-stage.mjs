import { spawnSync } from 'node:child_process';
import { readFile, writeFile, access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const source = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(source, '../..');
const stage = process.argv[2];
if (!['postgres', 'api'].includes(stage)) throw new Error('Use add-stage.mjs postgres|api [servicesRoot] [workspaceRoot].');
const inventory = path.resolve(process.argv[3] ?? path.join(repo, 'workspace/canonical-services-root'));
const workspace = path.resolve(process.argv[4] ?? path.join(repo, 'workspace/demo-instance'));
const todoPath = path.join(inventory, 'todo-app/service.json');
const todo = JSON.parse(await readFile(todoPath, 'utf8'));
function run(command, args, cwd = repo) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}). Preserve the workspace and inspect the error.`);
}
const roots = ['--services-root', inventory, '--workspace-root', workspace];
if (stage === 'postgres') {
  const target = path.join(inventory, 'postgres');
  try { await access(target); throw new Error('PostgreSQL already exists; preserve its data.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  run(process.execPath, [path.join(repo, 'dist/cli.js'), 'services', 'import', 'service-lasso/lasso-postgres', '--tag', '2026.5.3-ddd9e47', ...roots]);
  const manifestPath = path.join(target, 'service.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.env.POSTGRES_DATA_DIR = '${SERVICE_ROOT}/data/database';
  manifest.ports.service = 18551;
  for (const platform of Object.values(manifest.artifact.platforms)) {
    platform.command = process.execPath;
    platform.args = [path.join(repo, 'examples/postgres-app/postgres-launch.mjs')];
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  run(process.execPath, [path.join(repo, 'dist/cli.js'), 'install', 'postgres', ...roots]);
  // npm's shell shim is only needed for this explicit locked dependency install.
  if (process.platform === 'win32') run('powershell.exe', ['-NoProfile', '-Command', '& npm.cmd ci --ignore-scripts --no-audit --no-fund'], path.join(inventory, 'todo-app'));
  else run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], path.join(inventory, 'todo-app'));
  todo.depend_on = ['@node', 'postgres'];
  todo.env.TODO_DATABASE_STATE = '${SERVICE_ROOT}/../postgres/.state/runtime.json';
  delete todo.env.TODO_API_STATE;
} else {
  await access(path.join(inventory, 'postgres/service.json'));
  const target = path.join(inventory, 'todo-api');
  try { await access(target); throw new Error('todo-api already exists; do not overwrite it.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(path.join(target, 'runtime'), { recursive: true });
  run('go', ['build', '-o', path.join(target, 'runtime/todo-api.exe'), '.'], path.join(repo, 'examples/getting-started-todo-api'));
  const manifest = {
    id: 'todo-api', name: 'Go Todo API', description: 'Managed tutorial Todo JSON API backed by PostgreSQL.', version: '0.1.0', enabled: true,
    depend_on: ['postgres'], executable: path.join(target, 'runtime/todo-api.exe'),
    endpoints: [{ id: 'web', kind: 'network', transport: 'tcp', protocol: 'http', bind: '127.0.0.1', port: { default: 18553, strategy: 'preferred' }, exposure: 'local', primary: true }],
    env: { TODO_API_PORT: '${endpoint.web.port}', TODO_DATABASE_STATE: '${SERVICE_ROOT}/../postgres/.state/runtime.json' },
    healthchecks: [{ id: 'http-health', type: 'http', url: 'http://127.0.0.1:${endpoint.web.port}/healthz', expected_status: 200, retries: 80, interval: 250 }]
  };
  await writeFile(path.join(target, 'service.json'), JSON.stringify(manifest, null, 2) + '\n');
  todo.depend_on = ['@node', 'todo-api'];
  todo.env.TODO_API_STATE = '${SERVICE_ROOT}/../todo-api/.state/runtime.json';
  delete todo.env.TODO_DATABASE_STATE;
}
await writeFile(todoPath, JSON.stringify(todo, null, 2) + '\n');
console.log(`Added ${stage} stage. Restart Lasso, inspect dependencies/health/endpoints in Admin, then create and list todos.`);
