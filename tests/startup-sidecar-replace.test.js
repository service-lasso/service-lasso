import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { replaceStartupSidecar } from "../dist/runtime/startup/replace-sidecar.js";

for (const code of ["EPERM", "EACCES", "EBUSY"]) {
  test(`AC-4BJ.2a retries transient Windows ${code} with validation before every attempt`, async () => {
    const events = [];
    let attempts = 0;
    await replaceStartupSidecar("owned.tmp", "owned.json", async () => { events.push("validate"); }, {
      platform: "win32",
      rename: async (source, destination) => {
        assert.equal(source, "owned.tmp");
        assert.equal(destination, "owned.json");
        events.push("rename");
        if (++attempts < 3) throw Object.assign(new Error("busy"), { code });
      },
      wait: async (ms) => { events.push(ms); },
    });
    assert.deepEqual(events, ["validate", "rename", 20, "validate", "rename", 40, "validate", "rename"]);
  });
}

test("AC-4BJ.2a retry exhaustion retains original failure and prior destination bytes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sl-sidecar-retry-"));
  const source = path.join(root, "owned.tmp");
  const destination = path.join(root, "owned.json");
  const first = Object.assign(new Error("first sharing failure"), { code: "EPERM" });
  const delays = [];
  let attempts = 0;
  try {
    await writeFile(source, "new encrypted recovery envelope");
    await writeFile(destination, "prior encrypted recovery envelope");
    await assert.rejects(replaceStartupSidecar(source, destination, async () => {}, {
      platform: "win32",
      rename: async () => {
        attempts++;
        throw attempts === 1 ? first : Object.assign(new Error("later"), { code: "EBUSY" });
      },
      wait: async (ms) => { delays.push(ms); },
    }), (error) => error === first);
    assert.equal(attempts, 6);
    assert.deepEqual(delays, [20, 40, 80, 160, 320]);
    assert.equal(await readFile(destination, "utf8"), "prior encrypted recovery envelope");
    assert.equal(await readFile(source, "utf8"), "new encrypted recovery envelope");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const [platform, code] of [["linux", "EPERM"], ["darwin", "EBUSY"], ["win32", "EIO"], ["win32", "ENOENT"]]) {
  test(`AC-4BJ.2a does not retry ${platform} ${code}`, async () => {
    const failure = Object.assign(new Error("unavailable"), { code });
    let attempts = 0;
    await assert.rejects(replaceStartupSidecar("owned.tmp", "owned.json", async () => {}, {
      platform,
      rename: async () => { attempts++; throw failure; },
      wait: async () => { assert.fail("unexpected retry"); },
    }), (error) => error === failure);
    assert.equal(attempts, 1);
  });
}

test("AC-4BJ.2a stops before another rename when path validation changes", async () => {
  const unsafe = new Error("redirected or changed owned path");
  let validations = 0;
  let moves = 0;
  await assert.rejects(replaceStartupSidecar("owned.tmp", "owned.json", async () => {
    if (++validations === 2) throw unsafe;
  }, {
    platform: "win32",
    rename: async () => { moves++; throw Object.assign(new Error("busy"), { code: "EPERM" }); },
    wait: async () => {},
  }), (error) => error === unsafe);
  assert.equal(moves, 1);
});
