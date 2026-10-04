import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { mkdtemp, writeFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { createConnection } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseConptyProbeResult } from "../scripts/operator-tui-conpty-result.mjs";
import { createOwnedUnavailableEndpoint } from "../scripts/operator-tui-conpty-endpoint.mjs";
import { conptyHelperEnvironment, runConptyHelper } from "../scripts/operator-tui-conpty-runner.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Windows ConPTY helper uses a bounded host with a sanitized child environment", async () => {
  const source = await readFile(path.join(repoRoot, "scripts", "verify-operator-tui-conpty.py"), "utf8");
  assert.match(source, /Backend\.ConPTY/u);
  assert.match(source, /process\.close\(force=True\)/u);
  assert.match(source, /"SERVICE_LASSO_API_URL"/u);
  assert.match(source, /"SERVICE_LASSO_API_TOKEN"/u);
  assert.match(source, /dimensions=\(40, 120\)/u);
  assert.match(source, /startup_ok, text = wait_for/u);
  assert.match(source, /if args\.mode == "connected"/u);
  assert.doesNotMatch(source, /os\.environ\.copy\(\)/u);
  assert.doesNotMatch(source, /--api-token/u);
  assert.doesNotMatch(source, /--api-url/u);
  assert.match(source, /\{"ok": False, "stage": stage\}/u);
});

test("Windows ConPTY runner binds the reviewed native launcher bytes before creating a containment launch", async () => {
  const source = await readFile(path.join(repoRoot, "scripts", "operator-tui-conpty-runner.mjs"), "utf8");
  assert.match(source, /WINDOWS_MANAGED_LAUNCHER_BYTES = 141_824/u);
  assert.match(source, /WINDOWS_MANAGED_LAUNCHER_SHA256 = "401699f683f56e081236e550ab59c06f888929ec5e30588f4e27cce972d4364c"/u);
  assert.match(source, /assertWindowsManagedLauncher\(launcherPath\)[\s\S]*?bytes\.length !== WINDOWS_MANAGED_LAUNCHER_BYTES[\s\S]*?WINDOWS_MANAGED_LAUNCHER_SHA256/u);
});

test("Windows ConPTY helper results are closed, mode-specific schemas", () => {
  assert.deepEqual(parseConptyProbeResult('{"ok":true,"mode":"unavailable","startup":"unavailable","navigation":"not_applicable","exit":"q"}', "unavailable"), {
    ok: true, mode: "unavailable", startup: "unavailable", navigation: "not_applicable", exit: "q",
  });
  assert.deepEqual(parseConptyProbeResult('{"ok":true,"mode":"connected","startup":"connected","navigation":"help","exit":"q"}', "connected"), {
    ok: true, mode: "connected", startup: "connected", navigation: "help", exit: "q",
  });
  for (const malformed of [
    '{"ok":true,"mode":"connected","startup":"connected","navigation":"help"}',
    '{"ok":true,"mode":"connected","startup":"connected","navigation":"help","exit":"q","extra":true}',
    '{"ok":true,"mode":"unavailable","startup":"connected","navigation":"not_applicable","exit":"q"}',
    '{"ok":false,"stage":"transcript"}',
  ]) {
    assert.throws(() => parseConptyProbeResult(malformed, "connected"));
  }
  assert.throws(() => parseConptyProbeResult('{"ok":false,"stage":"cleanup"}', "connected"), /cleanup/u);
  assert.throws(() => parseConptyProbeResult('{"ok":false,"stage":"cleanup","primaryStage":"startup"}', "connected"), /cleanup/u);
});

test("ConPTY helper boundary does not project credentials, endpoints, paths, child streams, or host profile", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "conpty-runner-"));
  const helper = path.join(root, "failing-helper.mjs");
  const observation = path.join(root, "observation.json");
  const token = "credential-not-for-arguments";
  const url = "http://127.0.0.1:41999";
  await writeFile(helper, 'import fs from "node:fs"; fs.writeFileSync(process.argv[3], JSON.stringify({ args: process.argv, env: process.env })); console.log(process.env.SERVICE_LASSO_API_TOKEN + process.env.SERVICE_LASSO_API_URL + process.argv[3]); console.error("raw-child-output"); process.exit(1);');
  const host = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot ?? "C:\\Windows", USERPROFILE: "host-profile", HOST_SECRET: "host-secret" };
  await assert.rejects(
    runConptyHelper({ command: process.execPath, helperPath: helper, executable: observation, mode: "connected", apiUrl: url, apiToken: token, envSource: host }),
    (error) => error.message === "Windows ConPTY TUI probe did not complete its bounded assertions.",
  );
  const seen = JSON.parse(await readFile(observation, "utf8"));
  assert.equal(seen.args.includes(token), false);
  assert.equal(seen.args.includes(url), false);
  assert.notEqual(seen.env.USERPROFILE, "host-profile");
  assert.equal(seen.env.HOST_SECRET, undefined);
  assert.equal(seen.env.SERVICE_LASSO_API_TOKEN, token);
  assert.equal(seen.env.SERVICE_LASSO_API_URL, url);
  assert.deepEqual(Object.keys(conptyHelperEnvironment({ apiUrl: url, apiToken: token, source: host })).sort(), ["APPDATA", "LOCALAPPDATA", "PATH", "SERVICE_LASSO_API_TOKEN", "SERVICE_LASSO_API_URL", "SystemRoot", "USERPROFILE"]);
});

test("ConPTY helper waits for the owned containment host to close after timeout", async () => {
  const helper = path.join(repoRoot, "scripts", "verify-operator-tui-conpty.py");
  const launcher = path.join(repoRoot, "src", "runtime", "execution", "windows-managed-launcher-native.exe");
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  let killed = false;
  child.kill = () => {
    killed = true;
    return true;
  };
  let settled = false;
  let spawned;
  const didSpawn = new Promise((resolve) => { spawned = resolve; });
  const result = runConptyHelper({
    command: process.execPath,
    helperPath: helper,
    executable: "fixture.exe",
    mode: "connected",
    apiUrl: "http://127.0.0.1:41999",
    apiToken: "synthetic-attempt-token-value",
    envSource: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot ?? "C:\\Windows" },
    timeoutMs: 25,
    platform: "win32",
    managedLauncherPath: launcher,
    spawnProcess: (command, args, options) => {
      assert.equal(command, launcher);
      assert.deepEqual(args, []);
      assert.equal(options.env.SERVICE_LASSO_API_TOKEN, "synthetic-attempt-token-value");
      assert.equal(options.env.SERVICE_LASSO_API_URL, "http://127.0.0.1:41999");
      const payload = JSON.parse(Buffer.from(options.env.SERVICE_LASSO_MANAGED_LAUNCH_PAYLOAD, "base64").toString("utf8"));
      assert.equal(JSON.stringify(payload).includes("synthetic-attempt-token-value"), false);
      assert.equal(JSON.stringify(payload).includes("127.0.0.1:41999"), false);
      assert.equal(payload.requireExecutableBinding, true);
      assert.deepEqual(payload.argumentBindings, [{ index: 0, prefix: "", bindingIndex: 1 }]);
      spawned();
      return child;
    },
  }).then(() => { settled = true; }, () => { settled = true; });
  await didSpawn;
  await new Promise((resolve) => setTimeout(resolve, 75));
  assert.equal(killed, true);
  assert.equal(settled, false);
  child.emit("close", 1, "SIGTERM");
  await result;
  assert.equal(settled, true);
});

test("Windows ConPTY timeout terminates the helper's Job Object descendant before reporting failure", {
  skip: process.platform !== "win32",
  timeout: 20_000,
}, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "conpty-owned-tree-"));
  const helper = path.join(root, "surviving-helper.mjs");
  const descendantPath = path.join(root, "descendant.pid");
  let descendantPid;
  try {
    await writeFile(helper, [
      'import { spawn } from "node:child_process";',
      'import { writeFileSync } from "node:fs";',
      'const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
      'writeFileSync(process.argv[3], String(descendant.pid));',
      'setInterval(() => {}, 1000);',
    ].join("\n"));
    const run = assert.rejects(
      runConptyHelper({
        command: process.execPath,
        helperPath: helper,
        executable: descendantPath,
        mode: "connected",
        apiUrl: "http://127.0.0.1:41999",
        apiToken: "synthetic-attempt-token-value",
        timeoutMs: 1_000,
      }),
      (error) => error.message === "Windows ConPTY TUI probe did not complete its bounded assertions.",
    );
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      try {
        descendantPid = Number((await readFile(descendantPath, "utf8")).trim());
        if (Number.isInteger(descendantPid) && descendantPid > 0) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok(Number.isInteger(descendantPid) && descendantPid > 0);
    await run;
    assert.throws(() => process.kill(descendantPid, 0));
  } finally {
    if (Number.isInteger(descendantPid) && descendantPid > 0) {
      try { process.kill(descendantPid, "SIGKILL"); } catch {}
    }
    await (await import("node:fs/promises")).rm(root, { recursive: true, force: true });
  }
});

test("owned unavailable endpoint disposes a held loopback socket within its bounded cleanup", async () => {
  const endpoint = await createOwnedUnavailableEndpoint();
  const target = new URL(endpoint.url);
  const socket = createConnection({ host: target.hostname, port: Number(target.port) });
  await new Promise((resolve, reject) => socket.once("connect", resolve).once("error", reject));
  const started = Date.now();
  await endpoint.close();
  assert.ok(Date.now() - started < 1_100);
  socket.destroy();
});

test("ConPTY helper reports cleanup over a primary failure and proves cleanup on success", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "conpty-python-"));
  const packageRoot = path.join(root, "winpty");
  await writeFile(path.join(root, "__placeholder__"), "");
  await (await import("node:fs/promises")).mkdir(packageRoot);
  await writeFile(path.join(packageRoot, "__init__.py"), "");
  await writeFile(path.join(packageRoot, "enums.py"), "class Backend:\n    ConPTY = object()\n");
  await writeFile(path.join(packageRoot, "ptyprocess.py"), [
    "import os",
    "class Process:",
    "    def write(self, value): pass",
    "    def isalive(self): return False",
    "    def close(self, force=True):",
    "        if os.environ.get('CONPTY_CLOSE_FAIL') == '1': raise OSError('injected cleanup failure')",
    "class PtyProcess:",
    "    @staticmethod",
    "    def spawn(*args, **kwargs): return Process()",
  ].join("\n"));
  const invoke = (waitResult, cleanupFailure) => spawnSync("python", ["-c", [
    "import importlib.util, os, sys",
    `spec = importlib.util.spec_from_file_location('probe', r'${path.join(repoRoot, "scripts", "verify-operator-tui-conpty.py").replaceAll("\\", "\\\\")}')`,
    "probe = importlib.util.module_from_spec(spec); spec.loader.exec_module(probe)",
    `probe.wait_for = lambda *args: (${waitResult ? "True" : "False"}, '')`,
    "sys.argv = ['probe', '--executable', 'fixture.exe', '--mode', 'unavailable']",
    "raise SystemExit(probe.main())",
  ].join("; ")], {
    env: { ...process.env, PYTHONPATH: root, SERVICE_LASSO_API_URL: "http://127.0.0.1:41234", SERVICE_LASSO_API_TOKEN: "synthetic-attempt-token-value", CONPTY_CLOSE_FAIL: cleanupFailure ? "1" : "0" },
    encoding: "utf8",
  });
  const failed = invoke(false, true);
  assert.equal(failed.status, 1);
  assert.equal(failed.stdout.trim(), '{"ok":false,"stage":"cleanup","primaryStage":"startup"}');
  const succeeded = invoke(true, false);
  assert.equal(succeeded.status, 0);
  assert.equal(succeeded.stdout.trim(), '{"ok":true,"mode":"unavailable","startup":"unavailable","navigation":"not_applicable","exit":"q"}');
});

test("terminal probes bind retained-tool verification to its owning module", async () => {
  const operatorTools = await import("../scripts/operator-tool-packaging-lib.mjs");
  assert.equal(typeof operatorTools.verifyRetainedOperatorTools, "function");
  for (const probe of ["verify-operator-tui-conpty.mjs", "verify-operator-tui-pty.mjs"]) {
    const source = await readFile(path.join(repoRoot, "scripts", probe), "utf8");
    assert.match(source, /import \{ verifyRetainedOperatorTools \} from "\.\/operator-tool-packaging-lib\.mjs"/u);
    assert.doesNotMatch(source, /verifyRetainedOperatorTools \} from "\.\/release-artifact-lib\.mjs"/u);
  }
});

for (const { workflowName, probeName, platforms } of [
  { workflowName: "release-qualification.yml", probeName: "verify-operator-tui-conpty.mjs", platforms: ["win32", "linux", "darwin"] },
  { workflowName: "release-qualification-scoped.yml", probeName: "verify-operator-tui-conpty-scoped.mjs", platforms: ["win32", "linux"] },
]) {
test(`${workflowName} runs the pinned Windows ConPTY probe without publication`, async () => {
  const workflow = await readFile(path.join(repoRoot, ".github", "workflows", workflowName), "utf8");
  const requirements = await readFile(path.join(repoRoot, "scripts", "requirements-conpty.txt"), "utf8");
  assert.match(requirements, /^pywinpty==3\.0\.5 ; python_version == "3\.12" and platform_system == "Windows" and platform_machine == "AMD64" --hash=sha256:d62946adf14b15b54c0b8d785f93fe18b04da23f4ad59e2e8c4612646e9abd23$/mu);
  assert.equal(requirements.trim(), 'pywinpty==3.0.5 ; python_version == "3.12" and platform_system == "Windows" and platform_machine == "AMD64" --hash=sha256:d62946adf14b15b54c0b8d785f93fe18b04da23f4ad59e2e8c4612646e9abd23');
  assert.equal(workflow.match(/uses: actions\/setup-python@/gu)?.length, 1);
  assert.match(workflow, /name: Set up hash-pinned Windows ConPTY host\n        if: matrix\.platform == 'win32'\n        uses: actions\/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97 # v7\.0\.0\n        with:\n          python-version: "3\.12"\n          architecture: "x64"/u);
  assert.match(workflow, /python-version: "3\.12"\n          architecture: "x64"/u);
  assert.match(workflow, /python -m pip install --require-hashes --only-binary=:all: --no-deps -r scripts\/requirements-conpty\.txt/u);
  assert.equal(workflow.match(/name: Install hash-pinned Windows ConPTY host/gu)?.length, 1);
  assert.match(workflow, /name: Install hash-pinned Windows ConPTY host\n        if: matrix\.platform == 'win32'\n        run: "python -m pip install --require-hashes --only-binary=:all: --no-deps -r scripts\/requirements-conpty\.txt"/u);
  assert.match(workflow, /name: Verify attached-terminal TUI behavior \(Windows ConPTY\)\n        if: matrix\.platform == 'win32'/u);
  assert.equal(workflow.match(/name: Verify attached-terminal TUI behavior \(Windows ConPTY\)/gu)?.length, 1);
  assert.ok(workflow.includes(`name: Verify attached-terminal TUI behavior (Windows ConPTY)\n        if: matrix.platform == 'win32'\n        env:\n          SERVICE_LASSO_RELEASE_METADATA_TOKEN: \${{ github.token }}\n        run: node scripts/${probeName}\n`));
  const packagedJob = workflow.split("\n  qualify-mcp-packaged:\n")[1]?.split("\n  qualify-release:\n")[0];
  assert.ok(packagedJob, "actual packaged qualification job must exist");
  assert.deepEqual([...packagedJob.matchAll(/^            platform: (\w+)$/gmu)].map((match) => match[1]), platforms);
  assert.equal(packagedJob.match(/uses: actions\/setup-python@/gu)?.length, 1);
  assert.ok(packagedJob.includes(`run: node scripts/${probeName}\n`));
  assert.equal(workflow.includes("Create immutable GitHub release"), false);
  assert.doesNotMatch(workflow, /\bnpm publish\b|\bgh release create\b/u);
});
}

test("Windows ConPTY probe holds a controlled unavailable endpoint and continues cleanup after a stop failure", async () => {
  const source = await readFile(path.join(repoRoot, "scripts", "verify-operator-tui-conpty.mjs"), "utf8");
  const endpoint = await readFile(path.join(repoRoot, "scripts", "operator-tui-conpty-endpoint.mjs"), "utf8");
  assert.match(source, /import \{ createOwnedUnavailableEndpoint \} from "\.\/operator-tui-conpty-endpoint\.mjs"/u);
  assert.match(endpoint, /createServer\(\(_request, response\) => response\.destroy\(\)\)/u);
  assert.match(endpoint, /server\.listen\(0, "127\.0\.0\.1"/u);
  assert.match(source, /runConptyHelper\(\{ helperPath, executable: tuiExecutable, mode: "unavailable", apiUrl: unavailableUrl, apiToken: unavailableToken \}\)/u);
  assert.match(source, /\(\) => apiServer\?\.stop\(\)/u);
  assert.match(source, /\(\) => rm\(tempRoot, \{ recursive: true, force: true \}\)/u);
  assert.match(source, /cleanupFailures\.length && !primaryFailure/u);
});
