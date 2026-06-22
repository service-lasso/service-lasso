import { spawn } from "node:child_process";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalRuntimePort,
  canonicalServiceAdminPort,
  formatCanonicalVerifierResult,
  resolveCanonicalVerifierOptions,
  verifyCanonicalDemo,
} from "./demo-verify-canonical.mjs";
import {
  defaultDemoServicesRoot,
  defaultDemoWorkspaceRoot,
  repoRoot,
  stopDemoManagedProcesses,
} from "./demo-instance-lib.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultHost = "192.168.1.53";

function parseFlag(args, name) {
  const prefix = `--${name}=`;
  for (let index = 0; index < args.length; index += 1) {
    const entry = args[index];
    if (entry.startsWith(prefix)) {
      return entry.slice(prefix.length);
    }
    if (entry === `--${name}` && args[index + 1] && !args[index + 1].startsWith("--")) {
      return args[index + 1];
    }
  }
  return undefined;
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBooleanFlag(args, name) {
  return args.includes(`--${name}`);
}

function parseNpmConfigValue(env, name) {
  const key = `npm_config_${name.replaceAll("-", "_")}`;
  const value = env[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "true" || trimmed === "false") return undefined;
  return trimmed;
}

function inferPositionalRef(args) {
  const positional = args.find((entry) => !entry.startsWith("--") && !entry.startsWith("/"));
  return positional?.trim() || undefined;
}

function normalizePathForCompare(value) {
  const resolved = path.resolve(String(value ?? ""));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function safeUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.search) parsed.search = "?<redacted>";
    return parsed.toString();
  } catch {
    return String(url).replace(/\?.*$/, "?<redacted>");
  }
}

function endpointUrl(baseUrl, endpointPath) {
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const suffix = endpointPath.startsWith("/") ? endpointPath : `/${endpointPath}`;
  return `${base}${suffix}`;
}

function redactError(error) {
  return String(error?.message ?? error).replace(/\?.*?(\s|$)/g, "?<redacted>$1");
}

function parseStatusExpectation(value) {
  const separator = value.lastIndexOf(":");
  if (separator <= 0) {
    throw new Error(`Invalid --expect value ${JSON.stringify(value)}. Use /path:status.`);
  }
  const expectedStatus = Number(value.slice(separator + 1));
  if (!Number.isInteger(expectedStatus) || expectedStatus < 100 || expectedStatus > 599) {
    throw new Error(`Invalid --expect status in ${JSON.stringify(value)}.`);
  }
  return {
    path: value.slice(0, separator),
    expectedStatus,
  };
}

function parseJsonExpectation(value) {
  const separator = value.lastIndexOf(":");
  if (separator <= 0) {
    throw new Error(`Invalid --expect-json value ${JSON.stringify(value)}. Use /path:json.path.`);
  }
  const jsonPath = value.slice(separator + 1).trim();
  if (!jsonPath) {
    throw new Error(`Invalid --expect-json JSON path in ${JSON.stringify(value)}.`);
  }
  return {
    path: value.slice(0, separator),
    jsonPath,
  };
}

function looksLikeStatusExpectation(value) {
  const separator = value.lastIndexOf(":");
  if (separator <= 0) return false;
  const expectedStatus = Number(value.slice(separator + 1));
  return Number.isInteger(expectedStatus) && expectedStatus >= 100 && expectedStatus <= 599;
}

export function parseEndpointExpectations(args = [], env = {}) {
  const statusExpectations = [];
  const jsonExpectations = [];
  const consumed = new Set();

  const npmStatusExpectation = parseNpmConfigValue(env, "expect");
  if (npmStatusExpectation) {
    statusExpectations.push(parseStatusExpectation(npmStatusExpectation));
  }
  const npmJsonExpectation = parseNpmConfigValue(env, "expect-json");
  if (npmJsonExpectation) {
    jsonExpectations.push(parseJsonExpectation(npmJsonExpectation));
  }

  for (let index = 0; index < args.length; index += 1) {
    const entry = args[index];
    if (entry.startsWith("--expect=")) {
      const value = entry.slice("--expect=".length);
      statusExpectations.push(parseStatusExpectation(value));
      consumed.add(index);
      continue;
    }
    if (entry === "--expect" && args[index + 1] && !args[index + 1].startsWith("--")) {
      const value = args[index + 1];
      statusExpectations.push(parseStatusExpectation(value));
      consumed.add(index);
      consumed.add(index + 1);
      index += 1;
      continue;
    }

    if (entry.startsWith("--expect-json=")) {
      const value = entry.slice("--expect-json=".length);
      jsonExpectations.push(parseJsonExpectation(value));
      consumed.add(index);
    }
    if (entry === "--expect-json" && args[index + 1] && !args[index + 1].startsWith("--")) {
      const value = args[index + 1];
      jsonExpectations.push(parseJsonExpectation(value));
      consumed.add(index);
      consumed.add(index + 1);
      index += 1;
    }
  }

  for (let index = 0; index < args.length; index += 1) {
    if (consumed.has(index)) continue;
    const entry = args[index];
    if (!entry.startsWith("/") || !entry.includes(":")) continue;
    if (looksLikeStatusExpectation(entry)) {
      statusExpectations.push(parseStatusExpectation(entry));
    } else {
      jsonExpectations.push(parseJsonExpectation(entry));
    }
  }

  return { statusExpectations, jsonExpectations };
}

export function hasJsonPath(value, jsonPath) {
  const segments = jsonPath.split(".").filter(Boolean);
  if (hasJsonPathAt(value, segments)) {
    return true;
  }
  return hasNestedJsonPath(value, segments);
}

function hasJsonPathAt(value, segments) {
  let current = value;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return false;
      }
      current = current[index];
      continue;
    }
    if (!current || typeof current !== "object" || !Object.hasOwn(current, segment)) {
      return false;
    }
    current = current[segment];
  }
  return current !== undefined && current !== null;
}

function hasNestedJsonPath(value, segments) {
  if (segments.length === 0 || value === null || typeof value !== "object") {
    return false;
  }
  if (hasJsonPathAt(value, segments)) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => hasNestedJsonPath(entry, segments));
  }
  return Object.values(value).some((entry) => hasNestedJsonPath(entry, segments));
}

export function resolveCanonicalDeployOptions(args = process.argv.slice(2), env = process.env) {
  const host = parseFlag(args, "host") ?? env.SERVICE_LASSO_DEMO_HOST ?? defaultHost;
  const runtimePort = parseNumber(parseFlag(args, "runtime-port") ?? parseFlag(args, "port") ?? env.SERVICE_LASSO_PORT, canonicalRuntimePort);
  const serviceAdminPort = parseNumber(parseFlag(args, "service-admin-port") ?? env.SERVICE_LASSO_DEMO_SERVICEADMIN_PORT, canonicalServiceAdminPort);
  const runtimeUrl =
    parseFlag(args, "runtime-url")
    ?? env.SERVICE_LASSO_DEMO_RUNTIME_URL
    ?? `http://${host}:${runtimePort}`;
  const serviceAdminUrl =
    parseFlag(args, "service-admin-url")
    ?? env.SERVICE_LASSO_DEMO_SERVICEADMIN_URL
    ?? `http://${host}:${serviceAdminPort}/`;
  const logsRoot = path.resolve(parseFlag(args, "logs-root") ?? path.join(repoRoot, ".demo-logs"));
  const summaryPath = path.resolve(parseFlag(args, "summary") ?? path.join(logsRoot, "canonical-deploy-summary.json"));
  const ref = parseFlag(args, "ref") ?? env.SERVICE_LASSO_DEMO_DEPLOY_REF ?? parseNpmConfigValue(env, "ref") ?? inferPositionalRef(args);
  const expectations = parseEndpointExpectations(args, env);

  return {
    ref,
    host,
    runtimePort,
    serviceAdminPort,
    runtimeUrl: runtimeUrl.endsWith("/") ? runtimeUrl.slice(0, -1) : runtimeUrl,
    serviceAdminUrl,
    servicesRoot: path.resolve(parseFlag(args, "services-root") ?? env.SERVICE_LASSO_SERVICES_ROOT ?? defaultDemoServicesRoot),
    workspaceRoot: path.resolve(parseFlag(args, "workspace-root") ?? env.SERVICE_LASSO_WORKSPACE_ROOT ?? defaultDemoWorkspaceRoot),
    logsRoot,
    summaryPath,
    forceRecovery: parseBooleanFlag(args, "force-recovery") || parseBooleanFlag(args, "force"),
    timeoutMs: parseNumber(parseFlag(args, "timeout-ms") ?? env.SERVICE_LASSO_DEMO_DEPLOY_TIMEOUT_MS, 15 * 60 * 1000),
    fetchTimeoutMs: parseNumber(parseFlag(args, "fetch-timeout-ms") ?? env.SERVICE_LASSO_DEMO_DEPLOY_FETCH_TIMEOUT_MS, 15_000),
    allowDirtyWorktree: false,
    ...expectations,
  };
}

async function commandResult(command, args, options = {}) {
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      ...options,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("close", (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
    child.once("error", (error) => resolve({ code: 1, stdout: "", stderr: error.message }));
  });
}

async function gitOutput(args) {
  const result = await commandResult("git", args);
  if (result.code !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

async function gitSummary(ref) {
  const [branch, head, refCommit, status] = await Promise.all([
    gitOutput(["branch", "--show-current"]),
    gitOutput(["rev-parse", "HEAD"]),
    gitOutput(["rev-parse", `${ref}^{commit}`]),
    gitOutput(["status", "--porcelain"]),
  ]);
  return {
    branch: branch || "detached",
    head,
    ref,
    refCommit,
    clean: status.length === 0,
    status,
  };
}

async function getProcessCommandEvidence(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return {};
  }

  if (process.platform === "win32") {
    const result = await commandResult("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" | Select-Object -First 1 ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress`,
    ]);
    if (result.code !== 0 || !result.stdout) {
      return {};
    }
    try {
      const parsed = JSON.parse(result.stdout);
      return {
        executablePath: typeof parsed.ExecutablePath === "string" ? parsed.ExecutablePath : null,
        commandLine: typeof parsed.CommandLine === "string" ? parsed.CommandLine : null,
      };
    } catch {
      return {};
    }
  }

  const result = await commandResult("ps", ["-p", String(pid), "-o", "command="]);
  return result.stdout ? { commandLine: result.stdout } : {};
}

async function getListeningPortOwners(port) {
  if (!Number.isInteger(port) || port <= 0) {
    return [];
  }

  if (process.platform === "win32") {
    const result = await commandResult("netstat", ["-ano", "-p", "tcp"]);
    if (result.code !== 0) {
      return [];
    }
    const pids = new Set();
    for (const line of result.stdout.split(/\r?\n/)) {
      const columns = line.trim().split(/\s+/);
      if (columns.length < 5 || columns[0].toUpperCase() !== "TCP" || columns[3].toUpperCase() !== "LISTENING") {
        continue;
      }
      if (columns[1].endsWith(`:${port}`) || columns[1].endsWith(`]:${port}`)) {
        const pid = Number(columns[4]);
        if (Number.isInteger(pid) && pid > 0) {
          pids.add(pid);
        }
      }
    }
    return await Promise.all([...pids].map(async (pid) => ({ pid, ...(await getProcessCommandEvidence(pid)) })));
  }

  const result = await commandResult("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]);
  if (result.code !== 0) {
    return [];
  }
  const pids = new Set();
  for (const line of result.stdout.split(/\r?\n/).slice(1)) {
    const pid = Number(line.trim().split(/\s+/)[1]);
    if (Number.isInteger(pid) && pid > 0) {
      pids.add(pid);
    }
  }
  return await Promise.all([...pids].map(async (pid) => ({ pid, ...(await getProcessCommandEvidence(pid)) })));
}

async function terminatePid(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) {
    return { pid, stopped: false, reason: "invalid_or_current_process" };
  }
  const command = process.platform === "win32" ? "taskkill" : "kill";
  const args = process.platform === "win32" ? ["/pid", String(pid), "/t", "/f"] : ["-TERM", String(pid)];
  const result = await commandResult(command, args);
  return { pid, stopped: result.code === 0, reason: result.code === 0 ? "terminated_by_force_recovery" : result.stderr || result.stdout || "terminate_failed" };
}

async function forceStopOwners(owners) {
  const uniquePids = new Set();
  for (const entry of owners) {
    if (Number.isInteger(entry.pid) && entry.pid > 0) {
      uniquePids.add(entry.pid);
    }
  }
  return await Promise.all([...uniquePids].map((pid) => terminatePid(pid)));
}

function ownerCommandMatchesDemo(owner, options) {
  const commandLine = owner.commandLine ?? "";
  const executablePath = owner.executablePath ?? "";
  const haystack = process.platform === "win32"
    ? `${commandLine}\n${executablePath}`.toLowerCase()
    : `${commandLine}\n${executablePath}`;
  return (
    haystack.includes(normalizePathForCompare(options.workspaceRoot))
    || haystack.includes(normalizePathForCompare(options.servicesRoot))
    || haystack.includes(normalizePathForCompare(path.resolve(repoRoot, "scripts", "demo-recycle.mjs")))
    || haystack.includes(normalizePathForCompare(path.resolve(repoRoot, "scripts", "demo-start.mjs")))
    || haystack.includes(normalizePathForCompare(path.resolve(repoRoot, "dist", "index.js")))
  );
}

async function inspectRequiredPortOwners(options) {
  const checks = [
    { name: "runtime", port: options.runtimePort },
    { name: "serviceadmin", port: options.serviceAdminPort },
  ];

  return await Promise.all(checks.map(async (check) => ({
    ...check,
    owners: await getListeningPortOwners(check.port),
  })));
}

function unmanagedOwners(portOwners, options) {
  return portOwners.flatMap((portOwner) =>
    portOwner.owners
      .filter((owner) => !ownerCommandMatchesDemo(owner, options))
      .map((owner) => ({ ...owner, port: portOwner.port, name: portOwner.name })),
  );
}

async function runRecycle(options, logPath) {
  const stdout = await open(logPath, "a");
  const stderr = await open(logPath, "a");
  const command = process.execPath;
  const args = [
    path.join(repoRoot, "scripts", "demo-recycle.mjs"),
    `--port=${options.runtimePort}`,
    `--services-root=${options.servicesRoot}`,
    `--workspace-root=${options.workspaceRoot}`,
  ];

  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: ["ignore", stdout.fd, stderr.fd],
      windowsHide: true,
      env: {
        ...process.env,
        SERVICE_LASSO_PORT: String(options.runtimePort),
      },
    });
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGTERM");
      resolve({ code: 124, timedOut: true });
    }, options.timeoutMs);
    child.once("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve({ code, timedOut: false });
    });
    child.once("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve({ code: 1, timedOut: false, error: error.message });
    });
  }).finally(async () => {
    await stdout.close();
    await stderr.close();
  });
}

async function probeStatusExpectation(baseUrl, expectation, timeoutMs) {
  const url = endpointUrl(baseUrl, expectation.path);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return {
      type: "status",
      path: expectation.path,
      url: safeUrl(url),
      expectedStatus: expectation.expectedStatus,
      actualStatus: response.status,
      ok: response.status === expectation.expectedStatus,
    };
  } catch (error) {
    return {
      type: "status",
      path: expectation.path,
      url: safeUrl(url),
      expectedStatus: expectation.expectedStatus,
      actualStatus: null,
      ok: false,
      error: redactError(error),
    };
  }
}

async function probeJsonExpectation(baseUrl, expectation, timeoutMs) {
  const url = endpointUrl(baseUrl, expectation.path);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    const body = await response.json();
    const found = response.status >= 200 && response.status < 300 && hasJsonPath(body, expectation.jsonPath);
    return {
      type: "jsonPath",
      path: expectation.path,
      url: safeUrl(url),
      jsonPath: expectation.jsonPath,
      actualStatus: response.status,
      ok: found,
    };
  } catch (error) {
    return {
      type: "jsonPath",
      path: expectation.path,
      url: safeUrl(url),
      jsonPath: expectation.jsonPath,
      actualStatus: null,
      ok: false,
      error: redactError(error),
    };
  }
}

async function runEndpointExpectations(options) {
  const status = await Promise.all(
    options.statusExpectations.map((expectation) =>
      probeStatusExpectation(options.runtimeUrl, expectation, options.fetchTimeoutMs),
    ),
  );
  const json = await Promise.all(
    options.jsonExpectations.map((expectation) =>
      probeJsonExpectation(options.runtimeUrl, expectation, options.fetchTimeoutMs),
    ),
  );
  return [...status, ...json];
}

async function readRuntimeInstance(options) {
  try {
    return JSON.parse(await readFile(path.join(options.workspaceRoot, ".service-lasso", "runtime-instance.json"), "utf8"));
  } catch {
    return null;
  }
}

export async function runCanonicalDeploy(options = resolveCanonicalDeployOptions()) {
  if (!options.ref) {
    throw new Error("Canonical deploy requires --ref=<git-ref-or-commit> so the deployed source is explicit.");
  }

  await mkdir(options.logsRoot, { recursive: true });
  await rm(options.summaryPath, { force: true });
  const startedAt = new Date().toISOString();
  const deployLogPath = path.join(options.logsRoot, "canonical-deploy.log");
  await writeFile(deployLogPath, `[${startedAt}] canonical deploy start ref=${options.ref}\n`, { flag: "a" });

  const startedGit = await gitSummary(options.ref);
  if (!startedGit.clean && !options.allowDirtyWorktree) {
    throw new Error(`Canonical deploy requires a clean worktree before deploy. Dirty status:\n${startedGit.status}`);
  }
  if (startedGit.head !== startedGit.refCommit) {
    throw new Error(`Canonical deploy ref mismatch: current HEAD ${startedGit.head} does not equal ${options.ref} (${startedGit.refCommit}). Checkout the exact ref first, then rerun.`);
  }

  const beforePortOwners = await inspectRequiredPortOwners(options);
  const teardown = await stopDemoManagedProcesses(options);
  const afterManagedStopPortOwners = await inspectRequiredPortOwners(options);
  const unmanaged = unmanagedOwners(afterManagedStopPortOwners, options);
  let forcedStops = [];

  if (unmanaged.length > 0 && !options.forceRecovery) {
    const summary = {
      ok: false,
      startedAt,
      completedAt: new Date().toISOString(),
      ref: options.ref,
      git: startedGit,
      ports: {
        before: beforePortOwners,
        afterManagedStop: afterManagedStopPortOwners,
        unmanaged,
      },
      teardown,
      logs: { deployLogPath, summaryPath: options.summaryPath },
      failure: {
        code: "unmanaged_port_owner",
        message: "Required canonical demo port is owned by a non-managed process. Rerun with --force-recovery only during explicit recovery.",
      },
    };
    await writeFile(options.summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    throw new Error(`${summary.failure.message} Summary: ${options.summaryPath}`);
  }

  if (unmanaged.length > 0 && options.forceRecovery) {
    forcedStops = await forceStopOwners(unmanaged);
    await writeFile(deployLogPath, `[${new Date().toISOString()}] force-recovery stopped pids: ${JSON.stringify(forcedStops)}\n`, { flag: "a" });
  }

  const recycle = await runRecycle(options, deployLogPath);
  const verifierOptions = resolveCanonicalVerifierOptions([
    `--runtime-url=${options.runtimeUrl}`,
    `--service-admin-url=${options.serviceAdminUrl}`,
    `--port=${options.runtimePort}`,
    `--services-root=${options.servicesRoot}`,
    `--workspace-root=${options.workspaceRoot}`,
  ]);
  const verifier = recycle.code === 0
    ? await verifyCanonicalDemo(verifierOptions)
    : { ok: false, checks: [], failures: [{ code: "recycle_failed", detail: recycle.error ?? `exit_${recycle.code}` }], summary: {} };
  await writeFile(deployLogPath, `${formatCanonicalVerifierResult(verifier)}\n`, { flag: "a" });
  const endpointExpectations = recycle.code === 0 ? await runEndpointExpectations(options) : [];
  const endedGit = await gitSummary(options.ref);
  const runtimeInstance = await readRuntimeInstance(options);

  const ok =
    recycle.code === 0
    && verifier.ok
    && endpointExpectations.every((entry) => entry.ok)
    && endedGit.head === startedGit.head
    && endedGit.refCommit === startedGit.refCommit
    && endedGit.clean;

  const summary = {
    ok,
    startedAt,
    completedAt: new Date().toISOString(),
    ref: options.ref,
    git: {
      started: startedGit,
      ended: endedGit,
    },
    urls: {
      runtime: options.runtimeUrl,
      serviceAdmin: options.serviceAdminUrl,
    },
    ports: {
      before: beforePortOwners,
      afterManagedStop: afterManagedStopPortOwners,
      forcedStops,
      afterDeploy: await inspectRequiredPortOwners(options),
    },
    teardown,
    recycle,
    runtimeInstance,
    services: verifier.summary?.services ?? [],
    verifier: {
      ok: verifier.ok,
      checks: verifier.checks ?? [],
      failures: verifier.failures ?? [],
    },
    endpointExpectations,
    logs: {
      deployLogPath,
      summaryPath: options.summaryPath,
      recycleStdout: path.join(options.logsRoot, "demo-recycle.out.log"),
      recycleStderr: path.join(options.logsRoot, "demo-recycle.err.log"),
    },
  };

  if (endedGit.head !== startedGit.head || endedGit.refCommit !== startedGit.refCommit) {
    summary.failure = {
      code: "checkout_changed",
      message: `Checkout changed during deploy: started ${startedGit.head}, ended ${endedGit.head}.`,
    };
  } else if (!endedGit.clean) {
    summary.failure = {
      code: "worktree_changed",
      message: "Worktree changed during deploy.",
    };
  } else if (recycle.code !== 0) {
    summary.failure = {
      code: "recycle_failed",
      message: `demo:recycle exited ${recycle.code}${recycle.timedOut ? " after timeout" : ""}.`,
    };
  } else if (!verifier.ok) {
    summary.failure = {
      code: "canonical_verifier_failed",
      message: "Canonical verifier failed after deploy.",
    };
  } else if (endpointExpectations.some((entry) => !entry.ok)) {
    summary.failure = {
      code: "endpoint_expectation_failed",
      message: "One or more endpoint expectations failed after deploy.",
    };
  }

  await writeFile(options.summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

function printSummary(summary) {
  console.log(JSON.stringify({
    ok: summary.ok,
    ref: summary.ref,
    commit: summary.git.started.head,
    urls: summary.urls,
    runtimePid: summary.runtimeInstance?.pid ?? null,
    serviceTags: summary.services.map((service) => ({
      id: service.id,
      expected: service.expectedTag,
      catalog: service.catalogTag,
      installed: service.installedTag,
    })),
    endpointExpectations: summary.endpointExpectations,
    logs: summary.logs,
    failure: summary.failure ?? null,
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    const summary = await runCanonicalDeploy(resolveCanonicalDeployOptions());
    printSummary(summary);
    process.exitCode = summary.ok ? 0 : 1;
  } catch (error) {
    console.error(redactError(error));
    process.exitCode = 1;
  }
}
