import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const source = path.join(root, "scripts", "host-runner-service", "windows", "HeldHandleContract.cs");

test("Windows held-handle validator retains the reviewed object and rejects writer and digest replay", { skip: process.platform !== "win32" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slhr-1570-"));
  const target = path.join(dir, "reviewed.bin");
  fs.writeFileSync(target, "native-held-object");
  const digest = crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex");
  const ps = `
    Add-Type -Path '${source.replaceAll("'", "''")}';
    $file = '${target.replaceAll("'", "''")}';
    $owner = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value;
    $receipt = [HeldHandleContract]::OpenRootOwnedReadOnly($file, '${digest}', $owner);
    if ($receipt.Handle.IsClosed) { throw 'receipt did not retain handle' }
    $receipt.Dispose();
    $writer = [IO.File]::Open($file, [IO.FileMode]::Open, [IO.FileAccess]::Write, [IO.FileShare]::ReadWrite);
    try { $blocked = $false; try { [HeldHandleContract]::OpenRootOwnedReadOnly($file, '${digest}', $owner) | Out-Null } catch { $blocked = $true }; if (-not $blocked) { throw 'writer was accepted' } } finally { $writer.Dispose() }
    $replayed = $false; try { [HeldHandleContract]::OpenRootOwnedReadOnly($file, ('0' * 64), $owner) | Out-Null } catch { $replayed = $true }; if (-not $replayed) { throw 'digest replay was accepted' }
  `;
  assert.doesNotThrow(() => execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { stdio: "pipe" }));
  fs.rmSync(dir, { recursive: true, force: true });
});
