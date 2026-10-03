import { ownedCommandStderr, relayOwningResourceObservations } from "../scripts/mcp-product-acceptance-lib.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { ownedTempCleanupObservation, removeOwnedTempRoot } from "../scripts/owned-temp-cleanup.mjs";
import { dependencyAcquisitionReceipt, packagedVerificationDiagnostic } from "../scripts/packaged-verification-diagnostics.mjs";

// SPEC-006 AC-6G / #1594: test the production adapter, not a second retry loop.
async function observeFailure(error, expectedAttempts = 1) {
  let calls = 0;
  const delays = [];
  const failure = await removeOwnedTempRoot("private-owned-path", {
    remove: async (root, options) => {
      assert.equal(root, "private-owned-path");
      assert.deepEqual(options, { recursive: true, force: true });
      calls++;
      throw error;
    },
    wait: async (milliseconds) => { delays.push(milliseconds); },
  }).catch((value) => value);
  assert.equal(calls, expectedAttempts);
  assert.deepEqual(delays, Array.from({ length: expectedAttempts - 1 }, (_, index) => (index + 1) * 100));
  assert.equal(failure instanceof Error, true);
  assert.equal(failure.cause, undefined);
  assert.equal(failure.message.includes("private"), false);
  return ownedTempCleanupObservation(failure);
}

test("terminal retryable removals retain exactly eight calls and unchanged delays", async () => {
  for (const code of ["EBUSY", "ENOTEMPTY", "EPERM"]) {
    assert.deepEqual(await observeFailure({ code, path: "private-path", message: "private-token" }, 8), {
      operation: "remove_owned_temp_root", filesystemCode: code, attempts: 8,
    });
  }
});

test("nonretryable observed filesystem errors stop after the actual first invocation", async () => {
  for (const code of ["EACCES", "ENOENT", "ENOTDIR", "EISDIR", "EINVAL", "EIO", "EMFILE", "ENFILE", "EROFS", "ENAMETOOLONG", "ELOOP", "ENOSPC", "EDQUOT", "EBADF", "ENOSYS", "ENOMEM", "EXDEV"]) {
    assert.deepEqual(await observeFailure(Object.assign(new Error("private-token"), { code })), {
      operation: "remove_owned_temp_root", filesystemCode: code, attempts: 1,
    });
  }
});

test("unknown, inherited, accessor and hostile error inputs neither retry nor disclose values", async () => {
  let getterCalls = 0;
  const accessor = Object.defineProperty({}, "code", { get() { getterCalls++; throw new Error("private-token"); } });
  const inherited = Object.create({ code: "EBUSY" });
  const hostile = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error("private-token"); }, get() { getterCalls++; throw new Error("private-token"); } });
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  const coercion = { toString() { getterCalls++; throw new Error("private-token"); } };
  for (const error of [undefined, null, "private-token", 5, new Error("private-token"), { code: "private-token" }, { code: 1 }, { code: coercion }, inherited, accessor, hostile, revoked.proxy]) {
    const observation = await observeFailure(error);
    assert.deepEqual(observation, { operation: "remove_owned_temp_root", filesystemCode: "unknown", attempts: 1 });
    assert.equal(JSON.stringify(observation).includes("private"), false);
  }
  assert.equal(getterCalls, 0);
  assert.equal(ownedTempCleanupObservation({ operation: "remove_owned_temp_root", filesystemCode: "EBUSY", attempts: 8 }), undefined);
  assert.equal(ownedTempCleanupObservation(hostile), undefined);
  assert.equal(ownedTempCleanupObservation(revoked.proxy), undefined);
});

test("terminal code and invocation count describe the last actual removal, not earlier retries", async () => {
  let calls = 0;
  const delays = [];
  const failure = await removeOwnedTempRoot("private-owned-path", {
    remove: async () => { calls++; throw { code: calls < 3 ? "EBUSY" : "EACCES" }; },
    wait: async (milliseconds) => { delays.push(milliseconds); },
  }).catch((value) => value);
  assert.equal(calls, 3);
  assert.deepEqual(delays, [100, 200]);
  const observation = ownedTempCleanupObservation(failure);
  assert.deepEqual(observation, { operation: "remove_owned_temp_root", filesystemCode: "EACCES", attempts: 3 });
  observation.attempts = 8;
  assert.equal(ownedTempCleanupObservation(failure).attempts, 3);
});

test("default production rm actually removes an owned root and transient recovery leaves no failure", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "service-lasso-1594-"));
  try {
    await mkdir(path.join(root, "nested"));
    await writeFile(path.join(root, "nested", "fixture"), "owned fixture");
    let calls = 0;
    const delays = [];
    const result = await removeOwnedTempRoot(root, {
      remove: async (...args) => {
        calls++;
        if (calls <= 2) throw { code: "ENOTEMPTY", path: root };
        return rm(...args);
      },
      wait: async (milliseconds) => { delays.push(milliseconds); },
    });
    assert.equal(result, undefined);
    assert.equal(calls, 3);
    assert.deepEqual(delays, [100, 200]);
    await assert.rejects(stat(root), { code: "ENOENT" });
    await mkdir(root);
    await writeFile(path.join(root, "fixture"), "owned default-adapter fixture");
    await removeOwnedTempRoot(root); // actual default adapter, populated root
    await assert.rejects(stat(root), { code: "ENOENT" });
    await removeOwnedTempRoot(root); // actual default adapter, force/absent success
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function ownPackagedAcceptanceDiagnostic(error) {
  if (!error || typeof error !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(error, "packagedAcceptanceDiagnostic");
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

test("real verifier finalization preserves primary failure and makes success followed by cleanup failure exit one", async () => {
  const source = await readFile(new URL("../scripts/verify-mcp-packaged.mjs", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("let verificationFailure = null;"));
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  for (const primaryFails of [false, true]) {
    for (const cleanupFails of [false, true]) {
      let stderr = "";
      let stdout = "";
      let cleanupCalls = 0;
      let evidenceWrites = 0;
      const consumerRoot = "private-owned-root/consumer";
      const installedRoot = path.join(consumerRoot, "node_modules", "@service-lasso", "service-lasso");
      const evidencePath = "private-evidence-path";
      const acceptance = {
        sdk: { protocolVersion: "2025-11-25", version: "1.30.1" },
        inspector: { version: "2.4.0" }, packagedRuntime: {}, canonical: {}, coverage: {}, assertions: {},
      };
      const context = {
        path, createHash, ownedCommandStderr, relayOwningResourceObservations, packObservation: undefined, stageLockObservation: undefined, installObservation: undefined, consumerObservation: undefined, packagedVerificationDiagnostic, dependencyAcquisitionReceipt,
        runCommandFailureKind: () => "unknown", ownPackagedAcceptanceDiagnostic, ownedTempCleanupObservation,
        operatorToolFailureDiagnostic: () => undefined, releaseMetadataToken: undefined,
        tempRoot: "private-owned-root", consumerRoot, servicesRoot: "private-services",
        httpWorkspaceRoot: "private-http", stdioWorkspaceRoot: "private-stdio",
        repoRoot: "private-source", packageOutputRoot: "private-output", version: "0.1.0",
        candidateSha: "a".repeat(40), platform: "win32", pinnedSdkVersion: "1.30.1",
        npmEntrypoint: "private-npm", evidencePath, MCP_PRODUCT_EVIDENCE_CONTRACT: "test-contract",
        mkdir: async () => {}, writeCanonicalService: async () => "fixture",
        stagePublishedPackage: async () => { if (primaryFails) throw new Error("private-token"); return { packageArchivePath: "private-archive" }; },
        readFile: async (file) => file === path.join(installedRoot, "package.json")
          ? JSON.stringify({ name: "@service-lasso/service-lasso", version: "0.1.0" }) : Buffer.from("same reviewed bytes"),
        writeFile: async (file) => { if (file === evidencePath) evidenceWrites++; },
        copyFile: async () => {}, requirePathAbsent: async () => {}, isolatedConsumerEnvironment: (value) => value,
        runCommand: async () => ({ closeObserved: true, stdout: JSON.stringify(acceptance) }),
        validateMcpProductEvidence: () => {}, parsePackagedAcceptanceFailure: () => undefined,
        removeOwnedTempRoot: (root) => removeOwnedTempRoot(root, {
          remove: async () => { cleanupCalls++; if (cleanupFails) throw Object.assign(new Error("private-token"), { code: "EACCES", path: root, pid: 123, stdout: "private-token" }); },
          wait: async () => { assert.fail("nonretryable removal must not wait"); },
        }),
        process: {
          execPath: "private-node", platform: "win32", env: { SystemRoot: "C:/Windows" }, arch: "x64", version: "test",
          stderr: { write: (value) => { stderr += value; } }, stdout: { write: (value) => { stdout += value; } }, exitCode: 0,
        },
      };
      await new AsyncFunction(...Object.keys(context), body)(...Object.values(context));
      assert.equal(cleanupCalls, 1);
      assert.equal(evidenceWrites, primaryFails ? 0 : 1);
      assert.equal(stdout.length > 0, !primaryFails);
      if (!primaryFails) assert.equal(JSON.parse(stdout).result, "passed");
      assert.equal(context.process.exitCode, primaryFails || cleanupFails ? 1 : 0);
      assert.equal(stderr.includes("private"), false);
      assert.equal(stderr.includes("123"), false);
      if (cleanupFails) {
        assert.deepEqual(JSON.parse(stderr.slice("[mcp-package-verification-error] ".length)), {
          stage: "temp_cleanup", errorCode: "cleanup_failed",
          cleanup: { operation: "remove_owned_temp_root", filesystemCode: "EACCES", attempts: 1 },
          ...(primaryFails ? { verificationStage: "package_staging", verificationErrorCode: "verification_failed" } : {}),
        });
      } else if (primaryFails) {
        assert.deepEqual(JSON.parse(stderr.slice("[mcp-package-verification-error] ".length)), { stage: "package_staging", errorCode: "verification_failed" });
      } else assert.equal(stderr, "");
    }
  }
});
