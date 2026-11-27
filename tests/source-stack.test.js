import test from 'node:test';
import assert from 'node:assert/strict';
import { stackInvocation } from '../scripts/source-stack.mjs';

test('source startup delegates baseline ownership with stable loopback defaults', () => {
  const { args, env } = stackInvocation('start', [], {});
  assert.equal(args[1], 'start');
  assert.equal(args[args.indexOf('--port') + 1], '17883');
  assert.equal(args[args.indexOf('--port-policy') + 1], 'fixed');
  assert.match(args[args.indexOf('--workspace-root') + 1], /\/workspace$/);
  assert.match(args[args.indexOf('--services-root') + 1], /\/services$/);
  assert.equal(env.SERVICE_LASSO_HOST, '127.0.0.1');
});
test('same custom workspace flows to status and shutdown without baseline startup', () => {
  const environment = { SERVICE_LASSO_WORKSPACE_ROOT: '/private/owned', SERVICE_LASSO_SERVICES_ROOT: '/private/catalog' };
  for (const [action, command] of [['stop', 'stop'], ['status', 'instance']]) {
    const { args } = stackInvocation(action, [], environment);
    assert.equal(args[1], command);
    assert.equal(args[args.indexOf('--workspace-root') + 1], environment.SERVICE_LASSO_WORKSPACE_ROOT);
    assert.equal(args.includes('--port'), false);
  }
});
test('explicit noautostart stays serve and flags can override defaults', () => {
  const { args } = stackInvocation('start', ['--noautostart', '--port', '18080'], {});
  assert.equal(args[1], 'serve');
  assert.deepEqual(args.slice(-3), ['--noautostart', '--port', '18080']);
  const restart = stackInvocation('restart', [], { SERVICE_LASSO_PORT: '19000' });
  assert.equal(restart.args[1], 'restart');
  assert.equal(restart.args[restart.args.indexOf('--port') + 1], '19000');
});
