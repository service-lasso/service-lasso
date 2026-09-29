using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal static class Program {
  const uint HANDLE_FLAG_INHERIT = 1;
  const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
  const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
  static readonly IntPtr PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE = (IntPtr)0x00020016;
  [StructLayout(LayoutKind.Sequential)] struct COORD { public short X; public short Y; public COORD(short x, short y) { X=x; Y=y; } }
  [StructLayout(LayoutKind.Sequential)] struct SECURITY_ATTRIBUTES { public int nLength; public IntPtr lpSecurityDescriptor; public bool bInheritHandle; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct STARTUPINFO { public int cb; public string lpReserved, lpDesktop, lpTitle; public int dwX,dwY,dwXSize,dwYSize,dwXCountChars,dwYCountChars,dwFillAttribute,dwFlags; public short wShowWindow,cbReserved2; public IntPtr lpReserved2,hStdInput,hStdOutput,hStdError; }
  [StructLayout(LayoutKind.Sequential)] struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }
  [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr hProcess,hThread; public int dwProcessId,dwThreadId; }
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool CreatePipe(out IntPtr read, out IntPtr write, ref SECURITY_ATTRIBUTES sa, int size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetHandleInformation(IntPtr h, uint mask, uint flags);
  [DllImport("kernel32.dll", SetLastError=true)] static extern int CreatePseudoConsole(COORD size, IntPtr input, IntPtr output, uint flags, out IntPtr console);
  [DllImport("kernel32.dll")] static extern void ClosePseudoConsole(IntPtr console);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool CreateProcess(string app, string command, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFOEX startup, out PROCESS_INFORMATION process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool PeekNamedPipe(IntPtr pipe, IntPtr buffer, int length, IntPtr read, out int available, IntPtr left);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool ReadFile(IntPtr h, byte[] buffer, int count, out int read, IntPtr over);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool WriteFile(IntPtr h, byte[] buffer, int count, out int written, IntPtr over);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h, uint ms);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr h, out uint code);
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr h, uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  const uint WAIT_OBJECT_0=0, WAIT_TIMEOUT=258;

  static void Close(ref IntPtr h) { if (h != IntPtr.Zero && h != new IntPtr(-1)) { CloseHandle(h); h=IntPtr.Zero; } }
  static void Drain(IntPtr output, StringBuilder text) {
    while (true) { int available; if (!PeekNamedPipe(output, IntPtr.Zero, 0, IntPtr.Zero, out available, IntPtr.Zero) || available <= 0) return; byte[] bytes=new byte[Math.Min(available,4096)]; int read; if (!ReadFile(output,bytes,bytes.Length,out read,IntPtr.Zero) || read<=0) return; text.Append(Encoding.UTF8.GetString(bytes,0,read)); if(text.Length>65536) text.Remove(0,text.Length-65536); }
  }
  static bool Until(IntPtr output, StringBuilder text, string[] needles, int timeoutMs) {
    var end=Environment.TickCount + timeoutMs;
    while (unchecked(Environment.TickCount-end)<0) { Drain(output,text); bool found=true; foreach(var needle in needles) if(text.ToString().IndexOf(needle,StringComparison.Ordinal)<0) {found=false;break;} if(found)return true; Thread.Sleep(25); }
    Drain(output,text); foreach(var needle in needles) if(text.ToString().IndexOf(needle,StringComparison.Ordinal)<0)return false; return true;
  }
  static bool Send(IntPtr input,string value) { byte[] bytes=Encoding.UTF8.GetBytes(value); int written; return WriteFile(input,bytes,bytes.Length,out written,IntPtr.Zero) && written==bytes.Length; }
  static int Main(string[] args) {
    string stage="setup"; IntPtr inputRead=IntPtr.Zero,inputWrite=IntPtr.Zero,outputRead=IntPtr.Zero,outputWrite=IntPtr.Zero,pseudo=IntPtr.Zero,list=IntPtr.Zero,attributeValue=IntPtr.Zero; PROCESS_INFORMATION pi=new PROCESS_INFORMATION();
    try {
      if(args.Length!=3) return Fail("arguments");
      string exe=args[0], mode=args[1], api=args[2]; bool connected=mode=="connected";
      var sa=new SECURITY_ATTRIBUTES {nLength=Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)),bInheritHandle=true};
      if(!CreatePipe(out inputRead,out inputWrite,ref sa,0)||!SetHandleInformation(inputWrite,HANDLE_FLAG_INHERIT,0)||!CreatePipe(out outputRead,out outputWrite,ref sa,0)||!SetHandleInformation(outputRead,HANDLE_FLAG_INHERIT,0)) return Fail("pipes");
      if(CreatePseudoConsole(new COORD(120,40),inputRead,outputWrite,0,out pseudo)!=0) return Fail("pseudoconsole");
      IntPtr size=IntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero,1,0,ref size); list=Marshal.AllocHGlobal(size); if(!InitializeProcThreadAttributeList(list,1,0,ref size)) return Fail("attributes"); attributeValue=Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(attributeValue,pseudo); if(!UpdateProcThreadAttribute(list,0,PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE,attributeValue,(IntPtr)IntPtr.Size,IntPtr.Zero,IntPtr.Zero)) return Fail("attributes");
      var startup=new STARTUPINFOEX(); startup.StartupInfo.cb=Marshal.SizeOf(typeof(STARTUPINFOEX)); startup.lpAttributeList=list;
      string environment=connected ? "SERVICE_LASSO_API_URL="+api+"\0\0" : "\0\0";
      IntPtr env=Marshal.StringToHGlobalUni(environment);
      try { stage="launch"; if(!CreateProcess(exe,"\""+exe+"\"",IntPtr.Zero,IntPtr.Zero,false,EXTENDED_STARTUPINFO_PRESENT|CREATE_UNICODE_ENVIRONMENT,env,null,ref startup,out pi)) return Fail(stage); }
      finally { Marshal.FreeHGlobal(env); }
      var text=new StringBuilder(); stage="startup"; string expected=connected?"Runtime identity:":"Runtime API unavailable"; if(!Until(outputRead,text,new[]{"Service Lasso TUI","q quit",expected},20000)) return Fail(stage); if(connected && text.ToString().IndexOf("Runtime API unavailable",StringComparison.Ordinal)>=0)return Fail(stage);
      stage="navigation"; if(!Send(inputWrite,"d")||!Send(inputWrite,"?")||!Until(outputRead,text,new[]{"d dashboard","esc back"},5000))return Fail(stage);
      stage="exit"; if(!Send(inputWrite,"q")||WaitForSingleObject(pi.hProcess,5000)!=WAIT_OBJECT_0)return Fail(stage); uint code; if(!GetExitCodeProcess(pi.hProcess,out code)||code!=0)return Fail(stage);
      Console.WriteLine("{\"ok\":true,\"safeStartup\":\"unavailable\",\"connectedDashboard\":\"rendered\",\"navigation\":\"help\",\"exit\":\"q\"}"); return 0;
    } catch { return Fail(stage); }
    finally { if(pi.hProcess!=IntPtr.Zero && WaitForSingleObject(pi.hProcess,0)==WAIT_TIMEOUT){TerminateProcess(pi.hProcess,1);WaitForSingleObject(pi.hProcess,5000);} Close(ref pi.hThread);Close(ref pi.hProcess); if(list!=IntPtr.Zero){DeleteProcThreadAttributeList(list);Marshal.FreeHGlobal(list);} if(attributeValue!=IntPtr.Zero)Marshal.FreeHGlobal(attributeValue); if(pseudo!=IntPtr.Zero)ClosePseudoConsole(pseudo); Close(ref inputRead);Close(ref inputWrite);Close(ref outputRead);Close(ref outputWrite); }
  }
  static int Fail(string stage) { Console.WriteLine("{\"ok\":false,\"stage\":\""+stage+"\"}"); return 1; }
}