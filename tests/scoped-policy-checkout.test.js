import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// SPEC-008 R1/R5: actual Git checkout-filter bytes, not reserialized JSON.
// Authored prospectively; no local execution before entire review/ROOT admission.
const policyPath = ".governance/project/ga-platform-scope.json";
const policySha256 = "159d644c161cf532c94d3bfe17ed55e32bf94c5d2843928945c450f6d8140c12";
const policyBlob = "e694c3e314c1bf11e03dc4656730a96467a765b8";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("canonical policy retains its original physical bytes across Git newline configurations", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lasso-policy-checkout-"));
  try {
    const policy = await readFile(new URL(`../${policyPath}`, import.meta.url));
    const attributes = await readFile(new URL("../.gitattributes", import.meta.url));
    assert.equal(policy.length, 445);
    assert.equal(sha256(policy), policySha256);
    assert.equal(createHash("sha1").update(Buffer.from(`blob ${policy.length}\0`)).update(policy).digest("hex"), policyBlob);
    const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("GIT_")));
    Object.assign(gitEnv, { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: os.devNull, GIT_ATTR_NOSYSTEM: "1" });
    const git = (args, input) => execFileSync("git", ["-C", root, ...args], { input, windowsHide: true, env: gitEnv });
    git(["-c", "core.autocrlf=false", "init", "--initial-branch=develop"]);
    const oid = git(["hash-object", "-w", "--stdin"], policy).toString().trim();
    assert.equal(oid, policyBlob);
    await mkdir(path.join(root, ".governance", "project"), { recursive: true });
    await writeFile(path.join(root, ".gitattributes"), attributes);
    for (const autocrlf of ["true", "false", "input"]) {
      const physical = git(["-c", `core.autocrlf=${autocrlf}`, "cat-file", "--filters", `--path=${policyPath}`, oid]);
      assert.deepEqual(physical, policy, `core.autocrlf=${autocrlf} must retain exact source authority`);
      assert.equal(sha256(physical), policySha256);
    }
    // Demonstrate that removing the exact policy protection recreates F1.
    await writeFile(path.join(root, ".gitattributes"), Buffer.alloc(0));
    const translated = git(["-c", "core.autocrlf=true", "cat-file", "--filters", `--path=${policyPath}`, oid]);
    assert.equal(translated.length, 446);
    assert.notEqual(sha256(translated), policySha256);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
