// SPEC-007 AC-7F/AC-7G.docs-consumers. Separate evidence, never a release-gate substitute.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
  const site = path.join(root, mode, 'docs');
  await cp(path.join(repo, 'docs'), site, { recursive: true,
    filter: (source) => !['build', '.docusaurus', 'node_modules'].includes(path.basename(source)) });
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
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      assert.ok(pathname.startsWith('/service-lasso/'));
      let relative = pathname.slice('/service-lasso/'.length);
      assert.ok(!relative.split('/').includes('..'));
      if (!relative || relative.endsWith('/')) relative += 'index.html';
      else if (!path.extname(relative)) relative += '.html';
      const file = path.join(buildResult.out, relative);
      const bytes = await readFile(file);
      response.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream' });
      response.end(bytes);
    } catch {
      response.writeHead(404); response.end('Not found');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch();
    for (const scenario of ['native-math', 'legacy-math', 'invalid-mermaid']) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const responses = [], failures = [], pageErrors = [], pending = [];
      const observations = {};
      let scenarioError;
      page.on('pageerror', (error) => pageErrors.push(error.message));
      page.on('requestfailed', (request) => failures.push({ url: request.url(), error: request.failure() }));
      page.on('response', (response) => {
        const task = (async () => {
          const url = new URL(response.url());
          assert.equal(url.origin, origin, 'the qualification consumer must use only its local built assets');
          const body = await response.body();
          const relative = decodeURIComponent(url.pathname.slice('/service-lasso/'.length));
          responses.push({ url: response.url(), path: relative, status: response.status(), sha256: sha256(body) });
        })();
        // Attach a handler immediately, while preserving rejection for the assertion below.
        task.catch(() => {});
        pending.push(task);
      });
      try {
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
          assert.deepEqual(pageErrors, [], 'valid consumer pages must not crash');
        }
        await Promise.all(pending);
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
        receipt.checks.push({ kind: 'actual-built-browser-consumer', scenario });
      } catch (error) {
        scenarioError = { message: error.message, stack: error.stack }; throw error;
      } finally {
        const pendingResults = await Promise.allSettled(pending);
        const responseErrors = pendingResults.filter((result) => result.status === 'rejected').map((result) => String(result.reason));
        const html = await page.content();
        await writeFile(path.join(root, `${scenario}-browser.html`), html);
        await writeFile(path.join(root, `${scenario}-browser.json`), JSON.stringify({ scenario, responses,
          failures, pageErrors, observations, error: scenarioError, responseErrors, htmlSha256: sha256(html) }, null, 2));
        await page.screenshot({ path: path.join(root, `${scenario}.png`), fullPage: true });
        await context.close();
      }
    }
  } finally {
    await browser?.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
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
