import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { DEFAULT_BASELINE_SERVICE_IDS } from "../dist/runtime/cli/bootstrap.js";
import {
  assertDemoPortsAvailable,
  assertDemoRecycleOwnership,
  applyDemoServiceAdminRuntimeApiUrl,
  buildDemoRuntimeAppOptions,
  canonicalDemoRequiredServiceIds,
  canonicalDemoRuntimePort,
  demoProviderServiceIds,
  demoRequiredServiceIds,
  getDemoStatus,
  resolveDemoOptions,
  resolveDemoRuntimePort,
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
  prepareCanonicalDeployOptions,
  parseEndpointExpectations,
  resolveCanonicalDeployOptions,
  runCanonicalDeploy,
} from "../scripts/demo-deploy-canonical.mjs";
import {
  applyCanonicalServiceAdminRuntimeUrl,
  canonicalDemoServicesRoot,
} from "../scripts/demo-canonical-root.mjs";
import {
  buildReachabilityTargets,
  canonicalRuntimePort,
  canonicalServiceAdminPort,
  resolveCanonicalVerifierOptions,
  verifyCanonicalDemo,
} from "../scripts/demo-verify-canonical.mjs";
import {
  buildWorktreeProofCommands,
  patchWorktreeDemoManifest,
  resolveWorktreeProofOptions,
} from "../scripts/demo-worktree-proof.mjs";

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

async function allocateLoopbackPorts(count) {
  const reservations = [];
  try {
    for (let index = 0; index < count; index += 1) {
      reservations.push(await listenOnLoopback());
    }
    return reservations.map((reservation) => reservation.port);
  } finally {
    await Promise.all(reservations.map((reservation) => reservation.close()));
  }
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
  {
    id: "openobserve",
    repo: "service-lasso/lasso-openobserve",
    tag: "2026.8.13-f908994",
    assetName: "lasso-openobserve-v0.10.8-rc4-win32.zip",
    role: undefined,
    ports: { service: 5080, grpc: 5081 },
    urls: [
      { label: "ui", url: "http://127.0.0.1:${SERVICE_PORT}/", kind: "local" },
      { label: "health", url: "http://127.0.0.1:${SERVICE_PORT}/healthz", kind: "local" },
    ],
    healthcheck: { type: "http", url: "http://127.0.0.1:${SERVICE_PORT}/healthz", expected_status: 200 },
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
      SERVICE_LASSO_DEMO_BIND_HOST: "0.0.0.0",
      SERVICE_LASSO_DEMO_URL_HOST: "demo.example.test",
      npm_config_expect: "true",
      npm_config_expect_json: "true",
      npm_config_ref: "true",
    }),
    {
      ref: "HEAD",
      host: "0.0.0.0",
      runtimePort: canonicalRuntimePort,
      serviceAdminPort: canonicalServiceAdminPort,
      runtimeUrl: `http://demo.example.test:${canonicalRuntimePort}`,
      serviceAdminUrl: `http://demo.example.test:${canonicalServiceAdminPort}/`,
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

test("canonical deploy accepts npm-forwarded deploy option configs", () => {
  const options = resolveCanonicalDeployOptions([], {
    npm_config_ref: "HEAD",
    npm_config_host: "0.0.0.0",
    npm_config_force_recovery: "true",
    npm_config_logs_root: "C:/tmp/service-lasso/deploy-logs",
    npm_config_runtime_url: "http://127.0.0.1:17883",
    npm_config_service_admin_url: "http://127.0.0.1:17700/",
    npm_config_services_root: "C:/tmp/service-lasso/services",
    npm_config_workspace_root: "C:/tmp/service-lasso/workspace",
  });

  assert.equal(options.ref, "HEAD");
  assert.equal(options.forceRecovery, true);
  assert.equal(options.logsRoot, path.resolve("C:/tmp/service-lasso/deploy-logs"));
  assert.equal(options.runtimeUrl, "http://127.0.0.1:17883");
  assert.equal(options.serviceAdminUrl, "http://127.0.0.1:17700/");
  assert.equal(options.servicesRoot, path.resolve("C:/tmp/service-lasso/services"));
  assert.equal(options.workspaceRoot, path.resolve("C:/tmp/service-lasso/workspace"));
});

test("canonical deploy rejects missing network parameters before execution", () => {
  assert.throws(
    () => resolveCanonicalDeployOptions(["--ref=HEAD"], {}),
    /requires --host=<bind-host>/,
  );
  assert.throws(
    () => resolveCanonicalDeployOptions(["--ref=HEAD", "--host=0.0.0.0"], {}),
    /requires --url-host=<client-visible-host>/,
  );
});

test("canonical deploy derives runtime and Admin URLs from explicit parameters", () => {
  const options = resolveCanonicalDeployOptions([
    "--ref=HEAD",
    "--host=0.0.0.0",
    "--url-host=demo.example.test",
  ], {});

  assert.equal(options.host, "0.0.0.0");
  assert.equal(options.runtimeUrl, `http://demo.example.test:${canonicalRuntimePort}`);
  assert.equal(options.serviceAdminUrl, `http://demo.example.test:${canonicalServiceAdminPort}/`);
});

test("canonical deploy and recycle propagate LAN runtime URLs to child scripts", () => {
  const deployOptions = resolveCanonicalDeployOptions([
    "--ref=HEAD",
    "--host=0.0.0.0",
    "--runtime-url=http://demo.example.test:17883",
    "--service-admin-url=http://demo.example.test:17700/",
    "--services-root=C:/tmp/service-lasso/services",
    "--workspace-root=C:/tmp/service-lasso/workspace",
  ]);

  assert.deepEqual(
    buildCanonicalDeployRecycleArgs(deployOptions).filter((arg) =>
      arg.startsWith("--host=") || arg.startsWith("--runtime-url=") || arg.startsWith("--admin-url=")
    ),
    [
      "--host=0.0.0.0",
      "--runtime-url=http://demo.example.test:17883",
      "--admin-url=http://demo.example.test:17700/",
    ],
  );

  const recycleOptions = resolveDemoOptions([
    "--port=17883",
    "--host=0.0.0.0",
    "--runtime-url=http://demo.example.test:17883",
    "--admin-url=http://demo.example.test:17700/",
    "--services-root=C:/tmp/service-lasso/services",
    "--workspace-root=C:/tmp/service-lasso/workspace",
  ]);

  assert.deepEqual(
    buildDetachedRecycleArgs(recycleOptions).filter((arg) =>
      arg.startsWith("--host=") || arg.startsWith("--runtime-url=") || arg.startsWith("--admin-url=")
    ),
    [
      "--host=0.0.0.0",
      "--runtime-url=http://demo.example.test:17883",
      "--admin-url=http://demo.example.test:17700/",
    ],
  );
});

test("canonical deploy preparation honors explicit service roots", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-canonical-deploy-root-"));
  const servicesRoot = path.join(tempDir, "services");

  try {
    const deployOptions = resolveCanonicalDeployOptions([
      "--ref=HEAD",
      "--host=0.0.0.0",
      "--url-host=demo.example.test",
      "--runtime-url=http://demo.example.test:17883",
      `--services-root=${servicesRoot}`,
    ]);

    const prepared = await prepareCanonicalDeployOptions(deployOptions);

    assert.equal(prepared.servicesRoot, servicesRoot);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("worktree proof records allocated URLs for gate, verifier, and cleanup handoff", () => {
  const options = resolveWorktreeProofOptions(["--id=issue-947", "--host=0.0.0.0", "--url-host=127.0.0.1"], {});
  const commands = buildWorktreeProofCommands(options, {
    runtime: 18123,
    serviceAdmin: 18124,
    manifest: {},
  });

  assert.equal(options.worktreeId, "issue-947");
  assert.match(options.servicesRoot, /workspace[\\/]demo-instance[\\/]worktree-proof[\\/]issue-947[\\/]services$/);
  assert.match(options.workspaceRoot, /workspace[\\/]demo-instance[\\/]worktree-proof[\\/]issue-947[\\/]workspace$/);
  assert.match(commands.gate, /--runtime-url=http:\/\/127\.0\.0\.1:18123/);
  assert.match(commands.gate, /--admin-url=http:\/\/127\.0\.0\.1:18124\//);
  assert.match(commands.verify, /--service-admin-port=18124/);
  assert.match(commands.cleanup, /demo-worktree-proof\.mjs --cleanup/);
});

test("worktree proof accepts npm-forwarded proof option configs", () => {
  const options = resolveWorktreeProofOptions([], {
    npm_config_id: "issue-947",
    npm_config_replace: "true",
    npm_config_proof_root: "C:/tmp/service-lasso/proof",
    npm_config_demo_log_root: "C:/tmp/service-lasso/proof-logs",
    npm_config_runtime_port: "18123",
    npm_config_service_admin_port: "18124",
    npm_config_json: "true",
  });

  assert.equal(options.worktreeId, "issue-947");
  assert.equal(options.replace, true);
  assert.equal(options.proofRoot, path.resolve("C:/tmp/service-lasso/proof"));
  assert.equal(options.demoLogRoot, path.resolve("C:/tmp/service-lasso/proof-logs"));
  assert.equal(options.runtimePort, 18123);
  assert.equal(options.serviceAdminPort, 18124);
  assert.equal(options.json, true);
});

test("worktree proof patches copied Service Admin manifests to allocated URLs", () => {
  const patched = patchWorktreeDemoManifest(
    "@serviceadmin",
    {
      id: "@serviceadmin",
      ports: { ui: 17700 },
      env: {
        SERVICE_LASSO_API_BASE_URL: "http://old-demo.example.test:17883",
        SERVICE_LASSO_RUNTIME_API_BASE_URL: "http://old-demo.example.test:17883",
      },
    },
    {
      runtimeUrl: "http://127.0.0.1:18123",
      ports: {
        manifest: {
          "@serviceadmin:ports:ui": 18124,
        },
      },
    },
  );

  assert.equal(patched.ports.ui, 18124);
  assert.equal(patched.env.SERVICE_LASSO_API_BASE_URL, "http://127.0.0.1:18123");
  assert.equal(patched.env.SERVICE_LASSO_RUNTIME_API_BASE_URL, "http://127.0.0.1:18123");
});

test("canonical service admin seed uses the canonical runtime URL for its API proxy", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-serviceadmin-seed-"));
  const servicesRoot = path.join(tempDir, "services");
  const serviceAdminRoot = path.join(servicesRoot, "@serviceadmin");
  const manifestPath = path.join(serviceAdminRoot, "service.json");
  const runtimeUrl = "http://demo.example.test:17883";

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

test("demo recycle rewrites Service Admin runtime API proxy URL", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-serviceadmin-recycle-"));
  const servicesRoot = path.join(tempDir, "services");
  const serviceAdminRoot = path.join(servicesRoot, "@serviceadmin");
  const manifestPath = path.join(serviceAdminRoot, "service.json");
  const runtimeUrl = "http://demo.example.test:17883";

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

    await applyDemoServiceAdminRuntimeApiUrl(servicesRoot, runtimeUrl);

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
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json" },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function textResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "text/plain" },
    json: async () => JSON.parse(body),
    text: async () => body,
  };
}

function canonicalFetch({
  servicesRoot,
  workspaceRoot,
  serviceAdminTag = "2026.6.6-good",
  sourceServiceAdmin = false,
  sourceServiceAdminSeeded = false,
  generationId = "11111111-1111-4111-8111-111111111111",
}) {
  const services = canonicalFixtureServices.map((service) => {
    const tag = service.id === "@serviceadmin" ? serviceAdminTag : service.tag;
    const providerRole = service.role === "provider";
    const sourceAdminService = sourceServiceAdmin && service.id === "@serviceadmin";
    return {
      id: service.id,
      serviceRoot: path.join(servicesRoot, service.id),
      lifecycle: {
        installed: sourceAdminService ? sourceServiceAdminSeeded : true,
        configured: sourceAdminService ? sourceServiceAdminSeeded : true,
        running: sourceAdminService ? false : !providerRole,
        installArtifacts: sourceAdminService
          ? (sourceServiceAdminSeeded
            ? {
              artifact: {
                repo: service.repo,
                tag,
                assetName: service.assetName,
              },
            }
            : null)
          : {
            artifact: {
              repo: service.repo,
              tag,
              assetName: service.assetName,
            },
          },
        runtime: { ports: service.ports },
      },
      health: { healthy: !sourceAdminService },
      catalogProvenance: {
        repo: service.repo,
        releaseTag: tag,
      },
    };
  });
  const guardedConfirmation = {
    id: "mcp-confirmation-11111111-1111-4111-8111-111111111111",
    confirmationPhrase: "confirm service-restart echo-service",
  };
  const guardedCorrelationId = "mcp-correlation-canonical-demo";
  let guardedIdempotencyKey = null;
  let guardedExecutionCount = 0;

  return async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/") {
      return textResponse(200, "<html>Service Admin</html>");
    }
    if (parsed.pathname === "/health") {
      return textResponse(200, "ok");
    }
    if (parsed.pathname === "/healthz") {
      return textResponse(200, "ok");
    }
    if (parsed.pathname === "/dashboard/") {
      return textResponse(200, "<html>Traefik dashboard</html>");
    }
    if (parsed.pathname === "/api/dashboard") {
      return jsonResponse(200, {
        summary: {
          runtime: { status: "ok" },
          servicesTotal: services.length,
          servicesRunning: services.filter((service) => service.lifecycle.running).length,
          installedCount: services.filter((service) => service.lifecycle.installed).length,
          warnings: [],
        },
      });
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
    if (parsed.pathname === "/api/runtime/instance") {
      return jsonResponse(200, {
        instance: {
          instanceId: "sl_canonical",
          generationId,
          servicesRoot,
          workspaceRoot,
          apiUrl: parsed.origin,
        },
        selection: {
          classification: "selected",
          selectedGenerationId: generationId,
        },
      });
    }
    if (parsed.pathname === "/api/mcp/info") {
      return jsonResponse(200, {
        contractVersion: "service-lasso-mcp.v1",
        protocolVersion: "2025-11-25",
        supportedProtocolVersions: ["2025-11-25", "2024-11-05"],
        sdk: { packageName: "@modelcontextprotocol/sdk", version: "1.30.0" },
        policy: { operatingMode: "guarded" },
      });
    }
    if (parsed.pathname === "/api/mcp" && options.method === "POST") {
      const request = JSON.parse(options.body);
      const tool = (name) => ({
        name,
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        outputSchema: { type: "object", properties: {}, additionalProperties: false },
      });
      if (request.method === "initialize") {
        return jsonResponse(200, { jsonrpc: "2.0", id: request.id, result: {
          protocolVersion: request.params?.protocolVersion,
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: "service-lasso-operator", version: "fixture" },
        } });
      }
      if (request.method === "notifications/initialized") {
        return jsonResponse(202, {});
      }
      if (request.method === "tools/list") {
        return jsonResponse(200, { jsonrpc: "2.0", id: request.id, result: { tools: [
          tool("service_lasso_runtime_status"),
          tool("service_lasso_list_services"),
          tool("service_lasso_restart_service"),
        ] } });
      }
      if (request.method === "resources/list") {
        return jsonResponse(200, { jsonrpc: "2.0", id: request.id, result: { resources: [
          { uri: "servicelasso://runtime", name: "Runtime", mimeType: "application/json" },
        ] } });
      }
      if (request.method === "tools/call" && request.params?.name === "service_lasso_runtime_status") {
        return jsonResponse(200, { jsonrpc: "2.0", id: request.id, result: {
          structuredContent: { runtime: { status: "ready" } },
        } });
      }
      if (request.method === "tools/call" && request.params?.name === "service_lasso_list_services") {
        return jsonResponse(200, { jsonrpc: "2.0", id: request.id, result: {
          structuredContent: { services },
        } });
      }
      if (request.method === "tools/call" && request.params?.name === "service_lasso_restart_service") {
        const argumentsValue = request.params?.arguments ?? {};
        if (argumentsValue.execute !== true) {
          return jsonResponse(200, { jsonrpc: "2.0", id: request.id, result: {
            structuredContent: {
              status: "preflight",
              confirmation: { required: true, ...guardedConfirmation },
            },
          } });
        }
        assert.equal(argumentsValue.confirmationId, guardedConfirmation.id);
        assert.equal(argumentsValue.confirmationPhrase, guardedConfirmation.confirmationPhrase);
        assert.equal(typeof argumentsValue.idempotencyKey, "string");
        if (guardedIdempotencyKey === null) {
          guardedIdempotencyKey = argumentsValue.idempotencyKey;
          guardedExecutionCount += 1;
          return jsonResponse(200, { jsonrpc: "2.0", id: request.id, result: {
            structuredContent: {
              status: "succeeded",
              correlationId: guardedCorrelationId,
              idempotency: { replayed: false },
              result: { resultingState: [{ serviceId: "echo-service", running: true }] },
            },
          } });
        }
        assert.equal(argumentsValue.idempotencyKey, guardedIdempotencyKey);
        assert.equal(guardedExecutionCount, 1);
        return jsonResponse(200, { jsonrpc: "2.0", id: request.id, result: {
          structuredContent: {
            status: "replayed",
            correlationId: guardedCorrelationId,
            idempotency: { replayed: true },
            result: { resultingState: [{ serviceId: "echo-service", running: true }] },
          },
        } });
      }
    }
    if (parsed.pathname === "/api/services") {
      return jsonResponse(200, { services });
    }
    return jsonResponse(404, { error: "not_found" });
  };
}

function canonicalServiceStateFixture({ serviceAdminInstalled = false, serviceAdminConfigured = false } = {}) {
  return [
    ...canonicalFixtureServices.map((service) => {
      const providerRole = service.role === "provider";
      const sourceAdminService = service.id === "@serviceadmin";
      return {
        id: service.id,
        lifecycle: {
          installed: sourceAdminService ? serviceAdminInstalled : true,
          configured: sourceAdminService ? serviceAdminConfigured : true,
          running: sourceAdminService ? false : !providerRole,
        },
        health: { healthy: !sourceAdminService || providerRole },
      };
    }),
    {
      id: "node-sample-service",
      lifecycle: {
        installed: false,
        configured: false,
        running: false,
      },
      health: { healthy: false },
    },
  ];
}

test("demo gate status accepts the source Admin service-state contract", async () => {
  const originalFetch = globalThis.fetch;
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-demo-status-source-admin-"));

  try {
    const servicesRoot = path.join(tempDir, "services");
    const workspaceRoot = path.join(tempDir, "workspace", "demo-instance");
    const baseFetch = canonicalFetch({ servicesRoot, workspaceRoot, sourceServiceAdmin: true });
    globalThis.fetch = async (url, options) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/api/services") {
        return jsonResponse(200, { services: canonicalServiceStateFixture() });
      }
      return baseFetch(url, options);
    };
    const result = await getDemoStatus({
      runtimeUrl: "http://127.0.0.1:17883",
      serviceAdminUrl: "http://127.0.0.1:17700/",
      workspaceRoot,
      demoLogRoot: path.join(tempDir, ".demo-logs"),
      timeoutMs: 100,
    });

    assert.equal(result.ok, true);
    assert.equal(result.classification, "healthy");
    assert.equal(result.endpoints.serviceAdmin.serviceState.mode, "source_admin_on_17700");
    assert.match(result.endpoints.serviceAdmin.serviceState.acceptedWarningReason, /Source Service Admin owns port 17700/);
    assert.deepEqual(
      result.endpoints.serviceAdmin.serviceState.actual.find((service) => service.id === "@serviceadmin"),
      {
        id: "@serviceadmin",
        installed: false,
        configured: false,
        running: false,
        healthy: false,
        expectedMode: "source_admin_owns_17700",
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("demo gate status accepts seeded source Admin manifest state", async () => {
  const originalFetch = globalThis.fetch;
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-demo-status-source-admin-seeded-"));
  const servicesRoot = path.join(tempDir, "services");
  const workspaceRoot = path.join(tempDir, "workspace", "demo-instance");
  const baseFetch = canonicalFetch({ servicesRoot, workspaceRoot, sourceServiceAdmin: true });

  try {
    globalThis.fetch = async (url, options) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/api/services") {
        return jsonResponse(200, {
          services: canonicalServiceStateFixture({ serviceAdminInstalled: true, serviceAdminConfigured: true }),
        });
      }
      return baseFetch(url, options);
    };
    const result = await getDemoStatus({
      runtimeUrl: "http://127.0.0.1:17883",
      serviceAdminUrl: "http://127.0.0.1:17700/",
      workspaceRoot,
      demoLogRoot: path.join(tempDir, ".demo-logs"),
      timeoutMs: 100,
    });

    assert.equal(result.ok, true);
    assert.equal(result.classification, "healthy");
    assert.equal(result.endpoints.serviceAdmin.serviceState.mode, "source_admin_on_17700");
    assert.deepEqual(
      result.endpoints.serviceAdmin.serviceState.actual.find((service) => service.id === "@serviceadmin"),
      {
        id: "@serviceadmin",
        installed: true,
        configured: true,
        running: false,
        healthy: false,
        expectedMode: "source_admin_owns_17700",
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
    await rm(tempDir, { recursive: true, force: true });
  }
});

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
        runtimeUrl: "http://demo.example.test:17883",
        serviceAdminUrl: "http://demo.example.test:17700/",
      },
      {
        fetch: async (url, options) => {
          const parsed = new URL(url);
          if (parsed.pathname === "/api/runtime/doctor") {
            return {
              status: 200,
              async json() {
                return {
                  doctor: {
                    classification: "wrong_lane",
                    recommendedAction: "request_operator_confirmation",
                    readOnly: true,
                  },
                };
              },
            };
          }
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
    assert.equal(result.summary.doctor.classification, "wrong_lane");
    assert.equal(result.summary.doctor.recommendedAction, "request_operator_confirmation");
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

test("demo stop wrapper uses the core workspace stop contract", async () => {
  const fixtureTemp = await mkdtemp(path.join(os.tmpdir(), "service-lasso-demo-core-stop-"));
  const servicesRoot = path.join(fixtureTemp, "services");
  const workspaceRoot = path.join(fixtureTemp, "workspace", "demo-instance");
  await mkdir(servicesRoot, { recursive: true });
  await mkdir(workspaceRoot, { recursive: true });

  try {
    const result = await stopDemoManagedProcesses({ servicesRoot, workspaceRoot });
    assert.equal(result.lifecycle.schema, "service-lasso.workspace-lifecycle.v1");
    assert.equal(result.lifecycle.action, "stop");
    assert.equal(result.lifecycle.ok, true);
    assert.equal(result.lifecycle.outcome, "already_stopped");
    assert.equal(result.lifecycle.ownership, "not_running");
  } finally {
    await rm(fixtureTemp, { recursive: true, force: true });
  }
});

test("demo recycle stops verified registry-owned service processes through core stop", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-registry-cleanup-"));
  const servicesRoot = path.join(tempDir, "services");
  const workspaceRoot = path.join(tempDir, "workspace", "demo-instance");
  const serviceRoot = path.join(servicesRoot, "@nginx");
  const keepAliveScript = path.join(serviceRoot, "keep-alive.mjs");
  let child = null;
  const { recordProcessOwnership } = await import("../dist/runtime/process/registry.js");

  const processIsAlive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  try {
    await mkdir(serviceRoot, { recursive: true });
    await writeFile(keepAliveScript, "setInterval(() => {}, 1000);\n");
    child = spawn(process.execPath, [keepAliveScript], {
      cwd: serviceRoot,
      stdio: "ignore",
      windowsHide: true,
    });

    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });

    await recordProcessOwnership(workspaceRoot, {
      ownerType: "service",
      ownerId: "@nginx",
      serviceId: "@nginx",
      pid: child.pid,
      ownerRoot: serviceRoot,
      lifecycleState: "running",
      source: "spawn",
    });

    const result = await stopDemoManagedProcesses({ servicesRoot, workspaceRoot });
    assert.ok(result.lifecycle.stoppedServices.includes("@nginx"));
    assert.equal(processIsAlive(child.pid), false);
  } finally {
    if (child && processIsAlive(child.pid)) {
      child.kill("SIGKILL");
    }
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
  const readyServices = canonicalDemoRequiredServiceIds.map((serviceId) => ({
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
          services: canonicalDemoRequiredServiceIds.map((serviceId) => ({
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

test("demo options default to the canonical runtime port instead of NGINX 18080", () => {
  const previousPort = process.env.SERVICE_LASSO_PORT;
  delete process.env.SERVICE_LASSO_PORT;

  try {
    const options = resolveDemoOptions([]);

    assert.equal(options.port, canonicalDemoRuntimePort);
    assert.equal(options.port, 17883);
    assert.equal(options.runtimeUrl, "http://127.0.0.1:17883");
    assert.equal(resolveDemoRuntimePort(undefined, {}), 17883);
    assert.equal(resolveDemoRuntimePort("17883", {}), 17883);
    assert.equal(resolveDemoRuntimePort(0, {}), 0);
    assert.equal(resolveDemoRuntimePort("0", {}), 0);
    assert.notEqual(options.port, 18080);
    const runtimeAppOptions = buildDemoRuntimeAppOptions({
      servicesRoot: path.join(os.tmpdir(), "demo-services"),
      workspaceRoot: path.join(os.tmpdir(), "demo-workspace"),
    });
    assert.equal(runtimeAppOptions.port, 17883);
    assert.equal(runtimeAppOptions.portPolicy, "preferred");
    const automaticAppOptions = buildDemoRuntimeAppOptions({
      servicesRoot: path.join(os.tmpdir(), "demo-services"),
      workspaceRoot: path.join(os.tmpdir(), "demo-workspace"),
      port: 0,
    });
    assert.equal(automaticAppOptions.port, 0);
    assert.equal(automaticAppOptions.portPolicy, "automatic");
  } finally {
    if (previousPort === undefined) {
      delete process.env.SERVICE_LASSO_PORT;
    } else {
      process.env.SERVICE_LASSO_PORT = previousPort;
    }
  }
});

test("demo watchdog requires parameterized network identity and propagates it to recovery", () => {
  assert.throws(
    () => resolveWatchdogOptions([], {}),
    /requires --bind-host=<bind-host>/,
  );
  assert.throws(
    () => resolveWatchdogOptions(["--bind-host=0.0.0.0"], {}),
    /requires --host=<client-visible-host>/,
  );

  const options = resolveWatchdogOptions([
    "--bind-host=0.0.0.0",
    "--host=demo.example.test",
  ], {});
  assert.equal(options.runtimePort, 17883);
  assert.equal(options.runtimeUrl, "http://demo.example.test:17883");
  assert.equal(options.serviceAdminUrl, "http://demo.example.test:17700/");
  assert.equal(options.runtimeHealthUrl, "http://demo.example.test:17883/api/health");
  assert.equal(options.legacySchedulerLockPath, path.resolve(".demo-logs", "watchdog.lock"));

  const recovery = buildRecoveryCommand(options);
  assert.deepEqual(recovery.args, [
    "run",
    "demo:recycle",
    "--",
    "--port=17883",
    "--host=0.0.0.0",
    "--runtime-url=http://demo.example.test:17883",
    "--admin-url=http://demo.example.test:17700/",
  ]);
  assert.equal(recovery.env.SERVICE_LASSO_PORT, "17883");
  assert.equal(recovery.env.SERVICE_LASSO_HOST, "0.0.0.0");
  assert.equal(recovery.env.SERVICE_LASSO_RUNTIME_URL, "http://demo.example.test:17883");
  assert.equal(recovery.env.SERVICE_LASSO_ADMIN_URL, "http://demo.example.test:17700/");
  assert.equal(recovery.env.SERVICE_LASSO_DEMO_RECOVERY_LOCK_HELD, "1");
});

test("demo watchdog accepts complete explicit URLs without a shared client host", () => {
  const options = resolveWatchdogOptions([
    "--bind-host=127.0.0.1",
    "--runtime-url=http://runtime.demo.test:17883",
    "--service-admin-url=http://admin.demo.test:17700/",
  ], {});

  assert.equal(options.runtimeUrl, "http://runtime.demo.test:17883");
  assert.equal(options.serviceAdminUrl, "http://admin.demo.test:17700/");
  assert.equal(options.runtimeHealthUrl, "http://runtime.demo.test:17883/api/health");
});

test("canonical demo verifier requires a host or complete explicit URLs", () => {
  assert.throws(
    () => resolveCanonicalVerifierOptions([], {}),
    /requires --host=<client-visible-host>/,
  );

  const options = resolveCanonicalVerifierOptions(["--host=demo.example.test"], {});
  assert.equal(options.runtimePort, canonicalRuntimePort);
  assert.equal(options.serviceAdminPort, canonicalServiceAdminPort);
  assert.equal(options.runtimeUrl, "http://demo.example.test:17883");
  assert.equal(options.serviceAdminUrl, "http://demo.example.test:17700/");
  assert.equal(options.runtimeHealthUrl, "http://demo.example.test:17883/api/health");
  assert.equal(options.servicesRoot, canonicalDemoServicesRoot);

  const explicit = resolveCanonicalVerifierOptions([
    "--runtime-url=http://runtime.demo.test:17883",
    "--service-admin-url=http://admin.demo.test:17700/",
  ], {});
  assert.equal(explicit.runtimeUrl, "http://runtime.demo.test:17883");
  assert.equal(explicit.serviceAdminUrl, "http://admin.demo.test:17700/");
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
        runtimeUrl: "http://demo.example.test:17883",
        serviceAdminUrl: "http://demo.example.test:17700/",
      },
      { fetch: canonicalFetch({ servicesRoot, workspaceRoot }) },
    );

    assert.equal(result.ok, true);
    assert.equal(result.failures.length, 0);
    assert.equal(result.summary.services.length, canonicalFixtureServices.length);
    assert.deepEqual(result.summary.mcp, {
      endpoint: "http://demo.example.test:17883/api/mcp",
      protocolVersion: "2025-11-25",
      supportedProtocolVersions: ["2025-11-25", "2024-11-05"],
      sdkVersion: "1.30.0",
      operatingMode: "guarded",
      toolCount: 3,
      resourceCount: 1,
      representativeReads: true,
      guardedAction: {
        exercised: true,
        status: "succeeded",
        replayStatus: "replayed",
        exactlyOnce: true,
        terminalState: "running",
      },
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("canonical demo verifier discovers only the active workspace generation endpoint", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-canonical-generation-"));
  const servicesRoot = path.join(tempDir, "services");
  const workspaceRoot = path.join(tempDir, "workspace", "demo-instance");
  const stateDirectory = path.join(workspaceRoot, ".service-lasso");
  const generationId = "11111111-1111-4111-8111-111111111111";
  const runtimeUrl = "http://demo.example.test:17883";

  try {
    await writeCanonicalFixtureManifests(servicesRoot);
    await mkdir(stateDirectory, { recursive: true });
    await writeFile(path.join(stateDirectory, "runtime-instance.json"), `${JSON.stringify({
      generationId,
      servicesRoot,
      workspaceRoot,
      phase: "running",
      status: "active",
      apiUrl: runtimeUrl,
    }, null, 2)}\n`);
    await writeFile(path.join(stateDirectory, "runtime-generations.json"), `${JSON.stringify({
      version: 1,
      activeGenerationId: generationId,
      generations: [{
        generationId,
        servicesRoot,
        workspaceRoot,
        phase: "running",
        endpoints: [{ name: "api", url: runtimeUrl }],
      }],
    }, null, 2)}\n`);

    const result = await verifyCanonicalDemo(
      { servicesRoot, workspaceRoot, serviceAdminUrl: "http://demo.example.test:17700/" },
      { fetch: canonicalFetch({ servicesRoot, workspaceRoot, generationId }) },
    );

    assert.equal(result.ok, true);
    assert.equal(result.summary.runtimeUrl, runtimeUrl);
    assert.equal(result.summary.generationId, generationId);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("canonical demo verifier unwraps v2 runtime-instance envelopes for generation lane checks", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-canonical-v2-instance-"));
  const servicesRoot = path.join(tempDir, "services");
  const workspaceRoot = path.join(tempDir, "workspace", "demo-instance");
  const stateDirectory = path.join(workspaceRoot, ".service-lasso");
  const generationId = "44444444-4444-4444-8444-444444444444";
  const runtimeUrl = "http://demo.example.test:17883";

  try {
    await writeCanonicalFixtureManifests(servicesRoot);
    await mkdir(stateDirectory, { recursive: true });
    await writeFile(path.join(stateDirectory, "runtime-instance.json"), `${JSON.stringify({
      schemaVersion: "service-lasso.runtime-instance.v2",
      version: 2,
      instance: {
        generationId,
        servicesRoot,
        workspaceRoot,
        phase: "running",
        status: "active",
        apiUrl: runtimeUrl,
      },
    }, null, 2)}\n`);
    await writeFile(path.join(stateDirectory, "runtime-generations.json"), `${JSON.stringify({
      version: 1,
      activeGenerationId: generationId,
      generations: [{
        generationId,
        servicesRoot,
        workspaceRoot,
        phase: "running",
        endpoints: [{ name: "api", url: runtimeUrl }],
      }],
    }, null, 2)}\n`);

    const result = await verifyCanonicalDemo(
      { servicesRoot, workspaceRoot, serviceAdminUrl: "http://demo.example.test:17700/" },
      { fetch: canonicalFetch({ servicesRoot, workspaceRoot, generationId }) },
    );

    assert.equal(result.ok, true, JSON.stringify(result.failures, null, 2));
    assert.equal(result.summary.runtimeUrl, runtimeUrl);
    assert.equal(result.summary.generationId, generationId);
    assert.equal(result.failures.some((failure) => failure.code === "wrong_lane"), false);
    assert.equal(result.failures.some((failure) => failure.code === "stale_runtime_generation"), false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("canonical demo verifier reports mcp_unavailable instead of throwing when MCP initialize fails", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-canonical-mcp-unavailable-"));
  const servicesRoot = path.join(tempDir, "services");
  const workspaceRoot = path.join(tempDir, "workspace", "demo-instance");

  try {
    await writeCanonicalFixtureManifests(servicesRoot);
    const baseFetch = canonicalFetch({ servicesRoot, workspaceRoot });
    const result = await verifyCanonicalDemo(
      {
        servicesRoot,
        workspaceRoot,
        runtimeUrl: "http://demo.example.test:17883",
        serviceAdminUrl: "http://demo.example.test:17700/",
      },
      {
        fetch: async (url, options) => {
          const parsed = new URL(url);
          if (parsed.pathname === "/api/mcp") {
            throw new Error("fetch failed");
          }
          return baseFetch(url, options);
        },
      },
    );

    assert.equal(result.ok, false);
    assert.ok(result.failures.some((failure) => failure.code === "mcp_unavailable"));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("canonical demo verifier uses selected loopback metadata when LAN runtime API is protected", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-canonical-lan-auth-"));
  const servicesRoot = path.join(tempDir, "services");
  const workspaceRoot = path.join(tempDir, "workspace", "demo-instance");
  const stateDirectory = path.join(workspaceRoot, ".service-lasso");
  const generationId = "22222222-2222-4222-8222-222222222222";
  const loopbackRuntimeUrl = "http://127.0.0.1:17883";

  try {
    await writeCanonicalFixtureManifests(servicesRoot);
    await mkdir(stateDirectory, { recursive: true });
    await writeFile(path.join(stateDirectory, "runtime-instance.json"), `${JSON.stringify({
      generationId,
      servicesRoot,
      workspaceRoot,
      phase: "running",
      status: "active",
      apiUrl: loopbackRuntimeUrl,
    }, null, 2)}\n`);
    await writeFile(path.join(stateDirectory, "runtime-generations.json"), `${JSON.stringify({
      version: 1,
      activeGenerationId: generationId,
      generations: [{
        generationId,
        servicesRoot,
        workspaceRoot,
        phase: "running",
        endpoints: [{ name: "api", url: loopbackRuntimeUrl }],
      }],
    }, null, 2)}\n`);

    const baseFetch = canonicalFetch({ servicesRoot, workspaceRoot, generationId });
    const result = await verifyCanonicalDemo(
      {
        servicesRoot,
        workspaceRoot,
        runtimeUrl: "http://demo.example.test:17883",
        serviceAdminUrl: "http://demo.example.test:17700/",
      },
      {
        fetch: async (url, options) => {
          const parsed = new URL(url);
          if (parsed.hostname === "demo.example.test" && parsed.port === "17883" && ["/api/runtime", "/api/runtime/instance", "/api/services"].includes(parsed.pathname)) {
            return jsonResponse(401, { error: "remote_auth_required" });
          }
          return baseFetch(url, options);
        },
      },
    );

    assert.equal(result.ok, true, JSON.stringify(result.failures, null, 2));
    assert.equal(result.summary.runtimeUrl, "http://demo.example.test:17883");
    assert.equal(result.summary.generationId, generationId);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("canonical demo verifier accepts source Admin owning the canonical Service Admin port", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-canonical-demo-"));
  const servicesRoot = path.join(tempDir, "services");
  const workspaceRoot = path.join(tempDir, "workspace", "demo-instance");

  try {
    await writeCanonicalFixtureManifests(servicesRoot);

    const result = await verifyCanonicalDemo(
      {
        servicesRoot,
        workspaceRoot,
        runtimeUrl: "http://demo.example.test:17883",
        serviceAdminUrl: "http://demo.example.test:17700/",
      },
      { fetch: canonicalFetch({ servicesRoot, workspaceRoot, sourceServiceAdmin: true }) },
    );

    assert.equal(result.ok, true);
    assert.equal(result.failures.length, 0);
    assert.ok(result.checks.some((entry) => entry.name === "@serviceadmin source Admin owns canonical port" && entry.ok));
    assert.ok(result.checks.some((entry) => entry.name === "@serviceadmin advertised ui reachable through source Admin" && entry.ok));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("canonical demo verifier accepts seeded source Admin manifest state", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-canonical-demo-seeded-admin-"));
  const servicesRoot = path.join(tempDir, "services");
  const workspaceRoot = path.join(tempDir, "workspace", "demo-instance");

  try {
    await writeCanonicalFixtureManifests(servicesRoot);

    const result = await verifyCanonicalDemo(
      {
        servicesRoot,
        workspaceRoot,
        runtimeUrl: "http://demo.example.test:17883",
        serviceAdminUrl: "http://demo.example.test:17700/",
      },
      { fetch: canonicalFetch({ servicesRoot, workspaceRoot, sourceServiceAdmin: true, sourceServiceAdminSeeded: true }) },
    );

    assert.equal(result.ok, true);
    assert.equal(result.failures.length, 0);
    assert.ok(result.checks.some((entry) => entry.name === "@serviceadmin managed artifact may be seeded" && entry.ok));
    assert.ok(result.checks.some((entry) => entry.name === "@serviceadmin managed artifact intentionally not running" && entry.ok));
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
        runtimeUrl: "http://demo.example.test:18080",
        serviceAdminUrl: "http://demo.example.test:17700/",
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

test("canonical demo verifier rejects a healthy runtime from another generation", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "service-lasso-generation-lane-"));
  const servicesRoot = path.join(tempDir, "services");
  const workspaceRoot = path.join(tempDir, "workspace", "demo-instance");
  const expectedGenerationId = "22222222-2222-4222-8222-222222222222";

  try {
    await writeCanonicalFixtureManifests(servicesRoot);
    const result = await verifyCanonicalDemo(
      {
        servicesRoot,
        workspaceRoot,
        generationId: expectedGenerationId,
        runtimeUrl: "http://demo.example.test:17883",
        serviceAdminUrl: "http://demo.example.test:17700/",
      },
      {
        fetch: canonicalFetch({
          servicesRoot,
          workspaceRoot,
          generationId: "33333333-3333-4333-8333-333333333333",
        }),
      },
    );

    assert.equal(result.ok, false);
    assert.ok(result.failures.some((failure) =>
      failure.name === "runtime generation matches explicit selector" && failure.code === "wrong_lane",
    ));
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
    const [servicePort, healthPort, tcpHealthPort] = await allocateLoopbackPorts(3);
    const echoManifestPath = path.join(servicesRoot, "echo-service", "service.json");
    const echoManifest = JSON.parse(await readFile(echoManifestPath, "utf8"));
    echoManifest.ports = {
      ...echoManifest.ports,
      service: servicePort,
      health: healthPort,
      tcp_health: tcpHealthPort,
    };
    await writeFile(echoManifestPath, `${JSON.stringify(echoManifest, null, 2)}\n`);

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
    assert.match(result.stdout, /setup-required: node-sample-service/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
