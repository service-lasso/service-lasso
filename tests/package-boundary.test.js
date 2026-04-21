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

  assert.deepEqual(packageJson.workspaces, ["packages/core"]);
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
