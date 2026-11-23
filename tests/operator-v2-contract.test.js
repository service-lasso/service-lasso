import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OPERATOR_V2_CONTRACT,
  buildOperatorV2Detail,
  buildOperatorV2Discovery,
  buildOperatorV2LifecycleAvailability,
  buildOperatorV2Operation,
  buildOperatorV2Readback,
  buildOperatorV2ServicesPage,
  operatorV2Envelope,
} from '../dist/server/operator-v2.js';

test('v2 envelope is closed and UTC-formatted', () => {
  const value = operatorV2Envelope({ ok: true }, 'request-1', new Date('2026-11-20T12:00:00.000Z'));
  assert.deepEqual(value, {
    contractVersion: OPERATOR_V2_CONTRACT,
    requestId: 'request-1',
    generatedAt: '2026-11-20T12:00:00.000Z',
    data: { ok: true },
  });
});

test('v2 discovery has bounded read capabilities and no mutations', () => {
  const discovery = buildOperatorV2Discovery();
  assert.equal(discovery.mutationSemantics, 'unavailable');
  assert.deepEqual(discovery.limits, {
    requestBytes: 65536,
    responseBytes: 262144,
    errorBytes: 8192,
    depth: 16,
    totalValues: 8192,
    propertyNameBytes: 128,
    publicStringBytes: 4096,
    idBytes: 128,
    summaryBytes: 512,
    displayNameBytes: 256,
    descriptionBytes: 1024,
    pageRows: 100,
    contextBytes: 4096,
  });
  assert.deepEqual(discovery.capabilities.map((entry) => entry.id), [
    'read_overview',
    'read_detail',
    'read_graph',
    'read_logs',
  ]);
  assert.ok(discovery.capabilities.every((entry) => entry.confirmationPolicy === 'none'));
  assert.ok(discovery.capabilities.every((entry) => entry.availability.available === true));
});

test('v2 service page and detail are stable read-only projections', () => {
  const page = buildOperatorV2ServicesPage(
    [
      { id: 'root', name: 'Root', description: 'root service', running: true },
      { id: 'echo', name: 'Echo', running: false },
    ],
    { expiresAt: new Date('2026-11-20T12:01:00.000Z') },
  );
  assert.equal(page.expiresAt, '2026-11-20T12:01:00.000Z');
  assert.equal(page.rows.length, 2);
  assert.equal(page.rows[0].serviceId, 'root');
  assert.equal(page.rows[0].running, 'yes');
  assert.equal(page.rows[1].running, 'no');
  assert.equal(page.rows[0].healthStatus, 'unknown');
  const detail = buildOperatorV2Detail({ id: 'root', name: 'Root', running: true });
  assert.equal(detail.summary.serviceId, 'root');
  assert.deepEqual(detail.dependencies, []);
  assert.deepEqual(detail.actionMetadata, []);
});

test('v2 lifecycle availability fails closed as unsupported', () => {
  const value = buildOperatorV2LifecycleAvailability('root');
  assert.equal(value.serviceId, 'root');
  assert.equal(value.definitionRevision, null);
  assert.equal(value.generation, null);
  assert.equal(value.modelEpoch, null);
  assert.deepEqual(value.capabilities, []);
  assert.deepEqual(value.mutationBindings, []);
  assert.deepEqual(value.availability, {
    supported: false,
    available: false,
    reasonCode: 'unsupported_capability',
  });
});


test('v2 operation readback maps the durable v1 operation', () => {
  const operation = buildOperatorV2Operation({
    operationId: 'mcp-operation-12345678-1234-1234-1234-123456789abc',
    action: 'service_start',
    targetIds: ['root'],
    status: 'running',
    phase: 'executing',
    outcome: null,
    correlationId: 'mcp-operation-correlation-12345678-1234-1234-1234-123456789abc',
    createdAt: '2026-11-20T12:00:00.000Z',
    updatedAt: '2026-11-20T12:00:01.000Z',
    expiresAt: '2026-11-21T12:00:00.000Z',
    cancellationSupported: false,
  });
  assert.equal(operation.serviceId, 'root');
  assert.equal(operation.actionId, 'service_start');
  assert.deepEqual(buildOperatorV2Readback(operation), { operation });
});
