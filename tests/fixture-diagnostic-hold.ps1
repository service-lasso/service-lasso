
$originals = [System.Collections.Generic.List[object]]::new()
$held = [System.Collections.Generic.List[object]]::new()
$acquireObservation = @{ Recorded=$false; Original=$null; Operation=$null }
$ownerReadOuter = @{ Recorded=$false; Original=$null }
$failed = $false
function Remember-Original($original) {
  foreach ($prior in $script:originals) {
    if ([object]::ReferenceEquals($prior, $original) -or [object]::ReferenceEquals($prior.Exception, $original.Exception)) { return }
  }
  $script:originals.Add($original)
}
function Remember-AcquireFailure($operation, [System.Management.Automation.ErrorRecord]$original) {
  Remember-Original $original
  try {
    if (-not $script:acquireObservation.Recorded) {
      $script:acquireObservation.Original = $original
      $script:acquireObservation.Operation = $operation
      $script:acquireObservation.Recorded = $true
    }
  } catch { Remember-Original $_ }
}
function Same-AcquireOriginal([System.Management.Automation.ErrorRecord]$left, [System.Management.Automation.ErrorRecord]$right) {
  if ([object]::ReferenceEquals($left,$right)) { return $true }
  $leftException=$left.Exception; $rightException=$right.Exception
  return $null -ne $leftException -and [object]::ReferenceEquals($leftException,$rightException)
}
function Record-DiagnosticFailure($operation, $original, $suboperation=$null) {
  Remember-Original $original
  $script:failed = $true
  try {
    if ($operation -ceq 'acquire_chain' -and $null -ne $suboperation) { [Console]::Out.Write("GDH1|fail|$operation|$suboperation`n") }
    else { [Console]::Out.Write("GDH1|fail|$operation`n") }
    [Console]::Out.Flush()
  }
  catch { Remember-Original $_ }
}
try {
try {
$ErrorActionPreference = 'Stop'
if ($env:SERVICE_LASSO_HELD_FIXTURE_ROLE -cne 'diagnostic') { throw 'Diagnostic role unavailable' }
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
} catch { Record-DiagnosticFailure 'bootstrap' $_ }
function Read-Owner($p, $acquiring=$false) {
  try { $acl = Get-Acl -LiteralPath $p }
  catch { $caught=$_; if ($acquiring) { Remember-AcquireFailure 'owner_read_acl_get' $caught }; throw $caught }
  try { $owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]) }
  catch { $caught=$_; if ($acquiring) { Remember-AcquireFailure 'owner_read_owner_get' $caught }; throw $caught }
  try { return $owner.Value }
  catch { $caught=$_; if ($acquiring) { Remember-AcquireFailure 'owner_read_sid_value' $caught }; throw $caught }
}
function Assert-Owner($owner, $isRoot) {
  if ($isRoot) { if ($owner -ne $sid) { throw 'Unknown fixture owner' } }
  elseif ($owner -notin @($sid,'S-1-5-18','S-1-5-32-544','S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')) { throw 'Unknown fixture ancestor owner' }
}
function Check-Owner($p, $isRoot) { Assert-Owner (Read-Owner $p) $isRoot }
function Verify-Held {
  foreach($entry in $held) {
    $named = [FixtureHandle]::Named($entry.Path)
    $primary = $null
    try {
      if ([FixtureHandle]::Identity($named) -ne $entry.Identity -or [FixtureHandle]::Identity($entry.Handle) -ne $entry.Identity) { throw 'Fixture name changed' }
      Check-Owner $entry.Path ($entry.Path -eq $root)
    } catch { $primary = $_; Remember-Original $_; throw }
    finally { try { $named.Dispose() } catch { Remember-Original $_; if ($null -eq $primary) { throw } } }
  }
}
function Read-DiagnosticCommand {
  $text = ''
  while ($true) {
    $next = [Console]::In.Read()
    if ($next -eq -1) { if ($text.Length -ne 0) { throw 'Partial diagnostic command' }; return $null }
    if ($next -eq 10) { return $text }
    if ($next -lt 32 -or $next -gt 126 -or $text.Length -ge 6) { throw 'Invalid diagnostic command' }
    $text += [char]$next
  }
}
if (-not $failed) { try {
  try {
    $chain = New-Object System.Collections.Generic.List[string]
    $p = $root
    while($p) { $chain.Insert(0,$p); $parent = [System.IO.Directory]::GetParent($p); if($null -eq $parent) { break }; $p=$parent.FullName }
  } catch { $caught=$_; Remember-AcquireFailure 'chain_build' $caught; throw $caught }
  foreach($p in $chain) {
    try { $owner = Read-Owner $p $true }
    catch { $caught=$_; $ownerReadOuter.Original=$caught; $ownerReadOuter.Recorded=$true; Remember-AcquireFailure 'owner_read' $caught; throw $caught }
    if ($p -eq $root) {
      try { Assert-Owner $owner $true }
      catch { $caught=$_; Remember-AcquireFailure 'owner_root' $caught; throw $caught }
    } else {
      try { Assert-Owner $owner $false }
      catch { $caught=$_; Remember-AcquireFailure 'owner_ancestor' $caught; throw $caught }
    }
    try { if (([System.IO.File]::GetAttributes($p) -band [System.IO.FileAttributes]::Directory) -eq 0) { throw 'Unsupported fixture ancestor type' } }
    catch { $caught=$_; Remember-AcquireFailure 'attributes' $caught; throw $caught }
    try { $handle = [FixtureHandle]::Open($p) }
    catch { $caught=$_; Remember-AcquireFailure 'open' $caught; throw $caught }
    try { $identity = [FixtureHandle]::Identity($handle) }
    catch {
      $primary = $_; Remember-AcquireFailure 'identity' $primary
      try { $handle.Dispose() } catch { Remember-Original $_ }
      throw $primary
    }
    try { $held.Add([pscustomobject]@{Path=$p; Handle=$handle; Identity=$identity}) }
    catch {
      $primary = $_; Remember-AcquireFailure 'retain' $primary
      try { $handle.Dispose() } catch { Remember-Original $_ }
      throw $primary
    }
  }
} catch {
  $primary = $_; Remember-Original $primary; $suboperation = $null
  try {
    if ($acquireObservation.Recorded -and (Same-AcquireOriginal $acquireObservation.Original $primary)) { $suboperation = $acquireObservation.Operation }
    elseif ($ownerReadOuter.Recorded -and (Same-AcquireOriginal $ownerReadOuter.Original $primary)) { $suboperation = 'owner_read' }
  } catch { Remember-Original $_ }
  Record-DiagnosticFailure 'acquire_chain' $primary $suboperation
} }
if (-not $failed) { try { Verify-Held } catch { Record-DiagnosticFailure 'initial_verify' $_ } }
if (-not $failed) { try {
  $receipt = @{kind='ready'; pid=[FixtureHandle]::GetCurrentProcessId(); parentPid=[FixtureHandle]::ParentPid(); ownerSid=$sid}
  [Console]::Out.Write(($receipt | ConvertTo-Json -Compress) + "`n"); [Console]::Out.Flush()
} catch { Record-DiagnosticFailure 'ready_emit' $_ } }
if (-not $failed) {
  while($null -ne ($command=Read-DiagnosticCommand)) {
    if($command -eq 'close') { break }
    Verify-Held
    if($command -eq 'remove') { throw 'Fixture writer exclusion is unavailable; original retained' }
    if($command -ne 'verify') { throw 'Unknown fixture operation' }
    [Console]::Out.Write("verified`n"); [Console]::Out.Flush()
  }
}
} catch { Remember-Original $_ }
finally {
  foreach($entry in $held) { try { $entry.Handle.Dispose() } catch { Remember-Original $_ } }
}
if ($originals.Count -gt 0) {
  $exceptions = [System.Collections.Generic.List[System.Exception]]::new()
  foreach($original in $originals) { $exceptions.Add($original.Exception) }
  throw [System.AggregateException]::new('Diagnostic guardian failed.', $exceptions.ToArray())
}
