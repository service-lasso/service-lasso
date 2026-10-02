import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Windows ConPTY helper uses a bounded host with a sanitized child environment", async () => {
  const source = await readFile(path.join(repoRoot, "scripts", "verify-operator-tui-conpty.py"), "utf8");
  assert.match(source, /Backend\.ConPTY/u);
  assert.match(source, /process\.close\(force=True\)/u);
  assert.match(source, /"SERVICE_LASSO_API_URL"/u);
  assert.match(source, /if not args\.api_url:/u);
  assert.doesNotMatch(source, /os\.environ\.copy\(\)/u);
  assert.match(source, /\{"ok": False, "stage": stage\}/u);
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

test("Release Qualification runs the Windows ConPTY probe without publication", async () => {
  const workflow = await readFile(path.join(repoRoot, ".github", "workflows", "release-qualification.yml"), "utf8");
  const requirements = await readFile(path.join(repoRoot, "scripts", "requirements-conpty.txt"), "utf8");
  assert.match(requirements, /^pywinpty==3\.0\.5 ; python_version == "3\.12" and platform_system == "Windows" and platform_machine == "AMD64" --hash=sha256:d62946adf14b15b54c0b8d785f93fe18b04da23f4ad59e2e8c4612646e9abd23$/mu);
  assert.match(workflow, /actions\/setup-python@ece7cb06caefa5fff74198d8649806c4678c61a1/u);
  assert.match(workflow, /python-version: "3\.12"\n          architecture: "x64"/u);
  assert.match(workflow, /python -m pip install --require-hashes --only-binary=:all: --no-deps -r scripts\/requirements-conpty\.txt/u);
  assert.match(workflow, /name: Verify attached-terminal TUI behavior \(Windows ConPTY\)\n        if: matrix\.platform == 'win32'/u);
  assert.match(workflow, /run: node scripts\/verify-operator-tui-conpty\.mjs/u);
  assert.equal(workflow.includes("Create immutable GitHub release"), false);
});

test("Windows ConPTY probe holds a controlled unavailable endpoint and continues cleanup after a stop failure", async () => {
  const source = await readFile(path.join(repoRoot, "scripts", "verify-operator-tui-conpty.mjs"), "utf8");
  assert.match(source, /createServer\(/u);
  assert.match(source, /response\.statusCode = 503/u);
  assert.match(source, /"--mode", "unavailable", "--api-url", unavailableEndpoint\.url/u);
  assert.match(source, /\(\) => apiServer\?\.stop\(\)/u);
  assert.match(source, /\(\) => rm\(tempRoot, \{ recursive: true, force: true \}\)/u);
  assert.match(source, /cleanupFailures\.length && !primaryFailure/u);
});
