import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverServices } from '../dist/runtime/discovery/discoverServices.js';
import { resolveActivatedOperatorExecutable } from '../dist/runtime/updates/pinned-operator-release.js';
import { startPinnedReleaseE2eStack } from './pinned-release-e2e-stack.mjs';

const previousTuiTag = process.env.SERVICE_LASSO_E2E_PREVIOUS_TUI_TAG ?? 'candidate-2026.11.27-6a057bc';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stack = await startPinnedReleaseE2eStack({ previousTuiTag });
try {
  const before = await stack.verifyHealthy();
  const check = await stack.request('/api/services/%40tui/pinned-release/check', {});
  assert.equal(check.currentTag, previousTuiTag);
  assert.equal(check.status, 'update_available');
  assert.ok(check.candidateTag && check.candidateTag !== previousTuiTag);
  const unconfirmed = await fetch(new URL('/api/services/%40tui/pinned-release/install', stack.apiUrl), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tag: check.candidateTag }), signal: AbortSignal.timeout(20_000),
  });
  assert.equal(unconfirmed.status, 409);
  const result = await stack.request('/api/services/%40tui/pinned-release/install', { tag: check.candidateTag, confirm: true });
  assert.equal(result.installedTag, check.candidateTag);
  assert.deepEqual(await readFile(path.join(stack.servicesRoot, '@tui', 'service.json')), stack.originalTuiManifest);
  const service = (await discoverServices(stack.servicesRoot)).find(service => service.manifest.id === '@tui');
  const binary = await resolveActivatedOperatorExecutable(service);
  assert.ok(binary);
  const launched = spawnSync(process.execPath, [path.join(root, 'dist/cli.js'), 'tui', '--help'], {
    cwd: root, env: stack.env, encoding: 'utf8', timeout: 15_000,
  });
  assert.equal(launched.status, 2, 'Installed TUI help did not exit with the documented status');
  assert.match(launched.stderr, /Usage of /);
  const current = await stack.request('/api/services/%40tui/pinned-release/check', {});
  assert.equal(current.status, 'current');
  assert.equal(current.currentTag, check.candidateTag);
  assert.deepEqual(await stack.verifyHealthy(), before);
  console.log(JSON.stringify({ schema: 'service-lasso.pinned-release-e2e.v1', core: root,
    previousTuiTag, installedTag: result.installedTag, generationId: stack.generationId,
    healthyDaemons: before.daemons, unconfirmedDenied: true, sourceManifestPreserved: true,
    installedExecutableSha256: createHash('sha256').update(await readFile(binary)).digest('hex'),
    installedLaunchExit: launched.status, coreRestarted: false }));
} finally {
  await stack.close();
}
