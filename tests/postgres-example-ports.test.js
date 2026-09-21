import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveExamplePorts } from '../examples/postgres-app/ports.mjs';

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
