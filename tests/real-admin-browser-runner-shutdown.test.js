import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import {
  createSafeRealAdminBrowserTeardownFailure,
  RealAdminBrowserTeardownError,
  teardownRealAdminBrowserFixture,
} from "./fixtures/real-admin-browser-shutdown.mjs";

const shutdownRunnerPath = path.resolve("tests/fixtures/real-admin-browser-shutdown-runner.mjs");

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
    const onExit = () => finish(null, new Error("Shutdown runner exited before readiness."));
    const timer = setTimeout(
      () => finish(null, new Error("Shutdown runner readiness timed out.")),
      timeoutMs,
    );
    child.once("error", onError);
    child.once("exit", onExit);
    child.on("message", onMessage);
  });
}

function waitForExit(child, timeoutMs = 10_000) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode, completedAt: Date.now() });
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Shutdown runner exit timed out.")), timeoutMs);
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

function processIsRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
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

test("real Admin browser runner waits for forced Admin exit and late managed finalization before cleanup", async () => {
  const evidenceRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-runner-shutdown-evidence-"));
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
    assert.ok(closed.completedAt - shutdownStartedAt >= 250, "runner must await late managed finalization");
    const managedEvidence = JSON.parse(await readFile(path.join(evidenceRoot, "managed-exit.json"), "utf8"));
    const adminEvidence = JSON.parse(await readFile(path.join(evidenceRoot, "admin-exit.json"), "utf8"));
    assert.equal(managedEvidence.outcome, "managed_child_exited");
    assert.equal(adminEvidence.outcome, "admin_exited");
    assert.deepEqual(adminEvidence.signals, ["SIGTERM", "SIGKILL"]);
    assert.ok(managedEvidence.completedAt <= closed.completedAt);
    assert.ok(adminEvidence.completedAt <= closed.completedAt);
    assert.equal(processIsRunning(ready.managedPid), false);
    assert.equal(processIsRunning(ready.adminPid), false);
    assert.equal(await hasListener(ready.apiPort), false);
    await assert.rejects(access(ready.tempRoot), (error) => error?.code === "ENOENT");
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
    if (!closed && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    if (ready?.managedPid && processIsRunning(ready.managedPid)) process.kill(ready.managedPid, "SIGKILL");
    if (ready?.adminPid && processIsRunning(ready.adminPid)) process.kill(ready.adminPid, "SIGKILL");
    if (ready?.tempRoot) await rm(ready.tempRoot, { recursive: true, force: true });
    await rm(evidenceRoot, { recursive: true, force: true });
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
      assert.doesNotMatch(serialized, /secret-sentinel|private-temp-root|api-secret|managed-secret/i);
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
  const vaultClient = net.createConnection(vaultSocket.address().port, "127.0.0.1");
  await Promise.all([
    new Promise((resolve) => apiClient.once("connect", resolve)),
    new Promise((resolve) => vaultClient.once("connect", resolve)),
  ]);
  let apiCloseObserved = false;
  let vaultCloseObserved = false;
  let removalObserved = false;
  apiSocket.once("close", () => { apiCloseObserved = true; });
  vaultSocket.once("close", () => { vaultCloseObserved = true; });
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
        assert.doesNotMatch(JSON.stringify(safeFailure), /secret-sentinel|close-order-absent/i);
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
    if (apiSocket.listening) await new Promise((resolve) => apiSocket.close(resolve));
    if (vaultSocket.listening) await new Promise((resolve) => vaultSocket.close(resolve));
  }
});
