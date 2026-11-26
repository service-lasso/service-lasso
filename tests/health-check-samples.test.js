import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { startRuntimeApp } from '../dist/runtime/app.js';
import { createApiServer, waitForApiServerInitialization, startApiServer } from '../dist/server/index.js';
import { discoverServices } from '../dist/runtime/discovery/discoverServices.js';
import { createServiceRegistry } from '../dist/runtime/manager/DependencyGraph.js';
import { configService, installService, startService } from '../dist/runtime/lifecycle/actions.js';
import { getLifecycleState, resetLifecycleState } from '../dist/runtime/lifecycle/store.js';
import { writeServiceState } from '../dist/runtime/state/writeState.js';
import { HttpCheckSampleRecorder, primaryHttpCheck } from '../dist/runtime/health/samples.js';
import { makeTempServicesRoot, writeExecutableFixtureService } from './test-helpers.js';

// AC-HCS-1..6: real runtime monitor -> real HTTP evaluator -> passive API read.
test('runtime HTTP check samples reflect real success/failure/delay without probes on reads', async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot('http-check-samples-');
  const workspaceRoot = path.join(tempRoot, 'workspace');
  await mkdir(workspaceRoot, {recursive:true});
  let status = 200, delay = 0, probes = 0;
  const target = createServer((_request, response) => {
    probes++;
    setTimeout(() => { response.writeHead(status); response.end('PRIVATE_BODY_SENTINEL'); }, delay);
  });
  target.listen(0, '127.0.0.1'); await once(target, 'listening');
  const targetUrl = `http://127.0.0.1:${target.address().port}/PRIVATE_URL_SENTINEL`;
  await writeExecutableFixtureService(servicesRoot, 'sample-service', {
    healthcheck: { type: 'http', url: targetUrl, cookies: { session: 'PRIVATE_COOKIE_SENTINEL' } },
    monitoring: { enabled: true, intervalSeconds: 1 },
    restartPolicy: { enabled: true, onCrash: false, onUnhealthy: false },
  });
  await writeExecutableFixtureService(servicesRoot, 'no-http');
  // A very long timer lets the controlled runOnce calls use the ordinary monitor
  // source deterministically; a short-timer listener below proves actual scheduling.
  const runtime = await startApiServer({ port: 0, servicesRoot, workspaceRoot, monitor: true, monitorIntervalMs: 60_000 });
  let isolated;
  const read = async (query = 'serviceId=sample-service&serviceId=no-http') => {
    const response = await fetch(`${runtime.url}/api/operator/v2/health-check-samples?${query}`);
    return { status: response.status, body: await response.json() };
  };
  try {
    const registry = createServiceRegistry(await discoverServices(servicesRoot));
    const service = registry.getById('sample-service');
    for (const action of [installService, configService, startService]) {
      const result = await action(service, registry); await writeServiceState(service, result.state);
    }
    let result = await read();
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.data.rows.map(row => [row.state, row.samples.length]), [['configured', 0], ['not_configured', 0]]);
    const trusted = {
      'x-service-lasso-internal-proxy': 'serviceadmin',
      'x-service-lasso-proxy': 'serviceadmin',
      'x-service-lasso-trusted-ingress': 'serviceadmin-loopback',
      'x-service-lasso-client-address': '192.0.2.61',
    };
    const endpoint = `${runtime.url}/api/operator/v2/health-check-samples?serviceId=sample-service`;
    const denied = await fetch(endpoint, { headers: { ...trusted, 'x-service-lasso-zitadel-user-id': 'no-role', 'x-service-lasso-zitadel-roles': 'no-permissions' } });
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).error.code, 'permission_denied');
    const unauth = await fetch(endpoint, { headers: trusted });
    assert.equal(unauth.status, 401);
    assert.equal((await unauth.json()).error.code, 'authentication_required');
    const viewer = await fetch(endpoint, { headers: { ...trusted, 'x-service-lasso-zitadel-user-id': 'read-viewer', 'x-service-lasso-zitadel-roles': 'viewer' } });
    assert.equal(viewer.status, 200);
    const before = probes;
    await runtime.monitor.runOnce();
    status = 503; delay = 45;
    await runtime.monitor.runOnce();
    result = await read();
    const samples = result.body.data.rows[0].samples;
    assert.deepEqual(samples.map(sample => sample.passed), [true, false]);
    assert.ok(samples[1].durationMs >= 40);
    assert.equal(probes, before + 2);
    for (let i = 0; i < 3; i++) assert.deepEqual((await read()).body.data.rows, result.body.data.rows);
    assert.equal(probes, before + 2, 'passive reads must not probe');
    assert.equal(result.body.data.windowSeconds, 900);
    assert.deepEqual(Object.keys(result.body.data).sort(), ['observedAt', 'rows', 'windowSeconds']);
    assert.deepEqual(Object.keys(samples[0]).sort(), ['at', 'durationMs', 'passed']);
    assert.ok(samples.every(sample => Number.isInteger(sample.durationMs) && sample.durationMs >= 0 && Number.isFinite(Date.parse(sample.at))));
    assert.doesNotMatch(JSON.stringify(result.body), /PRIVATE_|127\.0\.0\.1|cookies|detail|serviceRoot/);
    for (const query of ['', 'serviceId=missing', 'serviceId=..', 'serviceId=sample-service&serviceId=sample-service', 'serviceId=sample-service&windowSeconds=1', Array.from({length:26}, (_,i) => `serviceId=s${i}`).join('&')]) {
      assert.equal((await read(query)).status, 400, query);
    }
    const isolatedServer = createApiServer({ servicesRoot, workspaceRoot });
    await waitForApiServerInitialization(isolatedServer);
    isolatedServer.listen(0, '127.0.0.1'); await once(isolatedServer, 'listening');
    isolated = { stop: () => new Promise(resolve => { isolatedServer.closeAllConnections(); isolatedServer.close(resolve); }) };
    const isolatedRows = (await (await fetch(`http://127.0.0.1:${isolatedServer.address().port}/api/operator/v2/health-check-samples?serviceId=sample-service`)).json()).data.rows;
    assert.deepEqual(isolatedRows[0].samples, [], 'new runtime never inherits samples');
    await isolated.stop(); isolated = null;
    const manifestPath = service.manifestPath;
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.healthcheck.expected_status = 503;
    await writeFile(manifestPath, JSON.stringify(manifest));
    assert.deepEqual((await read()).body.data.rows[0].samples, [], 'reconfiguration clears samples before next probe');
    await runtime.monitor.runOnce();
    assert.deepEqual((await read()).body.data.rows[0].samples, [], 'boot registry probes must not be relabeled as changed configuration');
    manifest.enabled = false;
    await writeFile(manifestPath, JSON.stringify(manifest));
    assert.equal((await read()).body.data.rows[0].state, 'not_configured');
    // Keep the legacy monitor admission/snapshot unchanged; current disabled
    // configuration is hidden by the passive projection.
    await runtime.monitor.runOnce();
    assert.deepEqual((await read()).body.data.rows[0].samples, []);
  } finally {
    await isolated?.stop(); await runtime.stop();
    target.closeAllConnections(); await new Promise(resolve => target.close(resolve));
    await rm(tempRoot, { recursive: true, force: true }); resetLifecycleState();
  }
});

test('recorder caps/ages chronological samples and rejects late old configuration observations', () => {
  let clock = new Date('2026-11-27T00:00:00Z');
  const recorder = new HttpCheckSampleRecorder(() => clock);
  const check = { type: 'http', url: 'http://localhost/one' };
  const service = { manifest: { id: 'bounded', healthchecks: [{type:'process'}, check, {type:'http',url:'http://localhost/two'}] }, serviceRoot: '/private' };
  const lifecycle = getLifecycleState('bounded');
  assert.equal(primaryHttpCheck(service), check);
  const observe = recorder.observer(service, lifecycle, {});
  for (let i = 0; i < 80; i++) { clock = new Date(clock.getTime()+1000); observe(check, true, i); }
  let row = recorder.row(service, lifecycle, {});
  assert.equal(row.samples.length, 60); assert.equal(row.samples[0].durationMs, 20);
  const changed = { ...service, manifest: { ...service.manifest, healthchecks: [{ ...check, url: 'http://localhost/changed' }] } };
  assert.deepEqual(recorder.row(changed, lifecycle, {}).samples, []);
  observe(check, false, 100); assert.deepEqual(recorder.row(changed, lifecycle, {}).samples, []);
  recorder.observer(changed, lifecycle, {})(changed.manifest.healthchecks[0], true, 1);
  clock = new Date(clock.getTime()+900_001);
  assert.deepEqual(recorder.row(changed, lifecycle, {}).samples, []);
  clock = new Date('2026-11-27T00:00:00Z');
  const corrected = recorder.observer(changed, lifecycle, {});
  corrected(changed.manifest.healthchecks[0], true, 2);
  clock = new Date(clock.getTime()-1000);
  assert.deepEqual(recorder.row(changed, lifecycle, {}).samples, [], 'future samples hidden after wall-clock rollback');
  corrected(changed.manifest.healthchecks[0], false, 3);
  clock = new Date(clock.getTime()+2000);
  const ordered = recorder.row(changed, lifecycle, {}).samples;
  assert.deepEqual(ordered.map(sample=>sample.passed), [false,true]);
  assert.deepEqual(recorder.row({ ...service, manifest: { ...service.manifest, enabled: false } }, lifecycle, {}).samples, []);
});

// Direct timer proof: no manual monitor invocation and no illustrated sample input.
test('ordinary product entrypoint opt-in schedules real HTTP samples and explicit false wins', async () => {
  const previousMonitor = process.env.SERVICE_LASSO_MONITOR;
  const previousUrl = process.env.SERVICE_LASSO_RUNTIME_API_BASE_URL;
  process.env.SERVICE_LASSO_MONITOR = '1';
  resetLifecycleState();
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot('http-samples-scheduled-');
  let probes = 0;
  const target = createServer((_request, response) => { probes++; response.end('ok'); });
  target.listen(0, '127.0.0.1'); await once(target, 'listening');
  await writeExecutableFixtureService(servicesRoot, 'scheduled-http', {
    healthcheck: {type:'http',url:`http://127.0.0.1:${target.address().port}/health`},
    monitoring: {enabled:true}, restartPolicy: {enabled:true,onCrash:false,onUnhealthy:false},
  });
  const app = await startRuntimeApp({port:0,servicesRoot,workspaceRoot,monitorIntervalMs:40});
  const runtime = app.apiServer;
  assert.ok(runtime.monitor);
  try {
    const registry = createServiceRegistry(await discoverServices(servicesRoot));
    const service = registry.getById('scheduled-http');
    for (const action of [installService,configService,startService]) {
      const result = await action(service,registry); await writeServiceState(service,result.state);
    }
    const deadline = Date.now()+5000;
    let samples=[];
    while (Date.now()<deadline) {
      const response = await fetch(`${runtime.url}/api/operator/v2/health-check-samples?serviceId=scheduled-http`);
      assert.equal(response.status,200);
      samples=(await response.json()).data.rows[0].samples;
      if (samples.length) break;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert.ok(samples.length>0,'scheduled existing runtime source must produce real samples');
    assert.ok(samples.every(sample=>sample.passed)); assert.ok(probes>0);
  } finally {
    await runtime.stop();
    const disabled = await startRuntimeApp({port:0,servicesRoot,workspaceRoot,monitor:false,monitorIntervalMs:40});
    assert.equal(disabled.apiServer.monitor,null);
    await disabled.apiServer.stop();
    target.closeAllConnections(); await new Promise(resolve=>target.close(resolve));
    await rm(tempRoot,{recursive:true,force:true}); resetLifecycleState();
    if (previousMonitor === undefined) delete process.env.SERVICE_LASSO_MONITOR; else process.env.SERVICE_LASSO_MONITOR=previousMonitor;
    if (previousUrl === undefined) delete process.env.SERVICE_LASSO_RUNTIME_API_BASE_URL; else process.env.SERVICE_LASSO_RUNTIME_API_BASE_URL=previousUrl;
  }
});
