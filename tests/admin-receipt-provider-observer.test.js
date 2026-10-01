import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function waitFor(file, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { await access(file); return JSON.parse(await readFile(file, "utf8")); } catch { await new Promise((resolve) => setTimeout(resolve, 10)); }
  }
  throw new Error(`Timed out waiting for ${path.basename(file)}`);
}

test("AC-4BY.2 durable observer writes immutable unresolved custody then an eventual exact close", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "service-lasso-provider-observer-"));
  const observerRoot = path.join(root, "private-observer");
  const provider = path.join(root, "provider.mjs");
  const config = path.join(root, "config.json");
  try {
    await writeFile(provider, "setInterval(() => process.stdout.write('private-raw\\n'), 20);\n");
    await writeFile(config, JSON.stringify({ root: observerRoot, command: process.execPath, args: [provider], cwd: root, timeoutMs: 40, nonce: "a".repeat(64), source: { head: "b".repeat(40), tree: "c".repeat(40) }, inputs: { workspaceRoot: root } }));
    const observer = spawn(process.execPath, [fileURLToPath(new URL("../scripts/admin-receipt-provider-observer.mjs", import.meta.url)), config], { stdio: "ignore", windowsHide: true });
    const initial = await waitFor(path.join(observerRoot, "initial.json"));
    const unresolved = await waitFor(path.join(observerRoot, "unresolved.json"));
    assert.equal(unresolved.state, "UNRESOLVED");
    assert.equal(unresolved.nonce, initial.nonce);
    assert.equal(unresolved.provider.pid, initial.provider.pid);
    assert.equal(typeof initial.provider.birth, "string");
    assert.ok(initial.provider.birth.length > 0);
    // This is the explicit adverse fixture interruption: exact provider PID
    // from the immutable initial receipt, never a process-name sweep.
    process.kill(initial.provider.pid, "SIGKILL");
    const closed = await waitFor(path.join(observerRoot, "close.json"));
    assert.equal(closed.unresolved, "unresolved.json");
    assert.equal(closed.provider.pid, initial.provider.pid);
    assert.notEqual(closed.terminal.exitCode, 0);
    await assert.rejects(writeFile(path.join(observerRoot, "unresolved.json"), "overwrite", { flag: "wx" }));
    // close.json is written only after the observer received the provider's
    // terminal close. Do not wait on a late listener that could miss the
    // already-emitted observer exit event.
  } finally { await rm(root, { recursive: true, force: true }); }
});
