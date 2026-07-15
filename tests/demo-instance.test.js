import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import path from "node:path";
import os from "node:os";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { DEFAULT_BASELINE_SERVICE_IDS } from "../dist/runtime/cli/bootstrap.js";
import {
  assertDemoPortsAvailable,
  assertDemoRecycleOwnership,
  demoProviderServiceIds,
  demoRequiredServiceIds,
  resolveDemoOptions,
  stopDemoManagedProcesses,
} from "../scripts/demo-instance-lib.mjs";
import {
  acquireLegacySchedulerLock,
  acquireWatchdogLock,
  buildRecoveryCommand,
  releaseLegacySchedulerLock,
  releaseWatchdogLock,
  resolveWatchdogOptions,
} from "../scripts/demo-watchdog.mjs";
import {
  shouldAcquireDetachedRecycleLock,
  buildDetachedRecycleArgs,
  shouldStopWaitingForDetachedChild,
  waitForLiveServices,
} from "../scripts/demo-recycle.mjs";
import {
  hasJsonPath,
  buildCanonicalDeployRecycleArgs,
  parseEndpointExpectations,
  resolveCanonicalDeployOptions,
  runCanonicalDeploy,
} from "../scripts/demo-deploy-canonical.mjs";
import {
  applyCanonicalServiceAdminRuntimeUrl,
} from "../scripts/demo-canonical-root.mjs";
import {
  buildReachabilityTargets,
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

async function writeCanonicalManifest(servicesRoot, serviceId, { repo, tag, assetName, ports, role, urls, healthcheck }) {
  const serviceRoot = path.join(servicesRoot, serviceId);
  await mkdir(serviceRoot, { recursive: true });
  await writeFile(
    path.join(serviceRoot, "service.json"),
    `${JSON.stringify({
      id: serviceId,
      role,
      artifact: {
        source: { repo, tag },
        platforms: {
          [process.platform]: { assetName },
        },
      },
      ports,
      urls,
      healthcheck,
    }, null, 2)}\n`,
  );
}

const canonicalFixtureServices = [
  { id: "@archive", repo: "service-lasso/lasso-archive", tag: "2026.5.2-good", assetName: "archive-win32.zip", role: "provider", ports: {} },
  { id: "@java", repo: "service-lasso/lasso-java", tag: "2026.4.27-good", assetName: "java-win32.zip", role: "provider", ports: {} },
  { id: "@localcert", repo: "service-lasso/lasso-localcert", tag: "2026.5.2-good", assetName: "localcert-win32.zip", role: "provider", ports: {} },
  {
    id: "@nginx",
    repo: "service-lasso/lasso-nginx",
    tag: "2026.4.27-good",
    assetName: "nginx-win32.zip",
    role: undefined,
    ports: { http: 18080 },
    urls: [
      { label: "web", url: "http://127.0.0.1:${HTTP_PORT}/", kind: "local" },
      { label: "health", url: "http://127.0.0.1:${HTTP_PORT}/health", kind: "local" },
    ],
    healthcheck: { type: "http", url: "http://127.0.0.1:${HTTP_PORT}/health", expected_status: 200 },
  },
  {
    id: "@traefik",
    repo: "service-lasso/lasso-traefik",
    tag: "2026.5.9-good",
    assetName: "traefik-win32.zip",
    role: undefined,
    ports: { admin: 19081 },
    urls: [
      { label: "dashboard", url: "http://127.0.0.1:${ADMIN_PORT}/dashboard/", kind: "local" },
      { label: "ping", url: "http://127.0.0.1:${ADMIN_PORT}/ping", kind: "local" },
    ],
    healthcheck: { type: "http", url: "http://127.0.0.1:${ADMIN_PORT}/ping", expected_status: 200 },
  },
  { id: "@node", repo: "service-lasso/lasso-node", tag: "2026.4.27-good", assetName: "node-win32.zip", role: "provider", ports: {} },
  { id: "@python", repo: "service-lasso/lasso-python", tag: "2026.4.27-good", assetName: "python-win32.zip", role: "provider", ports: {} },
  {
    id: "@secretsbroker",
    repo: "service-lasso/lasso-secretsbroker",
    tag: "2026.6.8-good",
    assetName: "secretsbroker-win32.zip",
    role: undefined,
    ports: { service: 17890 },
    urls: [{ label: "health", url: "http://127.0.0.1:${SERVICE_PORT}/health", kind: "local" }],
    healthcheck: { type: "http", url: "http://127.0.0.1:${SERVICE_PORT}/health", expected_status: 200 },
  },
  {
    id: "echo-service",
    repo: "service-lasso/lasso-echoservice",
    tag: "2026.5.1-good",
    assetName: "echo-win32.zip",
    role: undefined,
    ports: { service: 4010, health: 4011 },
    urls: [
      { label: "ui", url: "http://127.0.0.1:${SERVICE_PORT}/", kind: "local" },
      { label: "health", url: "http://127.0.0.1:${HEALTH_PORT}/health", kind: "local" },
    ],
  },
  {
    id: "@serviceadmin",
    repo: "service-lasso/lasso-serviceadmin",
    tag: "2026.6.6-good",
    assetName: "@serviceadmin-win32.zip",
    role: undefined,
    ports: { ui: 17700 },
    urls: [{ label: "ui", url: "http://127.0.0.1:${UI_PORT}/", kind: "local" }],
  },
];

test("canonical reachability target builder accepts a single manifest url object", () => {
  const targets = buildReachabilityTargets(
    "@secretsbroker",
    {
      urls: { label: "health", url: "http://127.0.0.1:${SERVICE_PORT}/health", kind: "local" },
      healthcheck: { type: "http", url: "http://127.0.0.1:${SERVICE_PORT}/health", expected_status: 200 },
    },
    { service: 17890 },
  );

  assert.deepEqual(targets, [
    {
      label: "health",
      url: "http://127.0.0.1:17890/health",
      source: "manifest.urls",
      expectedStatus: 200,
    },
  ]);
});

test("canonical deploy parses status and JSON endpoint expectations", () => {
  assert.deepEqual(
    parseEndpointExpectations([
      "--expect",
      "/api/log-shipping:200",
      "--expect-json",
      "/api/telemetry:apiRequests",
    ]),
    {
      statusExpectations: [{ path: "/api/log-shipping", expectedStatus: 200 }],
      jsonExpectations: [{ path: "/api/telemetry", jsonPath: "apiRequests" }],
    },
  );
  assert.equal(hasJsonPath({ apiRequests: [] }, "apiRequests"), true);
  assert.equal(hasJsonPath({ telemetry: { apiRequests: [] } }, "telemetry.apiRequests"), true);
  assert.equal(hasJsonPath({ telemetry: { apiRequests: [] } }, "apiRequests"), true);
  assert.equal(hasJsonPath({ telemetry: {} }, "telemetry.apiRequests"), false);
});

test("canonical deploy accepts npm-forwarded positional deploy args", () => {
  assert.deepEqual(
    resolveCanonicalDeployOptions([
      "HEAD",
      "/api/log-shipping:200",
      "/api/telemetry:telemetry.apiRequests",
    ], {
      SERVICE_LASSO_DEMO_HOST: "127.0.0.1",
      npm_config_expect: "true",
      npm_config_expect_json: "true",
      npm_config_ref: "true",
    }),
    {
      ref: "HEAD",
      host: "127.0.0.1",
      runtimePort: canonicalRuntimePort,
      serviceAdminPort: canonicalServiceAdminPort,
      runtimeUrl: `http://127.0.0.1:${canonicalRuntimePort}`,
      serviceAdminUrl: `http://127.0.0.1:${canonicalServiceAdminPort}/`,
      servicesRoot: path.resolve("services"),
      workspaceRoot: path.resolve("workspace", "demo-instance"),
      logsRoot: path.resolve(".demo-logs"),
      summaryPath: path.resolve(".demo-logs", "canonical-deploy-summary.json"),
      forceRecovery: false,
      timeoutMs: 15 * 60 * 1000,
      fetchTimeoutMs: 15_000,
      allowDirtyWorktree: false,
      statusExpectations: [{ path: "/api/log-shipping", expectedStatus: 200 }],
      jsonExpectations: [{ path: "/api/telemetry", jsonPath: "telemetry.apiRequests" }],
    },
  );
});

test("canonical deploy and recycle propagate LAN runtime URLs to child scripts", () => {
  const deployOptions = resolveCanonicalDeployOptions([
    "--ref=HEAD",
    "--host=0.0.0.0",
    "--runtime-url=http://192.168.1.53:17883",
    "--service-admin-url=http://192.168.1.53:17700/",
    "--services-root=C:/tmp/service-lasso/services",
    "--workspace-root=C:/tmp/service-lasso/workspace",
  ]);

  assert.deepEqual(
    buildCanonicalDeployRecycleArgs(deployOptions).filter((arg) =>
      arg.startsWith("--host=") || arg.startsWith("--runtime-url=") || arg.startsWith("--admin-url=")
    ),
    [
      "--host=0.0.0.0",
      "--runtime-url=http://192.168.1.53:17883",
      "--admin-url=http://192.168.1.53:17700/",
    ],
  );

  const recycleOptions = resolveDemoOptions([
    "--port=17883",
    "--host=0.0.0.0",
    "--runtime-url=http://192.168.1.53:17883",
    "--admin-url=http://192.168.1.53:17700/",
    "--services-root=C:/tmp/service-lasso/services",
    "--workspace-root=C:/tmp/service-lasso/workspace",
  ]);

  assert.deepEqual(
    buildDetachedRecycleArgs(recycleOptions).filter((arg) =>
      arg.startsWith("--host=") || arg.startsWith("--runtime-url=") || arg.startsWith("--admin-url=")
    ),
    [
      "--host=0.0.0.0",
      "--runtime-url=http://192.168.1.53:17883",
      "--admin-url=http://192.168.1.53:17700/",
    ],
  );
});

test("canonical service admin seed uses the canonical runtime URL for its API proxy", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-serviceadmin-seed-"));
  const servicesRoot = path.join(tempDir, "services");
  const serviceAdminRoot = path.join(servicesRoot, "@serviceadmin");
  const manifestPath = path.join(serviceAdminRoot, "service.json");
  const runtimeUrl = "http://192.168.1.53:17883";

  try {
    await mkdir(serviceAdminRoot, { recursive: true });
    await writeFile(
      manifestPath,
      `${JSON.stringify({
        id: "@serviceadmin",
        env: {
          SERVICE_LASSO_API_BASE_URL: "http://127.0.0.1:17883",
          SERVICE_LASSO_RUNTIME_API_BASE_URL: "http://127.0.0.1:17883",
        },
      })}\n`,
    );

    await applyCanonicalServiceAdminRuntimeUrl(servicesRoot, runtimeUrl);

    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(manifest.env.SERVICE_LASSO_API_BASE_URL, runtimeUrl);
    assert.equal(manifest.env.SERVICE_LASSO_RUNTIME_API_BASE_URL, runtimeUrl);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("canonical deploy fails closed and writes summary for unmanaged canonical port owner", async () => {
  const listener = await listenOnLoopback();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-canonical-deploy-"));
  const summaryPath = path.join(tempDir, "summary.json");

  try {
    const head = await new Promise((resolve, reject) => {
      const child = spawn("git", ["rev-parse", "HEAD"], {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
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
      child.once("close", (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(stderr || stdout));
        }
      });
    });

    await assert.rejects(
      () => runCanonicalDeploy({
        ref: head,
        runtimePort: listener.port,
        serviceAdminPort: 65530,
        runtimeUrl: `http://127.0.0.1:${listener.port}`,
        serviceAdminUrl: "http://127.0.0.1:65530/",
        servicesRoot: path.join(tempDir, "services"),
        workspaceRoot: path.join(tempDir, "workspace", "demo-instance"),
        logsRoot: tempDir,
        summaryPath,
        forceRecovery: false,
        timeoutMs: 1_000,
        fetchTimeoutMs: 100,
        allowDirtyWorktree: true,
        statusExpectations: [],
        jsonExpectations: [],
      }),
      /non-managed process/,
    );

    const summary = JSON.parse(await readFile(summaryPath, "utf8"));
    assert.equal(summary.ok, false);
    assert.equal(summary.failure.code, "unmanaged_port_owner");
    assert.ok(summary.ports.unmanaged.some((entry) => entry.port === listener.port));
  } finally {
    await listener.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function writeCanonicalFixtureManifests(servicesRoot) {
  await Promise.all(
    canonicalFixtureServices.map((service) => writeCanonicalManifest(servicesRoot, service.id, service)),
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

function canonicalFetch({ servicesRoot, workspaceRoot, serviceAdminTag = "2026.6.6-good" }) {
  const services = canonicalFixtureServices.map((service) => {
    const tag = service.id === "@serviceadmin" ? serviceAdminTag : service.tag;
    const providerRole = service.role === "provider";
    return {
      id: service.id,
      serviceRoot: path.join(servicesRoot, service.id),
      lifecycle: {
        installed: true,
        configured: true,
        running: !providerRole,
        installArtifacts: {
          artifact: {
            repo: service.repo,
            tag,
            assetName: service.assetName,
          },
        },
        runtime: { ports: service.ports },
      },
      health: { healthy: true },
      catalogProvenance: {
        repo: service.repo,
        releaseTag: tag,
      },
    };
  });

  return async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/") {
      return textResponse(200, "<html>Service Admin</html>");
    }
    if (parsed.pathname === "/health") {
      return textResponse(200, "ok");
    }
    if (parsed.pathname === "/dashboard/") {
      return textResponse(200, "<html>Traefik dashboard</html>");
    }
    if (parsed.pathname === "/ping") {
      return textResponse(200, "OK");
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

test("canonical demo verifier fails when an advertised service URL is unreachable", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-canonical-demo-"));
  const servicesRoot = path.join(tempDir, "services");
  const workspaceRoot = path.join(tempDir, "workspace", "demo-instance");

  try {
    await writeCanonicalFixtureManifests(servicesRoot);

    const result = await verifyCanonicalDemo(
      {
        servicesRoot,
        workspaceRoot,
        runtimeUrl: "http://192.168.1.53:17883",
        serviceAdminUrl: "http://192.168.1.53:17700/",
      },
      {
        fetch: async (url, options) => {
          const parsed = new URL(url);
          if (parsed.port === "4011" && parsed.pathname === "/health") {
            return textResponse(503, "not ready");
          }
          return canonicalFetch({ servicesRoot, workspaceRoot })(url, options);
        },
      },
    );

    assert.equal(result.ok, false);
    assert.ok(result.failures.some((failure) => failure.code === "unreachable_service_url"));
    assert.ok(result.failures.some((failure) => /echo-service advertised health/.test(failure.name)));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
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

test("detached demo recycle keeps waiting when an exited child still has a live pid", () => {
  assert.equal(shouldStopWaitingForDetachedChild(null, true), false);
  assert.equal(shouldStopWaitingForDetachedChild({ code: 0, signal: null }, true), false);
  assert.equal(shouldStopWaitingForDetachedChild({ code: 1, signal: null }, false), true);
});

test("detached demo recycle skips lock acquisition when watchdog already owns it", () => {
  assert.equal(shouldAcquireDetachedRecycleLock({}), true);
  assert.equal(shouldAcquireDetachedRecycleLock({ SERVICE_LASSO_DEMO_RECOVERY_LOCK_HELD: "1" }), false);
});

test("detached demo recycle service readiness waits after ownership handoff", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const readyServices = demoRequiredServiceIds.map((serviceId) => ({
    id: serviceId,
    lifecycle: {
      installed: true,
      configured: true,
      running: demoProviderServiceIds.has(serviceId) ? false : true,
    },
    health: { healthy: true },
  }));

  try {
    globalThis.fetch = async () => {
      calls += 1;
      if (calls < 3) {
        return jsonResponse(200, {
          services: demoRequiredServiceIds.map((serviceId) => ({
            id: serviceId,
            lifecycle: { installed: false, configured: false, running: false },
            health: { healthy: false },
          })),
        });
      }
      return jsonResponse(200, { services: readyServices });
    };

    const services = await waitForLiveServices("http://127.0.0.1:17883", {
      timeoutMs: 1_000,
      intervalMs: 1,
    });

    assert.equal(calls >= 3, true);
    assert.equal(services.some((service) => service.id === "@serviceadmin" && service.running && service.healthy), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("demo watchdog defaults to the canonical LAN endpoints and runtime port", () => {
  const options = resolveWatchdogOptions([], {});
  assert.equal(options.runtimePort, 17883);
  assert.equal(options.serviceAdminUrl, "http://192.168.1.53:17700/");
  assert.equal(options.runtimeHealthUrl, "http://192.168.1.53:17883/api/health");
  assert.equal(options.legacySchedulerLockPath, path.resolve(".demo-logs", "watchdog.lock"));

  const recovery = buildRecoveryCommand(options);
  assert.deepEqual(recovery.args, ["run", "demo:recycle", "--", "--port=17883"]);
  assert.equal(recovery.env.SERVICE_LASSO_PORT, "17883");
  assert.equal(recovery.env.SERVICE_LASSO_DEMO_RECOVERY_LOCK_HELD, "1");
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
    await writeCanonicalFixtureManifests(servicesRoot);

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
    assert.equal(result.summary.services.length, canonicalFixtureServices.length);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("canonical demo verifier reports wrong runtime lane and stale release pins", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-canonical-demo-"));
  const servicesRoot = path.join(tempDir, "services");
  const workspaceRoot = path.join(tempDir, "workspace", "demo-instance");

  try {
    await writeCanonicalFixtureManifests(servicesRoot);

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

test("demo recycle coordinates with the legacy scheduled watchdog lock", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-legacy-watchdog-"));
  const lockPath = path.join(tempDir, "watchdog.lock");

  try {
    const acquired = await acquireLegacySchedulerLock(lockPath, { ttlMs: 60_000 });
    assert.equal(acquired.acquired, true);

    const lockFile = JSON.parse(await readFile(lockPath, "utf8"));
    assert.equal(lockFile.owner, "service-lasso-demo-recycle");
    assert.equal(lockFile.pid, process.pid);

    const blocked = await acquireLegacySchedulerLock(lockPath, { ttlMs: 60_000 });
    assert.equal(blocked.acquired, false);
    assert.equal(blocked.reason, "legacy_recovery_already_running");

    await releaseLegacySchedulerLock(lockPath);
    const reacquired = await acquireLegacySchedulerLock(lockPath, { ttlMs: 60_000 });
    assert.equal(reacquired.acquired, true);
    await releaseLegacySchedulerLock(lockPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("demo smoke script validates the bounded demo instance end to end", async () => {
  const demoScript = path.resolve("scripts", "demo-smoke.mjs");
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-demo-smoke-"));
  const servicesRoot = path.join(tempDir, "services");
  const workspaceRoot = path.join(tempDir, "workspace", "demo-instance");

  try {
    await cp(path.resolve("services"), servicesRoot, { recursive: true });

    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [demoScript], {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          SERVICE_LASSO_PORT: "0",
          SERVICE_LASSO_SERVICES_ROOT: servicesRoot,
          SERVICE_LASSO_WORKSPACE_ROOT: workspaceRoot,
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
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
