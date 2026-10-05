import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
const providerControlNonce = "7e3e7b477ab1b61c8aa817a5a2cac070f07ccee789fd5a1ef5cb773b7aac8e61";

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

function waitForRunnerMessage(child, type, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Shutdown runner ${type} readiness timed out.`)),
      timeoutMs,
    );
    const onMessage = (message) => {
      if (message?.type !== type) return;
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
    return observeExternalExecutable(
      { birth: observed.CreationDate, executable: observed.ExecutablePath },
      pid,
    );
  }
  const observed = execFileSync(
    "ps",
    ["-o", "ppid=", "-o", "lstart=", "-o", "comm=", "-p", String(pid)],
    { encoding: "utf8" },
  ).trim().match(/^(\d+)\s+(.+\S)\s+(\S+)$/u);
  assert.ok(observed);
  assert.equal(Number(observed[1]), expectedParentPid);
  const executable = process.platform === "linux"
    ? execFileSync("readlink", ["-f", `/proc/${pid}/exe`], { encoding: "utf8" }).trim()
    : observed[3];
  return observeExternalExecutable({ birth: observed[2], executable }, pid);
}

async function observeExternalExecutable({ birth, executable }, pid) {
  const executablePath = await realpath(executable);
  const metadata = await lstat(executablePath);
  assert.equal(metadata.isFile(), true);
  assert.equal(metadata.isSymbolicLink(), false);
  return {
    pid,
    birth,
    nativeIdentity: {
      path: executablePath,
      size: metadata.size,
      sha256: `sha256:${createHash("sha256").update(await readFile(executablePath)).digest("hex")}`,
    },
  };
}

async function sha256File(filePath) {
  return `sha256:${createHash("sha256").update(await readFile(filePath)).digest("hex")}`;
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

async function startActualRealBrowserRunner({ prelaunchOnly = false, initialOnly = false, recoverySink = null } = {}) {
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
  const runnerArgs = [];
  if (recoverySink) {
    // Explicit child-only sink adversary. This exercises the original runner
    // HTTP handler and shutdown, but is surrogate sink scheduling/error proof,
    // never native production custody or operator acceptance.
    const preloadPath = path.join(supportRoot, "recovery-sink-adversary.mjs");
    await writeFile(preloadPath, [
      "import fs from 'node:fs'",
      "import { syncBuiltinESMExports } from 'node:module'",
      "import path from 'node:path'",
      "const originalWrite = fs.promises.writeFile",
      "fs.promises.writeFile = async (file, bytes, options) => {",
      "  if (path.basename(String(file)) !== 'live-provider-control-recovery-receipt.json') return originalWrite(file, bytes, options)",
      "  await new Promise((resolve) => {",
      "    const release = (message) => { if (message?.type === 'release-recovery-sink') { process.off('message', release); resolve() } }",
      "    process.on('message', release)",
      "    process.send({ type: 'recovery-write-pending' })",
      "  })",
      ...(recoverySink === "partial-failure" ? [
        "  await originalWrite(file, String(bytes).slice(0, 17), options)",
        "  const error = new Error('Injected recovery sink failure'); error.code = 'EIO'; throw error",
      ] : ["  return originalWrite(file, bytes, options)"]),
      "}",
      "syncBuiltinESMExports()",
    ].join("\n"));
    runnerArgs.push("--import", pathToFileURL(preloadPath).href);
  }
  runnerArgs.push(realBrowserRunnerPath);
  const child = spawn(process.execPath, runnerArgs, {
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
      SERVICE_LASSO_TEST_PROVIDER_CONTROL_NONCE: providerControlNonce,
      SERVICE_LASSO_TEST_ADMIN_SOURCE_HEAD: sourceHead,
      SERVICE_LASSO_TEST_ADMIN_SOURCE_TREE: sourceTree,
      ...(prelaunchOnly ? { SERVICE_LASSO_TEST_PRELAUNCH_ONLY: "1" } : {}),
      ...(initialOnly ? { SERVICE_LASSO_TEST_INITIAL_ONLY: "1" } : {}),
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
  });
  return { child, fixtureRoot, evidenceRoot, supportRoot };
}

test("actual provider handler owns recovery persistence, concurrent readers and immediate shutdown", async (t) => {
  for (const scenario of ["real-shutdown", "slow-shutdown", "partial-failure", "pending-timeout", "concurrent-readers"]) {
    await t.test(scenario, async (subtest) => {
      const { child, fixtureRoot, evidenceRoot, supportRoot } = await startActualRealBrowserRunner({
        recoverySink: scenario === "real-shutdown" ? null : scenario === "partial-failure" ? "partial-failure" : "slow",
      });
      const stderrText = captureBoundedText(child.stderr);
      const stdoutText = captureBoundedText(child.stdout);
      let closed = null;
      let passed = false;
      try {
        const { ready } = await waitForRealBrowserReady(child, 60_000);
        const sources = JSON.parse(await readFile(path.join(supportRoot, "broker-sources.json"), "utf8"));
        const address = sources.sources.find(({ sourceId }) => sourceId === "vault-browser").address;
        const ca = await readFile(path.join(ready.tempRoot, "vault-test-ca.pem"));
        const providerRequest = (token = "browser-vault-token-sentinel-2026-08-14") => new Promise((resolve, reject) => {
          const request = https.get(`${address}/v1/secret/data/browser/provider-control`, {
            ca, headers: { "x-vault-token": token },
          }, (response) => {
            response.resume();
            response.once("end", () => resolve(response.statusCode));
            response.once("error", reject);
          });
          request.once("error", reject);
        });
        const headers = { "x-service-lasso-provider-control-nonce": providerControlNonce };
        // Match the original fixture's successful-token branch. A denied
        // request cannot establish the authenticated baseline or its receipt.
        assert.equal(await providerRequest("invalid-token"), 403);
        await assert.rejects(access(path.join(evidenceRoot, "live-provider-control-receipt.json")), (error) => error?.code === "ENOENT");
        assert.equal(await providerRequest(), 404);
        assert.equal((await fetch(`${ready.controlUrl}/fail-next-provider-request`, { method: "POST", headers })).status, 200);
        const armedBytes = await readFile(path.join(evidenceRoot, "live-provider-control-receipt.json"));
        assert.equal(await providerRequest(), 503);
        const consumedBytes = await readFile(path.join(evidenceRoot, "live-provider-control-consumed-receipt.json"));
        assert.equal(await providerRequest(), 404);
        const recoveryPath = path.join(evidenceRoot, "live-provider-control-recovery-receipt.json");
        const pending = scenario === "real-shutdown" ? null : waitForRunnerMessage(child, "recovery-write-pending");
        // No extra receipt GET between actual409 and the immediate owning stop.
        assert.equal((await fetch(`${ready.controlUrl}/fail-next-provider-request`, { method: "POST", headers })).status, 409);
        if (pending) {
          await pending;
          await assert.rejects(access(recoveryPath), (error) => error?.code === "ENOENT");
        }
        if (scenario === "concurrent-readers") {
          assert.equal((await fetch(`${ready.controlUrl}/provider-fault-receipt?wait=recovery`, {
            headers: { "x-service-lasso-provider-control-nonce": "0".repeat(64) },
          })).status, 403);
          let readersCompleted = 0;
          const readers = Array.from({ length: 3 }, () => fetch(
            `${ready.controlUrl}/provider-fault-receipt?wait=recovery`,
            { headers, signal: AbortSignal.timeout(5_000) },
          ).then(async (response) => {
            readersCompleted += 1;
            return { status: response.status, body: await response.json() };
          }));
          await new Promise((resolve) => setTimeout(resolve, 100));
          assert.equal(readersCompleted, 0, "a200 must not precede the shared immutable write");
          child.send({ type: "release-recovery-sink" });
          for (const result of await Promise.all(readers)) {
            assert.equal(result.status, 200);
            assert.deepEqual(result.body, {
              outcome: "provider_fault_observed",
              receipt: {
                schema: "service-lasso.real-admin-browser-provider-control.v1",
                phase: "authenticated_provider_request", nonce: ready.liveReceipt.nonce,
                state: "controlled_fault_consumed",
              },
            });
          }
          assert.equal(JSON.parse(await readFile(recoveryPath, "utf8")).state, "controlled_fault_recovered");
          child.send({ type: "service-lasso-real-admin-shutdown" });
        } else if (scenario === "real-shutdown") {
          child.send({ type: "service-lasso-real-admin-shutdown" });
        } else {
          child.send({ type: "service-lasso-real-admin-shutdown" });
          await new Promise((resolve) => setTimeout(resolve, 100));
          assert.equal(child.exitCode, null, "socket closure does not settle an owned write");
          await assert.rejects(access(path.join(evidenceRoot, "live-closure-receipt.json")), (error) => error?.code === "ENOENT");
          if (scenario !== "pending-timeout") child.send({ type: "release-recovery-sink" });
        }
        closed = await waitForExit(child, 30_000);
        const closure = JSON.parse(await readFile(path.join(evidenceRoot, "live-closure-receipt.json"), "utf8"));
        const negative = scenario === "partial-failure" || scenario === "pending-timeout";
        assert.equal(closed.code, negative ? 1 : 0, stderrText());
        assert.equal(closed.signal, null);
        assert.equal(closure.outcome, negative ? "unresolved" : "closed");
        if (negative) {
          assert.ok(closure.failure.failures.some(({ phase, code }) =>
            phase === "receipt_work_settlement" && code === (scenario === "partial-failure" ? "eio" : "receipt_work_timeout")));
          await access(ready.tempRoot);
          if (scenario === "partial-failure") {
            const partial = await readFile(recoveryPath);
            assert.equal(partial.length, 17);
            assert.throws(() => JSON.parse(partial.toString("utf8")));
          } else await assert.rejects(access(recoveryPath), (error) => error?.code === "ENOENT");
          subtest.diagnostic(`Retained failed sink evidence and fixture: ${fixtureRoot}`);
        } else {
          const recovery = JSON.parse(await readFile(recoveryPath, "utf8"));
          assert.equal(recovery.state, "controlled_fault_recovered");
          assert.equal(recovery.rearm, "rejected");
          assert.equal(recovery.secondConsume, false);
          assert.equal(recovery.private, true);
          assert.equal(recovery.phase, "authenticated_provider_request");
          assert.equal(recovery.controlNonce, providerControlNonce);
          assert.equal(recovery.platform, process.platform);
          assert.deepEqual(recovery.originalRequest, {
            method: "GET", path: "/v1/secret/data/browser/provider-control", authClass: "vault_token",
          });
          assert.equal(recovery.baselineStatus, 404);
          assert.equal(recovery.recoveryStatus, 404);
          assert.deepEqual(recovery.adminSource, { head: sourceHead, tree: sourceTree });
          assert.deepEqual(recovery.source, { head: sourceHead, tree: sourceTree });
          assert.equal(recovery.nonce, ready.liveReceipt.nonce);
          await assert.rejects(access(ready.tempRoot), (error) => error?.code === "ENOENT");
        }
        assert.deepEqual(await readFile(path.join(evidenceRoot, "live-provider-control-receipt.json")), armedBytes);
        assert.deepEqual(await readFile(path.join(evidenceRoot, "live-provider-control-consumed-receipt.json")), consumedBytes);
        assert.doesNotMatch(`${stderrText()}${stdoutText()}`, /unhandled|browser-vault-token-sentinel/i);
        passed = true;
      } finally {
        if (!closed && child.exitCode === null && child.signalCode === null) {
          child.send({ type: "service-lasso-real-admin-shutdown" });
          closed = await waitForExit(child, 30_000);
        }
        // Failed attempts, partial files and pending-timeout originals remain.
        if (passed && (scenario === "real-shutdown" || scenario === "slow-shutdown" || scenario === "concurrent-readers")) {
          await rm(fixtureRoot, { recursive: true, force: false });
        } else subtest.diagnostic(`Retained fixture: ${fixtureRoot}`);
      }
    });
  }
});

test("external observer retains hard-interrupt custody after the runner cannot handle the OS signal", async (t) => {
  await t.test("SIGKILL", async () => {
      const { child, fixtureRoot, evidenceRoot } = await startActualRealBrowserRunner({
        initialOnly: true,
      });
      const stderrText = captureBoundedText(child.stderr);
      let closed = null;
      try {
        await waitForRunnerMessage(child, "initial-ready");
        const prelaunchPath = path.join(evidenceRoot, "live-prelaunch-receipt.json");
        const prelaunch = JSON.parse(await readFile(prelaunchPath, "utf8"));
        const initialPath = path.join(evidenceRoot, "live-initial-receipt.json");
        const initial = JSON.parse(await readFile(initialPath, "utf8"));
        const identity = await observeExternalOwnedProcess(child.pid, process.pid);
        assert.deepEqual(prelaunch.source, { head: sourceHead, tree: sourceTree });
        assert.deepEqual(prelaunch.runtimeInputs, {
          workspaceRoot: path.join(fixtureRoot, "runtime-workspace"),
          instanceRegistryPath: path.join(fixtureRoot, "runtime-instance-registry.json"),
          hostPortRegistryPath: path.join(fixtureRoot, "runtime-host-port-registry.json"),
          servicesRoot: path.join(fixtureRoot, "runtime-services"),
          evidenceRoot: path.join(fixtureRoot, "runtime-evidence"),
          supportRoot: path.join(fixtureRoot, "runtime-support"),
        });
        assert.equal(prelaunch.runner.pid, identity.pid);
        assert.equal(prelaunch.runner.birth, identity.birth);
        assert.deepEqual(prelaunch.runner.nativeIdentity, identity.nativeIdentity);
        assert.deepEqual(
          prelaunch.assets,
          await Promise.all([
            "tests/fixtures/real-admin-browser-runner.mjs",
            "tests/fixtures/real-admin-browser-shutdown.mjs",
            "tests/fixtures/real-admin-browser-rollback.mjs",
          ].map(async (literalPath) => {
            const assetPath = path.resolve(literalPath);
            const metadata = await lstat(assetPath);
            return { literalPath, size: metadata.size, sha256: await sha256File(assetPath) };
          })),
        );
        assert.deepEqual(initial.source, { head: sourceHead, tree: sourceTree });
        assert.equal(initial.nonce, prelaunch.nonce);
        assert.deepEqual(initial.runtimeInputs, {
          workspaceRoot: path.join(fixtureRoot, "runtime-workspace"),
          instanceRegistryPath: path.join(fixtureRoot, "runtime-instance-registry.json"),
          hostPortRegistryPath: path.join(fixtureRoot, "runtime-host-port-registry.json"),
          servicesRoot: path.join(fixtureRoot, "runtime-services"),
          evidenceRoot: path.join(fixtureRoot, "runtime-evidence"),
          supportRoot: path.join(fixtureRoot, "runtime-support"),
        });
        assert.deepEqual(initial.runtimeAssets, prelaunch.runtimeAssets);
        assert.deepEqual(initial.runtimeInvocation, prelaunch.runtimeInvocation);
        assert.equal(initial.ownedProcesses.runner.pid, identity.pid);
        const signal = "SIGKILL";
        assert.equal(child.kill(signal), true);
        closed = await waitForExit(child, 30_000);
        await writeFile(
          path.join(evidenceRoot, "external-interrupt-receipt.json"),
          JSON.stringify({
            schema: "service-lasso.real-admin-browser-external-interrupt.v1",
            outcome: closed.signal === signal ? "interrupted" : "unresolved",
            expected: {
              source: { head: sourceHead, tree: sourceTree },
              initial: {
                nonce: initial.nonce,
                source: initial.source,
                runtimeInputs: initial.runtimeInputs,
                runtimeAssets: initial.runtimeAssets,
                runtimeInvocation: initial.runtimeInvocation,
                runner: initial.ownedProcesses.runner,
              },
              prelaunchSHA256: await sha256File(prelaunchPath),
              initialSHA256: await sha256File(initialPath),
            },
            observer: {
              ownedBirthObserved: typeof identity.birth === "string" && identity.birth.length > 0,
              processChainObserved: true,
              nativeIdentityObserved: identity.nativeIdentity.size > 0,
              process: identity,
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
        await assert.rejects(access(path.join(evidenceRoot, "live-closure-receipt.json")));
      } finally {
        // Prelaunch-only mode has no imported runtime or descendants. Cleanup
        // follows the observed direct-child close, never a PID sweep.
        if (closed) await rm(fixtureRoot, { recursive: true, force: false });
      }
    });
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
            SERVICE_LASSO_TEST_PROVIDER_CONTROL_NONCE: providerControlNonce,
            SERVICE_LASSO_TEST_ADMIN_SOURCE_HEAD: sourceHead,
            SERVICE_LASSO_TEST_ADMIN_SOURCE_TREE: sourceTree,
          },
          stdio: "ignore",
          windowsHide: true,
        });
        const closed = await waitForExit(child, 10_000);
        assert.notEqual(closed.code, 0);
        assert.equal(await readFile(foreignTarget, "utf8"), "foreign-receipt-state\n");
      } finally {
        await rm(fixtureRoot, { recursive: true, force: false });
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
      SERVICE_LASSO_TEST_PROVIDER_CONTROL_NONCE: providerControlNonce,
      SERVICE_LASSO_TEST_ADMIN_SOURCE_HEAD: sourceHead,
      SERVICE_LASSO_TEST_ADMIN_SOURCE_TREE: sourceTree,
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
      await readFile(path.join(evidenceRoot, "live-initial-receipt.json"), "utf8"),
    );
    const prelaunchReceipt = JSON.parse(
      await readFile(path.join(evidenceRoot, "live-prelaunch-receipt.json"), "utf8"),
    );
    assert.equal(prelaunchReceipt.source.head, sourceHead);
    assert.deepEqual(prelaunchReceipt.runtimeInputs, {
      workspaceRoot,
      instanceRegistryPath,
      hostPortRegistryPath,
      servicesRoot,
      evidenceRoot,
      supportRoot,
    });
    assert.equal(prelaunchReceipt.runner.pid, child.pid);
    assert.equal(prelaunchReceipt.runner.parentPid, process.pid);
    assert.equal(typeof prelaunchReceipt.runner.birth, "string");
    assert.match(prelaunchReceipt.runner.nativeIdentity.sha256, /^sha256:[a-f0-9]{64}$/);
    assert.ok(prelaunchReceipt.runner.nativeIdentity.size > 0);
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
    assert.equal(Object.hasOwn(ready.liveReceipt, "prelaunchPath"), false);
    assert.equal(initialReceipt.source.head, sourceHead);
    assert.equal(initialReceipt.source.tree, sourceTree);
    assert.equal(initialReceipt.nonce, ready.liveReceipt.nonce);
    assert.deepEqual(initialReceipt.runtimeInputs, {
      workspaceRoot,
      instanceRegistryPath,
      hostPortRegistryPath,
      servicesRoot,
      evidenceRoot,
      supportRoot,
    });
    assert.equal(initialReceipt.ownedProcesses.runner.pid, child.pid);
    assert.equal(Object.hasOwn(ready.liveReceipt, "initialPath"), false);
    const readyReceipt = JSON.parse(
      await readFile(path.join(evidenceRoot, "live-ready-receipt.json"), "utf8"),
    );
    assert.equal(readyReceipt.ownedProcesses.admin.parentPid, child.pid);
    assert.deepEqual(readyReceipt.runtimeInputs, initialReceipt.runtimeInputs);
    assert.equal(readyReceipt.nonce, ready.liveReceipt.nonce);
    assert.deepEqual(readyReceipt.source, { head: sourceHead, tree: sourceTree });
    assert.equal(readyReceipt.ownerCorrelation.state, "observed");
    assert.equal(Object.hasOwn(ready.liveReceipt, "readyPath"), false);

    const brokerSources = JSON.parse(await readFile(path.join(supportRoot, "broker-sources.json"), "utf8"));
    const providerAddress = brokerSources.sources.find(({ sourceId }) => sourceId === "vault-browser").address;
    const providerCA = await readFile(path.join(supportRoot, "vault-test-ca.pem"));
    const requestProvider = (requestPath = "/v1/secret/data/browser/provider-control", token = "browser-vault-token-sentinel-2026-08-14") => new Promise((resolve, reject) => {
      const request = https.request(new URL(requestPath, providerAddress), {
        method: "GET", ca: providerCA, rejectUnauthorized: true,
        headers: { "x-vault-token": token },
      }, (response) => {
        response.resume();
        response.once("end", () => resolve({ status: response.statusCode }));
        response.once("error", reject);
      });
      request.setTimeout(5_000, () => request.destroy(new Error("Provider regression request timed out.")));
      request.once("error", reject);
      request.end();
    });
    const recoveryPath = path.join(evidenceRoot, "live-provider-control-recovery-receipt.json");
    const assertNoRecovery = () => assert.rejects(access(recoveryPath), { code: "ENOENT" });
    assert.equal((await requestProvider(undefined, "invalid-token")).status, 403);
    const beforeObservation = await fetch(
      `${ready.controlUrl}/fail-next-provider-request`,
      { method: "POST" },
    );
    assert.equal(beforeObservation.status, 409);
    const initialProviderRequest = await requestProvider();
    assert.equal(initialProviderRequest.status, 404);
    for (const nonce of [undefined, `${providerControlNonce.slice(0, -1)}0`]) {
      const forbidden = await fetch(`${ready.controlUrl}/fail-next-provider-request`, {
        method: "POST",
        headers: nonce === undefined ? {} : {
          "x-service-lasso-provider-control-nonce": nonce,
        },
      });
      assert.equal(forbidden.status, 403);
    }
    const armed = await fetch(`${ready.controlUrl}/fail-next-provider-request`, {
      method: "POST",
      headers: {
        "x-service-lasso-provider-control-nonce": providerControlNonce,
      },
    });
    assert.equal(armed.status, 200);
    const armedBytes = await readFile(path.join(evidenceRoot, "live-provider-control-receipt.json"));
    assert.equal((await requestProvider(undefined, "invalid-token")).status, 403);
    const controlledFailure = await requestProvider();
    assert.equal(controlledFailure.status, 503);
    const consumedBytes = await readFile(path.join(evidenceRoot, "live-provider-control-consumed-receipt.json"));
    await assertNoRecovery();
    assert.equal((await fetch(`${ready.controlUrl}/fail-next-provider-request`, { method: "POST", headers: { "x-service-lasso-provider-control-nonce": providerControlNonce } })).status, 409);
    assert.equal((await requestProvider("/v1/secret/data/browser/other")).status, 404);
    await assertNoRecovery();
    const subsequentNormalRequest = await requestProvider();
    // The fixture restores the provider's ordinary behavior. For this missing
    // key it is the same natural 404 seen before arming, rather than a second
    // synthetic provider fault.
    assert.equal(subsequentNormalRequest.status, initialProviderRequest.status);
    assert.notEqual(subsequentNormalRequest.status, 503);
    await assertNoRecovery();
    assert.equal((await fetch(`${ready.controlUrl}/fail-next-provider-request`, { method: "POST", headers: { "x-service-lasso-provider-control-nonce": "0".repeat(64) } })).status, 409);
    await assertNoRecovery();
    const stale = await fetch(`${ready.controlUrl}/fail-next-provider-request`, {
      method: "POST",
      headers: {
        "x-service-lasso-provider-control-nonce": providerControlNonce,
      },
    });
    assert.equal(stale.status, 409);
    const providerReceipt = await fetch(`${ready.controlUrl}/provider-fault-receipt?wait=recovery`, {
      headers: { "x-service-lasso-provider-control-nonce": providerControlNonce },
      signal: AbortSignal.timeout(5_000),
    });
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
    const privateConsumed = JSON.parse(await readFile(
      path.join(evidenceRoot, "live-provider-control-consumed-receipt.json"),
      "utf8",
    ));
    assert.equal(privateConsumed.nonce, ready.liveReceipt.nonce);
    assert.equal(privateConsumed.controlNonce, providerControlNonce);
    assert.deepEqual(privateConsumed.source, { head: sourceHead, tree: sourceTree });
    assert.deepEqual(privateConsumed.adminSource, { head: sourceHead, tree: sourceTree });
    assert.equal(privateConsumed.state, "controlled_fault_consumed");
    const recovery = JSON.parse(await readFile(
      path.join(evidenceRoot, "live-provider-control-recovery-receipt.json"),
      "utf8",
    ));
    assert.deepEqual(recovery.source, { head: sourceHead, tree: sourceTree });
    assert.deepEqual(recovery.adminSource, { head: sourceHead, tree: sourceTree });
    assert.equal(recovery.controlNonce, providerControlNonce);
    assert.equal(recovery.baselineStatus, initialProviderRequest.status);
    assert.equal(recovery.recoveryStatus, subsequentNormalRequest.status);
    assert.equal(recovery.rearm, "rejected");
    assert.equal(recovery.secondConsume, false);
    const commonKeys = ["schema", "private", "nonce", "platform", "source", "adminSource", "controlNonce", "phase", "causalSink", "state"];
    const privateArmed = JSON.parse(armedBytes.toString("utf8"));
    for (const receipt of [privateArmed, privateConsumed, recovery]) {
      assert.equal(receipt.schema, "service-lasso.real-admin-browser-provider-control.v1");
      assert.equal(receipt.private, true);
      assert.equal(receipt.platform, process.platform);
      assert.equal(receipt.phase, "authenticated_provider_request");
      assert.equal(receipt.nonce, ready.liveReceipt.nonce);
      assert.deepEqual(receipt.source, { head: sourceHead, tree: sourceTree });
      assert.deepEqual(receipt.adminSource, { head: sourceHead, tree: sourceTree });
      assert.equal(receipt.controlNonce, providerControlNonce);
      assert.equal(JSON.stringify(receipt).includes("browser-vault-token-sentinel"), false);
    }
    assert.deepEqual(Object.keys(privateArmed).sort(), [...commonKeys].sort());
    assert.deepEqual(Object.keys(privateConsumed).sort(), [...commonKeys].sort());
    assert.deepEqual(Object.keys(recovery).sort(), [...commonKeys, "originalRequest", "baselineStatus", "recoveryStatus", "rearm", "secondConsume"].sort());
    assert.equal(privateArmed.state, "observed_before_controlled_fault");
    assert.equal(privateArmed.causalSink, "authenticated_vault_provider_request");
    assert.equal(privateConsumed.causalSink, "next_authenticated_vault_provider_request");
    assert.equal(recovery.causalSink, privateConsumed.causalSink);
    assert.equal(recovery.state, "controlled_fault_recovered");
    assert.deepEqual(recovery.originalRequest, { method: "GET", path: "/v1/secret/data/browser/provider-control", authClass: "vault_token" });
    const recoveryBytes = await readFile(recoveryPath);
    assert.equal((await requestProvider()).status, 404);
    assert.equal((await fetch(`${ready.controlUrl}/provider-fault-receipt`)).status, 200);
    assert.deepEqual(await readFile(path.join(evidenceRoot, "live-provider-control-receipt.json")), armedBytes);
    assert.deepEqual(await readFile(path.join(evidenceRoot, "live-provider-control-consumed-receipt.json")), consumedBytes);
    assert.deepEqual(await readFile(recoveryPath), recoveryBytes);

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
      await readFile(path.join(evidenceRoot, "live-closure-receipt.json"), "utf8"),
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
    if (!closed && child.exitCode === null && child.signalCode === null) {
      child.send({ type: "service-lasso-real-admin-shutdown" });
      closed = await waitForExit(child, 30_000);
    }
    if (closed) await rm(fixtureRoot, { recursive: true, force: false });
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
    if (closed) await rm(evidenceRoot, { recursive: true, force: false });
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
