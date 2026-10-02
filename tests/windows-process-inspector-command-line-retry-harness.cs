using System;
using System.Runtime.InteropServices;
using System.Text;

internal static partial class ServiceLassoWindowsProcessInspector
{
    private const int StatusInfoLengthMismatch = unchecked((int)0xC0000004);
    private const int StatusBufferTooSmall = unchecked((int)0xC0000023);
    private const int StatusPartialCopy = unchecked((int)0x8000000D);
    private const int StatusAccessDenied = unchecked((int)0xC0000022);

    private sealed class CommandLineQueryScript
    {
        private readonly int transientStatus;
        private readonly bool growReturnLength;

        internal int DataQueryCount;

        internal CommandLineQueryScript(int transientStatus, bool growReturnLength)
        {
            this.transientStatus = transientStatus;
            this.growReturnLength = growReturnLength;
        }

        internal int Query(IntPtr processHandle, IntPtr information, int informationLength, out int returnLength)
        {
            if (information == IntPtr.Zero)
            {
                returnLength = growReturnLength && DataQueryCount > 0 ? 64 : 32;
                return 0;
            }

            DataQueryCount++;
            if (transientStatus != 0 && DataQueryCount == 1)
            {
                returnLength = 0;
                return transientStatus;
            }
            if (growReturnLength && DataQueryCount == 1)
            {
                returnLength = informationLength + 32;
                return 0;
            }

            int headerSize = IntPtr.Size == 8 ? 16 : 8;
            byte[] commandLine = Encoding.Unicode.GetBytes("ok");
            Marshal.WriteInt16(information, 0, (short)commandLine.Length);
            Marshal.WriteInt16(information, 2, (short)commandLine.Length);
            Marshal.WriteIntPtr(information, IntPtr.Size == 8 ? 8 : 4, IntPtr.Add(information, headerSize));
            Marshal.Copy(commandLine, 0, IntPtr.Add(information, headerSize), commandLine.Length);
            returnLength = headerSize + commandLine.Length;
            return 0;
        }
    }

    private static void Require(bool condition)
    {
        if (!condition)
        {
            throw new InvalidOperationException("Command-line retry harness assertion failed.");
        }
    }

    private static void RunRecoveringCase(int transientStatus)
    {
        CommandLineQueryScript script = new CommandLineQueryScript(transientStatus, false);
        testCommandLineQuery = script.Query;
        try
        {
            Require(String.Equals(ReadCommandLine(new IntPtr(1)), "ok", StringComparison.Ordinal));
            Require(script.DataQueryCount == 2);
        }
        finally
        {
            testCommandLineQuery = null;
        }
    }

    private static void RunGrowingReturnLengthCase()
    {
        CommandLineQueryScript script = new CommandLineQueryScript(0, true);
        testCommandLineQuery = script.Query;
        try
        {
            Require(String.Equals(ReadCommandLine(new IntPtr(1)), "ok", StringComparison.Ordinal));
            Require(script.DataQueryCount == 2);
        }
        finally
        {
            testCommandLineQuery = null;
        }
    }

    private static void RunFailClosedCase(int status, int expectedEvidenceCode)
    {
        CommandLineQueryScript script = new CommandLineQueryScript(status, false);
        testCommandLineQuery = delegate(IntPtr processHandle, IntPtr information, int informationLength, out int returnLength)
        {
            if (information == IntPtr.Zero)
            {
                returnLength = 32;
                return 0;
            }
            script.DataQueryCount++;
            returnLength = 0;
            return status;
        };
        try
        {
            failureExitCode = 1;
            evidenceSubject = 0;
            bool failedClosed = false;
            try
            {
                ReadCommandLine(new IntPtr(1));
            }
            catch (InvalidOperationException)
            {
                failedClosed = true;
            }
            Require(failedClosed);
            Require(script.DataQueryCount == (IsTransientCommandLineQueryStatus(status) ? 3 : 1));
            Require(failureExitCode == expectedEvidenceCode);
        }
        finally
        {
            testCommandLineQuery = null;
        }
    }

    internal static int RunCommandLineRetryHarness()
    {
        try
        {
            RunRecoveringCase(StatusInfoLengthMismatch);
            RunRecoveringCase(StatusBufferTooSmall);
            RunRecoveringCase(StatusPartialCopy);
            RunGrowingReturnLengthCase();
            RunFailClosedCase(StatusPartialCopy, 38);
            RunFailClosedCase(StatusAccessDenied, 32);
            Console.WriteLine("command_line_retry_cases_passed");
            return 0;
        }
        catch
        {
            Console.Error.WriteLine("command_line_retry_cases_failed");
            return 1;
        }
        finally
        {
            testCommandLineQuery = null;
        }
    }
}
