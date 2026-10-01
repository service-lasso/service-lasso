import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { copyFile, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
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

test("Windows directory sync keeps the attested helper handle through native launch and rejects a replacement", { skip: process.platform !== "win32" }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "service-lasso-directory-sync-held-"));
  const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const launcher = path.join(sourceRoot, "src", "runtime", "execution", "windows-managed-launcher-native.exe");
  const helper = path.join(root, "windows-directory-sync-helper.exe");
  const replacement = path.join(root, "replacement.exe");
  const targetDirectory = path.join(root, "flush-target");
  const readyPath = path.join(root, "ready");
  const continuePath = path.join(root, "continue");
  const token = randomBytes(32).toString("hex");
  try {
    await Promise.all([
      copyFile(path.join(sourceRoot, "src", "runtime", "operator", "windows-directory-sync-helper.exe"), helper),
      copyFile(path.join(sourceRoot, "src", "runtime", "operator", "windows-directory-sync-helper.exe"), replacement),
    ]);
    await mkdtemp(`${targetDirectory}-`).then(async (created) => { await rename(created, targetDirectory); });
    const bytes = await readFile(helper);
    const payload = Buffer.from(JSON.stringify({
      helper,
      directory: targetDirectory,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      byteLength: bytes.byteLength,
    }), "utf8").toString("base64");
    const child = spawn(launcher, [], {
      windowsHide: true,
      stdio: "ignore",
      env: {
        ...process.env,
        SERVICE_LASSO_DIRECTORY_SYNC_LAUNCH_PAYLOAD: payload,
        SERVICE_LASSO_ENABLE_TEST_HOOKS: "1",
        SERVICE_LASSO_DIRECTORY_SYNC_TEST_READY_PATH: readyPath,
        SERVICE_LASSO_DIRECTORY_SYNC_TEST_CONTINUE_PATH: continuePath,
        SERVICE_LASSO_DIRECTORY_SYNC_TEST_TOKEN: token,
      },
    });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        if ((await readFile(readyPath, "utf8")) === token) break;
      } catch { /* native launch has not finished attestation yet */ }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(await readFile(readyPath, "utf8"), token);
    await assert.rejects(rename(replacement, helper), (error) => error?.code === "EPERM" || error?.code === "EACCES");
    await writeFile(continuePath, token, "utf8");
    const outcome = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    assert.deepEqual(outcome, { code: 0, signal: null });
    const alteredPayload = Buffer.from(JSON.stringify({
      helper,
      directory: targetDirectory,
      sha256: "0".repeat(64),
      byteLength: bytes.byteLength,
    }), "utf8").toString("base64");
    await assert.rejects(
      execFileAsync(launcher, [], { windowsHide: true, env: { ...process.env, SERVICE_LASSO_DIRECTORY_SYNC_LAUNCH_PAYLOAD: alteredPayload } }),
      (error) => error?.code === 121,
    );
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 0 });
  }
});
