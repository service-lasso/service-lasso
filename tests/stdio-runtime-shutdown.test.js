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
