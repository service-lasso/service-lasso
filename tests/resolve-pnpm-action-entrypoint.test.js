import test from "node:test";
import assert from "node:assert/strict";
import { access, lstat, mkdir, mkdtemp, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const resolver = fileURLToPath(new URL("../scripts/resolve-pnpm-action-entrypoint.mjs", import.meta.url));

async function npmCli() {
  if (process.platform !== "win32") return "npm";
  const candidate = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  await access(candidate);
  return candidate;
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "pnpm action entrypoint "));
  const actionRoot = path.join(root, "pinned action root");
  const actionHome = path.join(actionRoot, "node_modules", ".bin");
  const bin = path.join(actionHome, "bin");
  const prefix = path.join(root, "admin-trusted-unlock-pnpm-10.34.5");
  const entrypoint = path.join(prefix, "node_modules", "pnpm", "bin", "pnpm.cjs");
  await mkdir(actionHome, { recursive: true });
  const npm = await npmCli();
  const npmArgs = ["install", "--prefix", actionRoot, "--ignore-scripts", "--no-save", "--package-lock=false", "--no-audit", "--no-fund", "pnpm@11.25.0"];
  const installed = process.platform === "win32"
    ? spawnSync(process.execPath, [npm, ...npmArgs], { encoding: "utf8", shell: false })
    : spawnSync(npm, npmArgs, { encoding: "utf8", shell: false });
  assert.equal(installed.status, 0, installed.stderr);
  const updated = spawnSync(process.execPath, [path.join(actionRoot, "node_modules", "pnpm", "bin", "pnpm.mjs"), "self-update", "10.34.5"], { encoding: "utf8", shell: false, env: { ...process.env, PNPM_HOME: actionHome } });
  assert.equal(updated.status, 0, updated.stderr);
  // Match establish-admin-trusted-unlock-receipt-caller.mjs: the caller is a
  // separately installed package, never the ambient repository pnpm package.
  await assert.rejects(lstat(prefix), { code: "ENOENT" });
  const callerArgs = ["install", "--prefix", prefix, "--ignore-scripts", "--no-save", "--package-lock=false", "--no-audit", "--no-fund", "pnpm@10.34.5"];
  const caller = process.platform === "win32"
    ? spawnSync(process.execPath, [npm, ...callerArgs], { encoding: "utf8", shell: false, windowsHide: true, env: process.env })
    : spawnSync(npm, callerArgs, { encoding: "utf8", shell: false, windowsHide: true, env: process.env });
  assert.equal(caller.error, undefined);
  assert.equal(caller.signal, null);
  assert.equal(caller.status, 0, caller.stderr);
  const manifest = JSON.parse(await readFile(path.join(prefix, "node_modules", "pnpm", "package.json"), "utf8"));
  assert.equal(manifest.name, "pnpm");
  assert.equal(manifest.version, "10.34.5");
  assert.equal(manifest.bin.pnpm, "bin/pnpm.cjs");
  const entrypointInfo = await lstat(entrypoint);
  assert.equal(entrypointInfo.isFile(), true);
  assert.equal(entrypointInfo.isSymbolicLink(), false);
  const relative = path.relative(await realpath(root), await realpath(entrypoint));
  assert.ok(relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  return { root, bin, prefix, entrypoint };
}

test("proves an actual isolated pnpm package manifest, regular CJS entrypoint, digest, and absolute runtime identity", async () => {
  const { root, bin, prefix, entrypoint } = await fixture();
  const environment = path.join(root, "github-env");
  const result = spawnSync(process.execPath, [resolver], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, PNPM_ACTION_BIN_DEST: bin, ADMIN_PNPM_PREFIX: prefix, RUNNER_TEMP: root, GITHUB_ENV: environment },
  });
  assert.equal(result.status, 0, result.stderr);
  const bindings = await readFile(environment, "utf8");
  const evidence = JSON.parse(await readFile(path.join(root, "pnpm-action-pinned-entrypoint", "identity.json"), "utf8"));
  assert.ok(bindings.includes(`ADMIN_PNPM_NODE=${evidence.caller.node}\n`));
  assert.ok(bindings.includes(`ADMIN_PNPM_ENTRYPOINT=${evidence.caller.entrypoint}\n`));
  assert.equal(evidence.action.ref, "ea17c68df8912ef543352723c149a84f56e3d413");
  assert.equal(evidence.action.bootstrap.version, "11.25.0");
  assert.equal(evidence.action.selfUpdated.version, "10.34.5");
  if (process.platform === "win32") assert.match(evidence.action.selfUpdated.executable, /pnpm\.cmd$/i);
  assert.match(evidence.action.binDest, /node_modules[\\/]\.bin[\\/]bin$/i);
  assert.equal(evidence.caller.version, "10.34.5");
  assert.match(evidence.caller.entrypoint, /node_modules[\\/]pnpm[\\/]bin[\\/]pnpm\.cjs$/i);
  assert.match(evidence.caller.node, process.platform === "win32" ? /node\.exe$/i : /node$/i);
  assert.match(evidence.caller.manifestSha256, /^[0-9a-f]{64}$/);
  assert.match(evidence.caller.entrypointSha256, /^[0-9a-f]{64}$/);
  assert.equal(evidence.caller.entrypoint, await realpath(entrypoint));
  assert.equal(evidence.caller.node, await realpath(process.execPath));
  assert.equal(evidence.caller.manifestSha256, createHash("sha256").update(await readFile(path.join(prefix, "node_modules", "pnpm", "package.json"))).digest("hex"));
  assert.equal(evidence.caller.entrypointSha256, createHash("sha256").update(await readFile(entrypoint)).digest("hex"));
});

test("Windows action binding executes only the realpath-normalized spaced-path pnpm.cmd selected from the action output", { skip: process.platform !== "win32" }, async () => {
  const { root, bin, prefix } = await fixture(), environment = path.join(root, "github-env");
  const selected = spawnSync(process.execPath, [resolver, "--verify-action-binding"], { cwd: root, encoding: "utf8", env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, PNPM_ACTION_BIN_DEST: bin, ADMIN_PNPM_PREFIX: prefix, RUNNER_TEMP: root, GITHUB_ENV: environment } });
  assert.equal(selected.status, 0, selected.stderr);
  const unbound = spawnSync(process.execPath, [resolver, "--verify-action-binding"], { cwd: root, encoding: "utf8", env: { ...process.env, PATH: process.env.PATH, PNPM_ACTION_BIN_DEST: bin, ADMIN_PNPM_PREFIX: prefix, RUNNER_TEMP: root, GITHUB_ENV: environment } });
  assert.notEqual(unbound.status, 0);
});
