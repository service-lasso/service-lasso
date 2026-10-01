// Private, detached custody for the Admin browser receipt producer.  The
// consumer is permitted to time out; this process is not.  It owns the child
// and both pipes until the kernel reports their terminal close.
import { createHash, randomBytes } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { mkdir, open, readFile, stat } from "node:fs/promises";
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
  try { await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8"); }
  finally { await handle.close(); }
}

async function executableIdentity(executable) {
  const resolved = path.resolve(executable);
  const metadata = await stat(resolved);
  if (!metadata.isFile() || metadata.size < 1) throw new Error("observer_executable_identity_unavailable");
  return { path: resolved, size: metadata.size, sha256: createHash("sha256").update(await readFile(resolved)).digest("hex") };
}

function required(value, matcher) { return typeof value === "string" && matcher.test(value); }

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
  const root = path.resolve(config.root);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const executable = await executableIdentity(config.command);
  const startedAt = new Date().toISOString();
  // This is deliberately the first mutable custody record.  It is written
  // before the provider can be spawned, so a later timeout is never evidence
  // that a provider was merely intended rather than actually observed.
  const plan = {
    schema: "service-lasso.admin-provider-observer-plan.v1", private: true,
    nonce: config.nonce, source, state: "PLAN", startedAt,
    provider: { executable }, inputs: config.inputs,
  };
  await exclusiveJson(path.join(root, "plan.json"), plan);
  // The activation barrier is durable before spawn.  A provider therefore
  // cannot import its entrypoint or cause provider side effects until this
  // observer has accepted the immutable launch tuple.
  await exclusiveJson(path.join(root, "activation.json"), {
    schema: "service-lasso.admin-provider-observer-activation.v1", private: true,
    nonce: config.nonce, source, plan: "plan.json", state: "ACTIVATED", provider: { executable }, inputs: config.inputs,
  });
  const child = spawn(config.command, config.args, { cwd: config.cwd, env: config.env, detached: true, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  // Install terminal observation before the native birth lookup.  A provider
  // which exits in that narrow window is still closed from the real child and
  // pipe events; we never substitute a pre-launch timestamp as its birth.
  const streams = [child.stdout, child.stderr].map(() => ({ bytes: 0, hash: createHash("sha256"), receipt: receiptObservation() }));
  [child.stdout, child.stderr].forEach((stream, index) => stream.on("data", (chunk) => { streams[index].bytes += chunk.length; streams[index].hash.update(chunk); streams[index].receipt.write(chunk); }));
  const closed = new Promise((resolve) => { child.once("error", () => resolve({ code: null, signal: null, spawnError: true })); child.once("close", (code, signal) => resolve({ code, signal, spawnError: false })); });
  let birth = null;
  let witness = "OBSERVED";
  try { birth = await observedBirth(child.pid); }
  catch { witness = "UNAVAILABLE"; }
  const initial = {
    schema: "service-lasso.admin-provider-observer-initial.v1", private: true,
    nonce: config.nonce, source, observer: { pid: process.pid, parentPid: process.ppid, platform: process.platform, arch: process.arch, release: os.release() },
    plan: "plan.json", activation: "activation.json", witness,
    provider: { pid: child.pid, parentPid: process.pid, birth, executable }, inputs: config.inputs, startedAt,
  };
  await exclusiveJson(path.join(root, "initial.json"), initial);
  const deadline = Number.isSafeInteger(config.timeoutMs) && config.timeoutMs >= 0 ? config.timeoutMs : 300000;
  let unresolved = false;
  const timer = setTimeout(async () => {
    unresolved = true;
    try {
      await exclusiveJson(path.join(root, "unresolved.json"), {
        schema: "service-lasso.admin-provider-observer-unresolved.v1", private: true,
        nonce: config.nonce, source, plan: "plan.json", activation: "activation.json", initial: "initial.json", state: "UNRESOLVED", provider: initial.provider,
      });
    } catch { /* Existing receipt is immutable; an observer never overwrites it. */ }
  }, deadline);
  timer.unref?.();
  const result = await closed;
  clearTimeout(timer);
  await exclusiveJson(path.join(root, "close.json"), {
    schema: "service-lasso.admin-provider-observer-close.v1", private: true,
    nonce: config.nonce, source, plan: "plan.json", activation: "activation.json", unresolved: unresolved ? "unresolved.json" : null, initial: "initial.json",
    provider: initial.provider, terminal: { exitCode: result.code, signal: result.signal, spawnError: result.spawnError },
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
  else await observeProvider(JSON.parse(await readFile(configPath, "utf8")));
}
