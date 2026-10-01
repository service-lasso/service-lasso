import assert from "node:assert/strict";
import test from "node:test";
import { dependencyAcquisitionReceipt, dependencyAcquisitionSubcode, packagedVerificationDiagnostic } from "../scripts/packaged-verification-diagnostics.mjs";
import { runCommand, runCommandFailureKind } from "../scripts/mcp-product-acceptance-lib.mjs";

function ownPackagedAcceptanceDiagnostic(error) {
  if (!error || typeof error !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(error, "packagedAcceptanceDiagnostic");
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

test("packaged failure phases distinguish acquisition, binding, execution and evidence", () => {
  const phases = ["consumer_setup", "package_staging", "dependency_acquisition", "installed_package_binding",
    "consumer_runner", "consumer_result", "evidence_validation", "evidence_write"];
  for (const phase of phases) {
    assert.deepEqual(packagedVerificationDiagnostic(phase), { stage: phase, errorCode: "verification_failed" });
  }
});

test("safe release-metadata diagnostics carry only a fixed boundary and status", () => {
  assert.deepEqual(packagedVerificationDiagnostic("package_staging", { boundary: "github_release_metadata", httpStatus: 403 }), { stage: "package_staging", errorCode: "verification_failed", external: { boundary: "github_release_metadata", httpStatus: 403 } });
  assert.deepEqual(packagedVerificationDiagnostic("package_staging", { boundary: "github_release_metadata", httpStatus: 200 }), { stage: "package_staging", errorCode: "verification_failed" });
});

test("dependency acquisition projects only bounded npm-reported observations and subprocess subcodes", () => {
  const secret = "https://registry.example/private-token?credential=secret";
  const cases = [
    [{ code: "ENOENT", stderr: secret }, "spawn_failed", "subprocess_spawn_enoent"],
    [{ code: "EACCES", stderr: secret }, "spawn_failed", "subprocess_spawn_eacces"],
    [{ code: 1, stderr: secret }, "exit_nonzero", "subprocess_exit_nonzero"],
    [{ code: 1, stdout: JSON.stringify({ error: { code: "ENOTFOUND", detail: secret } }), stderr: secret }, "exit_nonzero", "npm_reported_network_enotfound"],
    [{ code: 1, stdout: JSON.stringify({ error: { code: "EINTEGRITY", detail: secret } }), stderr: secret }, "exit_nonzero", "npm_reported_checksum_mismatch"],
    [{ code: 1, stdout: JSON.stringify({ error: { code: "E401", detail: secret } }), stderr: secret }, "exit_nonzero", "npm_reported_registry_identity_rejected"],
  ];
  for (const [error, outcome, subcode] of cases) {
    assert.equal(dependencyAcquisitionSubcode(error, outcome), subcode);
    const result = packagedVerificationDiagnostic("dependency_acquisition", undefined, dependencyAcquisitionReceipt(error, outcome));
    assert.deepEqual(result, { stage: "dependency_acquisition", errorCode: "verification_failed", outcome, subcode });
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
  for (const error of [
    { code: 1, stdout: JSON.stringify({ error: { code: "EUNKNOWN", detail: secret } }) },
    { code: 1, stdout: `${JSON.stringify({ error: { code: "ENOTFOUND" } })}\n${secret}` },
    { code: 1, stdout: "{malformed" },
    { code: 1, stdout: "x".repeat(8 * 1024 + 1) },
    { stderr: `npm ERR! code ENOTFOUND\nnpm ERR! ${secret}` },
    new Error(secret),
  ]) {
    const receipt = dependencyAcquisitionReceipt(error, typeof error.code === "number" ? "exit_nonzero" : "unknown");
    assert.equal(dependencyAcquisitionSubcode(error, receipt.outcome), typeof error.code === "number" ? "subprocess_exit_nonzero" : undefined);
    assert.deepEqual(packagedVerificationDiagnostic("dependency_acquisition", undefined, receipt), {
      stage: "dependency_acquisition", errorCode: "verification_failed", outcome: receipt.outcome, ...(typeof error.code === "number" ? { subcode: "subprocess_exit_nonzero" } : {}),
    });
  }
});

test("dependency acquisition ignores hostile getters and cannot project their private values", () => {
  const hostile = {};
  Object.defineProperty(hostile, "stderr", { get() { throw new Error("private-token"); } });
  assert.equal(dependencyAcquisitionSubcode(hostile, "unknown"), undefined);
  Object.defineProperty(hostile, "code", { value: 1 });
  Object.defineProperty(hostile, "stdout", { get() { throw new Error("private-token"); } });
  assert.equal(dependencyAcquisitionSubcode(hostile, "exit_nonzero"), "subprocess_exit_nonzero");
});

test("dependency acquisition records only supported own-data signal observations", () => {
  const secret = "private-token";
  for (const [signal, subcode] of [
    ["SIGTERM", "subprocess_observed_signal_sigterm"],
    ["SIGKILL", "subprocess_observed_signal_sigkill"],
  ]) {
    const observed = dependencyAcquisitionReceipt({ signal, stderr: secret }, "unknown");
    assert.deepEqual(observed, { outcome: "unknown", subcode });
    const diagnostic = packagedVerificationDiagnostic("dependency_acquisition", undefined, observed);
    assert.deepEqual(
      diagnostic,
      { stage: "dependency_acquisition", errorCode: "verification_failed", outcome: "unknown", subcode },
    );
    assert.equal(JSON.stringify(diagnostic).includes(secret), false);
  }
  assert.deepEqual(dependencyAcquisitionReceipt({ signal: "SIGHUP" }, "unknown"), { outcome: "unknown" });

  const inherited = Object.create({ signal: "SIGKILL" });
  assert.deepEqual(dependencyAcquisitionReceipt(inherited, "unknown"), { outcome: "unknown" });

  const accessor = {};
  Object.defineProperty(accessor, "signal", { get() { throw new Error("private-token"); } });
  assert.deepEqual(dependencyAcquisitionReceipt(accessor, "unknown"), { outcome: "unknown" });
});

test("a Windows-style numeric exit remains an exit receipt", () => {
  assert.deepEqual(
    dependencyAcquisitionReceipt({ code: 1, signal: null }, "exit_nonzero"),
    { outcome: "exit_nonzero", subcode: "subprocess_exit_nonzero" },
  );
});

test("real command failure projects only its bounded npm JSON error code", async () => {
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = (await import("node:path")).default;
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-1386-"));
  const report = path.join(tempRoot, "npm-report.mjs");
  const secret = "private-token-and-path";
  try {
    await writeFile(report, `process.stdout.write(JSON.stringify({ error: { code: "ENOTFOUND", detail: "${secret}" } })); process.stderr.write("${secret}"); process.exit(7);`, "utf8");
    const error = await runCommand(process.execPath, [report], { cwd: tempRoot }).catch(value => value);
    assert.equal(error.code, 7);
    assert.equal(runCommandFailureKind(error), "exit_nonzero");
    assert.equal(dependencyAcquisitionSubcode(error, runCommandFailureKind(error)), "npm_reported_network_enotfound");
    const diagnostic = packagedVerificationDiagnostic("dependency_acquisition", undefined, dependencyAcquisitionReceipt(error, runCommandFailureKind(error)));
    assert.deepEqual(diagnostic, { stage: "dependency_acquisition", errorCode: "verification_failed", outcome: "exit_nonzero", subcode: "npm_reported_network_enotfound" });
    assert.equal(JSON.stringify(diagnostic).includes(secret), false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runCommand records closed wrapper observations for deadline, capture, spawn and nonzero exit", async () => {
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = (await import("node:path")).default;
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-1530-"));
  const deadline = path.join(tempRoot, "deadline.mjs");
  const capture = path.join(tempRoot, "capture.mjs");
  const exit = path.join(tempRoot, "exit.mjs");
  try {
    await Promise.all([
      writeFile(deadline, "setTimeout(() => {}, 1000);", "utf8"),
      writeFile(capture, "process.stdout.write('x'.repeat(2 * 1024 * 1024 + 1));", "utf8"),
      writeFile(exit, "process.stdout.write(JSON.stringify({ error: { code: 'ENOTFOUND', detail: 'private-token' } })); process.exit(7);", "utf8"),
    ]);
    const cases = [
      [await runCommand(process.execPath, [deadline], { cwd: tempRoot, timeoutMs: 20 }).catch(value => value), "deadline_exceeded"],
      [await runCommand(process.execPath, [capture], { cwd: tempRoot }).catch(value => value), "output_capture_exceeded"],
      [await runCommand(path.join(tempRoot, "not-a-command"), [], { cwd: tempRoot }).catch(value => value), "spawn_failed"],
      [await runCommand(process.execPath, [exit], { cwd: tempRoot }).catch(value => value), "exit_nonzero"],
    ];
    for (const [error, outcome] of cases) {
      assert.equal(runCommandFailureKind(error), outcome);
      const diagnostic = packagedVerificationDiagnostic("dependency_acquisition", undefined, dependencyAcquisitionReceipt(error, runCommandFailureKind(error)));
      assert.equal(diagnostic.outcome, outcome);
      assert.equal(JSON.stringify(diagnostic).includes("private-token"), false);
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("the verifier catch branch keeps npm install safeguards and emits only the reported observation", async () => {
  const { mkdtemp, readFile, rm, writeFile } = await import("node:fs/promises");
  const { createHash } = await import("node:crypto");
  const os = await import("node:os");
  const path = (await import("node:path")).default;
  const source = await readFile(new URL("../scripts/verify-mcp-packaged.mjs", import.meta.url), "utf8");
  for (const flag of ["\"--json\"", "\"--ignore-scripts\"", "\"--no-audit\"", "\"--no-fund\"", "timeoutMs: 300_000"]) assert.equal(source.includes(flag), true);
  const body = source.slice(source.indexOf("let verificationFailure = null;"));
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-1386-verifier-"));
  const report = path.join(tempRoot, "npm-report.mjs");
  const secret = "secret-bearing-npm-report";
  let stderr = "";
  try {
    await writeFile(report, `process.stdout.write(JSON.stringify({ error: { code: "EINTEGRITY", detail: "${secret}" } })); process.stderr.write("${secret}"); process.exit(9);`, "utf8");
    const context = {
      path, createHash, packagedVerificationDiagnostic, dependencyAcquisitionReceipt, runCommandFailureKind, ownPackagedAcceptanceDiagnostic, operatorToolFailureDiagnostic: () => undefined, releaseMetadataToken: undefined,
      tempRoot, consumerRoot: tempRoot, servicesRoot: path.join(tempRoot, "services"),
      httpWorkspaceRoot: path.join(tempRoot, "http"), stdioWorkspaceRoot: path.join(tempRoot, "stdio"),
      repoRoot: "repo", packageOutputRoot: path.join(tempRoot, "package-output"), version: "0.1.0",
      npmEntrypoint: report, pinnedSdkVersion: "1.0.0",
      mkdir: async () => {}, writeCanonicalService: async () => "fixture",
      stagePublishedPackage: async () => ({ packageArchivePath: "archive" }),
      readFile: async () => Buffer.from("archive"), writeFile: async () => {}, runCommand,
      removeOwnedTempRoot: async () => {},
      process: { execPath: process.execPath, stderr: { write: value => { stderr += value; } }, exitCode: 0 },
    };
    await new AsyncFunction(...Object.keys(context), body)(...Object.values(context));
    assert.equal(context.process.exitCode, 1);
    const result = JSON.parse(stderr.slice("[mcp-package-verification-error] ".length));
    assert.deepEqual(result, { stage: "dependency_acquisition", errorCode: "verification_failed", outcome: "exit_nonzero", subcode: "npm_reported_checksum_mismatch" });
    assert.equal(stderr.includes(secret), false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("unknown or hostile diagnostic inputs cannot disclose payloads or execute getters", () => {
  const hostile = new Proxy({}, { get() { throw new Error("private-token"); } });
  for (const value of [undefined, null, "private-token", "constructor", hostile, new Error("private-token")]) {
    const result = packagedVerificationDiagnostic(value);
    assert.deepEqual(result, { stage: "packaged_verification", errorCode: "verification_failed" });
    const externalResult = packagedVerificationDiagnostic("package_staging", value);
    assert.deepEqual(externalResult, { stage: "package_staging", errorCode: "verification_failed" });
    assert.equal(JSON.stringify(result).includes("private-token"), false);
    assert.equal(JSON.stringify(externalResult).includes("private-token"), false);
  }
  const inherited = Object.create({ runCommandFailureKind: "exit_nonzero", code: 1, stdout: JSON.stringify({ error: { code: "ENOTFOUND" } }) });
  assert.equal(runCommandFailureKind(inherited), "unknown");
  assert.deepEqual(dependencyAcquisitionReceipt(inherited, runCommandFailureKind(inherited)), { outcome: "unknown" });
  const expanded = { outcome: "exit_nonzero", subcode: "npm_reported_network_enotfound", private: "private-token" };
  assert.deepEqual(packagedVerificationDiagnostic("dependency_acquisition", undefined, expanded), {
    stage: "dependency_acquisition", errorCode: "verification_failed", outcome: "exit_nonzero", subcode: "npm_reported_network_enotfound",
  });
  assert.equal(JSON.stringify(packagedVerificationDiagnostic("dependency_acquisition", undefined, expanded)).includes("private-token"), false);
});

// Exercise the verifier's real outer control flow with inert dependency boundaries.
// No package install, subprocess, network request or filesystem mutation is performed.
test("outer verifier reports the failed boundary, hides captured errors and always cleans up", async () => {
  const { readFile } = await import("node:fs/promises");
  const { createHash } = await import("node:crypto");
  const path = (await import("node:path")).default;
  const source = await readFile(new URL("../scripts/verify-mcp-packaged.mjs", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("let verificationFailure = null;"));
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  for (const failurePhase of ["consumer_setup", "package_staging", "dependency_acquisition", "installed_package_binding"]) {
    for (const cleanupFails of [false, true]) {
      let cleaned = 0;
      let stderr = "";
      const fail = () => {
        const stderr = "private-token";
        throw Object.assign(new Error("private-token and private-path"), {
          code: failurePhase === "dependency_acquisition" ? 1 : undefined,
          stdout: failurePhase === "dependency_acquisition" ? JSON.stringify({ error: { code: "ENOTFOUND", detail: "private-token" } }) : "private-token",
          stderr,
        });
      };
      const context = {
        path, createHash, packagedVerificationDiagnostic, dependencyAcquisitionReceipt, runCommandFailureKind, ownPackagedAcceptanceDiagnostic, operatorToolFailureDiagnostic: () => undefined, releaseMetadataToken: undefined,
        tempRoot: "owned-temp", consumerRoot: "owned-temp/consumer", servicesRoot: "owned-temp/services",
        httpWorkspaceRoot: "owned-temp/http", stdioWorkspaceRoot: "owned-temp/stdio",
        repoRoot: "repo", packageOutputRoot: "owned-temp/package-output", version: "0.1.0",
        npmEntrypoint: "npm-cli.js", pinnedSdkVersion: "1.0.0",
        mkdir: async () => { if (failurePhase === "consumer_setup") fail(); },
        writeCanonicalService: async () => "fixture",
        stagePublishedPackage: async () => { if (failurePhase === "package_staging") fail(); return { packageArchivePath: "archive" }; },
        readFile: async (file) => { if (file.endsWith("package.json")) fail(); return Buffer.from("archive"); },
        writeFile: async () => {},
        runCommand: async () => { if (failurePhase === "dependency_acquisition") fail(); },
        removeOwnedTempRoot: async () => { cleaned++; if (cleanupFails) fail(); },
        process: { execPath: "node", stderr: { write: value => { stderr += value; } }, exitCode: 0 },
      };
      await new AsyncFunction(...Object.keys(context), body)(...Object.values(context));
      assert.equal(cleaned, 1);
      assert.equal(context.process.exitCode, 1);
      assert.equal(stderr.includes("private-token"), false);
      const result = JSON.parse(stderr.slice("[mcp-package-verification-error] ".length));
      assert.deepEqual(result, cleanupFails
        ? { stage: "temp_cleanup", errorCode: "cleanup_failed", verificationStage: failurePhase, verificationErrorCode: "verification_failed" }
        : {
            stage: failurePhase,
            errorCode: "verification_failed",
            ...(failurePhase === "dependency_acquisition" ? { outcome: "unknown" } : {}),
          });
    }
  }
});
