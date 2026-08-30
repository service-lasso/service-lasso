import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  PrivateJsonError,
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
    for (const executable of ["whoami.exe", "icacls.exe", "powershell.exe", "windows-dpapi-helper.exe"]) {
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

test("Windows private JSON invokes the packaged DPAPI helper without PowerShell", {
  skip: process.platform !== "win32",
}, async () => {
  const source = await readFile("src/runtime/security/private-json.ts", "utf8");
  assert.match(source, /windows-dpapi-helper\.exe/u);
  assert.match(source, /\[operation\]/u);
  assert.doesNotMatch(source, /Add-Type|ProtectedData|powershell\.exe/u);
  assert.deepEqual(
    await readFile("dist/runtime/security/windows-dpapi-helper.exe"),
    await readFile("src/runtime/security/windows-dpapi-helper.exe"),
  );
});

test("Windows private JSON rejects missing or altered DPAPI helper assets before persistence", {
  skip: process.platform !== "win32",
}, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "service-lasso-private-json-helper-integrity-"));
  const moduleRoot = path.join(root, "isolated-module");
  const target = path.join(root, "private", "state.json");
  const helperPath = path.join(moduleRoot, "windows-dpapi-helper.exe");
  const provenancePath = path.join(moduleRoot, "windows-dpapi-helper.provenance.json");
  const missingPath = `${helperPath}.missing-test`;
  await mkdir(moduleRoot);
  await Promise.all([
    copyFile("dist/runtime/security/private-json.js", path.join(moduleRoot, "private-json.js")),
    copyFile("dist/runtime/security/windows-dpapi-helper.exe", helperPath),
    copyFile("dist/runtime/security/windows-dpapi-helper.provenance.json", provenancePath),
  ]);
  const isolated = await import(`${pathToFileURL(path.join(moduleRoot, "private-json.js")).href}?test=${randomUUID()}`);
  const helperBytes = await readFile(helperPath);
  const provenanceBytes = await readFile(provenancePath);
  const assertUnavailable = async () => {
    await assert.rejects(
      isolated.writePrivateJson(root, target, { purpose: "helper-integrity" }),
      (error) => error instanceof isolated.PrivateJsonError &&
        error.code === "private_state_protect_unavailable" &&
        !error.message.includes(root),
    );
    await assert.rejects(readFile(target), { code: "ENOENT" });
  };
  try {
    const alteredHelper = Buffer.from(helperBytes);
    alteredHelper[alteredHelper.length - 1] ^= 1;
    await writeFile(helperPath, alteredHelper);
    await assertUnavailable();
    await writeFile(helperPath, helperBytes);

    await writeFile(helperPath, Buffer.alloc(helperBytes.length + 1));
    await assertUnavailable();
    await writeFile(helperPath, helperBytes);

    const alteredProvenance = Buffer.from(provenanceBytes);
    alteredProvenance[alteredProvenance.length - 2] ^= 1;
    await writeFile(provenancePath, alteredProvenance);
    await assertUnavailable();
    await writeFile(provenancePath, provenanceBytes);

    const redirectedTarget = path.join(moduleRoot, "redirected-helper-target");
    await rm(helperPath);
    await mkdir(redirectedTarget);
    await symlink(redirectedTarget, helperPath, "junction");
    await assertUnavailable();
    await rm(helperPath, { recursive: true, force: true });
    await writeFile(helperPath, helperBytes);

    await rename(helperPath, missingPath);
    await assertUnavailable();
  } finally {
    helperBytes.fill(0);
    provenanceBytes.fill(0);
    await rm(root, { recursive: true, force: true });
  }
});

test("Windows private JSON classifies missing trusted system utilities without exposing a path", {
  skip: process.platform !== "win32",
}, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "service-lasso-private-json-system-root-"));
  const target = path.join(root, "private", "state.json");
  const originalSystemRoot = process.env.SystemRoot;
  const originalWindir = process.env.WINDIR;
  try {
    delete process.env.SystemRoot;
    delete process.env.WINDIR;
    await assert.rejects(
      writePrivateJson(root, target, { purpose: "typed-private-state-failure" }),
      (error) => error instanceof PrivateJsonError &&
        error.code === "private_state_system_utilities_unavailable" &&
        !error.message.includes(root),
    );
  } finally {
    if (originalSystemRoot === undefined) delete process.env.SystemRoot;
    else process.env.SystemRoot = originalSystemRoot;
    if (originalWindir === undefined) delete process.env.WINDIR;
    else process.env.WINDIR = originalWindir;
    await rm(root, { recursive: true, force: true });
  }
});
