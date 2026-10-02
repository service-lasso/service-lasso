import { open, lstat, realpath, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { createHash } from "node:crypto";
import { inspectProcess } from "../dist/runtime/process/identity.js";

// This helper owns only fixture filesystem handles, never process signaling
// authority. The Windows child holds original directory handles through copy
// verification. Destruction remains disabled without validated writer
// exclusion; a held ancestor/root does not exclude child additions or writes.
const guardianScript = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class FixtureHandle {
  [StructLayout(LayoutKind.Sequential)] public struct BasicProcess { public IntPtr Reserved, Peb, Reserved2, Reserved3, Pid, Parent; }
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] public static extern uint GetCurrentProcessId();
  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr h, int kind, out BasicProcess info, int size, out int returned);
  public static long ParentPid() {
    BasicProcess info; int returned;
    if(NtQueryInformationProcess(GetCurrentProcess(),0,out info,Marshal.SizeOf(typeof(BasicProcess)),out returned) != 0) throw new Exception("Parent identity unavailable");
    return info.Parent.ToInt64();
  }
  [StructLayout(LayoutKind.Sequential)] public struct Info {
    public uint Attributes, CreationLow, CreationHigh, AccessLow, AccessHigh,
      WriteLow, WriteHigh, Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern SafeFileHandle CreateFile(string p, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle h, out Info i);
  public static SafeFileHandle Open(string p) {
    var h = CreateFile(p, 0x80U, 3, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero);
    if(h.IsInvalid) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    return h;
  }
  public static SafeFileHandle Named(string p) {
    var h = CreateFile(p, 0x80U, 7, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero);
    if(h.IsInvalid) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    return h;
  }
  public static string Identity(SafeFileHandle h) {
    Info i; if(!GetFileInformationByHandle(h,out i)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    if((i.Attributes & 0x400) != 0) throw new Exception("Redirected fixture entry");
    return i.Volume.ToString() + ":" + i.IndexHigh.ToString() + ":" + i.IndexLow.ToString();
  }
}
'@
$root = $env:SERVICE_LASSO_HELD_FIXTURE_ROOT
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$held = New-Object System.Collections.Generic.List[object]
function Check-Owner($p, $isRoot) {
  $owner = (Get-Acl -LiteralPath $p).GetOwner([System.Security.Principal.SecurityIdentifier]).Value
  if ($isRoot) { if ($owner -ne $sid) { throw 'Unknown fixture owner' } }
  elseif ($owner -notin @($sid,'S-1-5-18','S-1-5-32-544','S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')) { throw 'Unknown fixture ancestor owner' }
}
function Verify-Held {
  foreach($entry in $held) {
    $named = [FixtureHandle]::Named($entry.Path)
    try {
      if ([FixtureHandle]::Identity($named) -ne $entry.Identity -or [FixtureHandle]::Identity($entry.Handle) -ne $entry.Identity) { throw 'Fixture name changed' }
      Check-Owner $entry.Path ($entry.Path -eq $root)
    } finally { $named.Dispose() }
  }
}
try {
  $chain = New-Object System.Collections.Generic.List[string]
  $p = $root
  while($p) { $chain.Insert(0,$p); $parent = [System.IO.Directory]::GetParent($p); if($null -eq $parent) { break }; $p=$parent.FullName }
  foreach($p in $chain) {
    Check-Owner $p ($p -eq $root)
    if (([System.IO.File]::GetAttributes($p) -band [System.IO.FileAttributes]::Directory) -eq 0) { throw 'Unsupported fixture ancestor type' }
    $handle = [FixtureHandle]::Open($p)
    try { $identity = [FixtureHandle]::Identity($handle) }
    catch { $handle.Dispose(); throw }
    $held.Add([pscustomobject]@{Path=$p; Handle=$handle; Identity=$identity})
  }
  Verify-Held
  $receipt = @{kind='ready'; pid=[FixtureHandle]::GetCurrentProcessId(); parentPid=[FixtureHandle]::ParentPid(); ownerSid=$sid}
  [Console]::Out.WriteLine(($receipt | ConvertTo-Json -Compress)); [Console]::Out.Flush()
  while($null -ne ($command=[Console]::In.ReadLine())) {
    if($command -eq 'close') { break }
    Verify-Held
    if($command -eq 'remove') { throw 'Fixture writer exclusion is unavailable; original retained' }
    if($command -ne 'verify') { throw 'Unknown fixture operation' }
    [Console]::Out.WriteLine('verified'); [Console]::Out.Flush()
  }
} finally { foreach($entry in $held) { $entry.Handle.Dispose() } }
`;

const sameDirectory = (info) => `${info.dev}:${info.ino}`;

export async function holdFixtureRoot(root, diagnosticRoot) {
  root = path.resolve(root);
  if (process.platform === "win32") {
    const child = spawn(path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(guardianScript, "utf16le").toString("base64")],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, SERVICE_LASSO_HELD_FIXTURE_ROOT: root } });
    let pending, output = "", privateError = "", closed = false;
    let stdoutEof = false, stderrEof = false, nativeIdentity, callerIdentity, guardianWitness;
    const stdoutBytes = [], stderrBytes = [];
    const callerPid = process.pid;
    child.stdout.once("end", () => { stdoutEof = true; });
    child.stderr.once("end", () => { stderrEof = true; });
    const closure = new Promise(resolve => child.once("close", (code, signal) => { closed = true; resolve({ code, signal });
      pending?.reject(new Error("Fixture handle guardian closed before acknowledgement.", { cause: privateError })); }));
    child.stderr.on("data", chunk => { stderrBytes.push(Buffer.from(chunk)); if (privateError.length < 16 * 1024) privateError += chunk.toString(); });
    child.stdout.on("data", chunk => {
      stdoutBytes.push(Buffer.from(chunk));
      output += chunk.toString();
      let index;
      while ((index = output.indexOf("\n")) >= 0) {
        const line = output.slice(0, index).trim(); output = output.slice(index + 1);
        if (pending) { const current = pending; pending = undefined; current.resolve(line); }
      }
    });
    child.once("error", error => pending?.reject(error));
    child.stdin.on("error", error => { privateError += String(error); pending?.reject(error); });
    const receipt = (command, expected) => new Promise((resolve, reject) => {
      if (closed) { reject(new Error("Fixture handle guardian is closed.")); return; }
      const timer = setTimeout(() => { pending = undefined; reject(new Error("Fixture handle guardian deadline expired.")); }, 5_000);
      pending = { resolve: value => { clearTimeout(timer); (typeof expected === "function" ? expected(value) : value === expected) ? resolve() : reject(new Error("Fixture handle guardian receipt is invalid.")); },
        reject: error => { clearTimeout(timer); reject(error); } };
      if (command) child.stdin.write(`${command}\n`);
    });
    const release = async () => {
      if (!closed) child.stdin.end("close\n");
      const bounded = () => Promise.race([closure, new Promise(resolve => setTimeout(() => resolve(null), 5_000))]);
      let result = await bounded();
      if (!result) {
        if (!closed) child.kill("SIGTERM");
        result = await bounded();
        if (!result) {
          if (!closed) child.kill("SIGKILL");
          result = await bounded();
          if (!result) throw new Error("Fixture handle guardian closure is unresolved.");
        }
        throw new Error("Fixture handle guardian required forced closure.", { cause: privateError });
      }
      if (result.code !== 0 || result.signal !== null) throw new Error("Fixture handle guardian failed.", { cause: privateError });
      if (!stdoutEof || !stderrEof) throw new Error("Fixture handle guardian EOF is unresolved.");
    };
    const retainReceipt = async () => {
      if (!diagnosticRoot) throw new Error("Fixture guardian private receipt root is missing.");
      const result = closed ? await closure : null;
      const stdout = Buffer.concat(stdoutBytes), stderr = Buffer.concat(stderrBytes);
      await writeFile(path.join(diagnosticRoot, "guardian-stdout.bin"), stdout, { flag: "wx", mode: 0o600 });
      await writeFile(path.join(diagnosticRoot, "guardian-stderr.bin"), stderr, { flag: "wx", mode: 0o600 });
      await writeFile(path.join(diagnosticRoot, "guardian-custody.json"), JSON.stringify({ callerPid, childPid: child.pid,
        callerIdentity, nativeIdentity, guardianWitness, closure: result, stdoutEof, stderrEof,
        stdout: { bytes: stdout.length, sha256: createHash("sha256").update(stdout).digest("hex") },
        stderr: { bytes: stderr.length, sha256: createHash("sha256").update(stderr).digest("hex") },
      }), { flag: "wx", mode: 0o600 });
    };
    try {
      await receipt(null, value => {
        try { guardianWitness = JSON.parse(value); } catch { return false; }
        return guardianWitness.kind === "ready" && guardianWitness.pid === child.pid && guardianWitness.parentPid === callerPid &&
          typeof guardianWitness.ownerSid === "string" && guardianWitness.ownerSid.length > 0;
      });
      const inspection = await inspectProcess(child.pid, { deadlineMs: Date.now() + 5_000 });
      if (closed || inspection.status !== "running" || inspection.identity.pid !== child.pid) throw new Error("Fixture guardian native child identity is unresolved.");
      nativeIdentity = inspection.identity;
      const caller = await inspectProcess(callerPid, { deadlineMs: Date.now() + 5_000 });
      if (caller.status !== "running" || caller.identity.pid !== callerPid) throw new Error("Fixture guardian native caller identity is unresolved.");
      callerIdentity = caller.identity;
    }
    catch (primary) {
      const errors = [primary];
      try { await release(); } catch (cleanup) { errors.push(cleanup); }
      try { await retainReceipt(); } catch (cleanup) { errors.push(cleanup); }
      throw new AggregateError(errors, "Fixture handle acquisition failed.");
    }
    return { verify: () => receipt("verify", "verified"), remove: async () => { throw new Error("Fixture writer exclusion is unavailable; original retained."); }, async release() {
      const errors = [];
      try { await release(); } catch (error) { errors.push(error); }
      try { await retainReceipt(); } catch (error) { errors.push(error); }
      if (errors.length) throw new AggregateError(errors, "Fixture guardian settlement failed.");
    } };
  }
  // Linux removal addresses each held parent through its fd. A renamed root
  // cannot redirect traversal into the directory now occupying the old name.
  const held = [];
  const acquire = async (named) => {
    const info = await lstat(named, { bigint: true });
    if (!info.isDirectory() || info.isSymbolicLink() || ![0n, BigInt(process.getuid())].includes(info.uid)) throw new Error("Fixture directory custody is unresolved.");
    if (await realpath(named) !== named) throw new Error("Fixture ancestry is redirected.");
    const handle = await open(named, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    if (sameDirectory(await handle.stat({ bigint: true })) !== sameDirectory(info)) { await handle.close(); throw new Error("Fixture directory identity changed."); }
    return { named, handle, identity: sameDirectory(info) };
  };
  const verify = async () => {
    for (const entry of held) {
      const named = await lstat(entry.named, { bigint: true });
      if (!named.isDirectory() || named.isSymbolicLink() || sameDirectory(named) !== entry.identity ||
        sameDirectory(await entry.handle.stat({ bigint: true })) !== entry.identity || await realpath(entry.named) !== entry.named) throw new Error("Original fixture root or ancestor identity changed.");
    }
  };
  const release = async () => {
    const errors = [];
    for (const entry of held.reverse()) { try { await entry.handle.close(); } catch (error) { errors.push(error); } }
    if (errors.length) throw new AggregateError(errors, "Fixture held directory release failed.");
  };
  try {
    const chain = []; for (let p = root;; p = path.dirname(p)) { chain.unshift(p); if (path.dirname(p) === p) break; }
    for (const p of chain) held.push(await acquire(p));
    const rootInfo = await held.at(-1).handle.stat({ bigint: true });
    if (rootInfo.uid !== BigInt(process.getuid())) throw new Error("Original fixture root owner is unresolved.");
    await verify();
  } catch (primary) { try { await release(); } catch (cleanup) { throw new AggregateError([primary, cleanup], "Fixture directory acquisition failed."); } throw primary; }
  // Holding fds and checking names does not exclude same-uid writers or make
  // unlink/rmdir conditional on the approved inode. Never enter that unsafe
  // transaction. The caller keeps the verified copy and original and fails.
  return { verify, release, async protect() {
    await verify();
    const original = held.at(-1);
    const info = await original.handle.stat({ bigint: true });
    if (info.uid !== BigInt(process.getuid()) || sameDirectory(info) !== original.identity) {
      throw new Error("Original fixture owner or identity changed before protection.");
    }
    await original.handle.chmod(0o700);
    await verify();
  }, async remove() {
    throw new Error("Fixture writer exclusion is unavailable; original retained.");
  } };
}
