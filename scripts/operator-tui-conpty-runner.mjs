import { spawn } from "node:child_process";
import { parseConptyProbeResult } from "./operator-tui-conpty-result.mjs";

const MAX_CAPTURED_BYTES = 16 * 1024;
const HELPER_TIMEOUT_MS = 35_000;
const SAFE_HELPER_FAILURE = "Windows ConPTY TUI probe did not complete its bounded assertions.";

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

export async function runConptyHelper({ command = "python", helperPath, executable, mode, apiUrl, apiToken, envSource, timeoutMs = HELPER_TIMEOUT_MS }) {
  const args = [helperPath, "--executable", executable, "--mode", mode];
  const env = conptyHelperEnvironment({ apiUrl, apiToken, source: envSource });
  let stdout = "";

  const completion = await new Promise((resolve) => {
    let settled = false;
    let child;
    let timedOut = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      try { child?.kill(); } catch {}
      setTimeout(() => finish({ kind: "failed" }), 1_000);
    }, timeoutMs);
    try {
      child = spawn(command, args, { cwd: undefined, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      child.stdout?.on("data", (chunk) => { stdout = appendBounded(stdout, chunk); });
      child.stderr?.resume();
      child.once("error", () => finish({ kind: "failed" }));
      child.once("close", (code, signal) => finish({ kind: !timedOut && code === 0 && !signal ? "success" : "nonzero" }));
    } catch {
      finish({ kind: "failed" });
    }
  });

  if (completion.kind === "success" || completion.kind === "nonzero") {
    try {
      return parseConptyProbeResult(stdout, mode);
    } catch {
      throw safeFailure();
    }
  }
  throw safeFailure();
}
