import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { x as extractTar } from 'tar';
import { createHash } from 'node:crypto';
import { managedAdminUpstreamEnvironment } from '../dist/runtime/lifecycle/admin-upstream.js';
import { planAndReserveRuntimeEndpoints, releaseRuntimeEndpointAllocation } from '../dist/runtime/ports/allocation.js';
import { startApiServer } from '../dist/server/index.js';
import { restartService } from '../dist/runtime/lifecycle/actions.js';
import { discoverServices } from '../dist/runtime/discovery/discoverServices.js';
import { createServiceRegistry } from '../dist/runtime/manager/DependencyGraph.js';
import { getLifecycleState, resetLifecycleState } from '../dist/runtime/lifecycle/store.js';
import { makeTempServicesRoot, writeExecutableFixtureService } from './test-helpers.js';

async function withEnvironment(t, fixture) {
  const entries = {
    SERVICE_LASSO_HOST_PORT_REGISTRY_PATH: path.join(fixture.tempRoot, 'ports.json'),
    SERVICE_LASSO_INSTANCE_REGISTRY_PATH: path.join(fixture.tempRoot, 'instances.json'),
  };
  for (const [key, value] of Object.entries(entries)) {
    const old = process.env[key]; process.env[key] = value;
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
  }
}

// The default-port case is allocation projection only: it never binds or probes 17883.
for (const port of [17883, 48083]) test(`AC-4CG.1991 Admin projects exact allocated API ${port} and rejects stale bindings`, async t => {
  const fixture = await makeTempServicesRoot('admin-upstream-plan-');
  await withEnvironment(t, fixture);
  let plan;
  try {
    plan = await planAndReserveRuntimeEndpoints({ ...fixture, laneId: 'owned-admin', generationId: 'owned-generation',
      services: [], api: { host: '127.0.0.1', port, policy: 'fixed' }, probePort: async () => true });
    const options = { workspaceRoot: fixture.workspaceRoot, runtimeGenerationId: 'owned-generation', allocationRevision: plan.allocationId };
    assert.deepEqual(await managedAdminUpstreamEnvironment('@serviceadmin', options), {
      SERVICE_LASSO_API_BASE_URL: `http://127.0.0.1:${port}`,
      SERVICE_LASSO_RUNTIME_API_BASE_URL: `http://127.0.0.1:${port}`,
    });
    for (const patch of [{ runtimeGenerationId: 'stale' }, { allocationRevision: 'stale' }, { workspaceRoot: undefined }]) {
      await assert.rejects(managedAdminUpstreamEnvironment('@serviceadmin', { ...options, ...patch }), /managed_admin_upstream_unverified/);
    }
    await releaseRuntimeEndpointAllocation(plan);
    await assert.rejects(managedAdminUpstreamEnvironment('@serviceadmin', options), /managed_admin_upstream_unverified/);
    assert.deepEqual(await managedAdminUpstreamEnvironment('other-service', options), {});
    assert.deepEqual(await managedAdminUpstreamEnvironment('@serviceadmin', { workspaceRoot: fixture.workspaceRoot }), {});
  } finally {
    if (plan) await releaseRuntimeEndpointAllocation(plan);
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

async function waitJson(file) {
  for (let attempt = 0; attempt < 40; attempt++) {
    try { return JSON.parse(await readFile(file, 'utf8')); } catch { await new Promise(resolve => setTimeout(resolve, 25)); }
  }
  throw new Error('Owned fixture did not publish environment');
}

for (const native of [false, true]) test(`AC-4CG.1991 ${native ? 'pinned real Admin' : 'managed child'} routes to owned alternate Core despite stale env`, {
  skip: native && !process.env.SERVICE_LASSO_TEST_ADMIN_RELEASE_ROOT,
}, async t => {
  const fixture = await makeTempServicesRoot('admin-upstream-owned-');
  await withEnvironment(t, fixture);
  let decoyRequests = 0;
  const decoy = http.createServer((request, response) => { decoyRequests++; response.end('{}'); });
  await new Promise(resolve => decoy.listen(0, '127.0.0.1', resolve));
  const stale = `http://127.0.0.1:${decoy.address().port}`;
  for (const key of ['SERVICE_LASSO_API_BASE_URL', 'SERVICE_LASSO_RUNTIME_API_BASE_URL']) {
    const old = process.env[key]; process.env[key] = stale;
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
  }
  let runtime;
  try {
    const service = await writeExecutableFixtureService(fixture.servicesRoot, '@serviceadmin', {
      ports: { ui: 42000 }, captureEnvKeys: ['SERVICE_LASSO_API_BASE_URL', 'SERVICE_LASSO_RUNTIME_API_BASE_URL'],
      env: { SERVICE_PORT: '${UI_PORT}', SERVICE_HOST: '127.0.0.1', SERVICE_LASSO_API_BASE_URL: stale, SERVICE_LASSO_RUNTIME_API_BASE_URL: stale },
    });
    if (native) {
      const baseline = JSON.parse(await readFile(new URL('../services/@serviceadmin/service.json', import.meta.url), 'utf8'));
      assert.equal(baseline.artifact.source.tag, '2026.11.2-dda9f96');
      const releaseRoot = process.env.SERVICE_LASSO_TEST_ADMIN_RELEASE_ROOT;
      const archive = await readFile(path.join(releaseRoot, '@serviceadmin-linux.tar.gz'));
      assert.equal(createHash('sha256').update(archive).digest('hex'), '051f904a36fcec92c5e120a3aad28842c2dc02ccd0c4de448fd160f4134f1642');
      const manifest = JSON.parse(await readFile(path.join(service.serviceRoot, 'service.json'), 'utf8'));
      const extracted = path.join(fixture.tempRoot, 'verified-admin-release');
      await mkdir(extracted);
      await extractTar({ file: path.join(releaseRoot, '@serviceadmin-linux.tar.gz'), cwd: extracted, strict: true });
      manifest.args = [path.join(extracted, 'runtime/server.js')];
      delete manifest.healthcheck;
      // HTTP readiness proves the pinned child listens before any upstream read.
      manifest.healthchecks = [{ id: 'ui', type: 'http', url: 'http://127.0.0.1:${UI_PORT}/', expected_status: 200, retries: 40, interval: 50 }];
      await writeFile(path.join(service.serviceRoot, 'service.json'), JSON.stringify(manifest));
    }
    runtime = await startApiServer({ ...fixture, port: 0, baselineBootstrap: { serviceIds: ['@serviceadmin'] } });
    const actual = new URL(runtime.url).origin;
    assert.notEqual(actual, stale);
    const discovered = await discoverServices(fixture.servicesRoot);
    const registry = createServiceRegistry(discovered);
    const check = async () => {
      if (!native) {
        const env = await waitJson(path.join(service.serviceRoot, 'runtime/env.json'));
        assert.equal(env.SERVICE_LASSO_API_BASE_URL, actual);
        assert.equal(env.SERVICE_LASSO_RUNTIME_API_BASE_URL, actual);
      } else {
        const ui = `http://127.0.0.1:${getLifecycleState('@serviceadmin').runtime.ports.ui}`;
        const setup = await fetch(ui + '/api/setup/status');
        assert.equal(setup.status, 200);
        assert.equal((await setup.json()).setup.state, 'setup_required');
        const identity = await fetch(ui + '/api/runtime/instance');
        assert.equal(identity.status, 200);
        assert.equal((await identity.json()).instance.generationId, runtime.generationId);
      }
      assert.equal(decoyRequests, 0);
    };
    await check();
    const priorPid = getLifecycleState('@serviceadmin').runtime.pid;
    const restarted = await restartService(registry.getById('@serviceadmin'), registry, {
      workspaceRoot: fixture.workspaceRoot, runtimeGenerationId: runtime.generationId,
      runtimeInstanceId: runtime.instanceId, allocationRevision: runtime.endpointAllocationPlan.allocationId,
      plannedPorts: getLifecycleState('@serviceadmin').runtime.ports,
    });
    assert.equal(restarted.ok, true);
    assert.notEqual(getLifecycleState('@serviceadmin').runtime.pid, priorPid);
    await check();
  } finally {
    await runtime?.stop();
    await new Promise(resolve => decoy.close(resolve));
    resetLifecycleState();
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('AC-4CG.1991 non-loopback allocated upstream fails closed without probing the host', async t => {
  const fixture = await makeTempServicesRoot('admin-upstream-remote-denial-');
  await withEnvironment(t, fixture);
  let plan;
  try {
    plan = await planAndReserveRuntimeEndpoints({ ...fixture, laneId: 'owned-admin', generationId: 'owned-generation',
      services: [], api: { host: '192.0.2.1', port: 48084, policy: 'fixed' }, probePort: async () => true });
    await assert.rejects(managedAdminUpstreamEnvironment('@serviceadmin', {
      workspaceRoot: fixture.workspaceRoot, runtimeGenerationId: 'owned-generation', allocationRevision: plan.allocationId,
    }), error => error.message === "managed_admin_upstream_unverified: Cannot verify Service Admin's owning Core endpoint.");
  } finally {
    if (plan) await releaseRuntimeEndpointAllocation(plan);
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});
