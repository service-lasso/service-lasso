import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveExamplePorts } from '../examples/postgres-app/ports.mjs';
import { waitForDatabase } from '../examples/postgres-app/database-ready.mjs';

test('app waits for real SQL readiness and bounds transient startup retries', async () => {
  let attempts = 0, time = 0;
  await waitForDatabase({ query: async () => { if (++attempts < 3) throw Object.assign(new Error('starting'), { code: 'ECONNREFUSED' }); } }, { now: () => time, sleep: async ms => { time += ms; } });
  assert.equal(attempts, 3);
  await assert.rejects(waitForDatabase({ query: async () => { throw Object.assign(new Error('still starting'), { code: '57P03' }); } }, { timeoutMs: 200, now: () => time, sleep: async ms => { time += ms; } }), /still starting/);
  await assert.rejects(waitForDatabase({ query: async () => { throw Object.assign(new Error('authentication denied'), { code: '28P01' }); } }), /authentication denied/);
});

test('AC-4AJ.4c example preserves defaults and supports disjoint folder ports', () => {
  assert.deepEqual(resolveExamplePorts({}), { core: 18550, database: 18551, app: 18552 });
  assert.deepEqual(resolveExamplePorts({ LASSO_EXAMPLE_CORE_PORT: '28550', LASSO_EXAMPLE_DATABASE_PORT: '28551', LASSO_EXAMPLE_APP_PORT: '28552' }), { core: 28550, database: 28551, app: 28552 });
});

test('AC-4AJ.4c rejects malformed, privileged, out-of-range and colliding ports', () => {
  for (const value of ['', '0', '1023', '65536', '-1', '1234.5', '1234junk', ' 1234', 'NaN']) {
    assert.throws(() => resolveExamplePorts({ LASSO_EXAMPLE_CORE_PORT: value }), /integer/);
  }
  assert.throws(() => resolveExamplePorts({ LASSO_EXAMPLE_CORE_PORT: '18551' }), /distinct/);
  assert.deepEqual(resolveExamplePorts({ LASSO_EXAMPLE_CORE_PORT: '1024', LASSO_EXAMPLE_APP_PORT: '65535' }), { core: 1024, database: 18551, app: 65535 });
});
