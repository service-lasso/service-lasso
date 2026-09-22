import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { withCrossProcessFileLock } from "../dist/runtime/security/cross-process-file-lock.js";

async function withTemporaryLockRoot(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "service-lasso-cross-process-lock-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("a fresh lock with a conclusively dead owner is recovered without waiting for stale age", async () => {
  await withTemporaryLockRoot(async (root) => {
    const lockPath = path.join(root, "lane.lock");
    await writeFile(lockPath, JSON.stringify({ pid: 2_147_483_647, nonce: "interrupted-owner" }), "utf8");

    let entered = false;
    await withCrossProcessFileLock(lockPath, async () => {
      entered = true;
    }, { timeoutMs: 1_000, staleMs: 60_000 });

    assert.equal(entered, true);
  });
});

test("a fresh lock with a live owner remains unavailable", async () => {
  await withTemporaryLockRoot(async (root) => {
    const lockPath = path.join(root, "lane.lock");
    await writeFile(lockPath, JSON.stringify({ pid: process.pid, nonce: "live-owner" }), "utf8");

    await assert.rejects(
      withCrossProcessFileLock(lockPath, async () => {}, { timeoutMs: 75, staleMs: 0 }),
      /protected file lock is unavailable/,
    );
  });
});

test("a fresh malformed lock still waits for its stale-age boundary", async () => {
  await withTemporaryLockRoot(async (root) => {
    const lockPath = path.join(root, "lane.lock");
    await writeFile(lockPath, "not-json", "utf8");

    await assert.rejects(
      withCrossProcessFileLock(lockPath, async () => {}, { timeoutMs: 75, staleMs: 60_000 }),
      /protected file lock is unavailable/,
    );
  });
});
