import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { startApiServer } from '../dist/server/index.js';

test('Core serves v2 discovery and an empty services page', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'operator-v2-routes-'));
  const servicesRoot = path.join(root, 'services');
  const workspaceRoot = path.join(root, 'workspace');
  await mkdir(servicesRoot);
  await mkdir(workspaceRoot);
  const server = await startApiServer({ port: 0, servicesRoot, workspaceRoot });
  try {
    const discoveryResponse = await fetch(`${server.url}/api/operator/v2/discovery`);
    assert.equal(discoveryResponse.status, 200);
    const discovery = await discoveryResponse.json();
    assert.equal(discovery.contractVersion, 'service-lasso-operator.v2');
    assert.equal(typeof discovery.requestId, 'string');
    assert.equal(discovery.data.mutationSemantics, 'unavailable');
    assert.deepEqual(discovery.data.capabilities.map((entry) => entry.id), [
      'read_overview',
      'read_detail',
      'read_graph',
      'read_logs',
    ]);

    const servicesResponse = await fetch(`${server.url}/api/operator/v2/services`);
    assert.equal(servicesResponse.status, 200);
    const services = await servicesResponse.json();
    assert.equal(services.contractVersion, 'service-lasso-operator.v2');
    assert.deepEqual(services.data.rows, []);
    assert.equal(services.data.truncated, false);

    const missingResponse = await fetch(`${server.url}/api/operator/v2/services/missing`);
    assert.equal(missingResponse.status, 404);
    const missing = await missingResponse.json();
    assert.equal(missing.contractVersion, "service-lasso-operator.v2");
    assert.equal(missing.error.code, "not_found");
    assert.equal(missing.error.messageKey, "operator.error.not_found");

    const contextResponse = await fetch(`${server.url}/api/operator/v2/reconciliation-context`);
    assert.equal(contextResponse.status, 200);
    const context = await contextResponse.json();
    assert.equal(context.contractVersion, "service-lasso-durable-reconciliation-context.v1");
    assert.match(context.context.instanceBinding, /^slrc_[a-f0-9]{64}$/);
    assert.match(context.context.workspaceBinding, /^slrc_[a-f0-9]{64}$/);
    assert.match(context.context.actorBinding, /^slrc_[a-f0-9]{64}$/);
    assert.match(context.context.clientBinding, /^slrc_[a-f0-9]{64}$/);

    const legacyResponse = await fetch(`${server.url}/api/operator/lifecycle/operations`);
    assert.equal(legacyResponse.status, 404);
  } finally {
    await server.stop().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});
