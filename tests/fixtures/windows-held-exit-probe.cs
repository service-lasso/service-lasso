using System;
using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;

internal static class HeldExit
{
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr OpenProcess(uint access, bool inherit, int pid);

    [DllImport("kernel32.dll")]
    static extern bool CloseHandle(IntPtr handle);

    static MethodInfo proof;

    static bool Confirm(IntPtr handle)
    {
        return (bool)proof.Invoke(null, new object[] { handle });
    }

    static void Require(bool condition)
    {
        if (!condition)
        {
            throw new Exception("Held-handle assertion failed.");
        }
    }

    static void Probe(int code)
    {
        ProcessStartInfo info = new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName, "--fixture " + code);
        info.UseShellExecute = false;
        info.CreateNoWindow = true;
        info.RedirectStandardInput = true;
        using (Process child = Process.Start(info))
        {
            IntPtr handle = IntPtr.Zero;
            try
            {
                handle = OpenProcess(0x1000, false, child.Id);
                Require(handle != IntPtr.Zero);
                Require(!Confirm(handle));
                child.StandardInput.WriteLine("exit");
                Require(child.WaitForExit(4000));
                Require(child.ExitCode == code);
                Require(Confirm(handle) == (code != 259));
            }
            finally
            {
                if (!child.HasExited)
                {
                    child.Kill();
                    child.WaitForExit(4000);
                }
                if (handle != IntPtr.Zero)
                {
                    Require(CloseHandle(handle));
                }
            }
        }
    }

    static void VerifyStatus(MethodInfo classify, FieldInfo failure, int offset, uint status, int expectedCode)
    {
        classify.Invoke(null, new object[] { unchecked((int)status) });
        Require((int)failure.GetValue(null) == offset + expectedCode);
    }

    static void VerifyStatusSet(MethodInfo classify, FieldInfo failure, int offset)
    {
        VerifyStatus(classify, failure, offset, 0xC0000023, 37);
        VerifyStatus(classify, failure, offset, 0x8000000D, 38);
        VerifyStatus(classify, failure, offset, 0xC000010A, 39);
        VerifyStatus(classify, failure, offset, 0xC0000001, 40);
        VerifyStatus(classify, failure, offset, 0x80000005, 41);
        VerifyStatus(classify, failure, offset, 0xDEADBEEF, 35);
    }

    public static int Main(string[] args)
    {
        if (args.Length == 2 && args[0] == "--fixture")
        {
            Console.ReadLine();
            return Int32.Parse(args[1]);
        }
        try
        {
            Assembly assembly = Assembly.LoadFrom(args[0]);
            Type inspector = assembly.GetType("ServiceLassoWindowsProcessInspector");
            MethodInfo classify = inspector.GetMethod("EvidenceCommandQueryFailure", BindingFlags.Static | BindingFlags.NonPublic);
            FieldInfo subject = inspector.GetField("evidenceSubject", BindingFlags.Static | BindingFlags.NonPublic);
            FieldInfo failure = inspector.GetField("failureExitCode", BindingFlags.Static | BindingFlags.NonPublic);
            subject.SetValue(null, 0);
            VerifyStatusSet(classify, failure, 0);
            subject.SetValue(null, 100);
            VerifyStatusSet(classify, failure, 100);
            proof = inspector.GetMethod("IsConfirmedExited", BindingFlags.Static | BindingFlags.NonPublic);
            Require(proof != null);
            Require(!Confirm(IntPtr.Zero));
            Probe(0);
            Probe(259);
            Console.WriteLine("held_handle_cases_passed");
            return 0;
        }
        catch
        {
            Console.Error.WriteLine("held_handle_cases_failed");
            return 1;
        }
    }
}
