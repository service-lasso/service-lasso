import assert from 'node:assert/strict';
import { appendFile, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { startApiServer } from '../dist/server/index.js';
import { getServiceRuntimeLogPaths } from '../dist/runtime/operator/logs.js';
import { makeTempServicesRoot, writeManifest } from './test-helpers.js';

test('operator logs page genuine captured output with bounded filters, redaction and stale cursor refusal', async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot('v2-logs-');
  await writeManifest(servicesRoot, 'logs-service', { id: 'logs-service', name: 'Logs', description: 'Logs fixture' });
  const logPath = getServiceRuntimeLogPaths(path.join(servicesRoot, 'logs-service'), 'current').logPath;
  await mkdir(path.dirname(logPath), { recursive: true });
  const capturedAt = '2026-11-28T13:00:00.000Z';
  const line = (message, level = 'stdout') => JSON.stringify({ level, message, capturedAt }) + '\n';
  await writeFile(logPath, line('first') + line('second stderr', 'stderr') + line('third token=PRIVATE_SENTINEL ' + path.join(servicesRoot, 'logs-service')));
  const runtime = await startApiServer({ port: 0, servicesRoot, workspaceRoot });
  const read = async (query = '', headers = {}) => {
    const response = await fetch(runtime.url + '/api/operator/v2/services/logs-service/logs' + query, { headers });
    return { status: response.status, body: await response.json() };
  };
  try {
    const first = await read('?stream=combined&limit=2');
    assert.equal(first.status, 200);
    assert.equal(first.body.data.rows.length, 2);
    assert.equal(first.body.data.rows[0].time, capturedAt);
    assert.equal(first.body.data.rows[0].stream, 'stderr');
    assert.ok(first.body.data.nextCursor);
    assert.equal(first.body.data.truncated, false);
    assert.doesNotMatch(JSON.stringify(first.body), /PRIVATE_SENTINEL|\/tmp\//);
    const older = await read('?stream=combined&limit=2&cursor=' + first.body.data.nextCursor);
    assert.deepEqual(older.body.data.rows.map(row => row.text), ['first']);
    assert.equal(older.body.data.expiresAt, first.body.data.expiresAt);
    assert.ok(first.body.data.nextCursor.length <= 128);
    const filtered = await read('?stream=stdout&search=third');
    assert.equal(filtered.body.data.rows.length, 1);
    assert.equal(filtered.body.data.rows[0].stream, 'stdout');
    assert.equal((await read('?stream=declared')).status, 422);
    for (const query of ['?limit=51', '?limit=0', '?search=' + 'x'.repeat(257), '?stream=no', '?stream=stdout&stream=stderr', '?cursor=not-json']) {
      assert.equal((await read(query)).status, 400, query);
    }
    const remote = { 'x-service-lasso-internal-proxy': 'serviceadmin', 'x-service-lasso-proxy': 'serviceadmin', 'x-service-lasso-trusted-ingress': 'serviceadmin-loopback', 'x-service-lasso-client-address': '192.0.2.1' };
    assert.equal((await read('', remote)).status, 401);
    const viewer = { ...remote, 'x-service-lasso-zitadel-user-id': 'viewer', 'x-service-lasso-zitadel-roles': 'viewer' };
    assert.equal((await read('', viewer)).status, 403);
    await appendFile(logPath, line('new event'));
    assert.equal((await read('?stream=combined&limit=2&cursor=' + first.body.data.nextCursor)).status, 410);
    await appendFile(logPath, JSON.stringify({ level: 'stdout', message: 'legacy' }) + '\n');
    assert.equal((await read()).body.data.truncated, true);
    await writeFile(logPath, JSON.stringify({ level: 'stdout', message: 'legacy only' }) + '\n');
    const old = await read();
    assert.equal(old.status, 503);
    assert.equal(old.body.error.code, 'source_unavailable');
    await writeFile(logPath, line('界'.repeat(4096)));
    const clipped = (await read()).body.data.rows[0];
    assert.equal(clipped.truncated, true);
    assert.ok(Buffer.byteLength(clipped.text, 'utf8') <= 4096);
  } finally {
    await runtime.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
