import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const manifest = async id => JSON.parse(await readFile(new URL(`../services/${id}/service.json`, import.meta.url), 'utf8'));

test('managed HTTP daemons declare readiness; default services observe without automatic restarts', async () => {
  const targets = {
    '@serviceadmin': 'http://127.0.0.1:${UI_PORT}/',
    '@nginx': 'http://127.0.0.1:${HTTP_PORT}/health',
    '@traefik': '${endpoint.ping.url}',
    '@caddy': 'http://127.0.0.1:${endpoint.web.port}/health',
    'node-sample-service': 'http://127.0.0.1:${SERVICE_PORT}/health',
    openobserve: '${endpoint.health.url}',
    'echo-service': 'http://127.0.0.1:${HEALTH_PORT}/health',
  };
  for (const [id, url] of Object.entries(targets)) {
    const service = await manifest(id);
    assert.ok(service.healthchecks.some(check => check.type === 'http' && check.url === url && check.expected_status === 200), id);
    if (['@serviceadmin', '@nginx', '@traefik', 'echo-service'].includes(id)) {
      assert.equal(service.monitoring.enabled, true, id);
      assert.deepEqual(service.restartPolicy, { enabled: true, onCrash: false, onUnhealthy: false }, id);
    } else {
      assert.equal(service.monitoring, undefined, id);
      assert.equal(service.restartPolicy, undefined, id);
    }
  }
  const admin = await manifest('@serviceadmin');
  assert.ok(admin.healthchecks.some(check => check.type === 'process'));
  assert.equal(admin.artifact.source.tag, '2026.11.2-dda9f96');
});

test('production Broker IPC and PHP provider do not acquire fictitious HTTP checks', async () => {
  const broker = await manifest('@secretsbroker');
  assert.equal(broker.env.SECRETSBROKER_MODE, 'production');
  assert.equal(broker.env.SECRETSBROKER_TRANSPORT, 'auto');
  const php = await manifest('php');
  assert.equal(php.role, 'provider');
  for (const service of [broker, php]) {
    assert.ok(service.healthchecks.every(check => check.type !== 'http'));
    assert.equal(service.monitoring, undefined);
  }
});
