import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startApiServer } from '../dist/server/index.js';
import { checkoutRuntimeOrigin } from '../scripts/source-operator-tools.mjs';
import { discoverServices } from '../dist/runtime/discovery/discoverServices.js';
import { createServiceRegistry } from '../dist/runtime/manager/DependencyGraph.js';
import { configService, installService, startService, restartService, stopService } from '../dist/runtime/lifecycle/actions.js';
import { getLifecycleState, resetLifecycleState } from '../dist/runtime/lifecycle/store.js';
import { writeServiceState } from '../dist/runtime/state/writeState.js';
import { emitOperatorInboxServiceEvent, mutateOperatorInboxItem } from '../dist/runtime/operator/inbox.js';
import { McpOperationService, mcpOperationStatePath } from '../dist/runtime/operator/mcp-operations.js';
import { readPrivateJson, writePrivateJson } from '../dist/runtime/security/private-json.js';
import { readAuditEvents } from '../dist/runtime/audit/store.js';
import { makeTempServicesRoot, writeExecutableFixtureService } from './test-helpers.js';

test('AC-SR real runtime restart, passive durable in-flight/terminal operation and safe incidents', async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot('stack-runtime-');
  const workspaceRoot = path.join(tempRoot, 'workspace'); await mkdir(workspaceRoot, { recursive:true });
  await writeExecutableFixtureService(servicesRoot, 'stack-service');
  await writeExecutableFixtureService(servicesRoot, 'never-run');
  let runtime = await startApiServer({ port:0, servicesRoot, workspaceRoot });
  const registry = createServiceRegistry(await discoverServices(servicesRoot));
  const service = registry.getById('stack-service');
  const act = async action => { const result = await action(service, registry); assert.equal(result.ok, true); await writeServiceState(service, result.state); };
  const read = async (query = 'serviceId=stack-service&serviceId=never-run', headers) => {
    const res = await fetch(`${runtime.url}/api/operator/v2/stack-runtime?${query}`, { headers });
    return {status:res.status, body:await res.json()};
  };
  let release; const gate = new Promise(resolve => release = resolve);
  let submission;
  try {
    let result = await read(); assert.equal(result.status, 200);
    assert.equal(result.body.data.rows[0].stackIntent, "optional");
    assert.equal(result.body.data.rows[0].uptimeMs, null);
    assert.equal(result.body.data.rows[0].restartCount, null);
    assert.deepEqual(result.body.data.activeOperations, {scope:'workspace', count:0});
    for (const action of [installService, configService, startService]) await act(action);
    const first = (await read()).body.data;
    assert.ok(first.coreUptimeMs >= 0); assert.ok(first.rows[0].uptimeMs >= 0);
    assert.equal(first.rows[0].restartCount, 0);
    await act(restartService);
    result = await read(); assert.equal(result.body.data.rows[0].restartCount, 1);
    assert.ok(result.body.data.coreUptimeMs >= first.coreUptimeMs);
    await act(stopService); assert.equal((await read()).body.data.rows[0].uptimeMs, null);
    await act(startService);
    process.kill(getLifecycleState('stack-service').runtime.pid, 'SIGKILL');
    for (let i=0; i<100 && getLifecycleState('stack-service').running; i++) await new Promise(resolve=>setTimeout(resolve,10));
    result = await read();
    assert.equal(result.body.data.rows[0].uptimeMs, null);
    assert.equal(result.body.data.incidents[0].kind, 'service_stopped');
    assert.ok(Number.isFinite(Date.parse(result.body.data.incidents[0].at)));
    // Restart then intentionally stop: ordinary operator stops are not incidents.
    await act(startService); await act(stopService);
    const emitted = await emitOperatorInboxServiceEvent(workspaceRoot, {serviceId:'stack-service', kind:'health.unhealthy', summary:'PRIVATE_URL_SECRET', observedAt:'2026-11-27T00:00:00.000Z'});
    result = await read(); assert.deepEqual(result.body.data.incidents, [{at:'2026-11-27T00:00:00.000Z', serviceId:'stack-service', kind:'health_failed'}]);
    await mutateOperatorInboxItem(workspaceRoot, emitted.items.find(item => item.relatedTarget?.serviceId === 'stack-service').id, 'hide');
    assert.deepEqual((await read()).body.data.incidents, []);
    const operations = new McpOperationService({workspaceRoot, requestBudgetMs:10});
    submission = await operations.submit({
      authorization:{actor:{kind:'local-token', actorId:'test-owner', clientId:'test-client', scopes:['service-lasso:read','service-lasso:update:write'], permissionProfile:'maintainer'}},
      action:'update_check', targetIds:['stack-service'], cancellationSupported:false,
      execute:async () => { await gate; throw new Error('PRIVATE_OPERATION_FAILURE'); },
    });
    assert.equal(submission.kind, 'accepted');
    const before = await readFile(mcpOperationStatePath(workspaceRoot));
    result = await read(); assert.equal(result.body.data.activeOperations.count, 1);
    assert.equal(result.body.data.incidents[0].kind, 'operation_active');
    const auditBefore = await readAuditEvents({workspaceRoot});
    await read(); assert.deepEqual(await readFile(mcpOperationStatePath(workspaceRoot)), before, 'reads must not mutate operation records');
    assert.deepEqual(await readAuditEvents({workspaceRoot}), auditBefore, 'read must not append permission/operation audit records');
    const activeState = await readPrivateJson(workspaceRoot, mcpOperationStatePath(workspaceRoot));
    const staleState = structuredClone(activeState); staleState.operations[0].heartbeatAt = '2000-01-01T00:00:00.000Z';
    await writePrivateJson(workspaceRoot, mcpOperationStatePath(workspaceRoot), staleState);
    result = await read(); assert.equal(result.body.data.activeOperations,null); assert.equal(result.body.data.incidents,null);
    await writePrivateJson(workspaceRoot, mcpOperationStatePath(workspaceRoot), activeState);
    release();
    for (let i=0; i<100; i++) { result = await read(); if(result.body.data.activeOperations.count === 0) break; await new Promise(resolve=>setTimeout(resolve,10)); }
    assert.equal(result.body.data.activeOperations.count, 0); assert.equal(result.body.data.incidents[0].kind, 'operation_failed');
    assert.doesNotMatch(JSON.stringify(result.body), /PRIVATE_|test-owner|test-client|operationId|summary/);
    const trusted = {'x-service-lasso-internal-proxy':'serviceadmin','x-service-lasso-proxy':'serviceadmin','x-service-lasso-trusted-ingress':'serviceadmin-loopback','x-service-lasso-client-address':'192.0.2.61'};
    assert.equal((await read(undefined, trusted)).status,401);
    assert.equal((await read(undefined, {...trusted,'x-service-lasso-zitadel-user-id':'denied','x-service-lasso-zitadel-roles':'no-permissions'})).status,403);
    const viewer = await read(undefined, {...trusted,'x-service-lasso-zitadel-user-id':'viewer','x-service-lasso-zitadel-roles':'viewer'});
    assert.equal(viewer.status,200); assert.equal(viewer.body.data.activeOperations,null);
    for (const query of ['serviceId=missing','serviceId=..','serviceId=stack-service&serviceId=stack-service','other=x',Array.from({length:26},(_,i)=>`serviceId=s${i}`).join('&')]) assert.equal((await read(query)).status,400);
    assert.deepEqual((await read('')).body.data.rows,[]);
    const inboxPath = path.join(workspaceRoot, '.state', 'operator-inbox.json');
    const savedInbox = await readFile(inboxPath);
    await writeFile(inboxPath, '{bad json');
    assert.equal((await read()).body.data.incidents, null);
    assert.equal((await read()).body.data.activeOperations.count, 0);
    await writeFile(inboxPath, savedInbox);
    const opPath = mcpOperationStatePath(workspaceRoot);
    const savedOps = await readFile(opPath);
    await writeFile(opPath, '{bad json');
    result = await read(); assert.equal(result.body.data.activeOperations,null); assert.equal(result.body.data.incidents,null);
    assert.ok(result.body.data.coreUptimeMs >= first.coreUptimeMs);
    await writeFile(opPath,savedOps);
    await runtime.stop(); resetLifecycleState();
    runtime = await startApiServer({port:0, servicesRoot, workspaceRoot});
    assert.equal((await read()).body.data.rows[0].restartCount,1,'restart counter survives runtime hydration');
  } finally { release(); await runtime.stop(); await rm(tempRoot,{recursive:true,force:true}); resetLifecycleState(); }
});


test('AC-SR-6/7 verifies real baseline startup intent and exact checkout endpoint selection', async (t) => {
  resetLifecycleState();
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot('stack-intent-');
  let runtime;
  const route = {
    SERVICE_LASSO_SERVICES_ROOT: servicesRoot,
    SERVICE_LASSO_WORKSPACE_ROOT: workspaceRoot,
    SERVICE_LASSO_INSTANCE_REGISTRY_PATH: path.join(tempRoot, 'instances.json'),
    SERVICE_LASSO_HOST_PORT_REGISTRY_PATH: path.join(tempRoot, 'ports.json'),
  };
  for (const [name, value] of Object.entries(route)) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
  }
  try {
    await writeExecutableFixtureService(servicesRoot, '@serviceadmin');
    await writeExecutableFixtureService(servicesRoot, 'gated-daemon');
    await writeExecutableFixtureService(servicesRoot, 'provider', { role: 'provider', enabled: false });
    await writeExecutableFixtureService(servicesRoot, 'provider-unprepared', { role: 'provider' });
    await writeExecutableFixtureService(servicesRoot, 'optional-daemon');
    await writeExecutableFixtureService(servicesRoot, 'disabled-daemon', { enabled: false });
    runtime = await startApiServer({
      port: 0, servicesRoot, workspaceRoot,
      baselineBootstrap: { serviceIds: ['@serviceadmin', 'gated-daemon', 'provider', 'disabled-daemon'] },
    });
    assert.equal(await checkoutRuntimeOrigin(), new URL(runtime.url).origin);
    process.env.SERVICE_LASSO_WORKSPACE_ROOT = path.join(tempRoot, 'separate-workspace');
    assert.equal(await checkoutRuntimeOrigin(), null);
    process.env.SERVICE_LASSO_WORKSPACE_ROOT = workspaceRoot;
    const ids = ['@serviceadmin', 'gated-daemon', 'provider', 'provider-unprepared', 'optional-daemon', 'disabled-daemon'];
    const query = new URLSearchParams(ids.map(id => ['serviceId', id]));
    const response = await fetch(`${runtime.url}/api/operator/v2/stack-runtime?${query}`);
    assert.equal(response.status, 200);
    const { data } = await response.json();
    assert.deepEqual(Object.fromEntries(data.rows.map(row => [row.serviceId, row.stackIntent])), {
      '@serviceadmin': 'expected',
      'gated-daemon': 'gated',
      'provider': 'prepared',
      'provider-unprepared': 'unprepared',
      'optional-daemon': 'optional',
      'disabled-daemon': 'disabled',
    });
    assert.ok(data.rows[0].uptimeMs >= 0);
    assert.equal(data.rows[1].uptimeMs, null);
  } finally {
    await runtime?.stop();
    await rm(tempRoot, {recursive: true, force: true});
    resetLifecycleState();
  }
});
