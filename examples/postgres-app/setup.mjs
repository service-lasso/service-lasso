import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { run, servicesRoot, root } from './common.mjs';
const manifestPath = path.join(servicesRoot, 'postgres/service.json');
try { await access(manifestPath); throw new Error('This example is already set up. Keep its data; use npm start.'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await run(['services', 'import', 'service-lasso/lasso-postgres', '--tag', '2026.5.3-ddd9e47']);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.artifact.source.tag = '2026.5.3-ddd9e47';
// initdb requires an empty directory; the release puts a .keep in runtime/data.
manifest.env.POSTGRES_DATA_DIR = '${SERVICE_ROOT}/runtime/database';
manifest.env.POSTGRES_DATABASES = 'lasso_demo';
manifest.ports.service = 18551;
// A fresh database runs initdb before accepting connections. Allow a bounded
// two-minute first-boot window on slower machines, while probing every 250 ms.
for (const check of manifest.healthchecks ?? (manifest.healthcheck ? [manifest.healthcheck] : [])) {
  check.retries = 480;
  check.interval = 250;
}
for (const platform of Object.values(manifest.artifact.platforms)) {
  platform.command = process.execPath;
  platform.args = [path.join(root, 'postgres-launch.mjs')];
}
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
await run(['install', 'postgres']);
console.log('Installed PostgreSQL. Run npm start, then npm run check in another terminal.');
