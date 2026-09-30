import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { withPackageStageLock } from "../scripts/publish-package-lib.mjs";

test("package staging serializes concurrent writers that share an output root", async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-package-stage-lock-"));
  let activeWriters = 0;
  let maximumActiveWriters = 0;

  try {
    await Promise.all([
      withPackageStageLock(outputRoot, async () => {
        activeWriters += 1;
        maximumActiveWriters = Math.max(maximumActiveWriters, activeWriters);
        await delay(25);
        activeWriters -= 1;
      }),
      withPackageStageLock(outputRoot, async () => {
        activeWriters += 1;
        maximumActiveWriters = Math.max(maximumActiveWriters, activeWriters);
        await delay(25);
        activeWriters -= 1;
      }),
    ]);

    assert.equal(maximumActiveWriters, 1);
    assert.equal(activeWriters, 0);
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});
