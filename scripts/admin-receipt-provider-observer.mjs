// Private, detached custody for the Admin browser receipt producer.  The
// consumer is permitted to time out; this process is not.  It owns the child
// and both pipes until the kernel reports their terminal close.
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, open, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const hex40 = /^[0-9a-f]{40}$/u;
const hex64 = /^[0-9a-f]{64}$/u;

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

export async function observeProvider(config) {
  if (!config || typeof config !== "object" || !Array.isArray(config.args) || !required(config.command, /.+/u) || !required(config.root, /.+/u)) throw new Error("observer_config_invalid");
  const source = config.source;
  if (!source || !required(source.head, hex40) || !required(source.tree, hex40) || !required(config.nonce, hex64)) throw new Error("observer_tuple_invalid");
  const root = path.resolve(config.root);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const executable = await executableIdentity(config.command);
  const startedAt = new Date().toISOString();
  const child = spawn(config.command, config.args, { cwd: config.cwd, env: config.env, detached: true, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const initial = {
    schema: "service-lasso.admin-provider-observer-initial.v1", private: true,
    nonce: config.nonce, source, observer: { pid: process.pid, parentPid: process.ppid, platform: process.platform, arch: process.arch, release: os.release() },
    provider: { pid: child.pid, parentPid: process.pid, executable }, inputs: config.inputs, startedAt,
  };
  await exclusiveJson(path.join(root, "initial.json"), initial);
  const streams = [child.stdout, child.stderr].map(() => ({ bytes: 0, hash: createHash("sha256") }));
  [child.stdout, child.stderr].forEach((stream, index) => stream.on("data", (chunk) => { streams[index].bytes += chunk.length; streams[index].hash.update(chunk); }));
  const closed = new Promise((resolve, reject) => { child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal })); });
  const deadline = Number.isSafeInteger(config.timeoutMs) && config.timeoutMs >= 0 ? config.timeoutMs : 300000;
  let unresolved = false;
  const timer = setTimeout(async () => {
    unresolved = true;
    try {
      await exclusiveJson(path.join(root, "unresolved.json"), {
        schema: "service-lasso.admin-provider-observer-unresolved.v1", private: true,
        nonce: config.nonce, source, initial: "initial.json", state: "UNRESOLVED", provider: initial.provider,
      });
    } catch { /* Existing receipt is immutable; an observer never overwrites it. */ }
  }, deadline);
  timer.unref?.();
  const result = await closed;
  clearTimeout(timer);
  await exclusiveJson(path.join(root, "close.json"), {
    schema: "service-lasso.admin-provider-observer-close.v1", private: true,
    nonce: config.nonce, source, unresolved: unresolved ? "unresolved.json" : null, initial: "initial.json",
    provider: initial.provider, terminal: { exitCode: result.code, signal: result.signal },
    streams: streams.map((entry) => ({ bytes: entry.bytes, sha256: entry.hash.digest("hex") })),
  });
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const configPath = process.argv[2];
  if (!configPath) process.exitCode = 2;
  else await observeProvider(JSON.parse(await readFile(configPath, "utf8")));
}
