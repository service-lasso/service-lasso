import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseConptyProbeResult } from "../scripts/operator-tui-conpty-result.mjs";

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
  assert.match(source, /\{"ok": False, "stage": stage\}/u);
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
  assert.match(requirements, /^pywinpty==3\.0\.5 --hash=sha256:d62946adf14b15b54c0b8d785f93fe18b04da23f4ad59e2e8c4612646e9abd23$/mu);
  assert.match(workflow, /actions\/setup-python@ece7cb06caefa5fff74198d8649806c4678c61a1/u);
  assert.match(workflow, /python -m pip install --require-hashes --only-binary=:all: --no-deps -r scripts\/requirements-conpty\.txt/u);
  assert.match(workflow, /name: Verify attached-terminal TUI behavior \(Windows ConPTY\)\n        if: matrix\.platform == 'win32'/u);
  assert.match(workflow, /run: node scripts\/verify-operator-tui-conpty\.mjs/u);
  assert.equal(workflow.includes("Create immutable GitHub release"), false);
});
