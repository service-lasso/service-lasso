// Diagnostic custody only. These records never authorize provider activation
// or replace any consumer/native validator.
import { link, lstat, open, rm, readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

export const OBSERVER_STAGES = Object.freeze(["config", "self_native_identity", "plan", "provider_spawn", "provider_native_identity", "activation", "close", "consumer_terminal"]);
const EVENTS = ["entered", "completed", "failed"];
const SCHEMA = "service-lasso.admin-observer-diagnostic-private.v1";

function validBinding(binding) {
  try {
    return typeof binding?.root === "string" && path.isAbsolute(binding.root)
      && /^[0-9a-f]{64}$/u.test(binding.nonce)
      && /^[0-9a-f]{40}$/u.test(binding.source?.head) && /^[0-9a-f]{40}$/u.test(binding.source?.tree);
  } catch { return false; }
}

async function exclusive(file, value) {
  const staged = `${file}.staging`;
  const handle = await open(staged, "wx", 0o600);
  try { await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8"); await handle.sync(); }
  finally { await handle.close(); }
  try { await link(staged, file); } finally { await rm(staged, { force: true }); }
}

function privateError(error) {
  // Read original own data only, never invoke a hostile getter/toJSON or
  // secondary observer. The primary thrown object is still rethrown unchanged.
  if (error === null || ["string", "number", "boolean", "undefined"].includes(typeof error)) return { thrown: String(error) };
  const fields = {};
  for (const key of ["name", "message", "stack", "code", "signal", "stdout", "stderr"]) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(error, key);
      const value = descriptor?.value;
      if (Buffer.isBuffer(value)) fields[key] = { encoding: "base64", bytes: value.toString("base64") };
      else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) fields[key] = value;
    } catch { /* Original error remains primary even with unreadable fields. */ }
  }
  return fields;
}

export async function retainObserverEvent(binding, stage, event, error) {
  if (!validBinding(binding) || !OBSERVER_STAGES.includes(stage) || !EVENTS.includes(event)) return false;
  try {
    const root = await lstat(binding.root);
    if (!root.isDirectory() || root.isSymbolicLink()) return false;
    const record = { schema: SCHEMA, private: true, nonce: binding.nonce, source: { head: binding.source.head, tree: binding.source.tree }, stage, event };
    if (event === "failed" && arguments.length === 4) {
      // Original error stays entirely private, outside the event projection.
      try { await exclusive(path.join(binding.root, `observer-${stage}-error.json`), { ...record, original: privateError(error) }); } catch { /* Do not replace the primary error. */ }
    }
    await exclusive(path.join(binding.root, `observer-${stage}-${event}.json`), record);
    return true;
  } catch { return false; }
}

async function retainObserverChannels(binding, terminal) {
  if (!validBinding(binding)) return false;
  try {
    const channels = [];
    for (const name of ["observer-stdout.private.log", "observer-stderr.private.log"]) {
      const file = path.join(binding.root, name);
      const metadata = await lstat(file);
      if (!metadata.isFile() || metadata.isSymbolicLink()) return false;
      const bytes = await readFile(file);
      channels.push({ name, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    }
    await exclusive(path.join(binding.root, "observer-channels-close.json"), {
      schema: "service-lasso.admin-observer-private-channels.v1", private: true,
      nonce: binding.nonce, source: { head: binding.source.head, tree: binding.source.tree }, terminal, channels,
      // Direct files have no pipe EOF. This binds observed readback after our
      // exact observer closure, not descendants/exclusion or immutable bytes.
      observation: "observer_closed_readback",
    });
    return true;
  } catch { return false; }
}

export function observerExitWitness(observer, binding) {
  // Error settles the existing failure result, never the separate close witness.
  // Install eventual readback immediately: every later return/throw leaves it
  // attached to this exact child's genuine close event, without a deadline.
  let settleResult, settleClose;
  let settled = false, spawnError = false;
  const result = new Promise((resolve) => { settleResult = resolve; });
  const closed = new Promise((resolve) => { settleClose = resolve; });
  observer.once("error", (error) => {
    spawnError = true;
    if (settled) return;
    settled = true;
    retainObserverEvent(binding, "config", "failed", error).then(() =>
      settleResult({ exitCode: null, signal: null, spawnError: true }));
  });
  observer.once("close", (exitCode, signal) => {
    const terminal = { exitCode, signal, spawnError };
    settleClose(terminal);
    if (!settled) { settled = true; settleResult(terminal); }
  });
  const readback = closed.then((terminal) => retainObserverChannels(binding, terminal));
  return { result, closed, readback };
}

export async function readObserverEventBytes(handle) {
  // Read at most the cap plus one sentinel byte from the held file. A stale
  // lstat must not permit an unbounded read of a replaced or growing leaf.
  const bytes = Buffer.alloc(2049);
  let length = 0;
  while (length < bytes.length) {
    const read = await handle.read(bytes, length, bytes.length - length, length);
    if (read.bytesRead === 0) break;
    length += read.bytesRead;
  }
  return length > 2048 ? null : bytes.subarray(0, length);
}

export function projectObserverEvent(value, binding) {
  if (!validBinding(binding) || !value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const keys = Object.keys(value).sort().join(",");
    if (keys !== "event,nonce,private,schema,source,stage" || Object.values(Object.getOwnPropertyDescriptors(value)).some((entry) => !Object.hasOwn(entry, "value"))) return null;
    if (value.schema !== SCHEMA || value.private !== true || value.nonce !== binding.nonce
      || !value.source || Object.keys(value.source).sort().join(",") !== "head,tree"
      || Object.values(Object.getOwnPropertyDescriptors(value.source)).some((entry) => !Object.hasOwn(entry, "value"))
      || value.source.head !== binding.source.head || value.source.tree !== binding.source.tree
      || !OBSERVER_STAGES.includes(value.stage) || !EVENTS.includes(value.event)) return null;
    return { stage: value.stage, event: value.event };
  } catch { return null; }
}

export async function readObserverDiagnostic(binding) {
  if (!validBinding(binding)) return { stage: "unavailable", event: "unavailable" };
  // A failure wins over later teardown progress. Missing records never imply
  // successful completion of a preceding phase or an OS spawn failure.
  let latest = null, firstFailure = null, damaged = false;
  for (const stage of OBSERVER_STAGES) {
    for (const event of EVENTS) {
      const file = path.join(binding.root, `observer-${stage}-${event}.json`);
      let metadata;
      try { metadata = await lstat(file); }
      catch (error) {
        if (error?.code !== "ENOENT") damaged = true;
        continue; // Only an absent leaf is normal missing future progress.
      }
      let handle;
      try {
        if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 2048) { damaged = true; continue; }
        handle = await open(file, "r");
        const held = await handle.stat();
        if (!held.isFile() || held.size > 2048 || held.dev !== metadata.dev || held.ino !== metadata.ino) { damaged = true; continue; }
        const bytes = await readObserverEventBytes(handle);
        if (!bytes) { damaged = true; continue; }
        const text = bytes.toString("utf8");
        const value = JSON.parse(text);
        // Our exclusive writer emits this exact canonical encoding. Reject
        // duplicate keys or textual additions before projecting lossy JSON.
        if (text !== `${JSON.stringify(value)}\n`) { damaged = true; continue; }
        const projected = projectObserverEvent(value, binding);
        if (!projected || projected.stage !== stage || projected.event !== event) { damaged = true; continue; }
        if (event === "failed") firstFailure ??= projected;
        else latest = projected;
      } catch { damaged = true; }
      finally { if (handle) await handle.close().catch(() => {}); }
    }
  }
  return damaged ? { stage: "unavailable", event: "unavailable" }
    : firstFailure ?? latest ?? { stage: "unavailable", event: "unavailable" };
}
