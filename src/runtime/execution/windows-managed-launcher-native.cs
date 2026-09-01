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
    private const string ProgressPrefix = "__SERVICE_LASSO_LAUNCHER_PROGRESS__:";
    private const string PayloadEnvironmentName = "SERVICE_LASSO_MANAGED_LAUNCH_PAYLOAD";
    private const string GateEnvironmentName = "SERVICE_LASSO_MANAGED_LAUNCH_GATE";
    private const string ProgressEnvironmentName = "SERVICE_LASSO_MANAGED_LAUNCH_PROGRESS_TOKEN";

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

    private sealed class EnvironmentOverride
    {
        public string name { get; set; }
        public string value { get; set; }
    }

    public static int Main()
    {
        IntPtr jobHandle = IntPtr.Zero;
        IntPtr processHandle = IntPtr.Zero;
        IntPtr threadHandle = IntPtr.Zero;
        bool targetAssignedToJob = false;
        List<FileStream> boundFiles = new List<FileStream>();
        int failureExitCode = FailureExitCodeUnknown;

        try
        {
            ValidateNativeLayouts();
            AssertBootstrapEnvironmentSanitized();
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
                throw new InvalidOperationException("Managed launch evidence was missing.");
            }

            byte[] payloadBytes = Convert.FromBase64String(encodedPayload);
            string payloadJson;
            try
            {
                if (!String.Equals(Convert.ToBase64String(payloadBytes), encodedPayload, StringComparison.Ordinal))
                {
                    throw new InvalidOperationException("Managed launch payload encoding was invalid.");
                }
                payloadJson = StrictUtf8.GetString(payloadBytes);
            }
            finally
            {
                Array.Clear(payloadBytes, 0, payloadBytes.Length);
            }
            LaunchPayload payload = ParseLaunchPayload(payloadJson);
            ValidatePayload(payload);
            ClearLaunchEnvironment();

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
            RetireProgress();
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
            ApplyTargetEnvironmentOverrides(payload.targetEnvironmentOverrides);
            try
            {
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
                }
                if (targetCreated)
                {
                    processHandle = processInformation.hProcess;
                    threadHandle = processInformation.hThread;
                }
            }
            finally
            {
                ClearTargetEnvironmentOverrides(payload.targetEnvironmentOverrides);
            }
            if (!targetCreated)
            {
                throw new Win32Exception(targetCreationError, "Managed target creation failed.");
            }
            if (processHandle == IntPtr.Zero || threadHandle == IntPtr.Zero || processInformation.dwProcessId == 0)
            {
                throw new InvalidOperationException("Managed target process evidence was invalid.");
            }
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
            if (!CloseHandle(threadHandle))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Managed target thread handle close failed.");
            }
            threadHandle = IntPtr.Zero;
            failureExitCode = FailureExitCodeAcknowledgmentWrite;
            string acknowledgment = "{\"token\":\"" + payload.ackToken + "\",\"pid\":" +
                processInformation.dwProcessId.ToString(System.Globalization.CultureInfo.InvariantCulture) + "}";
            File.WriteAllText(payload.ackPath, acknowledgment, StrictUtf8);

            if (WaitForSingleObject(processHandle, Infinite) != WaitObject0)
            {
                throw new InvalidOperationException("Managed target wait failed.");
            }
            uint exitCode;
            if (!GetExitCodeProcess(processHandle, out exitCode))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Managed target exit-code query failed.");
            }
            return unchecked((int)exitCode);
        }
        catch
        {
            return failureExitCode;
        }
        finally
        {
            try
            {
                ClearLaunchEnvironment();
            }
            catch
            {
                // Cleanup continues through handle closure even if environment retirement fails.
            }
            RetireProgress();
            if (threadHandle != IntPtr.Zero)
            {
                CloseHandle(threadHandle);
                threadHandle = IntPtr.Zero;
            }
            ContainManagedJobBeforeFileRelease(ref jobHandle, processHandle, targetAssignedToJob);
            if (processHandle != IntPtr.Zero)
            {
                CloseHandle(processHandle);
                processHandle = IntPtr.Zero;
            }
            foreach (FileStream boundFile in boundFiles)
            {
                try
                {
                    boundFile.Dispose();
                }
                catch
                {
                    // Handle and Job cleanup remain authoritative.
                }
            }
        }
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

    private static void ApplyTargetEnvironmentOverrides(EnvironmentOverride[] environmentOverrides)
    {
        int appliedCount = 0;
        try
        {
            foreach (EnvironmentOverride environmentOverride in environmentOverrides)
            {
                Environment.SetEnvironmentVariable(
                    environmentOverride.name,
                    environmentOverride.value,
                    EnvironmentVariableTarget.Process);
                appliedCount += 1;
            }
        }
        catch
        {
            for (int index = 0; index < appliedCount; index += 1)
            {
                try
                {
                    Environment.SetEnvironmentVariable(
                        environmentOverrides[index].name,
                        null,
                        EnvironmentVariableTarget.Process);
                }
                catch
                {
                    // The launch remains failed closed; outer Job cleanup is authoritative.
                }
            }
            throw;
        }
    }

    private static void ClearTargetEnvironmentOverrides(EnvironmentOverride[] environmentOverrides)
    {
        List<Exception> failures = new List<Exception>();
        foreach (EnvironmentOverride environmentOverride in environmentOverrides)
        {
            try
            {
                Environment.SetEnvironmentVariable(
                    environmentOverride.name,
                    null,
                    EnvironmentVariableTarget.Process);
            }
            catch (Exception error)
            {
                failures.Add(error);
            }
        }
        if (failures.Count > 0)
        {
            throw new AggregateException("Managed target environment cleanup failed.", failures);
        }
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
        bool targetAssignedToJob)
    {
        if (!targetAssignedToJob && processHandle != IntPtr.Zero)
        {
            if (!TerminateProcess(processHandle, 1) || WaitForSingleObject(processHandle, Infinite) != WaitObject0)
            {
                FailClosedWithLaunchFilesHeld();
            }
        }
        if (jobHandle == IntPtr.Zero)
        {
            return;
        }
        if (!TerminateJobObject(jobHandle, 1))
        {
            FailClosedWithLaunchFilesHeld();
        }
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
                FailClosedWithLaunchFilesHeld();
            }
            if (accounting.ActiveProcesses == 0)
            {
                break;
            }
            Thread.Sleep(10);
        }
        if (processHandle != IntPtr.Zero && WaitForSingleObject(processHandle, Infinite) != WaitObject0)
        {
            FailClosedWithLaunchFilesHeld();
        }
        if (!CloseHandle(jobHandle))
        {
            FailClosedWithLaunchFilesHeld();
        }
        jobHandle = IntPtr.Zero;
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

    private static void SetProgress(string phase)
    {
        try
        {
            if (progressHmac == null || !IsProgressPhase(phase))
            {
                return;
            }
            byte[] phaseBytes = StrictUtf8.GetBytes(phase);
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
                Console.Error.WriteLine(ProgressPrefix + phase + ":" + ToLowerHex(digest));
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

    private static void RetireProgress()
    {
        progressToken = null;
        try
        {
            if (progressHmac != null)
            {
                progressHmac.Dispose();
            }
        }
        catch
        {
            // Diagnostic cleanup cannot change launch or containment behavior.
        }
        finally
        {
            progressHmac = null;
        }
    }

    private static void ClearLaunchEnvironment()
    {
        Environment.SetEnvironmentVariable(PayloadEnvironmentName, null, EnvironmentVariableTarget.Process);
        Environment.SetEnvironmentVariable(GateEnvironmentName, null, EnvironmentVariableTarget.Process);
        Environment.SetEnvironmentVariable(ProgressEnvironmentName, null, EnvironmentVariableTarget.Process);
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
