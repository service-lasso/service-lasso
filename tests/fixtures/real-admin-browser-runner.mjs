import { execFile, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  writeFile,
} from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import os from "node:os";
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

function exactKeys(value, keys) {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

async function requireProviderActivationGate(runner, source) {
  const root = process.env.SERVICE_LASSO_ADMIN_PROVIDER_OBSERVER_ROOT;
  const nonce = process.env.SERVICE_LASSO_ADMIN_PROVIDER_OBSERVER_NONCE;
  if (root === undefined && nonce === undefined) return;
  if (typeof root !== "string" || path.resolve(root) !== root || !/^[a-f0-9]{64}$/iu.test(nonce ?? "")) throw new Error("Provider activation gate is unavailable.");
  const rootMetadata = await lstat(root).catch(() => null);
  if (!rootMetadata?.isDirectory() || rootMetadata.isSymbolicLink()) throw new Error("Provider activation root is unsafe.");
  const readPrivate = async (name) => {
    const file = path.join(root, name);
    const metadata = await lstat(file).catch(() => null);
    if (!metadata?.isFile() || metadata.isSymbolicLink() || metadata.size < 1 || metadata.size > 65_536) throw new Error("Provider activation receipt is unavailable.");
    const text = await readFile(file, "utf8");
    return { value: JSON.parse(text), sha256: createHash("sha256").update(text).digest("hex") };
  };
  const plan = await readPrivate("plan.json");
  const initial = await readPrivate("initial.json");
  const activation = await readPrivate("activation.json");
  const tuple = (value) => value?.nonce === nonce && value?.source?.head === source.head && value?.source?.tree === source.tree;
  if (!exactKeys(plan.value, ["schema", "private", "nonce", "source", "state", "startedAt", "provider", "inputs"])
    || plan.value.schema !== "service-lasso.admin-provider-observer-plan.v2" || plan.value.private !== true || plan.value.state !== "PLAN" || !tuple(plan.value)
    || !exactKeys(initial.value, ["schema", "private", "nonce", "source", "observer", "plan", "state", "provider", "inputs", "startedAt"])
    || initial.value.schema !== "service-lasso.admin-provider-observer-initial.v2" || initial.value.private !== true || initial.value.plan !== "plan.json" || initial.value.state !== "INITIAL" || !tuple(initial.value)
    || initial.value.provider?.pid !== runner.pid || initial.value.provider?.parentPid !== runner.parentPid || initial.value.provider?.birth !== runner.birth
    || JSON.stringify(initial.value.provider?.nativeIdentity) !== JSON.stringify(runner.nativeIdentity)
    || !exactKeys(activation.value, ["schema", "private", "nonce", "source", "plan", "initial", "initialSha256", "state", "provider", "inputs"])
    || activation.value.schema !== "service-lasso.admin-provider-observer-activation.v2" || activation.value.private !== true || activation.value.plan !== "plan.json" || activation.value.initial !== "initial.json" || activation.value.initialSha256 !== initial.sha256 || activation.value.state !== "ACTIVATED" || !tuple(activation.value)
    || JSON.stringify(activation.value.provider) !== JSON.stringify(initial.value.provider)
    || JSON.stringify(activation.value.inputs) !== JSON.stringify(initial.value.inputs)
    || JSON.stringify(initial.value.inputs) !== JSON.stringify(plan.value.inputs)) throw new Error("Provider activation gate rejected its custody tuple.");
}

const PRELAUNCH_ASSET_PATHS = [
  "tests/fixtures/real-admin-browser-runner.mjs",
  "tests/fixtures/real-admin-browser-shutdown.mjs",
  "tests/fixtures/real-admin-browser-rollback.mjs",
];

async function observePrelaunchAssets(sourceRoot) {
  return Promise.all(
    PRELAUNCH_ASSET_PATHS.map(async (literalPath) => {
      const assetPath = path.join(sourceRoot, ...literalPath.split("/"));
      const metadata = await lstat(assetPath);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1) {
        throw new Error("Prelaunch asset identity is unavailable.");
      }
      return {
        literalPath,
        size: metadata.size,
        sha256: await sha256File(assetPath),
      };
    }),
  );
}

const NATIVE_CUSTODY_ASSET_PATHS = [
  "src/runtime/execution/windows-managed-launcher-native.exe",
  "src/runtime/execution/windows-managed-launcher-native.provenance.json",
  "src/runtime/process/windows-process-inspector.exe",
  "src/runtime/process/windows-process-inspector.provenance.json",
  "src/runtime/security/windows-dpapi-helper.exe",
  "src/runtime/security/windows-dpapi-helper.provenance.json",
];

async function observeBoundAsset(sourceRoot, literalPath) {
  const assetPath = path.join(sourceRoot, ...literalPath.split("/"));
  const metadata = await lstat(assetPath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1) {
    throw new Error("Native qualification asset identity is unavailable.");
  }
  return { literalPath, size: metadata.size, sha256: await sha256File(assetPath) };
}

async function observeExternalBoundAsset(name, assetPath) {
  const metadata = await lstat(assetPath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1) {
    throw new Error("Runtime qualification asset identity is unavailable.");
  }
  return { name, size: metadata.size, sha256: await sha256File(assetPath) };
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
      executable:
        process.platform === "linux"
          ? (await execFileAsync("readlink", ["-f", `/proc/${pid}/exe`])).stdout.trim()
          : (await execFileAsync("ps", ["-o", "comm=", "-p", String(pid)])).stdout.trim(),
    };
  }
  if (
    !Number.isInteger(observed.pid) ||
    observed.pid !== pid ||
    observed.parentPid !== expectedParentPid ||
    typeof observed.birth !== "string" ||
    observed.birth.length === 0 ||
    typeof observed.executable !== "string" ||
    observed.executable.length === 0
  )
    throw new Error(
      "OS process observation did not prove the expected owned parent edge.",
    );
  const executablePath = await realpath(observed.executable).catch(() => null);
  if (!executablePath) {
    throw new Error("OS process observation did not provide a readable executable identity.");
  }
  const executableMetadata = await lstat(executablePath).catch(() => null);
  if (!executableMetadata?.isFile() || executableMetadata.isSymbolicLink()) {
    throw new Error("OS process observation did not provide a regular executable identity.");
  }
  return {
    pid: observed.pid,
    parentPid: observed.parentPid,
    birth: observed.birth,
    nativeIdentity: {
      path: executablePath,
      size: executableMetadata.size,
      sha256: await sha256File(executablePath),
    },
  };
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
// This is an arm capability, not the public readiness correlation nonce.
// It must be supplied by the qualified Admin caller before any runtime import.
const providerControlNonce = requireHexIdentity(
  "SERVICE_LASSO_TEST_PROVIDER_CONTROL_NONCE",
  64,
);
const adminSource = Object.freeze({
  head: requireHexIdentity("SERVICE_LASSO_TEST_ADMIN_SOURCE_HEAD", 40),
  tree: requireHexIdentity("SERVICE_LASSO_TEST_ADMIN_SOURCE_TREE", 40),
});
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
const runnerPath = path.resolve(process.argv[1] ?? "");
const sourceRoot = path.resolve(path.dirname(runnerPath), "..", "..");
if (runnerPath !== path.join(sourceRoot, ...PRELAUNCH_ASSET_PATHS[0].split("/"))) {
  throw new Error("Runner must execute from its fixed qualification fixture path.");
}
await requireProviderActivationGate(runnerIdentity, { head: sourceHead, tree: sourceTree });
const initialReceiptPath = path.join(evidenceRoot, "live-initial-receipt.json");
const prelaunchReceiptPath = path.join(evidenceRoot, "live-prelaunch-receipt.json");
const readyReceiptPath = path.join(evidenceRoot, "live-ready-receipt.json");
const closureReceiptPath = path.join(evidenceRoot, "live-closure-receipt.json");
const providerReceiptPath = path.join(
  evidenceRoot,
  "live-provider-control-receipt.json",
);
const providerConsumedReceiptPath = path.join(
  evidenceRoot,
  "live-provider-control-consumed-receipt.json",
);
const providerRecoveryReceiptPath = path.join(
  evidenceRoot,
  "live-provider-control-recovery-receipt.json",
);

async function requireAbsentPrivateReceipt(filePath) {
  const metadata = await lstat(filePath).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (metadata) {
    throw new Error("Qualification receipt path must be absent before runner startup.");
  }
}

const ownedReceiptWork = new Set();
const ownedReceiptFailures = [];
let providerWorkClosing = false;

function ownReceiptWork(promise) {
  ownedReceiptWork.add(promise);
  // Attach a rejection observer in the same turn, including writes whose HTTP
  // response has already finished. Keep failures after removal from the set.
  promise.then(
    () => ownedReceiptWork.delete(promise),
    (error) => { ownedReceiptFailures.push(error); ownedReceiptWork.delete(promise); },
  );
  return promise;
}

async function settleReceiptWork() {
  let timer;
  const drained = (async () => {
    while (ownedReceiptWork.size) await Promise.allSettled([...ownedReceiptWork]);
    if (ownedReceiptFailures.length) {
      throw new RealAdminBrowserTeardownError(ownedReceiptFailures.map((error) => ({
        phase: "receipt_work_settlement", code: safeFailureCode(error),
      })));
    }
  })();
  const bounded = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new RealAdminBrowserTeardownError([
      { phase: "receipt_work_settlement", code: "receipt_work_timeout" },
    ])), 5_000);
  });
  try { await Promise.race([drained, bounded]); }
  finally { clearTimeout(timer); }
}

function createPrivateReceipt(filePath, receipt) {
  return ownReceiptWork(writeFile(filePath, JSON.stringify(receipt), {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  }));
}

for (const receiptPath of [
  prelaunchReceiptPath,
  initialReceiptPath,
  readyReceiptPath,
  closureReceiptPath,
  providerReceiptPath,
  providerConsumedReceiptPath,
  providerRecoveryReceiptPath,
]) {
  await requireAbsentPrivateReceipt(receiptPath);
}
const receiptNonce = randomBytes(32).toString("hex");
// Every private lifecycle receipt carries the complete caller-owned custody
// tuple.  The three Core paths are validated as distinct and absent above,
// before any runtime import or provider call can consume them.
const runtimeInputs = Object.freeze({
  workspaceRoot,
  instanceRegistryPath,
  hostPortRegistryPath,
  servicesRoot,
  evidenceRoot,
  supportRoot,
});
const runtimeAssets = Object.freeze({
  brokerBinary: await observeExternalBoundAsset("brokerBinary", sourceBrokerBinary),
  adminServer: await observeExternalBoundAsset("adminServer", path.join(adminRoot, "runtime", "server.js")),
  native: await Promise.all(NATIVE_CUSTODY_ASSET_PATHS.map((literalPath) => observeBoundAsset(sourceRoot, literalPath))),
});
const runtimeInvocation = Object.freeze({
  runner: { executable: process.execPath, argv: [runnerPath] },
  admin: { executable: process.execPath, argv: [path.join(adminRoot, "runtime", "server.js")] },
  os: { platform: process.platform, arch: process.arch, release: os.release() },
});
const prelaunchReceipt = {
  schema: "service-lasso.real-admin-browser-live-prelaunch.v1",
  private: true,
  nonce: receiptNonce,
  source: { head: sourceHead, tree: sourceTree },
  runtimeInputs,
  runtimeAssets,
  runtimeInvocation,
  runner: {
    pid: runnerIdentity.pid,
    parentPid: runnerIdentity.parentPid,
    birth: runnerIdentity.birth,
    nativeIdentity: runnerIdentity.nativeIdentity,
  },
  assets: await observePrelaunchAssets(sourceRoot),
};
await createPrivateReceipt(prelaunchReceiptPath, prelaunchReceipt);
const initialReceipt = {
  schema: "service-lasso.real-admin-browser-live-initial.v1",
  private: true,
  nonce: receiptNonce,
  source: { head: sourceHead, tree: sourceTree },
  runtimeInputs,
  inputs: {
    workspaceRoot,
    instanceRegistryPath,
    hostPortRegistryPath,
    servicesRoot,
    evidenceRoot,
    supportRoot,
  },
  runtimeAssets,
  runtimeInvocation,
  ownedProcesses: { runner: runnerIdentity },
};
await createPrivateReceipt(initialReceiptPath, initialReceipt);

// The external-interrupt qualification needs a real immutable initial tuple
// before any imported runtime can own descendants.  This private mode is not a
// product path: it holds only the runner so an adverse OS exit is attributable
// without a PID sweep or synthetic cleanup.
if (process.env.SERVICE_LASSO_TEST_INITIAL_ONLY === "1") {
  process.send?.({ type: "initial-ready" });
  setInterval(() => {}, 1_000);
  await new Promise(() => {});
}

if (process.env.SERVICE_LASSO_TEST_PRELAUNCH_ONLY === "1") {
  process.send?.({ type: "prelaunch-ready" });
  setInterval(() => {}, 1_000);
  await new Promise(() => {});
}

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
  RealAdminBrowserTeardownError,
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
let providerBaseline = null;
let providerRecoveryStatus = null;
let providerConsumedRequest = null;
let providerConsumeCount = 0;
let providerConsumedResponseFinished = false;
let providerControlWrite = null;
let providerRecoveryWrite = null;
let providerRearmRejected = false;
let providerRecoveryRecorded = false;

async function persistProviderControlReceipt(phase) {
  if (providerControlWrite) return providerControlWrite;
  providerControlReceipt = {
    schema: "service-lasso.real-admin-browser-provider-control.v1",
    private: true,
    nonce: receiptNonce,
    source: { head: sourceHead, tree: sourceTree },
    adminSource,
    platform: process.platform,
    controlNonce: providerControlNonce,
    phase,
    causalSink: "authenticated_vault_provider_request",
    state: "observed_before_controlled_fault",
  };
  providerControlWrite = createPrivateReceipt(providerReceiptPath, providerControlReceipt)
    .then(() => providerControlReceipt);
  return providerControlWrite;
}

function sameProviderRequest(left, right) {
  return !!left && !!right && left.method === right.method
    && left.path === right.path && left.authClass === right.authClass;
}

function observeOrdinaryProviderResponse(request, response, requestUrl, status) {
  // This is called only after the original successful token check. Retain no
  // token, arbitrary headers, query or request body in the private receipt.
  const identity = { method: request.method, path: requestUrl.pathname, authClass: "vault_token" };
  const observedState = providerFaultState;
  const consumedBeforeResponse = providerConsumedResponseFinished;
  response.once("finish", () => {
    if (identity.method !== "GET" || identity.path !== "/v1/secret/data/browser/provider-control" || status !== 404) return;
    if (observedState === "not_armed" && providerFaultState === "not_armed") {
      providerBaseline ??= { request: identity, status };
    } else if (observedState === "observed" && consumedBeforeResponse
      && providerFaultState === "observed"
      && sameProviderRequest(providerBaseline?.request, identity)
      && sameProviderRequest(providerConsumedRequest, identity)
      && providerConsumeCount === 1 && providerConsumedResponseFinished) {
      providerRecoveryStatus = status;
    }
  });
}

async function persistProviderRecoveryReceipt() {
  if (providerRecoveryWrite) return providerRecoveryWrite;
  if (providerRecoveryRecorded || !providerConsumedResponseFinished || providerFaultState !== "observed" || !providerBaseline
    || providerRecoveryStatus === null || !providerRearmRejected || providerConsumeCount !== 1
    || !sameProviderRequest(providerBaseline.request, providerConsumedRequest)) return null;
  const receipt = {
    ...providerControlReceipt,
    causalSink: "next_authenticated_vault_provider_request",
    state: "controlled_fault_recovered",
    originalRequest: providerBaseline.request,
    baselineStatus: providerBaseline.status,
    recoveryStatus: providerRecoveryStatus,
    rearm: "rejected",
    secondConsume: providerConsumeCount !== 1,
  };
  providerRecoveryWrite = createPrivateReceipt(providerRecoveryReceiptPath, receipt)
    .then(() => { providerRecoveryRecorded = true; return receipt; });
  return providerRecoveryWrite;
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

function shutdown({ exitCode = 0, trigger = "ipc", signal = null } = {}) {
  if (shutdownPromise) return shutdownPromise;
  providerWorkClosing = true;
  // Start one settlement clock now. The teardown consumes this SAME outcome;
  // it must not restart a timeout after stopping servers or retry a failed sink.
  const settlement = settleReceiptWork().then(
    () => null, (error) => error,
  );
  shutdownPromise = (async () => {
    let resolvedExitCode = exitCode;
    let closure;
    let failure = null;
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
        settleOwnedWork: async () => {
          const error = await settlement;
          if (error) throw error;
        },
      });
      closure = {
          schema: "service-lasso.real-admin-browser-live-closure.v1",
          private: true,
          nonce: receiptNonce,
          source: { head: sourceHead, tree: sourceTree },
          runtimeInputs,
          runtimeAssets,
          runtimeInvocation,
          outcome: trigger === "signal" ? "interrupted" : "closed",
          termination: { trigger, signal, exitCode },
          teardown,
          providerFault:
            providerFaultState === "observed" ? "consumed" : "unresolved",
        };
    } catch (error) {
      resolvedExitCode = 1;
      failure = createSafeRealAdminBrowserTeardownFailure(error);
      closure = {
          schema: "service-lasso.real-admin-browser-live-closure.v1",
          private: true,
          nonce: receiptNonce,
          source: { head: sourceHead, tree: sourceTree },
          runtimeInputs,
          runtimeAssets,
          runtimeInvocation,
          outcome: "unresolved",
          termination: { trigger, signal, exitCode },
          failure,
          providerFault:
            providerFaultState === "observed" ? "consumed" : "unresolved",
        };
    }
    try {
      // One exclusive attempt only: a failed/partial closure file is retained,
      // never overwritten or retried as a second success-shaped receipt.
      await createPrivateReceipt(closureReceiptPath, closure);
    } catch (error) {
      resolvedExitCode = 1;
      failure = createSafeRealAdminBrowserTeardownFailure(new RealAdminBrowserTeardownError([
        ...(failure?.failures ?? []),
        { phase: "receipt_work_settlement", code: safeFailureCode(error) },
      ]));
    }
    if (failure) {
      await new Promise((resolve) => {
        process.stderr.write(`${JSON.stringify(failure)}\n`, resolve);
      });
    }
    process.exit(resolvedExitCode);
  })();
  return shutdownPromise;
}

process.on("SIGINT", () =>
  void shutdown({ exitCode: 1, trigger: "signal", signal: "SIGINT" }),
);
process.on("SIGTERM", () =>
  void shutdown({ exitCode: 1, trigger: "signal", signal: "SIGTERM" }),
);
process.on("message", (message) => {
  if (message?.type === "service-lasso-real-admin-shutdown") void shutdown();
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
        const rejectedAfterRecovery = providerFaultState === "observed"
          && providerRecoveryStatus !== null
          && request.headers["x-service-lasso-provider-control-nonce"] === providerControlNonce;
        const completed = new Promise((resolve) => {
          response.once("finish", () => resolve(true));
          response.once("close", () => resolve(false));
        });
        response.writeHead(409, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ outcome: "provider_fault_unavailable" }));
        if (await completed && rejectedAfterRecovery) {
          providerRearmRejected = true;
          await persistProviderRecoveryReceipt();
        }
        return;
      }
      if (!providerControlReceipt) {
        response.writeHead(409, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ outcome: "provider_fault_unobserved" }));
        return;
      }
      if (
        request.headers["x-service-lasso-provider-control-nonce"] !==
        providerControlNonce
      ) {
        // A missing, stale, or mismatched capability cannot arm or consume a
        // future provider request. Do not disclose the private value.
        response.writeHead(403, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ outcome: "provider_fault_forbidden" }));
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
      if (requestUrl.searchParams.get("wait") === "recovery") {
        if (request.headers["x-service-lasso-provider-control-nonce"] !== providerControlNonce) {
          response.writeHead(403);
          response.end();
          return;
        }
        await persistProviderRecoveryReceipt();
        if (!providerRecoveryRecorded) {
          response.writeHead(409, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ outcome: "provider_fault_unobserved", receipt: null }));
          return;
        }
      } else {
        await persistProviderRecoveryReceipt();
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
                  state: "controlled_fault_consumed",
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
      providerConsumedRequest = { method: request.method, path: requestUrl.pathname, authClass: "vault_token" };
      providerConsumeCount += 1;
      response.once("finish", () => { providerConsumedResponseFinished = true; });
      response.writeHead(503, { "Content-Type": "application/json" });
      await createPrivateReceipt(
        providerConsumedReceiptPath,
        {
          ...providerControlReceipt,
          state: "controlled_fault_consumed",
          causalSink: "next_authenticated_vault_provider_request",
        },
      );
      response.end(
        JSON.stringify({ errors: ["provider fixture unavailable"] }),
      );
      return;
    }
    if (!requestUrl.pathname.startsWith("/v1/secret/data/browser/")) {
      observeOrdinaryProviderResponse(request, response, requestUrl, 404);
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
        observeOrdinaryProviderResponse(request, response, requestUrl, 404);
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
  const ownedVaultRequest = (request, response) => {
    if (providerWorkClosing) {
      response.writeHead(503);
      response.end();
      return;
    }
    const operation = ownReceiptWork(handleVaultRequest(request, response));
    // EventEmitter does not await async listeners. This observer prevents a
    // post-finish rejection escaping and leaves the original failure retained.
    void operation.catch(() => {
      try {
        if (!response.headersSent) {
          response.writeHead(500, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ outcome: "provider_fault_unobserved", receipt: null }));
        } else if (!response.writableEnded) response.destroy();
      } catch (error) {
        ownedReceiptFailures.push(error);
      }
    });
  };
  vaultServer = http.createServer(ownedVaultRequest);
  vaultProviderServer = https.createServer(
    { key: certificate.private, cert: certificate.cert },
    ownedVaultRequest,
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
  const readyReceipt = {
    ...initialReceipt,
    ownedProcesses: { runner: runnerIdentity, admin: adminIdentity },
    ownerCorrelation: {
      state: "observed",
      runnerPid: runnerIdentity.pid,
      adminPid: adminIdentity.pid,
      adminParentPid: adminIdentity.parentPid,
    },
  };
  await createPrivateReceipt(readyReceiptPath, readyReceipt);
  const initialReceiptSHA256 = await sha256File(initialReceiptPath);
  const readyReceiptSHA256 = await sha256File(readyReceiptPath);
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
        schema: readyReceipt.schema,
        nonce: receiptNonce,
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
  await shutdown({ exitCode: 1, trigger: "startup_failure" });
}
