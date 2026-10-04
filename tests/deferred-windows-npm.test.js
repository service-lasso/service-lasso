import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getNpmCommand } from "../scripts/npm-command-lib.mjs";
import { runCommand as runMcpCommand } from "../scripts/mcp-product-acceptance-lib.mjs";
import { classifyQualificationFailure, preserveFirstFailure, QUALIFICATION_FAILURE_CODES, QUALIFICATION_PHASES } from "../scripts/published-package-qualification-reliability.mjs";

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const verifierSource = async () => (await readFile(new URL("../scripts/verify-mcp-packaged.mjs", import.meta.url), "utf8")).replaceAll("\r\n", "\n");
const preparationSource = async () => (await readFile(new URL("../scripts/prepare-published-package-qualification.mjs", import.meta.url), "utf8")).replaceAll("\r\n", "\n");
function between(source, start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Missing original source boundary: ${start}`);
  return source.slice(first, last);
}
async function originalPreparation(spawnImpl = spawn) {
  const body = between(await preparationSource(), "function runCommand(", "/**\n * Retry npm install");
  return new Function("spawn", "getNpmCommand", `${body}; return { runCommand, runNpm };`)(spawnImpl, getNpmCommand);
}

// AC-7G.windows-npm-argv / AC-6G: source witnesses support the protected
// diagnostics/published/native gates; they do not qualify published payloads.
test("verifier selects fixed Windows authority before reading ambient overrides and preserves non-Windows selection", async () => {
  const selection = between(await verifierSource(), "const npmEntrypoint =", "async function exactCandidateSha(");
  const select = new AsyncFunction("process", "path", "getNpmCommand", "stat", `${selection}; return npmEntrypoint;`);
  const expected = "C:\\Node Root\\node_modules\\npm\\bin\\npm-cli.js";
  const env = new Proxy({}, { get() { throw new Error("Windows ambient authority read"); } });
  let descriptorCalls = 0;
  assert.equal(await select({ platform: "win32", env }, path.win32, args => {
    descriptorCalls += 1; assert.deepEqual(args, []); return { command: "C:\\Node Root\\node.exe", args: [expected] };
  }, async value => assert.equal(value, expected)), expected);
  assert.equal(descriptorCalls, 1);
  for (const platform of ["linux", "darwin"]) {
    for (const [configured, npmPath, expectedPath] of [["  /explicit npm  ", "/secondary", "/explicit npm"], ["  ", " /secondary ", "/secondary"], [undefined, undefined, "/node/lib/node_modules/npm/bin/npm-cli.js"]]) {
      assert.equal(await select({ platform, execPath: "/node/bin/node", env: { SERVICE_LASSO_NPM_ENTRYPOINT: configured, npm_execpath: npmPath } }, path.posix, () => { throw new Error("non-Windows descriptor used"); }, async () => {}), expectedPath);
    }
  }
  await assert.rejects(select({ platform: "win32", env }, path.win32, () => ({ args: [expected] }), async () => { throw new Error("missing"); }), /could not resolve the governed npm entrypoint/);
});

test("both original receiving runners preserve special argument data", async () => {
  const args = ["space value", "a&b", "(paren)", "%SERVICE_LASSO_ARGV_BENIGN%", "!bang!", "^caret", 'a"quote', "雪 café", "slash/", "backslash\\", "space \\"];
  const preparation = await originalPreparation();
  for (const run of [preparation.runCommand, runMcpCommand]) {
    const result = await run(process.execPath, ["-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))", ...args], {
      env: { ...process.env, SERVICE_LASSO_ARGV_BENIGN: "different" }, windowsHide: true, shell: true, windowsVerbatimArguments: true,
    });
    assert.deepEqual(JSON.parse(result.stdout), args);
  }
});

test("original preparation runner retains options, error identity, close output and selected-command nonzero error", async () => {
  for (const outcome of ["sync", "async", "success", "nonzero"]) {
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    const primary = new Error("original spawn failure");
    const options = { cwd: "private-root", env: { PRIVATE: "value" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, timeout: 1234, killSignal: "SIGTERM", signal: new AbortController().signal, shell: true, windowsVerbatimArguments: true };
    const { runNpm } = await originalPreparation((command, args, actual) => {
      assert.deepEqual({ command, args }, getNpmCommand(["install", 'archive % ! & " 雪\\']));
      assert.deepEqual(actual, { ...options, shell: false, windowsVerbatimArguments: false });
      if (outcome === "sync") throw primary;
      return child;
    });
    let settled = false;
    const result = runNpm(["install", 'archive % ! & " 雪\\'], options).then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
    if (outcome !== "sync") {
      if (outcome === "async") child.emit("error", primary);
      child.stdout.emit("data", Buffer.from("before")); child.emit("exit", outcome === "nonzero" ? 7 : 0);
      await Promise.resolve(); assert.equal(settled, outcome === "async");
      child.stdout.emit("data", Buffer.from("after")); child.stderr.emit("data", Buffer.from("stderr"));
      child.emit("close", outcome === "nonzero" ? 7 : 0);
    }
    const actual = await result;
    if (["sync", "async"].includes(outcome)) assert.equal(actual.error, primary);
    else if (outcome === "nonzero") assert.equal(actual.error.message, `${getNpmCommand([]).command} exited with code 7.`);
    else assert.deepEqual(actual.value, { stdout: "beforeafter", stderr: "stderr" });
  }
});

test("original preparation retry preserves first failure and never attempts a third install", async () => {
  const body = between(await preparationSource(), "async function runNpmInstallWithRetry(", "async function readRelease(");
  for (const failures of [0, 1, 2]) {
    let calls = 0;
    const prior = Object.freeze({ phase: QUALIFICATION_PHASES.NPM_ACQUISITION, failureCode: QUALIFICATION_FAILURE_CODES.npm_acquisition, classification: "acquisition_failure", mutationCount: 0 });
    const state = { firstFailure: prior };
    const run = new Function("runNpm", "classifyQualificationFailure", "QUALIFICATION_PHASES", "QUALIFICATION_FAILURE_CODES", "preserveFirstFailure", "fail", `${body}; return runNpmInstallWithRetry;`)(async (args, options) => {
      calls += 1; assert.deepEqual(args, ["install", "exact archive", "--ignore-scripts", "--no-audit", "--no-fund"]); assert.deepEqual(options, { cwd: "consumer" });
      if (calls <= failures) throw new Error("private first acquisition detail"); return { stdout: "installed", stderr: "" };
    }, classifyQualificationFailure, QUALIFICATION_PHASES, QUALIFICATION_FAILURE_CODES, preserveFirstFailure, (code, message) => { throw Object.assign(new Error(message), { code }); });
    if (failures === 2) await assert.rejects(run("exact archive", "consumer", state), error => error.code === QUALIFICATION_FAILURE_CODES.npm_acquisition && !error.message.includes("private"));
    else assert.deepEqual(await run("exact archive", "consumer", state), { stdout: "installed", stderr: "" });
    assert.equal(calls, failures === 0 ? 1 : 2); assert.equal(state.firstFailure, prior);
    assert.equal(state.acquisitionRetry, failures === 0 ? undefined : true);
  }
  let calls = 0;
  const run = new Function("runNpm", "classifyQualificationFailure", "QUALIFICATION_PHASES", "QUALIFICATION_FAILURE_CODES", "preserveFirstFailure", "fail", `${body}; return runNpmInstallWithRetry;`)(async () => {
    calls += 1; throw new Error("private acquisition failure");
  }, classifyQualificationFailure, QUALIFICATION_PHASES, QUALIFICATION_FAILURE_CODES, preserveFirstFailure, (code, message) => { throw Object.assign(new Error(message), { code }); });
  const state = { acquisitionRetry: true };
  await assert.rejects(run("archive", "consumer", state), /acquisition failed/);
  assert.equal(calls, 1);
  assert.equal(state.firstFailure.phase, QUALIFICATION_PHASES.NPM_ACQUISITION);
});

test("actual normal npm installs exact fixture bytes through both deferred launch seams in legal roots", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deferred npm & (%SERVICE_LASSO_ARGV_BENIGN%) ! ^ 雪-"));
  try {
    const packageRoot = path.join(root, "package source");
    const prepRoot = path.join(root, "prepared consumer");
    const mcpRoot = path.join(root, "MCP consumer");
    const poisonRoot = path.join(root, "poison executables");
    await Promise.all([packageRoot, prepRoot, mcpRoot, poisonRoot].map(dir => mkdir(dir)));
    const marker = path.join(root, "unrelated-marker");
    const payload = "exact deferred fixture bytes % ! ^ & 雪\n";
    await writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ name: "deferred-npm-fixture", version: "1.0.0", files: ["payload.txt"] }));
    await writeFile(path.join(packageRoot, "payload.txt"), payload);
    await Promise.all([prepRoot, mcpRoot].map(dir => writeFile(path.join(dir, "package.json"), JSON.stringify({ private: true }))));
    const poison = path.join(poisonRoot, "poison.mjs");
    await writeFile(poison, `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'unexpected');`);
    await writeFile(path.join(poisonRoot, "npm.cmd"), `@echo unexpected>"${marker}"\r\n@exit /b 97\r\n`);
    const env = process.platform === "win32" ? { ...process.env, SERVICE_LASSO_NPM_ENTRYPOINT: poison, npm_execpath: poison, ComSpec: poison, PATH: `${poisonRoot}${path.delimiter}${process.env.PATH ?? ""}`, SERVICE_LASSO_ARGV_BENIGN: "different" } : { ...process.env };
    const prep = await originalPreparation();
    const packed = await prep.runNpm(["pack", "--json", "--ignore-scripts"], { cwd: packageRoot, env });
    const archive = path.join(packageRoot, JSON.parse(packed.stdout)[0].filename);
    await prep.runNpm(["install", archive, "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: prepRoot, env });
    // Run the exact verifier selection and install statement in a child-only
    // environment. No top-level verifier/preparer or publication authority is fabricated.
    const verifier = await verifierSource();
    const selection = between(verifier, "const npmEntrypoint =", "async function exactCandidateSha(");
    const install = between(verifier, "  await runCommand(process.execPath, [npmEntrypoint,", '  verificationStage = "installed_package_binding";');
    const driver = path.join(root, "original verifier npm seam.mjs");
    await writeFile(driver, [
      'import path from "node:path"; import {stat} from "node:fs/promises";',
      `import {getNpmCommand} from ${JSON.stringify(new URL("../scripts/npm-command-lib.mjs", import.meta.url).href)};`,
      `import {runCommand} from ${JSON.stringify(new URL("../scripts/mcp-product-acceptance-lib.mjs", import.meta.url).href)};`,
      selection,
      `const staged={packageArchivePath:${JSON.stringify(archive)}}; const consumerRoot=${JSON.stringify(mcpRoot)}; const pinnedSdkVersion="1.0.0"; const installObservation=undefined;`,
      install,
    ].join("\n"));
    await prep.runCommand(process.execPath, [driver], { cwd: root, env });
    for (const consumer of [prepRoot, mcpRoot]) {
      const installed = path.join(consumer, "node_modules", "deferred-npm-fixture");
      assert.equal(await readFile(path.join(installed, "payload.txt"), "utf8"), payload);
      assert.equal(JSON.parse(await readFile(path.join(installed, "package.json"), "utf8")).version, "1.0.0");
    }
    await assert.rejects(access(marker), error => error.code === "ENOENT");
  } finally { await rm(root, { recursive: true, force: true }); }
});
