import assert from "node:assert/strict";
import test from "node:test";
import { packagedVerificationDiagnostic } from "../scripts/packaged-verification-diagnostics.mjs";

test("packaged failure phases distinguish acquisition, binding, execution and evidence", () => {
  const phases = ["consumer_setup", "package_staging", "dependency_acquisition", "installed_package_binding",
    "consumer_runner", "consumer_result", "evidence_validation", "evidence_write"];
  for (const phase of phases) {
    assert.deepEqual(packagedVerificationDiagnostic(phase), { stage: phase, errorCode: "verification_failed" });
  }
});

test("unknown or hostile diagnostic inputs cannot disclose payloads or execute getters", () => {
  const hostile = new Proxy({}, { get() { throw new Error("private-token"); } });
  for (const value of [undefined, null, "private-token", "constructor", hostile, new Error("private-token")]) {
    const result = packagedVerificationDiagnostic(value);
    assert.deepEqual(result, { stage: "packaged_verification", errorCode: "verification_failed" });
    assert.equal(JSON.stringify(result).includes("private-token"), false);
  }
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
      const fail = () => { throw Object.assign(new Error("private-token and private-path"), { stdout: "private-token", stderr: "private-token" }); };
      const context = {
        path, createHash, packagedVerificationDiagnostic,
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
        : { stage: failurePhase, errorCode: "verification_failed" });
    }
  }
});
