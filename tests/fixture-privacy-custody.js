// Native preparation only until independent SOURCE GO and complete ROOT input
// admission. No named ACL writes, owner reset, privilege enablement or SACL.
// SetSecurityInfo/MAXIMUM_ALLOWED deliberately suppresses inheritance
// propagation: each change targets only its approved held physical object.
export const fixturePrivacyScript = `
$ErrorActionPreference = 'Stop'
$WarningPreference = 'SilentlyContinue'
$InformationPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
$operation='compiler'
$firstFailure=$null
$privateErrors=New-Object System.Collections.Generic.List[object]
$held=New-Object System.Collections.Generic.List[object]
$ancestors=New-Object System.Collections.Generic.List[object]
function Record-Failure($errorRecord) {
  if($null -eq $script:firstFailure) {
    $script:firstFailure=$script:operation
    if($script:operation -ne 'compiler' -and ('FixturePrivacy' -as [type])) { $script:firstFailure=[FixturePrivacy]::Operation }
  }
  // These original ErrorRecords remain child-private. The enum channel cannot
  // transfer raw custody when initialization privacy itself was rejected.
  $script:privateErrors.Add($errorRecord)
}
try {
Emit-FixtureFrame 'compiler_enter'
try {
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;
public static class FixturePrivacy {
  public static string Operation = "prepare";
  [StructLayout(LayoutKind.Sequential)] public struct Info {
    public uint Attributes, CreationLow, CreationHigh, AccessLow, AccessHigh,
      WriteLow, WriteHigh, Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern SafeFileHandle CreateFile(string p, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle h, out Info i);
  [DllImport("kernel32.dll")] static extern uint GetFileType(SafeFileHandle h);
  [DllImport("advapi32.dll")] static extern uint GetSecurityInfo(SafeFileHandle h, int type, uint info, out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
  [DllImport("advapi32.dll")] static extern uint SetSecurityInfo(SafeFileHandle h, int type, uint info, IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool GetSecurityDescriptorDacl(IntPtr descriptor, out bool present, out IntPtr dacl, out bool defaulted);
  [DllImport("advapi32.dll")] static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr p);
  public static SafeFileHandle Open(string p, bool mutate) {
    // READ_CONTROL/READ_ATTRIBUTES for ancestors/readback. MAXIMUM_ALLOWED
    // only for held mutation targets; it grants no new rights or privilege.
    // Read/write sharing permits the helper's directory enumeration; DELETE
    // sharing stays denied for held names. This is NOT writer exclusion.
    Operation="acquire";
    var h = CreateFile(p, mutate ? 0x02000000U : 0x00020080U, 3U,
      IntPtr.Zero, 3, 0x02200000U, IntPtr.Zero);
    if(h.IsInvalid) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    return h;
  }
  public static SafeFileHandle Named(string p) {
    Operation="acquire";
    var h=CreateFile(p,0x00020080U,7U,IntPtr.Zero,3,0x02200000U,IntPtr.Zero);
    if(h.IsInvalid) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    return h;
  }
  public static Info Information(SafeFileHandle h) {
    Operation="information";
    Info i; if(!GetFileInformationByHandle(h,out i)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    Operation="type";
    if(GetFileType(h) != 1U || ((i.Attributes & 16U)==0 && i.Links != 1U)) throw new Exception("Unsupported privacy object or shared link");
    Operation="redirect";
    if((i.Attributes & 0x400U) != 0) throw new Exception("Redirected privacy object");
    return i;
  }
  public static string Identity(SafeFileHandle h) {
    var i=Information(h); return i.Volume+":"+i.IndexHigh+":"+i.IndexLow;
  }
  public static RawSecurityDescriptor Security(SafeFileHandle h) {
    Operation="security";
    IntPtr owner,group,dacl,sacl,descriptor;
    var result=GetSecurityInfo(h,1,5U,out owner,out group,out dacl,out sacl,out descriptor);
    if(result != 0) throw new System.ComponentModel.Win32Exception((int)result);
    try {
      var bytes=new byte[checked((int)GetSecurityDescriptorLength(descriptor))];
      Marshal.Copy(descriptor,bytes,0,bytes.Length); return new RawSecurityDescriptor(bytes,0);
    } finally { LocalFree(descriptor); }
  }
  public static void Protect(SafeFileHandle h, string sid, bool directory) {
    var prior=Security(h); Operation="owner";
    if(prior.Owner.Value != sid) throw new Exception("Unknown prior privacy owner");
    Operation="descriptor";
    var flags=directory ? "OICI" : "";
    var sd=new RawSecurityDescriptor("D:P(A;"+flags+";FA;;;"+sid+")(A;"+flags+";FA;;;SY)");
    var bytes=new byte[sd.BinaryLength]; sd.GetBinaryForm(bytes,0);
    var pin=GCHandle.Alloc(bytes,GCHandleType.Pinned);
    try {
      bool present,defaulted; IntPtr dacl;
      if(!GetSecurityDescriptorDacl(pin.AddrOfPinnedObject(),out present,out dacl,out defaulted) || !present || dacl==IntPtr.Zero) throw new Exception("Private DACL unavailable");
      Operation="protect";
      var result=SetSecurityInfo(h,1,0x80000004U,IntPtr.Zero,IntPtr.Zero,dacl,IntPtr.Zero);
      if(result != 0) throw new System.ComponentModel.Win32Exception((int)result);
    } finally { pin.Free(); }
  }
  public static void Verify(SafeFileHandle h, string sid, bool protectedRoot) {
    var sd=Security(h);
    Operation="readback";
    if(sd.Owner == null || sd.Owner.Value != sid || (protectedRoot && (sd.ControlFlags & ControlFlags.DiscretionaryAclProtected)==0) || sd.DiscretionaryAcl == null || sd.DiscretionaryAcl.Count != 2) throw new Exception("Private descriptor unresolved");
    bool own=false,system=false;
    foreach(GenericAce raw in sd.DiscretionaryAcl) {
      var ace=raw as CommonAce;
      if(ace==null || ace.AceQualifier != AceQualifier.AccessAllowed || ace.AccessMask != 0x1f01ff || ace.IsCallback) throw new Exception("Private DACL unresolved");
      if(ace.SecurityIdentifier.Value==sid) { if(own) throw new Exception("Duplicate owner rule"); own=true; }
      else if(ace.SecurityIdentifier.Value=="S-1-5-18") { if(system) throw new Exception("Duplicate system rule"); system=true; }
      else throw new Exception("Unknown private principal");
    }
    if(!own || !system) throw new Exception("Private principals unresolved");
  }
}
'@ 2>$null
} catch { Emit-FixtureFrame 'compiler_failed'; throw }
Emit-FixtureFrame 'compiler_ok'
$operation='prepare'; [FixturePrivacy]::Operation='prepare'
$root=[System.IO.Path]::GetFullPath($env:SERVICE_LASSO_FIXTURE_EVIDENCE_ROOT)
$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$protect=$env:SERVICE_LASSO_FIXTURE_EVIDENCE_PROTECT -eq '1'
function Acquire($p,$isOriginal,$mutate) {
  if(-not $script:fixtureNativeEntered) {
    $script:fixtureNativeEntered=$true
    Emit-FixtureFrame 'native_enter_acquire'
  }
  $h=[FixturePrivacy]::Open($p,$mutate)
  try {
    $i=[FixturePrivacy]::Information($h)
    $owner=[FixturePrivacy]::Security($h).Owner.Value
    [FixturePrivacy]::Operation='owner'
    if($isOriginal) { if($owner -ne $sid) { throw 'Unknown prior fixture owner' } }
    elseif($owner -notin @($sid,'S-1-5-18','S-1-5-32-544','S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')) { throw 'Unknown prior ancestor owner' }
    return [pscustomobject]@{Path=$p;Handle=$h;Identity=[FixturePrivacy]::Identity($h);Directory=(($i.Attributes -band 16) -ne 0)}
  } catch {
    Record-Failure $_
    try { [FixturePrivacy]::Operation='release'; $h.Dispose() } catch { Record-Failure $_ }
    throw
  }
}
function Acquire-Children($p) {
  [FixturePrivacy]::Operation='inventory'
  $enumerator=[System.IO.Directory]::EnumerateFileSystemEntries($p).GetEnumerator()
  try {
    while($true) {
      [FixturePrivacy]::Operation='inventory'
      if(-not $enumerator.MoveNext()) { break }
      $entry=Acquire $enumerator.Current $true $protect
      $held.Add($entry)
      if($entry.Directory) { Acquire-Children $entry.Path }
    }
  } catch { Record-Failure $_; throw }
  finally { try { [FixturePrivacy]::Operation='release'; $enumerator.Dispose() } catch { Record-Failure $_; throw } }
}
function Verify-Names {
  foreach($entry in @($ancestors)+@($held)) {
    $h=[FixturePrivacy]::Named($entry.Path)
    try {
      $namedIdentity=[FixturePrivacy]::Identity($h)
      [FixturePrivacy]::Operation='identity'
      if($namedIdentity -ne $entry.Identity) { throw 'Privacy identity changed' }
      $heldIdentity=[FixturePrivacy]::Identity($entry.Handle)
      [FixturePrivacy]::Operation='identity'
      if($heldIdentity -ne $entry.Identity) { throw 'Privacy identity changed' }
    } catch { Record-Failure $_; throw }
    finally { try { [FixturePrivacy]::Operation='release'; $h.Dispose() } catch { Record-Failure $_; throw } }
  }
  // Enumerate only approved held directories, never recursively follow a new
  // name/reparse entry. Additional names reject before any mutation/writes.
  [FixturePrivacy]::Operation='inventory'
  $names=@($held | Where-Object Directory | ForEach-Object { [System.IO.Directory]::EnumerateFileSystemEntries($_.Path) } | Sort-Object)
  $expected=@($held | Where-Object Path -ne $root | ForEach-Object Path | Sort-Object)
  if(($names -join '|') -cne ($expected -join '|')) { throw 'Privacy inventory changed' }
}
try {
  $chain=New-Object System.Collections.Generic.List[string]
  $p=[System.IO.Directory]::GetParent($root)
  while($null -ne $p) { $chain.Insert(0,$p.FullName);$p=$p.Parent }
  foreach($p in $chain) { $entry=Acquire $p $false $false; $ancestors.Add($entry); [FixturePrivacy]::Operation='type'; if(-not $entry.Directory) { throw 'Unsupported ancestor' } }
  $entry=Acquire $root $true $protect; $held.Add($entry); [FixturePrivacy]::Operation='type'; if(-not $entry.Directory) { throw 'Unsupported original' }
  Acquire-Children $root
  Verify-Names
  // Every original prior owner/no-reparse check completed before first change.
  if($protect) { foreach($entry in $held) { [FixturePrivacy]::Protect($entry.Handle,$sid,$entry.Directory) } }
  foreach($entry in $held) { [FixturePrivacy]::Verify($entry.Handle,$sid,($entry.Path -eq $root)) }
  Verify-Names
} catch { Record-Failure $_ }
} catch { Record-Failure $_ } finally {
  foreach($entry in @($held)+@($ancestors)) {
    try { [FixturePrivacy]::Operation='release'; $entry.Handle.Dispose() } catch { Record-Failure $_ }
  }
}
$outcome=if($privateErrors.Count -eq 0) {'passed'} else {'failed'}
$category=if($null -eq $firstFailure) {'null'} else {'"'+$firstFailure+'"'}
[Console]::Out.Write('{"schema":"service-lasso.fixture-privacy-response.v1","outcome":"'+$outcome+'","operation":'+$category+'}')
if($outcome -eq 'failed') { exit 1 }
`;
