import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import {
  createSafeRealAdminBrowserTeardownFailure,
  RealAdminBrowserTeardownError,
  teardownRealAdminBrowserFixture,
} from "./fixtures/real-admin-browser-shutdown.mjs";

const shutdownRunnerPath = path.resolve(
  "tests/fixtures/real-admin-browser-shutdown-runner.mjs",
);
const realBrowserRunnerPath = path.resolve(
  "tests/fixtures/real-admin-browser-runner.mjs",
);
const sourceHead = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const sourceTree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
  encoding: "utf8",
}).trim();

function captureBoundedText(stream, maxBytes = 65_536) {
  const chunks = [];
  let byteLength = 0;
  stream.on("data", (chunk) => {
    byteLength += chunk.length;
    if (byteLength <= maxBytes) chunks.push(chunk);
  });
  return () => Buffer.concat(chunks).toString("utf8");
}

function waitForReady(child, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value, error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("message", onMessage);
      child.off("error", onError);
      child.off("exit", onExit);
      if (error) reject(error);
      else resolve(value);
    };
    const onMessage = (message) => {
      if (message?.type === "ready") finish(message);
    };
    const onError = (error) => finish(null, error);
    const onExit = () =>
      finish(null, new Error("Shutdown runner exited before readiness."));
    const timer = setTimeout(
      () => finish(null, new Error("Shutdown runner readiness timed out.")),
      timeoutMs,
    );
    child.once("error", onError);
    child.once("exit", onExit);
    child.on("message", onMessage);
  });
}

function waitForPrelaunchReady(child, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Shutdown runner prelaunch readiness timed out.")),
      timeoutMs,
    );
    const onMessage = (message) => {
      if (message?.type !== "prelaunch-ready") return;
      clearTimeout(timer);
      child.off("message", onMessage);
      resolve();
    };
    child.on("message", onMessage);
    child.once("error", (error) => {
      clearTimeout(timer);
      child.off("message", onMessage);
      reject(error);
    });
  });
}

function waitForExit(child, timeoutMs = 10_000) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({
      code: child.exitCode,
      signal: child.signalCode,
      completedAt: Date.now(),
    });
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Shutdown runner exit timed out.")),
      timeoutMs,
    );
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, completedAt: Date.now() });
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function waitForRealBrowserReady(child, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = "";
    const finish = (value, error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout.off("data", onData);
      child.off("error", onError);
      child.off("exit", onExit);
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk) => {
      stdout += chunk.toString("utf8");
      if (Buffer.byteLength(stdout) > 65_536) {
        finish(
          null,
          new Error("Real browser runner readiness output exceeded its bound."),
        );
        return;
      }
      const newline = stdout.indexOf("\n");
      if (newline < 0) return;
      try {
        const ready = JSON.parse(stdout.slice(0, newline));
        if (ready?.contractVersion !== "service-lasso.real-admin-browser.v2") {
          finish(
            null,
            new Error(
              "Real browser runner returned an unexpected readiness contract.",
            ),
          );
          return;
        }
        finish({ ready, stdout });
      } catch {
        finish(
          null,
          new Error("Real browser runner returned invalid readiness JSON."),
        );
      }
    };
    const onError = (error) => finish(null, error);
    const onExit = () =>
      finish(null, new Error("Real browser runner exited before readiness."));
    const timer = setTimeout(
      () => finish(null, new Error("Real browser runner readiness timed out.")),
      timeoutMs,
    );
    child.stdout.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

function processIsRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

async function observeExternalOwnedProcess(pid, expectedParentPid) {
  if (process.platform === "win32") {
    const command = `Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" | Select-Object ProcessId,ParentProcessId,CreationDate,ExecutablePath | ConvertTo-Json -Compress`;
    const observed = JSON.parse(
      execFileSync(
        "powershell.exe",
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
        { encoding: "utf8", windowsHide: true },
      ),
    );
    assert.equal(observed.ProcessId, pid);
    assert.equal(observed.ParentProcessId, expectedParentPid);
    assert.equal(typeof observed.CreationDate, "string");
    assert.ok(observed.CreationDate.length > 0);
    assert.equal(typeof observed.ExecutablePath, "string");
    assert.ok(observed.ExecutablePath.length > 0);
    return { birth: observed.CreationDate, executable: observed.ExecutablePath };
  }
  const observed = execFileSync(
    "ps",
    ["-o", "ppid=", "-o", "lstart=", "-o", "comm=", "-p", String(pid)],
    { encoding: "utf8" },
  ).trim().match(/^(\d+)\s+(.+\S)\s+(\S+)$/u);
  assert.ok(observed);
  assert.equal(Number(observed[1]), expectedParentPid);
  return { birth: observed[2], executable: observed[3] };
}

function hasListener(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

async function startActualRealBrowserRunner({ prelaunchOnly = false } = {}) {
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), "service-lasso-real-admin-signal-"),
  );
  const adminRoot = path.join(fixtureRoot, "admin");
  const workspaceRoot = path.join(fixtureRoot, "runtime-workspace");
  const servicesRoot = path.join(fixtureRoot, "runtime-services");
  const evidenceRoot = path.join(fixtureRoot, "runtime-evidence");
  const supportRoot = path.join(fixtureRoot, "runtime-support");
  const instanceRegistryPath = path.join(fixtureRoot, "runtime-instance-registry.json");
  const hostPortRegistryPath = path.join(fixtureRoot, "runtime-host-port-registry.json");
  await mkdir(path.join(adminRoot, "runtime"), { recursive: true });
  await Promise.all([workspaceRoot, servicesRoot, evidenceRoot, supportRoot].map((directory) => mkdir(directory, { recursive: true })));
  await writeFile(path.join(adminRoot, "runtime", "server.js"), [
    "const http = require('node:http')",
    "const server = http.createServer((_request, response) => response.end('ready'))",
    "server.listen(Number(process.env.SERVICE_PORT), process.env.SERVICE_HOST)",
    "let stopping = false",
    "const stop = () => { if (stopping) return; stopping = true; server.close(() => process.exit(0)) }",
    "process.on('SIGINT', stop)",
    "process.on('SIGTERM', stop)",
  ].join("\n"));
  const child = spawn(process.execPath, [realBrowserRunnerPath], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      SERVICE_LASSO_REAL_BROWSER_MODE: "first-run",
      SERVICE_LASSO_TEST_ADMIN_ROOT: adminRoot,
      SERVICE_LASSO_TEST_BROKER_BINARY: process.execPath,
      SERVICE_LASSO_WORKSPACE_ROOT: workspaceRoot,
      SERVICE_LASSO_INSTANCE_REGISTRY_PATH: instanceRegistryPath,
      SERVICE_LASSO_HOST_PORT_REGISTRY_PATH: hostPortRegistryPath,
      SERVICE_LASSO_TEST_SERVICES_ROOT: servicesRoot,
      SERVICE_LASSO_TEST_EVIDENCE_ROOT: evidenceRoot,
      SERVICE_LASSO_TEST_SUPPORT_ROOT: supportRoot,
      SERVICE_LASSO_TEST_SOURCE_HEAD: sourceHead,
      SERVICE_LASSO_TEST_SOURCE_TREE: sourceTree,
      ...(prelaunchOnly ? { SERVICE_LASSO_TEST_PRELAUNCH_ONLY: "1" } : {}),
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
  });
  return { child, fixtureRoot, evidenceRoot };
}

test("external observer retains hard-interrupt custody after the runner cannot handle the OS signal", async (t) => {
  for (const signal of ["SIGTERM", "SIGINT"]) {
    await t.test(signal, async () => {
      const { child, fixtureRoot, evidenceRoot } = await startActualRealBrowserRunner({
        prelaunchOnly: true,
      });
      const stderrText = captureBoundedText(child.stderr);
      let closed = null;
      try {
        await waitForPrelaunchReady(child);
        const identity = await observeExternalOwnedProcess(child.pid, process.pid);
        assert.equal(child.kill(signal), true);
        closed = await waitForExit(child, 30_000);
        const internalClosure = await readFile(
          path.join(evidenceRoot, "live-closure-receipt.json"),
          "utf8",
        ).then((source) => JSON.parse(source), () => null);
        await writeFile(
          path.join(evidenceRoot, "external-interrupt-receipt.json"),
          JSON.stringify({
            schema: "service-lasso.real-admin-browser-external-interrupt.v1",
            outcome: internalClosure?.outcome === "interrupted" ? "interrupted" : "unresolved",
            observer: {
              ownedBirthObserved: typeof identity.birth === "string",
              processChainObserved: true,
              nativeIdentityObserved: typeof identity.executable === "string",
            },
            termination: { signal, exitCode: closed.code, exitSignal: closed.signal },
          }),
          { flag: "wx", mode: 0o600 },
        );
        const externalReceipt = JSON.parse(
          await readFile(path.join(evidenceRoot, "external-interrupt-receipt.json"), "utf8"),
        );
        assert.ok(
          externalReceipt.termination.exitSignal !== null ||
            externalReceipt.termination.exitCode !== null,
          stderrText(),
        );
        assert.equal(externalReceipt.observer.ownedBirthObserved, true);
        assert.equal(externalReceipt.observer.processChainObserved, true);
        assert.equal(externalReceipt.observer.nativeIdentityObserved, true);
        assert.equal(internalClosure, null);
      } finally {
        // Prelaunch-only mode has no imported runtime or descendants. Cleanup
        // follows the observed direct-child close, never a PID sweep.
        if (closed) await rm(fixtureRoot, { recursive: true, force: true });
      }
    });
  }
});

test("real Admin browser runner preserves pre-existing literal and linked receipt targets", async (t) => {
  for (const kind of ["literal", "link"]) {
    await t.test(kind, async (subtest) => {
      const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-receipt-custody-"));
      const adminRoot = path.join(fixtureRoot, "admin");
      const workspaceRoot = path.join(fixtureRoot, "workspace");
      const servicesRoot = path.join(fixtureRoot, "services");
      const evidenceRoot = path.join(fixtureRoot, "evidence");
      const supportRoot = path.join(fixtureRoot, "support");
      const initialReceipt = path.join(evidenceRoot, "live-initial-receipt.json");
      const foreignTarget = path.join(fixtureRoot, "foreign-receipt.json");
      await mkdir(path.join(adminRoot, "runtime"), { recursive: true });
      await Promise.all([workspaceRoot, servicesRoot, evidenceRoot, supportRoot].map((directory) => mkdir(directory, { recursive: true })));
      await writeFile(path.join(adminRoot, "runtime", "server.js"), "process.exit(0)\n");
      await writeFile(foreignTarget, "foreign-receipt-state\n");
      try {
        if (kind === "link") {
          try { await symlink(foreignTarget, initialReceipt, "file"); }
          catch (error) { subtest.skip(`symlink unavailable: ${error.code ?? "unknown"}`); return; }
        } else await writeFile(initialReceipt, "foreign-receipt-state\n");
        const child = spawn(process.execPath, [realBrowserRunnerPath], {
          cwd: path.resolve("."),
          env: {
            ...process.env,
            SERVICE_LASSO_TEST_ADMIN_ROOT: adminRoot,
            SERVICE_LASSO_TEST_BROKER_BINARY: process.execPath,
            SERVICE_LASSO_WORKSPACE_ROOT: workspaceRoot,
            SERVICE_LASSO_INSTANCE_REGISTRY_PATH: path.join(fixtureRoot, "instance.json"),
            SERVICE_LASSO_HOST_PORT_REGISTRY_PATH: path.join(fixtureRoot, "ports.json"),
            SERVICE_LASSO_TEST_SERVICES_ROOT: servicesRoot,
            SERVICE_LASSO_TEST_EVIDENCE_ROOT: evidenceRoot,
            SERVICE_LASSO_TEST_SUPPORT_ROOT: supportRoot,
            SERVICE_LASSO_TEST_SOURCE_HEAD: sourceHead,
            SERVICE_LASSO_TEST_SOURCE_TREE: sourceTree,
          },
          stdio: "ignore",
          windowsHide: true,
        });
        const closed = await waitForExit(child, 10_000);
        assert.notEqual(closed.code, 0);
        assert.equal(await readFile(foreignTarget, "utf8"), "foreign-receipt-state\n");
      } finally {
        await rm(fixtureRoot, { recursive: true, force: true });
      }
    });
  }
});

test("real Admin browser runner reaches first-run readiness with its dynamically planned sample port", async () => {
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), "service-lasso-real-admin-startup-smoke-"),
  );
  const adminRoot = path.join(fixtureRoot, "admin");
  const adminRuntime = path.join(adminRoot, "runtime");
  const workspaceRoot = path.join(fixtureRoot, "runtime-workspace");
  const servicesRoot = path.join(fixtureRoot, "runtime-services");
  const evidenceRoot = path.join(fixtureRoot, "runtime-evidence");
  const supportRoot = path.join(fixtureRoot, "runtime-support");
  const instanceRegistryPath = path.join(
    fixtureRoot,
    "runtime-instance-registry.json",
  );
  const hostPortRegistryPath = path.join(
    fixtureRoot,
    "runtime-host-port-registry.json",
  );
  await mkdir(adminRuntime, { recursive: true });
  await Promise.all(
    [workspaceRoot, servicesRoot, evidenceRoot, supportRoot].map((directory) =>
      mkdir(directory, { recursive: true }),
    ),
  );
  await writeFile(
    path.join(adminRuntime, "server.js"),
    [
      "const http = require('node:http')",
      "const host = process.env.SERVICE_HOST ?? '127.0.0.1'",
      "const port = Number(process.env.SERVICE_PORT)",
      "const server = http.createServer((_request, response) => { response.writeHead(200); response.end('ready') })",
      "server.listen(port, host)",
      "let stopping = false",
      "const stop = () => { if (stopping) return; stopping = true; server.close(() => process.exit(0)) }",
      "process.on('SIGINT', stop)",
      "process.on('SIGTERM', stop)",
    ].join("\n"),
  );

  const child = spawn(process.execPath, [realBrowserRunnerPath], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      SERVICE_LASSO_REAL_BROWSER_MODE: "first-run",
      SERVICE_LASSO_TEST_ADMIN_ROOT: adminRoot,
      SERVICE_LASSO_TEST_BROKER_BINARY: process.execPath,
      SERVICE_LASSO_WORKSPACE_ROOT: workspaceRoot,
      SERVICE_LASSO_INSTANCE_REGISTRY_PATH: instanceRegistryPath,
      SERVICE_LASSO_HOST_PORT_REGISTRY_PATH: hostPortRegistryPath,
      SERVICE_LASSO_TEST_SERVICES_ROOT: servicesRoot,
      SERVICE_LASSO_TEST_EVIDENCE_ROOT: evidenceRoot,
      SERVICE_LASSO_TEST_SUPPORT_ROOT: supportRoot,
      SERVICE_LASSO_TEST_SOURCE_HEAD: sourceHead,
      SERVICE_LASSO_TEST_SOURCE_TREE: sourceTree,
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
  });
  const stdoutText = captureBoundedText(child.stdout);
  const stderrText = captureBoundedText(child.stderr);
  let ready = null;
  let closed = null;

  try {
    let readiness;
    try {
      readiness = await waitForRealBrowserReady(child, 60_000);
    } catch (error) {
      error.message = `${error.message} stdout=${JSON.stringify(stdoutText())} stderr=${JSON.stringify(stderrText())}`;
      throw error;
    }
    ready = readiness.ready;
    assert.equal(ready.platform, process.platform);
    assert.match(ready.apiUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.match(ready.adminUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.match(
      ready.controlUrl,
      /^http:\/\/127\.0\.0\.1:\d+\/__service_lasso_test$/,
    );
    assert.equal((await fetch(`${ready.apiUrl}/api/health`)).status, 200);
    assert.equal((await fetch(ready.adminUrl)).status, 200);
    const initialReceipt = JSON.parse(
      await readFile(ready.liveReceipt.initialPath, "utf8"),
    );
    const prelaunchReceipt = JSON.parse(
      await readFile(ready.liveReceipt.prelaunchPath, "utf8"),
    );
    assert.equal(prelaunchReceipt.source.head, sourceHead);
    assert.deepEqual(prelaunchReceipt.runtimeInputs, {
      workspaceRoot,
      servicesRoot,
    });
    assert.equal(prelaunchReceipt.runner.birthObserved, true);
    assert.equal(prelaunchReceipt.runner.parentEdgeObserved, true);
    assert.equal(prelaunchReceipt.runner.nativeIdentityObserved, true);
    assert.deepEqual(
      prelaunchReceipt.assets.map(({ literalPath }) => literalPath),
      [
        "tests/fixtures/real-admin-browser-runner.mjs",
        "tests/fixtures/real-admin-browser-shutdown.mjs",
        "tests/fixtures/real-admin-browser-rollback.mjs",
      ],
    );
    for (const asset of prelaunchReceipt.assets) {
      assert.match(asset.sha256, /^sha256:[a-f0-9]{64}$/);
      assert.ok(Number.isSafeInteger(asset.size) && asset.size > 0);
    }
    assert.match(ready.liveReceipt.prelaunchSHA256, /^sha256:[a-f0-9]{64}$/);
    assert.equal(initialReceipt.source.head, sourceHead);
    assert.equal(initialReceipt.source.tree, sourceTree);
    assert.deepEqual(initialReceipt.runtimeInputs, {
      workspaceRoot,
      servicesRoot,
    });
    assert.equal(initialReceipt.ownedProcesses.runner.pid, child.pid);
    assert.match(ready.liveReceipt.initialSHA256, /^sha256:[a-f0-9]{64}$/);
    const readyReceipt = JSON.parse(
      await readFile(ready.liveReceipt.readyPath, "utf8"),
    );
    assert.equal(readyReceipt.ownedProcesses.admin.parentPid, child.pid);
    assert.deepEqual(readyReceipt.runtimeInputs, initialReceipt.runtimeInputs);
    assert.equal(readyReceipt.ownerCorrelation.state, "observed");
    assert.match(ready.liveReceipt.readySHA256, /^sha256:[a-f0-9]{64}$/);

    const beforeObservation = await fetch(
      `${ready.controlUrl}/fail-next-provider-request`,
      { method: "POST" },
    );
    assert.equal(beforeObservation.status, 409);
    const initialProviderRequest = await fetch(
      `${ready.controlUrl}/v1/secret/data/browser/provider-control`,
      { headers: { "x-vault-token": "browser-vault-token-sentinel-2026-08-14" } },
    );
    assert.equal(initialProviderRequest.status, 404);
    const armed = await fetch(`${ready.controlUrl}/fail-next-provider-request`, {
      method: "POST",
    });
    assert.equal(armed.status, 200);
    const controlledFailure = await fetch(
      `${ready.controlUrl}/v1/secret/data/browser/provider-control`,
      { headers: { "x-vault-token": "browser-vault-token-sentinel-2026-08-14" } },
    );
    assert.equal(controlledFailure.status, 503);
    const subsequentNormalRequest = await fetch(
      `${ready.controlUrl}/v1/secret/data/browser/provider-control`,
      { headers: { "x-vault-token": "browser-vault-token-sentinel-2026-08-14" } },
    );
    assert.equal(subsequentNormalRequest.status, 404);
    const providerReceipt = await fetch(`${ready.controlUrl}/provider-fault-receipt`);
    assert.equal(providerReceipt.status, 200);
    assert.deepEqual(await providerReceipt.json(), {
      outcome: "provider_fault_observed",
      receipt: {
        schema: "service-lasso.real-admin-browser-provider-control.v1",
        phase: "authenticated_provider_request",
        nonce: ready.liveReceipt.nonce,
        state: "controlled_fault_consumed",
      },
    });

    const sampleConfigState = JSON.parse(
      await readFile(
        path.join(servicesRoot, "sample-service", ".state", "config.json"),
        "utf8",
      ),
    );
    const sampleRuntimeState = JSON.parse(
      await readFile(
        path.join(servicesRoot, "sample-service", ".state", "runtime.json"),
        "utf8",
      ),
    );
    const endpointAllocation = JSON.parse(
      await readFile(
        path.join(workspaceRoot, "runtime", "endpoint-allocation.json"),
        "utf8",
      ),
    );
    const sampleReadiness = endpointAllocation.endpoints.find(
      (endpoint) =>
        endpoint.ownerType === "service" &&
        endpoint.ownerId === "sample-service" &&
        endpoint.endpointId === "readiness",
    );
    assert.equal(sampleConfigState.configured, false);
    assert.equal(endpointAllocation.phase, "reserved");
    assert.equal(sampleReadiness?.resolution, "automatic");
    assert.ok(
      Number.isInteger(sampleReadiness?.port) && sampleReadiness.port > 0,
    );
    assert.deepEqual(sampleRuntimeState.ports, {
      readiness: sampleReadiness.port,
    });

    child.send({ type: "service-lasso-real-admin-shutdown" });
    closed = await waitForExit(child, 30_000);
    assert.equal(closed.code, 0, stderrText());
    assert.equal(closed.signal, null);
    const closureReceipt = JSON.parse(
      await readFile(ready.liveReceipt.closurePath, "utf8"),
    );
    assert.equal(closureReceipt.outcome, "closed");
    assert.deepEqual(closureReceipt.termination, {
      trigger: "ipc",
      signal: null,
      exitCode: 0,
    });
    assert.equal(closureReceipt.teardown.admin.exited, true);
    await assert.rejects(
      access(ready.tempRoot),
      (error) => error?.code === "ENOENT",
    );

    const output = `${readiness.stdout}\n${stderrText()}`;
    assert.doesNotMatch(
      output,
      /browser-vault-token-sentinel|sample-start-failure\.once/i,
    );
  } finally {
    if (!closed && child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    if (ready?.tempRoot)
      await rm(ready.tempRoot, { recursive: true, force: true });
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("real Admin browser runner waits for normal Admin exit and late managed finalization before cleanup", async () => {
  const evidenceRoot = await mkdtemp(
    path.join(os.tmpdir(), "service-lasso-runner-shutdown-evidence-"),
  );
  const child = spawn(process.execPath, [shutdownRunnerPath], {
    env: {
      ...process.env,
      SERVICE_LASSO_TEST_SHUTDOWN_EVIDENCE_ROOT: evidenceRoot,
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
  });
  const stderrText = captureBoundedText(child.stderr);
  const phases = [];
  child.on("message", (message) => {
    if (message?.type === "phase") phases.push(message.phase);
  });
  let ready = null;
  let closed = null;

  try {
    ready = await waitForReady(child);
    const shutdownStartedAt = Date.now();
    child.send({ type: "service-lasso-real-admin-shutdown" });
    try {
      closed = await waitForExit(child);
    } catch (error) {
      error.message = `${error.message} phases=${JSON.stringify(phases)} stderr=${JSON.stringify(stderrText())}`;
      throw error;
    }

    assert.equal(closed.code, 0, stderrText());
    assert.equal(closed.signal, null);
    assert.ok(
      closed.completedAt - shutdownStartedAt >= 250,
      "runner must await late managed finalization",
    );
    const managedEvidence = JSON.parse(
      await readFile(path.join(evidenceRoot, "managed-exit.json"), "utf8"),
    );
    const adminEvidence = JSON.parse(
      await readFile(path.join(evidenceRoot, "admin-exit.json"), "utf8"),
    );
    assert.equal(managedEvidence.outcome, "managed_child_exited");
    assert.equal(adminEvidence.outcome, "admin_exited");
    assert.deepEqual(adminEvidence.signals, ["SIGTERM"]);
    assert.ok(managedEvidence.completedAt <= closed.completedAt);
    assert.ok(adminEvidence.completedAt <= closed.completedAt);
    assert.equal(processIsRunning(ready.managedPid), false);
    assert.equal(processIsRunning(ready.adminPid), false);
    assert.equal(await hasListener(ready.apiPort), false);
    await assert.rejects(
      access(ready.tempRoot),
      (error) => error?.code === "ENOENT",
    );
    assert.deepEqual(phases, [
      "teardown_started",
      "admin_exited",
      "api_stop_completed",
      "managed_convergence_started",
      "managed_finalizer_started",
      "managed_finalizer_completed",
      "managed_convergence_completed",
      "lifecycle_reset_completed",
      "teardown_completed",
    ]);
  } finally {
    if (closed && ready?.tempRoot)
      await rm(ready.tempRoot, { recursive: true, force: true });
    if (closed) await rm(evidenceRoot, { recursive: true, force: true });
  }
});

test("teardown preserves both stop failures as metadata and skips unsafe removal", async () => {
  const phases = [];
  const apiServer = {
    server: {
      listening: true,
      close(callback) {
        phases.push("api_server_close");
        this.listening = false;
        queueMicrotask(() => callback());
      },
      closeIdleConnections() {},
      closeAllConnections() {},
    },
    async stop() {
      phases.push("api_server_stop");
      const error = new Error("api-secret-sentinel");
      error.code = "EAPI_TEST";
      throw error;
    },
  };

  await assert.rejects(
    teardownRealAdminBrowserFixture({
      adminProcess: null,
      apiServer,
      async stopManagedProcesses() {
        phases.push("managed_process_convergence");
        const error = new Error("managed-secret-sentinel");
        error.code = "EMANAGED_TEST";
        throw error;
      },
      brokerIPCClient: { destroy() {} },
      vaultServer: null,
      resetLifecycle() {
        phases.push("lifecycle_reset");
      },
      tempRoot: path.join(os.tmpdir(), "private-temp-root-sentinel"),
      async removeTempRoot() {
        phases.push("temp_root_cleanup");
      },
    }),
    (error) => {
      assert.ok(error instanceof RealAdminBrowserTeardownError);
      const safeFailure = createSafeRealAdminBrowserTeardownFailure(error);
      assert.deepEqual(safeFailure.failures, [
        { phase: "api_server_stop", code: "eapi_test" },
        { phase: "managed_process_convergence", code: "emanaged_test" },
      ]);
      const serialized = JSON.stringify(safeFailure);
      assert.doesNotMatch(
        serialized,
        /secret-sentinel|private-temp-root|api-secret|managed-secret/i,
      );
      return true;
    },
  );
  assert.deepEqual(phases, [
    "api_server_stop",
    "managed_process_convergence",
    "api_server_close",
    "lifecycle_reset",
  ]);
});

test("teardown awaits already-closing API and vault servers before removal", async () => {
  const apiSocket = net.createServer(() => {});
  const vaultSocket = net.createServer(() => {});
  apiSocket.listen(0, "127.0.0.1");
  vaultSocket.listen(0, "127.0.0.1");
  await Promise.all([
    new Promise((resolve) => apiSocket.once("listening", resolve)),
    new Promise((resolve) => vaultSocket.once("listening", resolve)),
  ]);
  const apiClient = net.createConnection(apiSocket.address().port, "127.0.0.1");
  const vaultClient = net.createConnection(
    vaultSocket.address().port,
    "127.0.0.1",
  );
  await Promise.all([
    new Promise((resolve) => apiClient.once("connect", resolve)),
    new Promise((resolve) => vaultClient.once("connect", resolve)),
  ]);
  let apiCloseObserved = false;
  let vaultCloseObserved = false;
  let removalObserved = false;
  apiSocket.once("close", () => {
    apiCloseObserved = true;
  });
  vaultSocket.once("close", () => {
    vaultCloseObserved = true;
  });
  const apiClientTimer = setTimeout(() => apiClient.destroy(), 100);
  const vaultClientTimer = setTimeout(() => vaultClient.destroy(), 250);
  const absentTempRoot = path.join(
    os.tmpdir(),
    `service-lasso-close-order-absent-${process.pid}-${Date.now()}`,
  );

  try {
    await assert.rejects(
      teardownRealAdminBrowserFixture({
        adminProcess: null,
        apiServer: {
          server: apiSocket,
          async stop() {
            apiSocket.close();
            const error = new Error("api-close-secret-sentinel");
            error.code = "EAPI_CLOSE_TEST";
            throw error;
          },
        },
        async stopManagedProcesses() {},
        brokerIPCClient: { destroy() {} },
        vaultServer: vaultSocket,
        resetLifecycle() {},
        tempRoot: absentTempRoot,
        async removeTempRoot() {
          assert.equal(apiCloseObserved, true);
          assert.equal(vaultCloseObserved, true);
          removalObserved = true;
        },
      }),
      (error) => {
        const safeFailure = createSafeRealAdminBrowserTeardownFailure(error);
        assert.deepEqual(safeFailure.failures, [
          { phase: "api_server_stop", code: "eapi_close_test" },
        ]);
        assert.doesNotMatch(
          JSON.stringify(safeFailure),
          /secret-sentinel|close-order-absent/i,
        );
        return true;
      },
    );
    assert.equal(removalObserved, true);
    assert.equal(apiCloseObserved, true);
    assert.equal(vaultCloseObserved, true);
  } finally {
    clearTimeout(apiClientTimer);
    clearTimeout(vaultClientTimer);
    apiClient.destroy();
    vaultClient.destroy();
    if (apiSocket.listening)
      await new Promise((resolve) => apiSocket.close(resolve));
    if (vaultSocket.listening)
      await new Promise((resolve) => vaultSocket.close(resolve));
  }
});
