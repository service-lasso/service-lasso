import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { publishExtraction } from "../dist/runtime/setup/publish-extraction.js";

test("AC-4AJ.4b retries transient Windows publication without changing paths", async () => {
  let attempts = 0;
  const waits = [];
  await publishExtraction("owned.staging", "owned", {
    platform: "win32", exists: async () => false,
    rename: async (source, destination) => {
      assert.equal(source, "owned.staging"); assert.equal(destination, "owned");
      if (++attempts < 3) throw Object.assign(new Error("locked"), { code: "EPERM" });
    }, wait: async (ms) => { waits.push(ms); },
  });
  assert.equal(attempts, 3); assert.deepEqual(waits, [100, 200]);
});

test("AC-4AJ.4b exhaustion is bounded and preserves the original error", async () => {
  const original = Object.assign(new Error("locked"), { code: "EBUSY" });
  let attempts = 0; let waited = 0;
  await assert.rejects(publishExtraction("a", "b", {
    platform: "win32", exists: async () => false,
    rename: async () => { attempts++; throw original; }, wait: async (ms) => { waited += ms; },
  }), (error) => error === original);
  assert.equal(attempts, 7); assert.equal(waited, 4100);
});

test("AC-4AJ.4b non-Windows and non-transient failures are immediate", async () => {
  for (const [platform, code] of [["linux", "EPERM"], ["darwin", "EACCES"], ["win32", "ENOENT"]]) {
    const original = Object.assign(new Error("failed"), { code });
    await assert.rejects(publishExtraction("a", "b", {
      platform, exists: async () => false, rename: async () => { throw original; },
      wait: async () => { assert.fail("must not retry"); },
    }), (error) => error === original);
  }
});

test("AC-4AJ.4b existing destinations and staging evidence remain intact", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "publish-extraction-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "staging"); const destination = path.join(root, "published");
  await mkdir(source); await mkdir(destination);
  await writeFile(path.join(source, "data"), "staged");
  await writeFile(path.join(destination, "data"), "existing");
  await assert.rejects(publishExtraction(source, destination), { code: "EEXIST" });
  assert.equal(await readFile(path.join(source, "data"), "utf8"), "staged");
  assert.equal(await readFile(path.join(destination, "data"), "utf8"), "existing");
});

test("AC-4AJ.4b a destination appearing during retry is not replaced", async () => {
  const original = Object.assign(new Error("locked"), { code: "EACCES" });
  let attempts = 0;
  await assert.rejects(publishExtraction("a", "b", {
    platform: "win32", exists: async () => attempts > 0,
    rename: async () => { attempts++; throw original; }, wait: async () => {},
  }), (error) => error === original);
  assert.equal(attempts, 1);
});

test("AC-4AJ.4b real publication exposes the complete staged tree", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "publish-extraction-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "staging"); const destination = path.join(root, "published");
  await mkdir(source); await writeFile(path.join(source, "data"), "complete");
  await publishExtraction(source, destination);
  assert.equal(await readFile(path.join(destination, "data"), "utf8"), "complete");
  await assert.rejects(readFile(path.join(source, "data")), { code: "ENOENT" });
});
