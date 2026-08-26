import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  armNextSampleStartFailure,
  createRealAdminBrowserSampleSource,
  FAIL_NEXT_SAMPLE_START_ENV,
  FAIL_NEXT_SAMPLE_START_PATH,
  handleFailNextSampleStartRequest,
  SAMPLE_READINESS_PORT_ENV,
  SAMPLE_START_FAILURE_EXIT_CODE,
} from "./fixtures/real-admin-browser-rollback.mjs";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { hasManagedProcess, stopAllManagedProcesses } from "../dist/runtime/execution/supervisor.js";
import { startService } from "../dist/runtime/lifecycle/actions.js";
import { getLifecycleState, resetLifecycleState, setLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { createServiceRegistry } from "../dist/runtime/manager/DependencyGraph.js";
import { executeSecretRotation } from "../dist/runtime/operator/secret-rotation-execution.js";
import { buildSecretRotationImpactPlan } from "../dist/runtime/operator/secret-rotation-plan.js";
import { writeManifest } from "./test-helpers.js";

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

async function waitForMissing(filePath, timeoutMs = PROCESS_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(filePath);
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("sample marker was not consumed within the bounded fixture window");
}

async function reserveLoopbackPort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForReady(endpoint, timeoutMs = PROCESS_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(250) });
      if (response.status === 200 && (await response.json()).outcome === "sample_ready") return;
    } catch {
      // The listener is not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("sample HTTP readiness was not published within the bounded fixture window");
}

function startSample(sampleRoot, markerPath, secretValue, readinessPort) {
  return spawn(process.execPath, [path.join(sampleRoot, "runtime", "sample.mjs")], {
    cwd: sampleRoot,
    env: {
      ...process.env,
      [FAIL_NEXT_SAMPLE_START_ENV]: markerPath,
      [SAMPLE_READINESS_PORT_ENV]: String(readinessPort),
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
  const readinessPort = await reserveLoopbackPort();
  const readinessEndpoint = `http://127.0.0.1:${readinessPort}/ready`;
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

    const first = startSample(sampleRoot, markerPath, secretValue, readinessPort);
    const firstOutput = captureBounded(first);
    await waitForMissing(markerPath);
    await assert.rejects(fetch(readinessEndpoint, { signal: AbortSignal.timeout(250) }));
    first.kill("SIGTERM");
    const firstExit = await waitForExit(first);
    assert.equal(
      (firstExit.code === SAMPLE_START_FAILURE_EXIT_CODE && firstExit.signal === null) ||
        (firstExit.code === null && firstExit.signal === "SIGTERM"),
      true,
    );
    assert.deepEqual(firstOutput(), { stdout: "", stderr: "" });
    await assert.rejects(access(markerPath), (error) => error?.code === "ENOENT");
    assert.deepEqual(await readdir(markerDirectory), []);

    second = startSample(sampleRoot, markerPath, secretValue, readinessPort);
    const secondOutput = captureBounded(second);
    await waitForReady(readinessEndpoint);
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

test("real rotation uses lifecycle readiness to roll back one failed start and restore the live service without leaks", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-real-admin-rotation-readiness-"));
  const servicesRoot = path.join(tempRoot, "services");
  const workspaceRoot = path.join(tempRoot, "private-workspace-sentinel");
  const sampleRoot = path.join(servicesRoot, "sample-service");
  const markerPath = path.join(workspaceRoot, ".service-lasso", "test-fixtures", "sample-start-failure.once");
  const samplePath = path.join(sampleRoot, "runtime", "sample.mjs");
  const evidencePath = path.join(sampleRoot, ".state", "browser-broker-evidence.json");
  const readinessPort = await reserveLoopbackPort();
  const readinessEndpoint = `http://127.0.0.1:${readinessPort}/ready`;
  const ref = "sample.GENERATED_TOKEN";
  const previousValue = "sample-previous-value-sentinel-must-not-leak-887";
  const candidateValue = "sample-candidate-value-sentinel-must-not-leak-887";
  const brokerCalls = [];
  let activeVersionId = "version-previous";
  let activeValue = previousValue;
  let stagedValue = null;

  const brokerRuntime = {
    lookup: async ({ refs }) => refs.map((requestedRef) => ({
      ref: requestedRef,
      status: "resolved",
      value: activeValue,
    })),
    management: async ({ path: requestPath, body }) => {
      brokerCalls.push(requestPath);
      if (requestPath.endsWith("/dry-run")) {
        return { statusCode: 200, body: { outcome: "dry_run_ready", auditStatus: "audit_ready" } };
      }
      if (requestPath.endsWith("/status")) {
        return { statusCode: 200, body: { outcome: "ready", currentVersion: { versionId: activeVersionId } } };
      }
      if (requestPath.endsWith("/stage")) {
        stagedValue = body.value;
        return {
          statusCode: 200,
          body: { outcome: "staged", auditStatus: "audit_recorded", stagedVersion: { versionId: "version-candidate" } },
        };
      }
      if (requestPath.endsWith("/activate")) {
        activeVersionId = "version-candidate";
        activeValue = stagedValue;
        return {
          statusCode: 200,
          body: {
            outcome: "applied",
            applied: true,
            auditStatus: "audit_recorded",
            currentVersion: { versionId: activeVersionId },
            previousVersion: { versionId: "version-previous" },
          },
        };
      }
      if (requestPath.endsWith("/rollback")) {
        activeVersionId = "version-previous";
        activeValue = previousValue;
        return {
          statusCode: 200,
          body: {
            outcome: "rolled_back",
            applied: true,
            auditStatus: "audit_recorded",
            currentVersion: { versionId: activeVersionId },
          },
        };
      }
      throw new Error("unexpected Broker rotation operation");
    },
    probe: async () => ({ ready: true }),
    writeback: async () => { throw new Error("unexpected Broker writeback"); },
    operatorRequest: async () => { throw new Error("unexpected Broker operator request"); },
    serverEnv: {},
    transportBinding: null,
  };

  resetLifecycleState();
  try {
    await mkdir(path.dirname(samplePath), { recursive: true });
    await writeFile(samplePath, createRealAdminBrowserSampleSource());
    await writeManifest(servicesRoot, "sample-service", {
      id: "sample-service",
      name: "Sample Service",
      description: "Real lifecycle rotation readiness fixture.",
      executable: process.execPath,
      args: ["runtime/sample.mjs"],
      env: {
        SAMPLE_REQUIRED_TOKEN: "${sample.GENERATED_TOKEN}",
        [FAIL_NEXT_SAMPLE_START_ENV]: markerPath,
        [SAMPLE_READINESS_PORT_ENV]: "${READINESS_PORT}",
      },
      ports: { readiness: readinessPort },
      healthcheck: {
        type: "http",
        url: "http://127.0.0.1:${READINESS_PORT}/ready",
        expected_status: 200,
        retries: 10,
        interval: 100,
        timeout: 500,
      },
      broker: {
        imports: [{
          namespace: "services/sample-service",
          ref,
          as: "SAMPLE_REQUIRED_TOKEN",
          required: true,
          onChange: { mode: "restart" },
        }],
      },
    });

    const services = await discoverServices(servicesRoot);
    const sample = services.find((service) => service.manifest.id === "sample-service");
    assert.ok(sample);
    const registry = createServiceRegistry(services);
    const current = getLifecycleState("sample-service");
    setLifecycleState("sample-service", { ...current, installed: true, configured: true });
    const initialStart = await startService(sample, registry, { workspaceRoot, brokerRuntime });
    assert.equal(initialStart.ok, true);
    assert.equal(initialStart.state.running, true);
    assert.equal(hasManagedProcess("sample-service"), true);
    await waitForReady(readinessEndpoint);
    assert.deepEqual(JSON.parse(await readFile(evidencePath, "utf8")), {
      present: true,
      digest: createHash("sha256").update(previousValue).digest("hex"),
    });

    const armed = await armNextSampleStartFailure(markerPath);
    assert.deepEqual(armed, { outcome: "sample_start_failure_armed" });
    const plan = buildSecretRotationImpactPlan(services, ref);
    assert.equal(plan.status, "ready");
    const operation = await executeSecretRotation({
      operationId: "real-browser-readiness-rollback",
      ref,
      planFingerprint: plan.planFingerprint,
      reason: "bounded real browser automatic rollback qualification",
      confirm: true,
      value: candidateValue,
      actorId: "local:test-operator",
    }, {
      workspaceRoot,
      services,
      registry,
      brokerRuntime,
    });

    assert.equal(operation.outcome, "rolled_back");
    assert.equal(operation.phase, "rolled_back");
    assert.equal(operation.failureCode, "rotation_consumer_not_ready");
    assert.equal(operation.activeVersionId, "version-previous");
    assert.deepEqual(operation.rollbackCompletedOperations, ["sample-service:restart:"]);
    assert.deepEqual(brokerCalls, [
      "/v1/management/secrets/rotation/dry-run",
      "/v1/management/secrets/rotation/status",
      "/v1/management/secrets/rotation/stage",
      "/v1/management/secrets/rotation/activate",
      "/v1/management/secrets/rotation/rollback",
    ]);
    await assert.rejects(access(markerPath), (error) => error?.code === "ENOENT");
    assert.equal(activeVersionId, "version-previous");
    assert.equal(activeValue, previousValue);
    assert.equal(getLifecycleState("sample-service").running, true);
    assert.equal(hasManagedProcess("sample-service"), true);
    await waitForReady(readinessEndpoint);
    assert.deepEqual(JSON.parse(await readFile(evidencePath, "utf8")), {
      present: true,
      digest: createHash("sha256").update(previousValue).digest("hex"),
    });

    const safeOutput = JSON.stringify(operation);
    for (const forbidden of [tempRoot, workspaceRoot, markerPath, previousValue, candidateValue]) {
      assert.equal(safeOutput.includes(forbidden), false);
    }
    const lifecycle = getLifecycleState("sample-service");
    const processOutput = await Promise.all([
      readFile(lifecycle.runtime.logs.stdoutPath, "utf8"),
      readFile(lifecycle.runtime.logs.stderrPath, "utf8"),
    ]);
    assert.deepEqual(processOutput, ["", ""]);
  } finally {
    await stopAllManagedProcesses().catch(() => undefined);
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
