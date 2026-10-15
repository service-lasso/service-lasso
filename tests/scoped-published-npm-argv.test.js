import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getNpmCommand } from "../scripts/npm-command-lib.mjs";
import { fail, verifyNpmTarballIntegrity } from "../scripts/published-package-qualification-lib.mjs";
import { QUALIFICATION_PHASES, QUALIFICATION_FAILURE_CODES, classifyQualificationFailure, preserveFirstFailure } from "../scripts/published-package-qualification-reliability.mjs";

// SPEC-008 R3/R5/R6: evaluate the actual scoped caller functions without running
// the preparer's top-level provider/download/native qualification entrypoint.
// Production helper and classifier dependencies are real, not duplicated models.
async function scopedCaller(spawnImpl = spawn) {
  const source = await readFile(new URL("../scripts/prepare-published-package-qualification-scoped.mjs", import.meta.url), "utf8");
  const start = source.indexOf("function runCommand(");
  const end = source.indexOf("async function readRelease(", start);
  assert.ok(start >= 0 && end > start);
  return new Function("spawn", "getNpmCommand", "QUALIFICATION_PHASES", "QUALIFICATION_FAILURE_CODES", "classifyQualificationFailure", "preserveFirstFailure", "fail",
    source.slice(start, end) + ";return {runCommand, runNpm, runNpmInstallWithRetry};")(
      spawnImpl, getNpmCommand, QUALIFICATION_PHASES, QUALIFICATION_FAILURE_CODES, classifyQualificationFailure, preserveFirstFailure, fail);
}

test("scoped receiving Node preserves data argv despite shell and environment overrides", async () => {
  const { runCommand } = await scopedCaller();
  const args = ["space value", "a&b", "(parentheses)", "%SCOPED_ARGV_BENIGN%", "!bang!", "^caret", "雪 café", "backslash\\", 'argv-only"quote'];
  const result = await runCommand(process.execPath, ["-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))", ...args], {
    env: { ...process.env, SCOPED_ARGV_BENIGN: "different-benign-value", ComSpec: "unselected-shell", npm_execpath: "unselected-npm" },
    shell: true, windowsVerbatimArguments: true, windowsHide: true,
  });
  assert.deepEqual(JSON.parse(result.stdout), args);
});

test("scoped npm uses actual canonical descriptor, copied argv and unchanged ordinary options", async () => {
  const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  const args = ["install", 'legal archive %x% ! ^ & 雪\\'];
  const original = [...args];
  const options = { cwd: "private-root", env: { ComSpec: "unselected-shell", npm_execpath: "unselected-npm" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, timeout: 60_000, killSignal: "SIGTERM", signal: new AbortController().signal, shell: true, windowsVerbatimArguments: true };
  const { runNpm } = await scopedCaller((command, actualArgs, actualOptions) => {
    const expected = getNpmCommand(original);
    assert.equal(command, expected.command); assert.deepEqual(actualArgs, expected.args); assert.notEqual(actualArgs, args);
    assert.deepEqual(actualOptions, { ...options, shell: false, windowsVerbatimArguments: false });
    return child;
  });
  const result = runNpm(args, options); args[1] = "caller later mutation";
  child.stdout.emit("data", Buffer.from("original")); child.emit("close", 0);
  assert.deepEqual(await result, { stdout: "original", stderr: "" });
});

test("scoped command preserves original sync/async errors, nonzero failure and output until close", async () => {
  for (const outcome of ["sync", "async", "success", "nonzero", "null"]) {
    const primary = new Error("original spawn error");
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    const { runCommand } = await scopedCaller(() => { if (outcome === "sync") throw primary; return child; });
    let settled = false;
    const result = runCommand("private-command", []).then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
    if (outcome !== "sync") {
      if (outcome === "async") { child.emit("error", primary); await Promise.resolve(); assert.equal(settled, true); }
      child.stdout.emit("data", Buffer.from("before")); child.emit("exit", outcome === "nonzero" ? 4 : 0);
      if (outcome !== "async") { await Promise.resolve(); assert.equal(settled, false, "exit does not imply close/EOF"); }
      child.stdout.emit("data", Buffer.from("after")); child.stderr.emit("data", Buffer.from("stderr"));
      child.emit("close", outcome === "nonzero" ? 4 : outcome === "null" ? null : 0);
    }
    const actual = await result;
    if (["sync", "async"].includes(outcome)) assert.equal(actual.error, primary);
    else if (["nonzero", "null"].includes(outcome)) assert.equal(actual.error.message, `private-command exited with code ${outcome === "null" ? "null" : "4"}.`);
    else assert.deepEqual(actual.value, { stdout: "beforeafter", stderr: "stderr" });
  }
});

test("actual scoped installer retains one acquisition retry and the first failure", async () => {
  for (const outcome of ["recover", "exhausted", "already_retried", "prior_failure"]) {
    let calls = 0;
    const originalFirst = classifyQualificationFailure({ phase: QUALIFICATION_PHASES.CORE_STARTUP, error: { code: QUALIFICATION_FAILURE_CODES.core_startup }, mutationCount: 0 });
    const state = { firstFailure: outcome === "prior_failure" ? originalFirst : null, acquisitionRetry: outcome === "already_retried" };
    const { runNpmInstallWithRetry } = await scopedCaller((command, args, options) => {
      calls++;
      assert.deepEqual({ command, args }, getNpmCommand(["install", "literal %SCOPED_ARGV_BENIGN% & archive.tgz", "--ignore-scripts", "--no-audit", "--no-fund"]));
      assert.deepEqual(options, { stdio: ["ignore", "pipe", "pipe"], cwd: "consumer-root", shell: false, windowsVerbatimArguments: false });
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      queueMicrotask(() => { child.stdout.emit("data", Buffer.from("install output")); child.emit("close", calls === 2 && outcome !== "exhausted" ? 0 : 1); });
      return child;
    });
    if (["recover", "prior_failure"].includes(outcome)) assert.equal((await runNpmInstallWithRetry("literal %SCOPED_ARGV_BENIGN% & archive.tgz", "consumer-root", state)).stdout, "install output");
    else await assert.rejects(runNpmInstallWithRetry("literal %SCOPED_ARGV_BENIGN% & archive.tgz", "consumer-root", state), error => error.code === QUALIFICATION_FAILURE_CODES.npm_acquisition);
    assert.equal(calls, outcome === "already_retried" ? 1 : 2);
    assert.equal(state.acquisitionRetry, true);
    if (outcome === "prior_failure") assert.equal(state.firstFailure, originalFirst);
    else { assert.equal(state.firstFailure.phase, QUALIFICATION_PHASES.NPM_ACQUISITION); assert.equal(state.firstFailure.mutationCount, 0); assert.equal(state.firstFailure.failureCode, QUALIFICATION_FAILURE_CODES.npm_acquisition); }
  }
});

test("actual scoped npm receives the integrity-verified literal archive and installs its original payload", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "scoped npm & (%SCOPED_ARGV_BENIGN%) ! ^ 雪-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const packageRoot = path.join(root, "package source"), consumerRoot = path.join(root, "consumer space"), poisonRoot = path.join(root, "poison executables");
  await Promise.all([packageRoot, consumerRoot, poisonRoot].map(dir => mkdir(dir)));
  const marker = path.join(root, "unrelated-marker"), payload = "original verified archive payload % ! ^ & 雪\n";
  await writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ name: "scoped-npm-argv-fixture", version: "1.0.0", files: ["payload.txt"] }));
  await writeFile(path.join(packageRoot, "payload.txt"), payload);
  await writeFile(path.join(consumerRoot, "package.json"), JSON.stringify({ private: true }));
  const poison = path.join(poisonRoot, "poison.mjs");
  await writeFile(poison, `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'unexpected');`);
  await writeFile(path.join(poisonRoot, "npm.cmd"), `@echo unexpected>"${marker}"\r\n@exit /b 97\r\n`);
  const keys = ["SCOPED_ARGV_BENIGN", ...(process.platform === "win32" ? ["ComSpec", "npm_execpath", "PATH"] : [])];
  const prior = new Map(keys.map(key => [key, process.env[key]]));
  t.after(() => { for (const [key, value] of prior) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  process.env.SCOPED_ARGV_BENIGN = "different-benign-value";
  if (process.platform === "win32") { process.env.ComSpec = poison; process.env.npm_execpath = poison; process.env.PATH = `${poisonRoot}${path.delimiter}${prior.get("PATH") ?? ""}`; }
  const calls = [];
  const { runNpm, runNpmInstallWithRetry } = await scopedCaller((command, args, options) => { calls.push({ command, args: [...args], options }); return spawn(command, args, options); });
  const packed = JSON.parse((await runNpm(["pack", "--json", "--ignore-scripts"], { cwd: packageRoot })).stdout);
  const archive = path.join(packageRoot, packed[0].filename), originalBytes = await readFile(archive);
  const integrity = `sha512-${createHash("sha512").update(originalBytes).digest("base64")}`;
  assert.deepEqual(await verifyNpmTarballIntegrity(archive, integrity), { integrity, size: originalBytes.length });
  await assert.rejects(verifyNpmTarballIntegrity(archive, `sha512-${Buffer.alloc(64).toString("base64")}`), error => error.code === "npm_tarball_integrity_mismatch");
  const state = { firstFailure: null };
  await runNpmInstallWithRetry(archive, consumerRoot, state);
  assert.equal(calls.length, 2, "normal install has no retry");
  assert.deepEqual({ command: calls[1].command, args: calls[1].args }, getNpmCommand(["install", archive, "--ignore-scripts", "--no-audit", "--no-fund"]));
  assert.equal(calls[1].options.cwd, consumerRoot); assert.equal(calls[1].options.shell, false); assert.equal(calls[1].options.windowsVerbatimArguments, false);
  assert.equal(state.firstFailure, null); assert.equal(state.acquisitionRetry, undefined);
  assert.deepEqual(await readFile(archive), originalBytes);
  assert.equal(await readFile(path.join(consumerRoot, "node_modules", "scoped-npm-argv-fixture", "payload.txt"), "utf8"), payload);
  assert.equal(JSON.parse(await readFile(path.join(consumerRoot, "node_modules", "scoped-npm-argv-fixture", "package.json"), "utf8")).version, "1.0.0");
  await assert.rejects(access(marker), error => error.code === "ENOENT");
});
