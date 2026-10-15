import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getNpmCommand } from "../scripts/npm-command-lib.mjs";
import { runCommand, runNpmCommand } from "../scripts/release-artifact-lib.mjs";
import { runAppNpm } from "../scripts/newcomer-app-journey.mjs";
import { publishedConsumerNpmInstallSource } from "../scripts/publish-package-lib.mjs";

// AC-7G.windows-npm-argv: actual receiving Node, including arguments which are
// legal argv but intentionally not filesystem names on Windows.
test("actual release command preserves argv and forces normal shell-free quoting", async () => {
  const args = ["space value", "a&b", "(paren)", "%SERVICE_LASSO_ARGV_BENIGN%", "!bang!", "^caret", 'a"quote', "雪 café", "slash/", "backslash\\", "space \\"];
  const env = { ...process.env, SERVICE_LASSO_ARGV_BENIGN: "different-benign-value" };
  const result = await runCommand(process.execPath, ["-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))", ...args], {
    env, shell: true, windowsVerbatimArguments: true, windowsHide: true,
  });
  assert.deepEqual(JSON.parse(result.stdout), args);
});

test("fixed descriptor is independent of arguments and keeps their exact elements", () => {
  const args = ["install", 'a %x% ! ^ & " 雪\\'];
  const descriptor = getNpmCommand(args);
  assert.deepEqual(descriptor, process.platform === "win32"
    ? { command: process.execPath, args: [path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"), ...args] }
    : { command: "npm", args });
  assert.notEqual(descriptor.args, args);
  assert.deepEqual(args, ["install", 'a %x% ! ^ & " 雪\\']);
});

test("original release command preserves options, original errors, late observations and close EOF", async () => {
  const source = await readFile(new URL("../scripts/release-artifact-lib.mjs", import.meta.url), "utf8");
  const start = source.indexOf("export function runCommand(");
  const end = source.indexOf("export function runNpmCommand(", start);
  assert.ok(start >= 0 && end > start);
  const body = source.slice(start, end).replace("export function", "function");
  for (const outcome of ["sync", "async", "success", "nonzero", "hostile_observer"]) {
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    const primary = Object.create(null);
    const statuses = [];
    const signal = new AbortController().signal;
    const options = { cwd: "private-root", env: { PRIVATE: "value" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, timeout: 60_000, killSignal: "SIGTERM", signal, shell: true, windowsVerbatimArguments: true };
    const run = new Function("spawn", body + ";return runCommand;")((command, args, actual) => {
      assert.equal(command, "private-command"); assert.deepEqual(args, ["private-arg"]);
      assert.deepEqual(actual, { ...options, shell: false, windowsVerbatimArguments: false });
      if (outcome === "sync") throw primary;
      return child;
    });
    let settled = false;
    const result = run("private-command", ["private-arg"], { ...options, resourceObservation: { record(status) { statuses.push(status); if (outcome === "hostile_observer") throw primary; } } })
      .then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
    if (outcome !== "sync") {
      if (outcome === "async") { child.emit("error", primary); await Promise.resolve(); assert.equal(settled, true); }
      child.stdout.emit("data", Buffer.from("before"));
      child.emit("exit", outcome === "nonzero" ? 4 : 0);
      if (outcome !== "async") { await Promise.resolve(); assert.equal(settled, false, "exit is not close/EOF"); }
      child.stdout.emit("data", Buffer.from("after")); child.stderr.emit("data", Buffer.from("stderr"));
      child.emit("close", outcome === "nonzero" ? 4 : 0);
    }
    const actual = await result;
    if (["sync", "async"].includes(outcome)) assert.equal(actual.error, primary);
    else if (outcome === "nonzero") assert.match(actual.error.message, /exit code 4[\s\S]*beforeafter[\s\S]*stderr/);
    else assert.deepEqual(actual.value, { stdout: "beforeafter", stderr: "stderr" });
    assert.deepEqual(statuses, outcome === "sync" ? ["creation_attempted", "creation_rejected"] : ["creation_attempted", "created", ...(outcome === "async" ? ["creation_rejected"] : []), "exit_observed", "close_observed"]);
  }
});

test("actual npm release/app and generated consumer preserve legal roots and intended archive bytes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "npm argv & (%SERVICE_LASSO_ARGV_BENIGN%) ! ^ 雪-"));
  try {
    const packageRoot = path.join(root, "package source");
    const consumerRoot = path.join(root, "consumer & space");
    const generatedRoot = path.join(root, "generated consumer");
    const poisonRoot = path.join(root, "poison executables");
    await Promise.all([packageRoot, consumerRoot, generatedRoot, poisonRoot].map(dir => mkdir(dir)));
    const marker = path.join(root, "unrelated-marker");
    const payload = "exact archive payload % ! ^ & 雪\n";
    await writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ name: "fixed-npm-argv-fixture", version: "1.0.0", files: ["payload.txt"] }));
    await writeFile(path.join(packageRoot, "payload.txt"), payload);
    await writeFile(path.join(consumerRoot, "package.json"), JSON.stringify({ private: true }));
    await writeFile(path.join(generatedRoot, "package.json"), JSON.stringify({ private: true }));
    const poison = path.join(poisonRoot, "poison.mjs");
    await writeFile(poison, `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'unexpected');`);
    await writeFile(path.join(poisonRoot, "npm.cmd"), `@echo unexpected>"${marker}"\r\n@exit /b 97\r\n`);
    const env = process.platform === "win32" ? {
      ...process.env, ComSpec: poison, npm_execpath: poison,
      PATH: `${poisonRoot}${path.delimiter}${process.env.PATH ?? ""}`,
      SERVICE_LASSO_ARGV_BENIGN: "different-benign-value",
    } : { ...process.env, SERVICE_LASSO_ARGV_BENIGN: "different-benign-value" };
    const packed = await runNpmCommand(["pack", "--json", "--ignore-scripts"], { cwd: packageRoot, env, windowsHide: true });
    const archiveName = JSON.parse(packed.stdout)[0].filename;
    assert.equal(archiveName, "fixed-npm-argv-fixture-1.0.0.tgz");
    const archive = path.join(packageRoot, archiveName);
    await runAppNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund", archive], { cwd: consumerRoot, env, windowsHide: true });
    assert.equal(await readFile(path.join(consumerRoot, "node_modules", "fixed-npm-argv-fixture", "payload.txt"), "utf8"), payload);
    const view = await runNpmCommand(["view", "npm@10.9.3", "version"], { cwd: consumerRoot, env, windowsHide: true });
    assert.equal(view.stdout.trim(), "10.9.3");
    const probe = path.join(root, "generated install.mjs");
    await writeFile(probe, [
      'import {spawn} from "node:child_process";',
      `const cliArchive = ${JSON.stringify(archive)};`,
      `const toolRootPath = ${JSON.stringify(generatedRoot)};`,
      ...publishedConsumerNpmInstallSource(),
    ].join("\n"));
    await runCommand(process.execPath, [probe], { cwd: generatedRoot, env, windowsHide: true });
    assert.equal(await readFile(path.join(generatedRoot, "node_modules", "fixed-npm-argv-fixture", "payload.txt"), "utf8"), payload);
    const manifest = JSON.parse(await readFile(path.join(generatedRoot, "node_modules", "fixed-npm-argv-fixture", "package.json"), "utf8"));
    assert.equal(manifest.version, "1.0.0");
    await assert.rejects(access(marker), error => error.code === "ENOENT");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("actual emitted consumer install retains inherit stdio and original asynchronous error/close result", async () => {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  for (const outcome of ["success", "error", "nonzero"]) {
    const child = new EventEmitter(); const primary = Object.create(null);
    let settled = false;
    const run = new AsyncFunction("spawn", "process", "cliArchive", "toolRootPath", publishedConsumerNpmInstallSource().join("\n"));
    const result = run((command, args, options) => {
      const expected = getNpmCommand(["install", 'private archive % ! & " 雪\\']);
      assert.equal(command, expected.command); assert.deepEqual(args, expected.args);
      assert.deepEqual(options, { cwd: "private-root", stdio: "inherit", shell: false, windowsVerbatimArguments: false });
      return child;
    }, process, 'private archive % ! & " 雪\\', "private-root").then(() => { settled = true; return {}; }, error => { settled = true; return { error }; });
    if (outcome === "error") child.emit("error", primary);
    else { child.emit("exit", outcome === "nonzero" ? 4 : 0); await Promise.resolve(); assert.equal(settled, false); }
    child.emit("close", outcome === "nonzero" ? 4 : 0);
    const actual = await result;
    if (outcome === "error") assert.equal(actual.error, primary);
    else if (outcome === "nonzero") assert.match(actual.error.message, /operator CLI install exited 4/);
    else assert.equal(actual.error, undefined);
  }
});
