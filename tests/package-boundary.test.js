import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

async function readJson(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  const contents = await readFile(absolutePath, "utf8");
  return JSON.parse(contents);
}

test("root package declares the bounded workspace map", async () => {
  const packageJson = await readJson("package.json");

  const expectedWorkspaces = [
    "packages/core",
    "packages/image-size-safe",
    "packages/braces-safe",
    "packages/http-cache-semantics-safe",
  ];
  const lock = await readJson("package-lock.json");
  assert.deepEqual(packageJson.workspaces, expectedWorkspaces);
  assert.deepEqual(lock.packages[""].workspaces, expectedWorkspaces);
  const expectedNames = ["@service-lasso/service-lasso", "image-size", "braces", "http-cache-semantics"];
  for (const [index, workspace] of expectedWorkspaces.entries()) {
    const manifest = await readJson(`${workspace}/package.json`);
    assert.equal(manifest.name, expectedNames[index]);
    assert.equal(manifest.private, true);
    assert.equal(lock.packages[workspace].name, expectedNames[index]);
    assert.equal(lock.packages[workspace].version, manifest.version);
  }
});

test("npm start builds before launching the runtime entrypoint", async () => {
  const packageJson = await readJson("package.json");

  assert.equal(packageJson.scripts.start, "npm run build && node --enable-source-maps dist/index.js");
});

test("core wrapper package exposes the canonical package boundary", async () => {
  const packageJson = await readJson("packages/core/package.json");
  const coreModule = await import(pathToFileURL(path.join(repoRoot, "packages/core/index.js")).href);

  assert.equal(packageJson.name, "@service-lasso/service-lasso");
  assert.equal(packageJson.bin["service-lasso"], "./cli.js");
  assert.equal(typeof coreModule.createRuntime, "function");
  assert.equal(typeof coreModule.startRuntimeApp, "function");
  assert.equal(typeof coreModule.startApiServer, "function");
});

test("reference-app placeholder packages are not carried inside the core repo", async () => {
  const appPlaceholderPaths = [
    path.join(repoRoot, "packages/app-web/package.json"),
    path.join(repoRoot, "packages/packager-node/package.json"),
    path.join(repoRoot, "packages/app-tauri/package.json"),
    path.join(repoRoot, "packages/bundled/package.json"),
  ];

  for (const packagePath of appPlaceholderPaths) {
    await assert.rejects(readFile(packagePath, "utf8"));
  }
});
