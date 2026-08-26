import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const MAX_OUTPUT_BYTES = 8 * 1024;
const RUNNER_TIMEOUT_MS = 30_000;
const fixturePath = fileURLToPath(new URL("./fixtures/managed-process-deadline-runner.mjs", import.meta.url));

async function runDeadlineFixture(tempRoot) {
  const child = spawn(process.execPath, [fixturePath], {
    cwd: path.dirname(fileURLToPath(import.meta.url)),
    env: {
      ...process.env,
      SERVICE_LASSO_DEADLINE_TEST_ROOT: tempRoot,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  const capture = (current, chunk) => {
    const next = current + chunk.toString("utf8");
    if (Buffer.byteLength(next) > MAX_OUTPUT_BYTES) child.kill("SIGKILL");
    return next.slice(0, MAX_OUTPUT_BYTES);
  };
  child.stdout.on("data", (chunk) => { stdout = capture(stdout, chunk); });
  child.stderr.on("data", (chunk) => { stderr = capture(stderr, chunk); });

  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("managed deadline fixture exceeded its bounded runner window"));
    }, RUNNER_TIMEOUT_MS);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

test("stopManagedProcess terminates typed within 5000ms when tree control never closes", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-managed-stop-deadline-"));
  try {
    const result = await runDeadlineFixture(tempRoot);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.signal, null);
    assert.equal(Buffer.byteLength(result.stdout) <= MAX_OUTPUT_BYTES, true);
    assert.equal(Buffer.byteLength(result.stderr) <= MAX_OUTPUT_BYTES, true);
    assert.equal(result.stderr, "");
    const evidence = JSON.parse(result.stdout);
    assert.equal(evidence.outcome, "deadline_observed");
    assert.equal(evidence.errorCode, "PROCESS_CONTROL_DEADLINE_EXCEEDED");
    assert.equal(evidence.elapsedMs >= 4_500 && evidence.elapsedMs < 6_000, true);
    assert.equal(evidence.helperAborted, true);
    assert.equal(evidence.finalizationOutcome, "converged");
    assert.equal(result.stdout.includes(tempRoot), false);
    assert.equal(result.stderr.includes(tempRoot), false);
    assert.doesNotMatch(result.stdout, /path|secret|credential|payload|value/i);
  } finally {
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
