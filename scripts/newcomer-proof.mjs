import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, open, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import { cleanupWorktreeProof, prepareWorktreeProof, resolveWorktreeProofOptions } from "./demo-worktree-proof.mjs";
import { discoverOwningRuntime, observeBoundedJsonObject, waitForBaselineCompletion } from "./runtime-owner.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const proofRootBase = path.join(repoRoot, "newcomer-proof-artifacts");
const leaseRoot = path.join(os.tmpdir(), "service-lasso-newcomer-proof-leases");
const portRangeStart = 21000;
const portRangeEnd = 39000;
const portRangeSize = 160;

function flag(args, name) {
  const prefix = `--${name}=`;
  return args.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

export async function claimProofRoot(proofRoot) {
  await mkdir(path.dirname(proofRoot), { recursive: true });
  // Atomic claim: neither --reuse nor the failure handler may overwrite an
  // existing run. Concurrent claimants must have distinct evidence roots.
  try {
    await mkdir(proofRoot);
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("Proof root already exists. Choose a new --proof-root=<new-folder>.");
    throw error;
  }
}

export function sanitizeEvidence(value) {
  if (Array.isArray(value)) return value.map(sanitizeEvidence);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !/(secret|token|password|credential|private.?key|raw.?config)/iu.test(key))
      .map(([key, entry]) => [key, sanitizeEvidence(entry)]));
  }
  if (typeof value !== "string") return value;
  return value
    .replace(/[A-Za-z]:\\[^\s"']+/gu, "<local-path>")
    .replace(/\/(?:Users|home|tmp|var|private)\/[^\s"']+/gu, "<local-path>")
    .replace(/(token|password|secret)\s*[:=]\s*[^\s,;}]+/giu, "$1=<redacted>");
}

export function publicPlaywrightResult(result) {
  // Raw stdout, errors and Playwright DOM snapshots can contain first-run
  // credentials. Publish only process outcome; keep diagnostics local.
  return { code: result.code, signal: result.signal };
}

async function sha256(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function reservePortRange(proofId) {
  await mkdir(leaseRoot, { recursive: true });
  for (let start = portRangeStart; start + portRangeSize - 1 <= portRangeEnd; start += portRangeSize) {
    const leasePath = path.join(leaseRoot, `${start}-${start + portRangeSize - 1}.json`);
    try {
      const handle = await open(leasePath, "wx");
      const lease = { schema: "service-lasso.newcomer-port-lease.v1", proofId, start, end: start + portRangeSize - 1, pid: process.pid, acquiredAt: new Date().toISOString() };
      await handle.writeFile(`${JSON.stringify(lease)}\n`);
      await handle.close();
      return { ...lease, leasePath };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  throw new Error(`No owned newcomer proof port range remains in ${portRangeStart}-${portRangeEnd}.`);
}

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: repoRoot, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], ...options });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
    child.once("error", (error) => resolve({ code: 1, signal: null, stdout, stderr: `${stderr}${error.message}` }));
  });
}

export function ownedRuntimePortEnvironment(runtimePort) {
  return {
    SERVICE_LASSO_PORT_RANGE_START: String(runtimePort),
    SERVICE_LASSO_PORT_RANGE_END: String(runtimePort + portRangeSize - 1),
  };
}

function startOwnedRuntime(summary) {
  const child = spawn(process.execPath, [
    "dist/cli.js",
    "start",
    "--services-root",
    summary.paths.servicesRoot,
    "--workspace-root",
    summary.paths.workspaceRoot,
    "--port",
    String(summary.ports.runtime),
    "--json",
  ], {
    cwd: repoRoot,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      SERVICE_LASSO_HOST: "127.0.0.1",
      ...ownedRuntimePortEnvironment(summary.ports.runtime),
    },
  });
  let stdout = "";
  let stderr = "";
  const bootstrapOutput = observeBoundedJsonObject(child.stdout);
  void bootstrapOutput.value.catch(() => undefined);
  let exit = null;
  const closed = new Promise((resolve) => child.once("close", (code, signal) => {
    exit = { code, signal };
    resolve(exit);
  }));
  child.stdout?.on("data", (chunk) => { stdout += chunk; });
  child.stderr?.on("data", (chunk) => { stderr += chunk; });
  return { child, pid: child.pid, closed, bootstrapOutput, get exit() { return exit; }, get stdout() { return stdout; }, get stderr() { return stderr; } };
}

async function waitForAdmin(url, owner, timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    if (owner.child.exitCode !== null) throw new Error(`Owned newcomer runtime exited before Admin became ready: ${sanitizeEvidence(owner.stderr).slice(-500)}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      const body = await response.text();
      if (response.ok && /service lasso|services|dashboard/iu.test(body)) return;
      lastError = `Admin returned ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Owned newcomer Admin did not become ready: ${sanitizeEvidence(lastError)}`);
}

async function postJson(url, request = fetch) {
  const response = await request(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`POST ${new URL(url).pathname} returned ${response.status}.`);
  return response.json().catch(() => null);
}

export async function ensureServiceStarted(runtimeUrl, serviceId, request = fetch) {
  const url = `${runtimeUrl}/api/services/${encodeURIComponent(serviceId)}`;
  const response = await request(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`GET ${new URL(url).pathname} returned ${response.status}.`);
  const detail = await response.json();
  const running = detail?.service?.lifecycle?.running;
  if (typeof running !== "boolean") throw new Error(`Missing lifecycle state for ${serviceId}.`);
  if (!running) await postJson(`${url}/start`, request);
}

async function bootstrapOwnedRuntime(summary, owner, timeoutMs = 300_000) {
  const runtime = await discoverOwningRuntime({ owner, servicesRoot: summary.paths.servicesRoot, workspaceRoot: summary.paths.workspaceRoot, publishTimeoutMs: timeoutMs });
  summary.urls.runtime = runtime.apiUrl;
  summary.ports.runtime = Number(new URL(runtime.apiUrl).port);
  await waitForBaselineCompletion({ owner, runtime, output: owner.bootstrapOutput, servicesRoot: summary.paths.servicesRoot, workspaceRoot: summary.paths.workspaceRoot });
  await postJson(`${summary.urls.runtime}/api/setup/bootstrap`);
  for (const serviceId of ["@nginx", "@traefik", "echo-service", "@serviceadmin"]) {
    await ensureServiceStarted(summary.urls.runtime, serviceId);
  }
  const detail = await (await fetch(`${summary.urls.runtime}/api/services/${encodeURIComponent("@serviceadmin")}`, { signal: AbortSignal.timeout(30_000) })).json();
  const uiPort = detail?.service?.lifecycle?.runtime?.ports?.ui;
  if (!Number.isInteger(uiPort) || uiPort <= 0) throw new Error("Owned runtime did not report an Admin UI port.");
  summary.urls.serviceAdmin = `http://127.0.0.1:${uiPort}/`;
}

async function stopResidentDemo(owner) {
  if (!owner || owner.child.exitCode !== null || owner.child.signalCode !== null) return;
  const closed = new Promise((resolve) => owner.child.once("close", resolve));
  owner.child.kill("SIGTERM");
  await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 10_000))]);
  if (owner.child.exitCode === null && owner.child.signalCode === null) owner.child.kill("SIGKILL");
}

async function collectFiles(root, relative = "") {
  const directory = path.join(root, relative);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = {};
  for (const entry of entries) {
    const childRelative = path.join(relative, entry.name);
    if (entry.isDirectory()) Object.assign(files, await collectFiles(root, childRelative));
    if (entry.isFile()) files[childRelative.replaceAll("\\", "/")] = new Uint8Array(await readFile(path.join(root, childRelative)));
  }
  return files;
}

async function writeBundle(bundleRoot, proofId) {
  const zipPath = path.join(path.dirname(bundleRoot), `${proofId}.zip`);
  const archive = zipSync(await collectFiles(bundleRoot), { level: 9 });
  await writeFile(zipPath, archive);
  return { zipPath, sha256: await sha256(zipPath) };
}

async function main() {
  const args = process.argv.slice(2);
  const proofId = (flag(args, "proof-id") ?? `proof-${randomUUID().slice(0, 12)}`).replace(/[^a-zA-Z0-9-]/g, "-");
  const issue = flag(args, "issue") ?? null;
  const suppliedRoot = flag(args, "proof-root");
  const proofRoot = path.resolve(suppliedRoot ?? path.join(proofRootBase, proofId));
  const bundleRoot = path.join(proofRoot, "bundle");
  const runtimeRoot = path.join(proofRoot, "runtime");
  const startedAt = new Date().toISOString();
  const receipt = { schema: "service-lasso.newcomer-proof.v1", proofId, issue, startedAt, platform: process.platform, node: process.version, status: "Blocked", checks: {}, cleanup: null,
    coverage: { implemented: ["first-run handoff", "acknowledgement persistence", "credential re-read denial", "ops route audit and redacted captures"], outstanding: ["service lifecycle and cancellation", "app outcome and controlled failure recovery", "source-package journey", "simultaneous independent folders"] } };
  let lease = null;
  let summary = null;
  let owner = null;
  // Outside try/finally: a rejected root is never ours to write a receipt into.
  await claimProofRoot(proofRoot);
  try {
    await mkdir(path.join(bundleRoot, "screenshots"), { recursive: true });
    lease = await reservePortRange(proofId);
    summary = await prepareWorktreeProof(resolveWorktreeProofOptions([
      `--id=${proofId}`,
      `--proof-root=${runtimeRoot}`,
      `--demo-log-root=${path.join(runtimeRoot, "logs")}`,
      `--port-range-start=${lease.start}`,
      `--port-range-end=${lease.end}`,
      "--json",
    ], process.env));
    receipt.candidate = { commit: summary.owner.commit ?? null, branch: summary.owner.branch ?? null };
    receipt.isolation = { proofId, portRange: `${lease.start}-${lease.end}`, distinctServicesRoot: true, distinctWorkspaceRoot: true, distinctEvidenceRoot: true };
    owner = startOwnedRuntime(summary);
    await bootstrapOwnedRuntime(summary, owner);
    await waitForAdmin(summary.urls.serviceAdmin, owner);
    receipt.checks.runtime = "Verified";
    const playwright = await run(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "--config=playwright.newcomer.config.mjs"], {
      env: {
        ...process.env,
        SERVICE_LASSO_NEWCOMER_ADMIN_URL: summary.urls.serviceAdmin,
        SERVICE_LASSO_NEWCOMER_SCREENSHOT_DIR: path.join(bundleRoot, "screenshots"),
        SERVICE_LASSO_NEWCOMER_PLAYWRIGHT_DIR: path.join(proofRoot, "private-playwright"),
      },
    });
    await writeFile(path.join(proofRoot, "private-playwright-command.json"), `${JSON.stringify(playwright, null, 2)}\n`);
    await writeFile(path.join(bundleRoot, "playwright-command.json"), `${JSON.stringify(publicPlaywrightResult(playwright), null, 2)}\n`);
    if (playwright.code !== 0) throw new Error(`Playwright newcomer suite failed with exit ${playwright.code ?? "unknown"}.`);
    receipt.checks.playwright = "Verified";
    // A passing implemented subset is not a complete newcomer qualification.
    receipt.status = receipt.coverage.outstanding.length ? "Blocked" : "Verified";
  } catch (error) {
    receipt.status = "Invalidated";
    receipt.failure = sanitizeEvidence({
      message: error instanceof Error ? error.message : String(error),
      ownerOutput: owner ? { stdout: owner.stdout.slice(-2_000), stderr: owner.stderr.slice(-2_000) } : null,
    });
  } finally {
    if (summary) {
      try {
        const cleanup = await cleanupWorktreeProof(summary.paths.summaryPath);
        receipt.cleanup = sanitizeEvidence({ status: "Verified", stopped: cleanup.stopped });
      } catch (error) {
        receipt.cleanup = sanitizeEvidence({ status: "Invalidated", message: error instanceof Error ? error.message : String(error) });
        receipt.status = "Invalidated";
      }
    }
    await stopResidentDemo(owner);
    if (lease) await unlink(lease.leasePath).catch(() => undefined);
    receipt.finishedAt = new Date().toISOString();
    await mkdir(bundleRoot, { recursive: true });
    await writeFile(path.join(bundleRoot, "receipt.json"), `${JSON.stringify(sanitizeEvidence(receipt), null, 2)}\n`);
    const bundle = await writeBundle(bundleRoot, proofId);
    console.log(JSON.stringify(sanitizeEvidence({ proofId, status: receipt.status, zip: path.basename(bundle.zipPath), sha256: bundle.sha256, issue }), null, 2));
    if (receipt.status !== "Verified") process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
