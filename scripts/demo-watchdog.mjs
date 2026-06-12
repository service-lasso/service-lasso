import { spawn } from "node:child_process";
import { mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { repoRoot } from "./demo-instance-lib.mjs";

const defaultRuntimePort = 17883;
const defaultDemoHost = "192.168.1.53";
const defaultLockTtlMs = 30 * 60 * 1000;
const defaultLegacySchedulerLockTtlMs = 10 * 60 * 1000;
const defaultRecoveryTimeoutMs = 15 * 60 * 1000;

function parseFlag(args, name) {
  const prefix = `--${name}=`;
  const value = args.find((entry) => entry.startsWith(prefix));
  return value ? value.slice(prefix.length) : undefined;
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveWatchdogOptions(args = process.argv.slice(2), env = process.env) {
  const runtimePort = parseNumber(
    parseFlag(args, "runtime-port") ?? parseFlag(args, "port") ?? env.SERVICE_LASSO_PORT,
    defaultRuntimePort,
  );
  const demoHost = parseFlag(args, "host") ?? env.SERVICE_LASSO_DEMO_HOST ?? defaultDemoHost;
  const serviceAdminUrl =
    parseFlag(args, "service-admin-url")
    ?? env.SERVICE_LASSO_DEMO_SERVICEADMIN_URL
    ?? `http://${demoHost}:17700/`;
  const runtimeHealthUrl =
    parseFlag(args, "runtime-health-url")
    ?? env.SERVICE_LASSO_DEMO_RUNTIME_HEALTH_URL
    ?? `http://${demoHost}:${runtimePort}/api/health`;
  const lockPath =
    parseFlag(args, "lock-path")
    ?? env.SERVICE_LASSO_DEMO_WATCHDOG_LOCK
    ?? path.join(repoRoot, ".demo-logs", "demo-watchdog.lock.json");
  const legacySchedulerLockPath =
    parseFlag(args, "legacy-scheduler-lock-path")
    ?? env.SERVICE_LASSO_DEMO_LEGACY_WATCHDOG_LOCK
    ?? path.join(repoRoot, ".demo-logs", "watchdog.lock");

  return {
    runtimePort,
    serviceAdminUrl,
    runtimeHealthUrl,
    lockPath,
    legacySchedulerLockPath,
    lockTtlMs: parseNumber(parseFlag(args, "lock-ttl-ms") ?? env.SERVICE_LASSO_DEMO_WATCHDOG_LOCK_TTL_MS, defaultLockTtlMs),
    legacySchedulerLockTtlMs: parseNumber(
      parseFlag(args, "legacy-scheduler-lock-ttl-ms") ?? env.SERVICE_LASSO_DEMO_LEGACY_WATCHDOG_LOCK_TTL_MS,
      defaultLegacySchedulerLockTtlMs,
    ),
    recoveryTimeoutMs: parseNumber(
      parseFlag(args, "recovery-timeout-ms") ?? env.SERVICE_LASSO_DEMO_RECOVERY_TIMEOUT_MS,
      defaultRecoveryTimeoutMs,
    ),
    dryRun: args.includes("--dry-run"),
  };
}

export async function checkEndpoint(url, { expectRuntimeHealth = false, timeoutMs = 10_000 } = {}) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    const status = response.status;
    if (status < 200 || status >= 300) {
      return { ok: false, status, reason: `HTTP ${status}` };
    }

    if (expectRuntimeHealth) {
      const body = await response.json();
      if (body?.status !== "ok") {
        return { ok: false, status, reason: `runtime status ${JSON.stringify(body?.status ?? null)}` };
      }
    }

    return { ok: true, status };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

async function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readLock(lockPath) {
  try {
    return JSON.parse(await readFile(lockPath, "utf8"));
  } catch {
    return null;
  }
}

export async function acquireWatchdogLock(lockPath, { ttlMs = defaultLockTtlMs, now = () => new Date() } = {}) {
  await mkdir(path.dirname(lockPath), { recursive: true });
  const existing = await readLock(lockPath);
  const nowDate = now();

  if (existing) {
    const startedAt = Date.parse(existing.startedAt ?? "");
    const ageMs = Number.isFinite(startedAt) ? nowDate.getTime() - startedAt : Number.POSITIVE_INFINITY;
    const stillRunning = await processExists(existing.pid);

    if (stillRunning && ageMs < ttlMs) {
      return {
        acquired: false,
        reason: "recovery_already_running",
        lock: existing,
      };
    }

    await rm(lockPath, { force: true });
  }

  const lock = {
    pid: process.pid,
    startedAt: nowDate.toISOString(),
    ttlMs,
  };

  try {
    const handle = await open(lockPath, "wx");
    await handle.writeFile(`${JSON.stringify(lock, null, 2)}\n`);
    await handle.close();
    return { acquired: true, lock };
  } catch {
    return {
      acquired: false,
      reason: "lock_race_lost",
      lock: await readLock(lockPath),
    };
  }
}

export async function releaseWatchdogLock(lockPath) {
  const existing = await readLock(lockPath);
  if (existing?.pid === process.pid) {
    await rm(lockPath, { force: true });
  }
}

async function readLegacySchedulerLock(lockPath) {
  try {
    const [raw, fileStat] = await Promise.all([
      readFile(lockPath, "utf8").catch(() => ""),
      stat(lockPath),
    ]);
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {}
    return { raw, parsed, mtimeMs: fileStat.mtimeMs };
  } catch {
    return null;
  }
}

export async function acquireLegacySchedulerLock(
  lockPath,
  { ttlMs = defaultLegacySchedulerLockTtlMs, now = () => new Date() } = {},
) {
  await mkdir(path.dirname(lockPath), { recursive: true });
  const existing = await readLegacySchedulerLock(lockPath);
  const nowMs = now().getTime();

  if (existing) {
    const ageMs = nowMs - existing.mtimeMs;
    if (ageMs < ttlMs) {
      return {
        acquired: false,
        reason: "legacy_recovery_already_running",
        lock: existing.parsed ?? { raw: existing.raw.trim(), ageMs },
      };
    }
    await rm(lockPath, { force: true });
  }

  const lock = {
    owner: "service-lasso-demo-recycle",
    pid: process.pid,
    startedAt: new Date(nowMs).toISOString(),
    ttlMs,
  };

  try {
    const handle = await open(lockPath, "wx");
    await handle.writeFile(`${JSON.stringify(lock, null, 2)}\n`);
    await handle.close();
    return { acquired: true, lock };
  } catch {
    const raced = await readLegacySchedulerLock(lockPath);
    return {
      acquired: false,
      reason: "legacy_lock_race_lost",
      lock: raced?.parsed ?? { raw: raced?.raw?.trim() ?? "" },
    };
  }
}

export async function releaseLegacySchedulerLock(lockPath) {
  const existing = await readLegacySchedulerLock(lockPath);
  if (existing?.parsed?.owner === "service-lasso-demo-recycle" && existing.parsed.pid === process.pid) {
    await rm(lockPath, { force: true });
  }
}

export function buildRecoveryCommand(options) {
  return {
    command: process.platform === "win32" ? "npm.cmd" : "npm",
    args: ["run", "demo:recycle", "--", `--port=${options.runtimePort}`],
    env: {
      SERVICE_LASSO_PORT: String(options.runtimePort),
      SERVICE_LASSO_DEMO_RECOVERY_LOCK_HELD: "1",
    },
  };
}

async function runRecovery(options) {
  const recovery = buildRecoveryCommand(options);
  const logRoot = path.join(repoRoot, ".demo-logs");
  await mkdir(logRoot, { recursive: true });
  const logPath = path.join(logRoot, "demo-watchdog-recovery.log");
  const startedAt = new Date().toISOString();
  await writeFile(logPath, `[${startedAt}] starting recovery: ${recovery.command} ${recovery.args.join(" ")}\n`, { flag: "a" });

  return await new Promise((resolve) => {
    const child = spawn(recovery.command, recovery.args, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        ...recovery.env,
      },
    });
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGTERM");
      resolve({ code: 124, logPath, timedOut: true });
    }, options.recoveryTimeoutMs);

    child.stdout.on("data", (chunk) => {
      void writeFile(logPath, chunk, { flag: "a" });
    });
    child.stderr.on("data", (chunk) => {
      void writeFile(logPath, chunk, { flag: "a" });
    });
    child.once("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve({ code, logPath, timedOut: false });
    });
    child.once("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      void writeFile(logPath, `\n${error.message}\n`, { flag: "a" });
      resolve({ code: 1, logPath, timedOut: false });
    });
  });
}

export async function runWatchdog(options = resolveWatchdogOptions()) {
  const serviceAdmin = await checkEndpoint(options.serviceAdminUrl);
  const runtimeHealth = await checkEndpoint(options.runtimeHealthUrl, { expectRuntimeHealth: true });
  const healthy = serviceAdmin.ok && runtimeHealth.ok;

  if (healthy) {
    return { ok: true, recovered: false, serviceAdmin, runtimeHealth };
  }

  if (options.dryRun) {
    return { ok: false, recovered: false, dryRun: true, serviceAdmin, runtimeHealth };
  }

  const lock = await acquireWatchdogLock(options.lockPath, { ttlMs: options.lockTtlMs });
  if (!lock.acquired) {
    return { ok: false, recovered: false, blockedByLock: true, lock, serviceAdmin, runtimeHealth };
  }

  try {
    const recovery = await runRecovery(options);
    const recoveredServiceAdmin = await checkEndpoint(options.serviceAdminUrl);
    const recoveredRuntimeHealth = await checkEndpoint(options.runtimeHealthUrl, { expectRuntimeHealth: true });
    return {
      ok: recovery.code === 0 && recoveredServiceAdmin.ok && recoveredRuntimeHealth.ok,
      recovered: recovery.code === 0,
      recovery,
      serviceAdmin: recoveredServiceAdmin,
      runtimeHealth: recoveredRuntimeHealth,
    };
  } finally {
    await releaseWatchdogLock(options.lockPath);
  }
}

function printResult(result, options) {
  console.log("[service-lasso demo] watchdog result");
  console.log(`- runtimePort: ${options.runtimePort}`);
  console.log(`- serviceAdmin: ${result.serviceAdmin.ok ? "ok" : "down"} ${options.serviceAdminUrl} ${result.serviceAdmin.status ?? result.serviceAdmin.reason}`);
  console.log(`- runtimeHealth: ${result.runtimeHealth.ok ? "ok" : "down"} ${options.runtimeHealthUrl} ${result.runtimeHealth.status ?? result.runtimeHealth.reason}`);
  console.log(`- recovered: ${result.recovered === true}`);
  if (result.blockedByLock) {
    console.log(`- blocked: ${result.lock.reason}`);
  }
  if (result.recovery?.logPath) {
    console.log(`- recoveryLog: ${result.recovery.logPath}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = resolveWatchdogOptions();
  const result = await runWatchdog(options);
  printResult(result, options);
  process.exitCode = result.ok ? 0 : 1;
}
