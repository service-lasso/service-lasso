using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

public static class ServiceLassoManagedLauncherNative
{
    private const uint CreateSuspended = 0x00000004;
    private const uint GenericRead = 0x80000000;
    private const uint ShareRead = 0x00000001;
    private const uint ShareWrite = 0x00000002;
    private const uint OpenExisting = 3;
    private const uint FileFlagBackupSemantics = 0x02000000;
    private const uint JobObjectLimitKillOnJobClose = 0x00002000;
    private const int JobObjectExtendedLimitInformationClass = 9;
    private const uint Infinite = 0xFFFFFFFF;
    private const uint WaitObject0 = 0;
    private const int StartfUseShowWindow = 0x00000001;
    private const int StartfUseStdHandles = 0x00000100;
    private const int StdInputHandle = -10;
    private const int StdOutputHandle = -11;
    private const int StdErrorHandle = -12;
    private const int MaximumApprovedFiles = 256;
    private const int MaximumArguments = 1024;
    private const int MaximumTargetEnvironmentOverrides = 128;
    private const int MaximumPostResumeDelayMilliseconds = 1000;
    private const int MaximumPayloadCharacters = 32768;
    private const int FailureExitCodeUnknown = 100;
    private const int FailureExitCodeJobCreation = 101;
    private const int FailureExitCodeTargetCreation = 102;
    private const int FailureExitCodeJobAssignment = 103;
    private const int FailureExitCodeTargetResume = 104;
    private const int FailureExitCodeTargetThreadClose = 105;
    private const int FailureExitCodeAcknowledgmentWrite = 106;
    private const int FailureExitCodeTargetFileNotFound = 107;
    private const int FailureExitCodeTargetPathNotFound = 108;
    private const int FailureExitCodeTargetAccessDenied = 109;
    private const int FailureExitCodeTargetSharingViolation = 110;
    private const int FailureExitCodeTargetInvalidParameter = 111;
    private const int FailureExitCodeTargetFilenameTooLong = 112;
    private const int FailureExitCodeResolvedExecutableMissing = 113;
    private const int FailureExitCodeWorkingDirectoryMissing = 114;
    private const int DirectorySyncLaunchPayloadInvalid = 120;
    private const int DirectorySyncLaunchBindingInvalid = 121;
    private const int DirectorySyncLaunchCreateFailed = 122;
    private const int DirectorySyncLaunchChildFailed = 123;
    private const string ProgressPrefix = "__SERVICE_LASSO_LAUNCHER_PROGRESS__:";
    private const string PayloadEnvironmentName = "SERVICE_LASSO_MANAGED_LAUNCH_PAYLOAD";
    private const string DirectorySyncPayloadEnvironmentName = "SERVICE_LASSO_DIRECTORY_SYNC_LAUNCH_PAYLOAD";
    private const string GateEnvironmentName = "SERVICE_LASSO_MANAGED_LAUNCH_GATE";
    private const string ProgressEnvironmentName = "SERVICE_LASSO_MANAGED_LAUNCH_PROGRESS_TOKEN";
    // The directory-sync helper is a reviewed package-adjacent asset.  This
    // launcher never accepts a caller-selected helper identity: the relative
    // location, byte length, and digest are all part of this native boundary.
    private const string DirectorySyncHelperRelativePath = "..\\operator\\windows-directory-sync-helper.exe";
    private const string DirectorySyncHelperSha256 = "b2e1fd8fd2ff08d8fb2cbc69ca89d454da0fd3fdcb397d26bb22f2f156a79c91";
    private const long DirectorySyncHelperByteLength = 4608;

    private static readonly UTF8Encoding StrictUtf8 = new UTF8Encoding(false, true);
    private static string progressToken;
    private static HMACSHA256 progressHmac;

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObjectW(IntPtr jobAttributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetInformationJobObject(
        IntPtr job,
        int informationClass,
        IntPtr information,
        uint informationLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool QueryInformationJobObject(
        IntPtr job,
        int informationClass,
        out JobObjectBasicAccountingInformation information,
        uint informationLength,
        IntPtr returnLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool TerminateJobObject(IntPtr job, uint exitCode);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateProcessW(
        string applicationName,
        StringBuilder commandLine,
        IntPtr processAttributes,
        IntPtr threadAttributes,
        [MarshalAs(UnmanagedType.Bool)] bool inheritHandles,
        uint creationFlags,
        IntPtr environment,
        string currentDirectory,
        ref StartupInfo startupInfo,
        out ProcessInformation processInformation);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateFileW(
        string fileName,
        uint desiredAccess,
        uint shareMode,
        IntPtr securityAttributes,
        uint creationDisposition,
        uint flagsAndAttributes,
        IntPtr templateFile);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint ResumeThread(IntPtr thread);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool TerminateProcess(IntPtr process, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetStdHandle(int standardHandle);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandleW(
        IntPtr file,
        StringBuilder filePath,
        uint filePathLength,
        uint flags);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public uint dwProcessId;
        public uint dwThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectBasicLimitInformation
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectBasicAccountingInformation
    {
        public long TotalUserTime;
        public long TotalKernelTime;
        public long ThisPeriodTotalUserTime;
        public long ThisPeriodTotalKernelTime;
        public uint TotalPageFaultCount;
        public uint TotalProcesses;
        public uint ActiveProcesses;
        public uint TotalTerminatedProcesses;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectExtendedLimitInformation
    {
        public JobObjectBasicLimitInformation BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    private sealed class LaunchPayload
    {
        public string executable { get; set; }
        public string[] args { get; set; }
        public string workingDirectory { get; set; }
        public string ackPath { get; set; }
        public string filesBoundPath { get; set; }
        public string continuePath { get; set; }
        public string releaseToken { get; set; }
        public string filesBoundToken { get; set; }
        public string continueToken { get; set; }
        public string ackToken { get; set; }
        public ApprovedFile[] approvedFiles { get; set; }
        public int executableBindingIndex { get; set; }
        public bool requireExecutableBinding { get; set; }
        public ArgumentBinding[] argumentBindings { get; set; }
        public EnvironmentOverride[] targetEnvironmentOverrides { get; set; }
        public int postResumeDelayMilliseconds { get; set; }
    }

    private sealed class ApprovedFile
    {
        public string file { get; set; }
        public string sha256 { get; set; }
        public long size { get; set; }
    }

    private sealed class ArgumentBinding
    {
        public int index { get; set; }
        public string prefix { get; set; }
        public int bindingIndex { get; set; }
    }

    internal sealed class EnvironmentOverride
    {
        public string name { get; set; }
        public string value { get; set; }
    }

    private sealed class DirectorySyncLaunchPayload
    {
        public string directory { get; set; }
    }

    // Same-invocation original observations, never a durable receipt standing in
    // for live ownership. Failed/unknown releases retain their original objects.
    internal sealed class OriginalObservation
    {
        internal string Site;
        internal int Ordinal;
        internal IntPtr Handle;
        internal FileStream File;
        internal object Resource;
        internal bool Attempted, Closed, Failed;
        internal int NativeStatus;
        internal Exception Exception;
    }
    internal sealed class ManagedInvocation
    {
        internal readonly List<OriginalObservation> Outcomes = new List<OriginalObservation>();
        internal readonly List<FileStream> Files;
        internal IntPtr Job, Process, Thread, Directory;
        internal Exception Primary;
        internal int PrimaryResult;
        // Failed governs unresolved closure/retirement/release, not an ordinary
        // known failed initiating operation. Its original observation survives.
        internal bool Failed;
        internal bool ChildIssuanceUnresolved;
        internal HMACSHA256 Progress;
        internal readonly List<EnvironmentOverride> EnvironmentOwners = new List<EnvironmentOverride>();
        internal ManagedInvocation(List<FileStream> files) { Files = files; }
        internal void Observe(string site, int status, bool failed, Exception exception)
        {
            Outcomes.Add(new OriginalObservation { Site = site, Ordinal = Outcomes.Count,
                NativeStatus = status, Failed = failed, Exception = exception });
            Failed |= failed;
        }
        internal void ObservePrimary(string site, int status, bool failed, Exception exception)
        {
            Outcomes.Add(new OriginalObservation { Site = site, Ordinal = Outcomes.Count,
                NativeStatus = status, Failed = failed, Exception = exception });
        }
        internal bool Release(ref IntPtr handle, string site, int ordinal)
        {
            OriginalObservation previous = Outcomes.Find(o => o.Site == site && o.Ordinal == ordinal && o.Attempted);
            if (previous != null) return previous.Closed; // no retry, including unknown return
            if (handle == IntPtr.Zero) return true;
            OriginalObservation original = new OriginalObservation { Site = site, Ordinal = ordinal,
                Handle = handle, Attempted = true };
            Outcomes.Add(original);
            try
            {
                original.Closed = CloseHandle(original.Handle);
                original.NativeStatus = original.Closed ? 0 : Marshal.GetLastWin32Error();
                original.Failed = !original.Closed;
            }
            catch (Exception failure) { original.Exception = failure; original.Failed = true; }
            Failed |= original.Failed;
            if (original.Closed) handle = IntPtr.Zero;
            return original.Closed;
        }
        internal bool ReleaseFile(FileStream file, int ordinal)
        {
            OriginalObservation previous = Outcomes.Find(o => o.Site == "bound-file-release" && o.Ordinal == ordinal && o.Attempted);
            if (previous != null) return previous.Closed;
            OriginalObservation original = new OriginalObservation { Site = "bound-file-release", Ordinal = ordinal,
                File = file, Attempted = true };
            Outcomes.Add(original);
            try { file.Dispose(); original.Closed = true; }
            catch (Exception failure) { original.Exception = failure; original.Failed = true; }
            Failed |= original.Failed;
            return original.Closed;
        }
    }
    internal static void RetainManagedInvocation(ManagedInvocation owner)
    {
        for (;;)
        {
            try { Thread.Sleep(Timeout.Infinite); }
            catch (Exception failure) { owner.Observe("retention-interrupted", 0, true, failure); }
            GC.KeepAlive(owner);
        }
    }

    public static int Main()
    {
        // Check this before either launch mode consumes a payload.  The
        // JavaScript caller also removes these names, so the trusted loader
        // environment has both an inheritance and a native fail-closed guard.
        try { AssertBootstrapEnvironmentSanitized(); }
        catch { return FailureExitCodeUnknown; }
        string directorySyncPayload = Environment.GetEnvironmentVariable(DirectorySyncPayloadEnvironmentName, EnvironmentVariableTarget.Process);
        if (!String.IsNullOrWhiteSpace(directorySyncPayload))
        {
            return RunDirectorySyncLaunch(directorySyncPayload);
        }
        return RunManagedInvocation(new ManagedInvocation(new List<FileStream>()));
    }

    // The actual managed Main route, with the same invocation available to an
    // independently admitted fixture owner rather than a global inspection slot.
    internal static int RunManagedInvocation(ManagedInvocation invocation)
    {
        IntPtr jobHandle = IntPtr.Zero;
        IntPtr processHandle = IntPtr.Zero;
        IntPtr threadHandle = IntPtr.Zero;
        bool targetAssignedToJob = false;
        List<FileStream> boundFiles = invocation.Files;
        int failureExitCode = FailureExitCodeUnknown;

        try
        {
            ValidateNativeLayouts();
            InitializeProgress();
            SetProgress("launcher_initialization");
            SetProgress("launcher_native_asset_validation");
            SetProgress("launcher_payload_validation");

            string encodedPayload = Environment.GetEnvironmentVariable(PayloadEnvironmentName, EnvironmentVariableTarget.Process);
            string gatePath = Environment.GetEnvironmentVariable(GateEnvironmentName, EnvironmentVariableTarget.Process);
            if (
                String.IsNullOrWhiteSpace(encodedPayload) ||
                encodedPayload.Length > MaximumPayloadCharacters ||
                String.IsNullOrWhiteSpace(gatePath) ||
                !IsFullyQualifiedWindowsPath(gatePath))
            {
                SetProgress("launcher_payload_validation", "launch_evidence");
                throw new InvalidOperationException("Managed launch evidence was missing.");
            }

            byte[] payloadBytes;
            try
            {
                payloadBytes = Convert.FromBase64String(encodedPayload);
            }
            catch
            {
                SetProgress("launcher_payload_validation", "canonical_encoding");
                throw;
            }
            string payloadJson;
            try
            {
                if (!String.Equals(Convert.ToBase64String(payloadBytes), encodedPayload, StringComparison.Ordinal))
                {
                    SetProgress("launcher_payload_validation", "canonical_encoding");
                    throw new InvalidOperationException("Managed launch payload encoding was invalid.");
                }
                try
                {
                    payloadJson = StrictUtf8.GetString(payloadBytes);
                }
                catch
                {
                    SetProgress("launcher_payload_validation", "strict_utf8");
                    throw;
                }
            }
            finally
            {
                Array.Clear(payloadBytes, 0, payloadBytes.Length);
            }
            LaunchPayload payload;
            try
            {
                payload = ParseLaunchPayload(payloadJson);
            }
            catch
            {
                SetProgress("launcher_payload_validation", "json_or_schema");
                throw;
            }
            try
            {
                ValidatePayload(payload);
            }
            catch
            {
                SetProgress("launcher_payload_validation", "semantic_payload");
                throw;
            }
            ClearLaunchEnvironment(invocation);
            if (invocation.Failed) ThrowOriginalRetirementFailure(invocation);

            SetProgress("launcher_gate_observation");
            WaitForGate(gatePath, payload.releaseToken, TimeSpan.FromSeconds(45));

            string[] boundFilePaths = new string[payload.approvedFiles.Length];
            for (int index = 0; index < payload.approvedFiles.Length; index += 1)
            {
                ApprovedFile approvedFile = payload.approvedFiles[index];
                ValidateApprovedFile(approvedFile);
                SetProgress("launcher_file_open");
                FileStream boundFile = new FileStream(
                    approvedFile.file,
                    FileMode.Open,
                    FileAccess.Read,
                    FileShare.Read);
                boundFiles.Add(boundFile);
                if (boundFile.Length != approvedFile.size)
                {
                    throw new InvalidOperationException("Managed launch file size changed.");
                }

                SetProgress("launcher_file_hash");
                string actualSha256;
                using (SHA256 sha256 = SHA256.Create())
                {
                    actualSha256 = ToLowerHex(sha256.ComputeHash(boundFile));
                }
                if (!String.Equals(actualSha256, approvedFile.sha256, StringComparison.Ordinal))
                {
                    throw new InvalidOperationException("Managed launch file digest changed.");
                }

                SetProgress("launcher_file_final_path");
                StringBuilder finalPathBuffer = new StringBuilder(32768);
                uint finalPathLength = GetFinalPathNameByHandleW(
                    boundFile.SafeFileHandle.DangerousGetHandle(),
                    finalPathBuffer,
                    (uint)finalPathBuffer.Capacity,
                    0);
                if (finalPathLength == 0 || finalPathLength >= finalPathBuffer.Capacity)
                {
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "Managed launch final path query failed.");
                }
                string finalPath = NormalizeFinalPath(finalPathBuffer.ToString());
                if (!Path.IsPathRooted(finalPath))
                {
                    throw new InvalidOperationException("Managed launch final path evidence was invalid.");
                }
                boundFilePaths[index] = finalPath;
            }

            string resolvedExecutable = payload.executable;
            if (payload.requireExecutableBinding && payload.executableBindingIndex < 0)
            {
                throw new InvalidOperationException("Managed executable was not bound to approved bytes.");
            }
            if (payload.executableBindingIndex >= 0)
            {
                resolvedExecutable = BoundPathAt(boundFilePaths, payload.executableBindingIndex);
            }

            string[] resolvedArgs = (string[])payload.args.Clone();
            foreach (ArgumentBinding argumentBinding in payload.argumentBindings)
            {
                if (argumentBinding == null || argumentBinding.index < 0 || argumentBinding.index >= resolvedArgs.Length)
                {
                    throw new InvalidOperationException("Managed argument binding was invalid.");
                }
                string boundPath = BoundPathAt(boundFilePaths, argumentBinding.bindingIndex);
                resolvedArgs[argumentBinding.index] = (argumentBinding.prefix ?? String.Empty) + boundPath;
            }

            SetProgress("launcher_binding_publication");
            RetireProgress(invocation);
            if (invocation.Failed) ThrowOriginalRetirementFailure(invocation);
            File.WriteAllText(payload.filesBoundPath, payload.filesBoundToken, StrictUtf8);
            WaitForGate(payload.continuePath, payload.continueToken, TimeSpan.FromSeconds(45));

            failureExitCode = FailureExitCodeJobCreation;
            jobHandle = CreateJobObjectW(IntPtr.Zero, null);
            if (jobHandle == IntPtr.Zero)
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Managed launch job creation failed.");
            }
            ConfigureKillOnClose(jobHandle);

            StartupInfo startupInfo = new StartupInfo();
            startupInfo.cb = Marshal.SizeOf(typeof(StartupInfo));
            startupInfo.dwFlags = StartfUseShowWindow | StartfUseStdHandles;
            startupInfo.wShowWindow = 0;
            startupInfo.hStdInput = GetStdHandle(StdInputHandle);
            startupInfo.hStdOutput = GetStdHandle(StdOutputHandle);
            startupInfo.hStdError = GetStdHandle(StdErrorHandle);
            ProcessInformation processInformation;
            StringBuilder commandLine = new StringBuilder(BuildCommandLine(resolvedExecutable, resolvedArgs));
            bool targetCreated;
            int targetCreationError = 0;
            failureExitCode = FailureExitCodeTargetCreation;
            if (!File.Exists(resolvedExecutable))
            {
                failureExitCode = FailureExitCodeResolvedExecutableMissing;
                throw new InvalidOperationException("Managed target executable disappeared before creation.");
            }
            if (!Directory.Exists(payload.workingDirectory))
            {
                failureExitCode = FailureExitCodeWorkingDirectoryMissing;
                throw new InvalidOperationException("Managed target working directory disappeared before creation.");
            }
            ApplyTargetEnvironmentOverrides(payload.targetEnvironmentOverrides, invocation);
            try
            {
                invocation.ChildIssuanceUnresolved = true;
                targetCreated = CreateProcessW(
                    resolvedExecutable,
                    commandLine,
                    IntPtr.Zero,
                    IntPtr.Zero,
                    true,
                    CreateSuspended,
                    IntPtr.Zero,
                    payload.workingDirectory,
                    ref startupInfo,
                    out processInformation);
                if (!targetCreated)
                {
                    targetCreationError = Marshal.GetLastWin32Error();
                    failureExitCode = TargetCreationFailureExitCode(targetCreationError);
                    Win32Exception original = new Win32Exception(targetCreationError, "Managed target creation failed.");
                    invocation.Primary = original;
                    invocation.ChildIssuanceUnresolved = false;
                    invocation.ObservePrimary("target-original-create", targetCreationError, true, original);
                    throw original;
                }
                if (targetCreated)
                {
                    processHandle = processInformation.hProcess;
                    threadHandle = processInformation.hThread;
                    invocation.Observe("target-original-create", 0, false, null);
                }
            }
            catch (Exception original)
            {
                if (invocation.Primary == null)
                {
                    invocation.Primary = original;
                    invocation.Observe("target-original-create-throw", 0, true, original);
                }
                throw;
            }
            finally
            {
                try { ClearTargetEnvironmentOverrides(payload.targetEnvironmentOverrides, invocation, payload.targetEnvironmentOverrides.Length); }
                catch (Exception later) { invocation.Observe("target-environment-retirement-unknown-return", 0, true, later); }
            }
            if (processHandle == IntPtr.Zero || threadHandle == IntPtr.Zero || processInformation.dwProcessId == 0)
            {
                throw new InvalidOperationException("Managed target process evidence was invalid.");
            }
            invocation.ChildIssuanceUnresolved = false;
            if (invocation.Failed) ThrowOriginalRetirementFailure(invocation);
            failureExitCode = FailureExitCodeJobAssignment;
            if (!AssignProcessToJobObject(jobHandle, processHandle))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Managed target job assignment failed.");
            }
            targetAssignedToJob = true;
            failureExitCode = FailureExitCodeTargetResume;
            if (ResumeThread(threadHandle) == UInt32.MaxValue)
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Managed target resume failed.");
            }
            if (payload.postResumeDelayMilliseconds > 0)
            {
                Thread.Sleep(payload.postResumeDelayMilliseconds);
            }
            failureExitCode = FailureExitCodeTargetThreadClose;
            if (!invocation.Release(ref threadHandle, "target-thread-release", 0))
            {
                OriginalObservation original = invocation.Outcomes.Find(o => o.Site == "target-thread-release" && o.Attempted);
                if (original.Exception != null) throw original.Exception;
                throw new Win32Exception(original.NativeStatus, "Managed target thread handle close failed.");
            }
            failureExitCode = FailureExitCodeAcknowledgmentWrite;
            string acknowledgment = "{\"token\":\"" + payload.ackToken + "\",\"pid\":" +
                processInformation.dwProcessId.ToString(System.Globalization.CultureInfo.InvariantCulture) + "}";
            File.WriteAllText(payload.ackPath, acknowledgment, StrictUtf8);

            uint targetWait = WaitForSingleObject(processHandle, Infinite);
            int targetWaitError = targetWait == UInt32.MaxValue ? Marshal.GetLastWin32Error() : unchecked((int)targetWait);
            invocation.Observe("target-primary-wait", targetWaitError, targetWait != WaitObject0, null);
            if (targetWait != WaitObject0)
            {
                throw new Win32Exception(targetWaitError, "Managed target wait failed.");
            }
            uint exitCode;
            if (!GetExitCodeProcess(processHandle, out exitCode))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Managed target exit-code query failed.");
            }
            invocation.PrimaryResult = unchecked((int)exitCode);
            return invocation.PrimaryResult;
        }
        catch (Exception primary)
        {
            if (invocation.Primary == null) invocation.Primary = primary;
            invocation.PrimaryResult = failureExitCode;
            return failureExitCode;
        }
        finally
        {
            try
            {
                ClearLaunchEnvironment(invocation);
            }
            catch (Exception failure)
            {
                invocation.Observe("launch-environment-retirement", 0, true, failure);
            }
            try { RetireProgress(invocation); }
            catch (Exception failure) { invocation.Observe("progress-retirement", 0, true, failure); }
            invocation.Job = jobHandle; invocation.Process = processHandle; invocation.Thread = threadHandle;
            // Retain on unknown child closure before any file release. Once actual
            // closure is known, a failed original release does not hide later safe ones.
            try { ContainManagedJobBeforeFileRelease(ref jobHandle, processHandle, targetAssignedToJob, invocation); }
            catch (Exception failure)
            {
                invocation.Observe("managed-containment-unknown-return", 0, true, failure);
                RetainManagedInvocation(invocation);
            }
            FinishManagedReleases(invocation, ref threadHandle, ref processHandle);
        }
    }

    // Caller establishes genuine original child/job closure before this seam.
    internal static void FinishManagedReleases(ManagedInvocation invocation, ref IntPtr thread, ref IntPtr process)
    {
        invocation.Release(ref thread, "target-thread-release", 0);
        invocation.Release(ref process, "target-process-release", 0);
        for (int ordinal = 0; ordinal < invocation.Files.Count; ordinal++) invocation.ReleaseFile(invocation.Files[ordinal], ordinal);
        if (invocation.Failed) RetainManagedInvocation(invocation);
    }

    private static int TargetCreationFailureExitCode(int errorCode)
    {
        switch (errorCode)
        {
            case 2: return FailureExitCodeTargetFileNotFound;
            case 3: return FailureExitCodeTargetPathNotFound;
            case 5: return FailureExitCodeTargetAccessDenied;
            case 32: return FailureExitCodeTargetSharingViolation;
            case 87: return FailureExitCodeTargetInvalidParameter;
            case 206: return FailureExitCodeTargetFilenameTooLong;
            default: return FailureExitCodeTargetCreation;
        }
    }

    private static LaunchPayload ParseLaunchPayload(string payloadJson)
    {
        ValidateStrictJsonSyntax(payloadJson);
        object parsed = new JavaScriptSerializer().DeserializeObject(payloadJson);
        IDictionary<string, object> root = RequireObject(parsed, "payload");
        RequireExactKeys(root, new string[]
        {
            "executable",
            "args",
            "workingDirectory",
            "ackPath",
            "filesBoundPath",
            "continuePath",
            "releaseToken",
            "filesBoundToken",
            "continueToken",
            "ackToken",
            "approvedFiles",
            "executableBindingIndex",
            "requireExecutableBinding",
            "argumentBindings",
            "targetEnvironmentOverrides",
            "postResumeDelayMilliseconds",
        }, "payload");

        object[] rawArgs = RequireArray(root["args"], "args", MaximumArguments);
        string[] args = new string[rawArgs.Length];
        for (int index = 0; index < rawArgs.Length; index += 1)
        {
            args[index] = RequireString(rawArgs[index], "argument", true);
        }

        object[] rawApprovedFiles = RequireArray(root["approvedFiles"], "approvedFiles", MaximumApprovedFiles);
        ApprovedFile[] approvedFiles = new ApprovedFile[rawApprovedFiles.Length];
        for (int index = 0; index < rawApprovedFiles.Length; index += 1)
        {
            IDictionary<string, object> rawApprovedFile = RequireObject(rawApprovedFiles[index], "approvedFile");
            RequireExactKeys(rawApprovedFile, new string[] { "file", "sha256", "size" }, "approvedFile");
            approvedFiles[index] = new ApprovedFile
            {
                file = RequireString(rawApprovedFile["file"], "approved file path", false),
                sha256 = RequireString(rawApprovedFile["sha256"], "approved file digest", false),
                size = RequireLong(rawApprovedFile["size"], "approved file size"),
            };
        }

        object[] rawArgumentBindings = RequireArray(root["argumentBindings"], "argumentBindings", MaximumArguments);
        ArgumentBinding[] argumentBindings = new ArgumentBinding[rawArgumentBindings.Length];
        for (int index = 0; index < rawArgumentBindings.Length; index += 1)
        {
            IDictionary<string, object> rawBinding = RequireObject(rawArgumentBindings[index], "argumentBinding");
            RequireExactKeys(rawBinding, new string[] { "index", "prefix", "bindingIndex" }, "argumentBinding");
            argumentBindings[index] = new ArgumentBinding
            {
                index = RequireInt(rawBinding["index"], "argument index"),
                prefix = RequireString(rawBinding["prefix"], "argument prefix", true),
                bindingIndex = RequireInt(rawBinding["bindingIndex"], "argument binding index"),
            };
        }

        object[] rawEnvironmentOverrides = RequireArray(
            root["targetEnvironmentOverrides"],
            "targetEnvironmentOverrides",
            MaximumTargetEnvironmentOverrides);
        EnvironmentOverride[] targetEnvironmentOverrides = new EnvironmentOverride[rawEnvironmentOverrides.Length];
        for (int index = 0; index < rawEnvironmentOverrides.Length; index += 1)
        {
            IDictionary<string, object> rawEnvironmentOverride = RequireObject(
                rawEnvironmentOverrides[index],
                "targetEnvironmentOverride");
            RequireExactKeys(
                rawEnvironmentOverride,
                new string[] { "name", "value" },
                "targetEnvironmentOverride");
            targetEnvironmentOverrides[index] = new EnvironmentOverride
            {
                name = RequireString(rawEnvironmentOverride["name"], "target environment name", false),
                value = RequireString(rawEnvironmentOverride["value"], "target environment value", true),
            };
        }

        return new LaunchPayload
        {
            executable = RequireString(root["executable"], "executable", false),
            args = args,
            workingDirectory = RequireString(root["workingDirectory"], "working directory", false),
            ackPath = RequireString(root["ackPath"], "acknowledgment path", false),
            filesBoundPath = RequireString(root["filesBoundPath"], "files-bound path", false),
            continuePath = RequireString(root["continuePath"], "continuation path", false),
            releaseToken = RequireString(root["releaseToken"], "release token", false),
            filesBoundToken = RequireString(root["filesBoundToken"], "files-bound token", false),
            continueToken = RequireString(root["continueToken"], "continuation token", false),
            ackToken = RequireString(root["ackToken"], "acknowledgment token", false),
            approvedFiles = approvedFiles,
            executableBindingIndex = RequireInt(root["executableBindingIndex"], "executable binding index"),
            requireExecutableBinding = RequireBoolean(root["requireExecutableBinding"], "executable binding requirement"),
            argumentBindings = argumentBindings,
            targetEnvironmentOverrides = targetEnvironmentOverrides,
            postResumeDelayMilliseconds = RequireInt(
                root["postResumeDelayMilliseconds"],
                "post-resume delay"),
        };
    }

    private static void ValidateStrictJsonSyntax(string json)
    {
        int index = 0;
        ParseJsonValue(json, ref index, 0);
        SkipJsonWhitespace(json, ref index);
        if (index != json.Length)
        {
            throw new InvalidOperationException("Managed launch payload JSON was invalid.");
        }
    }

    private static void ParseJsonValue(string json, ref int index, int depth)
    {
        if (depth > 8)
        {
            throw new InvalidOperationException("Managed launch payload JSON was too deeply nested.");
        }
        SkipJsonWhitespace(json, ref index);
        if (index >= json.Length)
        {
            throw new InvalidOperationException("Managed launch payload JSON was incomplete.");
        }
        char marker = json[index];
        if (marker == '{')
        {
            ParseJsonObject(json, ref index, depth + 1);
            return;
        }
        if (marker == '[')
        {
            ParseJsonArray(json, ref index, depth + 1);
            return;
        }
        if (marker == '"')
        {
            ParseJsonString(json, ref index);
            return;
        }
        if (marker == 't')
        {
            ConsumeJsonLiteral(json, ref index, "true");
            return;
        }
        if (marker == 'f')
        {
            ConsumeJsonLiteral(json, ref index, "false");
            return;
        }
        if (marker == 'n')
        {
            ConsumeJsonLiteral(json, ref index, "null");
            return;
        }
        ParseJsonNumber(json, ref index);
    }

    private static void ParseJsonObject(string json, ref int index, int depth)
    {
        index += 1;
        SkipJsonWhitespace(json, ref index);
        HashSet<string> keys = new HashSet<string>(StringComparer.Ordinal);
        if (index < json.Length && json[index] == '}')
        {
            index += 1;
            return;
        }
        while (index < json.Length)
        {
            SkipJsonWhitespace(json, ref index);
            if (index >= json.Length || json[index] != '"')
            {
                throw new InvalidOperationException("Managed launch payload object key was invalid.");
            }
            string key = ParseJsonString(json, ref index);
            if (!keys.Add(key))
            {
                throw new InvalidOperationException("Managed launch payload contained a duplicate property.");
            }
            SkipJsonWhitespace(json, ref index);
            if (index >= json.Length || json[index] != ':')
            {
                throw new InvalidOperationException("Managed launch payload object separator was invalid.");
            }
            index += 1;
            ParseJsonValue(json, ref index, depth);
            SkipJsonWhitespace(json, ref index);
            if (index < json.Length && json[index] == ',')
            {
                index += 1;
                continue;
            }
            if (index < json.Length && json[index] == '}')
            {
                index += 1;
                return;
            }
            throw new InvalidOperationException("Managed launch payload object terminator was invalid.");
        }
        throw new InvalidOperationException("Managed launch payload object was incomplete.");
    }

    private static void ParseJsonArray(string json, ref int index, int depth)
    {
        index += 1;
        SkipJsonWhitespace(json, ref index);
        if (index < json.Length && json[index] == ']')
        {
            index += 1;
            return;
        }
        while (index < json.Length)
        {
            ParseJsonValue(json, ref index, depth);
            SkipJsonWhitespace(json, ref index);
            if (index < json.Length && json[index] == ',')
            {
                index += 1;
                continue;
            }
            if (index < json.Length && json[index] == ']')
            {
                index += 1;
                return;
            }
            throw new InvalidOperationException("Managed launch payload array terminator was invalid.");
        }
        throw new InvalidOperationException("Managed launch payload array was incomplete.");
    }

    private static string ParseJsonString(string json, ref int index)
    {
        index += 1;
        StringBuilder value = new StringBuilder();
        while (index < json.Length)
        {
            char character = json[index];
            index += 1;
            if (character == '"')
            {
                return value.ToString();
            }
            if (character < 0x20)
            {
                throw new InvalidOperationException("Managed launch payload string was invalid.");
            }
            if (character != '\\')
            {
                value.Append(character);
                continue;
            }
            if (index >= json.Length)
            {
                throw new InvalidOperationException("Managed launch payload escape was incomplete.");
            }
            char escape = json[index];
            index += 1;
            switch (escape)
            {
                case '"': value.Append('"'); break;
                case '\\': value.Append('\\'); break;
                case '/': value.Append('/'); break;
                case 'b': value.Append('\b'); break;
                case 'f': value.Append('\f'); break;
                case 'n': value.Append('\n'); break;
                case 'r': value.Append('\r'); break;
                case 't': value.Append('\t'); break;
                case 'u':
                    if (index + 4 > json.Length)
                    {
                        throw new InvalidOperationException("Managed launch payload Unicode escape was incomplete.");
                    }
                    int codeUnit = 0;
                    for (int offset = 0; offset < 4; offset += 1)
                    {
                        int digit = HexDigitValue(json[index + offset]);
                        if (digit < 0)
                        {
                            throw new InvalidOperationException("Managed launch payload Unicode escape was invalid.");
                        }
                        codeUnit = (codeUnit * 16) + digit;
                    }
                    value.Append((char)codeUnit);
                    index += 4;
                    break;
                default:
                    throw new InvalidOperationException("Managed launch payload escape was invalid.");
            }
        }
        throw new InvalidOperationException("Managed launch payload string was incomplete.");
    }

    private static void ParseJsonNumber(string json, ref int index)
    {
        if (index < json.Length && json[index] == '-')
        {
            index += 1;
        }
        if (index >= json.Length)
        {
            throw new InvalidOperationException("Managed launch payload number was incomplete.");
        }
        if (json[index] == '0')
        {
            index += 1;
        }
        else
        {
            int integerStart = index;
            while (index < json.Length && json[index] >= '0' && json[index] <= '9') index += 1;
            if (integerStart == index || json[integerStart] == '0')
            {
                throw new InvalidOperationException("Managed launch payload number was invalid.");
            }
        }
        if (index < json.Length && json[index] == '.')
        {
            index += 1;
            int fractionStart = index;
            while (index < json.Length && json[index] >= '0' && json[index] <= '9') index += 1;
            if (fractionStart == index)
            {
                throw new InvalidOperationException("Managed launch payload number was invalid.");
            }
        }
        if (index < json.Length && (json[index] == 'e' || json[index] == 'E'))
        {
            index += 1;
            if (index < json.Length && (json[index] == '+' || json[index] == '-')) index += 1;
            int exponentStart = index;
            while (index < json.Length && json[index] >= '0' && json[index] <= '9') index += 1;
            if (exponentStart == index)
            {
                throw new InvalidOperationException("Managed launch payload number was invalid.");
            }
        }
    }

    private static void ConsumeJsonLiteral(string json, ref int index, string literal)
    {
        if (index + literal.Length > json.Length ||
            !String.Equals(json.Substring(index, literal.Length), literal, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Managed launch payload literal was invalid.");
        }
        index += literal.Length;
    }

    private static void SkipJsonWhitespace(string json, ref int index)
    {
        while (index < json.Length)
        {
            char character = json[index];
            if (character != ' ' && character != '\t' && character != '\r' && character != '\n')
            {
                return;
            }
            index += 1;
        }
    }

    private static int HexDigitValue(char value)
    {
        if (value >= '0' && value <= '9') return value - '0';
        if (value >= 'a' && value <= 'f') return value - 'a' + 10;
        if (value >= 'A' && value <= 'F') return value - 'A' + 10;
        return -1;
    }

    private static IDictionary<string, object> RequireObject(object value, string label)
    {
        IDictionary<string, object> record = value as IDictionary<string, object>;
        if (record == null)
        {
            throw new InvalidOperationException("Managed launch " + label + " must be an object.");
        }
        return record;
    }

    private static object[] RequireArray(object value, string label, int maximumLength)
    {
        object[] items = value as object[];
        if (items == null || items.Length > maximumLength)
        {
            throw new InvalidOperationException("Managed launch " + label + " must be a bounded array.");
        }
        return items;
    }

    private static string RequireString(object value, string label, bool allowEmpty)
    {
        string text = value as string;
        if (
            text == null ||
            text.IndexOf('\0') >= 0 ||
            (!allowEmpty && String.IsNullOrWhiteSpace(text)))
        {
            throw new InvalidOperationException("Managed launch " + label + " must be a string.");
        }
        return text;
    }

    private static int RequireInt(object value, string label)
    {
        if (!(value is int))
        {
            throw new InvalidOperationException("Managed launch " + label + " must be an integer.");
        }
        return (int)value;
    }

    private static long RequireLong(object value, string label)
    {
        if (value is int)
        {
            return (int)value;
        }
        if (value is long)
        {
            return (long)value;
        }
        throw new InvalidOperationException("Managed launch " + label + " must be an integer.");
    }

    private static bool RequireBoolean(object value, string label)
    {
        if (!(value is bool))
        {
            throw new InvalidOperationException("Managed launch " + label + " must be a boolean.");
        }
        return (bool)value;
    }

    private static void RequireExactKeys(
        IDictionary<string, object> record,
        string[] expectedKeys,
        string label)
    {
        if (record.Count != expectedKeys.Length)
        {
            throw new InvalidOperationException("Managed launch " + label + " property set was invalid.");
        }
        foreach (string key in expectedKeys)
        {
            if (!record.ContainsKey(key))
            {
                throw new InvalidOperationException("Managed launch " + label + " property set was invalid.");
            }
        }
    }

    private static void ValidatePayload(LaunchPayload payload)
    {
        if (
            payload == null ||
            String.IsNullOrWhiteSpace(payload.executable) ||
            payload.args == null ||
            payload.args.Length > MaximumArguments ||
            String.IsNullOrWhiteSpace(payload.workingDirectory) ||
            !IsFullyQualifiedWindowsPath(payload.workingDirectory) ||
            String.IsNullOrWhiteSpace(payload.ackPath) ||
            !IsFullyQualifiedWindowsPath(payload.ackPath) ||
            String.IsNullOrWhiteSpace(payload.filesBoundPath) ||
            !IsFullyQualifiedWindowsPath(payload.filesBoundPath) ||
            String.IsNullOrWhiteSpace(payload.continuePath) ||
            !IsFullyQualifiedWindowsPath(payload.continuePath) ||
            !IsLowerHex64(payload.releaseToken) ||
            !IsLowerHex64(payload.filesBoundToken) ||
            !IsLowerHex64(payload.continueToken) ||
            !IsLowerHex64(payload.ackToken) ||
            payload.approvedFiles == null ||
            payload.approvedFiles.Length > MaximumApprovedFiles ||
            payload.argumentBindings == null ||
            payload.argumentBindings.Length > payload.args.Length ||
            payload.targetEnvironmentOverrides == null ||
            payload.targetEnvironmentOverrides.Length > MaximumTargetEnvironmentOverrides ||
            payload.postResumeDelayMilliseconds < 0 ||
            payload.postResumeDelayMilliseconds > MaximumPostResumeDelayMilliseconds)
        {
            throw new InvalidOperationException("Managed launch evidence was invalid.");
        }
        HashSet<string> tokens = new HashSet<string>(StringComparer.Ordinal)
        {
            payload.releaseToken,
            payload.filesBoundToken,
            payload.continueToken,
            payload.ackToken,
        };
        if (tokens.Count != 4)
        {
            throw new InvalidOperationException("Managed launch gate evidence was not independent.");
        }
        HashSet<int> argumentIndexes = new HashSet<int>();
        foreach (ArgumentBinding binding in payload.argumentBindings)
        {
            if (
                binding == null ||
                binding.index < 0 ||
                binding.index >= payload.args.Length ||
                binding.prefix == null ||
                binding.bindingIndex < 0 ||
                binding.bindingIndex >= payload.approvedFiles.Length ||
                !argumentIndexes.Add(binding.index))
            {
                throw new InvalidOperationException("Managed launch argument binding was invalid.");
            }
        }
        HashSet<string> environmentNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (EnvironmentOverride environmentOverride in payload.targetEnvironmentOverrides)
        {
            if (
                environmentOverride == null ||
                !IsLoaderSensitiveEnvironmentName(environmentOverride.name) ||
                environmentOverride.name.IndexOf('=') >= 0 ||
                environmentOverride.name.IndexOf('\0') >= 0 ||
                environmentOverride.value == null ||
                environmentOverride.value.IndexOf('\0') >= 0 ||
                !environmentNames.Add(environmentOverride.name))
            {
                throw new InvalidOperationException("Managed target environment evidence was invalid.");
            }
        }
    }

    private static void ValidateNativeLayouts()
    {
        int expectedStartupInfoSize = IntPtr.Size == 8 ? 104 : 68;
        int expectedProcessInformationSize = IntPtr.Size == 8 ? 24 : 16;
        int expectedJobInformationSize = IntPtr.Size == 8 ? 144 : 108;
        int expectedJobAccountingSize = 48;
        if (
            Marshal.SizeOf(typeof(StartupInfo)) != expectedStartupInfoSize ||
            Marshal.SizeOf(typeof(ProcessInformation)) != expectedProcessInformationSize ||
            Marshal.SizeOf(typeof(JobObjectExtendedLimitInformation)) != expectedJobInformationSize ||
            Marshal.SizeOf(typeof(JobObjectBasicAccountingInformation)) != expectedJobAccountingSize)
        {
            throw new InvalidOperationException("Managed launcher native structure layout was invalid.");
        }
    }

    private static void ValidateApprovedFile(ApprovedFile approvedFile)
    {
        if (
            approvedFile == null ||
            String.IsNullOrWhiteSpace(approvedFile.file) ||
            !IsFullyQualifiedWindowsPath(approvedFile.file) ||
            !IsLowerHex64(approvedFile.sha256) ||
            approvedFile.size < 0)
        {
            throw new InvalidOperationException("Managed launch file evidence was invalid.");
        }
    }

    private static bool IsFullyQualifiedWindowsPath(string value)
    {
        if (String.IsNullOrWhiteSpace(value))
        {
            return false;
        }
        if (
            value.Length >= 3 &&
            Char.IsLetter(value[0]) &&
            value[1] == ':' &&
            IsDirectorySeparator(value[2]))
        {
            return true;
        }
        if (value.Length < 5 || !IsDirectorySeparator(value[0]) || !IsDirectorySeparator(value[1]))
        {
            return false;
        }
        int serverEnd = IndexOfDirectorySeparator(value, 2);
        if (serverEnd <= 2 || serverEnd >= value.Length - 1)
        {
            return false;
        }
        int shareEnd = IndexOfDirectorySeparator(value, serverEnd + 1);
        return shareEnd == -1
            ? serverEnd < value.Length - 1
            : shareEnd > serverEnd + 1;
    }

    private static bool IsDirectorySeparator(char value)
    {
        return value == '\\' || value == '/';
    }

    private static int IndexOfDirectorySeparator(string value, int startIndex)
    {
        for (int index = startIndex; index < value.Length; index += 1)
        {
            if (IsDirectorySeparator(value[index]))
            {
                return index;
            }
        }
        return -1;
    }

    private static bool IsLoaderSensitiveEnvironmentName(string name)
    {
        return !String.IsNullOrWhiteSpace(name) && (
            name.StartsWith("COR_", StringComparison.OrdinalIgnoreCase) ||
            name.StartsWith("CORECLR_", StringComparison.OrdinalIgnoreCase) ||
            name.StartsWith("COMPLUS_", StringComparison.OrdinalIgnoreCase) ||
            name.StartsWith("APPDOMAIN_MANAGER", StringComparison.OrdinalIgnoreCase));
    }

    private static void AssertBootstrapEnvironmentSanitized()
    {
        foreach (DictionaryEntry entry in Environment.GetEnvironmentVariables(EnvironmentVariableTarget.Process))
        {
            if (entry.Key is string && IsLoaderSensitiveEnvironmentName((string)entry.Key))
            {
                throw new InvalidOperationException("Managed launcher bootstrap environment was unsafe.");
            }
        }
    }

    internal static void ApplyTargetEnvironmentOverrides(EnvironmentOverride[] environmentOverrides, ManagedInvocation invocation)
    {
        int appliedCount = 0;
        try
        {
            foreach (EnvironmentOverride environmentOverride in environmentOverrides)
            {
                invocation.EnvironmentOwners.Add(environmentOverride);
                Environment.SetEnvironmentVariable(
                    environmentOverride.name,
                    environmentOverride.value,
                    EnvironmentVariableTarget.Process);
                appliedCount += 1;
                invocation.Outcomes.Add(new OriginalObservation { Site = "target-environment-apply", Ordinal = appliedCount - 1,
                    Resource = environmentOverride, Attempted = true, Closed = true });
            }
        }
        catch (Exception primary)
        {
            invocation.Primary = primary;
            invocation.Outcomes.Add(new OriginalObservation { Site = "target-environment-apply", Ordinal = appliedCount,
                Resource = environmentOverrides[appliedCount], Attempted = true, Failed = true, Exception = primary });
            // Include the attempted original name even when its application
            // outcome is unknown. Each safe rollback has its own disposition.
            try { ClearTargetEnvironmentOverrides(environmentOverrides, invocation, appliedCount + 1); }
            catch (Exception later) { invocation.Observe("target-environment-rollback-unknown-return", 0, true, later); }
            throw;
        }
    }

    internal static void ClearTargetEnvironmentOverrides(EnvironmentOverride[] environmentOverrides, ManagedInvocation invocation, int count)
    {
        for (int index = 0; index < count; index++)
        {
            EnvironmentOverride environmentOverride = environmentOverrides[index];
            RetireEnvironmentName(invocation, environmentOverride.name, environmentOverride, "target-environment-clear", index);
        }
    }

    private static void RetireEnvironmentName(ManagedInvocation invocation, string name, object resource, string site, int ordinal)
    {
        if (invocation.Outcomes.Exists(o => o.Site == site && o.Ordinal == ordinal && o.Attempted)) return;
        OriginalObservation original = new OriginalObservation { Site = site, Ordinal = ordinal, Resource = resource, Attempted = true };
        invocation.Outcomes.Add(original);
        try
        {
            Environment.SetEnvironmentVariable(name, null, EnvironmentVariableTarget.Process);
            original.Closed = true;
        }
        catch (Exception failure)
        {
            original.Exception = failure; original.Failed = true; invocation.Failed = true;
        }
    }

    internal static void RetireProgress(ManagedInvocation invocation)
    {
        progressToken = null;
        RetireProgressOwned(invocation, ref progressHmac);
    }
    internal static void RetireProgressOwned(ManagedInvocation invocation, ref HMACSHA256 originalHmac)
    {
        if (invocation.Outcomes.Exists(o => o.Site == "progress-retirement" && o.Attempted)) return;
        if (originalHmac == null) return;
        invocation.Progress = originalHmac;
        OriginalObservation original = new OriginalObservation { Site = "progress-retirement", Ordinal = 0,
            Resource = originalHmac, Attempted = true };
        invocation.Outcomes.Add(original);
        try { invocation.Progress.Dispose(); original.Closed = true; originalHmac = null; }
        catch (Exception failure)
        {
            original.Exception = failure; original.Failed = true; invocation.Failed = true;
        }
    }

    private static void ClearLaunchEnvironment(ManagedInvocation invocation)
    {
        string[] names = { PayloadEnvironmentName, GateEnvironmentName, ProgressEnvironmentName };
        for (int index = 0; index < names.Length; index++)
            RetireEnvironmentName(invocation, names[index], names[index], "launch-environment-clear", index);
    }

    private static void ThrowOriginalRetirementFailure(ManagedInvocation invocation)
    {
        OriginalObservation original = invocation.Outcomes.Find(o => o.Failed && o.Exception != null);
        if (original != null) throw original.Exception;
        throw new InvalidOperationException("Managed original retirement failed.");
    }

    private static string BoundPathAt(string[] boundFilePaths, int index)
    {
        if (index < 0 || index >= boundFilePaths.Length || String.IsNullOrWhiteSpace(boundFilePaths[index]))
        {
            throw new InvalidOperationException("Managed launch file binding was invalid.");
        }
        return boundFilePaths[index];
    }

    private static void ConfigureKillOnClose(IntPtr jobHandle)
    {
        JobObjectExtendedLimitInformation information = new JobObjectExtendedLimitInformation();
        information.BasicLimitInformation.LimitFlags = JobObjectLimitKillOnJobClose;
        int informationSize = Marshal.SizeOf(typeof(JobObjectExtendedLimitInformation));
        IntPtr informationPointer = Marshal.AllocHGlobal(informationSize);
        try
        {
            Marshal.StructureToPtr(information, informationPointer, false);
            if (!SetInformationJobObject(
                jobHandle,
                JobObjectExtendedLimitInformationClass,
                informationPointer,
                (uint)informationSize))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Managed launch job configuration failed.");
            }
        }
        finally
        {
            Marshal.FreeHGlobal(informationPointer);
        }
    }

    private static void ContainManagedJobBeforeFileRelease(
        ref IntPtr jobHandle,
        IntPtr processHandle,
        bool targetAssignedToJob,
        ManagedInvocation invocation)
    {
        // An unavailable create return or malformed issued child cannot become
        // no child merely because a local handle is zero. A failed original wait
        // cannot be retried by containment and then laundered into closure.
        if (invocation.ChildIssuanceUnresolved || invocation.Outcomes.Exists(o => o.Site == "target-primary-wait" && o.Failed))
            RetainManagedInvocation(invocation);
        if (!targetAssignedToJob && processHandle != IntPtr.Zero)
        {
            bool terminated = TerminateProcess(processHandle, 1);
            int terminateError = terminated ? 0 : Marshal.GetLastWin32Error();
            invocation.Observe("unassigned-process-terminate", terminateError, !terminated, null);
            uint waited = WaitForSingleObject(processHandle, Infinite);
            int waitError = waited == UInt32.MaxValue ? Marshal.GetLastWin32Error() : unchecked((int)waited);
            invocation.Observe("unassigned-process-wait", waitError, waited != WaitObject0, null);
            if (!terminated || waited != WaitObject0) RetainManagedInvocation(invocation);
        }
        if (jobHandle == IntPtr.Zero)
        {
            return;
        }
        bool jobTerminated = TerminateJobObject(jobHandle, 1);
        int jobError = jobTerminated ? 0 : Marshal.GetLastWin32Error();
        invocation.Observe("managed-job-terminate", jobError, !jobTerminated, null);
        if (!jobTerminated) RetainManagedInvocation(invocation);
        while (true)
        {
            JobObjectBasicAccountingInformation accounting;
            if (!QueryInformationJobObject(
                jobHandle,
                1,
                out accounting,
                (uint)Marshal.SizeOf(typeof(JobObjectBasicAccountingInformation)),
                IntPtr.Zero))
            {
                int accountingError = Marshal.GetLastWin32Error();
                invocation.Observe("managed-job-accounting", accountingError, true, null);
                RetainManagedInvocation(invocation);
            }
            if (accounting.ActiveProcesses == 0)
            {
                break;
            }
            Thread.Sleep(10);
        }
        if (processHandle != IntPtr.Zero)
        {
            uint waited = WaitForSingleObject(processHandle, Infinite);
            int waitError = waited == UInt32.MaxValue ? Marshal.GetLastWin32Error() : unchecked((int)waited);
            invocation.Observe("managed-process-wait", waitError, waited != WaitObject0, null);
            if (waited != WaitObject0) RetainManagedInvocation(invocation);
        }
        invocation.Release(ref jobHandle, "managed-job-release", 0);
    }

    private static void FailClosedWithLaunchFilesHeld()
    {
        Thread.Sleep(Timeout.Infinite);
    }

    private static void WaitForGate(string path, string expectedToken, TimeSpan timeout)
    {
        DateTime deadline = DateTime.UtcNow.Add(timeout);
        while (!GateMatches(path, expectedToken))
        {
            if (DateTime.UtcNow >= deadline)
            {
                throw new TimeoutException("Managed launch gate timed out.");
            }
            Thread.Sleep(25);
        }
    }

    private static bool GateMatches(string path, string expectedToken)
    {
        try
        {
            if (!File.Exists(path))
            {
                return false;
            }
            string actualToken = File.ReadAllText(path, StrictUtf8).Trim();
            return String.Equals(actualToken, expectedToken, StringComparison.Ordinal);
        }
        catch (IOException)
        {
            return false;
        }
        catch (UnauthorizedAccessException)
        {
            return false;
        }
    }

    private static string BuildCommandLine(string executable, string[] args)
    {
        StringBuilder commandLine = new StringBuilder(QuoteCommandLineArgument(executable));
        foreach (string argument in args)
        {
            commandLine.Append(' ');
            commandLine.Append(QuoteCommandLineArgument(argument ?? String.Empty));
        }
        return commandLine.ToString();
    }

    private static string QuoteCommandLineArgument(string value)
    {
        if (value.Length > 0 && !RequiresCommandLineQuoting(value))
        {
            return value;
        }
        StringBuilder result = new StringBuilder();
        result.Append('"');
        int backslashes = 0;
        foreach (char character in value)
        {
            if (character == '\\')
            {
                backslashes += 1;
                continue;
            }
            if (character == '"')
            {
                result.Append('\\', (backslashes * 2) + 1);
                result.Append('"');
                backslashes = 0;
                continue;
            }
            if (backslashes > 0)
            {
                result.Append('\\', backslashes);
                backslashes = 0;
            }
            result.Append(character);
        }
        if (backslashes > 0)
        {
            result.Append('\\', backslashes * 2);
        }
        result.Append('"');
        return result.ToString();
    }

    private static bool RequiresCommandLineQuoting(string value)
    {
        foreach (char character in value)
        {
            if (
                character == ' ' ||
                character == '\t' ||
                character == '\r' ||
                character == '\n' ||
                character == '"')
            {
                return true;
            }
        }
        return false;
    }

    // The reviewed native launcher holds the exact helper image and target
    // directory without write/delete sharing while it creates and waits for
    // the helper. CreateProcess receives final paths obtained from those held
    // handles, so a replacement or reparse race cannot exchange verified
    // bytes for a different executable.
    private static int RunDirectorySyncLaunch(string encodedPayload)
    {
        FileStream helperHandle = null;
        IntPtr directoryHandle = IntPtr.Zero;
        IntPtr childProcess = IntPtr.Zero;
        IntPtr childThread = IntPtr.Zero;
        ManagedInvocation invocation = new ManagedInvocation(new List<FileStream>());
        bool childClosed = false;
        try
        {
            byte[] payloadBytes = Convert.FromBase64String(encodedPayload);
            string payloadJson;
            try
            {
                if (!String.Equals(Convert.ToBase64String(payloadBytes), encodedPayload, StringComparison.Ordinal)) return DirectorySyncLaunchPayloadInvalid;
                payloadJson = StrictUtf8.GetString(payloadBytes);
            }
            finally { Array.Clear(payloadBytes, 0, payloadBytes.Length); }
            DirectorySyncLaunchPayload payload = ParseDirectorySyncLaunchPayload(payloadJson);
            if (payload == null || !IsFullyQualifiedWindowsPath(payload.directory)) return DirectorySyncLaunchPayloadInvalid;

            string requestedHelper = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(typeof(ServiceLassoManagedLauncherNative).Assembly.Location), DirectorySyncHelperRelativePath));
            string requestedDirectory = Path.GetFullPath(payload.directory);
            if ((File.GetAttributes(requestedHelper) & FileAttributes.ReparsePoint) != 0) return DirectorySyncLaunchBindingInvalid;
            helperHandle = new FileStream(requestedHelper, FileMode.Open, FileAccess.Read, FileShare.Read);
            invocation.Files.Add(helperHandle);
            if (helperHandle.Length != DirectorySyncHelperByteLength) return DirectorySyncLaunchBindingInvalid;
            string helperDigest;
            using (SHA256 sha256 = SHA256.Create()) { helperDigest = ToLowerHex(sha256.ComputeHash(helperHandle)); }
            if (!String.Equals(helperDigest, DirectorySyncHelperSha256, StringComparison.Ordinal)) return DirectorySyncLaunchBindingInvalid;
            string helperFinalPath = FinalPathForHandle(helperHandle.SafeFileHandle.DangerousGetHandle());
            if (!SameWindowsPath(helperFinalPath, requestedHelper)) return DirectorySyncLaunchBindingInvalid;

            directoryHandle = CreateFileW(requestedDirectory, GenericRead, ShareRead | ShareWrite, IntPtr.Zero, OpenExisting, FileFlagBackupSemantics, IntPtr.Zero);
            if (directoryHandle == new IntPtr(-1)) { directoryHandle = IntPtr.Zero; return DirectorySyncLaunchBindingInvalid; }
            string directoryFinalPath = FinalPathForHandle(directoryHandle);
            if (!SameWindowsPath(directoryFinalPath, requestedDirectory)) return DirectorySyncLaunchBindingInvalid;

            WaitForDirectorySyncTestGate();

            StartupInfo startupInfo = new StartupInfo();
            startupInfo.cb = Marshal.SizeOf(typeof(StartupInfo));
            ProcessInformation processInformation;
            StringBuilder commandLine = new StringBuilder(BuildCommandLine(helperFinalPath, new[] { directoryFinalPath }));
            invocation.ChildIssuanceUnresolved = true;
            bool childCreated = CreateProcessW(helperFinalPath, commandLine, IntPtr.Zero, IntPtr.Zero, false, 0, IntPtr.Zero, null, ref startupInfo, out processInformation);
            if (!childCreated)
            {
                int createError = Marshal.GetLastWin32Error();
                Win32Exception original = new Win32Exception(createError, "Directory sync child creation failed.");
                invocation.Primary = original; invocation.PrimaryResult = DirectorySyncLaunchCreateFailed;
                invocation.ObservePrimary("directory-sync-child-create", createError, true, original);
                invocation.ChildIssuanceUnresolved = false;
                return DirectorySyncLaunchCreateFailed;
            }
            childProcess = processInformation.hProcess;
            childThread = processInformation.hThread;
            invocation.ObservePrimary("directory-sync-child-create", 0, false, null);
            if (childProcess == IntPtr.Zero || childThread == IntPtr.Zero || processInformation.dwProcessId == 0)
                throw new InvalidOperationException("Directory sync child process evidence was invalid.");
            invocation.ChildIssuanceUnresolved = false;
            childClosed = ObserveDirectorySyncChildWait(invocation, childProcess);
            if (!childClosed) { invocation.PrimaryResult = DirectorySyncLaunchChildFailed; return DirectorySyncLaunchChildFailed; }
            uint exitCode;
            bool exitKnown = ObserveDirectorySyncChildExit(invocation, childProcess, out exitCode);
            if (!exitKnown || exitCode != 0) { invocation.PrimaryResult = DirectorySyncLaunchChildFailed; return DirectorySyncLaunchChildFailed; }
            invocation.PrimaryResult = 0;
            return 0;
        }
        catch (Exception primary)
        {
            invocation.Primary = primary; invocation.PrimaryResult = DirectorySyncLaunchBindingInvalid;
            return DirectorySyncLaunchBindingInvalid;
        }
        finally
        {
            invocation.Process = childProcess; invocation.Thread = childThread; invocation.Directory = directoryHandle;
            FinishDirectorySyncInvocation(invocation, childClosed, ref childThread, ref childProcess, ref directoryHandle);
        }
    }

    internal static bool ObserveDirectorySyncChildWait(ManagedInvocation invocation, IntPtr childProcess)
    {
        uint waited = WaitForSingleObject(childProcess, Infinite);
        int status = waited == UInt32.MaxValue ? Marshal.GetLastWin32Error() : unchecked((int)waited);
        invocation.Observe("directory-sync-child-wait", status, waited != WaitObject0, null);
        return waited == WaitObject0;
    }
    internal static bool ObserveDirectorySyncChildExit(ManagedInvocation invocation, IntPtr childProcess, out uint exitCode)
    {
        bool exitKnown = GetExitCodeProcess(childProcess, out exitCode);
        int exitError = exitKnown ? 0 : Marshal.GetLastWin32Error();
        Win32Exception original = exitKnown ? null : new Win32Exception(exitError, "Directory sync child exit-code query failed.");
        if (!exitKnown) invocation.Primary = original;
        invocation.ObservePrimary("directory-sync-child-exit-query", exitError, !exitKnown, original);
        return exitKnown;
    }
    internal static void FinishDirectorySyncInvocation(ManagedInvocation invocation, bool childClosed,
        ref IntPtr childThread, ref IntPtr childProcess, ref IntPtr directory)
    {
        // Failed/unknown original wait is not child closure. Hold all original
        // inputs and handles on this same live stack; no wait/kill retry.
        if (invocation.ChildIssuanceUnresolved || (childProcess != IntPtr.Zero && !childClosed)) RetainManagedInvocation(invocation);
        invocation.Release(ref childThread, "directory-sync-thread-release", 0);
        invocation.Release(ref childProcess, "directory-sync-process-release", 0);
        invocation.Release(ref directory, "directory-sync-directory-release", 0);
        for (int ordinal = 0; ordinal < invocation.Files.Count; ordinal++) invocation.ReleaseFile(invocation.Files[ordinal], ordinal);
        if (invocation.Failed) RetainManagedInvocation(invocation);
    }

    private static DirectorySyncLaunchPayload ParseDirectorySyncLaunchPayload(string payloadJson)
    {
        // Validate before JavaScriptSerializer so duplicate escaped keys never
        // collapse into a trusted value.  The byte-for-byte reconstruction
        // rejects whitespace, reordered members, escaped member names, and
        // alternate string spellings before any helper handle is opened.
        ValidateStrictJsonSyntax(payloadJson);
        IDictionary<string, object> root = RequireObject(new JavaScriptSerializer().DeserializeObject(payloadJson), "directory sync payload");
        RequireExactKeys(root, new string[] { "directory" }, "directory sync payload");
        string directory = RequireString(root["directory"], "directory sync directory", false);
        string canonical = "{\"directory\":" + CanonicalJsonString(directory) + "}";
        if (!String.Equals(payloadJson, canonical, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Directory sync payload was not canonical.");
        }
        return new DirectorySyncLaunchPayload { directory = directory };
    }

    private static string CanonicalJsonString(string value)
    {
        StringBuilder result = new StringBuilder();
        result.Append('"');
        foreach (char character in value)
        {
            switch (character)
            {
                case '"': result.Append("\\\""); break;
                case '\\': result.Append("\\\\"); break;
                case '\b': result.Append("\\b"); break;
                case '\f': result.Append("\\f"); break;
                case '\n': result.Append("\\n"); break;
                case '\r': result.Append("\\r"); break;
                case '\t': result.Append("\\t"); break;
                default:
                    if (character < 0x20) result.Append("\\u").Append(((int)character).ToString("x4"));
                    else result.Append(character);
                    break;
            }
        }
        result.Append('"');
        return result.ToString();
    }

    private static string FinalPathForHandle(IntPtr handle)
    {
        StringBuilder buffer = new StringBuilder(32768);
        uint length = GetFinalPathNameByHandleW(handle, buffer, (uint)buffer.Capacity, 0);
        if (length == 0 || length >= buffer.Capacity) throw new Win32Exception(Marshal.GetLastWin32Error(), "Final path query failed.");
        return NormalizeFinalPath(buffer.ToString());
    }

    private static bool SameWindowsPath(string left, string right)
    {
        return String.Equals(Path.GetFullPath(left).TrimEnd('\\'), Path.GetFullPath(right).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);
    }

    private static void WaitForDirectorySyncTestGate()
    {
        if (!String.Equals(Environment.GetEnvironmentVariable("SERVICE_LASSO_ENABLE_TEST_HOOKS"), "1", StringComparison.Ordinal)) return;
        string readyPath = Environment.GetEnvironmentVariable("SERVICE_LASSO_DIRECTORY_SYNC_TEST_READY_PATH");
        string continuePath = Environment.GetEnvironmentVariable("SERVICE_LASSO_DIRECTORY_SYNC_TEST_CONTINUE_PATH");
        string token = Environment.GetEnvironmentVariable("SERVICE_LASSO_DIRECTORY_SYNC_TEST_TOKEN");
        if (String.IsNullOrWhiteSpace(readyPath) && String.IsNullOrWhiteSpace(continuePath) && String.IsNullOrWhiteSpace(token)) return;
        if (!IsFullyQualifiedWindowsPath(readyPath) || !IsFullyQualifiedWindowsPath(continuePath) || !IsLowerHex64(token)) throw new InvalidOperationException("Directory-sync test gate was invalid.");
        File.WriteAllText(readyPath, token, StrictUtf8);
        DateTime deadline = DateTime.UtcNow.AddSeconds(5);
        while (DateTime.UtcNow < deadline)
        {
            try
            {
                if (String.Equals(File.ReadAllText(continuePath, StrictUtf8), token, StringComparison.Ordinal)) return;
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
            Thread.Sleep(10);
        }
        throw new InvalidOperationException("Directory-sync test gate did not release.");
    }

    private static string NormalizeFinalPath(string value)
    {
        if (value.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase))
        {
            return @"\\" + value.Substring(8);
        }
        if (value.StartsWith(@"\\?\", StringComparison.OrdinalIgnoreCase))
        {
            return value.Substring(4);
        }
        return value;
    }

    private static void InitializeProgress()
    {
        progressToken = Environment.GetEnvironmentVariable(ProgressEnvironmentName, EnvironmentVariableTarget.Process);
        if (!IsLowerHex64(progressToken))
        {
            progressToken = null;
            return;
        }
        byte[] key = StrictUtf8.GetBytes(progressToken);
        try
        {
            progressHmac = new HMACSHA256(key);
        }
        catch
        {
            progressHmac = null;
        }
        finally
        {
            Array.Clear(key, 0, key.Length);
        }
    }

    private static void SetProgress(string phase, string payloadFailureBoundary = null)
    {
        try
        {
            if (progressHmac == null || !IsProgressPhase(phase) ||
                (payloadFailureBoundary != null &&
                 (!String.Equals(phase, "launcher_payload_validation", StringComparison.Ordinal) ||
                  !IsPayloadFailureBoundary(payloadFailureBoundary))))
            {
                return;
            }
            string authenticatedRecord = payloadFailureBoundary == null ? phase : phase + ":" + payloadFailureBoundary;
            byte[] phaseBytes = StrictUtf8.GetBytes(authenticatedRecord);
            byte[] digest;
            try
            {
                digest = progressHmac.ComputeHash(phaseBytes);
            }
            finally
            {
                Array.Clear(phaseBytes, 0, phaseBytes.Length);
            }
            try
            {
                Console.Error.WriteLine(ProgressPrefix + authenticatedRecord + ":" + ToLowerHex(digest));
            }
            finally
            {
                Array.Clear(digest, 0, digest.Length);
            }
        }
        catch
        {
            // Diagnostic progress is observational and cannot change launch behavior.
        }
    }


    private static bool IsProgressPhase(string phase)
    {
        return
            String.Equals(phase, "launcher_initialization", StringComparison.Ordinal) ||
            String.Equals(phase, "launcher_native_asset_validation", StringComparison.Ordinal) ||
            String.Equals(phase, "launcher_payload_validation", StringComparison.Ordinal) ||
            String.Equals(phase, "launcher_gate_observation", StringComparison.Ordinal) ||
            String.Equals(phase, "launcher_file_open", StringComparison.Ordinal) ||
            String.Equals(phase, "launcher_file_hash", StringComparison.Ordinal) ||
            String.Equals(phase, "launcher_file_final_path", StringComparison.Ordinal) ||
            String.Equals(phase, "launcher_binding_publication", StringComparison.Ordinal);
    }

    private static bool IsPayloadFailureBoundary(string boundary)
    {
        return
            String.Equals(boundary, "launch_evidence", StringComparison.Ordinal) ||
            String.Equals(boundary, "canonical_encoding", StringComparison.Ordinal) ||
            String.Equals(boundary, "strict_utf8", StringComparison.Ordinal) ||
            String.Equals(boundary, "json_or_schema", StringComparison.Ordinal) ||
            String.Equals(boundary, "semantic_payload", StringComparison.Ordinal);
    }

    private static bool IsLowerHex64(string value)
    {
        if (value == null || value.Length != 64)
        {
            return false;
        }
        foreach (char character in value)
        {
            if (!((character >= '0' && character <= '9') || (character >= 'a' && character <= 'f')))
            {
                return false;
            }
        }
        return true;
    }

    private static string ToLowerHex(byte[] bytes)
    {
        return BitConverter.ToString(bytes).Replace("-", String.Empty).ToLowerInvariant();
    }
}
