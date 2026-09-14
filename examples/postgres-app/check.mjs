import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import pg from 'pg';
import { servicesRoot } from './common.mjs';
const state = JSON.parse(await readFile(path.join(servicesRoot, 'postgres/.state/runtime.json'), 'utf8'));
const client = new pg.Client({ host: '127.0.0.1', port: state.ports.service, user: 'pgadmin', password: 'pgadmin', database: 'postgres', connectionTimeoutMillis: 5000 });
try {
  await client.connect();
  const id = randomUUID();
  await client.query('INSERT INTO lasso_messages (id, message) VALUES ($1, $2)', [id, 'Hello from Service Lasso']);
  const result = await client.query('SELECT message FROM lasso_messages WHERE id = $1', [id]);
  assert.equal(result.rows[0]?.message, 'Hello from Service Lasso');
  const response = await fetch('http://127.0.0.1:18552', { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).database, 'connected');
  console.log('PASS: database write + read and app HTTP response.');
  console.log(`PostgreSQL max_connections: ${(await client.query('SHOW max_connections')).rows[0].max_connections}`);
} finally { await client.end(); }
