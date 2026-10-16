$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$parent=$env:SERVICE_LASSO_DIAGNOSTIC_PARENT
$leaf=$env:SERVICE_LASSO_DIAGNOSTIC_LEAF
$nonce=$env:SERVICE_LASSO_DIAGNOSTIC_NONCE
$caller=$env:SERVICE_LASSO_DIAGNOSTIC_CALLER
foreach($key in [Environment]::GetEnvironmentVariables().Keys) {
  if(([string]$key).StartsWith('SERVICE_LASSO_DIAGNOSTIC_',[StringComparison]::Ordinal) -and $key -cnotin @('SERVICE_LASSO_DIAGNOSTIC_PARENT','SERVICE_LASSO_DIAGNOSTIC_LEAF','SERVICE_LASSO_DIAGNOSTIC_NONCE','SERVICE_LASSO_DIAGNOSTIC_CALLER')) { exit 2 }
}
if($nonce -cnotmatch '^[0-9a-f]{32}$' -or $leaf -cnotmatch '^[A-Za-z0-9_-]{1,180}$' -or $caller -cnotmatch '^[1-9][0-9]{0,9}$' -or -not [IO.Path]::IsPathRooted($parent) -or [IO.Path]::GetFullPath($parent) -cne $parent) { exit 2 }
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;
public sealed class DiagnosticBirth : IDisposable {
  [StructLayout(LayoutKind.Sequential)] struct BasicProcess { public IntPtr Reserved,Peb,R2,R3,Pid,Parent; }
  [StructLayout(LayoutKind.Sequential)] struct Info { public uint Attributes,CL,CH,AL,AH,WL,WH,Volume,SH,SL,Links,IH,IL; }
  [StructLayout(LayoutKind.Sequential)] struct UnicodeName { public ushort Length,MaximumLength; public IntPtr Buffer; }
  [StructLayout(LayoutKind.Sequential)] struct ObjectAttributes { public uint Length; public IntPtr RootDirectory,ObjectName; public uint Attributes; public IntPtr SecurityDescriptor,SecurityQualityOfService; }
  [StructLayout(LayoutKind.Sequential)] struct IoStatus { public IntPtr Status; public UIntPtr Information; }
  sealed class Held { public string Path,Identity; public SafeFileHandle Handle; public bool Original; }
  readonly List<Held> held=new List<Held>();
  readonly List<Exception> failures=new List<Exception>();
  WindowsIdentity principal; IntPtr parentProcess,parentToken; bool disposed; string sid;
  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr p,int k,out BasicProcess b,int size,out int returned);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool CloseHandle(IntPtr h);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool OpenProcessToken(IntPtr p,uint access,out IntPtr token);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateFile(string p,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle h,out Info i);
  [DllImport("advapi32.dll")] static extern uint GetSecurityInfo(SafeFileHandle h,int type,uint info,out IntPtr o,out IntPtr g,out IntPtr d,out IntPtr s,out IntPtr sd);
  [DllImport("advapi32.dll")] static extern uint GetSecurityDescriptorLength(IntPtr sd);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr p);
  [DllImport("ntdll.dll")] static extern int NtCreateFile(out SafeFileHandle h,uint access,ref ObjectAttributes a,out IoStatus io,IntPtr allocation,uint attributes,uint share,uint disposition,uint options,IntPtr ea,uint length);
  static Exception Native(string operation,int status) { return new Exception("Diagnostic native "+operation+" status="+status.ToString("X8")); }
  static SafeFileHandle Open(string p,uint share) {
    var h=CreateFile(p,0x00120080U,share,IntPtr.Zero,3,0x02200000U,IntPtr.Zero);
    if(h.IsInvalid) { var e=new Win32Exception(Marshal.GetLastWin32Error()); h.Dispose(); throw e; } return h;
  }
  static string Identity(SafeFileHandle h) {
    Info i; if(!GetFileInformationByHandle(h,out i)) throw new Win32Exception(Marshal.GetLastWin32Error());
    if((i.Attributes&16)==0 || (i.Attributes&0x400)!=0) throw new Exception("Diagnostic directory type rejected");
    return i.Volume+":"+i.IH+":"+i.IL;
  }
  static RawSecurityDescriptor Security(SafeFileHandle h) {
    IntPtr o,g,d,s,p; uint code=GetSecurityInfo(h,1,5,out o,out g,out d,out s,out p);
    if(code!=0) throw Native("security",unchecked((int)code));
    try { byte[] b=new byte[checked((int)GetSecurityDescriptorLength(p))]; Marshal.Copy(p,b,0,b.Length); return new RawSecurityDescriptor(b,0); }
    finally { if(LocalFree(p)!=IntPtr.Zero) throw new Exception("Diagnostic security release failed"); }
  }
  void Owner(Held h) {
    var sd=Security(h.Handle); if(sd.Owner==null) throw new Exception("Diagnostic owner missing"); string owner=sd.Owner.Value;
    if(h.Original) {
      if(owner!=sid || (sd.ControlFlags&ControlFlags.DiscretionaryAclProtected)==0 || sd.DiscretionaryAcl==null || sd.DiscretionaryAcl.Count!=2) throw new Exception("Diagnostic birth security rejected");
      bool own=false,system=false;
      foreach(GenericAce raw in sd.DiscretionaryAcl) {
        var ace=raw as CommonAce;
        if(ace==null || ace.IsCallback || ace.AceQualifier!=AceQualifier.AccessAllowed || ace.AccessMask!=0x1f01ff || ace.AceFlags!=(AceFlags.ObjectInherit|AceFlags.ContainerInherit)) throw new Exception("Diagnostic birth ACE rejected");
        if(ace.SecurityIdentifier.Value==sid && !own) own=true;
        else if(ace.SecurityIdentifier.Value=="S-1-5-18" && !system) system=true;
        else throw new Exception("Diagnostic birth principal rejected");
      }
      if(!own || !system) throw new Exception("Diagnostic birth ACE incomplete");
    } else if(owner!=sid && owner!="S-1-5-18" && owner!="S-1-5-32-544" && owner!="S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464") throw new Exception("Diagnostic ancestor owner rejected");
  }
  public void PreparePrincipal(uint expectedCaller) {
    if(IntPtr.Size!=8 && IntPtr.Size!=4) throw new Exception("Diagnostic ABI rejected");
    if(Marshal.SizeOf(typeof(UnicodeName))!=(IntPtr.Size==8?16:8) || Marshal.SizeOf(typeof(ObjectAttributes))!=(IntPtr.Size==8?48:24) || Marshal.SizeOf(typeof(IoStatus))!=IntPtr.Size*2) throw new Exception("Diagnostic ABI layout rejected");
    using(var impersonated=WindowsIdentity.GetCurrent(true)) { if(impersonated!=null) throw new Exception("Diagnostic impersonation rejected"); }
    principal=WindowsIdentity.GetCurrent(); if(principal.User==null) throw new Exception("Diagnostic principal missing"); sid=principal.User.Value;
    BasicProcess b; int count; int status=NtQueryInformationProcess(GetCurrentProcess(),0,out b,Marshal.SizeOf(typeof(BasicProcess)),out count);
    if(status!=0 || b.Parent.ToInt64()!=expectedCaller) throw Native("parent",status);
    parentProcess=OpenProcess(0x1000,false,expectedCaller); if(parentProcess==IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
    if(!OpenProcessToken(parentProcess,8,out parentToken)) throw new Win32Exception(Marshal.GetLastWin32Error());
    using(var parent=new WindowsIdentity(parentToken)) { if(parent.User==null || parent.User.Value!=sid) throw new Exception("Diagnostic parent principal rejected"); }
  }
  public void AcquireParent(string parent) {
    var chain=new List<string>(); for(string p=parent;p!=null;) { chain.Insert(0,p); var n=Directory.GetParent(p); p=n==null?null:n.FullName; }
    foreach(string p in chain) { var h=Open(p,3); var e=new Held {Path=p,Handle=h,Original=false}; held.Add(e); e.Identity=Identity(h); Owner(e); }
    Verify();
  }
  public void Create(string parent,string leaf) {
    if(held.Count==0 || held[held.Count-1].Path!=parent) throw new Exception("Diagnostic held parent missing"); Verify();
    IntPtr text=IntPtr.Zero,namePtr=IntPtr.Zero; GCHandle pin=default(GCHandle); bool added=false; var ph=held[held.Count-1].Handle;
    try {
      text=Marshal.StringToHGlobalUni(leaf); int length=checked(leaf.Length*2); if(length>65532) throw new Exception("Diagnostic leaf too long");
      var name=new UnicodeName {Length=(ushort)length,MaximumLength=(ushort)(length+2),Buffer=text};
      namePtr=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(UnicodeName))); Marshal.StructureToPtr(name,namePtr,false);
      var sd=new RawSecurityDescriptor("O:"+sid+"D:P(A;OICI;FA;;;"+sid+")(A;OICI;FA;;;SY)"); byte[] bytes=new byte[sd.BinaryLength]; sd.GetBinaryForm(bytes,0); pin=GCHandle.Alloc(bytes,GCHandleType.Pinned);
      ph.DangerousAddRef(ref added);
      var a=new ObjectAttributes {Length=(uint)Marshal.SizeOf(typeof(ObjectAttributes)),RootDirectory=ph.DangerousGetHandle(),ObjectName=namePtr,Attributes=0x40,SecurityDescriptor=pin.AddrOfPinnedObject(),SecurityQualityOfService=IntPtr.Zero};
      IoStatus io; SafeFileHandle h; int status=NtCreateFile(out h,0x00120080U,ref a,out io,IntPtr.Zero,0x10,3,2,0x21,IntPtr.Zero,0);
      if(h!=null && !h.IsInvalid) held.Add(new Held {Path=System.IO.Path.Combine(parent,leaf),Handle=h,Original=true});
      int ioStatus=unchecked((int)io.Status.ToInt64());
      if(status!=0 || ioStatus!=0 || io.Information.ToUInt64()!=2 || h==null || h.IsInvalid)
        throw new Exception("Diagnostic native create status="+status.ToString("X8")+" io="+ioStatus.ToString("X8")+" information="+io.Information.ToUInt64());
      var e=held[held.Count-1]; e.Identity=Identity(h); Owner(e); Verify();
    } finally { if(added) ph.DangerousRelease(); if(pin.IsAllocated) pin.Free(); if(namePtr!=IntPtr.Zero) Marshal.FreeHGlobal(namePtr); if(text!=IntPtr.Zero) Marshal.FreeHGlobal(text); }
  }
  public void Verify() {
    if(disposed) throw new Exception("Diagnostic original closed");
    foreach(var e in held) { if(e.Identity==null || Identity(e.Handle)!=e.Identity) throw new Exception("Diagnostic held identity changed"); using(var n=Open(e.Path,7)) { if(Identity(n)!=e.Identity) throw new Exception("Diagnostic named identity changed"); } Owner(e); }
  }
  public void Retain(Exception original) { failures.Add(original); }
  public void Dispose() {
    if(disposed) return; disposed=true;
    for(int n=held.Count-1;n>=0;n--) {
      try {
        var h=held[n].Handle;
        if(!h.IsClosed && !h.IsInvalid) {
          if(!CloseHandle(h.DangerousGetHandle())) failures.Add(new Win32Exception(Marshal.GetLastWin32Error()));
          else h.SetHandleAsInvalid();
        }
      } catch(Exception e) { failures.Add(e); }
    }
    try { if(parentToken!=IntPtr.Zero && !CloseHandle(parentToken)) failures.Add(new Win32Exception(Marshal.GetLastWin32Error())); } finally { parentToken=IntPtr.Zero; }
    try { if(parentProcess!=IntPtr.Zero && !CloseHandle(parentProcess)) failures.Add(new Win32Exception(Marshal.GetLastWin32Error())); } finally { parentProcess=IntPtr.Zero; }
    try { if(principal!=null) principal.Dispose(); } catch(Exception e) { failures.Add(e); }
    if(failures.Count!=0) throw new AggregateException("Diagnostic original failures retained",failures);
  }
}
'@
$owner=New-Object DiagnosticBirth
$closed=$false
function Emit($n,$phase) { [Console]::Out.Write('GDC1|'+$nonce+'|'+$n+'|'+$phase+"`n"); [Console]::Out.Flush() }
function Expect($n,$phase) {
  $line=New-Object Text.StringBuilder
  while($true) {
    $c=[Console]::In.Read()
    if($c -lt 0 -or $c -gt 127 -or $c -eq 0 -or $c -eq 13 -or $line.Length -ge 95) { throw 'Diagnostic command rejected' }
    if($c -eq 10) { break }
    [void]$line.Append([char]$c)
  }
  if($line.ToString() -cne ('GDC1|'+$nonce+'|'+$n+'|'+$phase)) { throw 'Diagnostic command rejected' }
}
try {
  $owner.PreparePrincipal([uint32]$caller); $owner.AcquireParent($parent); $owner.Create($parent,$leaf)
  Emit 1 'created-held'
  Expect 1 'verify'; $owner.Verify(); Emit 2 'verified'
  Expect 2 'handoff'; $owner.Verify(); Emit 3 'handoff-held'
  Expect 3 'capture'; $owner.Verify(); Emit 4 'capture-held'
  Expect 4 'close'; $owner.Dispose(); $closed=$true; Emit 5 'closed'
} catch { $owner.Retain($_.Exception); [Console]::Error.WriteLine($_.Exception.ToString()); exit 2 }
finally { if(-not $closed) { try { $owner.Dispose() } catch { [Console]::Error.WriteLine($_.Exception.ToString()) } } }
