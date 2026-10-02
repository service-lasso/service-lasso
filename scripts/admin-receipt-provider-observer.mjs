// Private, detached custody for the Admin browser receipt producer.  The
// consumer is permitted to time out; this process is not.  It owns the child
// and both pipes until the kernel reports their terminal close.
import { createHash, randomBytes } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { lstat, mkdir, open, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseReceipt } from "./consume-admin-trusted-unlock-receipt.mjs";

const hex40 = /^[0-9a-f]{40}$/u;
const hex64 = /^[0-9a-f]{64}$/u;
const execFileAsync = promisify(execFile);

async function exclusiveJson(file, value) {
  const handle = await open(file, "wx", 0o600);
  try { await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8"); await handle.sync(); }
  finally { await handle.close(); }
}

async function executableIdentity(executable) {
  const resolved = path.resolve(executable);
  const metadata = await stat(resolved);
  if (!metadata.isFile() || metadata.size < 1) throw new Error("observer_executable_identity_unavailable");
  return { path: resolved, size: metadata.size, sha256: createHash("sha256").update(await readFile(resolved)).digest("hex") };
}

async function observedIdentity(pid, expectedParentPid) {
  if (!Number.isSafeInteger(pid) || pid < 1 || !Number.isSafeInteger(expectedParentPid) || expectedParentPid < 1) throw new Error("observer_provider_pid_invalid");
  let observed;
  if (process.platform === "win32") {
    const command = `Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\" | Select-Object ProcessId,ParentProcessId,CreationDate,ExecutablePath | ConvertTo-Json -Compress`;
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true, timeout: 5_000 });
    const value = JSON.parse(stdout);
    observed = { pid: value.ProcessId, parentPid: value.ParentProcessId, birth: value.CreationDate, executable: value.ExecutablePath };
  } else {
    const { stdout } = await execFileAsync("ps", ["-o", "ppid=", "-o", "lstart=", "-p", String(pid)], { timeout: 5_000 });
    const match = stdout.trim().match(/^(\d+)\s+(.+)$/u);
    observed = match ? { pid, parentPid: Number(match[1]), birth: match[2], executable: process.platform === "linux" ? (await execFileAsync("readlink", ["-f", `/proc/${pid}/exe`], { timeout: 5_000 })).stdout.trim() : (await execFileAsync("ps", ["-o", "comm=", "-p", String(pid)], { timeout: 5_000 })).stdout.trim() } : null;
  }
  if (!observed || observed.pid !== pid || observed.parentPid !== expectedParentPid || typeof observed.birth !== "string" || observed.birth.length < 1 || typeof observed.executable !== "string" || observed.executable.length < 1) throw new Error("observer_provider_identity_unavailable");
  const executable = await lstat(observed.executable).catch(() => null);
  if (!executable?.isFile() || executable.isSymbolicLink() || executable.size < 1) throw new Error("observer_provider_image_unavailable");
  return { pid, parentPid: observed.parentPid, birth: observed.birth, nativeIdentity: { path: path.resolve(observed.executable), size: executable.size, sha256: createHash("sha256").update(await readFile(observed.executable)).digest("hex") } };
}

function required(value, matcher) { return typeof value === "string" && matcher.test(value); }

function validRuntimeInputs(inputs) {
  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)
    || Object.keys(inputs).sort().join(",") !== "hostPortRegistryPath,instanceRegistryPath,workspaceRoot") return false;
  const values = Object.values(inputs);
  return values.every((value) => typeof value === "string" && path.isAbsolute(value) && !/[\r\n\0]/u.test(value))
    && new Set(values.map((value) => path.resolve(value))).size === values.length;
}

// The observer hashes all provider output but retains only the fixed primitive
// receipt shape.  This keeps the positive shipped path useful without moving
// raw browser output or private values into any custody document.
function receiptObservation() {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let line = "", seen = 0, invalid = false, receipt = null;
  const complete = () => {
    if (!line.includes("service-admin.trusted-unlock-receipt.v1")) { line = ""; return; }
    seen += 1;
    const parsed = line.length <= 256 ? parseReceipt(line) : null;
    if (seen !== 1 || !parsed) invalid = true;
    else receipt = parsed;
    line = "";
  };
  return {
    write(chunk) {
      try {
        for (const character of decoder.decode(chunk, { stream: true })) {
          if (character === "\n" || character === "\r") complete();
          else if (line.length <= 256) line += character;
        }
      } catch { invalid = true; }
    },
    end() {
      try { for (const character of decoder.decode()) { if (character === "\n" || character === "\r") complete(); else if (line.length <= 256) line += character; } } catch { invalid = true; }
      if (line) complete();
      return invalid || seen > 1 ? { classification: "invalid" } : receipt ? { classification: "closed", receipt } : { classification: "missing" };
    },
  };
}

async function observedBirth(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error("observer_provider_pid_invalid");
  if (process.platform === "win32") {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `(Get-Process -Id ${pid}).StartTime.ToUniversalTime().ToString('o')`], { windowsHide: true, timeout: 5_000 });
    const birth = stdout.trim();
    if (!/^\d{4}-\d{2}-\d{2}T/u.test(birth)) throw new Error("observer_provider_birth_unavailable");
    return birth;
  }
  const { stdout } = await execFileAsync("ps", ["-o", "lstart=", "-p", String(pid)], { timeout: 5_000 });
  const birth = stdout.trim();
  if (!birth) throw new Error("observer_provider_birth_unavailable");
  return birth;
}

export async function observeProvider(config) {
  if (!config || typeof config !== "object" || !Array.isArray(config.args) || !required(config.command, /.+/u) || !required(config.root, /.+/u)) throw new Error("observer_config_invalid");
  const source = config.source;
  if (!source || !required(source.head, hex40) || !required(source.tree, hex40) || !required(config.nonce, hex64)) throw new Error("observer_tuple_invalid");
  if (!validRuntimeInputs(config.inputs)) throw new Error("observer_runtime_inputs_invalid");
  const root = path.resolve(config.root);
  if (root !== config.root) throw new Error("observer_root_not_absolute");
  const existingRoot = await lstat(root).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (existingRoot && (!existingRoot.isDirectory() || existingRoot.isSymbolicLink())) throw new Error("observer_root_invalid");
  const parent = await lstat(path.dirname(root));
  if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error("observer_root_parent_invalid");
  if (!existingRoot) await mkdir(root, { mode: 0o700 });
  const rootMetadata = await lstat(root);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) throw new Error("observer_root_invalid");
  const executable = await executableIdentity(config.command);
  // Bind the detached observer itself before it can create its provider.  The
  // consumer uses this exact PID/birth tuple when it later witnesses our exit.
  const observerIdentity = await observedIdentity(process.pid, process.ppid);
  const startedAt = new Date().toISOString();
  // This is deliberately the first mutable custody record.  It is written
  // before the provider can be spawned, so a later timeout is never evidence
  // that a provider was merely intended rather than actually observed.
  const plan = {
    schema: "service-lasso.admin-provider-observer-plan.v2", private: true,
    nonce: config.nonce, source, state: "PLAN", startedAt,
    provider: { executable }, inputs: config.inputs,
  };
  await exclusiveJson(path.join(root, "plan.json"), plan);
  // The observed child is a Node bootstrap that cannot import the supplied
  // provider until this observer writes a native-identity-bound activation.
  // This leaves the actual browser runner in the same OS process, rather than
  // creating an unbound intermediary process tree.
  if (path.resolve(config.command) !== path.resolve(process.execPath)) throw new Error("observer_node_bootstrap_required");
  const bootstrap = path.join(path.dirname(fileURLToPath(import.meta.url)), "admin-receipt-provider-bootstrap.mjs");
  const child = spawn(config.command, [bootstrap, config.configPath, ...config.args], {
    cwd: config.cwd,
    env: { ...config.env, SERVICE_LASSO_ADMIN_PROVIDER_OBSERVER_ROOT: root, SERVICE_LASSO_ADMIN_PROVIDER_OBSERVER_NONCE: config.nonce },
    detached: true, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  // Install terminal observation before the native birth lookup.  A provider
  // which exits in that narrow window is still closed from the real child and
  // pipe events; we never substitute a pre-launch timestamp as its birth.
  const streams = [child.stdout, child.stderr].map(() => ({ bytes: 0, hash: createHash("sha256"), receipt: receiptObservation() }));
  // Each pipe's close event is separately retained in memory before the child
  // close event.  A `close.json` record is never an intention to observe a
  // provider: it is emitted only after the owned OS child and both inherited
  // pipe handles have actually reached their native terminal events.
  const pipeClosure = [child.stdout, child.stderr].map((stream) => new Promise((resolve) => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve(true); } };
    stream.once("close", finish);
    stream.once("error", finish);
  }));
  [child.stdout, child.stderr].forEach((stream, index) => stream.on("data", (chunk) => { streams[index].bytes += chunk.length; streams[index].hash.update(chunk); streams[index].receipt.write(chunk); }));
  const closed = new Promise((resolve) => { child.once("error", () => resolve({ code: null, signal: null, spawnError: true })); child.once("close", (code, signal) => resolve({ code, signal, spawnError: false })); });
  let provider = null;
  try { provider = await observedIdentity(child.pid, process.pid); }
  catch { /* A fast exit is still closed below, but never activated. */ }
  const initial = {
    schema: "service-lasso.admin-provider-observer-initial.v2", private: true,
    nonce: config.nonce, source, observer: { ...observerIdentity, platform: process.platform, arch: process.arch, release: os.release() },
    plan: "plan.json", state: "INITIAL", provider, inputs: config.inputs, startedAt,
  };
  await exclusiveJson(path.join(root, "initial.json"), initial);
  if (provider) {
    const initialBytes = await readFile(path.join(root, "initial.json"));
    await exclusiveJson(path.join(root, "activation.json"), {
      schema: "service-lasso.admin-provider-observer-activation.v2", private: true,
      nonce: config.nonce, source, plan: "plan.json", initial: "initial.json", initialSha256: createHash("sha256").update(initialBytes).digest("hex"),
      state: "ACTIVATED", provider, inputs: config.inputs,
    });
  }
  const deadline = Number.isSafeInteger(config.timeoutMs) && config.timeoutMs >= 0 ? config.timeoutMs : 300000;
  let unresolved = false;
  const timer = setTimeout(async () => {
    unresolved = true;
    try {
      await exclusiveJson(path.join(root, "unresolved.json"), {
        schema: "service-lasso.admin-provider-observer-unresolved.v2", private: true,
        nonce: config.nonce, source, plan: "plan.json", activation: provider ? "activation.json" : null, initial: "initial.json", state: "UNRESOLVED", provider: initial.provider,
      });
    } catch { /* Existing receipt is immutable; an observer never overwrites it. */ }
  }, deadline);
  timer.unref?.();
  const result = await closed;
  await Promise.all(pipeClosure);
  clearTimeout(timer);
  await exclusiveJson(path.join(root, "close.json"), {
    schema: "service-lasso.admin-provider-observer-close.v2", private: true,
    nonce: config.nonce, source, plan: "plan.json", activation: provider ? "activation.json" : null, unresolved: unresolved ? "unresolved.json" : null, initial: "initial.json",
    provider: initial.provider,
    terminal: { exitCode: result.code, signal: result.signal, spawnError: result.spawnError },
    providerTerminal: { childCloseObserved: true, stdoutClosed: true, stderrClosed: true },
    trustedUnlock: (() => {
      const observations = streams.map((entry) => entry.receipt.end());
      const closed = observations.filter((entry) => entry.classification === "closed");
      return observations.some((entry) => entry.classification === "invalid") || closed.length > 1
        ? { classification: "invalid" } : closed[0] ?? { classification: "missing" };
    })(),
    streams: streams.map((entry) => ({ bytes: entry.bytes, sha256: entry.hash.digest("hex") })),
  });
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const configPath = process.argv[2];
  if (!configPath) process.exitCode = 2;
  else await observeProvider({ ...JSON.parse(await readFile(configPath, "utf8")), configPath: path.resolve(configPath) });
}
