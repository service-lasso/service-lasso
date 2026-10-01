import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("Windows directory-sync helper has reproducible provenance and bounded native failure behavior", { skip: process.platform !== "win32" }, async () => {
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  assert.ok(systemRoot, "Windows system root is required");
  const result = await execFileAsync(
    `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "scripts/verify-windows-process-inspector.ps1", "-DirectorySyncHelper", "-Behavioral"],
    { windowsHide: true, timeout: 60_000 },
  );
  const receipt = JSON.parse(result.stdout.trim());
  assert.equal(receipt.result, "passed");
  assert.equal(receipt.negativeCaseCount, 18);
  assert.equal(receipt.behavioralCaseCount, 3);
});
