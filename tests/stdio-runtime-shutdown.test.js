import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const entrypoint = fileURLToPath(new URL("../dist/index.js", import.meta.url));

for (const early of [false, true]) {
  test(`#1712 actual stdio executable closes its runtime after ${early ? "startup-time" : "ready"} EOF`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "service-lasso-stdio-eof-"));
    const servicesRoot = path.join(root, "services");
    await mkdir(servicesRoot);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("SERVICE_LASSO_")));
    const child = spawn(process.execPath, [entrypoint, "--noautostart"], {
      cwd: root,
      env: {
        ...env,
        SERVICE_LASSO_PORT: "0",
        SERVICE_LASSO_SERVICES_ROOT: servicesRoot,
        SERVICE_LASSO_WORKSPACE_ROOT: path.join(root, "workspace"),
        SERVICE_LASSO_INSTANCE_REGISTRY_PATH: path.join(root, "instances.json"),
        SERVICE_LASSO_HOST_PORT_REGISTRY_PATH: path.join(root, "ports.json"),
        SERVICE_LASSO_MCP_STDIO: "1",
        SERVICE_LASSO_MCP_STDIO_CREDENTIAL: "stdio-eof-fixture-only",
        SERVICE_LASSO_MCP_STDIO_ACTOR: "stdio-eof-test",
        SERVICE_LASSO_MCP_STDIO_CLIENT_ID: "stdio-eof-client",
        SERVICE_LASSO_MCP_MODE: "read-only",
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stderr = "", closed = false;
    child.stdout.resume();
    const ready = new Promise((resolve) => child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.includes("- api:")) resolve();
    }));
    const close = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => { closed = true; resolve({ code, signal }); });
    });
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Owned stdio runtime did not close after EOF.")), 20_000);
    });
    try {
      if (!early) await Promise.race([ready, close.then(() => assert.fail("Runtime exited before readiness.")), deadline]);
      child.stdin.end();
      assert.deepEqual(await Promise.race([close, deadline]), { code: 0, signal: null });
      const endpoint = stderr.match(/- api: (http:\/\/[^\s]+)/u)?.[1];
      assert.ok(endpoint, "actual runtime must complete startup even when EOF arrives early");
      await assert.rejects(fetch(`${endpoint}/api/runtime/status`, { signal: AbortSignal.timeout(2_000) }));
      assert.doesNotMatch(stderr, /failed to (?:start|stop)/u);
    } finally {
      clearTimeout(timer);
      if (closed) await rm(root, { recursive: true, force: true });
      else {
        // Preserve an unresolved owned runtime/root rather than disguising an
        // EOF failure with synthetic termination or deletion.
        child.stdin.end();
        child.unref();
        child.stdout.unref?.();
        child.stderr.unref?.();
      }
    }
  });
}

test("stdio EOF takes autostarted Windows launcher trees down before the client force-kills the runtime", { skip: process.platform !== "win32" }, async () => {
  const { execFileSync } = await import("node:child_process");
  const { writeFile } = await import("node:fs/promises");
  const root = await mkdtemp(path.join(os.tmpdir(), "service-lasso-stdio-eof-autostart-"));
  const servicesRoot = path.join(root, "services");
  const marker = `sl-stdio-eof-${process.pid}-${Date.now()}`;
  const serviceRoot = path.join(servicesRoot, "eof-sleeper");
  await mkdir(serviceRoot, { recursive: true });
  await writeFile(path.join(serviceRoot, "service.json"), JSON.stringify({
    id: "eof-sleeper",
    name: "EOF sleeper",
    description: "Autostarted fixture that must not outlive the stdio runtime.",
    executable: path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", `$m='${marker}'; [Threading.Thread]::Sleep([Threading.Timeout]::Infinite)`],
    healthcheck: { type: "process" },
  }));
  const survivors = () => execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    `@(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*${marker}*' -and $_.Name -eq 'powershell.exe' }).Count`,
  ], { encoding: "utf8", windowsHide: true }).trim();
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("SERVICE_LASSO_")));
  const child = spawn(process.execPath, [entrypoint], {
    cwd: root,
    env: {
      ...env,
      SERVICE_LASSO_PORT: "0",
      SERVICE_LASSO_SERVICES_ROOT: servicesRoot,
      SERVICE_LASSO_WORKSPACE_ROOT: path.join(root, "workspace"),
      SERVICE_LASSO_INSTANCE_REGISTRY_PATH: path.join(root, "instances.json"),
      SERVICE_LASSO_HOST_PORT_REGISTRY_PATH: path.join(root, "ports.json"),
      SERVICE_LASSO_MCP_STDIO: "1",
      SERVICE_LASSO_MCP_STDIO_CREDENTIAL: "stdio-eof-fixture-only",
      SERVICE_LASSO_MCP_STDIO_ACTOR: "stdio-eof-test",
      SERVICE_LASSO_MCP_STDIO_CLIENT_ID: "stdio-eof-client",
      SERVICE_LASSO_MCP_MODE: "read-only",
    },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  child.stdout.resume();
  const ready = new Promise((resolve) => child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
    if (stderr.includes("- api:")) resolve();
  }));
  const close = new Promise((resolve) => child.once("exit", resolve));
  try {
    await Promise.race([ready, new Promise((_, reject) => setTimeout(() => reject(new Error("runtime not ready")), 60_000))]);
    let started = "0";
    for (let attempt = 0; attempt < 60 && started === "0"; attempt += 1) {
      started = survivors();
      if (started === "0") await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.equal(started, "1", "fixture service must be autostarted");
    // Mirror the MCP SDK stdio client: close stdin, then force-kill after ~2 s.
    child.stdin.end();
    await Promise.race([close, new Promise((resolve) => setTimeout(resolve, 2_000))]);
    child.kill("SIGKILL");
    await close;
    let remaining = survivors();
    for (let attempt = 0; attempt < 10 && remaining !== "0"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      remaining = survivors();
    }
    assert.equal(remaining, "0", "no autostarted service may outlive the stdio runtime");
  } finally {
    child.kill("SIGKILL");
    // Release inherited pipes and remove this test's own fixture processes so a
    // regression fails the assertion instead of hanging the test runner.
    for (const stream of [child.stdin, child.stdout, child.stderr]) stream?.destroy();
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*${marker}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
    ], { windowsHide: true });
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => undefined);
  }
});
