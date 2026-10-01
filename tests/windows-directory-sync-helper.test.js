import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
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
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", "scripts/verify-windows-process-inspector.ps1", "-DirectorySyncHelper", "-Behavioral"],
    { windowsHide: true, timeout: 60_000 },
  );
  const receipt = JSON.parse(result.stdout.trim().split(/\r?\n/u).at(-1));
  assert.equal(receipt.result, "passed");
  assert.equal(receipt.negativeCaseCount, 18);
  assert.equal(receipt.behavioralCaseCount, 3);
});

test("Windows unmanaged bootstrap attests the held managed launcher before any CLR startup", { skip: process.platform !== "win32" }, async () => {
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  assert.ok(systemRoot);
  const result = await execFileAsync(
    `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", "scripts/verify-windows-managed-launcher-bootstrap.ps1"],
    { windowsHide: true, timeout: 60_000 },
  );
  const receipt = JSON.parse(result.stdout.trim().split(/\r?\n/u).at(-1));
  assert.equal(receipt.result, "passed");
  assert.equal(receipt.clrMetadata, "absent");
});

test("Windows native bootstrap retains managed-package ancestry through the actual managed child exit", { skip: process.platform !== "win32" }, async () => {
  const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const localAppData = process.env.LOCALAPPDATA;
  assert.ok(localAppData, "LOCALAPPDATA is required for the isolated managed-package fixture");
  const root = await mkdtemp(path.join(localAppData, "Temp", "service-lasso-directory-sync-held-"));
  const sourceExecution = path.join(sourceRoot, "src", "runtime", "execution");
  const sourceOperator = path.join(sourceRoot, "src", "runtime", "operator");
  const packageRoot = path.join(root, "managed-package");
  const execution = path.join(packageRoot, "execution");
  const operator = path.join(packageRoot, "operator");
  const launcher = path.join(execution, "windows-managed-launcher-native.exe");
  const helper = path.join(operator, "windows-directory-sync-helper.exe");
  const managedLauncher = path.join(execution, "windows-managed-launcher-managed.exe");
  const replacement = path.join(operator, "windows-directory-sync-helper-replacement-test.exe");
  const replacementExecution = path.join(packageRoot, "execution-replacement-test");
  const targetDirectory = path.join(root, "flush-target");
  const readyPath = path.join(root, "ready");
  const continuePath = path.join(root, "continue");
  const token = randomBytes(32).toString("hex");
  try {
    await mkdir(execution, { recursive: true });
    await mkdir(operator, { recursive: true });
    await Promise.all([
      writeFile(launcher, await readFile(path.join(sourceExecution, "windows-managed-launcher-native.exe")), { flag: "wx" }),
      writeFile(managedLauncher, await readFile(path.join(sourceExecution, "windows-managed-launcher-managed.exe")), { flag: "wx" }),
      writeFile(helper, await readFile(path.join(sourceOperator, "windows-directory-sync-helper.exe")), { flag: "wx" }),
      writeFile(replacement, await readFile(path.join(sourceOperator, "windows-directory-sync-helper.exe")), { flag: "wx" }),
    ]);
    await mkdtemp(`${targetDirectory}-`).then(async (created) => { await rename(created, targetDirectory); });
    const payload = Buffer.from(JSON.stringify({
      directory: targetDirectory,
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
      if (child.exitCode !== null) assert.fail(`managed bootstrap exited before the child gate: ${child.exitCode}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(await readFile(readyPath, "utf8"), token);
    await assert.rejects(rename(execution, replacementExecution), (error) => error?.code === "EPERM" || error?.code === "EACCES" || error?.code === "EBUSY");
    await assert.rejects(rename(replacement, helper), (error) => error?.code === "EPERM" || error?.code === "EACCES" || error?.code === "EBUSY");
    await writeFile(continuePath, token, "utf8");
    const outcome = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    assert.deepEqual(outcome, { code: 0, signal: null });
    for (const hostilePayload of [
      `{"directory":"${targetDirectory.replace(/\\/gu, "\\\\")}","directory":"${targetDirectory.replace(/\\/gu, "\\\\")}"}`,
      `{"\\u0064irectory":"${targetDirectory.replace(/\\/gu, "\\\\")}"}`,
      `{"directory":"${targetDirectory.replace(/\\/gu, "\\\\")}","sha256":"${"0".repeat(64)}"}`,
      `{ "directory":"${targetDirectory.replace(/\\/gu, "\\\\")}" }`,
    ]) {
      await assert.rejects(
        execFileAsync(launcher, [], { windowsHide: true, env: { ...process.env, SERVICE_LASSO_DIRECTORY_SYNC_LAUNCH_PAYLOAD: Buffer.from(hostilePayload, "utf8").toString("base64") } }),
        (error) => error?.code === 121 || error?.code === 120,
      );
    }
    await execFileAsync(launcher, [], {
      windowsHide: true,
      env: {
        ...process.env,
        COMPLUS_Version: "v2.0.50727",
        COR_ENABLE_PROFILING: "1",
        CORECLR_ENABLE_PROFILING: "1",
        APPDOMAIN_MANAGER_ASM: "hostile",
        SERVICE_LASSO_DIRECTORY_SYNC_LAUNCH_PAYLOAD: payload,
      },
    });
  } finally {
    await rm(replacement, { force: true, maxRetries: 0 });
    await rm(root, { recursive: true, force: true, maxRetries: 0 });
  }
});
