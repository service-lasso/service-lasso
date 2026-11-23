import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OPERATOR_V2_CONTRACT,
  buildOperatorV2Detail,
  buildOperatorV2Discovery,
  buildOperatorV2Cancel,
  buildOperatorV2LifecycleAvailability,
  buildOperatorV2LifecycleAvailabilityFromActions,
  buildOperatorV2LifecycleAvailabilityReady,
  buildOperatorV2Preview,
  operatorV2ActionFromPhrase,
  operatorV2ActionToGuarded,
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


test('v2 ready lifecycle availability has eight capabilities and bindings', () => {
  const value = buildOperatorV2LifecycleAvailabilityReady('root');
  assert.equal(value.availability.available, true);
  assert.equal(value.definitionRevision, 'definition-1');
  assert.equal(value.capabilities.length, 8);
  assert.equal(value.mutationBindings.length, 8);
  assert.deepEqual(value.capabilities.map((entry) => entry.id), [
    'service_install',
    'service_configure',
    'service_start',
    'service_stop',
    'service_restart',
    'update_check',
    'update_download',
    'service_reload',
  ]);
  assert.equal(value.capabilities[0].availability.available, true);
  assert.equal(value.capabilities.at(-1).availability.supported, false);
  assert.equal(value.mutationBindings[0].expectedRevision, 'definition-1');
  assert.equal(value.mutationBindings.at(-1).expectedRevision, null);
});

test('v2 preview and action mapping bind the guarded action', () => {
  const preview = buildOperatorV2Preview({
    serviceId: 'root',
    actionId: 'service_start',
    definitionRevision: 'definition-1',
    expectedRevision: 'definition-1',
    generation: 'generation-1',
    modelEpoch: 'operator-v2-epoch-1',
    planId: 'plan-1',
    targets: ['root'],
    effects: ['start_runtime'],
    confirmationId: 'confirmation-1',
    confirmationPhrase: 'confirm service-start 0123456789abcdef0123456789abcdef',
    confirmationExpiresAt: '2026-11-20T12:01:00.000Z',
    expiresAt: '2026-11-20T12:01:00.000Z',
  });
  assert.equal(preview.actionId, 'service_start');
  assert.equal(preview.confirmation.required, true);
  assert.equal(operatorV2ActionToGuarded('service_start'), 'start');
  assert.equal(operatorV2ActionFromPhrase(preview.confirmation.phraseKey), 'service_start');
  assert.equal(operatorV2ActionFromPhrase('confirm unknown 0123'), null);
});


test('v2 cancellation maps the durable cancellation status', () => {
  const operation = buildOperatorV2Operation({
    operationId: 'mcp-operation-12345678-1234-1234-1234-123456789abc',
    action: 'service_start',
    targetIds: ['root'],
    status: 'cancelling',
    phase: 'cancellation_requested',
    outcome: null,
    correlationId: 'mcp-operation-correlation-12345678-1234-1234-1234-123456789abc',
    createdAt: '2026-11-20T12:00:00.000Z',
    updatedAt: '2026-11-20T12:00:01.000Z',
    expiresAt: '2026-11-21T12:00:00.000Z',
    cancellationSupported: true,
  });
  assert.deepEqual(buildOperatorV2Cancel(operation, 'requested'), {
    operationId: operation.operationId,
    actionId: 'service_start',
    status: 'requested',
  });
});


test('v2 availability reflects per-action preflight results', () => {
  const value = buildOperatorV2LifecycleAvailabilityFromActions(
    'root', 'revision-real', 'generation-real', 'epoch-real',
    {
      install: { available: true, reasonCode: null },
      config: { available: false, reasonCode: 'permission_denied' },
      start: { available: true, reasonCode: null },
      stop: { available: true, reasonCode: null },
      restart: { available: false, reasonCode: 'dependency_blocked' },
      update_check: { available: true, reasonCode: null },
      update_download: { available: true, reasonCode: null },
    },
  );
  const install = value.capabilities.find((entry) => entry.id === 'service_install');
  const config = value.capabilities.find((entry) => entry.id === 'service_configure');
  assert.equal(install.availability.available, true);
  assert.equal(config.availability.available, false);
  assert.equal(config.availability.reasonCode, 'permission_denied');
  assert.equal(value.mutationBindings.find((entry) => entry.actionId === 'service_install').expectedRevision, 'revision-real');
  assert.equal(value.mutationBindings.find((entry) => entry.actionId === 'service_configure').expectedRevision, null);
});
