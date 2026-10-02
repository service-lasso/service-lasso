import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

test("Windows inspector retries only transient command-line query failures and remains fail closed", { skip: process.platform !== "win32" }, async () => {
  const owned = await mkdtemp(path.join(tmpdir(), "lasso-command-line-retry-"));
  try {
    const compiler = path.join(process.env.WINDIR, "Microsoft.NET/Framework64/v4.0.30319/csc.exe");
    const binary = path.join(owned, "CommandLineRetry.exe");
    execFileSync(compiler, [
      "/nologo",
      "/target:exe",
      "/define:WINDOWS_PROCESS_INSPECTOR_TEST",
      `/out:${binary}`,
      path.resolve("src/runtime/process/windows-process-inspector.cs"),
      path.resolve("tests/windows-process-inspector-command-line-retry-harness.cs"),
    ], { timeout: 15000, windowsHide: true });
    const result = execFileSync(binary, ["--test-command-line-retry"], { timeout: 15000, windowsHide: true, encoding: "utf8" });
    assert.equal(result.trim(), "command_line_retry_cases_passed");
  } finally {
    const resolvedOwned = path.resolve(owned);
    assert.ok(resolvedOwned.startsWith(path.resolve(tmpdir()) + path.sep + "lasso-command-line-retry-"));
    await rm(resolvedOwned, { recursive: true, force: true });
  }
});
