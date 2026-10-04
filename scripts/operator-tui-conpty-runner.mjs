import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseConptyProbeResult } from "./operator-tui-conpty-result.mjs";
import { createConptyNativeContainment } from "./conpty-native-containment.mjs";

const MAX_CAPTURED_BYTES = 16 * 1024;
const HELPER_TIMEOUT_MS = 35_000;
const SAFE_HELPER_FAILURE = "Windows ConPTY TUI probe did not complete its bounded assertions.";
const WINDOWS_MANAGED_LAUNCHER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "runtime",
  "execution",
  "windows-managed-launcher-native.exe",
);
// Keep this independent consumer bound to the current checked-in launcher.
// The supervisor validates the same exact bytes before it accepts a managed
// Windows child.
const WINDOWS_MANAGED_LAUNCHER_BYTES = 141_824;
const WINDOWS_MANAGED_LAUNCHER_SHA256 = "401699f683f56e081236e550ab59c06f888929ec5e30588f4e27cce972d4364c";

function appendBounded(current, chunk) {
  if (current.length >= MAX_CAPTURED_BYTES) return current;
  return current + chunk.toString("utf8", 0, MAX_CAPTURED_BYTES - current.length);
}

export function conptyHelperEnvironment({ apiUrl, apiToken, source = process.env } = {}) {
  const environment = {};
  for (const key of ["ComSpec", "PATHEXT", "PATH", "SystemDrive", "SystemRoot", "TEMP", "TMP", "WINDIR"]) {
    if (typeof source[key] === "string" && source[key]) environment[key] = source[key];
  }
  // Windows supplies profile variables to a child when they are absent. Empty
  // values explicitly prevent the helper from inheriting the host profile.
  environment.APPDATA = "";
  environment.LOCALAPPDATA = "";
  environment.USERPROFILE = "";
  environment.SERVICE_LASSO_API_URL = apiUrl;
  environment.SERVICE_LASSO_API_TOKEN = apiToken;
  return environment;
}

function safeFailure() {
  return new Error(SAFE_HELPER_FAILURE);
}

async function sha256File(filePath) {
  const bytes = await readFile(filePath);
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.length,
  };
}

function token() {
  return randomBytes(32).toString("hex");
}

function resolveWindowsExecutable(command, env) {
  if (path.isAbsolute(command)) return command;
  try {
    const resolved = execFileSync("where.exe", [command], {
      env,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      encoding: "utf8",
    }).split(/\r?\n/u).find((candidate) => path.isAbsolute(candidate));
    if (resolved) return resolved;
  } catch {}
  throw safeFailure();
}

async function assertWindowsManagedLauncher(launcherPath) {
  const bytes = await readFile(launcherPath);
  if (bytes.length !== WINDOWS_MANAGED_LAUNCHER_BYTES || createHash("sha256").update(bytes).digest("hex") !== WINDOWS_MANAGED_LAUNCHER_SHA256) {
    throw safeFailure();
  }
}

async function createContainedWindowsLaunch({ command, args, helperPath, env, launcherPath }) {
  await assertWindowsManagedLauncher(launcherPath);
  const resolvedCommand = resolveWindowsExecutable(command, env);
  const [commandBinding, helperBinding] = await Promise.all([sha256File(resolvedCommand), sha256File(helperPath)]);
  const root = await mkdtemp(path.join(os.tmpdir(), "service-lasso-conpty-owned-tree-"));
  const gatePath = path.join(root, "release.gate");
  const filesBoundPath = path.join(root, "files-bound.gate");
  const continuePath = path.join(root, "continue.gate");
  const ackPath = path.join(root, "launched.pid");
  const releaseToken = token();
  const filesBoundToken = token();
  const continueToken = token();
  const ackToken = token();
  const payload = {
    executable: resolvedCommand,
    args: [helperPath, ...args.slice(1)],
    workingDirectory: path.dirname(helperPath),
    ackPath,
    filesBoundPath,
    continuePath,
    releaseToken,
    filesBoundToken,
    continueToken,
    ackToken,
    approvedFiles: [
      { file: resolvedCommand, ...commandBinding },
      { file: helperPath, ...helperBinding },
    ],
    executableBindingIndex: 0,
    requireExecutableBinding: true,
    argumentBindings: [{ index: 0, prefix: "", bindingIndex: 1 }],
    targetEnvironmentOverrides: [],
    postResumeDelayMilliseconds: 0,
  };
  try {
    await Promise.all([
      writeFile(gatePath, releaseToken, "utf8"),
      writeFile(continuePath, continueToken, "utf8"),
    ]);
    return {
      command: launcherPath,
      args: [],
      env: {
        ...env,
        SERVICE_LASSO_MANAGED_LAUNCH_PAYLOAD: Buffer.from(JSON.stringify(payload), "utf8").toString("base64"),
        SERVICE_LASSO_MANAGED_LAUNCH_GATE: gatePath,
      },
      cleanup: () => rm(root, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

export async function runConptyHelper({ command = "python", helperPath, executable, mode, apiUrl, apiToken, envSource, timeoutMs = HELPER_TIMEOUT_MS, platform = process.platform, managedLauncherPath = WINDOWS_MANAGED_LAUNCHER, spawnProcess = spawn, containmentFactory = createConptyNativeContainment }) {
  const args = [helperPath, "--executable", executable, "--mode", mode];
  const env = conptyHelperEnvironment({ apiUrl, apiToken, source: envSource });
  let stdout = "";
  const launch = platform === "win32"
    ? await createContainedWindowsLaunch({ command, args, helperPath, env, launcherPath: managedLauncherPath })
    : { command, args, env, cleanup: async () => {} };
  let containment, returnedChild = false, cleanupAuthorized = false;

  try {
    if (platform === "win32") {
      containment = await containmentFactory();
      launch.env = { ...launch.env, ...containment.environment };
    }
    const completion = await new Promise((resolve) => {
    let settled = false;
    let child;
    let timedOut = false;
    let childFailed = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      try { if (containment) containment.requestCancellation(); else child?.kill(); } catch { childFailed = true; }
    }, timeoutMs);
    try {
      child = spawnProcess(launch.command, launch.args, { cwd: undefined, env: launch.env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      returnedChild = true;
      containment?.bindChild(child);
      child.stdout?.on("data", (chunk) => { stdout = appendBounded(stdout, chunk); });
      child.stderr?.resume();
      // A failed kill can emit error while the owned child remains alive.
      // Retain failure but keep inputs and settlement bound to actual close.
      child.on("error", () => { childFailed = true; });
      child.once("close", (code, signal) => finish({ kind: !childFailed && !timedOut && code === 0 && !signal ? "success" : "nonzero" }));
    } catch {
      finish({ kind: "failed" });
    }
    });
    // Missing/invalid private native receipt leaves this attempt unresolved
    // with its inputs retained. Top bootstrap close is not Job closure.
    const nativeTerminal = containment && returnedChild ? await containment.finalizeAfterChildClose() : null;
    cleanupAuthorized = true;

    // Closed success output cannot override a failed or timed-out owned close.
    if (completion.kind === "success" && (!nativeTerminal || nativeTerminal.code === 0)) {
      try {
        return parseConptyProbeResult(stdout, mode);
      } catch {
        throw safeFailure();
      }
    }
    throw safeFailure();
  } finally {
    if (!returnedChild || cleanupAuthorized) {
      await containment?.cleanup();
      await launch.cleanup();
    }
  }
}
