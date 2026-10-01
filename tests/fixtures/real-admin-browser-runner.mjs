import { execFile, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
const sourceBrokerBinaryInput = process.env.SERVICE_LASSO_TEST_BROKER_BINARY;
const adminRootInput = process.env.SERVICE_LASSO_TEST_ADMIN_ROOT;
if (!sourceBrokerBinaryInput || !adminRootInput)
  throw new Error("Broker binary and Admin root are required.");
const sourceBrokerBinary = path.resolve(sourceBrokerBinaryInput);
const adminRoot = path.resolve(adminRootInput);

function requireCallerRuntimePath(name) {
  const value = process.env[name];
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim()
  ) {
    throw new Error(`${name} must name a caller-created runtime path.`);
  }
  return path.resolve(value);
}

function requireHexIdentity(name, length) {
  const value = process.env[name];
  if (
    typeof value !== "string" ||
    !new RegExp(`^[a-f0-9]{${length}}$`, "i").test(value)
  )
    throw new Error(
      `${name} must be an exact caller-supplied source identity.`,
    );
  return value.toLowerCase();
}

async function sha256File(filePath) {
  return `sha256:${createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex")}`;
}

async function observeOwnedProcess(pid, expectedParentPid) {
  let observed;
  if (process.platform === "win32") {
    const command = `Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\" | Select-Object ProcessId,ParentProcessId,CreationDate,ExecutablePath | ConvertTo-Json -Compress`;
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
      { windowsHide: true },
    );
    observed = JSON.parse(stdout);
    observed = {
      pid: observed.ProcessId,
      parentPid: observed.ParentProcessId,
      birth: observed.CreationDate,
      executable: observed.ExecutablePath,
    };
  } else {
    const { stdout } = await execFileAsync("ps", [
      "-o",
      "ppid=",
      "-o",
      "lstart=",
      "-p",
      String(pid),
    ]);
    const match = stdout.trim().match(/^(\d+)\s+(.+)$/u);
    if (!match)
      throw new Error("OS process observation returned no owned process.");
    observed = {
      pid,
      parentPid: Number(match[1]),
      birth: match[2],
      executable: null,
    };
  }
  if (
    !Number.isInteger(observed.pid) ||
    observed.pid !== pid ||
    observed.parentPid !== expectedParentPid ||
    typeof observed.birth !== "string" ||
    observed.birth.length === 0
  )
    throw new Error(
      "OS process observation did not prove the expected owned parent edge.",
    );
  return observed;
}

function rootsOverlap(left, right) {
  const relative = path.relative(left, right);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== "..")
  );
}

const workspaceRoot = requireCallerRuntimePath("SERVICE_LASSO_WORKSPACE_ROOT");
const instanceRegistryPath = requireCallerRuntimePath(
  "SERVICE_LASSO_INSTANCE_REGISTRY_PATH",
);
const hostPortRegistryPath = requireCallerRuntimePath(
  "SERVICE_LASSO_HOST_PORT_REGISTRY_PATH",
);
const servicesRoot = requireCallerRuntimePath(
  "SERVICE_LASSO_TEST_SERVICES_ROOT",
);
const evidenceRoot = requireCallerRuntimePath(
  "SERVICE_LASSO_TEST_EVIDENCE_ROOT",
);
const supportRoot = requireCallerRuntimePath("SERVICE_LASSO_TEST_SUPPORT_ROOT");
const sourceHead = requireHexIdentity("SERVICE_LASSO_TEST_SOURCE_HEAD", 40);
const sourceTree = requireHexIdentity("SERVICE_LASSO_TEST_SOURCE_TREE", 40);
for (const root of [workspaceRoot, servicesRoot, evidenceRoot, supportRoot]) {
  const metadata = await lstat(root).catch(() => null);
  if (!metadata?.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(
      "Caller runtime directories must already exist and cannot be links.",
    );
  }
}
for (const filePath of [instanceRegistryPath, hostPortRegistryPath]) {
  const parent = await lstat(path.dirname(filePath)).catch(() => null);
  const existing = await lstat(filePath).catch(() => null);
  if (!parent?.isDirectory() || parent.isSymbolicLink() || existing) {
    throw new Error(
      "Caller runtime registry paths must be absent beneath direct caller-owned directories.",
    );
  }
}
for (const [left, right] of [
  [workspaceRoot, instanceRegistryPath],
  [workspaceRoot, hostPortRegistryPath],
  [instanceRegistryPath, hostPortRegistryPath],
  [workspaceRoot, servicesRoot],
  [workspaceRoot, evidenceRoot],
  [servicesRoot, evidenceRoot],
  [workspaceRoot, supportRoot],
  [servicesRoot, supportRoot],
  [evidenceRoot, supportRoot],
]) {
  if (rootsOverlap(left, right) || rootsOverlap(right, left)) {
    throw new Error(
      "Caller runtime paths must be distinct and non-overlapping.",
    );
  }
}

const runnerIdentity = await observeOwnedProcess(process.pid, process.ppid);
const initialReceiptPath = path.join(evidenceRoot, "live-initial-receipt.json");
const closureReceiptPath = path.join(evidenceRoot, "live-closure-receipt.json");
const providerReceiptPath = path.join(
  evidenceRoot,
  "live-provider-control-receipt.json",
);
const receiptNonce = randomBytes(32).toString("hex");
const initialReceipt = {
  schema: "service-lasso.real-admin-browser-live-initial.v1",
  private: true,
  nonce: receiptNonce,
  source: { head: sourceHead, tree: sourceTree },
  inputs: {
    workspaceRoot,
    instanceRegistryPath,
    hostPortRegistryPath,
    servicesRoot,
    evidenceRoot,
    supportRoot,
  },
  runtimeAssets: {
    brokerBinary: { sha256: await sha256File(sourceBrokerBinary) },
    adminServer: {
      sha256: await sha256File(path.join(adminRoot, "runtime", "server.js")),
    },
  },
  ownedProcesses: { runner: runnerIdentity },
};
await writeFile(initialReceiptPath, JSON.stringify(initialReceipt), {
  mode: 0o600,
});

// Validate explicit caller custody before importing Core runtime or fixture
// helpers. This runner has no temp-root fallback for the three live Core
// paths; callers must establish and pass the exact workspace and registries.
const { generateLocalhostCertificate } =
  await import("./real-admin-browser-certificate.mjs");
const { discoverServices } =
  await import("../../dist/runtime/discovery/discoverServices.js");
const {
  bootstrapSecretsBrokerVault,
  loadSecretsBrokerRuntimeContext,
  provisionFirstRunGeneratedSecrets,
  readSecretsBrokerRuntimeCredentials,
} = await import("../../dist/runtime/broker/runtime.js");
const { stopAllManagedProcesses } =
  await import("../../dist/runtime/execution/supervisor.js");
const { getLifecycleState, resetLifecycleState, setLifecycleState } =
  await import("../../dist/runtime/lifecycle/store.js");
const { createServiceRegistry } =
  await import("../../dist/runtime/manager/DependencyGraph.js");
const { writeServiceState } =
  await import("../../dist/runtime/state/writeState.js");
const { startApiServer } = await import("../../dist/server/index.js");
const {
  BROKER_LOCKOUT_INVALID_ATTEMPTS,
  BrokerLockoutFixtureError,
  classifyBrokerLockoutAttempt,
  createSafeLockoutFixtureDiagnostic,
  requestBrokerLockoutWithToken,
} = await import("./real-admin-browser-lockout.mjs");
const {
  createSafeRealAdminBrowserTeardownFailure,
  teardownRealAdminBrowserFixture,
} = await import("./real-admin-browser-shutdown.mjs");
const {
  createRealAdminBrowserSampleSource,
  FAIL_NEXT_SAMPLE_START_ENV,
  FAIL_NEXT_SAMPLE_START_PATH,
  handleFailNextSampleStartRequest,
  SAMPLE_READINESS_PORT_ENV,
} = await import("./real-admin-browser-rollback.mjs");
const { writeManifest } = await import("../test-helpers.js");

const tempRoot = supportRoot;
const sampleRoot = path.join(servicesRoot, "sample-service");
const sampleStartFailureMarker = path.join(
  workspaceRoot,
  ".service-lasso",
  "test-fixtures",
  "sample-start-failure.once",
);
const brokerBinary = path.join(tempRoot, "secretsbroker.exe");
const brokerSourcesPath = path.join(tempRoot, "broker-sources.json");
const brokerWrapperPath = path.join(
  workspaceRoot,
  ".service-lasso",
  "secretsbroker",
  "master-key-wrapper.json",
);
const lockedBrokerWrapperPath = `${brokerWrapperPath}.locked-fixture`;
const browserVaultToken = "browser-vault-token-sentinel-2026-08-14";
const qualificationMode = ["first-run", "lockout"].includes(
  process.env.SERVICE_LASSO_REAL_BROWSER_MODE,
)
  ? process.env.SERVICE_LASSO_REAL_BROWSER_MODE
  : "comprehensive";
let apiServer = null;
let adminProcess = null;
let vaultServer = null;
let vaultProviderServer = null;
let brokerRuntimeCredentials = null;
let shutdownPromise = null;
let startupPhase = "initializing";
const brokerIPCClient = new http.Agent({ keepAlive: true, maxSockets: 1 });
let providerFaultState = "not_armed";
let providerControlReceipt = null;

async function persistProviderControlReceipt(phase) {
  if (providerControlReceipt) return providerControlReceipt;
  providerControlReceipt = {
    schema: "service-lasso.real-admin-browser-provider-control.v1",
    private: true,
    nonce: receiptNonce,
    source: { head: sourceHead, tree: sourceTree },
    phase,
    causalSink: "authenticated_vault_provider_request",
    state: "observed_before_controlled_fault",
  };
  await writeFile(providerReceiptPath, JSON.stringify(providerControlReceipt), {
    mode: 0o600,
  });
  return providerControlReceipt;
}

function safeFailureCode(error) {
  if (
    error &&
    typeof error === "object" &&
    typeof error.code === "string" &&
    /^[a-z0-9_]{1,64}$/i.test(error.code)
  ) {
    return error.code.toLowerCase();
  }
  const message = error instanceof Error ? error.message : "";
  if (/Setup bootstrap returned/u.test(message))
    return "setup_bootstrap_failed";
  if (/Broker was not ready/u.test(message)) return "broker_not_ready";
  if (/linked secret consumer failed to start/u.test(message))
    return "linked_consumer_start_failed";
  if (/linked secret consumer was not discovered/u.test(message))
    return "linked_consumer_missing";
  if (/inventory was not visible/u.test(message))
    return "broker_inventory_unavailable";
  if (/Timed out waiting/u.test(message)) return "runtime_readiness_timeout";
  return "real_admin_browser_start_failed";
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function reservePort() {
  const server = http.createServer();
  const port = await listen(server);
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function waitFor(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${new URL(url).pathname}`);
}

function shutdown(exitCode = 0) {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    let resolvedExitCode = exitCode;
    try {
      const teardown = await teardownRealAdminBrowserFixture({
        adminProcess,
        apiServer,
        stopManagedProcesses: stopAllManagedProcesses,
        brokerIPCClient,
        vaultServer,
        vaultProviderServer,
        resetLifecycle: resetLifecycleState,
        tempRoot,
      });
      await writeFile(
        closureReceiptPath,
        JSON.stringify({
          schema: "service-lasso.real-admin-browser-live-closure.v1",
          private: true,
          nonce: receiptNonce,
          source: { head: sourceHead, tree: sourceTree },
          outcome: "closed",
          teardown,
          providerFault:
            providerFaultState === "observed" ? "consumed" : "unresolved",
        }),
        { mode: 0o600 },
      );
    } catch (error) {
      resolvedExitCode = 1;
      const failure = createSafeRealAdminBrowserTeardownFailure(error);
      await writeFile(
        closureReceiptPath,
        JSON.stringify({
          schema: "service-lasso.real-admin-browser-live-closure.v1",
          private: true,
          nonce: receiptNonce,
          source: { head: sourceHead, tree: sourceTree },
          outcome: "unresolved",
          failure,
          providerFault:
            providerFaultState === "observed" ? "consumed" : "unresolved",
        }),
        { mode: 0o600 },
      );
      await new Promise((resolve) => {
        process.stderr.write(`${JSON.stringify(failure)}\n`, resolve);
      });
    }
    process.exit(resolvedExitCode);
  })();
  return shutdownPromise;
}

process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));
process.on("message", (message) => {
  if (message?.type === "service-lasso-real-admin-shutdown") void shutdown(0);
});

try {
  startupPhase = "workspace_setup";
  await mkdir(servicesRoot, { recursive: true });
  await mkdir(workspaceRoot, { recursive: true });
  const vaultValues = new Map();
  const certificate = generateLocalhostCertificate();
  const vaultCertificatePath = path.join(tempRoot, "vault-test-ca.pem");
  await writeFile(vaultCertificatePath, certificate.cert, { mode: 0o600 });
  const vaultCertificateSHA256 = `sha256:${createHash("sha256")
    .update(certificate.cert)
    .digest("hex")}`;
  const handleVaultRequest = async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const controlRequest = requestUrl.pathname.startsWith(
      "/__service_lasso_test",
    );
    const encrypted = request.socket.encrypted === true;
    if ((encrypted && controlRequest) || (!encrypted && !controlRequest)) {
      response.writeHead(404);
      response.end();
      return;
    }
    if (requestUrl.pathname === FAIL_NEXT_SAMPLE_START_PATH) {
      await handleFailNextSampleStartRequest(
        request,
        response,
        sampleStartFailureMarker,
      );
      return;
    }
    if (requestUrl.pathname === "/__service_lasso_test/lock-wrapper") {
      if (request.method !== "POST") {
        response.writeHead(405, { Allow: "POST" });
        response.end();
        return;
      }
      try {
        await rename(brokerWrapperPath, lockedBrokerWrapperPath);
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ outcome: "locked_fixture_ready" }));
      } catch {
        response.writeHead(409, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ outcome: "locked_fixture_failed" }));
      }
      return;
    }
    if (
      requestUrl.pathname === "/__service_lasso_test/fail-next-provider-request"
    ) {
      if (request.method !== "POST") {
        response.writeHead(405, { Allow: "POST" });
        response.end();
        return;
      }
      if (providerFaultState !== "not_armed") {
        response.writeHead(409, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ outcome: "provider_fault_unavailable" }));
        return;
      }
      if (!providerControlReceipt) {
        response.writeHead(409, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ outcome: "provider_fault_unobserved" }));
        return;
      }
      providerFaultState = "armed";
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ outcome: "provider_fault_armed" }));
      return;
    }
    if (
      requestUrl.pathname === "/__service_lasso_test/provider-fault-receipt"
    ) {
      if (request.method !== "GET") {
        response.writeHead(405, { Allow: "GET" });
        response.end();
        return;
      }
      response.writeHead(providerFaultState === "observed" ? 200 : 409, {
        "Content-Type": "application/json",
      });
      response.end(
        JSON.stringify({
          outcome:
            providerFaultState === "observed"
              ? "provider_fault_observed"
              : "provider_fault_unobserved",
          receipt:
            providerFaultState === "observed"
              ? {
                  schema: providerControlReceipt?.schema,
                  phase: providerControlReceipt?.phase,
                  nonce: providerControlReceipt?.nonce,
                }
              : null,
        }),
      );
      return;
    }
    if (requestUrl.pathname === "/__service_lasso_test/unlock-wrapper") {
      if (request.method !== "POST") {
        response.writeHead(405, { Allow: "POST" });
        response.end();
        return;
      }
      try {
        await rename(lockedBrokerWrapperPath, brokerWrapperPath);
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ outcome: "wrapper_restored" }));
      } catch {
        response.writeHead(409, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ outcome: "wrapper_restore_failed" }));
      }
      return;
    }
    if (
      requestUrl.pathname === "/__service_lasso_test/induce-local-api-lockout"
    ) {
      if (request.method !== "POST") {
        response.writeHead(405, { Allow: "POST" });
        response.end();
        return;
      }
      brokerRuntimeCredentials ??=
        await readSecretsBrokerRuntimeCredentials(workspaceRoot);
      if (!brokerRuntimeCredentials) {
        response.writeHead(409, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({ outcome: "broker_credentials_unavailable" }),
        );
        return;
      }
      const lockoutDiagnostic = {
        phase: "readiness",
        attempt: null,
        statusCode: null,
      };
      try {
        let brokerIPCReady = false;
        for (let attempt = 0; attempt < 40 && !brokerIPCReady; attempt += 1) {
          lockoutDiagnostic.attempt = attempt + 1;
          lockoutDiagnostic.statusCode = null;
          try {
            const readiness = await requestBrokerLockoutWithToken(
              brokerRuntimeCredentials,
              brokerRuntimeCredentials.apiToken,
              { agent: brokerIPCClient },
            );
            lockoutDiagnostic.statusCode = readiness.statusCode;
            brokerIPCReady = readiness.statusCode === 200;
          } catch {}
          if (!brokerIPCReady) {
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
        }
        if (!brokerIPCReady) {
          throw new BrokerLockoutFixtureError(
            "broker_ipc_not_ready",
            "Broker IPC did not become ready for lockout qualification.",
          );
        }
        lockoutDiagnostic.phase = "invalid_attempt";
        let lockoutScope = null;
        for (
          let attempt = 1;
          attempt <= BROKER_LOCKOUT_INVALID_ATTEMPTS;
          attempt += 1
        ) {
          lockoutDiagnostic.attempt = attempt;
          lockoutDiagnostic.statusCode = null;
          const result = await requestBrokerLockoutWithToken(
            brokerRuntimeCredentials,
            `invalid-browser-lockout-token-${attempt - 1}`,
            { agent: brokerIPCClient },
          );
          lockoutDiagnostic.statusCode = result.statusCode;
          const classification = classifyBrokerLockoutAttempt(result, attempt);
          if (classification.state === "locked")
            lockoutScope = classification.lockoutScope;
        }
        if (!lockoutScope)
          throw new BrokerLockoutFixtureError(
            "broker_lockout_contract_mismatch",
            "Broker did not enter the expected scoped local API lockout.",
          );
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({ outcome: "lockout_active", lockoutScope }),
        );
      } catch (error) {
        response.writeHead(409, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            outcome: "lockout_fixture_failed",
            diagnostic: createSafeLockoutFixtureDiagnostic(
              error,
              lockoutDiagnostic,
            ),
          }),
        );
      }
      return;
    }
    if (request.headers["x-vault-token"] !== browserVaultToken) {
      response.writeHead(403, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ errors: ["access denied"] }));
      return;
    }
    await persistProviderControlReceipt("authenticated_provider_request");
    if (providerFaultState === "armed") {
      providerFaultState = "observed";
      response.writeHead(503, { "Content-Type": "application/json" });
      await writeFile(
        providerReceiptPath,
        JSON.stringify({
          ...providerControlReceipt,
          state: "controlled_fault_consumed",
          causalSink: "next_authenticated_vault_provider_request",
        }),
        { mode: 0o600 },
      );
      response.end(
        JSON.stringify({ errors: ["provider fixture unavailable"] }),
      );
      return;
    }
    if (!requestUrl.pathname.startsWith("/v1/secret/data/browser/")) {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ errors: ["not found"] }));
      return;
    }
    if (requestUrl.pathname.endsWith("/unavailable")) {
      response.writeHead(503, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ errors: ["provider unavailable"] }));
      return;
    }
    const stored = vaultValues.get(requestUrl.pathname);
    if (request.method === "GET") {
      if (!stored) {
        response.writeHead(404, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ errors: ["not found"] }));
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          data: { data: stored.data, metadata: { version: stored.version } },
        }),
      );
      return;
    }
    if (request.method === "POST") {
      if (requestUrl.pathname.endsWith("/policy-denied")) {
        response.writeHead(403, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ errors: ["policy denied"] }));
        return;
      }
      const chunks = [];
      let byteLength = 0;
      for await (const chunk of request) {
        byteLength += chunk.length;
        if (byteLength > 1_048_576) {
          response.writeHead(413, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ errors: ["request too large"] }));
          return;
        }
        chunks.push(chunk);
      }
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ errors: ["invalid json"] }));
        return;
      }
      const expectedVersion = stored?.version ?? 0;
      if (
        !body ||
        typeof body !== "object" ||
        !body.data ||
        typeof body.data !== "object" ||
        body.options?.cas !== expectedVersion
      ) {
        response.writeHead(409, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ errors: ["cas conflict"] }));
        return;
      }
      vaultValues.set(requestUrl.pathname, {
        data: structuredClone(body.data),
        version: expectedVersion + 1,
      });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ data: { version: expectedVersion + 1 } }));
      return;
    }
    response.writeHead(405, { Allow: "GET, POST" });
    response.end();
  };
  vaultServer = http.createServer(handleVaultRequest);
  vaultProviderServer = https.createServer(
    { key: certificate.private, cert: certificate.cert },
    handleVaultRequest,
  );
  const controlPort = await listen(vaultServer);
  const vaultPort = await listen(vaultProviderServer);
  await writeFile(
    brokerSourcesPath,
    JSON.stringify({
      sources: [
        {
          sourceId: "vault-browser",
          kind: "vault",
          displayName: "Browser qualification Vault",
          enabled: true,
          enableMigrationTarget: true,
          critical: false,
          priority: 50,
          namespaces: ["services/sample-service"],
          address: `https://127.0.0.1:${vaultPort}`,
          tokenEnv: "BROWSER_VAULT_TOKEN",
          refs: {
            "services/sample-service/sample.GENERATED_TOKEN": {
              path: "secret/data/browser/generated",
              field: "value",
              timeoutMs: 5_000,
              maxBytes: 1_048_576,
            },
          },
        },
        {
          sourceId: "vault-policy-denied",
          kind: "vault",
          displayName: "Vault policy denial fixture",
          enabled: true,
          enableMigrationTarget: true,
          critical: false,
          priority: 55,
          namespaces: ["services/sample-service"],
          address: `https://127.0.0.1:${vaultPort}`,
          tokenEnv: "BROWSER_VAULT_TOKEN",
          refs: {
            "services/sample-service/sample.GENERATED_TOKEN": {
              path: "secret/data/browser/policy-denied",
              field: "value",
              timeoutMs: 5_000,
              maxBytes: 1_048_576,
            },
          },
        },
        {
          sourceId: "vault-unavailable",
          kind: "vault",
          displayName: "Vault unavailable fixture",
          enabled: true,
          enableMigrationTarget: true,
          critical: false,
          priority: 56,
          namespaces: ["services/sample-service"],
          address: `https://127.0.0.1:${vaultPort}`,
          tokenEnv: "BROWSER_VAULT_TOKEN",
          refs: {
            "services/sample-service/sample.GENERATED_TOKEN": {
              path: "secret/data/browser/unavailable",
              field: "value",
              timeoutMs: 5_000,
              maxBytes: 1_048_576,
            },
          },
        },
        {
          sourceId: "vault-auth-required",
          kind: "vault",
          displayName: "Vault authentication required",
          enabled: true,
          enableMigrationTarget: true,
          critical: false,
          priority: 60,
          namespaces: ["qualification/auth-required"],
          address: `https://127.0.0.1:${vaultPort}`,
          tokenEnv: "BROWSER_MISSING_VAULT_TOKEN",
          refs: {
            "qualification/auth-required/value": {
              path: "secret/data/browser/auth-required",
              field: "value",
            },
          },
        },
        {
          sourceId: "vault-invalid",
          kind: "vault",
          displayName: "Vault invalid configuration",
          enabled: true,
          enableMigrationTarget: true,
          critical: false,
          priority: 70,
          namespaces: ["qualification/invalid"],
          tokenEnv: "BROWSER_VAULT_TOKEN",
          refs: {
            "qualification/invalid/value": {
              path: "secret/data/browser/invalid",
              field: "value",
            },
          },
        },
      ],
    }),
    { mode: 0o600 },
  );
  await copyFile(sourceBrokerBinary, brokerBinary);
  await writeManifest(servicesRoot, "@secretsbroker", {
    id: "@secretsbroker",
    name: "Secrets Broker",
    description: "Real browser qualification broker.",
    executable: brokerBinary,
    args: ["serve"],
    env: {
      SECRETSBROKER_MODE: "production",
      SECRETSBROKER_TRANSPORT: "auto",
      SECRETSBROKER_SOURCES_PATH: brokerSourcesPath,
      SECRETSBROKER_SOURCE_CA_FILE: vaultCertificatePath,
      SECRETSBROKER_SOURCE_CA_SHA256: vaultCertificateSHA256,
      BROWSER_VAULT_TOKEN: browserVaultToken,
    },
    healthcheck: { type: "process" },
  });
  await mkdir(path.join(sampleRoot, "runtime"), { recursive: true });
  await writeFile(
    path.join(sampleRoot, "runtime", "sample.mjs"),
    createRealAdminBrowserSampleSource(),
  );
  await writeManifest(servicesRoot, "sample-service", {
    id: "sample-service",
    name: "Sample Service",
    description: "Real browser qualification secret owner.",
    executable: process.execPath,
    args: ["runtime/sample.mjs"],
    env: {
      SAMPLE_REQUIRED_TOKEN: "${sample.GENERATED_TOKEN}",
      [FAIL_NEXT_SAMPLE_START_ENV]: sampleStartFailureMarker,
      [SAMPLE_READINESS_PORT_ENV]: "${READINESS_PORT}",
    },
    ports: { readiness: 0 },
    healthcheck: {
      type: "http",
      url: "http://127.0.0.1:${READINESS_PORT}/ready",
      expected_status: 200,
      retries: 10,
      interval: 100,
      timeout: 500,
    },
    broker: {
      imports: [
        {
          namespace: "services/sample-service",
          ref: "sample.GENERATED_TOKEN",
          as: "SAMPLE_REQUIRED_TOKEN",
          required: true,
          onChange: { mode: "restart" },
        },
      ],
      accessPolicy: {
        serviceId: "sample-service",
        workspace: "local",
        grants: [
          {
            namespace: "services/sample-service",
            scope: "service",
            refs: ["sample.GENERATED_TOKEN"],
            operations: ["resolve", "create"],
            purpose: "real browser qualification",
          },
        ],
      },
      writeback: {
        allowedNamespaces: ["services/sample-service"],
        allowedOperations: ["create"],
        allowedRefs: ["sample.GENERATED_TOKEN"],
        allowOverwrite: false,
        auditReason: "real browser qualification",
        generatedSecrets: [
          {
            ref: "sample.GENERATED_TOKEN",
            source: "${SAMPLE_REQUIRED_TOKEN}",
            operation: "create",
            required: true,
          },
        ],
      },
      exports: [
        {
          namespace: "services/sample-service",
          ref: "sample.GENERATED_TOKEN",
          source: "${SAMPLE_REQUIRED_TOKEN}",
          required: true,
        },
      ],
    },
  });

  resetLifecycleState();
  startupPhase = "service_discovery";
  const discovered = await discoverServices(servicesRoot);
  const registry = createServiceRegistry(discovered);
  for (const service of discovered) {
    const state = getLifecycleState(service.manifest.id);
    const prepared = {
      ...state,
      installed: true,
      // The sample's readiness port is allocated by startApiServer. Keep the
      // secret consumer unconfigured until the normal post-bootstrap start
      // path can materialize both that planned port and its required Broker
      // value together.
      configured: service.manifest.id !== "sample-service",
      installArtifacts:
        service.manifest.id === "@secretsbroker"
          ? {
              ...state.installArtifacts,
              artifact: {
                sourceType: "local-fixture",
                repo: null,
                channel: null,
                tag: null,
                assetName: path.basename(brokerBinary),
                assetUrl: null,
                archiveType: null,
                archivePath: null,
                extractedPath: path.dirname(brokerBinary),
                command: brokerBinary,
                args: ["serve"],
                checksum: null,
              },
            }
          : state.installArtifacts,
    };
    setLifecycleState(service.manifest.id, prepared);
    await writeServiceState(service, prepared);
  }

  if (qualificationMode !== "first-run") {
    startupPhase = "broker_bootstrap";
    await bootstrapSecretsBrokerVault(workspaceRoot, registry);
  }

  startupPhase = "api_start";
  apiServer = await startApiServer({
    port: 0,
    host: "127.0.0.1",
    servicesRoot,
    workspaceRoot,
    version: "real-admin-browser-qualification",
  });
  if (qualificationMode === "comprehensive") {
    startupPhase = "comprehensive_provisioning";
    const startResponse = await fetch(
      `${apiServer.url}/api/services/%40secretsbroker/start`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: false }),
      },
    );
    if (startResponse.status !== 200) {
      throw new Error(
        "Broker was not ready for comprehensive browser qualification.",
      );
    }
    const brokerRuntime = await loadSecretsBrokerRuntimeContext(
      workspaceRoot,
      registry,
    );
    let brokerReady = false;
    for (let attempt = 0; attempt < 40 && !brokerReady; attempt += 1) {
      brokerReady = (await brokerRuntime?.probe())?.ready === true;
      if (!brokerReady)
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!brokerReady || !brokerRuntime) {
      throw new Error(
        "Broker was not ready for comprehensive browser qualification.",
      );
    }
    const provisioned = await provisionFirstRunGeneratedSecrets(
      registry,
      brokerRuntime,
    );
    if (!provisioned.some((result) => result.serviceId === "sample-service")) {
      throw new Error(
        "Linked secret consumer failed to start with a provisioned secret.",
      );
    }
  }
  startupPhase = "admin_start";
  const adminPort = await reservePort();
  adminProcess = spawn(
    process.execPath,
    [path.join(adminRoot, "runtime", "server.js")],
    {
      cwd: adminRoot,
      env: {
        ...process.env,
        SERVICE_HOST: "127.0.0.1",
        SERVICE_PORT: String(adminPort),
        SERVICE_LASSO_API_BASE_URL: apiServer.url,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  adminProcess.stderr.on("data", (chunk) => process.stderr.write(chunk));
  startupPhase = "admin_readiness";
  await waitFor(`http://127.0.0.1:${adminPort}/`);
  if (typeof adminProcess.exitCode === "number") {
    throw Object.assign(
      new Error("Admin process exited after readiness HTTP success."),
      {
        code: "admin_startup_failed",
      },
    );
  }
  try {
    process.kill(adminProcess.pid, 0);
  } catch {
    throw Object.assign(
      new Error("Admin process was not owned after readiness HTTP success."),
      {
        code: "admin_startup_failed",
      },
    );
  }
  startupPhase = "ready";
  const adminIdentity = await observeOwnedProcess(
    adminProcess.pid,
    process.pid,
  );
  const liveReceipt = {
    ...initialReceipt,
    ownedProcesses: { runner: runnerIdentity, admin: adminIdentity },
    ownerCorrelation: {
      state: "observed",
      runnerPid: runnerIdentity.pid,
      adminPid: adminIdentity.pid,
      adminParentPid: adminIdentity.parentPid,
    },
  };
  await writeFile(initialReceiptPath, JSON.stringify(liveReceipt), {
    mode: 0o600,
  });
  const liveReceiptSHA256 = await sha256File(initialReceiptPath);
  process.stdout.write(
    `${JSON.stringify({
      contractVersion: "service-lasso.real-admin-browser.v2",
      platform: process.platform,
      adminUrl: `http://127.0.0.1:${adminPort}`,
      apiUrl: apiServer.url,
      controlUrl: `http://127.0.0.1:${controlPort}/__service_lasso_test`,
      ref: "services/sample-service/sample.GENERATED_TOKEN",
      tempRoot,
      liveReceipt: {
        schema: liveReceipt.schema,
        nonce: receiptNonce,
        initialPath: initialReceiptPath,
        initialSHA256: liveReceiptSHA256,
        closurePath: closureReceiptPath,
      },
    })}\n`,
  );
  setInterval(() => {}, 1_000);
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      schema: "service-lasso.real-admin-browser-failure.v1",
      code: safeFailureCode(error),
      causeClass: error instanceof Error ? error.name : "unknown",
      phase: startupPhase,
    })}\n`,
  );
  await shutdown(1);
}
