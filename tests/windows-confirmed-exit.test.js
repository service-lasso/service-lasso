import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

test("#1326 native termination proof uses a held handle and rejects live, invalid and ambiguous status", { skip: process.platform !== "win32" }, async () => {
  const owned = await mkdtemp(path.join(tmpdir(), "lasso-held-exit-"));
  try {
    const source = path.join(owned, "HeldExit.cs");
    const binary = path.join(owned, "HeldExit.exe");
    await writeFile(source, String.raw`
using System;
using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
internal static class HeldExit {
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  static MethodInfo proof;
  static bool Confirm(IntPtr handle) { return (bool)proof.Invoke(null, new object[]{handle}); }
  static void Require(bool condition) { if (!condition) throw new Exception("Held-handle assertion failed."); }
  static void Probe(int code) {
    var info = new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName, "--fixture " + code);
    info.UseShellExecute=false; info.CreateNoWindow=true; info.RedirectStandardInput=true;
    using (var child=Process.Start(info)) {
      IntPtr handle=IntPtr.Zero;
      try {
        handle=OpenProcess(0x1000, false, child.Id);
        Require(handle!=IntPtr.Zero);
        Require(!Confirm(handle)); child.StandardInput.WriteLine("exit");
        Require(child.WaitForExit(4000));
        Require(child.ExitCode==code);
        Require(Confirm(handle)==(code!=259));
      } finally {
        if (!child.HasExited) { child.Kill(); child.WaitForExit(4000); }
        if (handle!=IntPtr.Zero) Require(CloseHandle(handle));
      }
    }
  }
  public static int Main(string[] args) {
    if(args.Length==2 && args[0]=="--fixture") { Console.ReadLine(); return Int32.Parse(args[1]); }
    try {
      var assembly=Assembly.LoadFrom(args[0]);
      var inspector=assembly.GetType("ServiceLassoWindowsProcessInspector");
      var classify=inspector.GetMethod("EvidenceCommandQueryFailure", BindingFlags.Static|BindingFlags.NonPublic);
      var subject=inspector.GetField("evidenceSubject", BindingFlags.Static|BindingFlags.NonPublic);
      var failure=inspector.GetField("failureExitCode", BindingFlags.Static|BindingFlags.NonPublic);
      uint[] statuses={0xC0000023,0x8000000D,0xC000010A,0xC0000001,0x80000005,0xDEADBEEF};
      int[] codes={37,38,39,40,41,35};
      foreach(int offset in new int[]{0,100}) {
        subject.SetValue(null,offset);
        for(int index=0;index<statuses.Length;index++) {
          classify.Invoke(null,new object[]{unchecked((int)statuses[index])});
          Require((int)failure.GetValue(null)==offset+codes[index]);
        }
      }
      proof=assembly.GetType("ServiceLassoWindowsProcessInspector").GetMethod("IsConfirmedExited", BindingFlags.Static|BindingFlags.NonPublic);
      Require(proof!=null); Require(!Confirm(IntPtr.Zero)); Probe(0); Probe(259);
      var architecture=assembly.GetType("ServiceLassoWindowsProcessInspector").GetMethod("CommandQueryArchitectureRelation", BindingFlags.Static|BindingFlags.NonPublic);
      Require(architecture!=null); Require((string)architecture.Invoke(null,new object[]{new IntPtr(123456)})=="unknown");
      Console.WriteLine("held_handle_cases_passed"); return 0;
    } catch { Console.Error.WriteLine("held_handle_cases_failed"); return 1; }
  }
}`);
    execFileSync(path.join(process.env.WINDIR, "Microsoft.NET/Framework64/v4.0.30319/csc.exe"), ["/nologo", "/target:exe", `/out:${binary}`, source], { timeout: 15000, windowsHide: true });
    const result = execFileSync(binary, [path.resolve("src/runtime/process/windows-process-inspector.exe")], { timeout: 15000, windowsHide: true, encoding: "utf8" });
    assert.equal(result.trim(), "held_handle_cases_passed");
  } finally {
    const resolvedOwned = path.resolve(owned);
    assert.ok(resolvedOwned.startsWith(path.resolve(tmpdir()) + path.sep + "lasso-held-exit-"));
    await rm(resolvedOwned, { recursive: true, force: true });
  }
});
