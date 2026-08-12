#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile, readdir } from 'node:fs/promises';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignoredCheckedInCatalogIds = new Set(['node-sample-service']);

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function exists(filePath) {
  try {
    await readFile(filePath, 'utf8');
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

export async function loadServiceManifests(root = repoRoot) {
  const servicesRoot = path.join(root, 'services');
  const entries = await readdir(servicesRoot, { withFileTypes: true });
  const manifests = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(servicesRoot, entry.name, 'service.json');
    if (!(await exists(manifestPath))) continue;
    manifests.push({
      folder: entry.name,
      path: path.relative(root, manifestPath).replaceAll('\\\\', '/'),
      manifest: await readJson(manifestPath),
    });
  }

  return manifests.sort((left, right) => left.manifest.id.localeCompare(right.manifest.id));
}

export async function loadCatalog(root = repoRoot) {
  const catalog = await readJson(path.join(root, 'docs', 'static', 'data', 'service-catalog.json'));
  if (!Array.isArray(catalog.services)) {
    throw new Error('docs/static/data/service-catalog.json must contain a services array.');
  }
  return catalog.services;
}

export async function loadDefaultBaselineIds(root = repoRoot) {
  const distPath = path.join(root, 'dist', 'runtime', 'cli', 'bootstrap.js');
  if (await exists(distPath)) {
    const module = await import(pathToFileURL(distPath).href);
    return [...module.DEFAULT_BASELINE_SERVICE_IDS];
  }

  const source = await readFile(path.join(root, 'src', 'runtime', 'cli', 'bootstrap.ts'), 'utf8');
  const match = source.match(/DEFAULT_BASELINE_SERVICE_IDS\s*=\s*\[([^\]]+)\]/m);
  if (!match) throw new Error('Could not locate DEFAULT_BASELINE_SERVICE_IDS.');
  return [...match[1].matchAll(/\"([^\"]+)\"/g)].map(([, serviceId]) => serviceId);
}

export function parseReadmeBaselineTable(readme) {
  const lines = readme.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => /^## Baseline Services\s*$/.test(line));
  if (headingIndex === -1) return [];
  const rows = [];

  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (index > headingIndex + 1 && /^##\s+/.test(line)) break;
    if (!line.startsWith('| `')) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    const serviceId = cells[0]?.match(/^`([^`]+)`$/)?.[1];
    if (!serviceId) continue;
    rows.push({
      serviceId,
      releaseTag: cells[2]?.match(/release `([^`]+)`/)?.[1] ?? null,
    });
  }

  return rows;
}

export function parseMarkdownBulletIds(markdown, marker) {
  const lines = markdown.split(/\r?\n/);
  const markerIndex = lines.findIndex((line) => line.includes(marker));
  if (markerIndex === -1) return [];
  const ids = [];

  for (let index = markerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      if (ids.length > 0) break;
      continue;
    }
    if (!line.startsWith('- ')) {
      if (ids.length > 0) break;
      continue;
    }
    const match = line.match(/`([^`]+)`/);
    if (match) ids.push(match[1]);
  }

  return ids;
}

function addMismatch(problems, label, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    problems.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
  }
}

export async function verifyServiceCatalog(root = repoRoot) {
  const [manifests, catalogEntries, baselineIds] = await Promise.all([
    loadServiceManifests(root),
    loadCatalog(root),
    loadDefaultBaselineIds(root),
  ]);
  const readme = await readFile(path.join(root, 'README.md'), 'utf8');
  const serviceGuide = await readFile(path.join(root, 'docs', 'development', 'new-lasso-service-guide.md'), 'utf8');
  const problems = [];
  const manifestsById = new Map(manifests.map((entry) => [entry.manifest.id, entry]));
  const catalogById = new Map();

  for (const entry of catalogEntries) {
    if (catalogById.has(entry.id)) problems.push(`catalog duplicate id ${entry.id}.`);
    catalogById.set(entry.id, entry);
  }

  for (const entry of manifests) {
    const { manifest } = entry;
    addMismatch(problems, `${entry.path} folder/id`, entry.folder, manifest.id);
    if (ignoredCheckedInCatalogIds.has(manifest.id)) continue;

    const catalog = catalogById.get(manifest.id);
    if (!catalog) {
      problems.push(`${entry.path} is missing from docs/static/data/service-catalog.json.`);
      continue;
    }

    const source = manifest.artifact?.source;
    if (source?.repo) addMismatch(problems, `${manifest.id} catalog repo`, catalog.repo, source.repo);
    if (catalog.releaseTag !== undefined) addMismatch(problems, `${manifest.id} catalog releaseTag`, catalog.releaseTag, source?.tag ?? null);
    if (catalog.role !== undefined) addMismatch(problems, `${manifest.id} catalog role`, catalog.role, manifest.role ?? null);
    if (catalog.enabled !== undefined) addMismatch(problems, `${manifest.id} catalog enabled`, catalog.enabled, manifest.enabled ?? true);
    if (catalog.ports !== undefined) addMismatch(problems, `${manifest.id} catalog ports`, catalog.ports, manifest.ports ?? {});
  }

  for (const serviceId of baselineIds) {
    if (!manifestsById.has(serviceId)) problems.push(`DEFAULT_BASELINE_SERVICE_IDS includes ${serviceId}, but services/${serviceId}/service.json is missing.`);
  }

  const readmeBaseline = parseReadmeBaselineTable(readme);
  addMismatch(problems, 'README baseline table', readmeBaseline.map((entry) => entry.serviceId), baselineIds);
  for (const entry of readmeBaseline) {
    const tag = manifestsById.get(entry.serviceId)?.manifest.artifact?.source?.tag ?? null;
    if (tag) addMismatch(problems, `${entry.serviceId} README release tag`, entry.releaseTag, tag);
  }

  const guideBaselineIds = parseMarkdownBulletIds(serviceGuide, 'Default baseline services currently are:');
  addMismatch(problems, 'new-lasso-service-guide baseline list', guideBaselineIds, baselineIds);

  return {
    ok: problems.length === 0,
    problems,
    checked: { manifests: manifests.length, catalogEntries: catalogEntries.length, baselineIds },
  };
}

async function main() {
  const result = await verifyServiceCatalog(repoRoot);
  if (!result.ok) {
    console.error('[service-lasso] service catalog drift detected:');
    for (const problem of result.problems) console.error(`- ${problem}`);
    process.exit(1);
  }

  console.log('[service-lasso] service catalog drift verification passed');
  console.log(`- checked manifests: ${result.checked.manifests}`);
  console.log(`- checked catalog entries: ${result.checked.catalogEntries}`);
  console.log(`- default baseline: ${result.checked.baselineIds.join(', ')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
