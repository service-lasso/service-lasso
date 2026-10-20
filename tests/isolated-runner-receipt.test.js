import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
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
  const jsonFiles = files.filter((fileName) => fileName.endsWith(".json"));
  assert.equal(jsonFiles.length, 1, "exactly one JSON receipt must be present");
  const receipt = JSON.parse(await readFile(path.join(receiptDirectory, jsonFiles[0]), "utf8"));
  assert.equal(receipt.fileName, jsonFiles[0]);
  assert.ok(files.some((fileName) => fileName.endsWith(".stdout.log")), "raw stdout must be retained beside the receipt");
  assert.ok(files.some((fileName) => fileName.endsWith(".stderr.log")), "raw stderr must be retained beside the receipt");
  return receipt;
}

function sha256(value) {
  assert.match(value, /^[a-f0-9]{64}$/u);
}

function assertActualWindowsCustody(processRecord) {
  const custody = processRecord.ownership.nativeCustody;
  assert.equal(custody.status, "observed", `${processRecord.label}: ${custody.reason ?? "missing native custody"}`);
  assert.equal(custody.source, "windows-process-inspector");
  assert.equal(custody.label, processRecord.label);
  sha256(custody.launchCwdSha256);
  assert.equal(custody.root.pid, processRecord.ownership.pid);
  assert.ok(Number.isInteger(custody.root.parentPid) && custody.root.parentPid > 0);
  assert.ok(Number.isFinite(Date.parse(custody.root.createdAt)), "native process birth must be recorded");
  sha256(custody.root.executableSha256);
  sha256(custody.root.commandSha256);
  assert.ok(Array.isArray(custody.processChain) && custody.processChain.length >= 1);
  assert.deepEqual(custody.processChain.find((entry) => entry.pid === custody.root.pid), custody.root);
  for (const entry of custody.processChain) {
    assert.ok(Number.isInteger(entry.pid) && entry.pid > 0);
    assert.ok(Number.isInteger(entry.parentPid) && entry.parentPid > 0);
    assert.ok(Number.isFinite(Date.parse(entry.createdAt)), "native process-chain birth must be recorded");
    sha256(entry.executableSha256);
    sha256(entry.commandSha256);
  }
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
    assert.equal(receipt.schema, "service-lasso.isolated-test-receipt.v1");
    assert.match(receipt.source.head, /^[a-f0-9]{40}$/u);
    assert.match(receipt.source.tree, /^[a-f0-9]{40}$/u);
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
    assert.deepEqual(receipt.rawLogs.disposition, "retained_private");
    assert.equal(receipt.rawLogs.files.length, 2);
  } finally {
    await rm(tempRoot, { recursive: true, force: true, maxRetries: process.platform === "win32" ? 10 : 0 });
  }
});

test("isolated runner rejects a second JSON receipt without deleting raw or prior evidence", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-isolated-runner-collision-"));
  const inputs = {
    SERVICE_LASSO_WORKSPACE_ROOT: path.join(tempRoot, "workspace"),
    SERVICE_LASSO_INSTANCE_REGISTRY_PATH: path.join(tempRoot, "instances.json"),
    SERVICE_LASSO_HOST_PORT_REGISTRY_PATH: path.join(tempRoot, "ports.json"),
  };
  const receiptDirectory = path.join(tempRoot, "isolated-test-receipts");
  try {
    await mkdir(inputs.SERVICE_LASSO_WORKSPACE_ROOT, { recursive: true });
    await writeFile(inputs.SERVICE_LASSO_INSTANCE_REGISTRY_PATH, "{}\n");
    await writeFile(inputs.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH, "{}\n");
    await mkdir(receiptDirectory, { recursive: true });
    await writeFile(path.join(receiptDirectory, "prior-receipt.json"), "{\"preserved\":true}\n");
    await writeFile(path.join(receiptDirectory, "prior.stderr.log"), "private retained diagnostic\n");
    const outcome = await run(process.execPath, ["scripts/run-tests-isolated.mjs"], {
      cwd: repoRoot,
      env: { ...process.env, ...inputs },
    });
    assert.notEqual(outcome.code, 0);
    assert.match(outcome.stderr, /already contains JSON receipt material/);
    assert.equal(await readFile(path.join(receiptDirectory, "prior-receipt.json"), "utf8"), "{\"preserved\":true}\n");
    assert.equal(await readFile(path.join(receiptDirectory, "prior.stderr.log"), "utf8"), "private retained diagnostic\n");
  } finally {
    await rm(tempRoot, { recursive: true, force: true, maxRetries: process.platform === "win32" ? 10 : 0 });
  }
});

test("isolated runner records real external inputs and native custody before a successful build", { skip: process.platform !== "win32", timeout: 60_000 }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-isolated-runner-success-"));
  const inputs = {
    SERVICE_LASSO_WORKSPACE_ROOT: path.join(tempRoot, "external-workspace"),
    SERVICE_LASSO_INSTANCE_REGISTRY_PATH: path.join(tempRoot, "external-instances.json"),
    SERVICE_LASSO_HOST_PORT_REGISTRY_PATH: path.join(tempRoot, "external-ports.json"),
  };
  try {
    await mkdir(inputs.SERVICE_LASSO_WORKSPACE_ROOT, { recursive: true });
    await writeFile(inputs.SERVICE_LASSO_INSTANCE_REGISTRY_PATH, "{}\n");
    await writeFile(inputs.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH, "{}\n");
    const { SERVICE_LASSO_ENABLE_TEST_HOOKS, SERVICE_LASSO_ISOLATED_TEST_FILES, SERVICE_LASSO_ISOLATED_TEST_SPAWN_ERROR, ...baseEnv } = process.env;
    const outcome = await run(process.execPath, ["scripts/run-tests-isolated.mjs"], {
      cwd: repoRoot,
      env: {
        ...baseEnv,
        ...inputs,
        SERVICE_LASSO_ISOLATED_TEST_FILES: "tests/real-app-runtime-owner.test.js",
      },
    });
    assert.equal(outcome.code, 0, outcome.stderr);
    assert.equal(outcome.signal, null);
    assert.equal(new Set(Object.values(inputs)).size, 3);
    const receipt = await readOneReceipt(tempRoot);
    assert.equal(receipt.inputMode, "external");
    assert.equal(receipt.schema, "service-lasso.isolated-test-receipt.v1");
    assert.match(receipt.source.head, /^[a-f0-9]{40}$/u);
    assert.match(receipt.source.tree, /^[a-f0-9]{40}$/u);
    assert.deepEqual(receipt.rawInputs, inputs);
    assert.deepEqual(receipt.actualInputs, inputs);
    assert.equal(receipt.initial.SERVICE_LASSO_WORKSPACE_ROOT.state, "present");
    assert.equal(receipt.initial.SERVICE_LASSO_WORKSPACE_ROOT.kind, "directory");
    for (const key of ["SERVICE_LASSO_INSTANCE_REGISTRY_PATH", "SERVICE_LASSO_HOST_PORT_REGISTRY_PATH"]) {
      assert.equal(receipt.initial[key].state, "present");
      assert.equal(receipt.initial[key].kind, "file");
    }
    const buildProcess = receipt.processes.find((entry) => entry.label === "build");
    const testProcess = receipt.processes.find((entry) => entry.label === "test");
    assert.ok(buildProcess && testProcess);
    assert.ok(Number.isFinite(Date.parse(receipt.initialCapturedAt)));
    assert.ok(Date.parse(receipt.initialCapturedAt) <= Date.parse(buildProcess.ownership.nodeObservedAt));
    for (const asset of Object.values(receipt.nativeAssets)) sha256(asset.sourceSha256);
    for (const relativePath of [
      "runtime/process/windows-process-inspector.exe",
      "runtime/process/windows-process-inspector.provenance.json",
      "runtime/execution/windows-managed-launcher-native.exe",
      "runtime/execution/windows-managed-launcher-native.provenance.json",
    ]) sha256(receipt.nativeAssets[relativePath].buildSha256);
    for (const processRecord of [buildProcess, testProcess]) {
      assert.equal(processRecord.spawnError, null);
      assert.equal(processRecord.ownership.childCreated, true);
      assert.equal(processRecord.close.code, 0);
      assert.equal(processRecord.close.signal, null);
    }
    assertActualWindowsCustody(buildProcess);
    assert.deepEqual(receipt.terminal, { outcome: "passed", trueCloseExit: testProcess.close });
    assert.equal(receipt.rawLogs.disposition, "retained_private");
    assert.equal(receipt.rawLogs.files.length, 4);
  } finally {
    await rm(tempRoot, { recursive: true, force: true, maxRetries: process.platform === "win32" ? 10 : 0 });
  }
});
