import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import net from "node:net";
import { DEFAULT_BASELINE_SERVICE_IDS } from "../dist/runtime/cli/bootstrap.js";
import { assertDemoPortsAvailable, demoProviderServiceIds, demoRequiredServiceIds } from "../scripts/demo-instance-lib.mjs";

async function listenOnLoopback() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  assert.equal(typeof address, "object");
  assert.notEqual(address, null);

  return {
    server,
    port: address.port,
    close: async () => {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

test("demo recycle preflight reports live non-managed listeners", async () => {
  const listener = await listenOnLoopback();

  try {
    await assert.rejects(
      () => assertDemoPortsAvailable({
        port: listener.port,
        workspaceRoot: path.join(process.cwd(), "workspace", "demo-instance-test"),
        fixedPortChecks: [],
      }),
      /Demo recycle blocked by live non-managed listener\(s\).*runtime-api http 127\.0\.0\.1:/,
    );
  } finally {
    await listener.close();
  }
});

test("demo recycle uses the canonical baseline service set", () => {
  assert.deepEqual(demoRequiredServiceIds, [...DEFAULT_BASELINE_SERVICE_IDS]);
  assert.equal(demoProviderServiceIds.has("@archive"), true);
  assert.equal(demoProviderServiceIds.has("@node"), true);
  assert.equal(demoProviderServiceIds.has("@serviceadmin"), false);
});

test("demo smoke script validates the bounded demo instance end to end", async () => {
  const demoScript = path.resolve("scripts", "demo-smoke.mjs");

  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [demoScript], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        SERVICE_LASSO_PORT: "0",
      },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });

  assert.equal(result.code, 0, `Expected demo smoke to pass.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  assert.match(result.stdout, /\[service-lasso demo] smoke passed/);
  assert.match(result.stdout, /echo-service, @node, node-sample-service/);
});
