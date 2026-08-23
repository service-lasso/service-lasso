import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  readPrivateJson,
  resolveCurrentWindowsSid,
  writePrivateJson,
} from "../dist/runtime/security/private-json.js";

const execFileAsync = promisify(execFile);

test("private JSON uses DPAPI on Windows or owner-only storage on Unix across a fresh process", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "service-lasso-private-json-"));
  const target = path.join(root, "private", "state.json");
  const secret = `secret-${randomUUID()}`;
  try {
    await writePrivateJson(root, target, { secret, purpose: "broker-runtime" });
    const stored = await readFile(target, "utf8");
    if (process.platform === "win32") {
      assert.doesNotMatch(stored, new RegExp(secret));
      assert.match(stored, /windows-dpapi-current-user/);
    }
    assert.deepEqual(await readPrivateJson(root, target), { secret, purpose: "broker-runtime" });

    const moduleUrl = new URL("../dist/runtime/security/private-json.js", import.meta.url).href;
    const script = `import(${JSON.stringify(moduleUrl)}).then(async m => { const v = await m.readPrivateJson(process.argv[1], process.argv[2]); process.stdout.write(JSON.stringify(v)); })`;
    const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "-e", script, root, target], {
      windowsHide: true,
      timeout: 20_000,
    });
    assert.deepEqual(JSON.parse(stdout), { secret, purpose: "broker-runtime" });

    if (process.platform === "win32") {
      assert.ok(await resolveCurrentWindowsSid());
      const { stdout: aclText } = await execFileAsync("icacls.exe", [target], { windowsHide: true });
      const { stdout: identity } = await execFileAsync("whoami.exe", [], { windowsHide: true });
      assert.match(aclText, /SYSTEM:\(F\)/i);
      assert.match(aclText.toLowerCase(), new RegExp(identity.trim().toLowerCase().replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")));
      assert.doesNotMatch(aclText, /\(I\)/);
      assert.doesNotMatch(aclText, /Everyone|BUILTIN\\Users|Authenticated Users/i);
    } else {
      const mode = (await (await import("node:fs/promises")).stat(target)).mode & 0o777;
      assert.equal(mode, 0o600);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("private JSON rejects redirected ancestors, corrupt envelopes, and oversized input", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "service-lasso-private-json-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "service-lasso-private-json-outside-"));
  try {
    await symlink(outside, path.join(root, "redirect"), process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(
      writePrivateJson(root, path.join(root, "redirect", "state.json"), { secret: "must-not-write" }),
      /redirected|unsupported/i,
    );
    await mkdir(path.join(root, "valid"));
    const corrupt = path.join(root, "valid", "corrupt.json");
    await writeFile(corrupt, "not-json");
    await assert.rejects(readPrivateJson(root, corrupt));
    await assert.rejects(
      writePrivateJson(root, path.join(root, "valid", "large.json"), { value: "x".repeat(70 * 1024) }),
      /oversized/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("Windows private JSON resolves security utilities outside untrusted PATH", {
  skip: process.platform !== "win32",
}, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "service-lasso-private-json-path-"));
  const trap = path.join(root, "path-trap");
  const target = path.join(root, "private", "state.json");
  const originalPath = process.env.PATH;
  try {
    await mkdir(trap);
    for (const executable of ["whoami.exe", "icacls.exe", "powershell.exe"]) {
      await writeFile(path.join(trap, executable), "untrusted path executable");
    }
    process.env.PATH = trap;
    await writePrivateJson(root, target, { purpose: "path-independent-security" });
    assert.deepEqual(await readPrivateJson(root, target), {
      purpose: "path-independent-security",
    });
    assert.ok(await resolveCurrentWindowsSid());
  } finally {
    process.env.PATH = originalPath;
    await rm(root, { recursive: true, force: true });
  }
});
