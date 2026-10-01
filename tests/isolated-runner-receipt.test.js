import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args, options) {
  const child = spawn(command, args, { ...options, stdio: "pipe", windowsHide: true });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stderr }));
  });
}

async function readOneReceipt(tempRoot) {
  const receiptDirectory = path.join(tempRoot, "isolated-test-receipts");
  const files = await readdir(receiptDirectory);
  assert.equal(files.length, 1);
  return JSON.parse(await readFile(path.join(receiptDirectory, files[0]), "utf8"));
}

test("isolated runner records an owned spawn error only after its actual close", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-isolated-runner-close-"));
  try {
    const outcome = await run(process.execPath, ["scripts/run-tests-isolated.mjs"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        SERVICE_LASSO_WORKSPACE_ROOT: path.join(tempRoot, "workspace"),
        SERVICE_LASSO_INSTANCE_REGISTRY_PATH: path.join(tempRoot, "instances.json"),
        SERVICE_LASSO_HOST_PORT_REGISTRY_PATH: path.join(tempRoot, "ports.json"),
        SERVICE_LASSO_ENABLE_TEST_HOOKS: "1",
        SERVICE_LASSO_ISOLATED_TEST_SPAWN_ERROR: "build",
      },
    });
    assert.notEqual(outcome.code, 0);
    assert.equal(outcome.signal, null);
    const receipt = await readOneReceipt(tempRoot);
    assert.equal(receipt.terminal.outcome, "failed");
    const buildProcess = receipt.processes.find((entry) => entry.label === "build");
    assert.ok(buildProcess);
    assert.deepEqual(buildProcess.spawnError.kind, "spawn_error");
    assert.equal(buildProcess.ownership.childCreated, false);
    assert.equal(buildProcess.ownership.nativeCustody.status, "not_observed");
    assert.equal(buildProcess.ownership.nativeCustody.reason, "spawn_error");
    assert.ok(buildProcess.close, "the actual child close must be retained after the spawn error");
    assert.equal(buildProcess.close.signal, null);
    assert.notEqual(buildProcess.close.code, 0);
    assert.deepEqual(receipt.terminal.trueCloseExit, buildProcess.close);
  } finally {
    await rm(tempRoot, { recursive: true, force: true, maxRetries: process.platform === "win32" ? 10 : 0 });
  }
});
