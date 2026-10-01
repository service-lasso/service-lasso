import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
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
  if (value.executionFailure !== undefined && !["execution_timeout", "spawn_failed"].includes(value.executionFailure)) return null;
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

function outcomeFor(result) {
  if (result.executionFailure || result.streamFailure) return "observation_failure";
  if (result.signal) return "signal";
  return result.code === 0 ? "success" : "nonzero_exit";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const receipt = process.argv.indexOf("--receipt"), separator = process.argv.indexOf("--");
  if (receipt < 0 || separator < 0 || !process.argv[receipt + 1] || !process.argv[separator + 1]) process.exitCode = 2;
  else {
    const result = await consume(process.argv[separator + 1], process.argv.slice(separator + 2), { cwd: process.cwd(), env: process.env });
    await writeFile(process.argv[receipt + 1], `${JSON.stringify({ schema: "service-lasso.admin-trusted-unlock-consumer.v1", outcome: outcomeFor(result), exitCode: result.code, signal: result.signal, trustedUnlock: result.trustedUnlock, ...(result.streamFailure ? { streamFailure: result.streamFailure } : {}), ...(result.executionFailure ? { executionFailure: result.executionFailure } : {}) })}\n`);
    if (!result.streamFailure && result.signal && process.platform !== "win32" && PROPAGATED_SIGNALS.has(result.signal)) process.kill(process.pid, result.signal);
    else process.exitCode = result.code === 0 && !result.signal && !result.executionFailure && !result.streamFailure ? 0 : (result.signal || result.executionFailure || result.streamFailure ? 1 : result.code ?? 1);
  }
}
