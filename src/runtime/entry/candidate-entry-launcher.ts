import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { open, readFile, readlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";

import {
  CANDIDATE_ENTRY_LEASE_CONTRACT,
  type CandidateEntryLeaseBook,
  encodeCandidateEntryHandoff,
  type CandidateEntryBinding,
  type CandidateEntryConsumerObservation,
  type CandidateEntryLease,
  type CandidateEntryRefusalCode,
  type CandidateEntryRelease,
  type CandidateEntryResult,
} from "../../contracts/candidate-entry.js";
import {
  CANDIDATE_ENTRY_BINDER_MAX_BYTES,
  type CandidateEntryBinderRefusalCode,
} from "../../contracts/candidate-entry-binder.js";
import type {
  CandidateEntryBinderArtifact,
  CandidateEntryBinderSource,
} from "./candidate-entry-binder.js";

export const CANDIDATE_ENTRY_HANDOFF_FD = 3 as const;
export const CANDIDATE_ENTRY_ACK_FD = 4 as const;

export interface CandidateEntryLeaseInput {
  leaseId: string;
  attemptId: string;
  issuerId: string;
  reservationId: string;
  operationId: string;
  issuedAtMs: number;
  expiresAtMs: number;
}

export interface CandidateEntryLaunchRequest {
  executable: string;
  argv: readonly string[];
  environment: readonly string[];
  lease: CandidateEntryLeaseInput;
  timeoutMs?: number;
}

export interface CandidateEntryLaunchOptions {
  binderSource?: CandidateEntryBinderSource;
}

export type CandidateEntryLaunchRefusalCode =
  | CandidateEntryRefusalCode
  | CandidateEntryBinderRefusalCode
  | "launch_input_invalid"
  | "launch_executable_unavailable"
  | "launch_spawn_failed"
  | "launch_identity_unavailable"
  | "launch_executable_mismatch"
  | "launch_argv_mismatch"
  | "launch_environment_mismatch"
  | "launch_handoff_failed"
  | "launch_consumer_refused"
  | "launch_consumer_exited"
  | "launch_timeout";

export interface CandidateEntryLaunch {
  binding: CandidateEntryBinding;
  child: ChildProcess;
  imageSha256?: string;
  release: (nowMs?: number) => CandidateEntryResult<CandidateEntryRelease>;
  released: Promise<CandidateEntryResult<CandidateEntryRelease>>;
}

export type CandidateEntryLaunchResult =
  | { ok: true; value: CandidateEntryLaunch }
  | { ok: false; code: CandidateEntryLaunchRefusalCode };

const DEFAULT_TIMEOUT_MS = 10_000;

class HandoffTimeoutError extends Error {}
class HandoffClosedError extends Error {}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function splitNul(buffer: Buffer): string[] {
  const values = buffer.toString("utf8").split("\0");
  if (values.at(-1) === "") values.pop();
  return values;
}

function parseStartIdentity(stat: string): string {
  const close = stat.lastIndexOf(")");
  if (close < 0) throw new Error("Linux process stat was malformed.");
  const fields = stat.slice(close + 2).trim().split(/\s+/u);
  const start = fields[19];
  if (!start || !/^\d+$/u.test(start)) throw new Error("Linux process start identity was unavailable.");
  return `linux-start-v1:${start}`;
}

async function hashExecutable(procRoot: string): Promise<string> {
  const bytes = await readFile(`${procRoot}/exe`);
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function readDomainIdentity(procRoot: string): Promise<string> {
  const [pidNamespace, mountNamespace] = await Promise.all([
    readlink(`${procRoot}/ns/pid`),
    readlink(`${procRoot}/ns/mnt`),
  ]);
  return `linux-ns-v1:${pidNamespace}:${mountNamespace}`;
}

export async function observeCandidateEntryConsumer(
  pid: number | "self" = "self",
): Promise<CandidateEntryConsumerObservation> {
  const procRoot = pid === "self" ? "/proc/self" : `/proc/${pid}`;
  const actualPid = pid === "self" ? process.pid : pid;
  const [startIdentity, executableIdentity, domainIdentity, argv, environment] =
    await Promise.all([
      readFile(`${procRoot}/stat`, "utf8").then(parseStartIdentity),
      hashExecutable(procRoot),
      readDomainIdentity(procRoot),
      readFile(`${procRoot}/cmdline`).then(splitNul),
      readFile(`${procRoot}/environ`).then(splitNul),
    ]);
  if (argv.length === 0) throw new Error("Linux process argv was unavailable.");
  return {
    pid: actualPid,
    startIdentity,
    executableIdentity,
    domainIdentity,
    argv,
    environment,
  };
}

function environmentObject(environment: readonly string[]): Record<string, string> {
  const result = Object.create(null) as Record<string, string>;
  for (const entry of environment) {
    const separator = entry.indexOf("=");
    result[entry.slice(0, separator)] = entry.slice(separator + 1);
  }
  return result;
}

function validateRequest(request: CandidateEntryLaunchRequest): CandidateEntryLaunchRefusalCode | null {
  if (!request || typeof request !== "object") return "launch_input_invalid";
  if (
    typeof request.executable !== "string" ||
    !path.isAbsolute(request.executable) ||
    request.executable.includes("\0")
  ) {
    return "launch_input_invalid";
  }
  if (
    !Array.isArray(request.argv) ||
    request.argv.length === 0 ||
    request.argv.some((value) => typeof value !== "string" || value.includes("\0"))
  ) {
    return "launch_input_invalid";
  }
  if (
    !Array.isArray(request.environment) ||
    request.environment.some((value) => typeof value !== "string" || value.includes("\0"))
  ) {
    return "launch_input_invalid";
  }
  const keys = new Set<string>();
  for (const entry of request.environment) {
    const separator = entry.indexOf("=");
    if (separator <= 0) return "launch_input_invalid";
    const key = entry.slice(0, separator);
    if (keys.has(key)) return "launch_input_invalid";
    keys.add(key);
  }
  if (!request.lease || typeof request.lease !== "object") return "launch_input_invalid";
  for (const value of [
    request.lease.leaseId,
    request.lease.attemptId,
    request.lease.issuerId,
    request.lease.reservationId,
    request.lease.operationId,
  ]) {
    if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
      return "launch_input_invalid";
    }
  }
  if (
    !Number.isSafeInteger(request.lease.issuedAtMs) ||
    request.lease.issuedAtMs < 0 ||
    !Number.isSafeInteger(request.lease.expiresAtMs) ||
    request.lease.expiresAtMs <= request.lease.issuedAtMs
  ) {
    return "launch_input_invalid";
  }
  if (
    request.timeoutMs !== undefined &&
    (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs <= 0)
  ) {
    return "launch_input_invalid";
  }
  return null;
}

function waitForSpawn(
  child: ChildProcess,
  timeoutMs: number,
): Promise<{ ok: true } | { ok: false; code: "launch_spawn_failed" | "launch_timeout" }> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: { ok: true } | { ok: false; code: "launch_spawn_failed" | "launch_timeout" }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish({ ok: false, code: "launch_timeout" }), timeoutMs);
    child.once("spawn", () => finish({ ok: true }));
    child.once("error", () => finish({ ok: false, code: "launch_spawn_failed" }));
  });
}

function readJsonLine(stream: NodeJS.ReadableStream, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let pending = "";
    let settled = false;
    const finish = (error: Error | null, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stream.off("data", onData);
      stream.off("close", onClose);
      stream.off("error", onError);
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => finish(new HandoffTimeoutError("Handoff timed out.")), timeoutMs);
    const onData = (chunk: Buffer | string) => {
      pending += chunk.toString();
      const index = pending.indexOf("\n");
      if (index < 0) return;
      const line = pending.slice(0, index);
      try {
        finish(null, JSON.parse(line));
      } catch {
        finish(new Error("Handoff response was not JSON."));
      }
    };
    const onClose = () => finish(new HandoffClosedError("Consumer closed before handoff."));
    const onError = (error: Error) => finish(error);
    stream.on("data", onData);
    stream.on("close", onClose);
    stream.on("error", onError);
  });
}

function watchRelease(stream: NodeJS.ReadableStream, onRelease: () => void): void {
  let pending = "";
  const cleanup = () => {
    stream.off("data", onData);
    stream.off("close", cleanup);
    stream.off("error", cleanup);
  };
  const onData = (chunk: Buffer | string) => {
    pending += chunk.toString();
    for (;;) {
      const index = pending.indexOf("\n");
      if (index < 0) break;
      const line = pending.slice(0, index);
      pending = pending.slice(index + 1);
      try {
        const message = JSON.parse(line) as { kind?: unknown };
        if (message?.kind === "release") {
          cleanup();
          onRelease();
          return;
        }
      } catch {}
    }
    if (pending.length > 64 * 1024) cleanup();
  };
  stream.on("data", onData);
  stream.once("close", cleanup);
  stream.once("error", cleanup);
}

async function terminate(
  child: ChildProcess,
  handle: FileHandle,
  book?: CandidateEntryLeaseBook,
  leaseId?: string,
): Promise<void> {
  if (book && leaseId) book.release(leaseId, Date.now());
  try {
    await handle.close();
  } catch {}
  try {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  } catch {}
}

export async function launchCandidateEntry(
  book: CandidateEntryLeaseBook,
  request: CandidateEntryLaunchRequest,
  options: CandidateEntryLaunchOptions = {},
): Promise<CandidateEntryLaunchResult> {
  const invalid = validateRequest(request);
  if (invalid !== null) return { ok: false, code: invalid };

  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = Date.now();
  if (now < request.lease.issuedAtMs) return { ok: false, code: "lease_not_yet_valid" };
  if (now >= request.lease.expiresAtMs) return { ok: false, code: "lease_expired" };

  let handle: FileHandle;
  try {
    handle = await open(request.executable, "r");
    const stat = await handle.stat();
    if (!stat.isFile()) {
      await handle.close();
      return { ok: false, code: "launch_executable_unavailable" };
    }
  } catch {
    return { ok: false, code: "launch_executable_unavailable" };
  }

  let expectedExecutable: string;
  try {
    expectedExecutable = `sha256:${createHash("sha256")
      .update(await handle.readFile())
      .digest("hex")}`;
  } catch {
    await handle.close();
    return { ok: false, code: "launch_executable_unavailable" };
  }

  const child = spawn(request.executable, request.argv.slice(1), {
    argv0: request.argv[0],
    env: environmentObject(request.environment),
    stdio: ["ignore", "inherit", "inherit", "pipe", "pipe"],
    windowsHide: true,
  });

  const spawned = await waitForSpawn(child, timeoutMs);
  if (!spawned.ok) {
    await terminate(child, handle);
    return { ok: false, code: spawned.code };
  }

  const childPid = child.pid;
  const handoff = child.stdio[CANDIDATE_ENTRY_HANDOFF_FD] as NodeJS.WritableStream | null;
  const ack = child.stdio[CANDIDATE_ENTRY_ACK_FD] as NodeJS.ReadableStream | null;
  if (!handoff || !ack || !Number.isInteger(childPid) || childPid === undefined || childPid <= 0) {
    await terminate(child, handle);
    return { ok: false, code: "launch_handoff_failed" };
  }
  handoff.on("error", () => {});
  ack.on("error", () => {});

  let observed: CandidateEntryConsumerObservation;
  try {
    observed = await observeCandidateEntryConsumer(childPid);
  } catch {
    await terminate(child, handle);
    return { ok: false, code: "launch_identity_unavailable" };
  }
  if (observed.executableIdentity !== expectedExecutable) {
    await terminate(child, handle);
    return { ok: false, code: "launch_executable_mismatch" };
  }
  if (!sameStrings(observed.argv, request.argv)) {
    await terminate(child, handle);
    return { ok: false, code: "launch_argv_mismatch" };
  }
  if (!sameStrings(observed.environment, request.environment)) {
    await terminate(child, handle);
    return { ok: false, code: "launch_environment_mismatch" };
  }

  const lease: CandidateEntryLease = {
    contract: CANDIDATE_ENTRY_LEASE_CONTRACT,
    version: 1,
    ...request.lease,
    consumer: {
      pid: observed.pid,
      startIdentity: observed.startIdentity,
      executableIdentity: observed.executableIdentity,
      domainIdentity: observed.domainIdentity,
    },
    publicInput: {
      argv: [...request.argv],
      environment: [...request.environment],
    },
  };
  const issued = book.issue(lease);
  if (!issued.ok) {
    await terminate(child, handle);
    return issued;
  }

  const handoffLine = encodeCandidateEntryHandoff(issued.value);
  const response = readJsonLine(ack, timeoutMs);
  try {
    handoff.write(`${handoffLine}\n`);
  } catch {
    await terminate(child, handle, book, request.lease.leaseId);
    return { ok: false, code: "launch_handoff_failed" };
  }

  let message: unknown;
  try {
    message = await response;
  } catch (error) {
    await terminate(child, handle, book, request.lease.leaseId);
    if (error instanceof HandoffTimeoutError) return { ok: false, code: "launch_timeout" };
    if (error instanceof HandoffClosedError) return { ok: false, code: "launch_consumer_exited" };
    return { ok: false, code: "launch_handoff_failed" };
  }

  if (
    !message ||
    typeof message !== "object" ||
    (message as { kind?: unknown }).kind !== "observation"
  ) {
    await terminate(child, handle, book, request.lease.leaseId);
    return { ok: false, code: "launch_consumer_refused" };
  }

  const observation = (message as { observation?: unknown }).observation;
  let imageSha256: string | undefined;

  if (options.binderSource !== undefined) {
    const validated = book.validate(request.lease.leaseId, observation, Date.now());
    if (!validated.ok) {
      try {
        handoff.write(`${JSON.stringify({ kind: "refused", code: validated.code })}\n`);
      } catch {}
      await terminate(child, handle, book, request.lease.leaseId);
      return validated;
    }

    let artifact: CandidateEntryBinderArtifact;
    try {
      artifact = options.binderSource.materialize({
        lease: issued.value,
        observation: observation as CandidateEntryConsumerObservation,
        handoffLine: Buffer.from(handoffLine, "utf8"),
      });
    } catch {
      artifact = { ok: false, code: "binder_image_encoding_failed" };
    }
    if (!artifact || typeof artifact !== "object" || typeof artifact.ok !== "boolean") {
      artifact = { ok: false, code: "binder_image_encoding_failed" };
    }
    if (!artifact.ok) {
      try {
        handoff.write(`${JSON.stringify({ kind: "refused", code: artifact.code })}\n`);
      } catch {}
      options.binderSource.release(request.lease.leaseId);
      await terminate(child, handle, book, request.lease.leaseId);
      return { ok: false, code: artifact.code };
    }

    const image = artifact.image;
    const imageHash = artifact.imageSha256;
    const actualSha256 =
      image instanceof Uint8Array
        ? `sha256:${createHash("sha256").update(image).digest("hex")}`
        : "";
    if (
      !(image instanceof Uint8Array) ||
      image.length === 0 ||
      image.length > CANDIDATE_ENTRY_BINDER_MAX_BYTES ||
      typeof imageHash !== "string" ||
      !/^sha256:[a-f0-9]{64}$/u.test(imageHash) ||
      actualSha256 !== imageHash
    ) {
      try {
        handoff.write(`${JSON.stringify({ kind: "refused", code: "binder_image_encoding_failed" })}\n`);
      } catch {}
      options.binderSource.release(request.lease.leaseId);
      await terminate(child, handle, book, request.lease.leaseId);
      return { ok: false, code: "binder_image_encoding_failed" };
    }

    const ackResponse = readJsonLine(ack, timeoutMs);
    try {
      handoff.write(
        `${JSON.stringify({
          kind: "binding",
          leaseId: request.lease.leaseId,
          imageBytes: image.length,
          imageSha256: imageHash,
        })}\n`,
      );
      handoff.write(Buffer.from(image));
    } catch {
      book.fail(request.lease.leaseId, Date.now());
      options.binderSource.release(request.lease.leaseId);
      await terminate(child, handle, book, request.lease.leaseId);
      return { ok: false, code: "launch_handoff_failed" };
    }

    let ackMessage: unknown;
    try {
      ackMessage = await ackResponse;
    } catch (error) {
      book.fail(request.lease.leaseId, Date.now());
      options.binderSource.release(request.lease.leaseId);
      await terminate(child, handle, book, request.lease.leaseId);
      if (error instanceof HandoffTimeoutError) return { ok: false, code: "binder_timeout" };
      if (error instanceof HandoffClosedError) return { ok: false, code: "binder_channel_closed" };
      return { ok: false, code: "binder_ack_mismatch" };
    }

    if (
      !ackMessage ||
      typeof ackMessage !== "object" ||
      (ackMessage as { kind?: unknown }).kind !== "ack" ||
      (ackMessage as { leaseId?: unknown }).leaseId !== request.lease.leaseId ||
      (ackMessage as { imageSha256?: unknown }).imageSha256 !== imageHash
    ) {
      try {
        handoff.write(`${JSON.stringify({ kind: "refused", code: "binder_ack_mismatch" })}\n`);
      } catch {}
      book.fail(request.lease.leaseId, Date.now());
      options.binderSource.release(request.lease.leaseId);
      await terminate(child, handle, book, request.lease.leaseId);
      return { ok: false, code: "binder_ack_mismatch" };
    }

    imageSha256 = imageHash;
  }

  const bound = book.bind(request.lease.leaseId, observation, Date.now());
  if (!bound.ok) {
    try {
      handoff.write(`${JSON.stringify({ kind: "refused", code: bound.code })}\n`);
    } catch {}
    if (options.binderSource !== undefined) {
      book.fail(request.lease.leaseId, Date.now());
      options.binderSource.release(request.lease.leaseId);
    }
    await terminate(child, handle, book, request.lease.leaseId);
    return bound;
  }

  try {
    handoff.write(`${JSON.stringify({ kind: "bound", binding: bound.value })}\n`);
  } catch {
    await terminate(child, handle, book, request.lease.leaseId);
    return { ok: false, code: "launch_handoff_failed" };
  }

  try {
    await handle.close();
  } catch {}
  let released = false;
  let resolveReleased!: (value: CandidateEntryResult<CandidateEntryRelease>) => void;
  const releasedPromise = new Promise<CandidateEntryResult<CandidateEntryRelease>>((resolve) => {
    resolveReleased = resolve;
  });
  const releaseLease = (nowMs = Date.now()) => {
    if (released) return book.release(request.lease.leaseId, nowMs);
    released = true;
    const result = book.release(request.lease.leaseId, nowMs);
    if (result.ok) options.binderSource?.release(request.lease.leaseId);
    resolveReleased(result);
    return result;
  };
  watchRelease(ack, () => {
    releaseLease();
  });
  return {
    ok: true,
    value: {
      binding: bound.value,
      child,
      imageSha256,
      release: releaseLease,
      released: releasedPromise,
    },
  };
}
