import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startRuntimeApp } from '../dist/runtime/app.js';
import { DEFAULT_BASELINE_SERVICE_IDS } from '../dist/runtime/cli/bootstrap.js';
import { requestLocalTuiSession } from '../dist/runtime/auth/local-tui-session.js';

const coreRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const expectedDefaultDaemons = Object.freeze(['@nginx', '@secretsbroker', '@serviceadmin', '@traefik', 'echo-service']);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function jsonRequest(apiUrl, route, body) {
  const response = await fetch(new URL(route, apiUrl), {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(150_000),
  });
  assert.equal(response.ok, true, `E2E HTTP ${response.status} for ${route}`);
  return await response.json();
}

async function historicalTuiManifest(tag) {
  assert.match(tag, /^candidate-\d{4}\.\d{1,2}\.\d{1,2}-[a-f0-9]{7}$/);
  const repo = 'service-lasso/service-lasso-tui';
  const response = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${tag}`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'service-lasso-e2e' },
    signal: AbortSignal.timeout(20_000),
  });
  assert.equal(response.ok, true, 'Historical public release metadata unavailable');
  const release = await response.json();
  assert.equal(release.tag_name, tag);
  assert.equal(release.draft, false);
  assert.equal(release.immutable, true);
  const assets = release.assets.filter(asset => asset.name === 'service.json');
  assert.equal(assets.length, 1);
  const [asset] = assets;
  assert.equal(asset.browser_download_url, `https://github.com/${repo}/releases/download/${tag}/service.json`);
  const downloaded = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(30_000) });
  assert.equal(downloaded.ok, true);
  const bytes = Buffer.from(await downloaded.arrayBuffer());
  assert.ok(bytes.length > 0 && bytes.length < 128 * 1024);
  assert.equal(bytes.length, asset.size);
  assert.equal('sha256:' + digest(bytes), asset.digest);
  const manifest = JSON.parse(bytes);
  assert.equal(manifest.id, '@tui');
  assert.equal(manifest.role, 'provider');
  assert.equal(manifest.artifact.source.repo, repo);
  assert.equal(manifest.artifact.source.tag, tag);
  return bytes;
}

/** Starts one real default stack per process. The caller owns close() in finally. */
export async function startPinnedReleaseE2eStack({ previousTuiTag } = {}) {
  assert.equal(process.platform, "linux", "This private-session E2E currently requires Linux");
  const scratchRoot = await mkdtemp(path.join(os.tmpdir(), 'lasso-pinned-release-e2e-'));
  const servicesRoot = path.join(scratchRoot, 'services');
  const workspaceRoot = path.join(scratchRoot, 'workspace');
  const homeRoot = path.join(scratchRoot, 'home');
  const savedEnvironment = new Map();
  const setEnvironment = (name, value) => {
    if (!savedEnvironment.has(name)) savedEnvironment.set(name, process.env[name]);
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  };
  let app;
  let closed = false;
  let generationId;
  const manifestPath = path.join(servicesRoot, '@tui', 'service.json');
  let originalTuiManifest;
  const close = async () => {
    if (closed) return;
    closed = true;
    try {
      if (app) {
        await app.apiServer.stop();
        await assert.rejects(fetch(app.apiServer.url + "/api/health", { signal: AbortSignal.timeout(2_000) }),
          "Owned Core listener remained reachable after shutdown");
      }
      await rm(scratchRoot, { recursive: true, force: true });
    } finally {
      for (const [name, value] of savedEnvironment) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
    }
  };
  try {
    await mkdir(servicesRoot, { recursive: true, mode: 0o700 });
    await mkdir(workspaceRoot, { mode: 0o700 });
    await mkdir(path.join(homeRoot, 'config'), { recursive: true, mode: 0o700 });
    // Read only Git-tracked manifests. Runtime data from the caller's checkout is never copied.
    for (const id of DEFAULT_BASELINE_SERVICE_IDS) {
      const bytes = execFileSync('git', ['show', `HEAD:services/${id}/service.json`], { cwd: coreRoot });
      await mkdir(path.join(servicesRoot, id), { mode: 0o700 });
      await writeFile(path.join(servicesRoot, id, 'service.json'), bytes, { mode: 0o600 });
    }
    if (previousTuiTag) await writeFile(manifestPath, await historicalTuiManifest(previousTuiTag), { mode: 0o600 });
    originalTuiManifest = await readFile(manifestPath);
    for (const name of Object.keys(process.env).filter(name => name.startsWith('SERVICE_LASSO_'))) setEnvironment(name, undefined);
    setEnvironment('SERVICE_LASSO_RUNTIME_API_BASE_URL', undefined);
    for (const name of ['GH_TOKEN', 'GITHUB_TOKEN']) setEnvironment(name, undefined);
    const isolated = {
      SERVICE_LASSO_SERVICES_ROOT: servicesRoot,
      SERVICE_LASSO_WORKSPACE_ROOT: workspaceRoot,
      SERVICE_LASSO_INSTANCE_REGISTRY_PATH: path.join(scratchRoot, 'instances.json'),
      SERVICE_LASSO_HOST_PORT_REGISTRY_PATH: path.join(scratchRoot, 'ports.json'),
      SERVICE_LASSO_PORT_RANGE_START: '23000',
      SERVICE_LASSO_PORT_RANGE_END: '55000',
    };
    for (const [name, value] of Object.entries(isolated)) setEnvironment(name, value);
    app = await startRuntimeApp({ port: 0, host: '127.0.0.1', baselineBootstrap: { serviceIds: [...DEFAULT_BASELINE_SERVICE_IDS] }, monitor: true });
    const apiUrl = app.apiServer.url;
    const initial = await jsonRequest(apiUrl, '/api/runtime/instance');
    generationId = initial.instance.generationId;
    const setup = await jsonRequest(apiUrl, '/api/setup/bootstrap', {});
    assert.equal(setup.bootstrap.ok, true);
    assert.equal(setup.bootstrap.continuation.ok, true);
    const verifyHealthy = async () => {
      const identity = await jsonRequest(apiUrl, '/api/runtime/instance');
      assert.equal(identity.instance.generationId, generationId);
      assert.equal(identity.instance.pid, initial.instance.pid);
      const inventory = await jsonRequest(apiUrl, '/api/services');
      const running = inventory.services.filter(service => service.lifecycle.running);
      assert.deepEqual(running.map(service => service.id).sort(), [...expectedDefaultDaemons].sort());
      for (const service of running) {
        assert.equal(service.health.healthy, true, `${service.id} must be healthy`);
        assert.equal(service.lifecycle.runtime.generationId, generationId);
      }
      for (const id of ['@cli', '@tui']) {
        const provider = inventory.services.find(service => service.id === id);
        assert.equal(provider.lifecycle.installed, true);
        assert.equal(provider.lifecycle.configured, true);
        assert.equal(provider.lifecycle.running, false);
      }
      return { generationId, daemons: running.map(service => service.id).sort() };
    };
    const healthDeadline = Date.now() + 60_000;
    for (;;) {
      try { await verifyHealthy(); break; }
      catch (error) {
        if (Date.now() >= healthDeadline) throw error;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
    const binding = { workspaceRoot, servicesRoot, generationId, origin: new URL(apiUrl).origin };
    await assert.rejects(requestLocalTuiSession(binding));
    const acknowledgement = await jsonRequest(apiUrl, '/api/runtime/auth/first-run/acknowledge', {});
    assert.equal(acknowledgement.firstRun.credentialsAcknowledged, true);
    const privateSession = await requestLocalTuiSession(binding);
    const env = { ...process.env, HOME: homeRoot, XDG_CONFIG_HOME: path.join(homeRoot, 'config'),
      SERVICE_LASSO_API_URL: new URL(apiUrl).origin, SERVICE_LASSO_API_TOKEN: privateSession };
    return { apiUrl, servicesRoot, workspaceRoot, env, generationId, originalTuiManifest,
      verifyHealthy, close, request: (route, body) => jsonRequest(apiUrl, route, body) };
  } catch (error) {
    await close();
    throw error;
  }
}
