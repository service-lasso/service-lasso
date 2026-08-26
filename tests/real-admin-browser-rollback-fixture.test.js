import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createRealAdminBrowserSampleSource,
  FAIL_NEXT_SAMPLE_START_ENV,
  FAIL_NEXT_SAMPLE_START_PATH,
  handleFailNextSampleStartRequest,
  SAMPLE_START_FAILURE_EXIT_CODE,
} from "./fixtures/real-admin-browser-rollback.mjs";

const PROCESS_TIMEOUT_MS = 5_000;
const MAX_CAPTURE_BYTES = 4_096;

function waitForExit(child, timeoutMs = PROCESS_TIMEOUT_MS) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("sample subprocess did not exit within the bounded fixture window"));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

function captureBounded(child) {
  let stdout = "";
  let stderr = "";
  const capture = (target, chunk) => {
    const next = target() + chunk.toString("utf8");
    if (Buffer.byteLength(next) > MAX_CAPTURE_BYTES) child.kill("SIGKILL");
    return next.slice(0, MAX_CAPTURE_BYTES);
  };
  child.stdout.on("data", (chunk) => { stdout = capture(() => stdout, chunk); });
  child.stderr.on("data", (chunk) => { stderr = capture(() => stderr, chunk); });
  return () => ({ stdout, stderr });
}

async function waitForFile(filePath, timeoutMs = PROCESS_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await readFile(filePath, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("sample readiness evidence was not created within the bounded fixture window");
}

function startSample(sampleRoot, markerPath, secretValue) {
  return spawn(process.execPath, [path.join(sampleRoot, "runtime", "sample.mjs")], {
    cwd: sampleRoot,
    env: {
      ...process.env,
      [FAIL_NEXT_SAMPLE_START_ENV]: markerPath,
      SAMPLE_REQUIRED_TOKEN: secretValue,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

test("real browser rollback hook fails one sample start and permits the next without leaking material", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-real-admin-rollback-"));
  const workspaceRoot = path.join(tempRoot, "private-workspace-sentinel");
  const sampleRoot = path.join(tempRoot, "sample-service");
  const markerDirectory = path.join(workspaceRoot, ".service-lasso", "test-fixtures");
  const markerPath = path.join(markerDirectory, "sample-start-failure.once");
  const samplePath = path.join(sampleRoot, "runtime", "sample.mjs");
  const evidencePath = path.join(sampleRoot, ".state", "browser-broker-evidence.json");
  const secretValue = "sample-secret-value-sentinel-must-not-leak-887";
  let second = null;
  const server = http.createServer(async (request, response) => {
    if (new URL(request.url ?? "/", "http://127.0.0.1").pathname === FAIL_NEXT_SAMPLE_START_PATH) {
      await handleFailNextSampleStartRequest(request, response, markerPath);
      return;
    }
    response.writeHead(404);
    response.end();
  });

  try {
    await mkdir(path.dirname(samplePath), { recursive: true });
    await writeFile(samplePath, createRealAdminBrowserSampleSource());
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const port = server.address().port;
    const controlEndpoint = `http://127.0.0.1:${port}${FAIL_NEXT_SAMPLE_START_PATH}`;
    const wrongMethod = await fetch(controlEndpoint);
    assert.equal(wrongMethod.status, 405);
    const wrongMethodBody = await wrongMethod.json();
    assert.deepEqual(wrongMethodBody, { outcome: "method_not_allowed" });
    const bodyRejected = await fetch(controlEndpoint, { method: "POST", body: "not-allowed" });
    assert.equal(bodyRejected.status, 400);
    const bodyRejectedBody = await bodyRejected.json();
    assert.deepEqual(bodyRejectedBody, { outcome: "request_body_not_allowed" });

    const response = await fetch(controlEndpoint, {
      method: "POST",
    });
    assert.equal(response.status, 200);
    const armResult = await response.json();
    assert.deepEqual(armResult, { outcome: "sample_start_failure_armed" });
    assert.doesNotMatch(JSON.stringify(armResult), /path|value|secret|marker/i);
    const repeated = await fetch(controlEndpoint, { method: "POST" });
    assert.equal(repeated.status, 200);
    const repeatedBody = await repeated.json();
    assert.deepEqual(repeatedBody, { outcome: "sample_start_failure_already_armed" });
    const serializedControlBodies = JSON.stringify([
      wrongMethodBody,
      bodyRejectedBody,
      armResult,
      repeatedBody,
    ]);
    assert.equal(serializedControlBodies.includes(tempRoot), false);
    assert.equal(serializedControlBodies.includes(markerPath), false);
    assert.equal(serializedControlBodies.includes(secretValue), false);

    const first = startSample(sampleRoot, markerPath, secretValue);
    const firstOutput = captureBounded(first);
    assert.deepEqual(await waitForExit(first), { code: SAMPLE_START_FAILURE_EXIT_CODE, signal: null });
    assert.deepEqual(firstOutput(), { stdout: "", stderr: "" });
    await assert.rejects(access(markerPath), (error) => error?.code === "ENOENT");
    assert.deepEqual(await readdir(markerDirectory), []);

    second = startSample(sampleRoot, markerPath, secretValue);
    const secondOutput = captureBounded(second);
    const rawEvidence = await waitForFile(evidencePath);
    assert.equal(second.exitCode, null);
    assert.deepEqual(JSON.parse(rawEvidence), {
      present: true,
      digest: createHash("sha256").update(secretValue).digest("hex"),
    });
    second.kill("SIGTERM");
    const secondExit = await waitForExit(second);
    assert.equal(
      (secondExit.code === 0 && secondExit.signal === null) ||
        (secondExit.code === null && secondExit.signal === "SIGTERM"),
      true,
    );
    const output = secondOutput();
    assert.deepEqual(output, { stdout: "", stderr: "" });
    const serializedOutput = `${firstOutput().stdout}${firstOutput().stderr}${output.stdout}${output.stderr}`;
    assert.equal(serializedOutput.includes(tempRoot), false);
    assert.equal(serializedOutput.includes(markerPath), false);
    assert.equal(serializedOutput.includes(secretValue), false);
  } finally {
    if (second && second.exitCode === null && second.signalCode === null) {
      second.kill("SIGKILL");
      await waitForExit(second).catch(() => {});
    }
    server.closeAllConnections?.();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await rm(tempRoot, { recursive: true, force: true });
  }
});
