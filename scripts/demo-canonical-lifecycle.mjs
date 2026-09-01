import path from "node:path";
import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import {
  canBindPort,
  defaultDemoLogRoot,
  defaultDemoServicesRoot,
  defaultDemoWorkspaceRoot,
  getCanonicalRuntimeLaneLockPath,
  getDemoLifecyclePaths,
  getDemoStatus,
  repoRoot,
  resolveDemoRuntimePort,
  runCoreWorkspaceLifecycle,
  startDetachedDemoRuntime,
  writeDemoLifecycleState,
} from "./demo-instance-lib.mjs";
export { getCanonicalRuntimeLaneLockPath } from "./demo-instance-lib.mjs";
import { verifyCanonicalDemo } from "./demo-verify-canonical.mjs";

const BLOCKING_OWNERSHIP = new Set(["wrong_workspace_owner", "runtime_port_owner_conflict"]);
const CANONICAL_LANE_LOCK_HELD_ENV = "SERVICE_LASSO_CANONICAL_LANE_LOCK_HELD";
const CANONICAL_LANE_LOCK_TIMEOUT_MS = 6 * 60 * 1000;
const CANONICAL_LANE_LOCK_STALE_MS = 10 * 60 * 1000;
const DEFAULT_READY_TIMEOUT_MS = 5 * 60 * 1000;
const READY_POLL_MS = 500;

/**
 * @typedef {object} CanonicalDemoLifecycleReport
 * @property {string} schema
 * @property {"start" | "stop" | "recycle" | "status"} command
 * @property {string} outcome
 * @property {boolean} ok
 * @property {string} classification
 * @property {string} workspaceRoot
 * @property {string} servicesRoot
 * @property {string | null} runtimeUrl
 * @property {string | null} serviceAdminUrl
 * @property {string} lifecycleStatePath
 * @property {string} demoLogRoot
 * @property {string} commandLockPath
 * @property {string} canonicalLaneLockPath
 * @property {string[]} steps
 * @property {string[]} blockers
 * @property {string[]} logPaths
 * @property {Array<{ name: string, url: string }>} endpoints
 * @property {boolean} stayResident
 * @property {object | null} lifecycle
 * @property {object | null} status
 * @property {object | null} verification
 * @property {object | null} lifecycleState
 * @property {object | null} ownershipProbe
 * @property {object | null} stoppedConfirmation
 */

/**
 * Delay helper for bounded poll loops.
 *
 * @param {number} ms Milliseconds to wait.
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Normalizes a filesystem path for ownership comparison.
 *
 * @param {unknown} value Path to compare.
 * @returns {string}
 */
function normalizePathForCompare(value) {
  const resolved = path.resolve(String(value ?? ""));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/**
 * Returns true when two filesystem paths name the same location.
 *
 * @param {unknown} left First path.
 * @param {unknown} right Second path.
 * @returns {boolean}
 */
function sameResolvedPath(left, right) {
  return normalizePathForCompare(left) === normalizePathForCompare(right);
}

/**
 * Loads a JSON object from disk when the file exists.
 *
 * @param {string} filePath Absolute JSON path.
 * @returns {Promise<object | null>}
 */
async function readOptionalJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Probes one HTTP URL without throwing.
 *
 * @param {string} url Target URL.
 * @param {number} timeoutMs Abort timeout.
 * @returns {Promise<{ ok: boolean, status: number | null, error: string | null }>}
 */
async function probeHttp(url, timeoutMs) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return {
      ok: response.ok,
      status: response.status,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Resolves the canonical demo roots, URLs, and lock paths for one command.
 *
 * @param {object} options Command options from `resolveDemoOptions`.
 * @returns {{
 *   servicesRoot: string,
 *   workspaceRoot: string,
 *   port: number,
 *   runtimeUrl: string,
 *   serviceAdminUrl: string,
 *   demoLogRoot: string,
 *   lifecyclePaths: ReturnType<typeof getDemoLifecyclePaths>,
 *   canonicalLaneLockPath: string,
 * }}
 */
export function resolveCanonicalDemoLifecycleContext(options = {}) {
  const servicesRoot = path.resolve(options.servicesRoot ?? defaultDemoServicesRoot);
  const workspaceRoot = path.resolve(options.workspaceRoot ?? defaultDemoWorkspaceRoot);
  const port = resolveDemoRuntimePort(options.port);
  const runtimeUrl = options.runtimeUrl ?? `http://127.0.0.1:${port}`;
  const serviceAdminUrl = options.serviceAdminUrl ?? "http://127.0.0.1:17700/";
  const demoLogRoot = path.resolve(options.demoLogRoot ?? defaultDemoLogRoot);
  return {
    servicesRoot,
    workspaceRoot,
    port,
    runtimeUrl,
    serviceAdminUrl,
    demoLogRoot,
    lifecyclePaths: getDemoLifecyclePaths(workspaceRoot),
    canonicalLaneLockPath: getCanonicalRuntimeLaneLockPath(port),
  };
}

/**
 * Serializes canonical start, stop, recycle, and watchdog recovery for one runtime lane.
 *
 * @template T
 * @param {object} options Demo options including the target port.
 * @param {() => Promise<T>} work Exclusive work.
 * @param {object} [deps] Test seams.
 * @returns {Promise<T>}
 */
export async function withCanonicalDemoLifecycleLock(options, work, deps = {}) {
  const context = resolveCanonicalDemoLifecycleContext(options);
  if (options.skipLaneLock === true || (deps.env ?? process.env)[CANONICAL_LANE_LOCK_HELD_ENV] === "1") {
    return await work();
  }
  const lockModule = deps.lockModule ?? await import(
    pathToFileURL(path.join(repoRoot, "dist", "runtime", "security", "cross-process-file-lock.js")).href
  );
  return await lockModule.withCrossProcessFileLock(
    context.canonicalLaneLockPath,
    work,
    {
      timeoutMs: options.lockTimeoutMs ?? CANONICAL_LANE_LOCK_TIMEOUT_MS,
      staleMs: options.lockStaleMs ?? CANONICAL_LANE_LOCK_STALE_MS,
      unavailableMessage: `Timed out waiting for the canonical runtime lane lock on port ${context.port}.`,
    },
  );
}

/**
 * Classifies persisted workspace metadata against the requested demo roots and listener.
 *
 * Unsafe occupied-port states fail closed once so operators are not asked to investigate.
 *
 * @param {object} options Demo options.
 * @param {object} [deps] Test seams.
 * @returns {Promise<{ classification: string, ok: boolean, instance: object | null, portFree: boolean }>}
 */
export async function classifyCanonicalDemoOwnership(options = {}, deps = {}) {
  const context = resolveCanonicalDemoLifecycleContext(options);
  const bindPort = deps.canBindPort ?? canBindPort;
  const readJson = deps.readOptionalJson ?? readOptionalJson;
  const instance = await readJson(context.lifecyclePaths.runtimeInstancePath);
  const portFree = context.port === 0 ? true : await bindPort("127.0.0.1", context.port);
  if (!instance || typeof instance !== "object") {
    if (portFree) {
      return { classification: "not_running", ok: true, instance: null, portFree };
    }
    return { classification: "runtime_port_owner_conflict", ok: false, instance: null, portFree };
  }

  const rootsMatch =
    sameResolvedPath(instance.workspaceRoot, context.workspaceRoot)
    && sameResolvedPath(instance.servicesRoot, context.servicesRoot);
  if (!rootsMatch) {
    return {
      classification: portFree ? "stale_workspace_runtime_metadata" : "wrong_workspace_owner",
      ok: portFree,
      instance,
      portFree,
    };
  }

  if (portFree) {
    return { classification: "not_running", ok: true, instance, portFree };
  }

  return { classification: "owned", ok: true, instance, portFree };
}

/**
 * Confirms the runtime API is down and the requested runtime port reservation is released.
 *
 * @param {object} options Demo options.
 * @param {object} [deps] Test seams.
 * @returns {Promise<{ ok: boolean, classification: string, healthUrl: string, port: number, apiDown: boolean, portFree: boolean }>}
 */
export async function confirmCanonicalDemoStopped(options = {}, deps = {}) {
  const context = resolveCanonicalDemoLifecycleContext(options);
  const healthUrl = `${context.runtimeUrl.replace(/\/$/, "")}/api/health`;
  const probe = await (deps.probeHttp ?? probeHttp)(healthUrl, options.timeoutMs ?? 2_000);
  const portFree = context.port === 0 ? true : await (deps.canBindPort ?? canBindPort)("127.0.0.1", context.port);
  const apiDown = probe.ok !== true;
  const ok = apiDown && portFree;
  return {
    ok,
    classification: ok
      ? "already_stopped"
      : apiDown
        ? "endpoint_reservation_held"
        : "runtime_still_reachable",
    healthUrl,
    port: context.port,
    apiDown,
    portFree,
  };
}

/**
 * Builds the operator-facing canonical demo report required by #764.
 *
 * @param {Partial<CanonicalDemoLifecycleReport> & { command: CanonicalDemoLifecycleReport["command"], outcome: string, workspaceRoot: string, servicesRoot: string }} input Report fields.
 * @returns {CanonicalDemoLifecycleReport}
 */
export function buildCanonicalDemoReport(input) {
  return {
    schema: "service-lasso.canonical-demo-lifecycle.v1",
    command: input.command,
    outcome: input.outcome,
    ok: input.ok === true,
    classification: input.classification ?? input.outcome,
    workspaceRoot: input.workspaceRoot,
    servicesRoot: input.servicesRoot,
    runtimeUrl: input.runtimeUrl ?? null,
    serviceAdminUrl: input.serviceAdminUrl ?? null,
    lifecycleStatePath: input.lifecycleStatePath ?? "",
    demoLogRoot: input.demoLogRoot ?? defaultDemoLogRoot,
    commandLockPath: input.commandLockPath ?? "",
    canonicalLaneLockPath: input.canonicalLaneLockPath ?? "",
    steps: Array.isArray(input.steps) ? input.steps : [],
    blockers: Array.isArray(input.blockers) ? input.blockers : [],
    logPaths: Array.isArray(input.logPaths) ? input.logPaths : [],
    endpoints: Array.isArray(input.endpoints) ? input.endpoints : [],
    stayResident: input.stayResident === true,
    lifecycle: input.lifecycle ?? null,
    status: input.status ?? null,
    verification: input.verification ?? null,
    lifecycleState: input.lifecycleState ?? null,
    ownershipProbe: input.ownershipProbe ?? null,
    stoppedConfirmation: input.stoppedConfirmation ?? null,
  };
}

/**
 * Formats the required workspace, URL, classification, and log-path lines.
 *
 * @param {CanonicalDemoLifecycleReport} report Canonical demo report.
 * @returns {string}
 */
export function formatCanonicalDemoReport(report) {
  const lines = [
    `[service-lasso demo] ${report.command} ${report.outcome}`,
    `- ok: ${report.ok ? "yes" : "no"}`,
    `- classification: ${report.classification}`,
    `- runtimeUrl: ${report.runtimeUrl ?? "unknown"}`,
    `- serviceAdminUrl: ${report.serviceAdminUrl ?? "unknown"}`,
    `- workspaceRoot: ${report.workspaceRoot}`,
    `- servicesRoot: ${report.servicesRoot}`,
    `- lifecycleState: ${report.lifecycleStatePath}`,
    `- demoLogs: ${report.demoLogRoot}`,
    `- commandLock: ${report.commandLockPath}`,
    `- laneLock: ${report.canonicalLaneLockPath}`,
  ];
  if (report.ownershipProbe) {
    lines.push(`- ownership: ${report.ownershipProbe.classification}`);
  }
  if (report.status?.ownership) {
    lines.push(
      `- processIdentity: instance=${report.status.ownership.instanceId ?? "none"} generation=${report.status.ownership.generationId ?? "none"} pid=${report.status.ownership.ownerPid ?? "none"}`,
    );
  }
  if (report.status?.allocation) {
    lines.push(`- allocation: requested=${report.status.allocation.requestedPort} resolved=${report.status.allocation.apiPort}`);
  }
  for (const endpoint of report.endpoints) {
    lines.push(`- endpoint ${endpoint.name}: ${endpoint.url}`);
  }
  for (const logPath of report.logPaths) {
    lines.push(`- log: ${logPath}`);
  }
  if (report.verification) {
    lines.push(`- verifyCanonical: ${report.verification.ok ? "passed" : "failed"}`);
  }
  for (const blocker of report.blockers) {
    lines.push(`- blocker: ${blocker}`);
  }
  return lines.join("\n");
}

/**
 * Collects resolved runtime endpoints from a core lifecycle result.
 *
 * @param {object | null} lifecycle Core workspace lifecycle result.
 * @param {string | null} fallbackRuntimeUrl Requested runtime URL.
 * @param {string | null} serviceAdminUrl Requested Service Admin URL.
 * @returns {Array<{ name: string, url: string }>}
 */
function collectResolvedEndpoints(lifecycle, fallbackRuntimeUrl, serviceAdminUrl) {
  const endpoints = [];
  if (Array.isArray(lifecycle?.endpoints)) {
    endpoints.push(...lifecycle.endpoints);
  } else if (lifecycle?.apiUrl || fallbackRuntimeUrl) {
    endpoints.push({ name: "api", url: lifecycle?.apiUrl ?? fallbackRuntimeUrl });
  }
  if (serviceAdminUrl) {
    endpoints.push({ name: "serviceAdmin", url: serviceAdminUrl });
  }
  return endpoints;
}

/**
 * Completes a blocked report without further mutation.
 *
 * @param {object} input Blocked-report fields.
 * @returns {CanonicalDemoLifecycleReport}
 */
function blockedReport(input) {
  return buildCanonicalDemoReport({
    ...input,
    ok: false,
    stayResident: false,
  });
}

/**
 * Ensures the canonical demo is running, or reports a single fail-closed classification.
 *
 * @param {object} options Demo options.
 * @param {object} [deps] Test seams.
 * @returns {Promise<CanonicalDemoLifecycleReport>}
 */
export async function runCanonicalDemoStart(options = {}, deps = {}) {
  const context = resolveCanonicalDemoLifecycleContext(options);
  const runLifecycle = deps.runLifecycle ?? runCoreWorkspaceLifecycle;
  const getStatus = deps.getStatus ?? getDemoStatus;
  const writeState = deps.writeLifecycleState ?? writeDemoLifecycleState;
  const classifyOwnership = deps.classifyOwnership ?? classifyCanonicalDemoOwnership;

  return await withCanonicalDemoLifecycleLock(options, async () => {
    const ownershipProbe = await classifyOwnership(options, deps);
    if (BLOCKING_OWNERSHIP.has(ownershipProbe.classification)) {
      return blockedReport({
        command: "start",
        outcome: "blocked",
        classification: ownershipProbe.classification,
        workspaceRoot: context.workspaceRoot,
        servicesRoot: context.servicesRoot,
        runtimeUrl: context.runtimeUrl,
        serviceAdminUrl: context.serviceAdminUrl,
        lifecycleStatePath: context.lifecyclePaths.lifecycleStatePath,
        demoLogRoot: context.demoLogRoot,
        commandLockPath: context.lifecyclePaths.commandLockPath,
        canonicalLaneLockPath: context.canonicalLaneLockPath,
        steps: ["classify"],
        blockers: [ownershipProbe.classification],
        ownershipProbe,
      });
    }

    const lifecycle = await runLifecycle("start", {
      ...options,
      servicesRoot: context.servicesRoot,
      workspaceRoot: context.workspaceRoot,
      port: context.port,
      portPolicy: options.portPolicy ?? (context.port === 0 ? "automatic" : "preferred"),
    });
    const runtimeUrl = lifecycle.apiUrl ?? context.runtimeUrl;
    const status = await getStatus({ ...options, runtimeUrl });
    const phase = lifecycle.outcome === "already_running" ? "already_healthy" : "started";
    const lifecycleState = await writeState(status, {
      phase,
      classification: lifecycle.ok ? (lifecycle.outcome === "already_running" ? "healthy" : status.classification) : lifecycle.outcome,
    });

    return buildCanonicalDemoReport({
      command: "start",
      outcome: lifecycle.outcome,
      ok: lifecycle.ok === true,
      classification: lifecycle.ok
        ? (lifecycle.outcome === "already_running" ? "already_healthy" : status.classification)
        : (lifecycle.blockers[0] ?? lifecycle.outcome),
      workspaceRoot: context.workspaceRoot,
      servicesRoot: context.servicesRoot,
      runtimeUrl,
      serviceAdminUrl: context.serviceAdminUrl,
      lifecycleStatePath: context.lifecyclePaths.lifecycleStatePath,
      demoLogRoot: context.demoLogRoot,
      commandLockPath: context.lifecyclePaths.commandLockPath,
      canonicalLaneLockPath: context.canonicalLaneLockPath,
      steps: ["classify", "start"],
      blockers: lifecycle.blockers ?? [],
      logPaths: lifecycle.logPaths ?? [],
      endpoints: collectResolvedEndpoints(lifecycle, runtimeUrl, context.serviceAdminUrl),
      stayResident: lifecycle.ok === true && (lifecycle.outcome === "started" || lifecycle.outcome === "restarted"),
      lifecycle,
      status,
      lifecycleState,
      ownershipProbe,
    });
  }, deps);
}

/**
 * Stops the canonical demo through the core coordinator and confirms reservations are released.
 *
 * @param {object} options Demo options.
 * @param {object} [deps] Test seams.
 * @returns {Promise<CanonicalDemoLifecycleReport>}
 */
export async function runCanonicalDemoStop(options = {}, deps = {}) {
  const context = resolveCanonicalDemoLifecycleContext(options);
  const runLifecycle = deps.runLifecycle ?? runCoreWorkspaceLifecycle;
  const getStatus = deps.getStatus ?? getDemoStatus;
  const writeState = deps.writeLifecycleState ?? writeDemoLifecycleState;
  const confirmStopped = deps.confirmStopped ?? confirmCanonicalDemoStopped;

  return await withCanonicalDemoLifecycleLock(options, async () => {
    const lifecycle = await runLifecycle("stop", {
      ...options,
      servicesRoot: context.servicesRoot,
      workspaceRoot: context.workspaceRoot,
    });
    const stoppedConfirmation = await confirmStopped({
      ...options,
      runtimeUrl: lifecycle.apiUrl ?? context.runtimeUrl,
    }, deps);
    const status = await getStatus(options);
    const lifecycleState = await writeState(status, {
      phase: "stopped",
      classification: stoppedConfirmation.ok ? "stopped" : stoppedConfirmation.classification,
    });
    const ok = lifecycle.ok === true && stoppedConfirmation.ok;
    return buildCanonicalDemoReport({
      command: "stop",
      outcome: ok ? lifecycle.outcome : "blocked",
      ok,
      classification: ok ? lifecycle.outcome : stoppedConfirmation.classification,
      workspaceRoot: context.workspaceRoot,
      servicesRoot: context.servicesRoot,
      runtimeUrl: context.runtimeUrl,
      serviceAdminUrl: context.serviceAdminUrl,
      lifecycleStatePath: context.lifecyclePaths.lifecycleStatePath,
      demoLogRoot: context.demoLogRoot,
      commandLockPath: context.lifecyclePaths.commandLockPath,
      canonicalLaneLockPath: context.canonicalLaneLockPath,
      steps: ["stop", "confirm"],
      blockers: [
        ...(lifecycle.blockers ?? []),
        ...(stoppedConfirmation.ok ? [] : [stoppedConfirmation.classification]),
      ],
      logPaths: lifecycle.logPaths ?? [],
      endpoints: collectResolvedEndpoints(lifecycle, context.runtimeUrl, context.serviceAdminUrl),
      stayResident: false,
      lifecycle,
      status,
      lifecycleState,
      stoppedConfirmation,
    });
  }, deps);
}

/**
 * Polls canonical status and verification until both pass or the timeout expires.
 *
 * @param {object} options Demo options including resolved runtime URL.
 * @param {object} deps Injected status and verify functions.
 * @returns {Promise<{ status: object, verification: object }>}
 */
async function waitForCanonicalReady(options, deps) {
  const getStatus = deps.getStatus ?? getDemoStatus;
  const verify = deps.verify ?? verifyCanonicalDemo;
  const timeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  let lastStatus = await getStatus(options);
  let lastVerification = {
    ok: false,
    failures: [{ name: "canonical verifier", code: "not_run", detail: "Verification has not completed." }],
  };

  while (Date.now() <= deadline) {
    lastStatus = await getStatus(options);
    lastVerification = await verify({
      runtimeUrl: options.runtimeUrl,
      serviceAdminUrl: options.serviceAdminUrl,
      servicesRoot: options.servicesRoot,
      workspaceRoot: options.workspaceRoot,
      timeoutMs: Math.min(options.timeoutMs ?? 5_000, 5_000),
    });
    if (lastVerification.ok) {
      return { status: lastStatus, verification: lastVerification };
    }
    await delay(options.readyPollMs ?? READY_POLL_MS);
  }

  return { status: lastStatus, verification: lastVerification };
}

/**
 * Recycles the canonical demo as stop → confirm → start → verify.
 *
 * Detached recycle leaves the started runtime running after the parent exits.
 * Foreground recycle starts in-process and asks the caller to stay resident.
 *
 * @param {object} options Demo options. `keepAlive` or `foreground` starts in-process.
 * @param {object} [deps] Test seams.
 * @returns {Promise<CanonicalDemoLifecycleReport>}
 */
export async function runCanonicalDemoRecycle(options = {}, deps = {}) {
  const context = resolveCanonicalDemoLifecycleContext(options);
  const runLifecycle = deps.runLifecycle ?? runCoreWorkspaceLifecycle;
  const getStatus = deps.getStatus ?? getDemoStatus;
  const writeState = deps.writeLifecycleState ?? writeDemoLifecycleState;
  const confirmStopped = deps.confirmStopped ?? confirmCanonicalDemoStopped;
  const classifyOwnership = deps.classifyOwnership ?? classifyCanonicalDemoOwnership;
  const startDetached = deps.startDetached ?? startDetachedDemoRuntime;
  const waitForReady = deps.waitForReady ?? waitForCanonicalReady;
  const keepAlive = options.keepAlive === true || options.foreground === true;
  const steps = [];

  return await withCanonicalDemoLifecycleLock(options, async () => {
    const ownershipProbe = await classifyOwnership(options, deps);
    steps.push("classify");
    if (BLOCKING_OWNERSHIP.has(ownershipProbe.classification)) {
      return blockedReport({
        command: "recycle",
        outcome: "blocked",
        classification: ownershipProbe.classification,
        workspaceRoot: context.workspaceRoot,
        servicesRoot: context.servicesRoot,
        runtimeUrl: context.runtimeUrl,
        serviceAdminUrl: context.serviceAdminUrl,
        lifecycleStatePath: context.lifecyclePaths.lifecycleStatePath,
        demoLogRoot: context.demoLogRoot,
        commandLockPath: context.lifecyclePaths.commandLockPath,
        canonicalLaneLockPath: context.canonicalLaneLockPath,
        steps,
        blockers: [ownershipProbe.classification],
        ownershipProbe,
      });
    }

    const stopResult = await runLifecycle("stop", {
      ...options,
      servicesRoot: context.servicesRoot,
      workspaceRoot: context.workspaceRoot,
    });
    steps.push("stop");
    if (!stopResult.ok) {
      return blockedReport({
        command: "recycle",
        outcome: "blocked",
        classification: stopResult.blockers[0] ?? "stop_blocked",
        workspaceRoot: context.workspaceRoot,
        servicesRoot: context.servicesRoot,
        runtimeUrl: context.runtimeUrl,
        serviceAdminUrl: context.serviceAdminUrl,
        lifecycleStatePath: context.lifecyclePaths.lifecycleStatePath,
        demoLogRoot: context.demoLogRoot,
        commandLockPath: context.lifecyclePaths.commandLockPath,
        canonicalLaneLockPath: context.canonicalLaneLockPath,
        steps,
        blockers: stopResult.blockers ?? [],
        lifecycle: stopResult,
        ownershipProbe,
      });
    }

    const stoppedConfirmation = await confirmStopped({
      ...options,
      runtimeUrl: stopResult.apiUrl ?? context.runtimeUrl,
    }, deps);
    steps.push("confirm");
    if (!stoppedConfirmation.ok) {
      return blockedReport({
        command: "recycle",
        outcome: "blocked",
        classification: stoppedConfirmation.classification,
        workspaceRoot: context.workspaceRoot,
        servicesRoot: context.servicesRoot,
        runtimeUrl: context.runtimeUrl,
        serviceAdminUrl: context.serviceAdminUrl,
        lifecycleStatePath: context.lifecyclePaths.lifecycleStatePath,
        demoLogRoot: context.demoLogRoot,
        commandLockPath: context.lifecyclePaths.commandLockPath,
        canonicalLaneLockPath: context.canonicalLaneLockPath,
        steps,
        blockers: [stoppedConfirmation.classification],
        lifecycle: stopResult,
        ownershipProbe,
        stoppedConfirmation,
      });
    }

    let startResult = null;
    let detached = null;
    if (keepAlive) {
      startResult = await runLifecycle("start", {
        ...options,
        servicesRoot: context.servicesRoot,
        workspaceRoot: context.workspaceRoot,
        port: context.port,
        portPolicy: options.portPolicy ?? (context.port === 0 ? "automatic" : "preferred"),
      });
    } else {
      detached = await startDetached({
        ...options,
        servicesRoot: context.servicesRoot,
        workspaceRoot: context.workspaceRoot,
        port: context.port,
        runtimeUrl: context.runtimeUrl,
        serviceAdminUrl: context.serviceAdminUrl,
        demoLogRoot: context.demoLogRoot,
        laneLockHeld: true,
      });
      startResult = {
        ok: true,
        outcome: "started",
        apiUrl: context.runtimeUrl,
        apiPort: context.port,
        blockers: [],
        logPaths: detached.logPath ? [detached.logPath] : [],
        endpoints: [{ name: "api", url: context.runtimeUrl }],
      };
    }
    steps.push("start");
    if (!startResult.ok) {
      return blockedReport({
        command: "recycle",
        outcome: "blocked",
        classification: startResult.blockers?.[0] ?? "start_blocked",
        workspaceRoot: context.workspaceRoot,
        servicesRoot: context.servicesRoot,
        runtimeUrl: context.runtimeUrl,
        serviceAdminUrl: context.serviceAdminUrl,
        lifecycleStatePath: context.lifecyclePaths.lifecycleStatePath,
        demoLogRoot: context.demoLogRoot,
        commandLockPath: context.lifecyclePaths.commandLockPath,
        canonicalLaneLockPath: context.canonicalLaneLockPath,
        steps,
        blockers: startResult.blockers ?? [],
        lifecycle: startResult,
        ownershipProbe,
        stoppedConfirmation,
      });
    }

    const runtimeUrl = startResult.apiUrl ?? context.runtimeUrl;
    const ready = await waitForReady({
      ...options,
      runtimeUrl,
      serviceAdminUrl: context.serviceAdminUrl,
      servicesRoot: context.servicesRoot,
      workspaceRoot: context.workspaceRoot,
    }, deps);
    steps.push("verify");
    const status = ready.status;
    const verification = ready.verification;
    const lifecycleState = await writeState(status, {
      phase: verification.ok ? "recycled" : "verify_failed",
      classification: verification.ok ? "healthy" : "canonical_verification_failed",
    });
    const logPaths = [
      ...(startResult.logPaths ?? []),
      ...(detached?.logPath ? [detached.logPath] : []),
    ];

    return buildCanonicalDemoReport({
      command: "recycle",
      outcome: verification.ok ? "recycled" : "blocked",
      ok: verification.ok === true,
      classification: verification.ok ? "healthy" : "canonical_verification_failed",
      workspaceRoot: context.workspaceRoot,
      servicesRoot: context.servicesRoot,
      runtimeUrl,
      serviceAdminUrl: context.serviceAdminUrl,
      lifecycleStatePath: context.lifecyclePaths.lifecycleStatePath,
      demoLogRoot: context.demoLogRoot,
      commandLockPath: context.lifecyclePaths.commandLockPath,
      canonicalLaneLockPath: context.canonicalLaneLockPath,
      steps,
      blockers: verification.ok
        ? []
        : (verification.failures ?? []).map((failure) => failure.name ?? failure.code ?? "canonical_verification_failed"),
      logPaths,
      endpoints: collectResolvedEndpoints(startResult, runtimeUrl, context.serviceAdminUrl),
      stayResident: keepAlive && startResult.ok === true,
      lifecycle: startResult,
      status,
      verification,
      lifecycleState,
      ownershipProbe,
      stoppedConfirmation,
    });
  }, deps);
}

/**
 * Returns the canonical demo status report without mutating lifecycle.
 *
 * @param {object} options Demo options.
 * @param {object} [deps] Test seams.
 * @returns {Promise<CanonicalDemoLifecycleReport>}
 */
export async function runCanonicalDemoStatus(options = {}, deps = {}) {
  const context = resolveCanonicalDemoLifecycleContext(options);
  const getStatus = deps.getStatus ?? getDemoStatus;
  const classifyOwnership = deps.classifyOwnership ?? classifyCanonicalDemoOwnership;
  const status = await getStatus(options);
  const ownershipProbe = await classifyOwnership(options, deps);
  return buildCanonicalDemoReport({
    command: "status",
    outcome: status.classification,
    ok: status.ok === true,
    classification: status.classification,
    workspaceRoot: context.workspaceRoot,
    servicesRoot: context.servicesRoot,
    runtimeUrl: status.allocation?.apiUrl ?? context.runtimeUrl,
    serviceAdminUrl: context.serviceAdminUrl,
    lifecycleStatePath: context.lifecyclePaths.lifecycleStatePath,
    demoLogRoot: context.demoLogRoot,
    commandLockPath: context.lifecyclePaths.commandLockPath,
    canonicalLaneLockPath: context.canonicalLaneLockPath,
    steps: ["status"],
    endpoints: collectResolvedEndpoints(
      { apiUrl: status.allocation?.apiUrl ?? context.runtimeUrl, endpoints: [] },
      status.allocation?.apiUrl ?? context.runtimeUrl,
      context.serviceAdminUrl,
    ),
    stayResident: false,
    status,
    ownershipProbe,
  });
}
