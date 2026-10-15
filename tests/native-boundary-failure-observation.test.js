import assert from "node:assert/strict";
import test from "node:test";
import { lstat, realpath, mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { imageParents } from "../scripts/native-tool-journal-v4-lib.mjs";
import { removeOwnedTempRoot, ownedTempCleanupObservation } from "../scripts/owned-temp-cleanup.mjs";
import { validInitialProjection } from "../scripts/public-first-custody-projection-lib.mjs";

const prefix = "[native-boundary-failure-observation] ";
const decode = line => JSON.parse(line.slice(prefix.length));

// SPEC-006 AC-6G.native-boundary-observation / SPEC-003 BR-008 / #1603.
// Predicate injections reuse the actual production function and real lstat;
// they are contract regressions, not host-native failure attribution.
test("each original image-parent predicate remains closed with only its actual classification", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "native-observation-")));
  try {
    const file = path.join(root, "fixture");
    await writeFile(file, "fixture");
    const actual = await lstat(root,{bigint:true});
    for (const failed of ["directory", "symlink", "samePhysicalPath", "devExactInteger", "inoExactInteger", "inoPositive"]) {
      const entry = Object.assign(Object.create(Object.getPrototypeOf(actual)), actual);
      entry.ino = 1n; // isolate a single predicate; no native identity claim
      if (failed === "directory") entry.isDirectory = () => false;
      if (failed === "symlink") entry.isSymbolicLink = () => true;
      if (failed === "devExactInteger") entry.dev = Number(actual.dev);
      if (failed === "inoExactInteger") entry.ino = Number.MAX_SAFE_INTEGER + 1;
      if (failed === "inoPositive") entry.ino = 0n;
      const lines = [];
      let reads = 0, resolves = 0;
      await assert.rejects(imageParents(file, {
        lstat: async (cursor,options) => { assert.deepEqual(options,{bigint:true}); assert.equal(cursor, root); reads++; return entry; },
        realpath: async cursor => { assert.equal(cursor, root); resolves++; return failed === "samePhysicalPath" ? path.join(root, "different") : root; },
      }, line => lines.push(line)), /first_custody_native_reparse_parent/u);
      assert.equal(reads, 1); assert.equal(resolves, 1); assert.equal(lines.length, 1);
      const observation = decode(lines[0]);
      assert.deepEqual(observation.failedPredicates, [failed]);
      assert.equal(observation.observationStatus, "captured");
      assert.equal(observation.privateIdentity, "unavailable");
      assert.deepEqual(Object.keys(observation.predicates), ["directory", "symlink", "samePhysicalPath", "devExactInteger", "inoExactInteger", "inoPositive"]);
      assert.ok(Object.values(observation.predicates).every(value => typeof value === "boolean"));
      assert.equal(lines[0].includes(root), false);
      assert.equal(Object.hasOwn(observation, "ino"), false);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("actual physical alias refusal remains refused and ordinary image parents emit nothing", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "native-observation-alias-")));
  try {
    const actual = path.join(root, "actual"), alias = path.join(root, "alias");
    await mkdir(actual); await writeFile(path.join(actual, "fixture"), "fixture");
    await symlink(actual, alias, process.platform === "win32" ? "junction" : "dir");
    const lines = [];
    await imageParents(path.join(actual, "fixture"), undefined, line => lines.push(line));
    assert.deepEqual(lines, []);
    await assert.rejects(imageParents(path.join(alias, "fixture"), undefined, line => lines.push(line)), /first_custody_native_reparse_parent/u);
    assert.equal(lines.length, 1);
    assert.ok(decode(lines[0]).failedPredicates.includes("symlink"));
    assert.equal(lines[0].includes(root), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("unavailable acquisition has no fabricated predicate values and preserves the primary error", async () => {
  let traps = 0;
  const primary = new Proxy({}, { get() { traps++; throw new Error("private"); }, getOwnPropertyDescriptor() { traps++; throw new Error("private"); } });
  for (const acquisition of ["lstat", "realpath"]) {
    const lines = [];
    const io = {
      lstat: async () => { if (acquisition === "lstat") throw primary; return {}; },
      realpath: async () => { throw primary; },
    };
    let rejected = false;
    try { await imageParents(path.resolve("private", "image"), io, line => lines.push(line)); } catch (error) { rejected = true; assert.equal(error === primary, true); }
    assert.equal(rejected, true); assert.equal(traps, 0);
    assert.deepEqual(decode(lines[0]), { schema: "service-lasso.native-boundary-failure-observation.v2", boundary: "image_parent", privateIdentity: "unavailable", observationStatus: "unavailable", acquisition });
    rejected = false;
    try { await imageParents(path.resolve("private", "image"), io, () => { throw new Error("capture failed"); }); } catch (error) { rejected = true; assert.equal(error === primary, true); }
    assert.equal(rejected, true); assert.equal(traps, 0);
  }
  assert.equal(traps, 0);
});

test("new observational records cannot qualify or expand the existing public-v2 projection", () => {
  const head = "a".repeat(40);
  const projection = { schema: "service-lasso.qualification-first-custody-projection.v2", privateVersion: "v3", candidate: { head, tree: "b".repeat(40) }, platform: "darwin", run: { id: "42", attempt: "1" }, privateInitialReceiptSha256: "c".repeat(64), privateJournalSha256: "d".repeat(64), localValidatorAttestation: { schema: "service-lasso.qualification-local-validator-attestation.v2", validated: true } };
  assert.equal(validInitialProjection(projection, "darwin", "42", "1", head), true);
  assert.equal(validInitialProjection({ ...projection, observationStatus: "captured" }, "darwin", "42", "1", head), false);
  assert.equal(validInitialProjection({ schema: "service-lasso.native-boundary-failure-observation.v2", boundary: "image_parent", observationStatus: "captured" }, "darwin", "42", "1", head), false);
});

test("terminal cleanup observes only own closed syscall and preserves EBUSY8 and exact delays", async () => {
  for (const syscall of ["rmdir", "unlink", "scandir", "lstat", "stat", "open", "rm", "private".repeat(100000)]) {
    const lines = [], delays = []; let calls = 0;
    const failure = await removeOwnedTempRoot("private-root", {
      remove: async () => { calls++; throw { code: "EBUSY", syscall, path: "private-leaf", errno: -4082, pid: 123 }; },
      wait: async delay => delays.push(delay), report: line => lines.push(line),
    }).catch(error => error);
    assert.equal(calls, 8); assert.deepEqual(delays, [100, 200, 300, 400, 500, 600, 700]);
    assert.deepEqual(ownedTempCleanupObservation(failure), { operation: "remove_owned_temp_root", filesystemCode: "EBUSY", attempts: 8 });
    assert.deepEqual(decode(lines[0]), { schema: "service-lasso.native-boundary-failure-observation.v1", boundary: "owned_temp_cleanup", observationStatus: "captured", targetRole: "owned_temp_root", filesystemCode: "EBUSY", attempts: 8, syscall: syscall.length > 100 ? "unknown" : syscall, privateIdentity: "unavailable", lockOwner: "unavailable", descendants: "unavailable" });
    assert.equal(lines[0].includes("private-leaf"), false); assert.ok(lines[0].length < 500);
  }
});

test("cleanup never invokes accessors or proxy traps and capture failure preserves primary", async () => {
  let traps = 0;
  const accessor = Object.defineProperty({ code: "EACCES" }, "syscall", { get() { traps++; throw new Error("private"); } });
  const proxy = new Proxy({ code: "EBUSY", syscall: "rmdir" }, { getOwnPropertyDescriptor() { traps++; throw new Error("private"); }, get() { traps++; throw new Error("private"); } });
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  for (const raw of [accessor, proxy, revoked.proxy, Object.create({ code: "EBUSY", syscall: "rmdir" })]) {
    const lines = []; let calls = 0;
    const failure = await removeOwnedTempRoot("private-root", {
      remove: async () => { calls++; throw raw; }, wait: () => assert.fail("unknown/nonretryable must not wait"), report: line => lines.push(line),
    }).catch(error => error);
    assert.equal(calls, 1); assert.equal(decode(lines[0]).syscall, "unknown");
    assert.equal(ownedTempCleanupObservation(failure).filesystemCode, raw === accessor ? "EACCES" : "unknown");
  }
  const failure = await removeOwnedTempRoot("private-root", { remove: async () => { throw { code: "EBUSY", syscall: "rmdir" }; }, wait: async () => {}, report: () => { throw new Error("capture failure"); } }).catch(error => error);
  assert.deepEqual(ownedTempCleanupObservation(failure), { operation: "remove_owned_temp_root", filesystemCode: "EBUSY", attempts: 8 });
  assert.equal(failure.message, "Owned temporary root cleanup failed.");
  assert.equal(traps, 0);
});

test("exact large inode parent fixture is accepted while numeric legacy identity remains refused",async()=>{
  const root=await realpath(await mkdtemp(path.join(os.tmpdir(),"exact-native-parent-")));
  try {
    const file=path.join(root,"fixture");await writeFile(file,"native");
    const lines=[];const large=9007199254740993n;
    const snapshot=await imageParents(file,{lstat:async(cursor,options)=>{assert.deepEqual(options,{bigint:true});const actual=await lstat(cursor,options);if(cursor!==root)return actual;const copy=Object.assign(Object.create(Object.getPrototypeOf(actual)),actual);copy.ino=large;return copy;},realpath},line=>lines.push(line));
    assert.equal(snapshot[0].ino,large);assert.deepEqual(lines,[]);
    // Coherent fixture proves exact acquisition/guard only, not a native large inode.
    const actual=await lstat(root,{bigint:true}),entry=Object.assign(Object.create(Object.getPrototypeOf(actual)),actual);entry.ino=Number(large);
    await assert.rejects(imageParents(file,{lstat:async()=>entry,realpath:async()=>root},line=>lines.push(line)),/native_reparse_parent/u);
    assert.deepEqual(decode(lines[0]).failedPredicates,["inoExactInteger"]);
    assert.equal(lines[0].includes(large.toString()),false);
  } finally {await rm(root,{recursive:true,force:true});}
});
