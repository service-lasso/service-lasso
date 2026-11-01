import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startApiServer } from "../dist/server/index.js";

const helper = (process.env.SERVICE_LASSO_PTY_HELPER ?? "").trim() || "bundled native/pty helper";

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-terminal-e2e-"));
const servicesRoot = path.join(tempRoot, "services");
const workspaceRoot = path.join(tempRoot, "workspace");
const evidenceRoot = path.join(tempRoot, "evidence");
await mkdir(path.join(servicesRoot, "echo-tui"), { recursive: true });
process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH = path.join(tempRoot, "instances.json");
process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH = path.join(tempRoot, "ports.json");
await mkdir(workspaceRoot, { recursive: true });
await mkdir(evidenceRoot, { recursive: true });

const manifest = {
  id: "echo-tui",
  name: "Echo TUI",
  description: "PTY attachment sample on the published Echo Service release.",
  version: "0.1.0",
  enabled: true,
  args: ["-tui"],
  terminal: { enabled: true, rows: 30, cols: 100 },
  env: {
    ECHO_PORT: "0",
    ECHO_HTTP_HEALTH_PORT: "0",
    ECHO_TCP_PORT: "0",
    ECHO_FASTCGI_PORT: "0",
    ECHO_LOG_PATH: "${SERVICE_ROOT}/runtime/echo.log",
    ECHO_STATE_PATH: "${SERVICE_ROOT}/runtime/state.json",
    ECHO_DB_PATH: "${SERVICE_ROOT}/runtime/echo.sqlite",
  },
  artifact: {
    kind: "archive",
    source: {
      type: "github-release",
      repo: "service-lasso/lasso-echoservice",
      tag: "2026.10.28-75d046b",
    },
    platforms: {
      win32: { assetName: "echo-service-win32.zip", archiveType: "zip", command: ".\\echo-service.exe", args: ["-tui"] },
      linux: { assetName: "echo-service-linux.tar.gz", archiveType: "tar.gz", command: "./echo-service", args: ["-tui"] },
      darwin: { assetName: "echo-service-darwin.tar.gz", archiveType: "tar.gz", command: "./echo-service", args: ["-tui"] },
    },
  },
  healthchecks: [{ id: "process-health", type: "process" }],
};
await writeFile(path.join(servicesRoot, "echo-tui", "service.json"), JSON.stringify(manifest, null, 2));

const checks = [];
const record = (name, pass, detail = {}) => {
  checks.push({ name, pass, ...detail });
  console.log(JSON.stringify({ name, pass, ...detail }));
};

function decode(chunk) {
  return Buffer.from(chunk, "base64").toString("utf8");
}
function strip(value) {
  return value
    .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/\r/g, "");
}

const runtime = await startApiServer({
  host: "127.0.0.1",
  port: 0,
  servicesRoot,
  workspaceRoot,
  noAutostart: true,
});
const base = runtime.url;
let latestSequence = 0;
let output = "";
let terminalToken = "";

async function request(pathname, options = {}) {
  const response = await fetch(new URL(pathname, base), {
    ...options,
    headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...(options.headers ?? {}) },
    signal: AbortSignal.timeout(120000),
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  return { status: response.status, ok: response.ok, payload };
}

async function readOutput(after = 0) {
  const response = await request(`/api/services/echo-tui/terminal/output?after=${String(after)}`, { headers: { "x-service-lasso-terminal-token": terminalToken } });
  if (!response.ok) {
    throw new Error(`terminal output HTTP ${response.status}: ${JSON.stringify(response.payload).slice(0, 300)}`);
  }
  const chunk = strip(decode(response.payload.data ?? ""));
  output += chunk;
  latestSequence = Math.max(latestSequence, response.payload.sequence ?? 0);
  return { chunk, payload: response.payload };
}

async function lifecycle(action) {
  const response = await request(`/api/services/echo-tui/${action}`, {
    method: "POST",
    body: JSON.stringify({ confirm: true }),
  });
  const outcome = response.payload?.result ?? response.payload ?? {};
  return { status: response.status, ok: response.ok, outcome };
}

async function waitFor(name, predicate, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      record(name, true);
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  record(name, false, { tail: output.slice(-800) });
  return false;
}

async function state() {
  const response = await request("/api/services");
  return response.payload?.services?.find((service) => service.id === "echo-tui");
}

let exitCode = 1;
try {
  const installed = await lifecycle("install");
  const configured = await lifecycle("config");
  const started = await lifecycle("start");
  record("install", installed.ok, { status: installed.status, message: installed.outcome?.message ?? installed.outcome?.skippedReason ?? null });
  record("config", configured.ok, { status: configured.status, message: configured.outcome?.message ?? configured.outcome?.skippedReason ?? null });
  record("start", started.ok && started.outcome?.state?.running === true, { status: started.status, message: started.outcome?.message ?? started.outcome?.skippedReason ?? null });

  const attachResponse = await request("/api/services/echo-tui/terminal/attach", { method: "POST" });
  terminalToken = attachResponse.payload?.sessionToken ?? "";
  record("terminal-attach", attachResponse.ok && Boolean(terminalToken), {
    readOnly: attachResponse.payload?.readOnly,
    rows: attachResponse.payload?.rows,
    cols: attachResponse.payload?.cols,
  });
  const startedState = await state();
  record("service-state", true, { running: startedState?.lifecycle?.running, pid: startedState?.lifecycle?.runtime?.pid, command: startedState?.lifecycle?.runtime?.command, helper: process.env.SERVICE_LASSO_PTY_HELPER });
  const inspection = await request("/api/services/echo-tui/terminal");
  const childPid = inspection.payload?.childPid ?? null;
  record("terminal-advertised", inspection.ok && inspection.payload?.available === true, {
    available: inspection.payload?.available,
    rows: inspection.payload?.rows,
    cols: inspection.payload?.cols,
    childPid,
    error: inspection.payload?.error,
  });

  await readOutput(0);
  await waitFor("dashboard-rendered", async () => {
    await readOutput(latestSequence);
    return output.includes("Echo Service TUI") && output.includes("recent events") && output.includes("q quit");
  });

  const attached = await request("/api/services/echo-tui/terminal");
  const attachedPid = attached.payload?.childPid ?? null;
  record("terminal-child-pid", attachedPid !== null, { childPid: attachedPid });

  const before = /actions: (\d+)/.exec(output)?.[1];
  await request("/api/services/echo-tui/terminal/input", {
    method: "POST",
    headers: { "x-service-lasso-terminal-token": terminalToken },
    body: JSON.stringify({ data: Buffer.from("e").toString("base64") }),
  });
  await waitFor("tui-echo-event", async () => {
    await readOutput(latestSequence);
    return output.includes("tui-echo") && output.includes(`actions: ${String(Number(before) + 1)}`);
  });

  const resized = await request("/api/services/echo-tui/terminal/resize", {
    method: "POST",
    headers: { "x-service-lasso-terminal-token": terminalToken },
    body: JSON.stringify({ rows: 40, cols: 120 }),
  });
  record("resize-accepted", resized.ok && resized.payload?.rows === 40 && resized.payload?.cols === 120);
  const afterResize = await request("/api/services/echo-tui/terminal");

  await request("/api/services/echo-tui/terminal/input", {
    method: "POST",
    headers: { "x-service-lasso-terminal-token": terminalToken },
    body: JSON.stringify({ data: Buffer.from("q").toString("base64") }),
  });
  await waitFor("clean-tui-shutdown", async () => {
    const current = await state();
    return current?.lifecycle?.running === false;
  }, 20000);

  const beforeStop = await state();
  if (beforeStop?.lifecycle?.running) {
    await lifecycle("stop");
  }
  const afterStop = await state();
  record("stop", afterStop?.lifecycle?.running !== true, { running: afterStop?.lifecycle?.running ?? false });
  const alive = (pid) => {
    if (!pid) return false;
    try { process.kill(pid, 0); return true; } catch { return false; }
  };
  record("owned-process-gone", !alive(attachedPid) && !alive(startedState?.lifecycle?.runtime?.pid), {
    childPid: attachedPid,
    helperPid: startedState?.lifecycle?.runtime?.pid,
  });
  record("resize-applied", afterResize.payload?.rows === 40 && afterResize.payload?.cols === 120, {
    rows: afterResize.payload?.rows,
    cols: afterResize.payload?.cols,
  });
  exitCode = checks.every((check) => check.pass) ? 0 : 1;
} catch (error) {
  record("terminal-e2e", false, { message: error instanceof Error ? error.message : String(error) });
} finally {
  await runtime.stop().catch(() => undefined);
  await writeFile(path.join(evidenceRoot, "summary.json"), JSON.stringify({ helper, checks, output }, null, 2));
  console.log(JSON.stringify({ checks, outputTail: output.slice(-800) }, null, 2));
  if (exitCode !== 0) console.log(`kept ${tempRoot}`); else await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
}
process.exitCode = exitCode;
