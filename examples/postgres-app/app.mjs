import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createPortProbe } from 'node:net';
import path from 'node:path';
import pg from 'pg';
import { cli, roots, root, servicesRoot, run, ports } from './common.mjs';
import { waitForDatabase } from './database-ready.mjs';
const api = `http://127.0.0.1:${ports.core}`;
const started = Date.now();
const manifest = JSON.parse(await readFile(path.join(servicesRoot, 'postgres/service.json'), 'utf8'));
if (manifest.ports.service !== ports.database) throw new Error('Database port differs from setup. Use the same example port environment for setup, start and check.');
await new Promise((resolve, reject) => {
  const probe = createPortProbe();
  probe.once('error', () => reject(new Error(`Port ${ports.core} is occupied. Choose unused example ports; do not stop unrelated services.`)));
  probe.listen(ports.core, '127.0.0.1', () => probe.close(resolve));
});
// Fixed API port prevents accidentally attaching to another instance.
const runtime = spawn(process.execPath, [cli, 'serve', '--port', String(ports.core), '--port-policy', 'fixed', ...roots], { cwd: root, stdio: 'inherit', windowsHide: true });
let exited = false;
runtime.once('exit', () => { exited = true; stop().catch(console.error); });
let pool, server, stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  server?.close();
  await pool?.end();
  // Only stop the inventory created by setup, and only after our API started.
  if (!exited) await run(['stop']);
}
process.once('SIGINT', () => stop().catch(console.error));
process.once('SIGTERM', () => stop().catch(console.error));
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (exited) throw new Error(`Example runtime exited. Check port ${ports.core} and its startup message.`);
    try {
      const response = await fetch(`${api}/api/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) { ready = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!ready) throw new Error('Example runtime did not become ready.');
  for (const action of ['config', 'start']) {
    const response = await fetch(`${api}/api/services/postgres/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.message ?? `Postgres ${action} failed`);
  }
  const state = JSON.parse(await readFile(path.join(servicesRoot, 'postgres/.state/runtime.json'), 'utf8'));
  pool = new pg.Pool({ host: '127.0.0.1', port: state.ports.service, user: 'pgadmin', password: 'pgadmin', database: 'postgres', connectionTimeoutMillis: 5000 });
  pool.on('error', () => console.error('Database connection lost. Check PostgreSQL health and logs.'));
  // A managed process can exist while first-run initdb is still finishing.
  // App readiness requires a real SQL connection, not merely a running PID.
  await waitForDatabase(pool);
  await pool.query('CREATE TABLE IF NOT EXISTS lasso_messages (id text PRIMARY KEY, message text NOT NULL)');
  server = createServer(async (request, response) => {
    try {
      const result = await pool.query('SELECT message FROM lasso_messages ORDER BY id LIMIT 10');
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ app: 'Service Lasso + PostgreSQL', database: 'connected', messages: result.rows }));
    } catch {
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ database: 'unavailable', next: 'Check PostgreSQL health and logs; restart the example after recovery.' }));
    }
  });
  server.on('error', error => { console.error(error.message); stop().catch(console.error); process.exitCode = 1; });
  server.listen(ports.app, '127.0.0.1', () => console.log(`App: http://127.0.0.1:${ports.app} | PostgreSQL: 127.0.0.1:${state.ports.service} | ready in ${((Date.now() - started) / 1000).toFixed(1)}s. Run npm run check.`));
} catch (error) {
  console.error(error.message);
  await stop();
  process.exitCode = 1;
}
