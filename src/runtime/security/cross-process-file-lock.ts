import { randomBytes } from "node:crypto";
import type { Stats } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const localQueues = new Map<string, Promise<void>>();

export interface CrossProcessFileLockOptions {
  timeoutMs?: number;
  staleMs?: number;
  unavailableMessage?: string;
}

export async function withCrossProcessFileLock<T>(
  lockPath: string,
  work: () => Promise<T>,
  options: CrossProcessFileLockOptions = {},
): Promise<T> {
  const resolvedLockPath = path.resolve(lockPath);
  const timeoutMs = options.timeoutMs ?? 15_000;
  const staleMs = options.staleMs ?? 60_000;
  const unavailableMessage = options.unavailableMessage ?? "The protected file lock is unavailable.";
  const previous = localQueues.get(resolvedLockPath) ?? Promise.resolve();
  let release: () => void = () => {};
  const queued = new Promise<void>((resolve) => { release = resolve; });
  const chain = previous.then(() => queued);
  localQueues.set(resolvedLockPath, chain);
  await previous.catch(() => undefined);

  const nonce = randomBytes(16).toString("hex");
  const deadline = Date.now() + timeoutMs;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    await mkdir(path.dirname(resolvedLockPath), { recursive: true, mode: 0o700 });
    while (!handle) {
      if (await recoveryInProgress(resolvedLockPath, staleMs)) {
        if (Date.now() >= deadline) throw new Error(unavailableMessage);
        await delay(20 + Math.floor(Math.random() * 31));
        continue;
      }
      try {
        handle = await open(resolvedLockPath, "wx", 0o600);
        await handle.writeFile(JSON.stringify({ pid: process.pid, nonce, createdAt: new Date().toISOString() }), "utf8");
        if (await recoveryInProgress(resolvedLockPath, staleMs)) {
          await handle.close();
          handle = null;
          await removeOwnedLock(resolvedLockPath, nonce);
          await delay(20 + Math.floor(Math.random() * 31));
        }
      } catch (error) {
        if (!isNodeError(error) || error.code !== "EEXIST") throw error;
        await recoverStaleLock(resolvedLockPath, staleMs);
        if (Date.now() >= deadline) throw new Error(unavailableMessage);
        await delay(20 + Math.floor(Math.random() * 31));
      }
    }
    return await work();
  } finally {
    await handle?.close().catch(() => undefined);
    await removeOwnedLock(resolvedLockPath, nonce);
    release();
    if (localQueues.get(resolvedLockPath) === chain) localQueues.delete(resolvedLockPath);
  }
}

async function recoverStaleLock(lockPath: string, staleMs: number): Promise<void> {
  const recoveryPath = `${lockPath}.recovery`;
  const recoveryNonce = randomBytes(16).toString("hex");
  let recoveryHandle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    recoveryHandle = await open(recoveryPath, "wx", 0o600);
    await recoveryHandle.writeFile(JSON.stringify({
      pid: process.pid,
      nonce: recoveryNonce,
      createdAt: new Date().toISOString(),
    }), "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") return;
    throw error;
  }

  try {
    const inspected = await inspectLock(lockPath);
    if (!inspected || Date.now() - inspected.info.mtimeMs < staleMs || inspected.ownerPid !== null && processIsAlive(inspected.ownerPid)) {
      await inspected?.handle.close();
      return;
    }
    const claimedPath = `${lockPath}.stale-${process.pid}-${randomBytes(8).toString("hex")}`;
    try {
      await rename(lockPath, claimedPath);
    } catch (error) {
      await inspected.handle.close();
      if (isNodeError(error) && error.code === "ENOENT") return;
      throw error;
    }
    try {
      const claimedInfo = await stat(claimedPath);
      let claimedNonce: unknown;
      try {
        claimedNonce = (JSON.parse(await readFile(claimedPath, "utf8")) as { nonce?: unknown }).nonce;
      } catch {
        claimedNonce = undefined;
      }
      const sameFile = sameFileIdentity(inspected.info, claimedInfo);
      const sameNonce = inspected.nonce === undefined || claimedNonce === inspected.nonce;
      if (!sameFile || !sameNonce) {
        await rename(claimedPath, lockPath).catch(() => undefined);
        return;
      }
      await rm(claimedPath, { force: true });
    } finally {
      await inspected.handle.close();
    }
  } finally {
    await recoveryHandle.close().catch(() => undefined);
    await removeOwnedLock(recoveryPath, recoveryNonce);
  }
}

async function recoveryInProgress(lockPath: string, staleMs: number): Promise<boolean> {
  const recoveryPath = `${lockPath}.recovery`;
  const inspected = await inspectLock(recoveryPath);
  if (!inspected) return false;
  try {
    if (Date.now() - inspected.info.mtimeMs < staleMs || inspected.ownerPid !== null && processIsAlive(inspected.ownerPid)) {
      return true;
    }
    const claimedPath = `${recoveryPath}.stale-${process.pid}-${randomBytes(8).toString("hex")}`;
    try {
      await rename(recoveryPath, claimedPath);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return false;
      throw error;
    }
    const claimedInfo = await stat(claimedPath);
    let claimedNonce: unknown;
    try {
      claimedNonce = (JSON.parse(await readFile(claimedPath, "utf8")) as { nonce?: unknown }).nonce;
    } catch {
      claimedNonce = undefined;
    }
    const sameFile = sameFileIdentity(inspected.info, claimedInfo);
    const sameNonce = inspected.nonce === undefined || claimedNonce === inspected.nonce;
    if (!sameFile || !sameNonce) {
      await rename(claimedPath, recoveryPath).catch(() => undefined);
      return true;
    }
    await rm(claimedPath, { force: true });
    return false;
  } finally {
    await inspected.handle.close();
  }
}

async function inspectLock(lockPath: string): Promise<{
  handle: Awaited<ReturnType<typeof open>>;
  info: Stats;
  ownerPid: number | null;
  nonce: unknown;
} | null> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(lockPath, "r");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }
  try {
    const info = await handle.stat();
    let owner: { pid?: unknown; nonce?: unknown } = {};
    try {
      owner = JSON.parse(await handle.readFile("utf8")) as { pid?: unknown; nonce?: unknown };
    } catch {
      // A malformed stale lock has no trustworthy live owner.
    }
    return {
      handle,
      info,
      ownerPid: typeof owner.pid === "number" && Number.isSafeInteger(owner.pid) && owner.pid > 0 ? owner.pid : null,
      nonce: owner.nonce,
    };
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

async function removeOwnedLock(lockPath: string, nonce: string): Promise<void> {
  try {
    const owner = JSON.parse(await readFile(lockPath, "utf8")) as { nonce?: unknown };
    if (owner.nonce === nonce) await rm(lockPath, { force: true });
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      // Never remove a lock whose ownership cannot be proved.
    }
  }
}

function sameFileIdentity(
  left: Stats,
  right: Stats,
): boolean {
  const leftInode = BigInt(left.ino);
  const rightInode = BigInt(right.ino);
  if (leftInode !== 0n && rightInode !== 0n) return BigInt(left.dev) === BigInt(right.dev) && leftInode === rightInode;
  return BigInt(left.size) === BigInt(right.size) && left.mtimeMs === right.mtimeMs;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isNodeError(error) && error.code === "EPERM";
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
