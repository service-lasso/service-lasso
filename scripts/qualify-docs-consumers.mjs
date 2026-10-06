// SPEC-007 AC-7F/AC-7G.docs-consumers. Separate evidence, never a release-gate substitute.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from '@playwright/test';

const repo = fileURLToPath(new URL('../', import.meta.url));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const parent = path.join(repo, '.docs-consumer-qualification');
await mkdir(parent, { recursive: true });
const root = await mkdtemp(path.join(parent, 'run-'));
const receipt = { status: 'running', root, node: process.version, commands: [], checks: [] };
console.log(`Private documentation consumer evidence: ${root}`);
const save = () => writeFile(path.join(root, 'receipt.json'), JSON.stringify(receipt, null, 2));
const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
const fixtures = path.join(repo, 'tests/fixtures/docs-consumers');
const cli = path.join(repo, 'node_modules/@docusaurus/core/bin/docusaurus.mjs');
const execFileAsync = promisify(execFile);
async function gitRead(args) {
  const { stdout } = await execFileAsync('git', args, { cwd: repo, encoding: 'buffer', maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}

async function copyTrackedSource(mode) {
  assert.notEqual(process.platform, 'win32',
    'this standalone Linux consumer job does not admit Windows filesystems without complete reparse-attribute verification');
  const status = await gitRead(['status', '--porcelain=v1', '-z']);
  const head = (await gitRead(['rev-parse', 'HEAD'])).toString('utf8').trim();
  const tree = (await gitRead(['rev-parse', 'HEAD^{tree}'])).toString('utf8').trim();
  const index = await gitRead(['ls-files', '--stage', '-z']);
  await writeFile(path.join(root, `${mode}-source-status.raw`), status);
  await writeFile(path.join(root, `${mode}-source-index.raw`), index);
  await writeFile(path.join(root, `${mode}-source-head.txt`), `${head}\n${tree}\n`);
  const diagnostic = { mode, head, tree, statusBytes: status.length,
    statusSha256: sha256(status), indexSha256: sha256(index), changedTracked: [] };
  if (status.length) {
    const diff = await gitRead(['diff', '--no-ext-diff', '--no-textconv', '--binary', 'HEAD', '--']);
    await writeFile(path.join(root, `${mode}-source-tracked.diff`), diff);
    diagnostic.trackedDiffSha256 = sha256(diff);
    const changed = await gitRead(['diff', '--no-ext-diff', '--no-textconv', '--name-only', '-z', 'HEAD', '--']);
    await writeFile(path.join(root, `${mode}-source-tracked-changed.raw`), changed);
    for (const relative of changed.toString('utf8').split('\0').filter(Boolean)) {
      const metadata = { path: relative };
      try {
        assert.ok(!path.isAbsolute(relative) && relative.split('/').every((part) => part && part !== '..' && part !== '.'));
        const parts = relative.split('/');
        for (let count = 1; count <= parts.length; count++) {
          const stat = await lstat(path.join(repo, ...parts.slice(0, count)));
          assert.ok(!stat.isSymbolicLink());
          assert.ok(count === parts.length ? stat.isFile() : stat.isDirectory());
        }
        const bytes = await readFile(path.join(repo, relative));
        metadata.bytes = bytes.length; metadata.sha256 = sha256(bytes);
      } catch (error) {
        metadata.readRefused = error.message;
      }
      diagnostic.changedTracked.push(metadata);
    }
  }
  await writeFile(path.join(root, `${mode}-source-diagnostic.json`), JSON.stringify(diagnostic, null, 2));
  receipt.sourceDiagnostics ??= [];
  receipt.sourceDiagnostics.push(diagnostic);
  await save();
  assert.equal(status.length, 0, 'qualification source must be a clean committed checkout');
  const source = path.join(root, mode, 'source');
  const inventory = [];
  const sourceStat = await lstat(repo);
  assert.ok(sourceStat.isDirectory() && !sourceStat.isSymbolicLink(), 'source root must be a regular directory');
  async function regularPath(parts, relative) {
    for (let count = 1; count <= parts.length; count++) {
      const stat = await lstat(path.join(repo, ...parts.slice(0, count)));
      assert.ok(!stat.isSymbolicLink(), `source links/reparse ancestry are forbidden: ${relative}`);
      assert.ok(count === parts.length ? stat.isFile() : stat.isDirectory(), `missing/nonregular source: ${relative}`);
    }
  }
  for (const entry of index.toString('utf8').split('\0').filter(Boolean)) {
    const match = /^(100644|100755) ([a-f0-9]{40}) 0\t(.+)$/.exec(entry);
    assert.ok(match, 'tracked inputs must be regular stage-zero source files, never links or submodules');
    const relative = match[3];
    assert.ok(!path.isAbsolute(relative) && relative.split('/').every((part) => part && part !== '..' && part !== '.'),
      'tracked source path must remain inside its private root');
    const parts = relative.split('/');
    await regularPath(parts, relative);
    const original = path.join(repo, relative);
    const bytes = await readFile(original);
    const digest = sha256(bytes);
    const destination = path.join(source, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes, { flag: 'wx' });
    assert.equal(sha256(await readFile(destination)), digest, relative);
    assert.equal(sha256(await readFile(original)), digest, `source drift while copying: ${relative}`);
    await regularPath(parts, relative);
    inventory.push({ path: relative, trackedBlob: match[2], mode: match[1], bytes: bytes.length, sha256: digest });
  }
  assert.equal((await gitRead(['status', '--porcelain=v1', '-z'])).length, 0, 'source drift after copy');
  assert.equal((await gitRead(['rev-parse', 'HEAD'])).toString('utf8').trim(), head, 'source head drift');
  assert.deepEqual(await gitRead(['ls-files', '--stage', '-z']), index, 'tracked source inventory drift');
  await writeFile(path.join(root, `${mode}-tracked-source-inventory.json`), JSON.stringify({ head, inventory }, null, 2));
  receipt.sourceHead ??= head;
  assert.equal(receipt.sourceHead, head, 'ordinary and pooled builds must consume identical tracked source');
  const inventoryDigest = sha256(Buffer.from(JSON.stringify(inventory)));
  receipt.sourceInventorySha256 ??= inventoryDigest;
  assert.equal(receipt.sourceInventorySha256, inventoryDigest, 'ordinary/pooled physical source bytes must be identical');
  return path.join(source, 'docs');
}

async function command(label, args, extraEnv = {}) {
  const log = path.join(root, `${label}.log`);
  const started = new Date().toISOString();
  const child = spawn(process.execPath, args, { cwd: repo, shell: false,
    env: { ...process.env, ...extraEnv } });
  const output = [];
  const stdout = [], stderr = [];
  child.stdout.on('data', (bytes) => { stdout.push(bytes); output.push(bytes); process.stdout.write(bytes); });
  child.stderr.on('data', (bytes) => { stderr.push(bytes); output.push(bytes); process.stderr.write(bytes); });
  let spawnError;
  child.on('error', (error) => { spawnError = error; });
  const [code, signal] = await new Promise((resolve) => child.once('close', (...result) => resolve(result)));
  const bytes = Buffer.concat(output);
  await writeFile(log, bytes);
  await writeFile(path.join(root, `${label}.stdout`), Buffer.concat(stdout));
  await writeFile(path.join(root, `${label}.stderr`), Buffer.concat(stderr));
  receipt.commands.push({ label, executable: process.execPath, args, extraEnv,
    started, ended: new Date().toISOString(), code, signal, spawnError: spawnError?.message,
    log, sha256: sha256(bytes) });
  await save();
  assert.equal(spawnError, undefined);
  assert.equal(signal, null);
  assert.equal(code, 0, `${label} failed; retain ${log}`);
  return bytes.toString('utf8').replace(/\u001b\[[0-9;]*m/g, '');
}

async function htmlInventory(dir, prefix = '') {
  const rows = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) rows.push(...await htmlInventory(path.join(dir, entry.name), relative));
    else if (entry.name.endsWith('.html')) {
      const bytes = await readFile(path.join(dir, entry.name));
      const html = bytes.toString('utf8');
      rows.push({ path: relative, sha256: sha256(bytes), bytes: bytes.length,
        h1: [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map((match) =>
          match[1].replace(/<[^>]*>/g, '')) });
    }
  }
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

async function build(mode) {
  const site = await copyTrackedSource(mode);
  const out = path.join(root, mode, 'build');
  if (mode === 'pooled') {
    await cp(fixtures, path.join(site, 'qualification-fixtures'), { recursive: true });
    await cp(path.join(fixtures, 'qualification-config.cjs'), path.join(site, 'qualification-config.cjs'));
  }
  const args = [cli, 'build', site, '--out-dir', out];
  if (mode === 'pooled') args.push('--config', path.join(site, 'qualification-config.cjs'));
  const logs = await command(mode, args, mode === 'pooled' ? {
    DOCUSAURUS_PERF_LOGGER: 'true', DOCUSAURUS_SSG_WORKER_THREAD_COUNT: '2',
    DOCUSAURUS_SSG_WORKER_THREAD_TASK_SIZE: '10',
  } : {});
  const inventory = await htmlInventory(out);
  assert.ok(inventory.length > 10, 'must build the whole current documentation site');
  await writeFile(path.join(root, `${mode}-html-inventory.json`), JSON.stringify(inventory, null, 2));
  if (mode === 'pooled') {
    const renderedWorkers = new Set([...logs.matchAll(/SSG Worker (\d+) - Task \d+ - Rendering (\d+) pathnames/g)]
      .filter((match) => Number(match[2]) > 0).map((match) => match[1]));
    assert.ok(renderedWorkers.size >= 2, 'two actual Docusaurus SSG workers must render current routes');
    assert.doesNotMatch(logs, /\[KO\]/, 'Docusaurus must not report failed pooled tasks');
    receipt.checks.push({ kind: 'actual-pooled-ssg', renderedWorkers: [...renderedWorkers] });
  }
  return { site, out, inventory };
}

function moduleFiles(evidence, suffix) {
  const matches = evidence.modules.filter((module) => module.resource.replaceAll('\\', '/').endsWith(suffix));
  assert.ok(matches.length, `missing compiled selected source ${suffix}`);
  return matches;
}

async function browserCheck(buildResult, expected) {
  const compiler = await json(path.join(buildResult.site, 'qualification-client-modules.json'));
  const assets = new Map(compiler.assets.map((asset) => [asset.name, asset.sha256]));
  const official = new Map(expected.files.map((file) => [file.path, file.sha256]));
  for (const module of compiler.modules) {
    const normalized = module.resource.replaceAll('\\', '/');
    const marker = '/node_modules/';
    const relative = normalized.slice(normalized.lastIndexOf(marker) + marker.length);
    if (official.has(relative)) assert.equal(module.resourceSha256, official.get(relative), normalized);
  }
  const katexModules = moduleFiles(compiler, '/node_modules/katex/dist/katex.mjs');
  for (const module of katexModules) {
    const selected = expected.files.find((file) => file.path === 'katex/dist/katex.mjs');
    assert.equal(module.resourceSha256, selected.sha256);
    assert.equal(module.compilerSourceSha256, selected.sha256,
      'the actual bundled KaTeX module must retain the selected official source, without replacement loaders');
  }
  moduleFiles(compiler, '/node_modules/mermaid/dist/mermaid.core.mjs');
  assert.equal(compiler.modules.some((module) => /\/mermaid\.(?:esm(?:\.min)?\.mjs|(?:min\.)?js)$/.test(module.resource.replaceAll('\\', '/'))), false,
    'qualify the actual default package import; do not replace it with the embedded standalone build');
  const elkModules = compiler.modules.filter((module) => /\/node_modules\/@mermaid-js\/layout-elk\/dist\/chunks\/mermaid-layout-elk\.core\/render-[^/]+\.mjs$/.test(module.resource.replaceAll('\\', '/')));
  assert.ok(elkModules.length > 0, 'actual ELK lazy renderer must be emitted');

  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
  const describeError = (error) => ({ message: String(error?.message ?? error), stack: error?.stack });
  const captureErrors = [], cleanupErrors = [], scenarioResults = [], serverRequests = [], serverTasks = [];
  let primaryError;
  async function attempt(stage, action, errors) {
    try { return await action(); }
    catch (error) { errors.push({ stage, ...describeError(error) }); }
  }
  // These are private observations, not an alternative browser-byte authority.
  await mkdir(path.join(root, 'server-responses'));
  const server = createServer((request, response) => {
    const record = { id: String(serverRequests.length + 1), method: request.method,
      url: request.url, headers: request.headers, rawHeaders: request.rawHeaders, errors: [] };
    serverRequests.push(record);
    request.on('error', (error) => record.errors.push({ stage: 'request', ...describeError(error) }));
    response.on('error', (error) => record.errors.push({ stage: 'response', ...describeError(error) }));
    response.on('finish', () => { record.finished = true; record.status = response.statusCode; });
    response.on('close', () => { record.closed = true; record.writableFinished = response.writableFinished; });
    const task = (async () => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      assert.ok(pathname.startsWith('/service-lasso/'));
      let relative = pathname.slice('/service-lasso/'.length);
      assert.ok(!relative.split('/').includes('..'));
      if (!relative || relative.endsWith('/')) relative += 'index.html';
      else if (!path.extname(relative)) relative += '.html';
      const file = path.join(buildResult.out, relative);
      const bytes = await readFile(file);
      record.path = relative; record.readBytes = bytes.length; record.readSha256 = sha256(bytes);
      record.savedBody = `server-responses/${record.id}.body`;
      await writeFile(path.join(root, record.savedBody), bytes, { flag: 'wx' });
      record.savedSha256 = sha256(await readFile(path.join(root, record.savedBody)));
      assert.equal(record.savedSha256, record.readSha256);
      response.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream',
        'X-Qualification-Request-Id': record.id });
      response.end(bytes);
    } catch (error) {
      record.errors.push({ stage: 'serve', ...describeError(error) });
      if (!response.headersSent) response.writeHead(404, { 'X-Qualification-Request-Id': record.id });
      response.end('Not found');
    }
    })();
    task.catch(() => {}); serverTasks.push(task);
  });
  let browser;
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch();
    for (const scenario of ['native-math', 'legacy-math', 'invalid-mermaid']) {
      let context, page;
      const responses = [], failures = [], pageErrors = [], pending = [], requests = [], transport = [];
      const scenarioCaptureErrors = [], scenarioCleanupErrors = [], validationErrors = [];
      const observations = {};
      let scenarioError, htmlSha256;
      const requestIds = new WeakMap();
      const requestIdentity = (request) => {
        if (!requestIds.has(request)) {
          const id = String(requests.length + 1); requestIds.set(request, id);
          const record = { id, url: request.url(), method: request.method(), resourceType: request.resourceType(),
            headers: request.headers() };
          requests.push(record);
          record.redirectedFrom = request.redirectedFrom() ? requestIdentity(request.redirectedFrom()) : null;
        }
        return requestIds.get(request);
      };
      async function drainResponses() {
        let count;
        do { count = pending.length; await Promise.allSettled(pending.slice()); } while (count !== pending.length);
      }
      try {
      context = await browser.newContext();
      page = await context.newPage();
      const session = await context.newCDPSession(page);
      for (const event of ['requestWillBeSent', 'responseReceived', 'requestServedFromCache', 'loadingFinished', 'loadingFailed']) {
        session.on(`Network.${event}`, (data) => transport.push({ event, ...data }));
      }
      // Observation only: do not override methods, cache, service workers or responses.
      await session.send('Network.enable');
      page.on('request', requestIdentity);
      page.on('pageerror', (error) => pageErrors.push(error.message));
      page.on('requestfailed', (request) => failures.push({ id: requestIdentity(request), url: request.url(),
        method: request.method(), resourceType: request.resourceType(), error: request.failure() }));
      page.on('response', (response) => {
        const request = response.request();
        const record = { requestId: requestIdentity(request), url: response.url(), status: response.status(),
          method: request.method(), resourceType: request.resourceType(), requestHeaders: request.headers(),
          responseHeaders: response.headers(), fromServiceWorker: response.fromServiceWorker() };
        responses.push(record);
        const task = (async () => {
          try {
          const url = new URL(response.url());
          assert.equal(url.origin, origin, 'the qualification consumer must use only its local built assets');
          const body = await response.body();
          const relative = decodeURIComponent(url.pathname.slice('/service-lasso/'.length));
          record.path = relative; record.bodyBytes = body.length; record.sha256 = sha256(body);
          record.sizes = await request.sizes(); record.timing = request.timing();
          } catch (error) { record.error = describeError(error); throw error; }
        })();
        // Attach a handler immediately, while preserving rejection for the assertion below.
        task.catch(() => {});
        pending.push(task);
      });
        await page.goto(`${origin}/service-lasso/__qualification/${scenario}`, { waitUntil: 'networkidle' });
        const containers = page.locator('.docusaurus-mermaid-container');
        if (scenario === 'invalid-mermaid') {
          await page.getByText(/This page crashed|Parse error|Error parsing/i).first().waitFor();
          assert.equal(await containers.locator('svg').count(), 0, 'invalid diagram cannot be accepted as a render');
        } else {
          await containers.locator('math').first().waitFor();
          assert.equal(await containers.locator('svg').count(), scenario === 'native-math' ? 2 : 1);
          const math = await containers.locator('math').first().textContent();
          observations.math = math;
          assert.match(math, /x/); assert.match(math, /2/); assert.match(math, /1/);
          assert.equal(await containers.locator('a[href]').count(), 0);
          if (scenario === 'native-math') {
            await containers.nth(1).locator('svg').waitFor();
            assert.equal(await containers.locator('.katex-html').count(), 0, 'default Mermaid must use native MathML');
            const elk = containers.nth(1);
            assert.equal(await elk.locator('g.node').count(), 4);
            assert.equal(await elk.locator('.flowchart-link').count(), 4);
            const geometry = await elk.locator('svg').evaluate((svg) => ({ viewBox: svg.getAttribute('viewBox'),
              nodes: [...svg.querySelectorAll('g.node')].map((node) => node.getAttribute('transform')) }));
            observations.elk = geometry;
            assert.ok(geometry.viewBox); assert.equal(new Set(geometry.nodes).size, 4);
          } else {
            await containers.locator('.katex-html').first().waitFor();
            await page.evaluate(() => document.fonts.ready);
            const computed = await page.locator('.consumer-css > span').first().evaluate((element) => {
              const style = getComputedStyle(element); return { color: style.color, margin: style.marginLeft };
            });
            assert.deepEqual(computed, { color: 'rgb(255, 0, 0)', margin: '2px' });
            const font = await containers.locator('.katex-html .mathnormal').first().evaluate((element) => getComputedStyle(element).fontFamily);
            observations.css = computed; observations.font = font;
            assert.match(font, /KaTeX_Math/);
          }
        }
        await page.evaluate(() => document.fonts.ready);
        await page.waitForLoadState('networkidle');
      } catch (error) {
        scenarioError = error;
      } finally {
        if (page) {
          await attempt('content', async () => {
            const html = await page.content(); htmlSha256 = sha256(html);
            await writeFile(path.join(root, `${scenario}-browser.html`), html);
          }, scenarioCaptureErrors);
          await attempt('screenshot', () => page.screenshot({ path: path.join(root, `${scenario}.png`), fullPage: true }), scenarioCaptureErrors);
          await drainResponses();
        }
        if (context) await attempt('context.close', () => context.close(), scenarioCleanupErrors);
        await drainResponses();
      }
      const pendingResults = await Promise.allSettled(pending);
      const responseErrors = pendingResults.filter((result) => result.status === 'rejected').map((result) => describeError(result.reason));
      const diagnostic = { scenario, responses, requests, transport, failures, pageErrors, observations,
        error: scenarioError ? describeError(scenarioError) : null, responseErrors, htmlSha256,
        captureErrors: scenarioCaptureErrors, cleanupErrors: scenarioCleanupErrors, validationErrors };
      // Save original observations before the unchanged compiler-byte assertion.
      await attempt('pre-assertion-browser-diagnostic', () => writeFile(path.join(root, `${scenario}-browser.json`), JSON.stringify(diagnostic, null, 2)), scenarioCaptureErrors);
      try {
        assert.deepEqual(responseErrors, [], 'late browser response capture must not hide asset errors');
        if (scenario !== 'invalid-mermaid') assert.deepEqual(pageErrors, [], 'valid consumer pages must not crash');
        else {
          // Only the deliberately malformed flowchart parse error is expected.
          const expectedErrors = pageErrors.filter((message) => /^Parse error on line \d+:[\s\S]*A -->\[[\s\S]*Expecting /i.test(message));
          diagnostic.expectedPageErrors = expectedErrors;
          assert.deepEqual(pageErrors, expectedErrors, 'invalid Mermaid must not conceal unrelated page crashes');
        }
        assert.deepEqual(failures, [], 'built assets must load successfully');
        assert.ok(responses.every((response) => response.status === 200), 'no missing consumer assets');
        for (const response of responses.filter((item) => /\.(?:js|css|woff2?|ttf)$/.test(item.path))) {
          assert.ok(assets.has(response.path), `requested asset missing from actual compiler inventory: ${response.path}`);
          assert.equal(response.sha256, assets.get(response.path), response.path);
        }
        const requested = new Set(responses.map((response) => response.path));
        const used = (modules) => modules.some((module) => module.files.some((file) => requested.has(file)));
        if (scenario !== 'invalid-mermaid') assert.ok(used(katexModules), 'actual rendered math must request selected KaTeX emitted chunk');
        if (scenario === 'native-math') assert.ok(used(elkModules), 'actual ELK diagram must request the ELK renderer chunk');
        if (scenario === 'legacy-math') {
          assert.ok(used(moduleFiles(compiler, '/node_modules/katex/dist/katex.css')), 'actual legacy render must load selected CSS asset');
          const fonts = expected.files.filter((file) => file.path.endsWith('.woff2'));
          assert.ok(responses.some((response) => fonts.some((font) => response.sha256 === font.sha256)),
            'actual legacy render must download an official selected KaTeX font');
        }
      } catch (error) {
        if (!scenarioError) scenarioError = error;
        else validationErrors.push(describeError(error));
      }
      diagnostic.error = scenarioError ? describeError(scenarioError) : null;
      diagnostic.status = scenarioError || scenarioCaptureErrors.length || scenarioCleanupErrors.length ? 'failed' : 'provisional';
      await attempt('terminal-browser-diagnostic', () => writeFile(path.join(root, `${scenario}-browser.json`), JSON.stringify(diagnostic, null, 2)), scenarioCaptureErrors);
      captureErrors.push(...scenarioCaptureErrors.map((error) => ({ scenario, ...error })));
      cleanupErrors.push(...scenarioCleanupErrors.map((error) => ({ scenario, ...error })));
      scenarioResults.push(diagnostic);
      if (scenarioError) throw scenarioError;
      if (scenarioCaptureErrors.length || scenarioCleanupErrors.length) throw new Error(`browser evidence/cleanup failed: ${scenario}`);
    }
  } catch (error) {
    primaryError = error;
  } finally {
    // Initiate independent closes before waiting: a browser rejection cannot skip the server.
    await Promise.allSettled([
      attempt('browser.close', async () => { if (browser) await browser.close(); }, cleanupErrors),
      attempt('server.close', () => new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        // Owned HTTP connections must settle even if browser.close rejects.
        server.closeAllConnections();
      }), cleanupErrors),
    ]);
    const serverResults = await Promise.allSettled(serverTasks);
    for (const result of serverResults) if (result.status === 'rejected') {
      cleanupErrors.push({ stage: 'server-task', ...describeError(result.reason) });
    }
    await attempt('server-diagnostic', () => writeFile(path.join(root, 'browser-server.json'), JSON.stringify({
      requests: serverRequests, error: primaryError ? describeError(primaryError) : null, captureErrors, cleanupErrors }, null, 2)), captureErrors);
    receipt.browserOutcome = { error: primaryError ? describeError(primaryError) : null, captureErrors, cleanupErrors,
      scenarios: scenarioResults.map(({ scenario, status }) => ({ scenario, status })) };
  }
  if (primaryError) throw primaryError;
  assert.deepEqual(captureErrors, [], 'browser evidence capture must succeed');
  assert.deepEqual(cleanupErrors, [], 'every browser/context/server cleanup must succeed');
  assert.deepEqual(serverRequests.flatMap((request) => request.errors), [], 'server observations must have no errors');
  for (const result of scenarioResults) {
    result.status = 'passed';
    await writeFile(path.join(root, `${result.scenario}-browser.json`), JSON.stringify(result, null, 2));
    receipt.checks.push({ kind: 'actual-built-browser-consumer', scenario: result.scenario });
  }
  receipt.browserOutcome.scenarios = scenarioResults.map(({ scenario, status }) => ({ scenario, status }));
}

try {
  assert.match(process.version, /^v22\./, 'this qualification unit is bound to Node 22');
  const expected = await json(path.join(fixtures, 'official-source-files.json'));
  for (const pkg of expected.packages) {
    const installed = await json(path.join(repo, 'node_modules', pkg.name, 'package.json'));
    assert.equal(installed.name, pkg.name); assert.equal(installed.version, pkg.version);
  }
  for (const file of expected.files) {
    const installed = path.join(repo, 'node_modules', file.path);
    assert.equal(sha256(await readFile(installed)), file.sha256, `official installed bytes: ${file.path}`);
  }
  const ssgRequire = createRequire(path.join(repo, 'node_modules/@docusaurus/core/lib/ssg/ssgExecutor.js'));
  const tinypool = ssgRequire.resolve('tinypool');
  assert.equal(path.relative(path.join(repo, 'node_modules'), tinypool).replaceAll('\\', '/'), 'tinypool/dist/index.js');
  receipt.checks.push({ kind: 'official-installed-source-inventory', files: expected.files.length,
    docusaurusTinypoolResolved: tinypool });
  await save();
  const ordinary = await build('ordinary');
  const pooled = await build('pooled');
  const pooledByPath = new Map(pooled.inventory.map((row) => [row.path, row]));
  for (const row of ordinary.inventory) {
    const other = pooledByPath.get(row.path);
    assert.ok(other, `pooled rendering lost current route ${row.path}`);
    assert.deepEqual(other.h1, row.h1, `pooled rendering changed current route title ${row.path}`);
  }
  receipt.checks.push({ kind: 'full-current-html-route-parity', ordinaryRoutes: ordinary.inventory.length,
    pooledRoutes: pooled.inventory.length });
  await browserCheck(pooled, expected);
  receipt.status = 'passed';
} catch (error) {
  receipt.status = 'failed'; receipt.error = { message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  await save();
  console.log(`Documentation consumer result: ${receipt.status}; ${path.join(root, 'receipt.json')}`);
}
