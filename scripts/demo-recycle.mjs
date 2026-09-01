import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  formatCanonicalDemoReport,
  runCanonicalDemoRecycle,
} from "./demo-canonical-lifecycle.mjs";
import {
  canonicalDemoRequiredServiceIds,
  demoProviderServiceIds,
  resolveDemoOptions,
} from "./demo-instance-lib.mjs";
import {
  acquireLegacySchedulerLock,
  acquireWatchdogLock,
  releaseLegacySchedulerLock,
  releaseWatchdogLock,
  resolveWatchdogOptions,
} from "./demo-watchdog.mjs";

const options = resolveDemoOptions();
const recoveryLockAlreadyHeldEnv = "SERVICE_LASSO_DEMO_RECOVERY_LOCK_HELD";
const detachedLockWaitTimeoutMs = 10 * 60 * 1000;

/**
 * Runs a command and returns trimmed stdout, or an empty string on failure.
 *
 * @param {string} command Executable name.
 * @param {string[]} args Command arguments.
 * @returns {Promise<string>}
 */
async function commandOutput(command, args) {
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.once("close", (code) => resolve(code === 0 ? stdout.trim() : ""));
    child.once("error", () => resolve(""));
  });
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Loads the GitHub token into the process environment when `gh` can supply one.
 *
 * @returns {Promise<void>}
 */
async function ensureGitHubTokenEnv() {
  if (process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim()) {
    return;
  }

  const token = await commandOutput("gh", ["auth", "token"]);
  if (!token) {
    return;
  }

  process.env.GITHUB_TOKEN = token;
  process.env.GH_TOKEN = token;
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  return {
    status: response.status,
    body: await response.json(),
  };
}

function requiredServicesReady(services) {
  const byId = new Map(services.map((service) => [service.id, service]));
  for (const serviceId of canonicalDemoRequiredServiceIds) {
    const service = byId.get(serviceId);
    if (!service?.lifecycle?.installed || !service?.lifecycle?.configured) {
      return false;
    }
    if (demoProviderServiceIds.has(serviceId)) {
      if (service.lifecycle?.running !== false) {
        return false;
      }
      continue;
    }
    if (service.lifecycle?.running !== true || service.health?.healthy !== true) {
      return false;
    }
  }
  return true;
}

async function getLiveServiceSummary(apiUrl) {
  const result = await fetchJson(`${apiUrl}/api/services`);
  if (result.status !== 200 || !Array.isArray(result.body.services)) {
    return [];
  }

  return result.body.services
    .filter((service) => ["@serviceadmin", "@secretsbroker", "echo-service", "@node", "node-sample-service"].includes(service.id))
    .map((service) => ({
      id: service.id,
      running: service.lifecycle?.running === true,
      healthy: service.health?.healthy === true,
    }));
}

/**
 * Waits until canonical required services report installed/configured/ready from the live runtime API.
 *
 * @param {string} apiUrl Runtime API base URL.
 * @param {{ timeoutMs?: number, intervalMs?: number }} [options] Poll options.
 * @returns {Promise<object[]>}
 */
export async function waitForLiveServices(apiUrl, { timeoutMs = 300_000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";

  while (Date.now() < deadline) {
    try {
      const result = await fetchJson(`${apiUrl}/api/services`);
      const services = Array.isArray(result.body.services) ? result.body.services : [];
      if (result.status === 200 && requiredServicesReady(services)) {
        return getLiveServiceSummary(apiUrl);
      }
      lastError = `required services not ready (${services.filter((service) => service.lifecycle?.running).length}/${canonicalDemoRequiredServiceIds.length} running)`;
    } catch (error) {
      lastError = error.message;
    }

    await delay(intervalMs);
  }

  throw new Error(`Detached demo recycle did not finish service readiness: ${lastError || "timeout"}.`);
}

/**
 * Returns true when a detached child has exited and is no longer alive.
 *
 * @param {{ code: number | null, signal: string | null } | null} childExit Exit record.
 * @param {boolean} childAlive Live-pid probe result.
 * @returns {boolean}
 */
export function shouldStopWaitingForDetachedChild(childExit, childAlive) {
  return childExit !== null && childAlive !== true;
}

/**
 * Returns true when this recycle invocation should acquire the watchdog recovery lock.
 *
 * @param {NodeJS.ProcessEnv} [env=process.env] Process environment.
 * @returns {boolean}
 */
export function shouldAcquireDetachedRecycleLock(env = process.env) {
  return env[recoveryLockAlreadyHeldEnv] !== "1";
}

function activeLockDescription(lock) {
  const pid = lock.lock?.pid ? ` pid=${lock.lock.pid}` : "";
  return `${lock.reason}${pid}`;
}

async function acquireDetachedRecycleLocks({ timeoutMs = detachedLockWaitTimeoutMs, intervalMs = 1_000 } = {}) {
  if (!shouldAcquireDetachedRecycleLock()) {
    return null;
  }

  const watchdogOptions = resolveWatchdogOptions([
    `--port=${options.port}`,
    `--bind-host=${options.host}`,
    `--runtime-url=${options.runtimeUrl ?? `http://127.0.0.1:${options.port}`}`,
    `--service-admin-url=${options.serviceAdminUrl ?? "http://127.0.0.1:17700/"}`,
  ]);
  const deadline = Date.now() + timeoutMs;
  let lastBlocker = "";

  while (Date.now() < deadline) {
    const legacyLock = await acquireLegacySchedulerLock(watchdogOptions.legacySchedulerLockPath, {
      ttlMs: watchdogOptions.legacySchedulerLockTtlMs,
    });
    if (!legacyLock.acquired) {
      lastBlocker = `legacy scheduled watchdog lock (${activeLockDescription(legacyLock)})`;
      await delay(intervalMs);
      continue;
    }

    const watchdogLock = await acquireWatchdogLock(watchdogOptions.lockPath, { ttlMs: watchdogOptions.lockTtlMs });
    if (watchdogLock.acquired) {
      return {
        watchdogLockPath: watchdogOptions.lockPath,
        legacySchedulerLockPath: watchdogOptions.legacySchedulerLockPath,
      };
    }

    await releaseLegacySchedulerLock(watchdogOptions.legacySchedulerLockPath);
    lastBlocker = `demo watchdog recovery lock (${activeLockDescription(watchdogLock)})`;
    await delay(intervalMs);
  }

  throw new Error(
    `Demo recycle blocked by active demo recovery lock after waiting ${Math.round(timeoutMs / 1000)}s: ${lastBlocker || "unknown lock"}. Wait for scheduled demo:watchdog recovery to finish before retrying.`,
  );
}

/**
 * Builds argv for a foreground recycle worker. Kept for watchdog/hand-off tests.
 *
 * @param {object} [recycleOptions=options] Recycle options.
 * @returns {string[]}
 */
export function buildDetachedRecycleArgs(recycleOptions = options) {
  return [
    path.resolve("scripts", "demo-recycle.mjs"),
    "--foreground",
    "--preserve",
    `--host=${recycleOptions.host}`,
    `--runtime-url=${recycleOptions.runtimeUrl ?? `http://127.0.0.1:${recycleOptions.port}`}`,
    `--admin-url=${recycleOptions.serviceAdminUrl ?? "http://127.0.0.1:17700/"}`,
    `--services-root=${recycleOptions.servicesRoot}`,
    `--workspace-root=${recycleOptions.workspaceRoot}`,
    `--port=${recycleOptions.port}`,
  ];
}

async function waitUntilSignal() {
  await new Promise((resolve) => {
    const shutdown = () => resolve();
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}

async function runRecycleCli() {
  await ensureGitHubTokenEnv();
  const locks = await acquireDetachedRecycleLocks();
  try {
    const result = await runCanonicalDemoRecycle({
      ...options,
      keepAlive: options.foreground === true,
    });
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatCanonicalDemoReport(result));
    }
    if (!result.ok) {
      process.exitCode = 1;
      return;
    }
    if (result.stayResident) {
      await waitUntilSignal();
    }
  } finally {
    if (locks) {
      await releaseWatchdogLock(locks.watchdogLockPath);
      await releaseLegacySchedulerLock(locks.legacySchedulerLockPath);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await runRecycleCli();
}
