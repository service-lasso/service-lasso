import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runCommand } from "../scripts/release-artifact-lib.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Windows ConPTY TUI helper compiles and emits only bounded metadata", { skip: process.platform !== "win32" }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "service-lasso-conpty-helper-"));
  const compiler = path.join(process.env.WINDIR ?? "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
  const executable = path.join(root, "helper.exe");
  try {
    await runCommand(compiler, ["/nologo", "/target:exe", "/platform:anycpu", `/out:${executable}`, path.join(repoRoot, "scripts", "verify-operator-tui-conpty.cs")]);
    await assert.rejects(runCommand(executable, []));
  } finally { await rm(root, { recursive: true, force: true }); }
});
