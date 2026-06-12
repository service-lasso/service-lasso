import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import path from "node:path";
import os from "node:os";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { DEFAULT_BASELINE_SERVICE_IDS } from "../dist/runtime/cli/bootstrap.js";
import {
  assertDemoPortsAvailable,
  assertDemoRecycleOwnership,
  demoProviderServiceIds,
  demoRequiredServiceIds,
  stopDemoManagedProcesses,
} from "../scripts/demo-instance-lib.mjs";
import { acquireWatchdogLock, buildRecoveryCommand, releaseWatchdogLock, resolveWatchdogOptions } from "../scripts/demo-watchdog.mjs";
import {
  canonicalRuntimePort,
  canonicalServiceAdminPort,
  resolveCanonicalVerifierOptions,
  verifyCanonicalDemo,
} from "../scripts/demo-verify-canonical.mjs";

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

async function writeCanonicalManifest(servicesRoot, serviceId, { repo, tag, assetName, ports }) {
  const serviceRoot = path.join(servicesRoot, serviceId);
  await mkdir(serviceRoot, { recursive: true });
  await writeFile(
    path.join(serviceRoot, "service.json"),
    `${JSON.stringify({
      id: serviceId,
      artifact: {
        source: { repo, tag },
        platforms: {
          [process.platform]: { assetName },
        },
      },
      ports,
    }, null, 2)}\n`,
  );
}

function jsonResponse(status, body) {
  return {
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function textResponse(status, body) {
  return {
    status,
    json: async () => JSON.parse(body),
    text: async () => body,
  };
}

function canonicalFetch({ servicesRoot, workspaceRoot, serviceAdminTag = "2026.6.6-good", secretsBrokerTag = "2026.6.8-good" }) {
  const services = [
    {
      id: "@serviceadmin",
      serviceRoot: path.join(servicesRoot, "@serviceadmin"),
      lifecycle: {
        running: true,
        installArtifacts: {
          artifact: {
            repo: "service-lasso/lasso-serviceadmin",
            tag: serviceAdminTag,
            assetName: "@serviceadmin-win32.zip",
          },
        },
        runtime: { ports: { ui: 17700 } },
      },
      health: { healthy: true },
      catalogProvenance: {
        repo: "service-lasso/lasso-serviceadmin",
        releaseTag: serviceAdminTag,
      },
    },
    {
      id: "@secretsbroker",
      serviceRoot: path.join(servicesRoot, "@secretsbroker"),
      lifecycle: {
        running: true,
        installArtifacts: {
          artifact: {
            repo: "service-lasso/lasso-secretsbroker",
            tag: secretsBrokerTag,
            assetName: "secretsbroker-win32.zip",
          },
        },
        runtime: { ports: { service: 17890 } },
      },
      health: { healthy: true },
      catalogProvenance: {
        repo: "service-lasso/lasso-secretsbroker",
        releaseTag: secretsBrokerTag,
      },
    },
  ];

  return async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/") {
      return textResponse(200, "<html>Service Admin</html>");
    }
    if (parsed.pathname === "/api/health") {
      return jsonResponse(200, { status: "ok" });
    }
    if (parsed.pathname === "/api/runtime") {
      return jsonResponse(200, { runtime: { servicesRoot, workspaceRoot } });
    }
    if (parsed.pathname === "/api/services") {
      return jsonResponse(200, { services });
    }
    return jsonResponse(404, { error: "not_found" });
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

test("demo recycle preflight fails closed on orphan runtime ownership", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-orphan-runtime-"));
  const listener = await listenOnLoopback();

  try {
    await assert.rejects(
      () => assertDemoRecycleOwnership({
        port: listener.port,
        servicesRoot: path.join(tempDir, "services"),
        workspaceRoot: path.join(tempDir, "workspace", "demo-instance"),
      }),
      (error) => {
        assert.match(error.message, /stale\/orphan runtime ownership/);
        assert.match(error.message, /runtime-instance\.json is missing/);
        assert.match(error.message, /runtime-api http 127\.0\.0\.1:\d+ is already listening/);
        assert.match(error.message, /Process evidence:/);
        assert.match(error.message, /demo:watchdog recovery/);
        return true;
      },
    );
  } finally {
    await listener.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("demo recycle asks the previous managed runtime to stop services before replacing it", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-managed-runtime-"));
  const servicesRoot = path.join(tempDir, "services");
  const workspaceRoot = path.join(tempDir, "workspace", "demo-instance");
  const runtimeStateDir = path.join(workspaceRoot, ".service-lasso");
  let stopAllCalls = 0;
  const server = createServer((request, response) => {
    if (request.method === "POST" && request.url === "/api/runtime/actions/stopAll") {
      stopAllCalls += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ results: [], skipped: [] }));
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
  });

  try {
    await mkdir(runtimeStateDir, { recursive: true });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.notEqual(address, null);
    const apiUrl = `http://127.0.0.1:${address.port}`;

    await writeFile(
      path.join(runtimeStateDir, "runtime-instance.json"),
      `${JSON.stringify({
        servicesRoot,
        workspaceRoot,
        pid: process.pid,
        apiUrl,
      }, null, 2)}\n`,
    );

    const result = await stopDemoManagedProcesses({ servicesRoot, workspaceRoot });

    assert.equal(stopAllCalls, 1);
    assert.ok(
      result.stopped.some((entry) => entry.label === "runtime-api-stopAll" && entry.stopped === true),
      "Expected recycle to request stopAll from the previous runtime.",
    );
    assert.ok(
      result.stopped.some((entry) => entry.label === "runtime-api" && entry.pid === process.pid && entry.stopped === false),
      "Expected process termination guard to avoid stopping the test runner.",
    );
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }).catch(() => undefined);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("demo recycle uses the canonical baseline service set", () => {
  assert.deepEqual(demoRequiredServiceIds, [...DEFAULT_BASELINE_SERVICE_IDS]);
  assert.equal(demoProviderServiceIds.has("@archive"), true);
  assert.equal(demoProviderServiceIds.has("@node"), true);
  assert.equal(demoProviderServiceIds.has("@serviceadmin"), false);
});

test("demo watchdog defaults to the canonical LAN endpoints and runtime port", () => {
  const options = resolveWatchdogOptions([], {});
  assert.equal(options.runtimePort, 17883);
  assert.equal(options.serviceAdminUrl, "http://192.168.1.53:17700/");
  assert.equal(options.runtimeHealthUrl, "http://192.168.1.53:17883/api/health");

  const recovery = buildRecoveryCommand(options);
  assert.deepEqual(recovery.args, ["run", "demo:recycle", "--", "--port=17883"]);
  assert.equal(recovery.env.SERVICE_LASSO_PORT, "17883");
});

test("canonical demo verifier defaults to canonical LAN URLs", () => {
  const options = resolveCanonicalVerifierOptions([], {});
  assert.equal(options.runtimePort, canonicalRuntimePort);
  assert.equal(options.serviceAdminPort, canonicalServiceAdminPort);
  assert.equal(options.runtimeUrl, "http://192.168.1.53:17883");
  assert.equal(options.serviceAdminUrl, "http://192.168.1.53:17700/");
  assert.equal(options.runtimeHealthUrl, "http://192.168.1.53:17883/api/health");
});

test("canonical demo verifier accepts live metadata matching checked-in release pins", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-canonical-demo-"));
  const servicesRoot = path.join(tempDir, "services");
  const workspaceRoot = path.join(tempDir, "workspace", "demo-instance");

  try {
    await writeCanonicalManifest(servicesRoot, "@serviceadmin", {
      repo: "service-lasso/lasso-serviceadmin",
      tag: "2026.6.6-good",
      assetName: "@serviceadmin-win32.zip",
      ports: { ui: 17700 },
    });
    await writeCanonicalManifest(servicesRoot, "@secretsbroker", {
      repo: "service-lasso/lasso-secretsbroker",
      tag: "2026.6.8-good",
      assetName: "secretsbroker-win32.zip",
      ports: { service: 17890 },
    });

    const result = await verifyCanonicalDemo(
      {
        servicesRoot,
        workspaceRoot,
        runtimeUrl: "http://192.168.1.53:17883",
        serviceAdminUrl: "http://192.168.1.53:17700/",
      },
      { fetch: canonicalFetch({ servicesRoot, workspaceRoot }) },
    );

    assert.equal(result.ok, true);
    assert.equal(result.failures.length, 0);
    assert.equal(result.summary.services.length, 2);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("canonical demo verifier reports wrong runtime lane and stale release pins", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-canonical-demo-"));
  const servicesRoot = path.join(tempDir, "services");
  const workspaceRoot = path.join(tempDir, "workspace", "demo-instance");

  try {
    await writeCanonicalManifest(servicesRoot, "@serviceadmin", {
      repo: "service-lasso/lasso-serviceadmin",
      tag: "2026.6.6-good",
      assetName: "@serviceadmin-win32.zip",
      ports: { ui: 17700 },
    });
    await writeCanonicalManifest(servicesRoot, "@secretsbroker", {
      repo: "service-lasso/lasso-secretsbroker",
      tag: "2026.6.8-good",
      assetName: "secretsbroker-win32.zip",
      ports: { service: 17890 },
    });

    const result = await verifyCanonicalDemo(
      {
        servicesRoot,
        workspaceRoot,
        runtimeUrl: "http://192.168.1.53:18080",
        serviceAdminUrl: "http://192.168.1.53:17700/",
      },
      {
        fetch: canonicalFetch({
          servicesRoot,
          workspaceRoot,
          serviceAdminTag: "2026.5.15-stale",
        }),
      },
    );

    assert.equal(result.ok, false);
    assert.ok(result.failures.some((failure) => failure.code === "wrong_runtime_port"));
    assert.ok(result.failures.some((failure) => failure.code === "stale_release_pin"));
    assert.ok(result.failures.some((failure) => failure.code === "stale_installed_artifact"));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("demo watchdog refuses to overlap an active recovery lock", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-watchdog-"));
  const lockPath = path.join(tempDir, "watchdog.lock.json");

  try {
    await writeFile(
      lockPath,
      `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), ttlMs: 60_000 })}\n`,
    );

    const lock = await acquireWatchdogLock(lockPath, { ttlMs: 60_000 });
    assert.equal(lock.acquired, false);
    assert.equal(lock.reason, "recovery_already_running");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("demo watchdog lock is released only by the owning process", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-watchdog-"));
  const lockPath = path.join(tempDir, "watchdog.lock.json");

  try {
    const lock = await acquireWatchdogLock(lockPath, { ttlMs: 60_000 });
    assert.equal(lock.acquired, true);
    await releaseWatchdogLock(lockPath);
    const reacquired = await acquireWatchdogLock(lockPath, { ttlMs: 60_000 });
    assert.equal(reacquired.acquired, true);
    await releaseWatchdogLock(lockPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
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
