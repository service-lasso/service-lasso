import { spawn } from "node:child_process";
import { access, lstat, mkdir, open, readFile, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SCHEMA = "service-admin.trusted-unlock-receipt.v1";
const REQUIRED_KEYS = new Set(["schema", "status", "present", "verified", "localRoot", "loading", "unavailable"]);
const MAX_RECORD_LENGTH = 256;
const MAX_CHUNK_SLICE_BYTES = 8_192;
const MAX_OBSERVED_BYTES = 65_536;
// After the 64 KiB parser cap, continue draining a bounded finite amount so
// an owned fixture can acknowledge its complete 128 KiB write before exit.
// No discarded byte is decoded, retained, or included in a receipt.
const MAX_DISCARD_BYTES = 131_072;
const PIPE_CLOSE_TIMEOUT_MS = 500;
const PROPAGATED_SIGNALS = new Set(["SIGTERM", "SIGINT", "SIGHUP"]);

async function exclusiveJson(file, value) {
  const handle = await open(file, "wx", 0o600);
  try { await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8"); await handle.sync(); }
  finally { await handle.close(); }
}

function parseString(source, start) {
  if (source[start] !== '"') return null;
  let index = start + 1;
  while (index < source.length) {
    const character = source[index];
    if (character === '"') {
      const raw = source.slice(start, index + 1);
      try { return { value: JSON.parse(raw), next: index + 1 }; } catch { return null; }
    }
    if (character === "\\") {
      index += 1;
      if (index >= source.length) return null;
    } else if (character.charCodeAt(0) < 0x20) return null;
    index += 1;
  }
  return null;
}

function skipWhitespace(source, index) {
  while (index < source.length && /[ \t\n\r]/u.test(source[index])) index += 1;
  return index;
}

function parseBoolean(source, index) {
  if (source.startsWith("true", index)) return { value: true, next: index + 4 };
  if (source.startsWith("false", index)) return { value: false, next: index + 5 };
  return null;
}

// Tokenizing member names before materializing an object prevents escaped
// duplicate keys from disappearing during JSON.parse object construction.
export function parseReceipt(line) {
  if (typeof line !== "string" || line.length < 2 || line.length > MAX_RECORD_LENGTH) return null;
  let index = skipWhitespace(line, 0);
  if (line[index] !== "{") return null;
  index += 1;
  const fields = Object.create(null);
  const seen = new Set();
  for (;;) {
    index = skipWhitespace(line, index);
    if (line[index] === "}") { index += 1; break; }
    const key = parseString(line, index);
    if (!key || !REQUIRED_KEYS.has(key.value) || seen.has(key.value)) return null;
    seen.add(key.value);
    index = skipWhitespace(line, key.next);
    if (line[index] !== ":") return null;
    index = skipWhitespace(line, index + 1);
    const value = key.value === "schema" || key.value === "status" ? parseString(line, index) : parseBoolean(line, index);
    if (!value) return null;
    fields[key.value] = value.value;
    index = skipWhitespace(line, value.next);
    if (line[index] === ",") { index += 1; continue; }
    if (line[index] === "}") { index += 1; break; }
    return null;
  }
  if (skipWhitespace(line, index) !== line.length || seen.size !== REQUIRED_KEYS.size) return null;
  if (fields.schema !== SCHEMA || fields.status !== "observed") return null;
  if (fields.present !== (fields.verified || fields.localRoot || fields.loading || fields.unavailable)) return null;
  return { schema: fields.schema, status: fields.status, present: fields.present, verified: fields.verified, localRoot: fields.localRoot, loading: fields.loading, unavailable: fields.unavailable };
}

// JSON.parse intentionally accepts duplicate object members by keeping the
// last one. Consumer receipts are custody inputs, so reject them before that
// lossy materialization can occur.
export function strictJson(source) {
  if (typeof source !== "string") return null;
  const parseValue = (start) => {
    let index = skipWhitespace(source, start);
    if (source[index] === '"') return parseString(source, index);
    if (source[index] === "{") {
      index += 1;
      const keys = new Set();
      for (;;) {
        index = skipWhitespace(source, index);
        if (source[index] === "}") return { next: index + 1 };
        const key = parseString(source, index);
        if (!key || keys.has(key.value)) return null;
        keys.add(key.value);
        index = skipWhitespace(source, key.next);
        if (source[index] !== ":") return null;
        const value = parseValue(index + 1);
        if (!value) return null;
        index = skipWhitespace(source, value.next);
        if (source[index] === "}") return { next: index + 1 };
        if (source[index] !== ",") return null;
        index += 1;
      }
    }
    if (source[index] === "[") {
      index += 1;
      index = skipWhitespace(source, index);
      if (source[index] === "]") return { next: index + 1 };
      for (;;) {
        const value = parseValue(index);
        if (!value) return null;
        index = skipWhitespace(source, value.next);
        if (source[index] === "]") return { next: index + 1 };
        if (source[index] !== ",") return null;
        index += 1;
      }
    }
    for (const literal of ["true", "false", "null"]) if (source.startsWith(literal, index)) return { next: index + literal.length };
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(source.slice(index));
    return number ? { next: index + number[0].length } : null;
  };
  const value = parseValue(0);
  return value && skipWhitespace(source, value.next) === source.length ? source : null;
}

export function classify(lines) {
  let seen = 0;
  let candidate = null;
  for (const line of lines) {
    if (typeof line !== "string" || !line.includes(SCHEMA)) continue;
    seen = Math.min(2, seen + 1);
    if (seen === 1) candidate = parseReceipt(line);
  }
  if (!seen) return { classification: "missing" };
  if (seen !== 1 || !candidate) return { classification: "invalid" };
  return { classification: "closed", receipt: candidate };
}

export function parseConsumerReceipt(source) {
  if (!strictJson(source)) return null;
  let value;
  try { value = JSON.parse(source); } catch { return null; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value).sort();
  const allowed = ["executionFailure", "exitCode", "outcome", "schema", "signal", "streamFailure", "trustedUnlock"];
  if (keys.some((key) => !allowed.includes(key))) return null;
  if (value.schema !== "service-lasso.admin-trusted-unlock-consumer.v1" || !["success", "nonzero_exit", "signal", "observation_failure"].includes(value.outcome)) return null;
  if (!(value.exitCode === null || (Number.isSafeInteger(value.exitCode) && value.exitCode >= 0 && value.exitCode <= 255))) return null;
  if (!(value.signal === null || /^[A-Z0-9_]{1,32}$/u.test(value.signal))) return null;
  if (value.exitCode !== null && value.signal !== null) return null;
  if (value.streamFailure !== undefined && !["pipe_hang", "stream_budget_exceeded", "malformed_utf8"].includes(value.streamFailure)) return null;
  if (value.executionFailure !== undefined && !["execution_timeout", "spawn_failed", "observer_terminal_unresolved"].includes(value.executionFailure)) return null;
  if (value.streamFailure !== undefined && value.executionFailure !== undefined) return null;
  if (value.outcome === "success" && (value.exitCode !== 0 || value.signal !== null || value.streamFailure !== undefined || value.executionFailure !== undefined)) return null;
  if (value.outcome === "nonzero_exit" && (value.exitCode <= 0 || value.signal !== null || value.streamFailure !== undefined || value.executionFailure !== undefined)) return null;
  if (value.outcome === "signal" && (value.exitCode !== null || value.signal === null || value.streamFailure !== undefined || value.executionFailure !== undefined)) return null;
  if (value.outcome === "observation_failure" && (value.streamFailure === undefined) === (value.executionFailure === undefined)) return null;
  const trusted = value.trustedUnlock;
  if (trusted === null && value.outcome !== "success") return null;
  if (trusted !== null) {
    if (!trusted || typeof trusted !== "object" || Array.isArray(trusted)) return null;
    if (trusted.classification === "closed") {
      if (Object.keys(trusted).sort().join(",") !== "classification,receipt" || !parseReceipt(JSON.stringify(trusted.receipt))) return null;
    } else if ((trusted.classification === "missing" || trusted.classification === "invalid" || trusted.classification === "not_emitted") && Object.keys(trusted).length === 1) {
      // Closed classifications are the only form permitted to carry primitives.
    } else return null;
  }
  if (value.outcome === "success" && trusted?.classification !== "not_emitted") return null;
  if (trusted?.classification === "not_emitted" && value.outcome !== "success") return null;
  return value;
}

export function hasObservedConsumerReceipt(receipt) {
  if (!receipt) return false;
  if (receipt.outcome === "success") return receipt.exitCode === 0 && receipt.signal === null && receipt.streamFailure === undefined && receipt.executionFailure === undefined && receipt.trustedUnlock?.classification === "not_emitted";
  return receipt.trustedUnlock?.classification === "closed";
}

// A parsed failed consumer can safely retain only its closed diagnostic
// classification even when the trusted-unlock record was unavailable. That
// custody record is not qualification evidence; hasObservedConsumerReceipt
// remains the stricter successful-observation predicate.
export function isRetainableConsumerReceipt(receipt) {
  if (!receipt) return false;
  if (receipt.outcome === "success") return hasObservedConsumerReceipt(receipt);
  return ["closed", "missing", "invalid"].includes(receipt.trustedUnlock?.classification);
}

function receiptObserver() {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let line = "", markerIndex = 0, sawSchema = false, oversized = false;
  let seen = 0, duplicate = false, candidate = null, failure = null;
  let observedBytes = 0, discardBytes = 0, disposed = false;
  let ended = false, finalObservation = null;
  const complete = () => {
    if (sawSchema) {
      if (seen) duplicate = true;
      else candidate = oversized ? null : parseReceipt(line);
      seen = 1;
    }
    line = "";
    markerIndex = 0;
    sawSchema = false;
    oversized = false;
  };
  const acceptText = (text) => {
    for (const character of text) {
      if (character === "\n" || character === "\r") { complete(); continue; }
      if (line.length < MAX_RECORD_LENGTH) line += character;
      else oversized = true;
      markerIndex = character === SCHEMA[markerIndex] ? markerIndex + 1 : character === SCHEMA[0] ? 1 : 0;
      if (markerIndex === SCHEMA.length) sawSchema = true;
    }
  };
  return {
    write(chunk) {
      if (!Buffer.isBuffer(chunk) || disposed) return;
      if (failure) {
        discardBytes += Math.min(chunk.length, MAX_DISCARD_BYTES - discardBytes);
        if (discardBytes >= MAX_DISCARD_BYTES) disposed = true;
        return;
      }
      if (observedBytes + chunk.length > MAX_OBSERVED_BYTES) {
        failure = "stream_budget_exceeded";
        discardBytes = Math.min(chunk.length, MAX_DISCARD_BYTES);
        if (discardBytes >= MAX_DISCARD_BYTES) disposed = true;
        return;
      }
      observedBytes += chunk.length;
      try {
        for (let offset = 0; offset < chunk.length; offset += MAX_CHUNK_SLICE_BYTES) {
          acceptText(decoder.decode(chunk.subarray(offset, offset + MAX_CHUNK_SLICE_BYTES), { stream: true }));
        }
      } catch { failure = "malformed_utf8"; }
    },
    shouldDispose() { return disposed; },
    end() {
      if (ended) return finalObservation;
      ended = true;
      if (!failure) {
        try { acceptText(decoder.decode()); } catch { failure = "malformed_utf8"; }
      }
      if (line || sawSchema) complete();
      finalObservation = { seen, duplicate, candidate, failure };
      return finalObservation;
    },
  };
}

function classifyObservations(observations) {
  let seen = 0;
  let candidate = null;
  for (const observation of observations) {
    if (observation.failure) return { classification: "invalid" };
    if (!observation.seen) continue;
    if (seen || observation.duplicate || !observation.candidate) return { classification: "invalid" };
    seen = 1;
    candidate = observation.candidate;
  }
  return seen ? { classification: "closed", receipt: candidate } : { classification: "missing" };
}

export async function consume(command, args, options = {}) {
  let child;
  try {
    child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  } catch {
    return {
      code: null,
      signal: null,
      executionFailure: "spawn_failed",
      streamFailure: null,
      trustedUnlock: { classification: "missing" },
    };
  }
  const observers = [receiptObserver(), receiptObserver()];
  const streamClosed = [];
  for (const [stream, observer] of [[child.stdout, observers[0]], [child.stderr, observers[1]]]) {
    const settled = new Promise((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        resolve(observer.end());
      };
      stream.once("end", finish);
      stream.once("close", finish);
      stream.once("error", finish);
    });
    stream.on("data", (chunk) => {
      observer.write(chunk);
      if (observer.shouldDispose() && !stream.destroyed) stream.destroy();
    });
    stream.on("error", () => {});
    streamClosed.push({ stream, settled });
  }
  let timedOut = false;
  const result = await new Promise((resolve) => {
    let timer = null;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timeoutMs = options.timeoutMs;
    const onTimeout = () => {
      timedOut = true;
      // A consumer owns observation, not the provider's lifetime. Keep the
      // timeout as the primary failure, then wait for this exact child and its
      // pipes to close naturally. Returning here would retire a still-live
      // provider without an exit/signal correlation; sending SIGTERM/SIGKILL
      // would manufacture the outcome being observed.
    };
    if (Number.isFinite(timeoutMs) && timeoutMs >= 0) timer = setTimeout(onTimeout, timeoutMs);
    child.once("error", () => {
      finish({ code: null, signal: null, executionFailure: "spawn_failed" });
    });
    child.once("exit", (code, signal) => {
      finish({ code, signal, executionFailure: timedOut ? "execution_timeout" : null });
    });
  });
  let pipeHang = false;
  let pipeTimer;
  const observations = await Promise.race([
    Promise.all(streamClosed.map(({ settled }) => settled)),
    new Promise((resolve) => {
      pipeTimer = setTimeout(() => { pipeHang = true; resolve(null); }, options.pipeCloseTimeoutMs ?? PIPE_CLOSE_TIMEOUT_MS);
    }),
  ]);
  clearTimeout(pipeTimer);
  if (pipeHang) {
    for (const { stream } of streamClosed) if (!stream.destroyed) stream.destroy();
  }
  const finalized = observations ?? streamClosed.map(({ stream }) => ({ seen: 0, duplicate: false, candidate: null, failure: pipeHang && stream.destroyed ? "pipe_hang" : null }));
  const streamFailure = pipeHang ? "pipe_hang" : finalized.find((observation) => observation.failure)?.failure ?? null;
  return { ...result, trustedUnlock: result.code === 0 && result.signal === null && !result.executionFailure && !streamFailure ? { classification: "not_emitted" } : classifyObservations(finalized), streamFailure };
}

async function waitForPrivateObserver(root, names, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    for (const name of names) {
      const candidate = path.join(root, name);
      try { await access(candidate); return candidate; } catch { /* keep polling */ }
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return null;
}

function exactKeys(value, keys) {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function sameTuple(value, nonce, source) {
  return value?.nonce === nonce && value?.source?.head === source.head && value?.source?.tree === source.tree;
}

function validRuntimeInputs(inputs) {
  if (!exactKeys(inputs, ["workspaceRoot", "instanceRegistryPath", "hostPortRegistryPath"])) return false;
  const values = Object.values(inputs);
  return values.every((value) => typeof value === "string" && path.isAbsolute(value) && !/[\r\n\0]/u.test(value))
    && new Set(values.map((value) => path.resolve(value))).size === values.length;
}

async function privateJson(root, name) {
  const file = path.join(root, name);
  let metadata, text;
  try { metadata = await lstat(file); text = await readFile(file, "utf8"); } catch { return null; }
  if (!metadata.isFile() || metadata.isSymbolicLink() || !strictJson(text)) return null;
  try { return JSON.parse(text); } catch { return null; }
}

async function validateObserverTerminal(root, nonce, source, wantClose) {
  const rootMetadata = await lstat(root).catch(() => null);
  if (!rootMetadata?.isDirectory() || rootMetadata.isSymbolicLink()) return null;
  const plan = await privateJson(root, "plan.json");
  const activation = await privateJson(root, "activation.json");
  const initial = await privateJson(root, "initial.json");
  const terminal = await privateJson(root, wantClose ? "close.json" : "unresolved.json");
  if (!exactKeys(plan, ["schema", "private", "nonce", "source", "state", "startedAt", "provider", "inputs"])
    || plan.schema !== "service-lasso.admin-provider-observer-plan.v2" || plan.private !== true || plan.state !== "PLAN" || !sameTuple(plan, nonce, source)
    || !validRuntimeInputs(plan.inputs)
    || !exactKeys(plan.provider, ["executable"]) || !exactKeys(plan.provider.executable, ["path", "size", "sha256"])
    || typeof plan.provider.executable.path !== "string" || !Number.isSafeInteger(plan.provider.executable.size) || !/^[0-9a-f]{64}$/u.test(plan.provider.executable.sha256)) return null;
  if (!exactKeys(initial, ["schema", "private", "nonce", "source", "observer", "plan", "state", "provider", "inputs", "startedAt"])
    || initial.schema !== "service-lasso.admin-provider-observer-initial.v2" || initial.private !== true || initial.state !== "INITIAL" || !sameTuple(initial, nonce, source)
    || !validRuntimeInputs(initial.inputs) || JSON.stringify(initial.inputs) !== JSON.stringify(plan.inputs)
    || initial.plan !== "plan.json"
    || !exactKeys(initial.observer, ["pid", "parentPid", "birth", "nativeIdentity", "platform", "arch", "release"])
    || !Number.isSafeInteger(initial.observer.pid) || initial.observer.pid < 1 || !Number.isSafeInteger(initial.observer.parentPid) || initial.observer.parentPid < 1
    || typeof initial.observer.birth !== "string" || initial.observer.birth.length < 1
    || !exactKeys(initial.observer.nativeIdentity, ["path", "size", "sha256"])
    || typeof initial.observer.nativeIdentity.path !== "string" || !Number.isSafeInteger(initial.observer.nativeIdentity.size) || initial.observer.nativeIdentity.size < 1
    || !/^[0-9a-f]{64}$/u.test(initial.observer.nativeIdentity.sha256)
    || !exactKeys(initial.provider, ["pid", "parentPid", "birth", "nativeIdentity"])
    || !Number.isSafeInteger(initial.provider.pid) || initial.provider.pid < 1 || !Number.isSafeInteger(initial.provider.parentPid) || initial.provider.parentPid < 1
    || initial.provider.parentPid !== initial.observer?.pid || typeof initial.provider.birth !== "string" || initial.provider.birth.length < 1
    || !exactKeys(initial.provider.nativeIdentity, ["path", "size", "sha256"])
    || typeof initial.provider.nativeIdentity.path !== "string" || !Number.isSafeInteger(initial.provider.nativeIdentity.size) || initial.provider.nativeIdentity.size < 1
    || !/^[0-9a-f]{64}$/u.test(initial.provider.nativeIdentity.sha256)) return null;
  if (!exactKeys(activation, ["schema", "private", "nonce", "source", "plan", "initial", "initialSha256", "state", "provider", "inputs"])
    || activation.schema !== "service-lasso.admin-provider-observer-activation.v2" || activation.private !== true || activation.plan !== "plan.json" || activation.initial !== "initial.json" || activation.state !== "ACTIVATED"
    || !sameTuple(activation, nonce, source) || !validRuntimeInputs(activation.inputs) || JSON.stringify(activation.inputs) !== JSON.stringify(plan.inputs)
    || JSON.stringify(activation.provider) !== JSON.stringify(initial.provider)
    || !/^[0-9a-f]{64}$/u.test(activation.initialSha256)) return null;
  let initialDigest;
  try { initialDigest = createHash("sha256").update(await readFile(path.join(root, "initial.json"), "utf8")).digest("hex"); } catch { return null; }
  if (activation.initialSha256 !== initialDigest) return null;
  if (!wantClose) {
    if (!exactKeys(terminal, ["schema", "private", "nonce", "source", "plan", "activation", "initial", "state", "provider"])
      || terminal.schema !== "service-lasso.admin-provider-observer-unresolved.v2" || terminal.private !== true || terminal.plan !== "plan.json" || terminal.activation !== "activation.json" || terminal.initial !== "initial.json"
      || terminal.state !== "UNRESOLVED" || !sameTuple(terminal, nonce, source) || JSON.stringify(terminal.provider) !== JSON.stringify(initial.provider)) return null;
    return { unresolved: true };
  }
  if (!exactKeys(terminal, ["schema", "private", "nonce", "source", "plan", "activation", "unresolved", "initial", "provider", "terminal", "trustedUnlock", "streams"])
    || terminal.schema !== "service-lasso.admin-provider-observer-close.v2" || terminal.private !== true || terminal.plan !== "plan.json" || terminal.activation !== "activation.json" || terminal.initial !== "initial.json"
    || !sameTuple(terminal, nonce, source) || JSON.stringify(terminal.provider) !== JSON.stringify(initial.provider)
    || !exactKeys(terminal.terminal, ["exitCode", "signal", "spawnError"])
    || typeof terminal.terminal.spawnError !== "boolean" || !Array.isArray(terminal.streams) || terminal.streams.length !== 2
    || terminal.streams.some((entry) => !exactKeys(entry, ["bytes", "sha256"]) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || !/^[0-9a-f]{64}$/u.test(entry.sha256))
    || !["missing", "invalid", "closed"].includes(terminal.trustedUnlock?.classification)
    || (terminal.trustedUnlock.classification === "closed" && (!exactKeys(terminal.trustedUnlock, ["classification", "receipt"]) || !parseReceipt(JSON.stringify(terminal.trustedUnlock.receipt))))
    || (terminal.trustedUnlock.classification !== "closed" && !exactKeys(terminal.trustedUnlock, ["classification"]))) return null;
  if (terminal.terminal.spawnError || (terminal.terminal.exitCode === null && terminal.terminal.signal === null)
    || (terminal.terminal.exitCode !== null && (!Number.isSafeInteger(terminal.terminal.exitCode) || terminal.terminal.exitCode < 0 || terminal.terminal.signal !== null))
    || (terminal.terminal.signal !== null && (typeof terminal.terminal.signal !== "string" || terminal.terminal.exitCode !== null))) return null;
  return terminal;
}

function observerExitWitness(observer) {
  return new Promise((resolve) => {
    observer.once("error", () => resolve({ exitCode: null, signal: null, spawnError: true }));
    observer.once("close", (exitCode, signal) => resolve({ exitCode, signal, spawnError: false }));
  });
}

async function recordAndValidateObserverExit(root, nonce, source, close, observer, observerExit) {
  const initial = await privateJson(root, "initial.json");
  if (!initial || initial.observer?.pid !== observer.pid) return false;
  if (observerExit.spawnError || (observerExit.exitCode === null && observerExit.signal === null)
    || (observerExit.exitCode !== null && (!Number.isSafeInteger(observerExit.exitCode) || observerExit.exitCode < 0 || observerExit.signal !== null))
    || (observerExit.signal !== null && (typeof observerExit.signal !== "string" || observerExit.exitCode !== null))) return false;
  const witness = {
    schema: "service-lasso.admin-provider-observer-consumer-terminal.v1", private: true,
    nonce, source, close: "close.json", state: "OBSERVER_EXITED",
    observer: initial.observer, heldHandle: true, childAndPipesClosed: true,
    terminal: observerExit,
  };
  try { await exclusiveJson(path.join(root, "consumer-terminal.json"), witness); } catch { return false; }
  const persisted = await privateJson(root, "consumer-terminal.json");
  return !!persisted && exactKeys(persisted, ["schema", "private", "nonce", "source", "close", "state", "observer", "heldHandle", "childAndPipesClosed", "terminal"])
    && persisted.schema === witness.schema && persisted.private === true && persisted.close === "close.json" && persisted.state === "OBSERVER_EXITED"
    && persisted.heldHandle === true && persisted.childAndPipesClosed === true && sameTuple(persisted, nonce, source)
    && JSON.stringify(persisted.observer) === JSON.stringify(initial.observer) && JSON.stringify(persisted.terminal) === JSON.stringify(observerExit)
    && JSON.stringify(close.provider) === JSON.stringify(initial.provider);
}

// This route deliberately delegates spawn ownership before the provider starts.
// The caller can settle on an immutable UNRESOLVED receipt, while the detached
// observer retains the real PID and pipes until the actual close is recorded.
export async function consumeWithDurableObserver(command, args, options = {}) {
  const root = options.observerRoot;
  const source = options.source;
  if (typeof root !== "string" || !source || !/^[0-9a-f]{40}$/u.test(source.head) || !/^[0-9a-f]{40}$/u.test(source.tree)) {
    return { code: null, signal: null, executionFailure: "spawn_failed", trustedUnlock: { classification: "missing" }, streamFailure: null };
  }
  await mkdir(root, { recursive: false, mode: 0o700 });
  const nonce = randomBytes(32).toString("hex");
  const config = {
    root, command, args, cwd: options.cwd, source, nonce, timeoutMs: options.timeoutMs,
    inputs: options.inputs,
  };
  const configPath = path.join(root, "observer-config.json");
  await exclusiveJson(configPath, config);
  const observer = spawn(process.execPath, [fileURLToPath(new URL("./admin-receipt-provider-observer.mjs", import.meta.url)), configPath], {
    cwd: options.cwd, env: options.env, detached: true, stdio: "ignore", windowsHide: true,
  });
  // Install this before any private-record polling. A quick observer exit must
  // still be tied to the OS child handle that created the private root.
  const observerExitPromise = observerExitWitness(observer);
  const terminal = await waitForPrivateObserver(root, ["close.json", "unresolved.json"], Math.max(250, (options.timeoutMs ?? 300000) + 250));
  if (!terminal) { observer.unref(); return { code: null, signal: null, executionFailure: "spawn_failed", trustedUnlock: { classification: "missing" }, streamFailure: null }; }
  if (terminal.endsWith("unresolved.json")) {
    const unresolved = await validateObserverTerminal(root, nonce, source, false);
    observer.unref();
    return unresolved ? { code: null, signal: null, executionFailure: "execution_timeout", trustedUnlock: { classification: "missing" }, streamFailure: null }
      : { code: null, signal: null, executionFailure: "spawn_failed", trustedUnlock: { classification: "invalid" }, streamFailure: null };
  }
  const close = await validateObserverTerminal(root, nonce, source, true);
  if (!close) return { code: null, signal: null, executionFailure: "spawn_failed", trustedUnlock: { classification: "invalid" }, streamFailure: null };
  let exitTimer;
  const observerExit = await Promise.race([observerExitPromise, new Promise((resolve) => { exitTimer = setTimeout(() => resolve(null), 5_000); })]);
  clearTimeout(exitTimer);
  if (!observerExit || !(await recordAndValidateObserverExit(root, nonce, source, close, observer, observerExit))) {
    observer.unref();
    return { code: null, signal: null, executionFailure: "observer_terminal_unresolved", trustedUnlock: { classification: "missing" }, streamFailure: null };
  }
  return { code: close.terminal.exitCode, signal: close.terminal.signal, executionFailure: null, trustedUnlock: close.trustedUnlock, streamFailure: null };
}

function outcomeFor(result) {
  if (result.executionFailure || result.streamFailure) return "observation_failure";
  if (result.signal) return "signal";
  return result.code === 0 ? "success" : "nonzero_exit";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const receipt = process.argv.indexOf("--receipt"), separator = process.argv.indexOf("--");
  if (receipt < 0 || separator < 0 || !process.argv[receipt + 1] || !process.argv[separator + 1]) process.exitCode = 2;
  else {
    const observerRoot = process.env.SERVICE_LASSO_ADMIN_RECEIPT_OBSERVER_ROOT;
    const result = observerRoot
      ? await consumeWithDurableObserver(process.argv[separator + 1], process.argv.slice(separator + 2), {
        cwd: process.cwd(), env: process.env, observerRoot,
        source: { head: process.env.SERVICE_LASSO_TEST_SOURCE_HEAD, tree: process.env.SERVICE_LASSO_TEST_SOURCE_TREE },
        inputs: {
          workspaceRoot: process.env.SERVICE_LASSO_WORKSPACE_ROOT,
          instanceRegistryPath: process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH,
          hostPortRegistryPath: process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH,
        },
        timeoutMs: Number(process.env.SERVICE_LASSO_ADMIN_RECEIPT_TIMEOUT_MS ?? 300000),
      })
      : await consume(process.argv[separator + 1], process.argv.slice(separator + 2), { cwd: process.cwd(), env: process.env });
    await writeFile(process.argv[receipt + 1], `${JSON.stringify({ schema: "service-lasso.admin-trusted-unlock-consumer.v1", outcome: outcomeFor(result), exitCode: result.code, signal: result.signal, trustedUnlock: result.trustedUnlock, ...(result.streamFailure ? { streamFailure: result.streamFailure } : {}), ...(result.executionFailure ? { executionFailure: result.executionFailure } : {}) })}\n`);
    if (!result.streamFailure && result.signal && process.platform !== "win32" && PROPAGATED_SIGNALS.has(result.signal)) process.kill(process.pid, result.signal);
    else process.exitCode = result.code === 0 && !result.signal && !result.executionFailure && !result.streamFailure ? 0 : (result.signal || result.executionFailure || result.streamFailure ? 1 : result.code ?? 1);
  }
}
