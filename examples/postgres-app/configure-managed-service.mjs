import { readFile, writeFile, mkdir, copyFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = process.argv[2];
if (!directory) throw new Error('Use configure-managed-service.mjs <installed-postgres-directory>; stop PostgreSQL first.');
const root = path.resolve(directory);
const manifestPath = path.join(root, 'service.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (manifest.id !== 'postgres' || manifest.artifact?.source?.repo !== 'service-lasso/lasso-postgres') throw new Error('Expected the imported PostgreSQL service; nothing changed.');
if (manifest.artifact.source.tag && manifest.artifact.source.tag !== '2026.5.3-ddd9e47') throw new Error('This foreground adapter is scoped to PostgreSQL release 2026.5.3-ddd9e47.');
try {
  const state = JSON.parse(await readFile(path.join(root, '.state', 'runtime.json'), 'utf8'));
  if (state.runtime?.running || state.running) throw new Error('Stop this PostgreSQL service before configuring it.');
  if (Number.isInteger(state.pid) && state.pid > 0) {
    try { process.kill(state.pid, 0); throw new Error('A recorded PostgreSQL process is still alive; stop it through Admin first.'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const adapter = path.join(root, 'tutorial-runtime');
for (const name of ['postgres-launch.mjs', 'postgres-environment.mjs']) {
  const target = path.join(adapter, name);
  try { await access(target); throw new Error('Adapter already exists; preserve it and inspect the existing configuration.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
await mkdir(adapter, { recursive: true });
for (const name of ['postgres-launch.mjs', 'postgres-environment.mjs']) await copyFile(fileURLToPath(new URL(name, import.meta.url)), path.join(adapter, name));
manifest.artifact.source.tag = '2026.5.3-ddd9e47';
manifest.env.POSTGRES_DATA_DIR = '${SERVICE_ROOT}/data/database';
manifest.ports.service = 18551;
manifest.depend_on = [...new Set([...(manifest.depend_on ?? []), '@node'])];
manifest.execservice = '@node';
manifest.args = ['${SERVICE_ROOT}/tutorial-runtime/postgres-launch.mjs'];
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log('Configured explicit local foreground adapter and clean database directory. Refresh Admin, then Install/Configure/Start PostgreSQL. Existing data was not deleted.');
