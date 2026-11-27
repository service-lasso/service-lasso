import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { bootstrapBaselineServices } from '../dist/runtime/cli/bootstrap.js';
import { BaselineStartupError, startupFailureMessage } from '../dist/runtime/cli/startup-diagnostics.js';
import { ReleaseAcquisitionError } from '../dist/runtime/setup/acquire.js';
import { stopAllManagedProcesses } from '../dist/runtime/execution/supervisor.js';
import { resetLifecycleState } from '../dist/runtime/lifecycle/store.js';
import { ensureTestSecretsBrokerReady, makeTempServicesRoot, writeExecutableFixtureService } from './test-helpers.js';

const privateValue = 'private-secret-C:/private/workspace';

test('AC-4CG.1983 rate-limit and unknown failures retain service/action without raw exception output', () => {
  for (const action of ['install', 'config', 'setup', 'start']) {
    const original = new Error(privateValue);
    const error = new BaselineStartupError('@serviceadmin', action, original);
    assert.equal(error.cause, original);
    assert.match(startupFailureMessage(error), new RegExp(`service="@serviceadmin" action=${action} phase=${action} reason=${action}_failed`));
    assert.equal(error.message.includes(privateValue), false);
  }
  const error = new BaselineStartupError('@node', 'install', new ReleaseAcquisitionError());
  assert.equal(error.reason, 'github_release_metadata_rate_limited');
  assert.match(error.message, /service="@node" action=install/);
});

for (const scenario of ['install', 'config', 'setup', 'spawn', 'readiness']) {
  test(`AC-4CG.1983 onboarded real lifecycle ${scenario} failure reports a safe attributed reason`, async () => {
    const fixture = await makeTempServicesRoot('service-lasso-startup-diagnostic-');
    try {
      await ensureTestSecretsBrokerReady(fixture.workspaceRoot);
      const options = scenario === 'readiness'
        ? { healthchecks: [{ id: 'missing-ready', type: 'file', file: `./${privateValue}`, retries: 1, interval: 1 }] }
        : scenario === 'setup'
          ? { setup: { steps: { fail: { executable: process.execPath, args: ['-e', `throw new Error(${JSON.stringify(privateValue)})`], timeoutSeconds: 5 } } } }
          : scenario === 'install' || scenario === 'config'
            ? { [scenario]: { files: [{ path: `../${privateValue}`, content: 'refuse traversal' }] } }
            : {};
      const service = await writeExecutableFixtureService(fixture.servicesRoot, 'required-daemon', options);
      if (scenario === 'spawn') {
        const manifestPath = path.join(service.serviceRoot, 'service.json');
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
        manifest.executable = path.join(service.serviceRoot, privateValue, 'missing-executable');
        await writeFile(manifestPath, JSON.stringify(manifest));
      }
      await assert.rejects(bootstrapBaselineServices({ ...fixture, serviceIds: ['required-daemon'] }), error => {
        assert.ok(error instanceof BaselineStartupError);
        assert.equal(error.serviceId, 'required-daemon');
        const phase = scenario === 'spawn' ? 'process_spawn' : scenario === 'readiness' ? 'health_check' : scenario;
        assert.equal(error.phase, phase);
        assert.equal(error.action, scenario === 'spawn' || scenario === 'readiness' ? 'start' : scenario);
        assert.equal(error.message.includes(privateValue), false);
        assert.equal(error.message.includes(fixture.tempRoot), false);
        return true;
      });
    } finally {
      await stopAllManagedProcesses();
      resetLifecycleState();
      await rm(fixture.tempRoot, { recursive: true, force: true });
    }
  });
}

test('AC-4CG.1983 occupied fixed source API fails visibly and preserves the foreign listener and its workspace', async () => {
  const fixture = await makeTempServicesRoot('service-lasso-source-conflict-');
  const listener = net.createServer(socket => socket.end('foreign-listener-preserved'));
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  const marker = path.join(fixture.tempRoot, 'foreign-workspace-marker');
  await writeFile(marker, privateValue);
  try {
    await assert.rejects(promisify(execFile)(process.execPath, ['scripts/source-stack.mjs', 'start'], {
      env: { ...process.env, SERVICE_LASSO_SERVICES_ROOT: fixture.servicesRoot,
        SERVICE_LASSO_WORKSPACE_ROOT: fixture.workspaceRoot, SERVICE_LASSO_PORT: String(port),
        SERVICE_LASSO_HOST_PORT_REGISTRY_PATH: path.join(fixture.tempRoot, 'ports.json'),
        SERVICE_LASSO_INSTANCE_REGISTRY_PATH: path.join(fixture.tempRoot, 'instances.json') },
      timeout: 15000,
    }), error => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /service=runtime-api phase=port_selection reason=endpoint_allocation_conflict/);
      assert.match(error.stderr, new RegExp(`127.0.0.1:${port}`));
      assert.match(error.stderr, /SERVICE_LASSO_PORT/);
      assert.equal(error.stderr.includes(privateValue), false);
      return true;
    });
    assert.equal(await readFile(marker, 'utf8'), privateValue);
    const result = await new Promise((resolve, reject) => {
      const socket = net.connect(port, '127.0.0.1');
      socket.on('data', value => resolve(value.toString())); socket.on('error', reject);
    });
    assert.equal(result, 'foreign-listener-preserved');
  } finally {
    await new Promise(resolve => listener.close(resolve));
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('AC-4CG.1983 required daemon preflight port conflict retains service attribution', async () => {
  const fixture = await makeTempServicesRoot('service-lasso-daemon-conflict-');
  const listener = net.createServer(socket => socket.end('preserved'));
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  try {
    await writeExecutableFixtureService(fixture.servicesRoot, 'required-daemon', {
      endpoints: [{ id: 'http', kind: 'network', direction: 'inbound', transport: 'tcp',
        bind: '127.0.0.1', port: { default: port, strategy: 'fixed' } }],
    });
    await assert.rejects(promisify(execFile)(process.execPath, ['dist/cli.js', 'start',
      '--services-root', fixture.servicesRoot, '--workspace-root', fixture.workspaceRoot], {
      env: { ...process.env, SERVICE_LASSO_HOST_PORT_REGISTRY_PATH: path.join(fixture.tempRoot, 'ports.json'),
        SERVICE_LASSO_INSTANCE_REGISTRY_PATH: path.join(fixture.tempRoot, 'instances.json') }, timeout: 15000,
    }), error => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /service="required-daemon" phase=port_selection reason=endpoint_allocation_conflict/);
      assert.equal(error.stderr.includes(fixture.tempRoot), false);
      return true;
    });
    assert.equal(listener.listening, true);
  } finally {
    await new Promise(resolve => listener.close(resolve));
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});
